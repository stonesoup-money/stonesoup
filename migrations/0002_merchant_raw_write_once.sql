-- Stone Soup — merchant_raw write-once-from-NULL (STON-2 tracer bullet).
--
-- 0001 declared receipts.merchant_raw NOT NULL and immutable from insert:
-- the BEFORE UPDATE trigger aborted any change once a value existed. That
-- is unbuildable against the tracer bullet's own shape — the photo-upload
-- path writes a `pending` receipts row before the merchant is known
-- (extraction has not run yet), and NOT NULL made that row unrepresentable
-- at all.
--
-- Resolution (approved at STON-2's human approval gate): merchant_raw
-- becomes nullable, and NULL now means "extraction has not run yet" — a
-- state 0001 could not express. The immutability trigger becomes
-- write-once-from-NULL: NULL -> value succeeds exactly once; value -> a
-- different value still aborts, unchanged from 0001's guarantee that raw
-- evidence is never overwritten (AGENTS.md, Data conventions #3 — "the
-- single most important rule in this file"). This is not a new trigger
-- shape: it is `golden_set_split_write_once` (0001, "golden_set is
-- write-once") applied a second time in the identical form —
-- `WHEN OLD.split IS NOT NULL AND NEW.split IS NOT OLD.split` there,
-- `WHEN OLD.merchant_raw IS NOT NULL AND NEW.merchant_raw IS NOT
-- OLD.merchant_raw` here. STON-23 tracks revisiting write-once-from-NULL
-- after the tracer bullet lands; this migration does not loosen the
-- invariant any further than that single NULL -> value transition.
--
-- `''` is deliberately rejected as the "unset" sentinel: an empty string
-- is itself a real value (a genuinely blank merchant line on a bad scan),
-- so using it as "absent" would make that real blank merchant silently
-- rewritable — the original bug, in subtler form. NULL already means
-- "absent" in SQL. A new CHECK below additionally requires a non-NULL
-- merchant_raw once a receipt is past the three extraction-pending
-- statuses, so a row cannot sit un-extracted forever and quietly lose the
-- write-once guard. The three-value list (`pending`, `extracting`,
-- `failed`) — not the two-value list an earlier draft of this ticket's
-- plan recorded — matters: a receipt whose extraction throws before a
-- merchant is known is set to `status = 'failed'` with `merchant_raw`
-- still NULL, and a two-value list would make that very UPDATE abort,
-- stranding the receipt in `extracting` forever.
--
-- SQLite has no `ALTER TABLE ... ALTER COLUMN` and no
-- `ALTER TABLE ... ADD CONSTRAINT` — dropping NOT NULL and widening the
-- CHECK both require the standard 12-step table-rebuild procedure: create
-- the new table, copy every row, drop the old table, rename, and recreate
-- every trigger and index that named `receipts`. `line_items.receipt_id`
-- and `receipt_sources.receipt_id` are both `ON DELETE RESTRICT` (0001),
-- so a bare `DROP TABLE receipts` here would be treated as deleting every
-- row in it and would fail against any child row that still exists.
-- `PRAGMA defer_foreign_keys = TRUE` (D1's documented mechanism for this
-- exact rebuild-a-table-with-incoming-FKs case) defers FK enforcement
-- until this migration's own transaction commits, rather than
-- `PRAGMA foreign_keys = OFF`, which is a *connection* pragma, is never
-- persisted to the database file, and is exactly the lesson 0001's header
-- already recorded the hard way about `recursive_triggers`.
-- `defer_foreign_keys` is scoped to the current transaction and resets to
-- its default on its own once that transaction commits — nothing here
-- has to re-enable it. `PRAGMA foreign_key_check` at the end returns a
-- result set of violations, if any — it does not raise and does not abort
-- the transaction, so on its own it is a diagnostic a human running
-- `wrangler d1 migrations apply` can eyeball, not a gate (a mistake in the
-- rebuild would commit exactly as quietly as without this line). The real
-- guard is `packages/worker/src/schema.test.ts`'s "migration 0002 leaves
-- the FK graph intact" block: it asserts `foreign_key_check` returns zero
-- rows and that `foreign_key_list` on both `line_items` and
-- `receipt_sources` still resolves to the rebuilt `receipts` table, after
-- applying this migration through both paths this file is proved against
-- below.
--
-- Proved against both application paths this migration must work under
-- (STON-2's binding requirement): `test/apply-migrations.ts` /
-- `applyD1Migrations` (via `db.batch()`, one transaction per migration
-- file — the same shape `wrangler d1 migrations apply` sends), and
-- `wrangler d1 migrations apply --local` directly. See
-- `packages/worker/src/schema.test.ts` for the lock-in tests: the existing
-- REPLACE/RESTRICT tests from 0001 pass unmodified, and new tests cover
-- the NULL -> value -> (aborted) second value transition, the aborted
-- revert-to-NULL, and the new status-gated CHECK.
PRAGMA defer_foreign_keys = TRUE;

CREATE TABLE receipts_new (
  id                       TEXT PRIMARY KEY,
  -- Nullable now: NULL means "extraction has not run yet". Write-once from
  -- NULL is enforced by the trigger below, not by NOT NULL.
  merchant_raw             TEXT,
  merchant_normalized      TEXT,
  store_location           TEXT,
  -- Unchanged from 0001 — see that file's column comment for why a
  -- date-only value is stored exactly as printed rather than fabricating
  -- a time or timezone that was never on the receipt.
  purchased_at             TEXT CHECK (
                              purchased_at IS NULL
                              OR purchased_at GLOB
                                 '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                              OR purchased_at GLOB '????-??-??T??:??:??*Z'
                            ),
  subtotal_cents           INTEGER CHECK (subtotal_cents IS NULL OR typeof(subtotal_cents) = 'integer'),
  tax_cents                INTEGER CHECK (tax_cents IS NULL OR typeof(tax_cents) = 'integer'),
  total_cents               INTEGER CHECK (total_cents IS NULL OR typeof(total_cents) = 'integer'),
  payment_last4            TEXT CHECK (payment_last4 IS NULL OR payment_last4 GLOB '[0-9][0-9][0-9][0-9]'),
  -- Email receipts have no image.
  r2_key                   TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'extracting', 'extracted', 'needs_review', 'confirmed', 'failed')),
  checksum_result           TEXT NOT NULL DEFAULT 'not_run' CHECK (checksum_result IN ('pass', 'fail', 'not_run')),
  checksum_delta_cents       INTEGER CHECK (checksum_delta_cents IS NULL OR typeof(checksum_delta_cents) = 'integer'),
  extraction_model          TEXT,
  extraction_input_tokens   INTEGER,
  extraction_output_tokens  INTEGER,
  extracted_at              TEXT CHECK (extracted_at IS NULL OR extracted_at GLOB '????-??-??T??:??:??*Z'),
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                               CHECK (created_at GLOB '????-??-??T??:??:??*Z'),
  -- Caller-maintained, not automatic — same reasoning as 0001.
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                               CHECK (updated_at GLOB '????-??-??T??:??:??*Z'),
  -- New in this migration: a receipt past the three extraction-pending
  -- statuses must carry a non-NULL merchant_raw — see this migration's
  -- header for why the list is three values, not two.
  CHECK (merchant_raw IS NOT NULL OR status IN ('pending', 'extracting', 'failed'))
);

INSERT INTO receipts_new (
  id, merchant_raw, merchant_normalized, store_location, purchased_at,
  subtotal_cents, tax_cents, total_cents, payment_last4, r2_key, status,
  checksum_result, checksum_delta_cents, extraction_model,
  extraction_input_tokens, extraction_output_tokens, extracted_at,
  created_at, updated_at
)
SELECT
  id, merchant_raw, merchant_normalized, store_location, purchased_at,
  subtotal_cents, tax_cents, total_cents, payment_last4, r2_key, status,
  checksum_result, checksum_delta_cents, extraction_model,
  extraction_input_tokens, extraction_output_tokens, extracted_at,
  created_at, updated_at
FROM receipts;

DROP TABLE receipts;

ALTER TABLE receipts_new RENAME TO receipts;

-- Write-once-from-NULL: first write allowed, every subsequent change —
-- including a change back to NULL — aborts. Identical shape to
-- `golden_set_split_write_once` (0001); see this migration's header.
CREATE TRIGGER receipts_merchant_raw_immutable
BEFORE UPDATE OF merchant_raw ON receipts
WHEN OLD.merchant_raw IS NOT NULL AND NEW.merchant_raw IS NOT OLD.merchant_raw
BEGIN
  SELECT RAISE(ABORT, 'receipts.merchant_raw is immutable once set (write-once from NULL): raw receipt text is never overwritten');
END;

-- Dropping `receipts` drops its indexes with it — recreate both, unchanged
-- from 0001.
CREATE INDEX idx_receipts_merchant_date_total
  ON receipts (merchant_normalized, purchased_at, total_cents);

CREATE INDEX idx_receipts_purchased_at ON receipts (purchased_at);

PRAGMA foreign_key_check;
