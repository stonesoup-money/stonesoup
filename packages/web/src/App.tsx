import { useCallback, useState } from "react";
import { ReviewDeck } from "./review/ReviewDeck.js";
import { UploadForm } from "./upload/UploadForm.js";

/**
 * The tracer bullet's SPA shell (STON-2). No router yet — STON-8 adds
 * routing, the app shell, and "This Month". Mobile-first single column:
 * upload above the review deck.
 *
 * `reloadSignal` closes the tracer's own end-to-end loop: without it, a
 * photo that finishes extraction and lands in the review queue only shows
 * up in the deck below after a manual page reload, because `UploadForm`'s
 * poll and `ReviewDeck`'s mount-only fetch never talk to each other.
 */
export function App() {
  const [reloadSignal, setReloadSignal] = useState(0);
  const handleUploadSettled = useCallback(() => setReloadSignal((n) => n + 1), []);

  return (
    <main>
      <h1>Stone Soup</h1>
      <UploadForm onSettled={handleUploadSettled} />
      <ReviewDeck reloadSignal={reloadSignal} />
      {/* STON-13: makes the public legal pages discoverable from the app's
       * own home page — Google's verification later wants that, and it's
       * a real link a real user should have anyway. */}
      <footer>
        <a href="/privacy">Privacy Policy</a>
        {" · "}
        <a href="/terms">Terms of Service</a>
        {" · "}
        <a href="/data-promise">The Data Promise</a>
      </footer>
    </main>
  );
}
