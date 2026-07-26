/**
 * Promise に上限時間を掛ける小さなヘルパー。
 *
 * Phase0Config の取得や Parameter Store 復号のクライアントは自前のタイムアウトを持たない。
 * これらは利用者が待っている同期パス（登録リクエスト）や、LINE が再送を判断する Webhook の
 * 応答パスに乗るため、応答が返らないと待ち続けることになる。
 *
 * 上限に達したときは `name === 'TimeoutError'` の Error で reject する。呼出し側はこの名前で
 * 「タイムアウト」と「その他の失敗」を区別してログ文言を分ける。
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error('timed out')
      e.name = 'TimeoutError'
      reject(e)
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
