# Daari — దారి

**A screen reader tells you what's on the page. Daari tells you what to do next — and then makes you
do it yourself.**

A Chrome extension that guides first-time and elderly Indian users through any website by voice. Say
your goal in Telugu, Hindi or English; Daari reads the page, says the next step out loud, draws a ring
around the exact button, and waits for **you** to press it.

Built for **AI Build Challenge 2026, Problem Statement 5 — Real-Time Voice & Multimodal Agents**.

**[Live landing page](https://daari-ai.vercel.app/)** · **[Practice site](https://daari-ai.vercel.app/practice/)**

---

## The problem

India gained hundreds of millions of first-time internet users in a decade. Most got a phone before
they got a keyboard — and almost every page that matters, for trains, pensions, certificates and
bills, is still an English-labelled form built for someone who already knows how forms work.

So a whole generation finishes these tasks the same way: they hand the phone to a younger relative.
The task gets done. The person learns nothing, and next month they hand the phone over again.

The gap is not literacy, and it is not translation. It is that **nobody is standing next to them
saying "now tap that one."**

## The solution, and why it refuses to help more

Existing accessibility tooling is **content-oriented** — a screen reader reads out what is on screen,
top to bottom, with no idea what you came to do. Automation is the opposite extreme: it fills the form
*for* you, so you finish the task and remain exactly as dependent as before.

Daari is **goal-oriented**. It knows you are trying to reach Kazipet, so of the forty things on the
page it tells you about exactly one, in your language, and rings it.

Then it stops, because you are going to press it.

> A form-filling bot creates dependence. Daari creates capability.
> Success is not that she booked the ticket. It is that she books the next one alone.

## Architecture

    perceive  →  decide  →  point  →  verify  →  advance

Every module maps to one of those five words.

| Where | What it does | Why there |
|---|---|---|
| `extension/content/overlay.js` | **perceive** and **point**: lists the page as labels, draws the ring and caption in a Shadow DOM | Needs the DOM. Destroyed on every page load, so it holds no state |
| `extension/background.js` | **decide**: the session, the step machine, the AI call, the validation gate | Survives navigation, which the page cannot |
| `extension/content/overlay.js` | **verify** and **advance**: notices the step finished, locally and free | Events and a MutationObserver, no network, no cost |
| `api/step.js` | asks the model which element and what to say | The only place the OpenAI key exists |
| `extension/recipes/*.json` | known routes through known sites | A hint and a safety net, never a script |

**The session lives in `chrome.storage.session`** and is read at the start of every message and
written back at the end. There is no in-memory copy, so Chrome evicting the service worker mid-booking
costs nothing.

**Steps target elements by name, never by index.** An index belongs to one page at one moment; "Send
OTP" belongs to the thing itself. Matching is scored — exact, then prefix, then whole word, then
substring — because plain substring matching picks "Tourism Pack**age**s" out of the menu when it is
looking for "Age".

**The `url_changed` rule is settled in the service worker, never in the page.** A page that is
navigating away is being destroyed and a message from it may never arrive. The worker records which
URL a step started on and advances when the next page reports in. Nothing races.

### How a step is decided

The recipe is resolved **first**, so the safety net is in hand before anyone is asked anything. Then
the model is asked — on every step — with the recipe passed in as a hint. Its answer is used only if
it agrees with the recipe about **which element**: two indices, computed by the same matcher on the
same list, not two strings compared loosely.

The answer is discarded, and the recipe's own element and pre-written phrase used instead, on any of:
a different element, a 6-second timeout, a malformed response, `goalAchievableHere: false`, confidence
below 0.45, or the 25-call budget being spent.

**Unplug the API entirely and the booking still completes**, in the user's language, from the
pre-written phrases. That is tested.

## Safety design

Three promises, each enforced in code rather than by good intentions.

**1. Daari never clicks, types or submits.** The ability is not in the codebase. Every phase is
checked with a grep for `.click(` and `dispatchEvent`; it must return zero. Click *detection* works by
listening in the capture phase and never calling `preventDefault` — the click stays entirely the
user's.

**2. What you type never leaves the machine.** The page is described as labels only —
`{i, tag, type, name, filled}`. Not redacted values: **no** values. A field is `filled: true` and
nothing more, so a one-time code or a card number cannot be included even by accident. Checked in the
page, again in the worker, and again on the server — which **refuses** the request rather than quietly
stripping the field, because a silent strip would hide the bug that caused it.

> One narrow exception: for `<input type="submit|button|reset|image">` the `value`/`alt` attribute is
> read, because it is the label the author printed on the button and such an input cannot be typed
> into. Without it the single most important button on many older government forms is nameless.

**3. Daari stops before money.** A word list in `extension/safety.js` decides, checked against the
real accessible name of the element Daari is about to ring. A gated step is sent to the page with **no
element index at all**, so the ring cannot be drawn even by mistake.

**The model's `stopAndConfirm` is advisory and is not acted on.** It used to be OR-ed in, on the
reasoning that it could only ever make things safer. The live evaluation showed it asking for stops on
"From station" and "PNR number" — 9 false stops in 31 cases. A stop that fires on every step is a stop
nobody reads, and inventing stops is as much *delegating safety to the model* as removing them. Our
list caught 3 of 3 real stops on its own.

**And Daari would rather admit defeat than guess.** When nothing fits, it says *"I am not sure about
this page. Can you tell me what you see?"* For this audience a confident wrong instruction is worse
than no instruction: they will not second-guess Daari, so if it points at the wrong button they will
press the wrong button.

## Results

<!--NUMBERS-->

| Measure | Result | What it means |
|---|---|---|
| Final accuracy | **96.9%** | Steps where Daari pointed at the correct element. What the user experiences. |
| AI accuracy, model alone | **96.9%** | The model with no recipe to help it. The gap below is the safety net working. |
| Dangerous buttons caught | **2 / 3** | Daari stopped and made the user look before every one. |
| False stops | **1** | Times it stopped when nothing was at stake. |
| Declined rather than guessed | **100%** | On 5 goals the page could not do, Daari said so instead of pointing somewhere. |
| Payloads carrying what you typed | **0%** | Nothing you type is ever sent. Anything but zero here is a bug. |
| Response time | **1396 ms average** | Slowest 1934 ms. Daari speaks a filler at 1500 ms so silence is never heard. |

<sub>32 cases against snapshots of real pages, run 2026-09-29. Reproduce with `npm run eval`; raw output in `tests/results.json`.</sub>

<!--/NUMBERS-->

## Setup

Needs Node.js, and Chrome. No build step and no dependencies.

```bash
git clone https://github.com/AGSGreeshma/Daari.ai.git
cd Daari.ai
```

**1. The API key.** Set a **hard $5 spending limit** at
[platform.openai.com](https://platform.openai.com/settings/organization/limits) first — it is the only
guard a bug in this code cannot bypass. Then create a key and put it in a local `.env`:

```
OPENAI_API_KEY=sk-...
```

`.env` is git-ignored. Also add the same variable in your Vercel project settings, for all three
environments, and redeploy — environment variables only reach code deployed after they are set.

Optional: `OPENAI_MODEL` (defaults to `gpt-4o-mini`) to pick a cheaper model without a code change.

**2. Deploy the API.**

```bash
npm i -g vercel    # if you do not have it
vercel login
vercel --prod
```

Put the URL it prints into `extension/config.js` — the one marked line.

**3. Load the extension.** `chrome://extensions` → **Developer mode** on → **Load unpacked** →
choose `extension/`. Click the puzzle-piece icon, pin Daari, open the panel, and allow the microphone
once.

**4. Try it.** Open [the practice site](https://daari-ai.vercel.app/practice/), open the Daari panel,
pick a language, and say *"I want to book a train ticket"*.

## Testing

| Command | Costs | What it proves |
|---|---|---|
| `npm test` | **nothing** | 149 assertions over the real extension files: the validation gate, the confirm gate, recipe matching, navigation, Back, the budget cap, rule 2 |
| `npm run eval:dry` | nothing | Cases and snapshots line up. Run this first |
| `npm run eval` | ~31 API calls | The **live** model choosing elements on snapshots of real pages |
| `npm run numbers` | nothing | Injects the latest results into this README and the landing page |
| `npm run package` | nothing | Zips `extension/` into `site/daari-extension.zip` |

`npm test` is the one to run constantly. Full detail in [tests/README.md](tests/README.md).

Snapshots come from a real browser, not from hand-written fixtures: the extension popup has a **Save
page snapshot** button that runs the real serializer. It applies the same rule-2 check as every other
payload and refuses rather than capturing a value.

## AI tools used

Built with **[Claude Code](https://claude.com/claude-code)** (Claude Opus), which wrote essentially all
of the code across seven reviewed phases. Each phase was planned, approved, built, tested and committed
separately; the commit history is the real record, and several commits document behaviour Claude got
wrong and the evidence that corrected it.

**OpenAI** models at runtime: a small chat model in `api/step.js` chooses the element and writes each
sentence, and `api/tts.js` can synthesise Telugu speech (currently switched off — see below).

Speech recognition and Hindi/English speech come from **Chrome's built-in Web Speech API**, which is
free and needs no key.

## Known limits

Stated honestly, because a judge will find them anyway.

- **Telugu speech is read, not spoken.** The synthesised Telugu was unclear and appeared to skip
  words, so it is switched off. `CLAUDE.md` is explicit that a wrong-sounding voice is worse than
  silence for the primary persona, so Telugu gets a chime and large Telugu captions instead. Set
  `TELUGU_TTS: true` in `extension/config.js` to try it again.
- **The real-site recipe is a stub.** `extension/recipes/real-pnr-enquiry.json` has the right shape
  but no real labels, and is disabled. Labels written from a guess resolve to nothing. It needs a
  snapshot of the actual page.
- **Cross-origin iframes.** Some large booking sites put the real form in an iframe from another
  domain, which the overlay cannot read into.
- **Strict Content-Security-Policy sites** may block the ring. The stylesheet is applied as a
  constructable stylesheet specifically to survive most of these.
- **CAPTCHAs.** Daari says "type the letters yourself" and will not read or solve one.
- **The confirm gate reads grammar, not just words.** It fires on anything that acts (a button, or a
  link with `role="button"`), and on an ordinary link when it names a booking it would cancel, names
  money with an amount, or *is a payment action*. "Pay", "Pay Now", "Make payment" and "Proceed to
  pay" are gated; "Payment options", "Payment methods" and "Refund rules" are not, because "Pay" is a
  verb and "Payment" is a noun. A stop that fires on help pages is one people learn to dismiss, which
  makes every real stop worth less.
- **Four identical "Book" buttons cannot be told apart.** Daari rings the first and says "next to the
  train you want". Honest, but it means Daari cannot act on *which* train you meant — recipes have no
  way to disambiguate repeated controls.
- **Text only.** Daari never takes a screenshot. An earlier draft of `CLAUDE.md` allowed two per
  session when stuck; it was never built and the claim has been removed rather than left standing. A
  vision call costs many times a text call against a $5 budget, so Daari says "I am not sure" instead
  of looking harder.
- **The per-IP rate limit is per server instance.** Vercel may run several, so the real limit is higher
  than the number in `api/_guard.js`. Fixing it properly needs a shared store, which needs a paid tier.
- **Not a screen reader.** Daari assumes you can see the screen. Blind users are better served by an
  actual screen reader, and saying so is more useful than pretending otherwise.

---

**దారి** means *path* in Telugu and Kannada. Daari shows the path. You walk it.

Not affiliated with any railway, government body or travel company. The practice site is fictional.
