import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { PLACEHOLDER_USER_ID } from "../auth/session.js";

const DB = env.DB;

function buildFormData(bytes: Uint8Array, type: string, filename = "receipt.png"): FormData {
  const fd = new FormData();
  fd.append("receipt", new File([bytes], filename, { type }));
  return fd;
}

describe("GET /api/receipts/:id (status poll for UploadForm.tsx)", () => {
  it("returns the current status of a receipt", async () => {
    const bytes = new Uint8Array([1]);
    const uploadRes = await SELF.fetch("https://example.com/api/receipts", {
      method: "POST",
      body: buildFormData(bytes, "image/jpeg"),
    });
    const { receiptId } = await uploadRes.json<{ receiptId: string }>();

    const res = await SELF.fetch(`https://example.com/api/receipts/${receiptId}`);
    expect(res.status).toBe(200);
    const body = await res.json<{ receiptId: string; status: string }>();
    expect(body.status).toBe("pending");
  });

  it("404s for an unknown receipt id", async () => {
    const res = await SELF.fetch(`https://example.com/api/receipts/${crypto.randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/receipts (STON-2 tracer bullet photo upload)", () => {
  it("accepts a PNG, stores it in R2 at the documented key, and inserts a pending receipt with merchant_raw NULL", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const res = await SELF.fetch("https://example.com/api/receipts", {
      method: "POST",
      body: buildFormData(bytes, "image/png"),
    });
    expect(res.status).toBe(202);
    const body = await res.json<{ receiptId: string; status: string }>();
    expect(body.status).toBe("pending");
    expect(body.receiptId).toBeTruthy();

    const row = await DB.prepare(`SELECT merchant_raw, status, r2_key FROM receipts WHERE id = ?`)
      .bind(body.receiptId)
      .first<{ merchant_raw: string | null; status: string; r2_key: string }>();
    if (!row) throw new Error("expected a receipts row");
    expect(row.merchant_raw).toBeNull();
    expect(row.status).toBe("pending");
    expect(row.r2_key).toMatch(
      new RegExp(`^${PLACEHOLDER_USER_ID}/\\d{4}/\\d{2}/${body.receiptId}$`),
    );

    const object = await env.RECEIPTS.get(row.r2_key);
    if (!object) throw new Error("expected an R2 object");
    const stored = new Uint8Array(await object.arrayBuffer());
    expect([...stored]).toEqual([...bytes]);

    const sourceLink = await DB.prepare(
      `SELECT source_id FROM receipt_sources WHERE receipt_id = ?`,
    )
      .bind(body.receiptId)
      .first<{ source_id: string }>();
    expect(sourceLink?.source_id).toBe(`photo:${PLACEHOLDER_USER_ID}`);
  });

  it("rejects a non-image content type", async () => {
    const res = await SELF.fetch("https://example.com/api/receipts", {
      method: "POST",
      body: buildFormData(new Uint8Array([1]), "text/plain"),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a request with no file field", async () => {
    const res = await SELF.fetch("https://example.com/api/receipts", {
      method: "POST",
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a file over the upload cap", async () => {
    const { RECEIPT_UPLOAD_MAX_BYTES } = await import("@stonesoup/core");
    const bytes = new Uint8Array(RECEIPT_UPLOAD_MAX_BYTES + 1);
    const res = await SELF.fetch("https://example.com/api/receipts", {
      method: "POST",
      body: buildFormData(bytes, "image/jpeg"),
    });
    expect(res.status).toBe(413);
  });

  it("two uploads share the same deterministic photo source row (ON CONFLICT DO NOTHING)", async () => {
    const bytes = new Uint8Array([9, 9]);
    const first = await SELF.fetch("https://example.com/api/receipts", {
      method: "POST",
      body: buildFormData(bytes, "image/jpeg"),
    });
    const second = await SELF.fetch("https://example.com/api/receipts", {
      method: "POST",
      body: buildFormData(bytes, "image/jpeg"),
    });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);

    const sources = await DB.prepare(`SELECT COUNT(*) as c FROM sources WHERE id = ?`)
      .bind(`photo:${PLACEHOLDER_USER_ID}`)
      .first<{ c: number }>();
    expect(sources?.c).toBe(1);
  });
});
