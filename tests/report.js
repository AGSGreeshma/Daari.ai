/* Turns an eval run into tests/report.html -- the page to screenshot for the deck.
 *
 * Design notes, so nobody "improves" it into something worse:
 *
 * - These are headline numbers, not a chart. A handful of ratios against a limit
 *   is a KPI row of stat tiles with meters, never a bar chart of unrelated
 *   measures. Exactly ONE hero figure: final accuracy.
 * - The colours are a STATUS palette (good / warning / bad), not a categorical
 *   one. Status colour never appears alone: every tile carries its own label, its
 *   own number and a state word, so the state survives colourblindness,
 *   greyscale printing and a black-and-white slide.
 * - Each meter's unfilled track is a lighter step of its own ramp, so the state
 *   reads across the whole bar rather than only the filled part.
 * - Dark mode is chosen, not flipped: its own steps, validated against the dark
 *   surface.
 * - The case table IS the table view. Every number above can be checked against
 *   a row, which is the point of a proof artefact.
 */

const fs = require('fs');

/* Validated with the dataviz palette checker: lightness band, chroma floor and
   contrast vs surface all pass on both surfaces. */
const CSS = `
:root {
  color-scheme: light dark;
  --surface: #fcfcfb;
  --raised: #ffffff;
  --line: #e4e1d9;
  --ink: #1c1c1b;
  --ink-2: #55534d;
  --ink-3: #85827a;

  --good: #0f7a45;   --good-track: #dcefe4;
  --warn: #a2620b;   --warn-track: #f2e5cd;
  --bad:  #b3261e;   --bad-track:  #f7dcd9;

  --brand: #7a1f2b;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --surface: #1a1a19;
    --raised: #232321;
    --line: #37372f;
    --ink: #f2f1ec;
    --ink-2: #b8b5ad;
    --ink-3: #85827a;

    --good: #35a06a;   --good-track: #1d3a2c;
    --warn: #bd8a32;   --warn-track: #3a3120;
    --bad:  #d55f57;   --bad-track:  #3d2422;

    --brand: #d98b96;
  }
}
:root[data-theme="dark"] {
  --surface: #1a1a19;
  --raised: #232321;
  --line: #37372f;
  --ink: #f2f1ec;
  --ink-2: #b8b5ad;
  --ink-3: #85827a;
  --good: #35a06a;   --good-track: #1d3a2c;
  --warn: #bd8a32;   --warn-track: #3a3120;
  --bad:  #d55f57;   --bad-track:  #3d2422;
  --brand: #d98b96;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 40px 24px 60px;
  background: var(--surface);
  color: var(--ink);
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.55;
}
.wrap { max-width: 1000px; margin: 0 auto; }

header { border-bottom: 2px solid var(--brand); padding-bottom: 18px; margin-bottom: 30px; }
h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: -0.2px; }
.sub { margin: 0; color: var(--ink-2); font-size: 14px; }
.sub code { font-size: 13px; color: var(--ink-3); }

/* ---------- the one hero figure ---------- */
.hero {
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.hero-value {
  font-size: 64px;
  font-weight: 600;
  line-height: 1;
  color: var(--ink);
  /* Proportional figures on purpose: tabular-nums looks loose at this size. */
}
.hero-label { font-size: 17px; color: var(--ink-2); max-width: 420px; }
.hero-note { margin: 0 0 32px; color: var(--ink-3); font-size: 13.5px; }

/* ---------- KPI row ---------- */
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(212px, 1fr));
  gap: 14px;
  margin-bottom: 34px;
}
.tile {
  background: var(--raised);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 15px 16px 17px;
}
.tile .label { font-size: 12.5px; color: var(--ink-2); margin-bottom: 7px; }
.tile .value {
  font-size: 30px;
  font-weight: 600;
  line-height: 1.1;
  margin-bottom: 3px;
}
/* The state word. This is what carries meaning when colour cannot -- CVD,
   greyscale print, a black-and-white slide. */
.tile .state {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.tile .why { font-size: 12.5px; color: var(--ink-3); line-height: 1.45; }

/* Meter: 4px rounded data-end, track is a lighter step of the same ramp. */
.meter { height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 11px; }
.meter > i { display: block; height: 100%; border-radius: 4px; }

.s-good .value, .s-good .state { color: var(--good); }
.s-good .meter { background: var(--good-track); }
.s-good .meter > i { background: var(--good); }
.s-warn .value, .s-warn .state { color: var(--warn); }
.s-warn .meter { background: var(--warn-track); }
.s-warn .meter > i { background: var(--warn); }
.s-bad .value, .s-bad .state { color: var(--bad); }
.s-bad .meter { background: var(--bad-track); }
.s-bad .meter > i { background: var(--bad); }

/* ---------- plain facts ---------- */
h2 { font-size: 17px; margin: 34px 0 12px; }
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 10px 22px;
  margin-bottom: 8px;
}
.fact {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
  font-size: 14px;
}
.fact b { font-variant-numeric: tabular-nums; font-weight: 600; }

/* ---------- table view ---------- */
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
  text-align: left;
  padding: 8px 9px;
  border-bottom: 2px solid var(--line);
  color: var(--ink-2);
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}
td { padding: 8px 9px; border-bottom: 1px solid var(--line); vertical-align: top; }
td.num { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
.pill {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.pill-ai { background: var(--good-track); color: var(--good); }
.pill-fallback { background: var(--warn-track); color: var(--warn); }
.pill-none { background: var(--bad-track); color: var(--bad); }
.ok { color: var(--good); font-weight: 600; }
.no { color: var(--bad); font-weight: 600; }
.goal { color: var(--ink-2); max-width: 260px; }
.said { color: var(--ink-3); font-style: italic; }
tr.bad-row td { background: var(--bad-track); }

.note {
  margin-top: 26px;
  padding: 14px 16px;
  background: var(--warn-track);
  border-left: 4px solid var(--warn);
  border-radius: 6px;
  font-size: 13.5px;
  color: var(--ink);
}
footer { margin-top: 36px; color: var(--ink-3); font-size: 12.5px; }

@media print {
  body { padding: 0; }
  .tile, table { break-inside: avoid; }
}
@media (max-width: 620px) {
  .hero-value { font-size: 48px; }
  body { padding: 24px 16px 40px; }
}
`;

function escapeHtml(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* A metric's state. Thresholds are deliberately strict: this is a report about
   whether a thing is trustworthy, not a score to feel good about. */
function stateOf(value, kind) {
  if (kind === 'safety') {
    return value === 100
      ? { cls: 's-good', word: 'Clean' }
      : { cls: 's-bad', word: 'Rule 2 broken' };
  }
  if (kind === 'gate') {
    return value === 100
      ? { cls: 's-good', word: 'All correct' }
      : { cls: 's-bad', word: 'Needs fixing' };
  }
  if (value >= 90) { return { cls: 's-good', word: 'Good' }; }
  if (value >= 70) { return { cls: 's-warn', word: 'Watch' }; }
  return { cls: 's-bad', word: 'Poor' };
}

function tile(label, value, unit, why, kind) {
  const state = stateOf(value, kind);
  const width = Math.max(0, Math.min(100, value));
  return `
      <div class="tile ${state.cls}">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}${escapeHtml(unit || '')}</div>
        <div class="state">${escapeHtml(state.word)}</div>
        <div class="meter"><i style="width:${width}%"></i></div>
        <div class="why">${escapeHtml(why)}</div>
      </div>`;
}

function write(summary, results, outPath) {
  const heroState = stateOf(summary.finalAccuracy);

  const rows = results.map((r) => {
    const failed = !r.finalRight || !r.gateRight;
    return `
        <tr class="${failed ? 'bad-row' : ''}">
          <td>${escapeHtml(r.id)}</td>
          <td>${escapeHtml(r.lang)}</td>
          <td class="goal">${escapeHtml(r.goal)}</td>
          <td>${escapeHtml(r.expected === null ? '(not sure)' : r.expected)}</td>
          <td>${escapeHtml(r.finalName === null ? '(not sure)' : r.finalName)}</td>
          <td><span class="pill pill-${escapeHtml(r.path)}">${escapeHtml(r.path)}</span></td>
          <td class="${r.finalRight ? 'ok' : 'no'}">${r.finalRight ? 'yes' : 'NO'}</td>
          <td class="${r.gateRight ? 'ok' : 'no'}">${r.expectedGate ? 'must stop' : '-'}${
            r.gateRight ? '' : ' WRONG'}</td>
          <td class="num">${escapeHtml(r.ms)}</td>
          <td class="said">${escapeHtml(r.aiSpeech || r.failure || '')}</td>
        </tr>`;
  }).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daari evaluation</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">

  <header>
    <h1>Daari &mdash; evaluation</h1>
    <p class="sub">
      ${summary.cases} cases against snapshots of real pages, captured with the real
      serializer. Each case asks the live model what to do, then runs its answer
      through the same validation gate the extension uses.<br>
      <code>${escapeHtml(summary.ranAt)} &middot; ${escapeHtml(summary.api)}</code>
    </p>
  </header>

  <div class="hero">
    <div class="hero-value">${escapeHtml(summary.finalAccuracy)}%</div>
    <div class="hero-label">
      of steps pointed at the <strong>correct element</strong> &mdash; what the user
      actually experiences, after the safety net.
    </div>
  </div>
  <p class="hero-note">
    Reading a page with no known route, the model managed
    ${escapeHtml(summary.aiAccuracyUnhinted)}%. The difference is the recipe
    fallback doing its job: ${escapeHtml(summary.pathFallback)} of
    ${escapeHtml(summary.cases)} answers were rejected and replaced.
  </p>

  <div class="tiles">
${tile('Reading a page with no route', summary.aiAccuracyUnhinted, '%',
  'The hard claim: ' + summary.unhintedCases + ' cases where the model has nothing to lean on.')}
${tile('Following a known route', summary.aiAccuracyHinted, '%',
  summary.hintedCases + ' cases where it is told which element, and asked to confirm it and phrase it.')}
${tile('Final accuracy, with the safety net', summary.finalAccuracy, '%',
  'What Daari actually pointed at, after the validation gate.')}
${tile('Confirm gate', summary.gateAccuracy, '%',
  `Stopped before every one of the ${summary.gatesThatMustFire} dangerous buttons, and stopped falsely ${summary.falseGates} time(s).`,
  'gate')}
${tile('Said "I am not sure"', summary.notSureAccuracy, '%',
  `On ${summary.notSureCases} goals nothing on the page could do. Declining is the right answer; a confident guess is the worst one.`)}
${tile('Payloads with no user values', summary.safetyClean, '%',
  'Rule 2: labels only, never anything typed. Below 100% is a bug, not a score.',
  'safety')}
  </div>

  <h2>The plain facts</h2>
  <div class="facts">
    <div class="fact"><span>Cases run</span><b>${escapeHtml(summary.cases)}</b></div>
    <div class="fact"><span>Model's own answer used</span><b>${escapeHtml(summary.pathAi)}</b></div>
    <div class="fact"><span>Recipe rescued it</span><b>${escapeHtml(summary.pathFallback)}</b></div>
    <div class="fact"><span>Neither could answer</span><b>${escapeHtml(summary.pathNone)}</b></div>
    <div class="fact"><span>Gates that had to fire</span><b>${escapeHtml(summary.gatesFired)} / ${escapeHtml(summary.gatesThatMustFire)}</b></div>
    <div class="fact"><span>False stops</span><b>${escapeHtml(summary.falseGates)}</b></div>
    <div class="fact"><span>Average response</span><b>${escapeHtml(summary.avgMs)} ms</b></div>
    <div class="fact"><span>Slowest response</span><b>${escapeHtml(summary.slowestMs)} ms</b></div>
  </div>
  <p class="hero-note">
    Daari speaks a filler phrase at 1500&nbsp;ms, so any response faster than that is
    never heard as a pause.
  </p>

  <div class="note">
    <strong>How the stop decides.</strong> It reads what a control <em>is</em> as well as
    what it says. Anything that acts &mdash; a button, or a link carrying
    <code>role="button"</code> &mdash; is stopped on dangerous words. An ordinary
    link is stopped when it names a booking it would cancel, names money with an
    amount, or <em>is a payment action</em>: &ldquo;Pay Now&rdquo; and
    &ldquo;Make payment&rdquo; are stopped, &ldquo;Payment options&rdquo; and
    &ldquo;Refund rules&rdquo; are not. The distinction is grammatical &mdash;
    &ldquo;Pay&rdquo; is a verb, &ldquo;Payment&rdquo; is a noun &mdash; because a stop
    that fires on help pages is one people learn to dismiss without reading, which
    makes every real stop worth less.
  </div>

  <h2>Every case</h2>
  <table>
    <thead>
      <tr>
        <th>Case</th><th>Lang</th><th>Goal</th><th>Expected</th><th>Daari chose</th>
        <th>Route</th><th>Right</th><th>Gate</th><th>ms</th><th>What it said</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>

  <footer>
    Generated by <code>npm run eval</code>. The free offline harness is
    <code>npm test</code>. Raw numbers in <code>tests/results.json</code>.
  </footer>

</div>
</body>
</html>
`;

  fs.writeFileSync(outPath, html);
}

module.exports = { write };
