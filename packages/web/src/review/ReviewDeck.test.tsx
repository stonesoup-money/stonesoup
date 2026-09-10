import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "../api/client.js";
import { ReviewDeck } from "./ReviewDeck.js";

const ITEM_A: ReviewItem = {
  queueId: "q-a",
  reason: "low_confidence",
  rawText: "RAW LINE A",
  category: "produce",
  subcategory: null,
  confidence: 0.5,
  extendedPriceCents: 100,
  merchantRaw: "MART A",
  merchantNormalized: "Mart A",
  purchasedAt: "2026-09-01",
};

const ITEM_B: ReviewItem = { ...ITEM_A, queueId: "q-b", rawText: "RAW LINE B" };

function mockFetchSequence(items: ReviewItem[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/review/next")) {
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    if (url.includes("/verdict")) {
      return new Response(JSON.stringify({ ok: true, goldenSetWritten: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url} ${init?.method}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ReviewDeck", () => {
  it("shows the empty state when there is nothing to review", async () => {
    mockFetchSequence([]);
    render(<ReviewDeck />);
    await waitFor(() => expect(screen.getByText(/nothing needs your eyes/i)).toBeInTheDocument());
  });

  it("renders the first item's raw text", async () => {
    mockFetchSequence([ITEM_A, ITEM_B]);
    render(<ReviewDeck />);
    await waitFor(() => expect(screen.getByText("RAW LINE A")).toBeInTheDocument());
  });

  it("pressing Y submits a confirmed verdict and advances to the next item", async () => {
    const fetchMock = mockFetchSequence([ITEM_A, ITEM_B]);
    render(<ReviewDeck />);
    await waitFor(() => expect(screen.getByText("RAW LINE A")).toBeInTheDocument());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));

    await waitFor(() => expect(screen.getByText("RAW LINE B")).toBeInTheDocument(), {
      timeout: 1000,
    });

    const verdictCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/verdict"));
    if (!verdictCall) throw new Error("expected a /verdict fetch call");
    expect(String(verdictCall[0])).toContain("q-a");
    const body = JSON.parse((verdictCall[1] as RequestInit).body as string);
    expect(body.verdict).toBe("confirmed");
  });
});
