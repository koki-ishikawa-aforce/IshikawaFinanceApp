/**
 * FailsafeEmailGateway の Amazon SES 実装（#36）
 *
 * OQ-14: 送信元プロバイダの選択は実装フェーズで決定 → 既存の AWS 基盤
 * （Parameter Store / IAM）に揃えて SES を採用。標準送信 API に従う
 * Conformist の薄層で、独自ロジックは持たない。
 * リージョン・認証情報は AWS SDK の標準解決（環境変数 / IAM ロール）に従う。
 */
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import type { FailsafeEmailGateway } from '@warimaru/domain'

export interface SesFailsafeEmailGatewayConfig {
  /** SES で検証済みの送信元アドレス */
  fromAddress: string
}

export function createSesFailsafeEmailGateway(
  config: SesFailsafeEmailGatewayConfig,
): FailsafeEmailGateway {
  const client = new SESv2Client({})
  return {
    async send(email) {
      try {
        const result = await client.send(
          new SendEmailCommand({
            FromEmailAddress: config.fromAddress,
            Destination: { ToAddresses: [email.common.toEmailAddress] },
            Content: {
              Simple: {
                Subject: { Data: email.common.subject, Charset: 'UTF-8' },
                Body: { Text: { Data: email.common.body, Charset: 'UTF-8' } },
              },
            },
          }),
        )
        return { kind: 'success', providerRef: result.MessageId ?? 'ses:unknown' }
      } catch (e) {
        const isTimeout =
          e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
        return {
          kind: 'failure',
          failureReason: isTimeout ? 'timeout' : 'ses_failure',
          detail: String(e),
        }
      }
    },
  }
}

/** SES 未構成環境用フォールバック（送信失敗として扱い、詳細に未構成である旨を残す） */
export function createUnconfiguredFailsafeEmailGateway(): FailsafeEmailGateway {
  return {
    send: () =>
      Promise.resolve({
        kind: 'failure',
        failureReason: 'ses_failure',
        detail:
          'フェイルセーフメールが未構成（FAILSAFE_EMAIL_FROM / FAILSAFE_EMAIL_TO と AWS 認証情報を設定する）',
      }),
  }
}
