-- Stone Soup — initial schema.
--
-- This migration makes as much of the brief's data model structurally
-- enforced as SQLite/D1 allow, rather than merely documented (AGENTS.md,
-- Data conventions) — it is not a claim that every rule here is
-- unbreakable at the database layer. Money shapes, date shapes, and
-- raw-text immutability where a trigger can see the write (an UPDATE) are
-- genuinely enforced by the database. `INSERT OR REPLACE` is the
-- exception: it is DELETE+INSERT, invisible to a BEFORE UPDATE trigger,
-- and D1 gives no way to tell its delete apart from a real one, so
-- `golden_set` (unconditionally), and `line_items`/`receipts`/`sources`
-- whenever the specific row being replaced happens to have nothing
-- referencing it, have no DB-level defense against it at all — see part
-- (b) below and `scripts/verify-no-replace.mjs`, which is what actually
-- stops those cases.
--   1. Money is INTEGER cents everywhere — every money column is `*_cents`,
--      and a CHECK on each one rejects anything SQLite's INTEGER affinity
--      would otherwise silently accept unconverted (e.g. a REAL like
--      `12.34` — affinity only converts a REAL that round-trips losslessly
--      to INTEGER; a lossy one is stored as-is).
--   2. Dates are ISO 8601 TEXT, enforced by a CHECK on every timestamp
--      column. `strftime('%Y-%m-%dT%H:%M:%fZ','now')` is the only default
--      that satisfies it — `datetime('now')` emits "YYYY-MM-DD HH:MM:SS"
--      and would fail its own column's CHECK. `purchased_at` is the one
--      exception with a second accepted shape — see its column comment.
--   3. Raw receipt text is never overwritten — `line_items.raw_text` and
--      `receipts.merchant_raw` are NOT NULL, and a BEFORE UPDATE trigger
--      RAISE(ABORT)s any attempt to change them.
--
-- **`INSERT OR REPLACE` / `REPLACE INTO` is banned outright (AGENTS.md),
-- not merely guarded — review round 2, finding 1.** An earlier version of
-- this migration tried to close the REPLACE hole with
-- `PRAGMA recursive_triggers = ON` plus three unconditional `BEFORE DELETE`
-- guard triggers (`receipts_no_replace`, `line_items_no_replace`,
-- `golden_set_no_replace`). That pragma lives in the sqlite3 **connection**
-- struct, not the database file, so it is never persisted: every fresh
-- connection to a real D1 database — i.e. every Worker request in
-- production — starts with it OFF (D1's default), and the guard triggers
-- silently never fired. Verified against a real local D1 connection,
-- separate from the process that ran the migration: `PRAGMA
-- recursive_triggers` read back `0` after `wrangler d1 migrations apply`,
-- and `INSERT OR REPLACE INTO line_items` rewrote `raw_text` with no error.
-- The three guard triggers only appeared to work because the Vitest
-- harness's migration runner and the test suite shared one Miniflare
-- connection — an artifact of the test setup that does not exist in
-- production. There is also no SQL-level way to tell "DELETE caused by
-- REPLACE's conflict resolution" apart from an ordinary DELETE from inside
-- a trigger, so no trigger-based fix is possible here. The real defense is
-- two-layered instead:
--   a. `ON DELETE RESTRICT` (not CASCADE) on every FK a REPLACE-induced
--      delete would otherwise cascade through — pragma-independent
--      (verified: a cascade still ran with `recursive_triggers` off), so
--      it fires in production exactly as it does in tests. It turns
--      `INSERT OR REPLACE INTO receipts` (or `sources`, or `line_items`
--      when a `review_queue` row references it) into a loud FK failure
--      whenever the row has children referencing it — not whenever it
--      "has anything to lose" in general. A *childless* row has nothing
--      for RESTRICT to attach to and is not protected by it at all: e.g.
--      `INSERT OR REPLACE INTO receipts` on a receipt with no line items
--      or receipt_sources still succeeds and silently rewrites its
--      immutable `merchant_raw`, bypassing `receipts_merchant_raw_immutable`
--      the same way it bypasses everything else REPLACE bypasses (lock-in
--      test: `packages/worker/src/schema.test.ts`, "REPLACE on a childless
--      receipts row"). This layer leaves an explicit path for a real
--      delete feature later.
--   b. `INSERT OR REPLACE` / `REPLACE INTO` is banned in application code
--      by AGENTS.md and caught at author time by a grep gate in
--      `pnpm check` (`scripts/verify-no-replace.mjs`) — the one thing that
--      actually stops it on `line_items` (when nothing in `review_queue`
--      references it) and `golden_set` (unconditionally: it has no FK to
--      restrict against at all), and the only defense at all for a
--      childless `receipts`/`sources` row's own immutable/idempotency
--      data as in (a) above.
-- See `packages/worker/src/schema.test.ts` for the reproduction against a
-- real D1 binding.

-- ---------------------------------------------------------------------
-- sources — one row per ingestion source (a connected Gmail account, or
-- the photo-upload path) a user has set up.
-- ---------------------------------------------------------------------
CREATE TABLE sources (
  id                TEXT PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('gmail', 'photo')),
  auth_state        TEXT NOT NULL CHECK (auth_state IN ('connected', 'needs_reconnect', 'disconnected', 'not_applicable')),
  external_account  TEXT,
  gmail_history_id  TEXT,
  last_error        TEXT,
  connected_at      TEXT CHECK (connected_at IS NULL OR connected_at GLOB '????-??-??T??:??:??*Z'),
  last_synced_at    TEXT CHECK (last_synced_at IS NULL OR last_synced_at GLOB '????-??-??T??:??:??*Z'),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                       CHECK (created_at GLOB '????-??-??T??:??:??*Z')
);

-- ---------------------------------------------------------------------
-- receipts — one row per purchase, merged across sources (see
-- receipt_sources below). merchant_raw is the raw parse and is
-- write-once; merchant_normalized is a separate derived column.
-- ---------------------------------------------------------------------
CREATE TABLE receipts (
  id                       TEXT PRIMARY KEY,
  merchant_raw             TEXT NOT NULL,
  merchant_normalized      TEXT,
  store_location           TEXT,
  -- Either a full ISO 8601 timestamp or a date-only YYYY-MM-DD. A printed
  -- receipt carries a local date, not a time and never a timezone —
  -- photo receipts and order-confirmation emails routinely give us only
  -- that date, and it is the evidence, so a date-only value is stored
  -- exactly as printed rather than fabricating a time or a UTC offset
  -- that was never on the receipt (STON-16 / review round 1, finding 4).
  -- "This Month" and every other date-bucketed read buckets on this
  -- printed value, not on a derived instant.
  -- The date-only shape uses `[0-9]` digit classes, not `?` wildcards
  -- (review round 2, finding 8): `?` matches any character, so
  -- `????-??-??` accepted non-digit garbage like `'abcd-ef-gh'`. The
  -- full-timestamp shape below is already pinned down by its literal `T`
  -- and `:`/`Z` characters (round 1, finding 15's repro), so it does not
  -- need the same tightening.
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
  -- Instrumentation (brief: "token usage per receipt"). Nullable so wiring
  -- up the extraction eval harness (STON-12) needs no migration.
  extraction_model          TEXT,
  extraction_input_tokens   INTEGER,
  extraction_output_tokens  INTEGER,
  extracted_at              TEXT CHECK (extracted_at IS NULL OR extracted_at GLOB '????-??-??T??:??:??*Z'),
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                               CHECK (created_at GLOB '????-??-??T??:??:??*Z'),
  -- Caller-maintained, not automatic: no trigger bumps this on UPDATE.
  -- Simpler and more explicit than an AFTER UPDATE trigger that re-UPDATEs
  -- the row it fired on — every writer that changes a row on this table
  -- must set `updated_at` itself. (An earlier version of this comment
  -- justified this via a `recursive_triggers = ON` pragma this migration
  -- no longer sets — see the migration header, review round 2, finding 1
  -- — so that reasoning no longer applies; the caller-maintained design
  -- stands on its own regardless.)
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                               CHECK (updated_at GLOB '????-??-??T??:??:??*Z')
);

-- Raw receipt text is never overwritten (AGENTS.md, Data conventions #3 —
-- "the single most important rule in this file"). Structural, not advisory.
CREATE TRIGGER receipts_merchant_raw_immutable
BEFORE UPDATE OF merchant_raw ON receipts
WHEN NEW.merchant_raw IS NOT OLD.merchant_raw
BEGIN
  SELECT RAISE(ABORT, 'receipts.merchant_raw is immutable: raw receipt text is never overwritten');
END;

-- `INSERT OR REPLACE` is DELETE+INSERT, not UPDATE — the trigger above
-- never sees it. Review round 1, finding 1 proved that an ordinary-looking
-- "upsert" of a receipt silently deletes every line_items/receipt_sources
-- row for it and recreates the receipt with none of them; round 1's fix
-- (a `recursive_triggers`-gated BEFORE DELETE trigger here) turned out to
-- be inert in production (review round 2, finding 1 — see the migration
-- header). The real defense now is `line_items.receipt_id` and
-- `receipt_sources.receipt_id` both being `ON DELETE RESTRICT` below: a
-- REPLACE-induced delete of a `receipts` row with any children fails the
-- FK check loudly instead of cascading them away silently, and the
-- pnpm check grep gate stops the statement from being written at all.

-- ---------------------------------------------------------------------
-- receipt_sources — join table linking a receipt to every source it was
-- observed through. The brief lists a "source" column on `receipts` *and*
-- separately requires "one record, multiple source references" for the
-- photo/email dedupe merge (merchant + date + total) — those two cannot
-- both hold. This join table is the accepted resolution (STON-16):
-- `receipts` carries no `source_id`. `external_id` is the Gmail message ID
-- (or equivalent) and its UNIQUE index is re-sync idempotency for free.
--
-- Both FKs are `ON DELETE RESTRICT`, not CASCADE (review round 2, finding
-- 3): `sources` has no guard against `INSERT OR REPLACE`, and unlike
-- `receipts`/`line_items`/`golden_set` no trigger-based approach was ever
-- attempted for it either, because FK cascade actions are not gated by
-- `recursive_triggers` at all — verified: a REPLACE-induced cascade still
-- ran with the pragma off. `INSERT OR REPLACE INTO sources` used to
-- silently delete every idempotency record for that source; Gmail
-- reconnect (STON-4/STON-6) is exactly the code path most likely to write
-- that statement. RESTRICT makes it fail loudly instead. A source
-- disconnect is `UPDATE sources SET auth_state = 'disconnected'`, which is
-- what that enum value exists for — not a delete.
-- ---------------------------------------------------------------------
CREATE TABLE receipt_sources (
  id           TEXT PRIMARY KEY,
  receipt_id   TEXT NOT NULL REFERENCES receipts(id) ON DELETE RESTRICT,
  source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
  external_id  TEXT,
  ingested_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                 CHECK (ingested_at GLOB '????-??-??T??:??:??*Z')
);

-- ---------------------------------------------------------------------
-- line_items — one row per receipt line. raw_text is write-once; category
-- is a separate derived column, never mixed into raw_text.
-- The embedding block ships nullable and unpopulated: novelty routing
-- (lever 3) is phase 2, so enabling it later is a backfill, not a
-- migration (AGENTS.md, Data conventions #7).
--
-- `receipt_id` is `ON DELETE RESTRICT`, not CASCADE (review round 2,
-- finding 3) — see the migration header and the receipt_sources comment
-- above for why RESTRICT, not a trigger, is the defense that actually
-- fires in production.
-- ---------------------------------------------------------------------
CREATE TABLE line_items (
  id                     TEXT PRIMARY KEY,
  receipt_id             TEXT NOT NULL REFERENCES receipts(id) ON DELETE RESTRICT,
  line_number             INTEGER,
  raw_text                TEXT NOT NULL,
  normalized_name          TEXT,
  qty                      REAL,
  unit_price_cents         INTEGER CHECK (unit_price_cents IS NULL OR typeof(unit_price_cents) = 'integer'),
  extended_price_cents     INTEGER CHECK (extended_price_cents IS NULL OR typeof(extended_price_cents) = 'integer'),
  discount_cents           INTEGER CHECK (discount_cents IS NULL OR typeof(discount_cents) = 'integer'),
  category                 TEXT,
  subcategory              TEXT,
  confidence               REAL CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  taxonomy_version         TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending_review'
                              CHECK (status IN ('pending_review', 'auto_confirmed', 'confirmed', 'corrected')),
  -- Versioned embedding block (STON-7, phase 2). Nullable and unpopulated
  -- from day one; the CHECK below makes a half-populated row impossible.
  embedding                BLOB,
  embedding_model          TEXT,
  embedding_version        TEXT,
  dims                     INTEGER,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                               CHECK (created_at GLOB '????-??-??T??:??:??*Z'),
  -- Caller-maintained, not automatic — same reasoning as receipts.updated_at above.
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                               CHECK (updated_at GLOB '????-??-??T??:??:??*Z'),
  CHECK (
    (embedding IS NULL) = (embedding_model IS NULL)
    AND (embedding IS NULL) = (embedding_version IS NULL)
    AND (embedding IS NULL) = (dims IS NULL)
  )
);

-- Raw receipt text is never overwritten — see the receipts trigger above
-- for the same rule. This is the golden set's input; overwriting it
-- destroys the dataset the product exists to build.
CREATE TRIGGER line_items_raw_text_immutable
BEFORE UPDATE OF raw_text ON line_items
WHEN NEW.raw_text IS NOT OLD.raw_text
BEGIN
  SELECT RAISE(ABORT, 'line_items.raw_text is immutable: raw receipt text is never overwritten');
END;

-- ---------------------------------------------------------------------
-- review_queue — human review tasks for a line item, one row per surface.
-- A resolved row's verdict is what triggers an immediate golden_set write
-- (application-level, same step — AGENTS.md, House rules).
--
-- `line_item_id` is `ON DELETE RESTRICT`, not CASCADE (round 3 polish
-- pass, extending review round 2, finding 3's fix to the fourth FK it
-- missed) — CASCADE meant `INSERT OR REPLACE INTO line_items` silently
-- deleted every review_queue row for that item, resolved verdicts
-- included: verified out-of-harness, a `verdict = 'corrected'` row (real
-- human labelling work, the product's stated point) went from 1 to 0 with
-- no error. RESTRICT makes that REPLACE fail loudly instead, the same way
-- it already does for receipts/sources/line_items' own receipt_id FK. A
-- line_items row with no review_queue row referencing it is still
-- unprotected by this — see the migration header and
-- `scripts/verify-no-replace.mjs`, the only defense left in that case.
-- ---------------------------------------------------------------------
CREATE TABLE review_queue (
  id                    TEXT PRIMARY KEY,
  line_item_id          TEXT NOT NULL REFERENCES line_items(id) ON DELETE RESTRICT,
  reason                TEXT NOT NULL
                           CHECK (reason IN ('low_confidence', 'random_audit', 'novelty', 'user_flagged', 'checksum_fail', 'bootstrap')),
  verdict               TEXT CHECK (verdict IS NULL OR verdict IN ('confirmed', 'corrected', 'skipped')),
  corrected_category    TEXT,
  corrected_subcategory TEXT,
  labeler               TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                           CHECK (created_at GLOB '????-??-??T??:??:??*Z'),
  surfaced_at           TEXT CHECK (surfaced_at IS NULL OR surfaced_at GLOB '????-??-??T??:??:??*Z'),
  resolved_at           TEXT CHECK (resolved_at IS NULL OR resolved_at GLOB '????-??-??T??:??:??*Z')
);

-- ---------------------------------------------------------------------
-- golden_set — the anonymized, publishable labeled dataset (Open
-- Receipts). The anonymization boundary is enforced by the absence of
-- columns: there is no receipt_id, no user_id, no store, no purchase
-- timestamp, no image reference, here or anywhere this table can be
-- joined to reach one. Do not add one "for debugging" — that is the
-- boundary this table exists to hold. Golden-set rows are intentionally
-- disconnected from `receipts`/`line_items`, so they survive any cascade
-- delete on those tables.
--
-- `labeler` is the one exception, and it is deliberate, not an oversight:
-- it is a real internal identifier, kept for quality control, and is
-- pseudonymized only at export time (decisions.md) — never nulled here.
--
-- Constrained at least as tightly as its `review_queue` source (review
-- round 1, finding 11): this table is a published CC0 dataset, the one
-- place a typo'd enum is least recoverable.
-- ---------------------------------------------------------------------
CREATE TABLE golden_set (
  id                    TEXT PRIMARY KEY,
  raw_string            TEXT NOT NULL,
  merchant_type         TEXT,
  model_category        TEXT,
  model_subcategory     TEXT,
  model_confidence      REAL CHECK (model_confidence IS NULL OR (model_confidence BETWEEN 0 AND 1)),
  verdict               TEXT NOT NULL CHECK (verdict IN ('confirmed', 'corrected', 'skipped')),
  corrected_category    TEXT,
  corrected_subcategory TEXT,
  labeler               TEXT NOT NULL,
  routing_reason        TEXT
                           CHECK (routing_reason IS NULL OR routing_reason IN ('low_confidence', 'random_audit', 'novelty', 'user_flagged', 'checksum_fail', 'bootstrap')),
  taxonomy_version      TEXT NOT NULL,
  -- The golden_set *record* schema version — distinct from this file's D1
  -- migration number.
  schema_version        INTEGER NOT NULL DEFAULT 1,
  -- Assigned once, never changed (write-once trigger below). The held-out
  -- test set is never used for prompt tuning.
  split                 TEXT CHECK (split IS NULL OR split IN ('train', 'val', 'test')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                           CHECK (created_at GLOB '????-??-??T??:??:??*Z'),
  submitted_at          TEXT CHECK (submitted_at IS NULL OR submitted_at GLOB '????-??-??T??:??:??*Z')
);

CREATE TRIGGER golden_set_split_write_once
BEFORE UPDATE OF split ON golden_set
WHEN OLD.split IS NOT NULL AND NEW.split IS NOT OLD.split
BEGIN
  SELECT RAISE(ABORT, 'golden_set.split is write-once: it is assigned once and never changed');
END;

-- `golden_set` has no FK to any other table by design (the anonymization
-- boundary above) — there is nothing here for `ON DELETE RESTRICT` to
-- attach to, and no trigger can distinguish REPLACE's delete from a real
-- one (see migration header). A REPLACE-induced delete-then-reinsert would
-- silently reassign a written `split`, bypassing the write-once trigger
-- above the same way REPLACE bypasses the raw-text triggers elsewhere —
-- this table depends entirely on the `INSERT OR REPLACE` ban being
-- enforced at author time (AGENTS.md; `pnpm check`'s grep gate) rather
-- than at the database layer, and review round 2, finding 1 is explicit
-- that no SQL construct on D1 changes that.

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------

-- STON-11 dedupe merge rule: merchant + date + total. Non-unique — split
-- payments across two receipts for the same purchase are real.
CREATE INDEX idx_receipts_merchant_date_total
  ON receipts (merchant_normalized, purchased_at, total_cents);

-- "This Month" and every other date-range read filters on purchased_at
-- alone; the composite index above leads with merchant_normalized and
-- cannot serve that scan (review round 1, finding 8).
CREATE INDEX idx_receipts_purchased_at ON receipts (purchased_at);

CREATE INDEX idx_line_items_receipt_id ON line_items (receipt_id);

-- "This Month" category rollups, and the brief's "percent classified" /
-- pending-count metric, which filters on status alone — leads with
-- status so that predicate can use the index too (review round 1,
-- finding 10; renamed from idx_line_items_category_status to match).
CREATE INDEX idx_line_items_status_category ON line_items (status, category);

-- The ~100-item review queue budget query.
CREATE INDEX idx_review_queue_pending_created_at
  ON review_queue (created_at)
  WHERE resolved_at IS NULL;

-- The review verdict write path: line item -> its queue row. No FK child
-- index existed for this at all (review round 1, finding 9).
CREATE INDEX idx_review_queue_line_item_id ON review_queue (line_item_id);

-- Gmail message ID (or equivalent) idempotency: a re-sync must not
-- duplicate a receipt_sources row.
CREATE UNIQUE INDEX idx_receipt_sources_external_id
  ON receipt_sources (external_id)
  WHERE external_id IS NOT NULL;

-- FK child indexes for receipt_sources — every FK action onto this table
-- (from receipts and from sources; RESTRICT as of review round 2, finding
-- 3 — see the table comment above) was a full scan without these (review
-- round 1, finding 9).
CREATE INDEX idx_receipt_sources_receipt_id ON receipt_sources (receipt_id);
CREATE INDEX idx_receipt_sources_source_id ON receipt_sources (source_id);

CREATE INDEX idx_golden_set_created_at ON golden_set (created_at);
