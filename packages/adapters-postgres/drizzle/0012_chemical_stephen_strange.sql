-- ここから下の CREATE TABLE / ALTER TABLE / CREATE INDEX は
-- `pnpm --filter @warimaru/adapters-postgres db:generate` の生成物（変更しない）。
-- 最後の CREATE INDEX の後の区切り行から先が手書きのデータ移行 DML。
-- drizzle-kit は DDL しか生成できないため、既存データの移し替えはここに書く。
-- 注意: このファイル内のコメントに区切り行の文字列そのものを書かないこと。
-- drizzle はその文字列でファイルを分割するため、コメントの途中で SQL が切れて構文エラーになる。
CREATE TABLE "balance_history_entries" (
	"entry_id" text PRIMARY KEY NOT NULL,
	"axis" text NOT NULL,
	"account_id" text NOT NULL,
	"value" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "balance_history_entries_axis_source_event_id_unique" UNIQUE("axis","source_event_id"),
	CONSTRAINT "balance_history_entries_axis_check" CHECK ("balance_history_entries"."axis" IN ('smbc_balance', 'other_savings_balance', 'nisa_contribution', 'card_unpaid'))
);
--> statement-breakpoint
ALTER TABLE "balance_history_entries" ADD CONSTRAINT "balance_history_entries_account_id_accounts_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("account_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_balance_history_entries_occurred_at" ON "balance_history_entries" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_balance_history_entries_axis_account_occurred_at" ON "balance_history_entries" USING btree ("axis","account_id","occurred_at");
--> statement-breakpoint
-- データ移行（#398）: 資産の推移グラフの正が月次レポートの凍結値から本テーブルへ移る。
-- 本テーブルは空で始まり、既存口座の初期残高登録イベントは過去に発行済みで再発行されない。
-- そのままだとグラフの起点が無く、月次レポートの NISA 積立累計も「履歴なし」となって
-- LINE の月次サマリに実際と違う金額（据え置きの 0 円）が載りうる。
-- そこで、移行時点の各口座の値を「起点の 1 点」として投入する。
--
-- 対象はアクティブな口座のみ（残高一覧・資産合計と同じ範囲。PostgresAccountBalanceQuery）。
-- 値の取り出し先は口座種別ごとに異なり、カードは残高を持たないため未払金集約の当月合計を使う。
-- entry_id は口座IDから決まる ULID 形式の固定値（'0' + md5 の大文字 25 桁。Crockford Base32 の
-- 許容文字に収まる）。source_event_id も口座IDから決まる固定値にして、再実行しても
-- UNIQUE (axis, source_event_id) が二重投入を止める。
-- payload の occurredAt は Date#toISOString と同じ書式（ミリ秒 + 'Z'）で書く。
-- 読み出しは payload の Zod parse が唯一の経路のため、書式がずれるとその月の読み出しが落ちる。
INSERT INTO "balance_history_entries"
  ("entry_id", "axis", "account_id", "value", "occurred_at", "source_event_id", "payload")
SELECT
  m.entry_id,
  m.axis,
  m.account_id,
  m.value,
  m.occurred_at,
  m.source_event_id,
  jsonb_build_object(
    'entryId', m.entry_id,
    'axis', m.axis,
    'accountId', m.account_id,
    'value', m.value,
    'occurredAt', to_char(m.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'sourceEventId', m.source_event_id
  )
FROM (
  SELECT
    '0' || upper(substr(md5('balance-history-backfill:' || a."account_id"), 1, 25)) AS entry_id,
    CASE a."kind"
      WHEN 'smbc_bank' THEN 'smbc_balance'
      WHEN 'other_savings' THEN 'other_savings_balance'
      WHEN 'nisa' THEN 'nisa_contribution'
      ELSE 'card_unpaid'
    END AS axis,
    a."account_id" AS account_id,
    CASE a."kind"
      WHEN 'smbc_bank' THEN (a."payload"->'balance'->>'currentBalance')::int
      WHEN 'other_savings' THEN (a."payload"->'balance'->>'currentBalance')::int
      WHEN 'nisa' THEN (a."payload"->'contribution'->>'currentAccumulated')::int
      ELSE u."current_month_unpaid_total"
    END AS value,
    date_trunc('milliseconds', now()) AS occurred_at,
    'balance-history-backfill:' || a."account_id" AS source_event_id
  FROM "accounts" a
  LEFT JOIN "mitsui_sumitomo_unpaids" u ON u."account_id" = a."account_id"
  WHERE a."is_active"
) m
WHERE m.value IS NOT NULL
ON CONFLICT DO NOTHING;
