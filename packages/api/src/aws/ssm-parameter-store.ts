/**
 * AWS Parameter Store（SSM）アクセス
 *
 * - 読出し: 許可リスト（HUSBAND_LINE_USER_ID / WIFE_LINE_USER_ID）等の実値解決
 *   （adapters-postgres の ResolveParameterStoreValue に注入。OQ-27: DB はパス参照のみ保持）
 * - 書込み: Gmail OAuth トークン実体の保管（KMS SecureString）
 *
 * リージョン・認証情報は AWS SDK の標準解決（環境変数 / IAM ロール）に従う。
 * 未構成環境では composition-root がフォールバック実装を配線する。
 */
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm'
import { NotFoundError } from '@warimaru/domain'

export interface SsmParameterStore {
  read(path: string): Promise<string>
  write(path: string, value: string): Promise<void>
}

export function createSsmParameterStore(): SsmParameterStore {
  const client = new SSMClient({})
  return {
    async read(path) {
      const result = await client.send(
        new GetParameterCommand({ Name: path, WithDecryption: true }),
      )
      const value = result.Parameter?.Value
      if (value === undefined) throw new NotFoundError('ParameterStoreValue', path)
      return value
    },
    async write(path, value) {
      await client.send(
        new PutParameterCommand({
          Name: path,
          Value: value,
          Type: 'SecureString',
          Overwrite: true,
        }),
      )
    },
  }
}

/** AWS 未構成環境用フォールバック（呼び出し時に明示的に失敗させる） */
export function createUnconfiguredParameterStore(): SsmParameterStore {
  const fail = (): never => {
    throw new Error('Parameter Store が未構成（AWS_REGION と AWS 認証情報を設定する）')
  }
  return {
    read: () => Promise.resolve(fail()),
    write: () => Promise.resolve(fail()),
  }
}
