# recipes/ — see [extension/recipes/](../extension/recipes/)

**The recipe files live in [`extension/recipes/`](../extension/recipes/), not here.**

They had to move, for one reason: a Chrome extension can only read its own
files. If the recipes were served over HTTP from this repo, then a dead API
would mean no recipes either — and the recipe *is* the safety net for exactly
that case. A fallback that needs the network is not a fallback.

They are not duplicated here, because two copies of the same route would drift
apart and keeping them in step would need a build step, which `CLAUDE.md`
forbids.

## What a recipe is

A **hint and a safety net, not a script.**

The AI reads the live page on every single step and writes the sentence itself.
The recipe is passed to it as a clue about what to look for. The recipe's own
element and its pre-written phrase are used only when the AI's answer is
rejected — on a disagreement about which element, a timeout, a bad response
shape, or low confidence.

That is what makes the demo unbreakable while still being a real voice agent:
unplug the API entirely and the booking still completes, in the user's language,
from the pre-written phrases.

## Shape

```json
{
  "site": "daari-ai.vercel.app/practice",
  "task": "book-ticket",
  "match_phrases": { "te": ["టికెట్"], "hi": ["टिकट"], "en": ["book", "ticket"] },
  "steps": [
    {
      "page": "index",
      "look_for": ["from station"],
      "done_when": "field_filled",
      "sensitive": false,
      "confirm": false,
      "say": { "en": "...", "hi": "...", "te": "..." }
    }
  ]
}
```

| Field | Why it exists |
|---|---|
| `match_phrases` | Matches a spoken goal to this recipe. All languages are checked whatever language is selected, because people mix languages when they speak. |
| `page` | The basename with no `.html`. Lets Daari tell going **back** from going **forward**. |
| `look_for` | Labels, tried in priority order. Steps target elements by name, never by index. |
| `done_when` | `url_changed`, `field_filled`, `value_changed`, `clicked`, `element_gone:name`, `text_appears:text` — all evaluated locally, at no cost. |
| `sensitive` | Changes the wording to "type it yourself". Values are never read regardless. |
| `confirm` | Can only **add** a stop. The real gate is the word list in `extension/safety.js`. |
| `say` | The pre-written fallback phrasing, per language. |

Adding a recipe means dropping the JSON in `extension/recipes/` **and** naming it
in `RECIPE_FILES` in `extension/background.js` — an extension cannot list its own
directory.
