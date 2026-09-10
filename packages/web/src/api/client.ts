/**
 * The SPA's thin fetch wrapper over `/api/*` — no separate frontend host,
 * no CORS (AGENTS.md, "Single deployable"): every call here is a
 * same-origin relative fetch.
 */

export interface UploadReceiptResponse {
  receiptId: string;
  status: string;
}

export async function uploadReceipt(file: File): Promise<UploadReceiptResponse> {
  const formData = new FormData();
  formData.append("receipt", file);
  const res = await fetch("/api/receipts", { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `upload failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchReceiptStatus(receiptId: string): Promise<UploadReceiptResponse> {
  const res = await fetch(`/api/receipts/${receiptId}`);
  if (!res.ok) {
    throw new Error(`status check failed: ${res.status}`);
  }
  return res.json();
}

export interface ReviewItem {
  queueId: string;
  reason: string;
  rawText: string;
  category: string;
  subcategory: string | null;
  confidence: number | null;
  extendedPriceCents: number | null;
  merchantRaw: string | null;
  merchantNormalized: string | null;
  purchasedAt: string | null;
}

export async function fetchNextReviewItems(limit = 20): Promise<ReviewItem[]> {
  const res = await fetch(`/api/review/next?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`review fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as { items: ReviewItem[] };
  return body.items;
}

export type VerdictKind = "confirmed" | "corrected" | "skipped";

export interface SubmitVerdictBody {
  verdict: VerdictKind;
  correctedCategory?: string;
  correctedSubcategory?: string;
}

export async function submitVerdict(queueId: string, body: SubmitVerdictBody): Promise<void> {
  const res = await fetch(`/api/review/${queueId}/verdict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`verdict submission failed: ${res.status}`);
  }
}
