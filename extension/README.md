# extension/

The Chrome extension itself (Manifest V3, plain JavaScript, no build step).

| File | What it is |
|---|---|
| `manifest.json` | permissions and entry points |
| `background.js` | **the brain.** The session, the step machine, the advance/confirm/stop logic |
| `flows.js` | the hardcoded route through the practice site: what to look for, how to know it's done |
| `safety.js` | the confirm-gate word list, in one place |
| `config.js` | which API URL to talk to. The only file you edit when you redeploy |
| `strings.js` | every word Daari says or shows, in Telugu, Hindi and English |
| `sidepanel.html` / `.css` / `.js` | **Daari's face, ears and mouth.** Language picker, microphone, live transcript, Repeat and Stop |
| `permission.html` / `.js` | the one-time microphone grant, opened in a normal tab |
| `popup.html` / `popup.js` | the small window behind the toolbar icon. Opens the panel, plus two developer tools |
| `content/` | code that runs *inside* the page being guided (see its own README) |

Nothing here ever contains the OpenAI key; only `api/` may touch it.

## How a flow survives a page load

The session lives in `chrome.storage.session` and is **read at the start of
every message and written back at the end** — there is no in-memory copy. Chrome
can stop the worker between any two messages, and with nothing cached there is
nothing to lose.

The page remembers nothing. On every load it asks *"is there a session, and
what should I do?"* — which is what makes a flow survive navigation.

**The `url_changed` rule is settled in the worker, never in the page.** A page
that is navigating away is being destroyed, and a message sent from it may never
arrive. Instead the worker records which URL a step started on; when the next
page reports in with a different URL, the step advances. Nothing races, and
reloading the same page provably doesn't skip a step.

**Steps target elements by name, never by index.** An index belongs to one page
at one moment; "Send OTP" belongs to the thing itself. Matching is scored —
exact, then prefix, then whole word, then substring — because plain substring
matching picks "Tourism Packages" out of the menu when it's looking for "Age".

## Why the side panel, and not a popup or an offscreen document

The microphone is the reason this decision exists. Chrome ties microphone
permission to an **origin**, so asking from inside each website would prompt an
elderly user on every site they visit. Anything at the `chrome-extension://`
origin is granted once and never asked again.

That ruled the page out, which left three homes:

- **A popup can't work.** It closes the moment the user clicks the page — and
  clicking the page is the entire product. The transcript and the language
  choice would vanish every time they followed an instruction.
- **An offscreen document has no UI**, so the language picker, microphone,
  transcript and controls would still need a home. It could only ever have been
  an audio helper sitting behind a visible surface.
- **The side panel** stays open while the user works, survives page
  navigation (so speech carries on across a booking flow), receives real user
  gestures, and sits at the extension origin.

So the panel was needed either way, and putting audio in a second invisible
context would have added moving parts for no user-visible gain.

`permission.html` still exists and still matters: an extension panel does not
reliably get to show Chrome's own permission prompt, so the grant happens once
in a normal tab, and everything at the extension origin inherits it.

## Who speaks, and who draws

Split deliberately, because the content script is destroyed on every page load:

- **The panel speaks.** It survives navigation, so a sentence started on one
  page is not cut off by the next.
- **The page draws.** The ring and the caption are rendered by
  `content/overlay.js`, right where the user is already looking.

The overlay sends `DAARI_SPEAK` to the panel for each step. If the panel is
closed nobody is listening, and that is fine — the caption alone still carries
the instruction.
