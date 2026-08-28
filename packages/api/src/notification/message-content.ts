/**
 * 通知本文の組み立て（#389）
 *
 * 08g §2 の「事後」条件が定める本文の中身をここで作る:
 *  - CSV 取込リマインダー: プレーンテキスト + SMBC 明細ダウンロード URL とアプリ取込画面 URL（OQ-12）
 *  - 月次レポート世帯サマリ: Flex Message で 世帯費用カテゴリ別 + NISA 積立累計 + 残高推移（OQ-12）
 *  - 月次レポート個人サマリ: Flex Message で 個人費用合計 + 経費(会社) 合計（プライバシー）
 *
 * 不完全月のレポートは、どちらのサマリにも金額の上に注意書きを添える（#442-A）。
 * レポート画面だけに注意が出て LINE に出ないと、同じ月について画面と LINE で食い違う。
 *
 * Flex Message の構造は LINE Messaging API 固有の表現であり、ドメインに持ち込まず
 * ACL 側（api 層）で組み立てる（08g §4: LINE Messaging API とは Conformist）。
 * ドメインが決めるのは「何を載せるか」（月次レポート集約の値）で、
 * 本モジュールは「どう並べるか」だけを担う。
 *
 * プライバシー3段階ルール（世帯フルオープン / 個人は相手に合計のみ / 経費は本人のみ）:
 * 個人サマリは本人の個人 DM 宛のみで、配偶者の経費・個人費用は一切載せない。
 * 世帯サマリは共通トークルーム宛で、世帯費用と資産のみを載せる（個人・経費は載せない）。
 */
import type { DeliveryContent, MonthlyReport, UserRole, YearMonth } from '@warimaru/domain'
import {
  DeliveryContentSchema,
  isIncompleteMonthReport,
  selfTotalsOf,
  statementSiteUrl,
} from '@warimaru/domain'
import type { DeepLinkBuilder } from './deep-links.js'

/**
 * 世帯サマリに個別表示するカテゴリ行の上限。超過分は「その他」に合算する。
 * カテゴリ数もカテゴリ名の長さも利用者が自由に増やせるため、上限が無いと
 * Flex payload が LINE のサイズ上限を超えて 400 になり、その月のサマリが失われる。
 */
const MAX_CATEGORY_ROWS = 12
/** カテゴリ名の表示上限（超過分は末尾を省略記号に置き換える） */
const MAX_CATEGORY_LABEL_LENGTH = 24

/**
 * 不完全月の注意書き（#442-A）。
 *
 * レポート画面と同じ「データが不完全な月です」を LINE のサマリにも出す。画面に無い一文を足すのは、
 * LINE には前後の文脈（ステータスや運用開始の経緯）が見えず、月まるごとの金額として読まれるため。
 * 不完全月フラグが付くのは運用開始月のレポートだけで、その月は運用開始日より前が集計に入らない
 * （論点20 / P4-1「運用開始日：N/M〜月末 と明示」）。あとから埋まる欠落ではないので、
 * 数字が変わる予告ではなく「集計した期間が月の一部である」ことを書く。
 */
const INCOMPLETE_MONTH_NOTICE =
  '⚠️ データが不完全な月です。この月は運用開始日から月末までの期間だけを集計しています。'

/** 金額表示（円・3 桁区切り） */
function formatYen(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`
}

/** "2026-07" → "2026年7月" */
function formatMonthLabel(month: YearMonth): string {
  const [year, mm] = String(month).split('-')
  return `${year}年${Number(mm)}月`
}

/** Flex の 1 行（ラベル : 値） */
function keyValueRow(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#8c8c8c', flex: 5, wrap: true },
      { type: 'text', text: value, size: 'sm', flex: 4, align: 'end', wrap: true },
    ],
  }
}

/**
 * Flex Message のバブルを組み立てる。
 * リンクは footer のボタン（uri アクション）として payload に埋め込む
 * （08g: `data Flex_Message配信内容 = Flex_payload AND リンクURL`。
 * ゲートウェイは linkUrl を別メッセージとして送らない契約）。
 */
function flexBubble(params: {
  title: string
  subtitle: string
  /** 金額の上に出す注意書き（undefined なら行ごと出さない） */
  notice?: string | undefined
  rows: Record<string, unknown>[]
  linkLabel: string
  linkUrl: string
}): Record<string, unknown> {
  const noticeRows: Record<string, unknown>[] =
    params.notice === undefined
      ? []
      : // 文字色は指定せず LINE 既定色に委ねる。警告色（画面の `--warning-muted` 相当）を
        // 焼き込むと、LINE のダークモードで背景とのコントラストが落ちて注意書きだけが読みにくくなる。
        // 注意であることは冒頭の記号と太字で示す
        [{ type: 'text', text: params.notice, size: 'xs', weight: 'bold', wrap: true }]
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: params.title, weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: params.subtitle, size: 'sm', color: '#8c8c8c', wrap: true },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [...noticeRows, ...params.rows],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          action: { type: 'uri', label: params.linkLabel, uri: params.linkUrl },
        },
      ],
    },
  }
}

/**
 * CSV 取込リマインダーの本文（08g §2「CSV取込リマインダーを送信する」）。
 *
 * 明細のダウンロード元（カード・銀行）とアップロード先（アプリの取込画面）の両方を載せる。
 * アプリ取込画面の URL だけ `linkUrl` に置くのは、ゲートウェイが本文末尾へ 1 本だけ
 * 連結する契約のため（本文中に重複して書かない）。
 *
 * ダウンロード元の URL は取込画面のガイドと同じ `statementSiteUrl`（ドメイン層）から取る。
 * ここに URL を書き写すと、LINE のリンクと画面のリンクが別のページを開きうる（#472）。
 */
export function buildCsvImportReminderContent(
  month: YearMonth,
  links: DeepLinkBuilder,
): DeliveryContent {
  const label = formatMonthLabel(month)
  const textBody = [
    `【割まる】${label}分の明細取込がまだ完了していません📄`,
    '',
    '以下から明細をダウンロードして、割まるにアップロードしてください。',
    `・三井住友カード: ${statementSiteUrl('card_statement', month)}`,
    `・三井住友銀行: ${statementSiteUrl('bank_statement', month)}`,
    '',
    'アップロードはこちらから👇',
  ].join('\n')

  return DeliveryContentSchema.parse({
    kind: 'plain_text',
    textBody,
    linkUrl: links.csvImport(month),
  })
}

/**
 * OAuth 失効通知の本文（08g §2「OAuth失効通知を個人DMに配信する」— #392）。
 *
 * 失効した本人の個人 DM にだけ届く（OQ-2。メールフェイルセーフ対象外）。金額・明細は
 * 一切載せず、「自動取込が止まっている事実」と再認可への導線だけを伝える。
 * リンク先は設定画面の Gmail 連携タブ（論点57 の Deep Link マップ ④）。
 */
export function buildOauthRevocationNoticeContent(links: DeepLinkBuilder): DeliveryContent {
  const reauthorizationUrl = links.gmailReauthorization()
  return DeliveryContentSchema.parse({
    kind: 'flex_message',
    flexPayloadJson: JSON.stringify(
      flexBubble({
        title: 'Gmail 連携が切れています',
        subtitle: 'このメッセージはあなたにだけ届いています',
        rows: [
          {
            type: 'text',
            text:
              '利用明細メールの自動取込が止まっています。' +
              'このままだとカード利用が家計簿に反映されません。' +
              'ボタンから設定画面を開いて、Gmail を連携し直してください。',
            size: 'sm',
            wrap: true,
          },
        ],
        linkLabel: 'Gmail を連携し直す',
        linkUrl: reauthorizationUrl,
      }),
    ),
    linkUrl: reauthorizationUrl,
  })
}

/**
 * カテゴリの表示ラベル。名前を解決できないカテゴリは ID をそのまま出さず「その他」に丸め、
 * 長すぎる名前は切り詰める（削除済みカテゴリの ID 露出と payload 肥大の両方を防ぐ）。
 */
function categoryLabel(name: string | undefined): string {
  if (name === undefined) return 'その他'
  return name.length <= MAX_CATEGORY_LABEL_LENGTH
    ? name
    : `${name.slice(0, MAX_CATEGORY_LABEL_LENGTH - 1)}…`
}

/** 残高推移の最終値（系列が空なら undefined） */
function latestOf<T>(series: readonly T[]): T | undefined {
  return series.length === 0 ? undefined : series[series.length - 1]
}

/**
 * そのレポートに添える注意書き（不完全月でなければ undefined）。
 * 世帯サマリ・個人サマリの両方がこの 1 か所を通す。出し分けを呼び出し側に書くと、
 * 同じ月について片方にだけ注意が付く食い違いが生まれる。
 */
function noticeOf(report: MonthlyReport): string | undefined {
  return isIncompleteMonthReport(report.common) ? INCOMPLETE_MONTH_NOTICE : undefined
}

/**
 * 月次レポート世帯サマリの本文（08g §2「月次レポートサマリを共通トークルームに配信する」）。
 *
 * @param categoryNameOf カテゴリID → 表示名。未解決のカテゴリは ID をそのまま出さず
 *   「その他」に丸める（削除済みカテゴリの ID が世帯トークルームに露出するのを避ける）
 */
export function buildHouseholdSummaryContent(
  report: MonthlyReport,
  categoryNameOf: (categoryId: string) => string | undefined,
  links: DeepLinkBuilder,
): DeliveryContent {
  const { targetYearMonth, householdCategoryTotals, nisaContributionAccumulated, balanceTrend } =
    report.common
  const householdTotal = householdCategoryTotals.reduce((sum, c) => sum + c.total, 0)

  const rows: Record<string, unknown>[] = [keyValueRow('世帯費用 合計', formatYen(householdTotal))]
  // 金額の大きい順に上位のみ個別表示し、残りは 1 行に合算する（上限の根拠は MAX_CATEGORY_ROWS）
  const sorted = [...householdCategoryTotals].sort((a, b) => b.total - a.total)
  for (const { categoryId, total } of sorted.slice(0, MAX_CATEGORY_ROWS)) {
    rows.push(keyValueRow(`・${categoryLabel(categoryNameOf(categoryId))}`, formatYen(total)))
  }
  const overflow = sorted.slice(MAX_CATEGORY_ROWS)
  if (overflow.length > 0) {
    rows.push(
      keyValueRow(
        `・ほか ${overflow.length} 件`,
        formatYen(overflow.reduce((sum, c) => sum + c.total, 0)),
      ),
    )
  }
  rows.push({ type: 'separator', margin: 'md' })
  rows.push(keyValueRow('NISA 積立累計', formatYen(nisaContributionAccumulated)))

  const latestSmbc = latestOf(balanceTrend.smbcBalanceTrend)
  if (latestSmbc !== undefined) {
    rows.push(keyValueRow('SMBC 残高', formatYen(latestSmbc.balance)))
  }
  const latestOtherSavings = latestOf(balanceTrend.otherSavingsBalanceTrend)
  if (latestOtherSavings !== undefined) {
    rows.push(keyValueRow('別銀行貯蓄 残高', formatYen(latestOtherSavings.balance)))
  }
  const latestUnpaid = latestOf(balanceTrend.cardUnpaidTrend)
  if (latestUnpaid !== undefined) {
    rows.push(keyValueRow('カード未払金', formatYen(latestUnpaid.unpaidTotal)))
  }

  return DeliveryContentSchema.parse({
    kind: 'flex_message',
    flexPayloadJson: JSON.stringify(
      flexBubble({
        title: `${formatMonthLabel(targetYearMonth)}の家計レポート`,
        subtitle: '世帯の支出と資産のサマリ',
        notice: noticeOf(report),
        rows,
        linkLabel: 'レポートを開く',
        linkUrl: links.monthlyReport(targetYearMonth),
      }),
    ),
    linkUrl: links.monthlyReport(targetYearMonth),
  })
}

/**
 * 月次レポート個人サマリの本文（08g §2「月次レポート個人サマリを個人DMに配信する」）。
 *
 * 宛先本人の個人費用合計と経費(会社)合計のみを載せる。配偶者側の値は
 * プライバシー3段階ルール（個人は相手に合計のみ・経費は本人のみ）により含めない。
 */
export function buildPersonalSummaryContent(
  report: MonthlyReport,
  role: UserRole,
  links: DeepLinkBuilder,
): DeliveryContent {
  const { targetYearMonth } = report.common
  // 本人分の抜き出しはドメインの selfTotalsOf が単一ソース（MonthlyReportView と同じ関数）
  const { personalTotalSelf, businessExpenseTotalSelf } = selfTotalsOf(report.common, role)

  return DeliveryContentSchema.parse({
    kind: 'flex_message',
    flexPayloadJson: JSON.stringify(
      flexBubble({
        title: `${formatMonthLabel(targetYearMonth)}のあなたのサマリ`,
        subtitle: 'このメッセージはあなたにだけ届いています',
        notice: noticeOf(report),
        rows: [
          keyValueRow('個人費用 合計', formatYen(personalTotalSelf)),
          keyValueRow('経費(会社) 合計', formatYen(businessExpenseTotalSelf)),
        ],
        linkLabel: 'レポートを開く',
        linkUrl: links.monthlyReport(targetYearMonth),
      }),
    ),
    linkUrl: links.monthlyReport(targetYearMonth),
  })
}
