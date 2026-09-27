# recipes/

One JSON file per website task — a known-good list of steps for a common flow,
e.g. booking a train ticket.

A recipe is a **hint and a safety net, not a script**. The AI still reads the
live page on every step. The recipe is passed to the AI as a clue about what to
look for, and if the AI times out or picks the wrong element, Daari falls back
to the recipe's own element and a pre-written sentence. That is why the demo
cannot break.

Shape (filled in during Phase 6):

    {
      "site": "...", "task": "...",
      "steps": [
        { "look_for": ["From", "Origin"],
          "say": { "te": "...", "hi": "...", "en": "..." },
          "done_when": "field_filled",
          "confirm": false }
      ]
    }
