// Placeholder: the review inbox and "This Month" page are later epics
// (STON-8, STON-15 area). This proves the SPA build and Vitest project are
// wired — the design-language pass lands with the token stylesheet (STON-2).
export function App() {
  return (
    <main>
      <h1>Stone Soup</h1>
      <p>Scaffolding in place. The review inbox lands in a later ticket.</p>
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
