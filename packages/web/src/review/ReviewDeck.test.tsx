import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("a second Y within the advance animation window does not double-submit the same queueId (round 2, finding 6)", async () => {
    const fetchMock = mockFetchSequence([ITEM_A, ITEM_B]);
    render(<ReviewDeck />);
    await waitFor(() => expect(screen.getByText("RAW LINE A")).toBeInTheDocument());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));
    // Well inside the 160ms advance animation, but after React has
    // committed `submitting: true` — this is exactly the window round 1's
    // guard claimed to close and didn't: `submitting` used to clear the
    // moment the network response came back, well before `current` (and
    // so the queueId a second `Y` would submit against) actually changed.
    await new Promise((resolve) => setTimeout(resolve, 20));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));

    await waitFor(() => expect(screen.getByText("RAW LINE B")).toBeInTheDocument(), {
      timeout: 1000,
    });

    const verdictCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/verdict"),
    );
    expect(verdictCalls).toHaveLength(1);
  });

  it("a 409 on verdict submission advances past the item instead of showing a fatal error (round 2, finding 6)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/review/next")) {
        return new Response(JSON.stringify({ items: [ITEM_A, ITEM_B] }), { status: 200 });
      }
      if (url.includes("/verdict")) {
        return new Response(JSON.stringify({ error: "already-resolved" }), { status: 409 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ReviewDeck />);
    await waitFor(() => expect(screen.getByText("RAW LINE A")).toBeInTheDocument());

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));

    await waitFor(() => expect(screen.getByText("RAW LINE B")).toBeInTheDocument(), {
      timeout: 1000,
    });
    expect(screen.queryByText(/couldn't load the review queue/i)).not.toBeInTheDocument();
  });

  it("Escape from a keyboard-opened picker returns focus to the Correct button, not <body>", async () => {
    // CategoryPicker has no DialogTrigger — `N` opens it programmatically,
    // so document.activeElement is <body> at the moment it opens, which is
    // Radix's default close-focus target. `restoreFocusRef` (wired through
    // ReviewDeck -> CategoryPicker -> dialog.tsx's onCloseAutoFocus) exists
    // so Escape lands back on the "N — Correct" button instead, the same
    // place clicking that button to open the picker would already restore
    // to.
    mockFetchSequence([ITEM_A]);
    render(<ReviewDeck />);
    await waitFor(() => expect(screen.getByText("RAW LINE A")).toBeInTheDocument());

    const correctButton = screen.getByRole("button", { name: /N — Correct/i });
    expect(document.activeElement).not.toBe(correctButton);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(correctButton));
  });
});
