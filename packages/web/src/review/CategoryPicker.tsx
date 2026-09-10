/**
 * The category picker (AGENTS.md, Design language: the one vendored
 * shadcn/Radix primitive is `Dialog`, used here for the `more` list).
 * Opened by `N` (correct — browse the picker's ordered slugs) or `M`
 * (more — the full taxonomy). Digits `1`-`min(n,9)` (STON-16: picker
 * arity is open, not settled) correct directly without opening this
 * dialog at all — see `useReviewKeys.ts` and `ReviewDeck.tsx`.
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
}

function categoryFor(slug: string): TaxonomyCategory | undefined {
  return TAXONOMY.find((c) => c.slug === slug);
}

export function CategoryPicker({ open, onOpenChange, slugs, onSelect }: CategoryPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Correct category">
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
