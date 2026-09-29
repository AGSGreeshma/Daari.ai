/* Put the latest evaluation numbers into README.md and site/index.html.
 *
 *   npm run numbers      (after npm run eval)
 *
 * Why this exists rather than typing them in: a number copied by hand goes stale
 * the moment the next eval runs, and nobody notices. Worse, a number nobody can
 * trace back to a run is indistinguishable from one that was made up. Both files
 * carry a marked block that this script rewrites, so the page and the README can
 * only ever show what tests/results.json actually says.
 *
 * Before the first eval run, both files say "not yet measured", which is the
 * honest thing for them to say.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RESULTS = path.join(ROOT, 'tests', 'results.json');

const START = '<!--NUMBERS-->';
const END = '<!--/NUMBERS-->';

if (!fs.existsSync(RESULTS)) {
  console.error('\n  No tests/results.json yet. Run "npm run eval" first.\n');
  process.exit(1);
}

const { summary } = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
const when = new Date(summary.ranAt).toISOString().slice(0, 10);

/* A MISSED MUST-STOP IS NOT PUBLISHABLE BY DEFAULT.

   The "dangerous buttons caught" line is the strongest safety claim Daari makes,
   and it goes on a public page. Publishing it at 2 out of 3 once already
   happened, next to a sentence saying Daari stopped before "every one" -- which
   was simply false. So this refuses, says which claim is at risk, and offers an
   explicit way past if the number genuinely has to go out as it stands. */
const unsafe = summary.unsafeHighlights;
const missedAStop = summary.gatesFired < summary.gatesThatMustFire;

/* The guard is aimed at UNSAFE HIGHLIGHTS, and deliberately not at stops that
   did not fire.

   Daari declining to point at anything cannot hurt anybody: it is unhelpful, and
   it belongs in the accuracy figures. Ringing a button that takes money without
   stopping first is the thing that must never happen, and the thing that must
   never be published. Those two were the same number until now, which made the
   headline safety claim mean less than it should. */
if (unsafe === undefined) {
  console.error('\n  This tests/results.json predates the safety metric split, so');
  console.error('  there is no safety number in it. Re-run "npm run eval".\n');
  process.exit(1);
}

if (unsafe > 0 && !process.argv.includes('--anyway')) {
  console.error('\n  REFUSING TO PUBLISH.\n');
  console.error('  ' + unsafe + ' unsafe highlight(s): a control that needed a stop was rung');
  console.error('  without one. That is the number that must be zero, and this would go');
  console.error('  on the public landing page.\n');
  if ((summary.unsafeCases || []).length) {
    console.error('  Case(s): ' + summary.unsafeCases.join(', ') + '\n');
  }
  console.error('  To publish it as it stands anyway:\n');
  console.error('      npm run numbers -- --anyway\n');
  process.exit(1);
}

if (missedAStop) {
  console.error('\n  Note: only ' + summary.gatesFired + ' of ' + summary.gatesThatMustFire +
                ' stops fired, but nothing unsafe was highlighted.');
  console.error('  That is a helpfulness miss rather than a safety one, so publishing.\n');
}

/* One row per metric, with the sentence that says what it means. A number on a
   slide with no explanation invites the reader to invent one.

   The accuracy figure is SPLIT, because one number for both was misleading:
   following a hint you were handed and reading a page you know nothing about are
   different skills, and only the second is the page-reading claim. */
const ROWS = [
  ['Final accuracy', summary.finalAccuracy + '%',
    'Steps where Daari pointed at the correct element. What the user experiences.'],
  ['Reading a page with no route', (summary.aiAccuracyUnhinted !== undefined
      ? summary.aiAccuracyUnhinted + '%' : summary.aiAccuracy + '%'),
    'The hard claim: ' + (summary.unhintedCases || '?') + ' cases where the model has ' +
    'nothing to lean on.'],
  ['Following a known route', (summary.aiAccuracyHinted !== undefined
      ? summary.aiAccuracyHinted + '%' : 'n/a'),
    (summary.hintedCases || '?') + ' cases where it is told which element, and asked to ' +
    'confirm it and phrase it.'],
  ['Unsafe highlights', String(unsafe),
    'A control that needed a stop, rung without one. This is the safety number, and it must be zero.'],
  ['Stops fired when they should', summary.gatesFired + ' / ' + summary.gatesThatMustFire,
    missedAStop
      ? 'One did not fire because Daari declined to point at anything there - safe, but unhelpful.'
      : 'Daari stopped and made the user look before every one.'],
  ['False stops', String(summary.falseGates),
    'Times it stopped when nothing was at stake.'],
  ['Declined rather than guessed', summary.notSureAccuracy + '%',
    'On ' + summary.notSureCases + ' goals the page could not do, Daari said so instead of pointing somewhere.'],
  ['Payloads carrying what you typed', (100 - summary.safetyClean) + '%',
    'Nothing you type is ever sent. Anything but zero here is a bug.'],
  ['Response time', summary.avgMs + ' ms average',
    'Slowest ' + summary.slowestMs + ' ms. Daari speaks a filler at 1500 ms so silence is never heard.']
];

function markdownBlock() {
  const lines = [
    START,
    '',
    '| Measure | Result | What it means |',
    '|---|---|---|'
  ];
  ROWS.forEach(([label, value, meaning]) => {
    lines.push('| ' + label + ' | **' + value + '** | ' + meaning + ' |');
  });
  lines.push('');
  lines.push('<sub>' + summary.cases + ' cases against snapshots of real pages, run ' + when +
             '. Reproduce with `npm run eval`; raw output in `tests/results.json`.</sub>');
  lines.push('');
  lines.push(END);
  return lines.join('\n');
}

function htmlBlock() {
  const cards = ROWS.map(([label, value, meaning]) => `
        <div class="num">
          <div class="num-value">${escapeHtml(value)}</div>
          <div class="num-label">${escapeHtml(label)}</div>
          <div class="num-why">${escapeHtml(meaning)}</div>
        </div>`).join('');

  return START + `
      <div class="nums">${cards}
      </div>
      <p class="fine">
        ${summary.cases} cases against snapshots of real pages, run ${when}.
        Anyone can reproduce it: <code>npm run eval</code>.
      </p>
` + '      ' + END;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inject(file, block) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) { console.log('  skipped (missing): ' + file); return; }

  const text = fs.readFileSync(full, 'utf8');
  const from = text.indexOf(START);
  const to = text.indexOf(END);
  if (from === -1 || to === -1) {
    console.log('  skipped (no ' + START + ' marker): ' + file);
    return;
  }
  fs.writeFileSync(full, text.slice(0, from) + block + text.slice(to + END.length));
  console.log('  updated: ' + file);
}

console.log('\n  Evaluation of ' + when + ': ' + summary.finalAccuracy + '% final accuracy, ' +
            summary.gatesFired + '/' + summary.gatesThatMustFire + ' dangerous buttons caught.\n');
inject('README.md', markdownBlock());
inject('site/index.html', htmlBlock());
console.log('\n  Deploy the page with "vercel --prod".\n');
