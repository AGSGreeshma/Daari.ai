# tests/

How we prove Daari actually points at the right thing, instead of hoping.

The idea: save real page snapshots (HTML) together with the element a human
says is correct. A Node script then feeds each snapshot through the same logic
the extension uses and reports two numbers:

1. **Highlight accuracy** — how often Daari picked the correct element.
2. **AI vs fallback ratio** — how often the recipe safety net had to step in.

Built in Phase 7. Run with `node tests/run.js`.
