# practice/

**Yatra Demo Rail** — a completely fictional train booking website, used for demos and tests.

It is fictional on purpose: no real brand names, no real logos, no colours copied from any real
site, and nothing here ever talks to a real booking system. That means we can demo a "payment"
page and an "OTP" box safely, to show that Daari pauses before money and never sends what the
user typed to the AI.

There is no server and no build step. Plain HTML, one shared stylesheet, one shared script.
All data lives in this browser's `localStorage` under the `ydr:` prefix, so a booking really does
persist and the PNR lookup really does find it. Clearing site data resets the demo.

## The pages

| Page | What it does |
|---|---|
| `index.html` | Search: From, To, Date, Class, Quota. Saves the journey, goes to results. |
| `results.html` | Four invented trains with fares for the chosen class. **Book** goes on; the ⓘ button opens a details row. |
| `passenger.html` | Name, Age, Gender, Mobile, plus a fake OTP step. **Send OTP** shows a 6-digit code on screen, because there is no real phone to text. |
| `payment.html` | Fare breakdown, a fake card box that accepts any 16 digits, and a **Pay ₹___** button. Creates the booking and its PNR. |
| `confirmation.html` | The 10-digit PNR, coach and seat, and the full ticket summary. |
| `pnr.html` | Type a PNR, get the saved booking back. Reminds you of your most recent PNR. |

`style.css` and `app.js` are shared by all six. The page header, menu and footer are copy-pasted
into each page as plain HTML rather than injected by JavaScript — repetitive, but it is what an old
portal actually does, and JS-injected page furniture could hide timing bugs we want to catch.

## Why it is deliberately awkward

The site is dense, small-texted and busy because that is what makes voice guidance worth having.
Two details are harder than they need to be, on purpose, so that Daari is tested against what real
websites actually do:

- **The ⓘ button on `results.html` has no text.** The glyph is `aria-hidden`, so the button's name
  can only come from its `aria-label`.
- **Mobile and Email on `passenger.html` have a placeholder but no `<label>`.** Every other field
  is properly labelled, so Daari has to handle three different ways of naming a thing.

If a change here makes the site *easier* for Daari, check it is not making the accuracy number in
`tests/` flattering rather than true.

## Testing it

Run `vercel dev` from the project root and open <http://localhost:3000/practice/>. Opening the files
directly with `file://` mostly works, but Chrome can refuse to save `localStorage` on that origin,
so the PNR lookup may come up empty.
