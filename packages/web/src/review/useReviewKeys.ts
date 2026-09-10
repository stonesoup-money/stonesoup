/**
 * The review deck's keyboard bindings — one table, no key literal
 * elsewhere (AGENTS.md, Design language). `Y` confirm, `N` open picker,
 * digits `1`-`min(n,9)` correct to the picker's nth slug (`@stonesoup/core`'s
 * `pickerCategorySlugs` — digits run out at nine), `M` more, `S` skip.
 */

import { useEffect } from "react";

export interface ReviewKeyHandlers {
  enabled: boolean;
  onConfirm: () => void;
  onOpenPicker: () => void;
  /** 0-based index into the picker's ordered slug list — digit `1` maps
   * to index 0, and only digits 1-9 are ever bound (the picker never
   * reaches for `0` or a modifier). */
  onCorrectToIndex: (index: number) => void;
  onMore: () => void;
  onSkip: () => void;
}

const DIGIT_KEY_RE = /^[1-9]$/;

export function useReviewKeys(handlers: ReviewKeyHandlers): void {
  useEffect(() => {
    if (!handlers.enabled) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      switch (event.key.toLowerCase()) {
        case "y":
          handlers.onConfirm();
          return;
        case "n":
          handlers.onOpenPicker();
          return;
        case "m":
          handlers.onMore();
          return;
        case "s":
          handlers.onSkip();
          return;
      }
      if (DIGIT_KEY_RE.test(event.key)) {
        handlers.onCorrectToIndex(Number(event.key) - 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
