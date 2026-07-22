/**
 * 通知配信ゲートウェイの開発モード用モック（DATABASE_URL 未設定時に配線）。
 * 実際の LINE / メール送信は行わず、常に成功としてコンソールへ内容を出す。
 */
import type { FailsafeEmailGateway, LineMessagingGateway } from '@warimaru/domain'
import { LineMessageIdSchema } from '@warimaru/domain'

export function createMockLineMessagingGateway(): LineMessagingGateway {
  let seq = 0
  return {
    sendPush(target, content) {
      seq += 1
      const payload = { to: target, messages: [content] }
      console.log(`[mock-line] push:`, JSON.stringify(payload))
      return Promise.resolve({
        sentPayloadJson: JSON.stringify(payload),
        result: {
          kind: 'success',
          lineMessageId: LineMessageIdSchema.parse(`mock-line-message-${seq}`),
        },
      })
    },
  }
}

export function createMockFailsafeEmailGateway(): FailsafeEmailGateway {
  let seq = 0
  return {
    send(email) {
      seq += 1
      console.log(`[mock-email] to=${email.common.toEmailAddress} subject=${email.common.subject}`)
      return Promise.resolve({ kind: 'success', providerRef: `mock-email-${seq}` })
    },
  }
}
