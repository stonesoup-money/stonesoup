/**
 * The one vendored shadcn/Radix primitive (AGENTS.md, Design language):
 * Radix's `Dialog` gives the category picker real focus management and
 * keyboard nav (Escape closes and returns focus to the trigger) for
 * free — hand-rolling a focus trap is the worse option, and that is the
 * stated reason shadcn/Radix is in this repo at all. Everything else in
 * the review flow is plain elements. Themed with `dialog.css`'s Stone
 * Soup tokens — never shadcn's default zinc look (Review invariant 8).
 */

import * as RadixDialog from "@radix-ui/react-dialog";
import "./dialog.css";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;

export function DialogContent({
  title,
  children,
  onCloseAutoFocus,
}: {
  title: string;
  children: React.ReactNode;
  /** Forwarded to Radix's `Content.onCloseAutoFocus` — the picker uses this
   * to restore focus to the card's "N — Correct" button regardless of
   * whether the dialog was opened by clicking that button or by the `N`/`M`
   * keyboard shortcuts (which leave `document.activeElement` on `body`,
   * Radix's default close-focus target otherwise). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="ss-dialog-overlay" />
      <RadixDialog.Content
        className="ss-dialog-content"
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <RadixDialog.Title className="ss-dialog-title">{title}</RadixDialog.Title>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
