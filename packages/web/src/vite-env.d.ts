/// <reference types="vite/client" />

// Vite's own client.d.ts declares ambient modules for common asset types
// but not the generic `?raw` query suffix used by
// legal-docs-drift.test.ts (STON-13) to import the committed docs/*.md
// files as plain strings for the doc-drift check.
declare module "*.md?raw" {
  const content: string;
  export default content;
}
