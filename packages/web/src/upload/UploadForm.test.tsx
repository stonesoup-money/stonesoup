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
});
