-- Stone Soup — initial schema.
--
-- This migration is the brief's data model made structurally unbreakable
-- rather than merely documented (AGENTS.md, Data conventions):
--   1. Money is INTEGER cents everywhere — every money column is `*_cents`.
--   2. Dates are ISO 8601 TEXT, enforced by a CHECK on every timestamp
--      column. `strftime('%Y-%m-%dT%H:%M:%fZ','now')` is the only default
--      that satisfies it — `datetime('now')` emits "YYYY-MM-DD HH:MM:SS"
--      and would fail its own column's CHECK.
--   3. Raw receipt text is never overwritten — `line_items.raw_text` and
--      `receipts.merchant_raw` are NOT NULL, and a BEFORE UPDATE trigger
--      RAISE(ABORT)s any attempt to change them.

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
  connected_at      TEXT CHECK (connected_at IS NULL OR connected_at GLOB '????-??-??T*Z'),
  last_synced_at    TEXT CHECK (last_synced_at IS NULL OR last_synced_at GLOB '????-??-??T*Z'),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                       CHECK (created_at GLOB '????-??-??T*Z')
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
  purchased_at             TEXT CHECK (purchased_at IS NULL OR purchased_at GLOB '????-??-??T*Z'),
  subtotal_cents           INTEGER,
  tax_cents                INTEGER,
  total_cents              INTEGER,
  payment_last4            TEXT CHECK (payment_last4 IS NULL OR payment_last4 GLOB '[0-9][0-9][0-9][0-9]'),
  -- Email receipts have no image.
  r2_key                   TEXT,
  status                   TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'extracting', 'extracted', 'needs_review', 'confirmed', 'failed')),
  checksum_result           TEXT NOT NULL DEFAULT 'not_run' CHECK (checksum_result IN ('pass', 'fail', 'not_run')),
  checksum_delta_cents       INTEGER,
  -- Instrumentation (brief: "token usage per receipt"). Nullable so wiring
  -- up the extraction eval harness (STON-12) needs no migration.
  extraction_model          TEXT,
  extraction_input_tokens   INTEGER,
  extraction_output_tokens  INTEGER,
  extracted_at              TEXT CHECK (extracted_at IS NULL OR extracted_at GLOB '????-??-??T*Z'),
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                               CHECK (created_at GLOB '????-??-??T*Z'),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                               CHECK (updated_at GLOB '????-??-??T*Z')
);

-- Raw receipt text is never overwritten (AGENTS.md, Data conventions #3 —
-- "the single most important rule in this file"). Structural, not advisory.
CREATE TRIGGER receipts_merchant_raw_immutable
BEFORE UPDATE OF merchant_raw ON receipts
WHEN NEW.merchant_raw IS NOT OLD.merchant_raw
BEGIN
  SELECT RAISE(ABORT, 'receipts.merchant_raw is immutable: raw receipt text is never overwritten');
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
                 CHECK (ingested_at GLOB '????-??-??T*Z')
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
  unit_price_cents         INTEGER,
  extended_price_cents     INTEGER,
  discount_cents           INTEGER,
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
                               CHECK (created_at GLOB '????-??-??T*Z'),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                               CHECK (updated_at GLOB '????-??-??T*Z'),
  CHECK ((embedding IS NULL) = (embedding_model IS NULL) AND (embedding IS NULL) = (dims IS NULL))
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
                           CHECK (created_at GLOB '????-??-??T*Z'),
  surfaced_at           TEXT CHECK (surfaced_at IS NULL OR surfaced_at GLOB '????-??-??T*Z'),
  resolved_at           TEXT CHECK (resolved_at IS NULL OR resolved_at GLOB '????-??-??T*Z')
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
-- ---------------------------------------------------------------------
CREATE TABLE golden_set (
  id                    TEXT PRIMARY KEY,
  raw_string            TEXT NOT NULL,
  merchant_type         TEXT,
  model_category        TEXT,
  model_subcategory     TEXT,
  model_confidence      REAL,
  verdict               TEXT NOT NULL,
  corrected_category    TEXT,
  corrected_subcategory TEXT,
  labeler               TEXT NOT NULL,
  routing_reason        TEXT,
  taxonomy_version      TEXT NOT NULL,
  -- The golden_set *record* schema version — distinct from this file's D1
  -- migration number.
  schema_version        INTEGER NOT NULL DEFAULT 1,
  -- Assigned once, never changed (write-once trigger below). The held-out
  -- test set is never used for prompt tuning.
  split                 TEXT CHECK (split IS NULL OR split IN ('train', 'val', 'test')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
                           CHECK (created_at GLOB '????-??-??T*Z'),
  submitted_at          TEXT CHECK (submitted_at IS NULL OR submitted_at GLOB '????-??-??T*Z')
);

CREATE TRIGGER golden_set_split_write_once
BEFORE UPDATE OF split ON golden_set
WHEN OLD.split IS NOT NULL AND NEW.split IS NOT OLD.split
BEGIN
  SELECT RAISE(ABORT, 'golden_set.split is write-once: it is assigned once and never changed');
END;

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------

-- STON-11 dedupe merge rule: merchant + date + total. Non-unique — split
-- payments across two receipts for the same purchase are real.
CREATE INDEX idx_receipts_merchant_date_total
  ON receipts (merchant_normalized, purchased_at, total_cents);

CREATE INDEX idx_line_items_receipt_id ON line_items (receipt_id);

-- "This Month" category rollups.
CREATE INDEX idx_line_items_category_status ON line_items (category, status);

-- The ~100-item review queue budget query.
CREATE INDEX idx_review_queue_pending_created_at
  ON review_queue (created_at)
  WHERE resolved_at IS NULL;

-- Gmail message ID (or equivalent) idempotency: a re-sync must not
-- duplicate a receipt_sources row.
CREATE UNIQUE INDEX idx_receipt_sources_external_id
  ON receipt_sources (external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX idx_golden_set_created_at ON golden_set (created_at);
