/** The extraction contract's output shapes. See schema.ts for the field
 * table these are generated from and parse.ts for the source of truth
 * validator. */

export interface ExtractedLineItem {
  raw_text: string;
  normalized_name: string | null;
  qty: number | null;
  unit_price_cents: number | null;
  extended_price_cents: number | null;
  discount_cents: number | null;
  category: string;
  subcategory: string | null;
  confidence: number | null;
}

export interface ExtractionResult {
  schema_version: number;
  taxonomy_version: string;
  merchant_raw: string;
  merchant_normalized: string | null;
  store_location: string | null;
  purchased_at: string | null;
  subtotal_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  payment_last4: string | null;
  line_items: ExtractedLineItem[];
}
