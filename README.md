# Stone Soup

A self-hostable personal finance tool that answers line-item-level spending
questions transaction-level tools can't ("how much on vegetables vs
alcohol?"). It ingests receipts from Gmail and photo upload, extracts line
items with a vision model, normalizes them against a fixed taxonomy, and
exposes the data via an MCP server you query from Claude. AGPL-3.0.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/stonesoup-money/stonesoup)

The button provisions D1, R2, Queues and Workers AI from `wrangler.jsonc`,
prompts for your own `ANTHROPIC_API_KEY` (see `.dev.vars.example` — it's
yours, we never see it), and runs the migration before deploying.

Full README (the Stone Soup tale, screenshots, self-hosting walkthrough) is
STON-15. This scaffolding ticket (STON-3) lands the workspace, D1 schema,
CI, and BYOK validator that everything else builds on.
