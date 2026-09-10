import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReviewItem } from "../api/client.js";
import { ReviewCard } from "./ReviewCard.js";

const ITEM: ReviewItem = {
  queueId: "q1",
  reason: "low_confidence",
  rawText: "ORG BANANAS  1.24 LB @ .79/LB  ",
  category: "produce",
  subcategory: null,
  confidence: 0.5,
  extendedPriceCents: 98,
  merchantRaw: "TRADER JOE'S #123",
  merchantNormalized: "Trader Joe's",
  purchasedAt: "2026-09-10",
};

describe("ReviewCard", () => {
  it("renders the raw line exactly as printed — case, doubled interior spaces, trailing whitespace", () => {
    const { container } = render(
      <ReviewCard
        item={ITEM}
        advancing={false}
        onConfirm={() => {}}
        onOpenPicker={() => {}}
        onSkip={() => {}}
      />,
    );
    // textContent, not a fuzzy matcher — must be byte-identical to the raw string.
    expect(container.querySelector(".review-card__raw")?.textContent).toBe(ITEM.rawText);
  });

  it("renders the extended price as formatted money", () => {
    render(
      <ReviewCard
        item={ITEM}
        advancing={false}
        onConfirm={() => {}}
        onOpenPicker={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByText("$0.98")).toBeInTheDocument();
  });

  it("Confirm button fires onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ReviewCard
        item={ITEM}
        advancing={false}
        onConfirm={onConfirm}
        onOpenPicker={() => {}}
        onSkip={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/Confirm/));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("Correct button fires onOpenPicker, Skip fires onSkip", () => {
    const onOpenPicker = vi.fn();
    const onSkip = vi.fn();
    render(
      <ReviewCard
        item={ITEM}
        advancing={false}
        onConfirm={() => {}}
        onOpenPicker={onOpenPicker}
        onSkip={onSkip}
      />,
    );
    fireEvent.click(screen.getByText(/Correct/));
    fireEvent.click(screen.getByText(/Skip/));
    expect(onOpenPicker).toHaveBeenCalledOnce();
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("applies the advancing class only when advancing is true — motion only on verdict", () => {
    const { container, rerender } = render(
      <ReviewCard
        item={ITEM}
        advancing={false}
        onConfirm={() => {}}
        onOpenPicker={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(container.querySelector(".review-card--advancing")).toBeNull();
    rerender(
      <ReviewCard
        item={ITEM}
        advancing={true}
        onConfirm={() => {}}
        onOpenPicker={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(container.querySelector(".review-card--advancing")).not.toBeNull();
  });
});
