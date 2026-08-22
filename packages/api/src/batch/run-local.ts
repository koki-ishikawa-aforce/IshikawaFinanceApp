/**
 * 手動起動の実行ファイル（#416）。
 *
 * 中身は `cli.ts` にあり、ここは「環境変数を読み込んで呼び、終了コードを返す」だけ。
 * 分けているのは、トップレベルで `process.exit` を呼ぶファイルはテストから import できないため。
 */
import 'dotenv/config'
import { runBatchCli } from './cli.js'

process.exit(await runBatchCli(process.argv.slice(2)))
