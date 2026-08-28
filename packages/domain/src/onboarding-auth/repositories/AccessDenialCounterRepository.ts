import type { UserId } from '../../shared/ids'
import type { AccessDenialCounter } from '../value-objects/AccessDenialCounter'

export interface AccessDenialCounterRepository {
  findByLineUserId(lineUserId: UserId): Promise<AccessDenialCounter | null>
  save(counter: AccessDenialCounter): Promise<void>
}
