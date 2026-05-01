import type { MitsuiSumitomoUnpaidId, AccountId } from '../../shared/ids'
import type { MitsuiSumitomoUnpaid } from '../aggregates/MitsuiSumitomoUnpaid'

export interface MitsuiSumitomoUnpaidRepository {
  findById(id: MitsuiSumitomoUnpaidId): Promise<MitsuiSumitomoUnpaid | null>
  findByCardAccountId(accountId: AccountId): Promise<MitsuiSumitomoUnpaid | null>
  save(unpaid: MitsuiSumitomoUnpaid): Promise<void>
}
