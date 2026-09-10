/**
 * The review deck (STON-2 tracer bullet; STON-8 widens: swipe, undo,
 * empty/onboarding states, the key legend as its own component). Fetches
 * `GET /api/review/next`, renders one `ReviewCard` at a time, and wires
 * `useReviewKeys` — `Y` confirm, `N` open the picker, digits `1`-`min(n,9)`
 * quick-correct, `M` more, `S` skip.
 */

import { pickerCategorySlugs, TAXONOMY } from "@stonesoup/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchNextReviewItems, type ReviewItem, submitVerdict } from "../api/client.js";
import { CategoryPicker } from "./CategoryPicker.js";
import "./review.css";
import { ReviewCard } from "./ReviewCard.js";
import { useReviewKeys } from "./useReviewKeys.js";

// The tracer has no per-user usage history to rank by yet — an empty
// count map falls back to pickerCategorySlugs' documented seed order
// (STON-16: picker arity is open, not settled).
const PICKER_SLUGS = pickerCategorySlugs({});
const FULL_TAXONOMY_SLUGS = TAXONOMY.map((c) => c.slug);
const ADVANCE_ANIMATION_MS = 160;

export function ReviewDeck() {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSlugs, setPickerSlugs] = useState<readonly string[]>(PICKER_SLUGS);

  const load = useCallback(() => {
    fetchNextReviewItems()
      .then(setItems)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const current = items && items.length > 0 ? items[0] : undefined;

  const advanceTo = useCallback((mutate: (prev: ReviewItem[]) => ReviewItem[]) => {
    setAdvancing(true);
    setTimeout(() => {
      setItems((prev) => (prev ? mutate(prev) : prev));
      setAdvancing(false);
    }, ADVANCE_ANIMATION_MS);
  }, []);

  const dropCurrent = useCallback(() => {
    advanceTo((prev) => prev.slice(1));
  }, [advanceTo]);

  const handleConfirm = useCallback(() => {
    if (!current) return;
    submitVerdict(current.queueId, { verdict: "confirmed" })
      .then(dropCurrent)
      .catch((err: Error) => setError(err.message));
  }, [current, dropCurrent]);

  const handleSkip = useCallback(() => {
    if (!current) return;
    submitVerdict(current.queueId, { verdict: "skipped" })
      .then(dropCurrent)
      .catch((err: Error) => setError(err.message));
  }, [current, dropCurrent]);

  const handleCorrect = useCallback(
    (categorySlug: string) => {
      if (!current) return;
      setPickerOpen(false);
      submitVerdict(current.queueId, { verdict: "corrected", correctedCategory: categorySlug })
        .then(dropCurrent)
        .catch((err: Error) => setError(err.message));
    },
    [current, dropCurrent],
  );

  const handleCorrectToIndex = useCallback(
    (index: number) => {
      const slug = PICKER_SLUGS[index];
      if (slug) handleCorrect(slug);
    },
    [handleCorrect],
  );

  const openPicker = useCallback(() => {
    setPickerSlugs(PICKER_SLUGS);
    setPickerOpen(true);
  }, []);

  const openMore = useCallback(() => {
    setPickerSlugs(FULL_TAXONOMY_SLUGS);
    setPickerOpen(true);
  }, []);

  useReviewKeys(
    useMemo(
      () => ({
        enabled: !!current && !pickerOpen,
        onConfirm: handleConfirm,
        onOpenPicker: openPicker,
        onCorrectToIndex: handleCorrectToIndex,
        onMore: openMore,
        onSkip: handleSkip,
      }),
      [current, pickerOpen, handleConfirm, openPicker, handleCorrectToIndex, openMore, handleSkip],
    ),
  );

  if (error) {
    return (
      <div className="review-deck">
        <p className="review-empty">Couldn't load the review queue: {error}</p>
      </div>
    );
  }

  if (items === null) {
    return (
      <div className="review-deck">
        <p className="review-empty">Loading…</p>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="review-deck">
        <p className="review-empty">Nothing needs your eyes right now.</p>
      </div>
    );
  }

  return (
    <div className="review-deck">
      <ReviewCard
        item={current}
        advancing={advancing}
        onConfirm={handleConfirm}
        onOpenPicker={openPicker}
        onSkip={handleSkip}
      />
      <CategoryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        slugs={pickerSlugs}
        onSelect={handleCorrect}
      />
    </div>
  );
}
