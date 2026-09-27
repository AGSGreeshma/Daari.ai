# extension/content/

The part of Daari that runs inside the page the user is on. Think of it as
Daari's **eyes and paintbrush**. It has three jobs:

1. **Serialize** — list the visible buttons, links and boxes on the page.
   Labels only, never the values the user typed.
2. **Point** — draw the glowing highlight and the large caption, inside a
   Shadow DOM so the page's own styles cannot break it.
3. **Verify** — notice when the step is finished, without calling the AI.

It is re-created from scratch on every page load, so it must never be the
place where session state lives.
