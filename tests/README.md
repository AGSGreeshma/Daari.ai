# tests/

How we prove Daari points at the right thing, instead of hoping.

There are two harnesses, and the difference matters:

| Command | Costs | What it proves |
|---|---|---|
| `npm test` | **nothing** | The decision logic: the validation gate, the confirm gate, recipe matching, navigation, the budget cap, rule 2. Runs the real extension files against a fake browser and a fake model. |
| `npm run eval` | **~31 API calls** | Whether the *actual model* picks the right element on *actual pages*. |
| `npm run eval:dry` | nothing | Checks the cases and snapshots line up, without calling anything. Run this first. |

`npm test` is the one to run constantly. `npm run eval` is the one that produces
the numbers for the deck.

## The four numbers that matter

**AI accuracy** — did the model pick the right element with no help at all?

**Final accuracy** — what Daari *actually pointed at*, after the validation gate
threw out answers it did not trust. This is the number the user experiences, and
it should be higher than AI accuracy. The gap between the two *is* the argument
for the recipe fallback existing.

**Gate accuracy** — did Daari stop before every dangerous button, and never stop
when nothing was dangerous? A missed stop is the worst failure in the whole
system. A false stop is merely annoying.

**"I am not sure" accuracy** — on five goals that nothing on the page could
accomplish, did Daari decline rather than guess? For this audience a confident
wrong instruction is worse than no instruction: they will not second-guess
Daari, so if it points at the wrong button they will press the wrong button.

Plus **payloads with no user values**, which is not a score. Anything below 100%
is a bug.

## Capturing snapshots

`tests/snapshots/` is empty in a fresh clone, because snapshots come from a real
browser rather than from a fixture somebody typed. Capture them once:

1. Load the extension and open <https://daari-ai.vercel.app/practice/>
2. Click the Daari icon → **Save page snapshot**
3. The file lands in `Downloads/daari-snapshots/`. Move it to `tests/snapshots/`
4. Repeat on each page as you walk the booking

You need seven, named exactly as the button names them:

| File | Where to capture it |
|---|---|
| `index.json` | the search page |
| `results.json` | after pressing Search Trains |
| `passenger.json` | after pressing Book, **before** pressing Send OTP |
| `passenger-otp.json` | same page, **after** Send OTP (the button detects the code and names the file for you) |
| `payment.json` | after Continue to Payment |
| `confirmation.json` | after Pay |
| `pnr.json` | the PNR Status page |

Then `npm run eval:dry` will tell you if any are missing or misnamed.

**A snapshot contains labels only** — never anything typed. The snapshot button
runs the same rule-2 check as every other payload and refuses rather than
capturing a value. That is why it is safe to commit them to a public repo even
though one was taken with a one-time code on screen.

## The cases

`tests/cases/` holds 31 cases in four files, grouped rather than one file each:

- **`book-ticket.json`** — the booking walk in Telugu, Hindi and English
- **`check-pnr.json`** — the second recipe, including a mixed Telugu-English goal
- **`traps.json`** — the hard ones, with **no recipe hint**: the `age`/`Packages`
  collision, the icon-only ⓘ button, the unlabelled Mobile field, the Pay gate
- **`no-recipe.json`** — five goals nothing on the page can do

Expected element names are matched with Daari's *own* scorer at 80 or better, not
compared exactly — so `Pay` matches `Pay ₹378` and the test does not break when
the fare changes.

## Outputs

- `results.json` — every case, raw. Committed, so a run can be compared to the last.
- `report.html` — open it in Chrome and screenshot it. Built to be legible on a
  slide: one hero figure, a row of stat tiles, and the full case table underneath
  so any number can be checked against a row.
