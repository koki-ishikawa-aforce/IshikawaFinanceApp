/**
 * 勤務先振込元名簿 Repository I/F（集約: EmployerRemitterDirectory、#448 / OQ-61）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * 名簿は利用者ごとに 1 つで、未登録の利用者も「空の名簿」として扱える
 * （`findByOwner` は null を返さず `emptyEmployerRemitterDirectory` を返す）。
 * 呼び出し側に「未登録なら空配列」の分岐を毎回書かせないための約束。
 */
import type { UserId } from '../../shared/ids'
import type { EmployerRemitterDirectory } from '../aggregates/EmployerRemitterDirectory'

export interface EmployerRemitterDirectoryRepository {
  /** 所有者本人の名簿を返す。1 件も登録が無ければ空の名簿を返す */
  findByOwner(userId: UserId): Promise<EmployerRemitterDirectory>
  save(directory: EmployerRemitterDirectory): Promise<void>
}
