/**
 * The photo upload node's UI (STON-2 tracer bullet; STON-5 widens:
 * HEIC/multi-page, client-side downscale, progress, resumable upload).
 * `<input type="file" accept="image/jpeg,image/png" capture="environment">`
 * posts to `POST /api/receipts`, then polls `GET /api/receipts/:id` for
 * status. No router: `App.tsx` renders this above the review deck,
 * mobile-first single column.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchReceiptStatus, uploadReceipt } from "../api/client.js";
import "./upload.css";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES = new Set(["extracted", "needs_review", "confirmed", "failed"]);

export function UploadForm({ onSettled }: { onSettled?: () => void } = {}) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollHandle = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollHandle.current) clearInterval(pollHandle.current);
    };
  }, []);

  const pollStatus = useCallback(
    (receiptId: string) => {
      pollHandle.current = setInterval(async () => {
        try {
          const result = await fetchReceiptStatus(receiptId);
          setStatus(result.status);
          if (TERMINAL_STATUSES.has(result.status) && pollHandle.current) {
            clearInterval(pollHandle.current);
            pollHandle.current = null;
            onSettled?.();
          }
        } catch {
          // A transient poll failure is not fatal — the next tick retries.
        }
      }, POLL_INTERVAL_MS);
    },
    [onSettled],
  );

  const handleChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setError(null);
      try {
        const { receiptId, status: initialStatus } = await uploadReceipt(file);
        setStatus(initialStatus);
        pollStatus(receiptId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        event.target.value = "";
      }
    },
    [pollStatus],
  );

  return (
    <div className="upload-form">
      <label htmlFor="receipt-upload">Upload a receipt photo</label>
      <input
        id="receipt-upload"
        className="upload-form__input"
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        onChange={handleChange}
      />
      {status && <p className="upload-form__status">Status: {status}</p>}
      {error && <p className="upload-form__status upload-form__status--error">{error}</p>}
    </div>
  );
}
