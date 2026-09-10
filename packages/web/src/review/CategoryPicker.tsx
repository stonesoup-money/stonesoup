/**
 * The category picker (AGENTS.md, Design language: the one vendored
 * shadcn/Radix primitive is `Dialog`, used here for the `more` list).
 * Opened by `N` (correct — browse the picker's ordered slugs) or `M`
 * (more — the full taxonomy). Digits `1`-`min(n,9)` (STON-16: picker
 * arity is open, not settled) correct directly without opening this
 * dialog at all — see `useReviewKeys.ts` and `ReviewDeck.tsx`.
 *
 * There is no `DialogTrigger` here: `N`/`M` open the dialog
 * programmatically, so Radix's default close-focus target (whatever was
 * focused when the dialog opened, which on the keyboard path is
 * `document.body`) is wrong. `restoreFocusRef` — the card's "N — Correct"
 * button, threaded down from `ReviewDeck.tsx` — is focused explicitly on
 * close instead, so Escape behaves the same whether the picker was opened
 * by that button or by the keyboard.
 */

import { TAXONOMY, type TaxonomyCategory } from "@stonesoup/core";
import { Dialog, DialogContent, DialogTrigger } from "../components/ui/dialog.js";

export interface CategoryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The full taxonomy when `mode === "more"`, or just the picker's own
   * ordered slug list (via `pickerCategorySlugs`) when `mode === "picker"`. */
  slugs: readonly string[];
  onSelect: (categorySlug: string) => void;
  /** Element to return focus to on close (see the module header). */
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}

function categoryFor(slug: string): TaxonomyCategory | undefined {
  return TAXONOMY.find((c) => c.slug === slug);
}

export function CategoryPicker({
  open,
  onOpenChange,
  slugs,
  onSelect,
  restoreFocusRef,
}: CategoryPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Correct category"
        onCloseAutoFocus={(event) => {
          const target = restoreFocusRef?.current;
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <ul className="ss-dialog-list">
          {slugs.map((slug) => {
            const category = categoryFor(slug);
            return (
              <li key={slug}>
                <button type="button" className="ss-dialog-item" onClick={() => onSelect(slug)}>
                  {category?.label ?? slug}
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export { DialogTrigger as CategoryPickerTrigger };
