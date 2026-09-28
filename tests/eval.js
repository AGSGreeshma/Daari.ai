/* Daari's live evaluation.
 *
 *   npm run eval
 *
 * THIS ONE COSTS MONEY. It calls the real /api/step once per case, so a full
 * run is about 31 requests. Everything else in tests/ is free -- see
 * tests/offline.js.
 *
 * What it does, per case: takes a snapshot captured from a real page with the
 * real serializer, asks the live model what to do, and then runs the answer
 * through the SAME validation gate the extension uses. So it measures two
 * different things that are easy to confuse:
 *
 *   AI accuracy      did the model pick the right element, on its own?
 *   Final accuracy   did DAARI point at the right element, after the safety net?
 *
 * The gap between those two numbers is the whole argument for the recipe
 * fallback existing.
 *
 * Usage:
 *   npm run eval                  every case
 *   npm run eval -- traps         only cases whose id or file matches "traps"
 *   npm run eval -- --dry         no API calls; checks the cases and snapshots
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const CASES_DIR = path.join(__dirname, 'cases');
const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');

/* The same matcher and the same gate the extension uses. Not a copy: if these
   ever disagreed with the shipped code, every number below would be fiction. */
const shared = { console };
shared.self = shared;
vm.createContext(shared);
for (const file of ['matching.js', 'safety.js']) {
  vm.runInContext(fs.readFileSync(path.join(EXT, file), 'utf8'), shared, { filename: file });
}
const { DAARI_RESOLVE_BY_NAME, DAARI_NAME_SCORE, DAARI_NEEDS_CONFIRM,
        DAARI_IS_ACTIONABLE, DAARI_FIND_FORBIDDEN_FIELDS } = shared;

/* Must match background.js. */
const MIN_CONFIDENCE = 0.45;
const MIN_CONFIDENCE_ALONE = 0.7;   /* no recipe to agree with: higher bar */
const AI_TIMEOUT_MS = 6000;

const config = readConfig();
const API = config.API_BASE + '/api/step';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const filter = args.find((a) => !a.startsWith('--')) || null;

// ---------------------------------------------------------------------- setup

function readConfig() {
  const ctx = {};
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(EXT, 'config.js'), 'utf8'), ctx);
  return ctx.DAARI_CONFIG;
}

function loadRecipes() {
  const dir = path.join(EXT, 'recipes');
  const out = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const recipe = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    out[recipe.task] = recipe;
  }
  return out;
}

function loadCases() {
  const all = [];
  for (const file of fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'))) {
    const group = file.replace('.json', '');
    for (const one of JSON.parse(fs.readFileSync(path.join(CASES_DIR, file), 'utf8')).cases) {
      all.push(Object.assign({ group }, one));
    }
  }
  return all;
}

function loadSnapshot(name) {
  const file = path.join(SNAPSHOT_DIR, name + '.json');
  if (!fs.existsSync(file)) { return null; }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ----------------------------------------------------------------- the model

async function askModel(body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Daari-Client': config.CLIENT
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const ms = Date.now() - startedAt;
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).error || ''; } catch (e) { /* not JSON */ }
      return { ok: false, ms, reason: 'http ' + response.status + (detail ? ': ' + detail : '') };
    }
    return { ok: true, ms, answer: await response.json() };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - startedAt,
      reason: error && error.name === 'AbortError' ? 'timeout' : String(error.message || error)
    };
  } finally {
    clearTimeout(timer);
  }
}

/* Is this the element the case expected?
 *
 * Scored with Daari's own matcher at 80 or better, not compared exactly, so
 * "Pay" matches "Pay ₹378" and the test does not break when the fare changes.
 */
function isExpected(actualName, expected) {
  if (expected === null || expected === undefined) { return false; }
  const options = Array.isArray(expected) ? expected : [expected];
  return options.some((one) => DAARI_NAME_SCORE(actualName, one) >= 80);
}

/* What this case will accept. A single name, or any of several when a page
   offers two equally reasonable routes to the same place. null means the right
   answer is to decline. */
function wanted(expect) {
  if (expect.elementAnyOf) { return expect.elementAnyOf; }
  return expect.element === undefined ? null : expect.element;
}

// ------------------------------------------------------------------- the run

async function run() {
  const recipes = loadRecipes();
  let cases = loadCases();

  if (filter) {
    cases = cases.filter((c) => c.id.includes(filter) || c.group.includes(filter));
    console.log(`Filtered to ${cases.length} case(s) matching "${filter}".\n`);
  }

  // Check the snapshots exist before spending anything.
  const missing = [...new Set(cases.map((c) => c.snapshot))].filter((s) => !loadSnapshot(s));
  if (missing.length) {
    console.error('Cannot run: these snapshots are missing from tests/snapshots/\n');
    missing.forEach((m) => console.error('  ' + m + '.json'));
    console.error('\nCapture them with the extension popup\'s "Save page snapshot" button.');
    console.error('See tests/README.md.');
    process.exit(1);
  }

  console.log(`Daari live evaluation - ${cases.length} cases`);
  console.log(`API: ${API}`);
  if (DRY) { console.log('DRY RUN: no requests will be made, nothing will be spent.'); }
  console.log('');

  const results = [];

  for (const one of cases) {
    const snapshot = loadSnapshot(one.snapshot);
    const elements = snapshot.elements;
    const recipe = one.recipe ? recipes[one.recipe] : null;
    const recipeStep = recipe && one.step !== null ? recipe.steps[one.step] : null;
    const caseWants = wanted(one.expect);

    /* The safety net is resolved FIRST, exactly as background.js does it. */
    const recipeIndex = recipeStep
      ? DAARI_RESOLVE_BY_NAME(elements, recipeStep.look_for || [])
      : -1;

    const payload = {
      goal: one.goal,
      lang: one.lang,
      url: snapshot.url,
      title: snapshot.title,
      elements,
      recipeStep: recipeStep
        ? { look_for: recipeStep.look_for, sensitive: !!recipeStep.sensitive }
        : null,
      /* The earlier steps of this recipe, as the extension would have sent
         them. Passing an empty history made this harder than real life: at
         step 6 the extension has already told the model about steps 1 to 5, and
         without that the model cannot tell a fresh form from a half-filled one. */
      history: recipe && one.step
        ? recipe.steps.slice(0, one.step)
            .map((s) => (s.look_for ? s.look_for[0] : 'step'))
        : []
    };

    /* Safety, checked on every single case rather than asserted once. */
    const leaked = DAARI_FIND_FORBIDDEN_FIELDS(elements);

    let attempt;
    if (DRY) {
      attempt = { ok: false, ms: 0, reason: 'dry run' };
    } else if (leaked.length) {
      attempt = { ok: false, ms: 0, reason: 'REFUSED: payload carried ' + leaked.join(', ') };
    } else {
      attempt = await askModel(payload);
    }

    const ai = attempt.ok ? attempt.answer : null;

    // ---- what the model managed on its own
    const needed = recipeStep ? MIN_CONFIDENCE : MIN_CONFIDENCE_ALONE;
    const wrongPage = ai && ai.goal_supported === false;
    const aiName = ai && !wrongPage && ai.elementIndex !== null && elements[ai.elementIndex]
      ? elements[ai.elementIndex].name : null;
    const aiDeclined = !ai || wrongPage || ai.elementIndex === null ||
                       ai.confidence < needed;
    const aiRight = caseWants === null
      ? aiDeclined                                   /* declining IS the right answer */
      : (!!aiName && isExpected(aiName, caseWants));

    // ---- the validation gate, exactly as background.js applies it
    const usable = ai && !wrongPage && ai.elementIndex !== null &&
                   ai.confidence >= needed &&
                   elements[ai.elementIndex];
    let path_, finalIndex;
    if (usable && (!recipeStep || ai.elementIndex === recipeIndex)) {
      path_ = 'ai'; finalIndex = ai.elementIndex;
    } else if (recipeStep && recipeIndex !== -1) {
      path_ = 'fallback'; finalIndex = recipeIndex;
    } else {
      path_ = 'none'; finalIndex = -1;
    }

    const finalName = finalIndex === -1 ? null : elements[finalIndex].name;
    const finalRight = caseWants === null
      ? finalIndex === -1
      : (!!finalName && isExpected(finalName, caseWants));

    /* ---- the confirm gate, exactly as background.js decides it
       OUR CODE DECIDES. The model's stopAndConfirm is recorded below but not
       consulted: it asked for a stop on "From station" and "PNR number", and a
       stop that fires on every step is a stop nobody reads. */
    const gated = finalIndex !== -1 && (
      (DAARI_IS_ACTIONABLE(elements[finalIndex]) && DAARI_NEEDS_CONFIRM(finalName)) ||
      !!(recipeStep && recipeStep.confirm === true) ||
      /* the model's opinion counts only when ITS answer was the one accepted */
      !!(path_ === 'ai' && ai && ai.stopAndConfirm === true)
    );
    const gateRight = gated === !!one.expect.gate;
    const modelWantedStop = !!(ai && ai.stopAndConfirm === true);

    results.push({
      id: one.id,
      group: one.group,
      lang: one.lang,
      snapshot: one.snapshot,
      goal: one.goal,
      expected: Array.isArray(caseWants) ? caseWants.join(' or ') : caseWants,
      expectedGate: !!one.expect.gate,
      aiName, aiConfidence: ai ? ai.confidence : null,
      aiGoalSupported: ai ? ai.goal_supported : null,
      aiSpeech: ai ? ai.speech : null,
      aiRight, finalName, finalRight, path: path_,
      gated, gateRight, modelWantedStop,
      leaked,
      ms: attempt.ms,
      failure: attempt.ok ? null : attempt.reason,
      note: one.note || null
    });

    const mark = finalRight && gateRight ? 'ok  ' : 'FAIL';
    const pathTag = path_.padEnd(8);
    console.log(`  ${mark} ${pathTag} ${String(attempt.ms).padStart(5)}ms  ${one.id}`);
    if (!finalRight) {
      console.log(`         wanted ${JSON.stringify(caseWants)}, got ${JSON.stringify(finalName)}`);
    }
    if (!gateRight) {
      console.log(`         gate wanted ${one.expect.gate}, got ${gated}`);
    }
    if (attempt.reason && !DRY) { console.log(`         model: ${attempt.reason}`); }
  }

  /* A dry run must NOT print a scorecard. With no model involved, every number
     would be a fiction that measured the fallback alone -- and a fiction in this
     shape is exactly the thing somebody screenshots by accident. */
  if (DRY) {
    const needModel = results.filter((r) => r.path !== 'fallback').length;
    console.log('\n' + '='.repeat(74));
    console.log(`  Dry run only. No model was called, so there are no accuracy numbers.`);
    console.log(`  ${results.length} cases loaded, every snapshot present.`);
    console.log(`  ${results.length - needModel} would be carried by a recipe even if the model failed.`);
    console.log(`  ${needModel} depend entirely on the model -- those are the ones worth watching.`);
    console.log('='.repeat(74));
    console.log('\nRun "npm run eval" for the real thing. It costs about ' +
                results.length + ' API calls.');
    return { failures: [] };
  }

  return summarise(results);
}

// ------------------------------------------------------------------- reporting

function pct(n, of) { return of === 0 ? 0 : Math.round((n / of) * 1000) / 10; }

function summarise(results) {
  const noRecipe = results.filter((r) => r.expected === null);
  const gateCases = results.filter((r) => r.expectedGate);
  const mustNotGate = results.filter((r) => !r.expectedGate);
  const times = results.map((r) => r.ms).filter((m) => m > 0);

  const summary = {
    ranAt: new Date().toISOString(),
    api: API,
    cases: results.length,
    aiAccuracy: pct(results.filter((r) => r.aiRight).length, results.length),
    finalAccuracy: pct(results.filter((r) => r.finalRight).length, results.length),
    gateAccuracy: pct(results.filter((r) => r.gateRight).length, results.length),
    gatesThatMustFire: gateCases.length,
    gatesFired: gateCases.filter((r) => r.gated).length,
    falseGates: mustNotGate.filter((r) => r.gated).length,
    notSureAccuracy: pct(noRecipe.filter((r) => r.finalRight).length, noRecipe.length),
    notSureCases: noRecipe.length,
    payloadsClean: results.filter((r) => r.leaked.length === 0).length,
    safetyClean: pct(results.filter((r) => r.leaked.length === 0).length, results.length),
    pathAi: results.filter((r) => r.path === 'ai').length,
    pathFallback: results.filter((r) => r.path === 'fallback').length,
    pathNone: results.filter((r) => r.path === 'none').length,
    avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
    slowestMs: times.length ? Math.max(...times) : 0,
    /* Stops the model asked for that our code did not grant. Evidence for the
       decision to treat its flag as advisory rather than binding. */
    modelStopsIgnored: results.filter((r) => r.modelWantedStop && !r.gated).length,
    /* How much of the confidence range it actually used. A single value means
       the number is a habit, not a judgement, and the threshold is dead code. */
    distinctConfidences: [...new Set(results.map((r) => r.aiConfidence)
      .filter((c) => c !== null))].sort().join(', '),
    failures: results.filter((r) => !r.finalRight || !r.gateRight).map((r) => r.id)
  };

  const table = [
    ['AI accuracy, model alone', summary.aiAccuracy + '%',
      'Did the model pick the right element with no help?'],
    ['Final accuracy, with the safety net', summary.finalAccuracy + '%',
      'Did DAARI point at the right element, after the validation gate?'],
    ['Gate accuracy', summary.gateAccuracy + '%',
      'Stopped when it had to, and never when it did not.'],
    ['Gates that had to fire', summary.gatesFired + ' / ' + summary.gatesThatMustFire,
      'Missing one of these is the worst failure Daari can have.'],
    ['False stops', String(summary.falseGates),
      'Stopping when nothing dangerous was there. Annoying, not dangerous.'],
    ['"I am not sure" accuracy', summary.notSureAccuracy + '% of ' + summary.notSureCases,
      'Declined to guess when nothing on the page fitted.'],
    ['Payloads with no user values', summary.safetyClean + '%',
      'Rule 2. Anything below 100% is a bug, not a score.'],
    ['Route taken', summary.pathAi + ' ai / ' + summary.pathFallback +
      ' fallback / ' + summary.pathNone + ' none',
      'How often the recipe had to rescue the model.'],
    ['Response time', summary.avgMs + 'ms average, ' + summary.slowestMs + 'ms slowest',
      'The filler phrase plays at 1500ms, so anything under that is silent.'],
    ['Model stop requests ignored', String(summary.modelStopsIgnored),
      'Stops the model asked for that our own code did not grant.'],
    ['Confidence values seen', summary.distinctConfidences || '(none)',
      'One value only would mean the number is a habit, not a judgement.']
  ];

  console.log('\n' + '='.repeat(74));
  const width = Math.max(...table.map((r) => r[0].length));
  for (const [label, value] of table) {
    console.log('  ' + label.padEnd(width) + '   ' + value);
  }
  console.log('='.repeat(74));

  if (summary.failures.length) {
    console.log('\nFailed cases: ' + summary.failures.join(', '));
  } else {
    console.log('\nEvery case passed.');
  }

  fs.writeFileSync(path.join(__dirname, 'results.json'),
    JSON.stringify({ summary, results }, null, 2));
  console.log('\nWrote tests/results.json');

  require('./report.js').write(summary, results, path.join(__dirname, 'report.html'));
  console.log('Wrote tests/report.html  (open it in Chrome and screenshot it)');

  return summary;
}

run().then((summary) => {
  process.exit(summary.failures.length ? 1 : 0);
}).catch((error) => {
  console.error('\nEvaluation could not run:', error.message);
  process.exit(1);
});
