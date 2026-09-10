/**
 * The review card (AGENTS.md, Design language: "the review card is
 * custom-built, not a themed shadcn `Card`. It is the one bold element —
 * receipt strip, mono raw line on thermal white, perforated top edge,
 * verdict stamps"). Purely presentational: `ReviewDeck.tsx` owns state,
 * fetching, and the keyboard bindings.
 *
 * The raw line renders **exactly as printed** — exact case, mono,
 * untrimmed, `white-space: pre-wrap` (AGENTS.md: "title-casing, trimming,
 * or prettifying a raw string for display is a bug"). Money is mono and
 * tabular, right-aligned (`--numeric-tabular`).
 */

import { formatCents } from "@stonesoup/core";
import type { ReviewItem } from "../api/client.js";
import "./review.css";

export interface ReviewCardProps {
  item: ReviewItem;
  advancing: boolean;
  onConfirm: () => void;
  onOpenPicker: () => void;
  onSkip: () => void;
}

const REASON_LABELS: Record<string, string> = {
  checksum_fail: "Checksum failed",
  low_confidence: "Low confidence",
  bootstrap: "Needs a first look",
};

export function ReviewCard({ item, advancing, onConfirm, onOpenPicker, onSkip }: ReviewCardProps) {
  return (
    <div className={`review-card${advancing ? " review-card--advancing" : ""}`}>
      <div className="review-card__perforation" aria-hidden="true" />
      <div className="review-card__body">
        <div className="review-card__meta">
          <span className="review-card__merchant">{item.merchantRaw ?? "Unknown merchant"}</span>
          <span>{item.purchasedAt ?? "—"}</span>
        </div>
        <div className="review-card__raw">{item.rawText}</div>
        <div className="review-card__row">
          <span className="review-card__category">
            {item.category}
            {item.subcategory ? ` / ${item.subcategory}` : ""}
          </span>
          <span className="review-card__money">
            {item.extendedPriceCents !== null ? formatCents(item.extendedPriceCents) : "—"}
          </span>
        </div>
        <p className="review-card__reason">{REASON_LABELS[item.reason] ?? item.reason}</p>
      </div>
      <div className="review-card__actions">
        <button
          type="button"
          className="review-card__button review-card__button--confirm"
          onClick={onConfirm}
        >
          Y — Confirm
        </button>
        <button
          type="button"
          className="review-card__button review-card__button--correct"
          onClick={onOpenPicker}
        >
          N — Correct
        </button>
        <button type="button" className="review-card__button" onClick={onSkip}>
          S — Skip
        </button>
      </div>
      <p className="review-card__legend">
        Keys: Y confirm · N correct · 1–9 quick-correct · M more categories · S skip
      </p>
    </div>
  );
}
