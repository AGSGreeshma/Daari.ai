# tests/snapshots/

Empty on purpose.

Snapshots come from a real browser, not from a fixture somebody typed. Capture
them with the extension popup's **Save page snapshot** button, which runs the
real serializer on the real page. See the table in `../README.md` for the seven
files you need and where to capture each one.

`npm run eval:dry` tells you if any are missing or misnamed, and costs nothing.

They contain labels only, never anything typed -- the button runs the same rule 2
check as every other payload and refuses rather than capturing a value. That is
why one taken with a one-time code on screen is still safe to commit.
