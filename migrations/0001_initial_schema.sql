-- Stone Soup — initial schema.
--
-- This migration is the brief's data model made structurally unbreakable
-- rather than merely documented (AGENTS.md, Data conventions):
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
--      RAISE(ABORT)s any attempt to change them. `INSERT OR REPLACE`
--      bypasses BEFORE UPDATE triggers entirely (REPLACE is DELETE+INSERT,
--      not UPDATE) and would otherwise delete-and-silently-recreate these
--      rows — see the recursive_triggers pragma and the three
--      `*_no_replace` triggers below, which are what actually close that
--      hole.
--
-- `PRAGMA recursive_triggers = ON` is required for a BEFORE DELETE trigger
-- to fire for the DELETE half of `INSERT OR REPLACE`'s conflict
-- resolution — off (SQLite's default, and what a fresh D1 connection
-- starts with), that DELETE is invisible to triggers and REPLACE silently
-- destroys the row. This must be re-issued on every connection (it is a
-- connection pragma, not stored in the database file), so every code path
-- that opens a raw connection to this database — the migration runner
-- included — must set it before running anything that depends on the
-- guard triggers below.
PRAGMA recursive_triggers = ON;

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
  purchased_at             TEXT CHECK (
                              purchased_at IS NULL
                              OR purchased_at GLOB '????-??-??'
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
  -- (An AFTER UPDATE trigger that re-UPDATEs the same row it fired on is
  -- the usual idiom, but with `recursive_triggers` ON above — required for
  -- the REPLACE guard below — it recurses: the strftime() call inside the
  -- trigger can return the same millisecond it's replacing, the WHEN
  -- guard re-passes, and it loops until SQLite's trigger-depth limit
  -- aborts the statement. Verified empirically; not a hypothetical.) Every
  -- writer that changes a row on this table must set `updated_at` itself.
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
-- never sees it, and an ordinary-looking "upsert" of a receipt silently
-- deletes every line_items/receipt_sources row for it (FK ON DELETE
-- CASCADE) and recreates the receipt with none of them (review round 1,
-- finding 1). This trigger closes that: with `recursive_triggers` ON, a
-- BEFORE DELETE trigger fires for REPLACE's conflict-resolution delete
-- exactly as it would for a direct DELETE, and RAISE(ABORT) rolls back
-- the whole statement — proven against the real reproduction in
-- schema.test.ts. Deliberately unconditional: there is no SQL-level way
-- to tell "delete caused by REPLACE" apart from "delete the application
-- issued on purpose" from inside a trigger, and this table has no
-- legitimate direct-delete path in v1 anyway (no UI or pipeline code
-- deletes a receipt; STON-11's dedupe merge updates and re-points
-- `receipt_sources` rows, it does not delete a `receipts` row). A future
-- ticket that needs to remove a receipt for real needs a soft-delete
-- column, not a rollback of this trigger — and should treat rolling it
-- back as a deliberate, reviewed decision, not a side effect of "the
-- upsert didn't work."
CREATE TRIGGER receipts_no_replace
BEFORE DELETE ON receipts
BEGIN
  SELECT RAISE(ABORT, 'receipts rows cannot be deleted or REPLACEd — this table has no delete path in v1; see the trigger comment in the migration');
END;

-- ---------------------------------------------------------------------
-- receipt_sources — join table linking a receipt to every source it was
-- observed through. The brief lists a "source" column on `receipts` *and*
-- separately requires "one record, multiple source references" for the
-- photo/email dedupe merge (merchant + date + total) — those two cannot
-- both hold. This join table is the accepted resolution (STON-16):
-- `receipts` carries no `source_id`. `external_id` is the Gmail message ID
-- (or equivalent) and its UNIQUE index is re-sync idempotency for free.
-- ---------------------------------------------------------------------
CREATE TABLE receipt_sources (
  id           TEXT PRIMARY KEY,
  receipt_id   TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
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
-- ---------------------------------------------------------------------
CREATE TABLE line_items (
  id                     TEXT PRIMARY KEY,
  receipt_id             TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
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

-- Same REPLACE hole as receipts, same fix, same reasoning — see
-- `receipts_no_replace` above. A line_items row's only legitimate removal
-- path in v1 is a cascade from its parent receipt, and receipts rows are
-- themselves undeletable (see above), so this table has no live
-- direct-delete path either.
CREATE TRIGGER line_items_no_replace
BEFORE DELETE ON line_items
BEGIN
  SELECT RAISE(ABORT, 'line_items rows cannot be deleted or REPLACEd — see the trigger comment in the migration');
END;

-- ---------------------------------------------------------------------
-- review_queue — human review tasks for a line item, one row per surface.
-- A resolved row's verdict is what triggers an immediate golden_set write
-- (application-level, same step — AGENTS.md, House rules).
-- ---------------------------------------------------------------------
CREATE TABLE review_queue (
  id                    TEXT PRIMARY KEY,
  line_item_id          TEXT NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
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

-- Same REPLACE hole as receipts/line_items, same fix. This is the
-- table least tolerant of it: a REPLACE-induced delete-then-reinsert
-- would silently reassign a written `split`, bypassing the write-once
-- trigger above the same way REPLACE bypasses the raw-text triggers.
CREATE TRIGGER golden_set_no_replace
BEFORE DELETE ON golden_set
BEGIN
  SELECT RAISE(ABORT, 'golden_set rows cannot be deleted or REPLACEd — see the trigger comment in the migration');
END;

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

-- FK child indexes for receipt_sources — every ON DELETE CASCADE onto
-- this table (from receipts and from sources) was a full scan without
-- these (review round 1, finding 9).
CREATE INDEX idx_receipt_sources_receipt_id ON receipt_sources (receipt_id);
CREATE INDEX idx_receipt_sources_source_id ON receipt_sources (source_id);

CREATE INDEX idx_golden_set_created_at ON golden_set (created_at);
