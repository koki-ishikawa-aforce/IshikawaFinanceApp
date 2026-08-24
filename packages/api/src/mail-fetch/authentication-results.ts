/**
 * 受信サーバが付けた送信認証結果（`Authentication-Results` ヘッダ）の読み取り（#478 段階1）
 * @see docs/domain/08a-ul-取引取込.md §2「Gmail からメールを取得する」（Gmail は ACL 越しの外部システム）
 *
 * Gmail は受信時に DKIM / SPF / DMARC の検査結果を `Authentication-Results` ヘッダとして付ける
 * （RFC 8601）。差出人アドレスは詐称できるため、送信元アドレスの一致だけでは三井住友カードを
 * 装ったメールを弾けない。#478 の決定に従い、**この段階では 1 通も弾かず判定結果を記録に残す**
 * だけにする（いきなり弾くと、正規の通知が思わぬ理由で不合格だったときに利用が丸ごと取り込まれ
 * なくなる）。溜まった記録で正規の通知が必ず合格することを確かめてから、弾く側へ切り替える。
 *
 * ヘッダの解析はここに閉じた純粋関数として書く（外部表現の読み取りは ACL の責務で、
 * 件名の encoded-word デコードや From のアドレス取り出しと同じ層に置く）。
 *
 * **偽の判定を読まないための約束**:
 *  - 見るのは**最上位の 1 本だけ**。`Authentication-Results` は受信サーバが受信時に先頭へ足す。
 *    送信者は同名のヘッダを自分のメールに埋め込めるが、それは Gmail が足した行より下に来る
 *  - 引用文字列とコメント `(...)` は判定を読む前に落とす。SPF の結果には
 *    `(google.com: domain of ... designates ...)` のように**差出人が決められる文字列**が
 *    そのまま入るため、落とさないと `dkim=pass` を仕込まれて合格と読み違える
 *  - 各方式は最初に現れた 1 件だけを採る（後ろに足された行を勝たせない）
 *
 * 判定結果はログに残る前提なので、ここでは方式ごとの判定語と authserv-id（判定を付けた受信
 * サーバの名前）しか取り出さない。コメント部にはメールアドレスが含まれるため取り出さない。
 */

/**
 * 方式ごとの判定（RFC 8601 の result キーワード）。
 *  - `absent`: その方式の判定がヘッダに無い（ヘッダ自体が無い場合を含む）= 「判定なし」
 *  - `unknown`: 判定語はあるが、既知のキーワードのいずれでもない
 *
 * `absent` / `unknown` を `pass` に丸めない。丸めると、判定を見て弾く段階（#478 段階3）で
 * 「認証されていないメール」が合格として通る。
 */
export type MailAuthenticationVerdict =
  | 'pass'
  | 'fail'
  | 'softfail'
  | 'neutral'
  | 'none'
  | 'temperror'
  | 'permperror'
  | 'unknown'
  | 'absent'

export interface MailAuthenticationResults {
  dkim: MailAuthenticationVerdict
  spf: MailAuthenticationVerdict
  dmarc: MailAuthenticationVerdict
  /** 判定を付けた受信サーバの識別子（authserv-id。Gmail なら `mx.google.com`）。無ければ undefined */
  authServId?: string
}

const KNOWN_VERDICTS: readonly MailAuthenticationVerdict[] = [
  'pass',
  'fail',
  'softfail',
  'neutral',
  'none',
  'temperror',
  'permperror',
]

const METHODS = ['dkim', 'spf', 'dmarc'] as const
type Method = (typeof METHODS)[number]

/** 判定なし（ヘッダが無い / その方式の記載が無い）を表す既定値 */
const ABSENT: MailAuthenticationResults = { dkim: 'absent', spf: 'absent', dmarc: 'absent' }

/**
 * 引用文字列とコメントを落とす。コメントは入れ子になりうる（`(a (b) c)`）ため、
 * 内側から繰り返し落とす。
 */
function stripQuotedAndComments(value: string): string {
  let result = value.replace(/"(?:[^"\\]|\\.)*"/g, ' ')
  let previous = ''
  while (result !== previous) {
    previous = result
    result = result.replace(/\([^()]*\)/g, ' ')
  }
  return result
}

function verdictOf(keyword: string): MailAuthenticationVerdict {
  const lower = keyword.toLowerCase()
  return KNOWN_VERDICTS.find(known => known === lower) ?? 'unknown'
}

/**
 * `Authentication-Results` ヘッダの値から DKIM / SPF / DMARC の判定を読み取る。
 *
 * @param headerValues メールに付いていた `Authentication-Results` ヘッダの値（**上から順**）。
 *   1 本も無ければ全方式 `absent` を返す。
 */
export function parseAuthenticationResults(
  headerValues: readonly string[],
): MailAuthenticationResults {
  // 受信サーバが足した最上位の 1 本だけを見る（下位は送信者が埋め込めるため信用しない）
  const topmost = headerValues[0]
  if (topmost === undefined || topmost.trim() === '') return ABSENT

  const stripped = stripQuotedAndComments(topmost)
  const [authServSegment = '', ...resultSegments] = stripped.split(';')
  const authServId = authServSegment.trim().split(/\s+/)[0]?.toLowerCase()

  const results: Record<Method, MailAuthenticationVerdict> = {
    dkim: 'absent',
    spf: 'absent',
    dmarc: 'absent',
  }
  // `header.d=...` や `x-dkim=...` を方式名と読まないよう、直前が区切り（行頭・空白・`;`）の
  // ものだけを拾う
  const pattern = /(?:^|[;\s])(dkim|spf|dmarc)\s*=\s*([A-Za-z]+)/g
  for (const match of resultSegments.join(';').matchAll(pattern)) {
    const method = match[1]?.toLowerCase() as Method | undefined
    const keyword = match[2]
    if (method === undefined || keyword === undefined) continue
    // 最初に現れた判定を採る（後ろに足された同じ方式の記載で上書きしない）
    if (results[method] === 'absent') results[method] = verdictOf(keyword)
  }

  return authServId === undefined || authServId === '' ? { ...results } : { ...results, authServId }
}

/** 1 つでも不合格の判定があるか（記録を見るまでもなく気づけるようログに出すため） */
export function hasAuthenticationFailure(results: MailAuthenticationResults): boolean {
  return METHODS.some(method => results[method] === 'fail')
}
