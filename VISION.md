# Daari — vision

## The name

**దారి** / *daari* — "path", in Telugu and Kannada.

Daari shows the path. You walk it. That distinction is the entire product.

## The problem

India added hundreds of millions of first-time internet users in a decade. Most of them got a phone
before they got a keyboard, and almost every important website — trains, pensions, certificates,
bills — is still an English-labelled form designed for someone who already knows how forms work.

So a whole generation completes these tasks the same way: they hand the phone to a younger relative.
The task gets done. The person learns nothing, and next month they hand the phone over again.

The gap is not literacy, and it is not translation. It is that **nobody is standing next to them
saying "now tap that one."**

## The wedge

Accessibility tooling today is **content-oriented**: a screen reader reads out what is on the screen,
top to bottom, with no idea what you came to do. Automation tooling is the opposite extreme — it
fills the form *for* you, so you finish the task and remain exactly as dependent as before.

Daari is **goal-oriented**. It knows you are trying to book a ticket to Kazipet, so of the forty
things on the page it tells you about exactly one, in your language, and draws a ring around it.

Then it stops and waits, because **you** are going to tap it.

> A form-filling bot creates dependence. Daari creates capability.
> The measure of success is not that she booked the ticket. It is that she books the next one alone.

## Who it is for

**Lakshmi, 62, Warangal.** Reads Telugu fluently, cannot read English UI labels. Has a smartphone her
son set up. Wants to book a train ticket to visit her daughter without waiting for him to come home.
*Needs:* instructions in Telugu, spoken and written large. Needs to not be rushed.

**Ramesh, 34, first-time smartphone user.** Literate in Hindi, comfortable with WhatsApp voice notes,
has never filled a web form. Does not know that a dropdown is a thing that opens, or that a page can
scroll below what he can see.
*Needs:* the *interaction* explained, not just the label. "Tap this box, a list will open."

**Saleema, 28, filling a government form on a deadline.** Reads some English. Under time pressure at
a shared computer, with people waiting behind her.
*Needs:* speed and certainty. Needs to know when she is about to submit something irreversible.

All three share one thing: **the cost of a confidently wrong instruction is enormous.** They will not
second-guess Daari. If it points at the wrong button, they will click the wrong button. This is why
Daari would rather say "I am not sure about this page" than guess.

## The trust model

Trust is not a feature of Daari. For this audience, trust **is** the product — the whole thing fails
at the moment someone decides this software might do something to their money. So three promises,
each enforced in code rather than in good intentions:

| Promise | Enforced by |
|---|---|
| **Daari never clicks, types or submits.** | No click or `dispatchEvent` call exists in the codebase. Verified by grep in every phase's test. |
| **What you type never leaves your computer.** | The page summary sent to the AI contains labels and types only — never values. Not redacted values: *no* values. A field is described as `filled: true`, nothing more. |
| **Daari stops before money.** | A keyword check in our own code, not a judgement by the model. The model can add a stop; it can never remove one. |

The third one is the one users feel. Reaching a payment page and hearing Daari *stop* and say "please
check these details" is the moment a sceptical user decides this thing is on their side.

## Dual channel: voice and large text

Every spoken instruction also appears as large on-screen text in the user's own script.

This started as an accessibility nicety and turned out to be central. Many target users **read their
own language more reliably than they parse fast synthetic speech** — especially Telugu, where good
TTS is scarce. So captions are not a fallback for voice; they are a parallel channel, and they are
what carries the experience when Telugu speech is unavailable.

## What success looks like

Measured, not asserted:

1. **Task completed with no human help.** The headline number. A real user finishes a booking on
   *Yatra Demo Rail* without anyone in the room touching the screen.
2. **Highlight accuracy** — the share of steps where Daari's ring was on the correct element.
   Measured automatically by `tests/` against saved page snapshots, so it is a number we can improve,
   not a feeling.
3. **AI vs fallback ratio** — how often the recipe safety net had to rescue the AI. Tells us honestly
   how good the live page-reading actually is.
4. **Time to first spoken step** — from finishing the sentence to hearing the first instruction. Long
   silence reads as "broken" to a first-time user, which is why there is a filler phrase at 1.5s.
5. **Would you do it alone next time?** Asked out loud, to real users. The only question that
   measures the actual mission.

## Known limits, stated honestly

- **Cross-origin iframes.** Several large Indian booking sites put the real form inside an iframe
  from another domain, which the overlay cannot read into.
- **Strict CSP sites.** A few sites block injected styles, which can break the highlight.
- **CAPTCHAs.** Daari can point at one, but cannot help solve it — and shouldn't.
- **Telugu speech recognition** degrades with strong regional accents and background noise.
- **Pages that change under you.** Aggressive single-page apps can move an element between the moment
  Daari reads the page and the moment it speaks.
- **Not a screen reader.** Daari assumes the user can see the screen. Blind users are served better by
  existing screen readers, and we should say so rather than pretend otherwise.

## Demo script — 3 minutes

**The 90-second core (this is the part that must never fail):**

| Time | What happens |
|---|---|
| 0:00–0:15 | The problem, in one sentence, over a shot of an English train-booking form. "My grandmother can read Telugu. This page cannot help her." |
| 0:15–0:30 | Click the Daari icon. Say, in Telugu: *"I want to book a train ticket to Kazipet."* |
| 0:30–0:50 | Daari speaks the first step in Telugu; a glowing ring appears around the "From" box with a large Telugu caption. **The presenter's hands are visible, doing the typing.** Daari detects it and moves on by itself. |
| 0:50–1:10 | Two more steps, faster, to show the rhythm. Include the dropdown step — Daari explains the *interaction*, not just the label. |
| 1:10–1:30 | Reach the payment page. Daari **stops**: "Please check these details before you pay." Say the line out loud: *Daari never clicks for you. It teaches you to click.* |

**The 90-second expansion:**

| Time | What happens |
|---|---|
| 1:30–1:50 | **Safety, shown not claimed.** Type digits into the OTP box, then show the actual network payload on screen: labels only, `filled: true`, no values anywhere. |
| 1:50–2:15 | **Generality.** Go to a real public website with no recipe at all, and give a goal. Daari reads the live page and guides anyway. This is the moment that proves it is an agent, not a script. |
| 2:15–2:35 | **Resilience.** Kill the API. The recipe fallback picks up mid-flow with pre-written phrases and the user never notices. Mention the cost: the whole thing runs inside $5. |
| 2:35–3:00 | A real user from the target group, in their own words, saying whether they would do it alone next time. Close on the name: *daari* — path. |

Constraint: **we only build what appears in this script.** Written before the code for exactly that
reason.

## How this maps to the judging criteria

Our reading of Problem Statement 5 (Real-Time Voice & Multimodal Agents). **To be checked against the
official rubric before submission** — this is our interpretation, not a quotation.

| Criterion | Daari's answer |
|---|---|
| **Real-time voice** | Speech in and out in three languages, continuous listening, sub-2-second first response with a spoken filler rather than silence. |
| **Multimodal understanding** | Reads the live DOM as structure, not as text — accessible names, roles, viewport position, filled state — and grounds its answer to one specific element. Screenshots available when structure is not enough. |
| **Agentic behaviour** | A real perceive → decide → point → verify → advance loop that re-plans on every step against the actual page, rather than replaying a script. |
| **Social impact** | A named user group, a specific task they cannot currently do alone, and a design goal of *removing* the need for the tool. Tested with real users before submission. |
| **Responsible AI** | No values ever sent to the model. Safety enforced in code, not by prompt. Refuses to guess. Cannot act on the user's behalf even if it wanted to. |
| **Feasibility / cost** | Runs inside $5 on free tiers, with the caps enforced in code and a hard limit set at the provider. |
