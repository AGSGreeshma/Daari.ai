# Fonts

Daari bundles its fonts. It never fetches one.

Two reasons, and neither is about looks:

1. A remote font means Daari contacts a third party on **every page it runs
   on**. For an extension with `<all_urls>` permission that is a privacy claim
   we would be breaking quietly.
2. It would not arrive on a slow connection, which is the connection our users
   have. The instruction would be legible a second late, or not at all.

## The four files this folder needs

Both families are SIL Open Font License 1.1, so they can be redistributed
inside the extension. Download the **woff2** files and drop them here with
exactly these names:

| File | Family | Used for |
|---|---|---|
| `BalooTammudu2-Regular.woff2` | Baloo Tammudu 2 | Telugu |
| `BalooTammudu2-SemiBold.woff2` | Baloo Tammudu 2 | Telugu, headings |
| `Baloo2-Regular.woff2` | Baloo 2 | Devanagari + Latin |
| `Baloo2-SemiBold.woff2` | Baloo 2 | Devanagari + Latin, headings |

Both are on Google Fonts. Take the **static** woff2 files, not the variable
font, and not the whole TTF — a variable font would be several hundred KB in a
package that is currently 87 KB.

Also copy each family's `OFL.txt` in here next to them. Shipping an OFL font
without its licence file is a licence breach, and this is a public repo.

## It works without them

`extension/tokens.css` declares each family with a `local()` fallback to the
Noto fonts Windows and Chrome already carry — `Noto Sans Telugu`, `Gautami`,
`Noto Sans Devanagari`, `Nirmala UI`. So Telugu and Hindi render correctly
today, in the right sizes and weights.

Adding these four files makes the typography exact. It changes no code.
