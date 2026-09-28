# Daari — operating brief

**A screen reader tells you what's on the page. Daari tells you what to do next — and then makes you do it yourself.**

Daari is a Chrome extension that guides first-time and elderly Indian users through any website by
voice. The user says their goal (Telugu, Hindi or English). Daari reads the page, says the next step
out loud, and draws a glowing highlight on the exact button or box. It notices when the step is done
and moves on.

Built for AI Build Challenge 2026, Problem Statement 5 (Real-Time Voice & Multimodal Agents).
**Deadline: 1 Oct 2026, 11:59 PM IST.**

See `VISION.md` for who this is for and why. This file is the working brief.

## What Daari is not

Not a screen reader. Not autofill. Not a chatbot. Not RPA. Not a form-filler.

Existing tools are *content-oriented* — they read out what is on screen. Daari is *goal-oriented* —
it knows what the user is trying to achieve. Bots that fill forms create dependence; Daari creates
capability. She books her second ticket alone.

## The core loop

    perceive → decide → point → verify → advance

Every module maps to one of those five words. If a piece of code doesn't, question why it exists.

## Hard rules

1. **Daari never clicks, types or submits for the user.** It only points and speaks. This is the
   product, not a limitation.
2. **Never send any user-entered value to the AI.** Send only a field's label, type and
   `filled: true|false`. Not "redact the sensitive ones" — send *no* typed values at all, ever. One
   rule, nothing to get wrong, and Daari can still tell whether a box has been filled.

   **The one exception**, and it is narrow: for `<input type="submit|button|reset|image">`, the
   `value` (or `alt`) attribute may be read, because it is the label the page author printed on the
   button and such an input cannot be typed into at all. Without it, the single most important button
   on many older government forms comes back nameless. Everything else keeps its value unread, and a
   button input always reports `filled: false` — a button is not a box. Enforced in
   `accessibleName()` / `isFilled()` in `extension/content/overlay.js` via one explicit list of
   those four types. If you widen that list, you have broken rule 2.
3. **Safety rules are enforced in code, never delegated to the model.** The stop-before-payment gate
   fires on a keyword check in our own code. The model's `stopAndConfirm` flag can only ever *add* a
   stop, never remove one.
4. **Before payment, final submit or cancel-confirm, Daari stops** and asks the user to check the
   details, and waits for spoken confirmation.
5. **The OpenAI key lives only in Vercel environment variables or a local `.env`.** Never in the
   extension, never committed. `api/` is the only code that may touch it.
6. **Budget is $5 total.** Smallest mini model, text-only by default, screenshots only when stuck
   (max 2 per session), hard cap of 25 AI steps per session. A $5 hard limit is also set in the
   OpenAI dashboard — the only guard a bug in our code cannot bypass.
7. **Free tiers only.** No paid services.

## The failure voice

When confidence is low or the page is unrecognised, Daari says:

> "I am not sure about this page. Can you tell me what you see?"

Never a confident wrong instruction. For this audience, a wrong instruction is worse than no
instruction — it destroys the trust the whole product depends on.

## Stack

- `extension/` — Chrome Manifest V3, plain JavaScript, no build step. UI inside Shadow DOM.
  - `background.js` is the brain: goal, language, step index, history, AI-step counter.
  - `content/` is eyes and paintbrush only — it is destroyed on every navigation, so it must never
    hold session state.
- `api/` — Vercel serverless functions (Node.js, CommonJS) that call OpenAI.
- `recipes/` — JSON step-by-step guides per website task. Hints and safety nets, never scripts.
- `practice/` — *Yatra Demo Rail*, a fictional train booking site for demos and tests. No real
  brands or logos.
- `site/` — landing page.
- `tests/` — saved page snapshots + expected answers + a Node test runner.
- **Voice** — Chrome Web Speech API for speech-to-text (`te-IN`, `hi-IN`, `en-IN`). Chrome
  `speechSynthesis` for Hindi/English; OpenAI TTS for Telugu.

## Approved design amendments

- **State persists in `chrome.storage.session` after every step.** Correctness never depends on
  keeping the service worker alive; a long-lived port is a latency optimisation only.
- **The overlay is a declared `content_script` with `host_permissions`**, so it re-injects itself
  after every navigation without the service worker orchestrating it.
- **Microphone permission must be granted once, to Daari, not per website.** So the voice surface
  lives at the `chrome-extension://` origin — an offscreen document, or the side panel if the
  Phase 3 spike shows `SpeechRecognition` does not work offscreen.
- **AI runs on every step**, even when a recipe matches; the recipe is passed in as a hint.
- **AI timeout 6s, with a spoken "One moment…" filler after 1.5s** so the user never faces silence.
- **Validation gate compares element *indices*.** The recipe step is resolved to a concrete element
  index locally *before* the AI call; the AI's answer is discarded on index mismatch, timeout,
  schema failure or low confidence. Resolving first also means the fallback is ready before we ask.
- **The element list is capped by priority, not document order** — recipe-matching labels first,
  then in-viewport, then the rest. The element that matters can never be the one the cap discards.
- **Telugu voice fallback is large Telugu captions** (plus a Windows Telugu system voice if one is
  installed) — never the Hindi voice reading Telugu text, which mispronounces badly enough to be
  worse than silence.
- **Captions are a first-class feature**, not a nicety: many target users read their own language
  better than they parse fast speech, and captions carry the Telugu fallback.

## How we work

Daari is built **phase by phase**, never all at once.

- One prompt per phase. Build **only** what that prompt asks for — nothing from a later phase,
  however small or tempting.
- Before writing any code for a phase: briefly state the plan for that phase, then **wait for an OK**.
- On finishing a phase, in this order:
  1. Explain what was built **in simple words** — I am on Windows and still learning.
  2. Give **step-by-step instructions to test it by hand**, in Chrome on Windows.
  3. State the **"done when"** check, so I know it genuinely works.
  4. Make a git commit, message prefixed `Phase N: …`.
- Then **stop and wait** for the next prompt.
- Keep code simple and commented. Small files.
- If a phase prompt conflicts with this file, **ask before proceeding** — do not silently pick one.
