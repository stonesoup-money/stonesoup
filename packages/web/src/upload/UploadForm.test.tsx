import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UploadForm } from "./UploadForm.js";

describe("UploadForm", () => {
  it("uploads a selected file and shows the returned status", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/receipts")) {
        return new Response(JSON.stringify({ receiptId: "r1", status: "pending" }), {
          status: 202,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<UploadForm />);
    const input = screen.getByLabelText(/upload a receipt photo/i) as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], "receipt.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/status: pending/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalled();
  });

  it("shows an error message when the upload fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "unsupported content type" }), { status: 400 }),
      ),
    );

    render(<UploadForm />);
    const input = screen.getByLabelText(/upload a receipt photo/i) as HTMLInputElement;
    const file = new File([new Uint8Array([1])], "receipt.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText(/unsupported content type/i)).toBeInTheDocument());
  });

  it("a second upload clears the first upload's poll interval instead of leaking it", async () => {
    // Regression for: pollStatus() overwrote pollHandle.current without
    // clearing the previous interval, so the first receipt's poll ran
    // forever, calling setStatus with its (old) status on every tick and
    // racing the second receipt's poll.
    vi.useFakeTimers();
    try {
      const statusCalls: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/receipts")) {
          const receiptId = statusCalls.includes("uploaded-r1") ? "r2" : "r1";
          statusCalls.push(`uploaded-${receiptId}`);
          return new Response(JSON.stringify({ receiptId, status: "pending" }), { status: 202 });
        }
        if (url.endsWith("/api/receipts/r1")) {
          statusCalls.push("polled-r1");
          return new Response(JSON.stringify({ status: "failed" }), { status: 200 });
        }
        if (url.endsWith("/api/receipts/r2")) {
          statusCalls.push("polled-r2");
          return new Response(JSON.stringify({ status: "needs_review" }), { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<UploadForm />);
      const input = screen.getByLabelText(/upload a receipt photo/i) as HTMLInputElement;

      const file1 = new File([new Uint8Array([1])], "receipt1.jpg", { type: "image/jpeg" });
      await fireEvent.change(input, { target: { files: [file1] } });
      await vi.waitFor(() => expect(statusCalls).toContain("uploaded-r1"));

      // Upload a second file before the first receipt's poll has ever
      // ticked — with the leak, both intervals would now be running.
      const file2 = new File([new Uint8Array([2])], "receipt2.jpg", { type: "image/jpeg" });
      await fireEvent.change(input, { target: { files: [file2] } });
      await vi.waitFor(() => expect(statusCalls).toContain("uploaded-r2"));

      await vi.advanceTimersByTimeAsync(2000);

      expect(statusCalls).not.toContain("polled-r1");
      expect(statusCalls).toContain("polled-r2");
      expect(screen.getByText(/status: needs_review/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
