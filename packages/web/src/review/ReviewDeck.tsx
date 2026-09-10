/**
 * The review deck (STON-2 tracer bullet; STON-8 widens: swipe, undo,
 * empty/onboarding states, the key legend as its own component). Fetches
 * `GET /api/review/next`, renders one `ReviewCard` at a time, and wires
 * `useReviewKeys` — `Y` confirm, `N` open the picker, digits `1`-`min(n,9)`
 * quick-correct, `M` more, `S` skip.
 */

import { pickerCategorySlugs, TAXONOMY } from "@stonesoup/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchNextReviewItems,
  type ReviewItem,
  submitVerdict,
  VerdictConflictError,
} from "../api/client.js";
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

export interface ReviewDeckProps {
  /** Bumped by `App.tsx` when an upload's poll reaches a terminal status,
   * so the deck re-fetches without a manual page reload closing the
   * tracer's end-to-end loop. */
  reloadSignal?: unknown;
}

export function ReviewDeck({ reloadSignal }: ReviewDeckProps = {}) {
  const [items, setItems] = useState<ReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSlugs, setPickerSlugs] = useState<readonly string[]>(PICKER_SLUGS);
  const correctButtonRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(() => {
    fetchNextReviewItems()
      .then(setItems)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    // `reloadSignal` has no value read in the body above — it exists
    // purely to force this effect to re-run when `App.tsx` bumps it after
    // an upload's poll reaches a terminal status. `void` documents that
    // as a deliberate dependency, not a mistaken one useExhaustiveDependencies
    // would otherwise report as unnecessary.
    void reloadSignal;
    load();
  }, [load, reloadSignal]);

  const current = items && items.length > 0 ? items[0] : undefined;

  const advanceTo = useCallback((mutate: (prev: ReviewItem[]) => ReviewItem[]) => {
    setAdvancing(true);
    setTimeout(() => {
      setItems((prev) => (prev ? mutate(prev) : prev));
      setAdvancing(false);
      // Round 2, finding 6: this used to clear in each handler's `.then()`,
      // the moment the network response came back — well before `current`
      // actually changes here. A second `Y` in that window passed the
      // `!submitting` guard and double-submitted the same `queueId`. The
      // guard is only actually closed by keeping `submitting` true for the
      // *entire* at-risk window: the request AND this advance.
      setSubmitting(false);
    }, ADVANCE_ANIMATION_MS);
  }, []);

  const dropCurrent = useCallback(() => {
    advanceTo((prev) => prev.slice(1));
  }, [advanceTo]);

  // No in-flight guard here previously meant a second keypress in the
  // window between the POST firing and `dropCurrent`'s `ADVANCE_ANIMATION_MS`
  // advance would submit a second verdict for the same `queueId` (`current`
  // does not change until the advance completes) — e.g. `S` then `Y`, the
  // input that reaches the golden-set gap guarded against server-side in
  // `verdict.ts`. `submitting` gates every entry point: the keyboard
  // handlers below via `useReviewKeys`'s `enabled`, and the card's button
  // `onClick`s via the early return in each handler.
  // Round 2, finding 6: a 409 means the server's already-resolved guard
  // (`verdict.ts`) rejected this submission — the queue item is already
  // resolved, whether by the race this guard now closes or by another
  // client entirely. The right recovery is to advance past it like a
  // normal success, not to replace the whole deck with a fatal error
  // banner via `setError`.
  const handleVerdictError = useCallback(
    (err: Error) => {
      if (err instanceof VerdictConflictError) {
        dropCurrent();
        return;
      }
      setSubmitting(false);
      setError(err.message);
    },
    [dropCurrent],
  );

  const handleConfirm = useCallback(() => {
    if (!current || submitting) return;
    setSubmitting(true);
    submitVerdict(current.queueId, { verdict: "confirmed" }).then(dropCurrent, handleVerdictError);
  }, [current, submitting, dropCurrent, handleVerdictError]);

  const handleSkip = useCallback(() => {
    if (!current || submitting) return;
    setSubmitting(true);
    submitVerdict(current.queueId, { verdict: "skipped" }).then(dropCurrent, handleVerdictError);
  }, [current, submitting, dropCurrent, handleVerdictError]);

  const handleCorrect = useCallback(
    (categorySlug: string) => {
      if (!current || submitting) return;
      setSubmitting(true);
      setPickerOpen(false);
      submitVerdict(current.queueId, {
        verdict: "corrected",
        correctedCategory: categorySlug,
      }).then(dropCurrent, handleVerdictError);
    },
    [current, submitting, dropCurrent, handleVerdictError],
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
        enabled: !!current && !pickerOpen && !submitting,
        onConfirm: handleConfirm,
        onOpenPicker: openPicker,
        onCorrectToIndex: handleCorrectToIndex,
        onMore: openMore,
        onSkip: handleSkip,
      }),
      [
        current,
        pickerOpen,
        submitting,
        handleConfirm,
        openPicker,
        handleCorrectToIndex,
        openMore,
        handleSkip,
      ],
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
        correctButtonRef={correctButtonRef}
      />
      <CategoryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        slugs={pickerSlugs}
        onSelect={handleCorrect}
        restoreFocusRef={correctButtonRef}
      />
    </div>
  );
}
