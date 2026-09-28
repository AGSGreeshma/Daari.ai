/* Daari's offline harness. Free, fast, and needs no network or API key.

   Run it with:  npm test

   It loads the REAL extension files -- background.js, the recipes, safety.js,
   matching.js -- with a fake browser and a fake OpenAI around them, so the
   decision logic is exercised exactly as it ships. Nothing here costs money.

   The paid one, which calls the live model against real page snapshots, is
   tests/eval.js:  npm run eval */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok ? '' : `\n          got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`));
}

// --------------------------------------------------------------- fake browser
let storage = { session: {}, local: { lang: 'en' } };
const sentToPage = [];
const broadcasts = [];

function makeArea(bag) {
  return {
    get: async (keys) => {
      if (typeof keys === 'string') { return { [keys]: bag[keys] }; }
      const out = {};
      for (const k of Object.keys(keys)) { out[k] = k in bag ? bag[k] : keys[k]; }
      return out;
    },
    set: async (obj) => { Object.assign(bag, obj); },
    remove: async (k) => { delete bag[k]; }
  };
}

// The fake API. Each test sets `aiReply` (or `aiFail`) to steer it, and every
// request is recorded so the outgoing payload can be inspected.
let aiReply = null;
let aiFail = null;
const aiRequests = [];

const chrome = {
  storage: { session: makeArea(storage.session), local: makeArea(storage.local) },
  tabs: {
    query: async () => [{ id: 1 }],
    sendMessage: async (id, msg) => { sentToPage.push(msg); }
  },
  runtime: {
    getURL: (p) => 'EXTURL/' + p,
    sendMessage: (msg) => { broadcasts.push(msg); return Promise.resolve(); },
    onMessage: { addListener: (fn) => { chrome.__listener = fn; } }
  }
};

async function fakeFetch(url, options) {
  // Recipe files: read from disk.
  if (String(url).startsWith('EXTURL/recipes/')) {
    const name = String(url).replace('EXTURL/recipes/', '');
    const text = fs.readFileSync(path.join(EXT, 'recipes', name), 'utf8');
    return { ok: true, json: async () => JSON.parse(text) };
  }
  // The step API.
  if (String(url).includes('/api/step')) {
    aiRequests.push(JSON.parse(options.body));
    if (aiFail) {
      if (aiFail === 'abort') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      return { ok: false, status: aiFail };
    }
    return { ok: true, json: async () => aiReply };
  }
  throw new Error('unexpected fetch: ' + url);
}

function loadWorker() {
  const ctx = {
    chrome, console, Date, JSON, setTimeout, clearTimeout, RegExp, String, Number,
    Object, Math, Map, Set, Array, Boolean, Error, fetch: fakeFetch,
    AbortController: class { constructor() { this.signal = {}; } abort() {} }
  };
  ctx.self = ctx;
  ctx.importScripts = (...files) =>
    files.forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  vm.createContext(ctx);
  vm.runInContext(read('background.js'), ctx, { filename: 'background.js' });
  return ctx;
}

let ctx = loadWorker();
const call = (message) => new Promise((r) => chrome.__listener(message, { tab: { id: 1 } }, r));

// A realistic search page, as serializePage would produce it.
const SEARCH_ELEMENTS = [
  { i: 0, tag: 'a', type: '', name: 'Book Ticket', filled: false },
  { i: 1, tag: 'a', type: '', name: 'PNR Status', filled: false },
  { i: 2, tag: 'a', type: '', name: 'Tourism Packages', filled: false },
  { i: 3, tag: 'a', type: '', name: 'Contact a station', filled: false },
  { i: 4, tag: 'input', type: 'text', name: 'From station *', filled: false },
  { i: 5, tag: 'input', type: 'text', name: 'To station *', filled: false },
  { i: 6, tag: 'select', type: '', name: 'Class', filled: true },
  { i: 7, tag: 'button', type: 'submit', name: 'Search Trains', filled: false }
];
const PAYMENT_ELEMENTS = [
  { i: 0, tag: 'a', type: '', name: 'Book Ticket', filled: false },
  { i: 1, tag: 'input', type: 'text', name: 'Card number *', filled: false },
  { i: 2, tag: 'button', type: 'submit', name: 'Pay \u20B9378', filled: false }
];
const SEARCH_URL = 'https://daari-ai.vercel.app/practice/';
const PAYMENT_URL = 'https://daari-ai.vercel.app/practice/payment.html';

const page = (url, elements) => ({ url, title: 'Yatra Demo Rail', elements });

// ============================================================================
(async function run() {

console.log('\n1. Recipes load and are well formed');
{
  for (const file of ['practice-book-ticket', 'practice-check-pnr']) {
    const recipe = JSON.parse(fs.readFileSync(path.join(EXT, 'recipes', file + '.json'), 'utf8'));
    let gaps = 0;
    recipe.steps.forEach((s, i) => {
      if (!s.page) { console.log(`  FAIL  ${file} step ${i} has no page`); gaps++; }
      ['te', 'hi', 'en'].forEach((l) => {
        if (!s.say || !s.say[l]) { console.log(`  FAIL  ${file} step ${i} missing say.${l}`); gaps++; }
      });
      if (!s.final && (!s.look_for || !s.look_for.length)) {
        console.log(`  FAIL  ${file} step ${i} has no look_for`); gaps++;
      }
    });
    check(`${file}: every step complete`, gaps, 0);
    check(`${file}: has match_phrases for all 3 languages`,
      ['te', 'hi', 'en'].every((l) => (recipe.match_phrases[l] || []).length > 0), true);
  }
}

console.log('\n2. A spoken goal picks the right recipe');
{
  const goals = [
    ['\u0C28\u0C3E\u0C15\u0C41 \u0C1F\u0C4D\u0C30\u0C48\u0C28\u0C4D \u0C1F\u0C3F\u0C15\u0C46\u0C1F\u0C4D \u0C2C\u0C41\u0C15\u0C4D \u0C1A\u0C47\u0C2F\u0C3E\u0C32\u0C3F', 'book-ticket', 'Telugu: book a train ticket'],
    ['I want to book a train ticket', 'book-ticket', 'English: book a train ticket'],
    ['\u092E\u0941\u091D\u0947 \u091F\u093F\u0915\u091F \u092C\u0941\u0915 \u0915\u0930\u0928\u093E \u0939\u0948', 'book-ticket', 'Hindi: book a ticket'],
    ['check my PNR status', 'check-pnr', 'English: PNR status'],
    ['PNR status \u0C1A\u0C46\u0C15\u0C4D \u0C1A\u0C47\u0C2F\u0C3E\u0C32\u0C3F', 'check-pnr', 'mixed Telugu and English'],
    ['what is the weather today', null, 'unrelated goal matches nothing']
  ];
  for (const [goal, want, label] of goals) {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    const reply = await call({ type: 'DAARI_START_FLOW', goal, tabId: 1 });
    check(label, reply.flowId, want);
  }
}

console.log('\n3. The AI path: model agrees with the recipe');
{
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiRequests.length = 0; aiFail = null;
  // The recipe wants "from station", which is index 4.
  aiReply = { elementIndex: 4, speech: 'Type your starting station here',
              done_when: 'field_filled', stopAndConfirm: false, confidence: 0.9 };

  await call({ type: 'DAARI_START_FLOW', goal: 'book a train ticket', tabId: 1 });
  const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));

  check('path is ai', step.path, 'ai');
  check('uses the model sentence', step.say, 'Type your starting station here');
  check('points at the element both agreed on', step.index, 4);
  check('one AI call was made', aiRequests.length, 1);
  check('the recipe hint was passed', aiRequests[0].recipeStep.look_for, ['from station']);
  check('the goal was passed', aiRequests[0].goal, 'book a train ticket');
}

console.log('\n4. THE VALIDATION GATE');
{
  async function decideWith(reply, fail, elements, url) {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    aiReply = reply; aiFail = fail;
    await call({ type: 'DAARI_START_FLOW', goal: 'book a train ticket', tabId: 1 });
    return call(Object.assign({ type: 'DAARI_PAGE_READY' },
      page(url || SEARCH_URL, elements || SEARCH_ELEMENTS)));
  }

  const RECIPE_SAY_EN = 'Type where you are starting from';

  // Disagreement about WHICH element -> recipe wins.
  let s = await decideWith({ elementIndex: 7, speech: 'Press Search', done_when: 'clicked',
                             stopAndConfirm: false, confidence: 0.95 }, null);
  check('model chose a different element -> fallback', s.path, 'fallback');
  check('  and the pre-written phrase is used', s.say, RECIPE_SAY_EN);
  check('  pointing at the recipe element', s.index, 4);
  check('  with the reason recorded', s.why, 'model chose a different element');

  // Low confidence -> recipe wins, even though the element is right.
  s = await decideWith({ elementIndex: 4, speech: 'Type here', done_when: 'field_filled',
                         stopAndConfirm: false, confidence: 0.2 }, null);
  check('low confidence -> fallback', s.path, 'fallback');
  check('  reason names the confidence', s.why, 'model unsure (0.2)');

  // No element chosen -> recipe wins.
  s = await decideWith({ elementIndex: null, speech: 'I cannot tell', done_when: 'clicked',
                         stopAndConfirm: false, confidence: 0.9 }, null);
  check('model found nothing -> fallback', s.path, 'fallback');
  check('  reason', s.why, 'model found nothing');

  // Bad shape -> recipe wins.
  s = await decideWith({ speech: '', done_when: 'clicked', confidence: 0.9 }, null);
  check('empty speech -> fallback', s.path, 'fallback');
  s = await decideWith({ elementIndex: 4, speech: 'ok', done_when: 'field_filled',
                         stopAndConfirm: false }, null);
  check('missing confidence -> fallback', s.path, 'fallback');
  check('  reason', s.why, 'no confidence in answer');

  // Timeout -> recipe wins.
  s = await decideWith(null, 'abort');
  check('timeout -> fallback', s.path, 'fallback');
  check('  reason', s.why, 'timeout');

  // API down entirely -> recipe wins. THIS IS THE DEMO SAFETY NET.
  s = await decideWith(null, 500);
  check('API 500 -> fallback', s.path, 'fallback');
  check('  reason', s.why, 'http 500');
  check('  still points at the right element', s.index, 4);
  check('  still speaks the right sentence', s.say, RECIPE_SAY_EN);
}

console.log('\n5. The whole booking completes with the API dead');
{
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiFail = 500; aiReply = null;
  await call({ type: 'DAARI_START_FLOW', goal: 'book a train ticket', tabId: 1 });

  let step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
  let paths = [step.path];
  for (let i = 0; i < 3; i++) {
    step = await call(Object.assign({ type: 'DAARI_STEP_DONE' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
    paths.push(step.path);
  }
  check('every step on the search page fell back', paths, ['fallback', 'fallback', 'fallback', 'fallback']);
  check('reached the Search button step', step.index, 7);
  check('never said "not sure"', paths.includes('none'), false);
}

console.log('\n6. No recipe at all: the model works alone');
{
  const OTHER = [
    { i: 0, tag: 'input', type: 'text', name: 'Search the site', filled: false },
    { i: 1, tag: 'button', type: 'submit', name: 'Go', filled: false }
  ];
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiFail = null;
  aiReply = { elementIndex: 0, speech: 'Type what you are looking for here',
              done_when: 'field_filled', stopAndConfirm: false, confidence: 0.8 };

  const started = await call({ type: 'DAARI_START_FLOW', goal: 'find something', tabId: 1 });
  check('no recipe matched', started.flowId, null);
  check('reported as AI-only', started.aiOnly, true);

  let s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://somewhere.else/page', OTHER)));
  check('model is believed when confident', s.path, 'ai');
  check('no recipe hint was sent', aiRequests[aiRequests.length - 1].recipeStep, null);
  check('total is 0, so the panel shows "Step n" not "n of N"', s.total, 0);
  check('step label has no total', s.stepLabel, 'Step 1');

  // Unsure, with no recipe to fall back on -> say so.
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiReply = { elementIndex: null, speech: 'no idea', done_when: 'clicked',
              stopAndConfirm: false, confidence: 0.1 };
  await call({ type: 'DAARI_START_FLOW', goal: 'find something', tabId: 1 });
  s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://somewhere.else/page', OTHER)));
  check('unsure with no safety net -> path none', s.path, 'none');
  check('  and the failure voice, not a guess', s.say,
    ctx.self.DAARI_STRINGS.ui.notSure.en);
  check('  pointing at nothing', s.index, -1);
}

console.log('\n7. Safety: the gate still decides, and the model can only add');
{
  // The Pay button trips our own word list. No AI call should even be spent.
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiRequests.length = 0; aiFail = null;
  aiReply = { elementIndex: 2, speech: 'Press Pay', done_when: 'url_changed',
              stopAndConfirm: false, confidence: 0.99 };
  await call({ type: 'DAARI_START_FLOW', flowId: 'book-ticket', goal: 'book', tabId: 1 });
  // jump the session to the Pay step
  const sess = storage.session.daariSession;
  sess.stepIndex = 13;
  await chrome.storage.session.set({ daariSession: sess });

  let s = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(PAYMENT_URL, PAYMENT_ELEMENTS)));
  check('gate fired', s.gate, true);
  check('  NO element index is sent, so nothing can be rung', s.index, -1);
  check('  even though the model was confident and said do not stop', aiRequests.length, 0);
  check('  and it says to check the details', s.say,
    ctx.self.DAARI_STRINGS.ui.confirmBeforePay.en);

  // Confirm, then it points.
  await call({ type: 'DAARI_CONFIRMED' });
  check('the page was asked to report in again',
    sentToPage[sentToPage.length - 1].type, 'DAARI_ASK_AGAIN');
  s = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(PAYMENT_URL, PAYMENT_ELEMENTS)));
  check('after confirming, the Pay button is pointed at', s.index, 2);
  check('  gate cleared', s.gate, false);
  check('  and the page is told it was confirmed, for its own check', s.confirmed, true);

  // stopAndConfirm can ADD a stop on an otherwise harmless element.
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  const HARMLESS = [{ i: 0, tag: 'button', type: 'button', name: 'Continue', filled: false }];
  aiReply = { elementIndex: 0, speech: 'Press Continue', done_when: 'clicked',
              stopAndConfirm: true, confidence: 0.9 };
  await call({ type: 'DAARI_START_FLOW', goal: 'do a thing', tabId: 1 });
  s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://somewhere.else/x', HARMLESS)));
  check('model stopAndConfirm ADDS a stop on a harmless-looking button', s.gate, true);
}

console.log('\n8. Rule 2: nothing the user typed can leave');
{
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiRequests.length = 0; aiFail = null;
  aiReply = { elementIndex: 4, speech: 'ok', done_when: 'field_filled',
              stopAndConfirm: false, confidence: 0.9 };
  await call({ type: 'DAARI_START_FLOW', goal: 'book a train ticket', tabId: 1 });
  await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));

  const sentKeys = new Set();
  aiRequests[0].elements.forEach((e) => Object.keys(e).forEach((k) => sentKeys.add(k)));
  check('the outgoing element keys are exactly the five allowed',
    [...sentKeys].sort(), ['filled', 'i', 'name', 'tag', 'type']);

  // And the worker REFUSES if a value ever appears.
  const poisoned = SEARCH_ELEMENTS.map((e) => Object.assign({}, e));
  poisoned[4].value = '123456';
  check('DAARI_FIND_FORBIDDEN_FIELDS spots it',
    ctx.self.DAARI_FIND_FORBIDDEN_FIELDS(poisoned), ['value']);

  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiRequests.length = 0;
  await call({ type: 'DAARI_START_FLOW', goal: 'book a train ticket', tabId: 1 });
  const s = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, poisoned)));
  check('the worker sent NOTHING over the network', aiRequests.length, 0);
  check('and fell back to the recipe instead of leaking', s.path, 'fallback');
}

console.log('\n9. Budget: 25 calls, then recipe only');
{
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiFail = null;
  aiReply = { elementIndex: 4, speech: 'Type here', done_when: 'field_filled',
              stopAndConfirm: false, confidence: 0.9 };
  await call({ type: 'DAARI_START_FLOW', goal: 'book a train ticket', tabId: 1 });

  const sess = storage.session.daariSession;
  sess.aiCallCount = 25;
  await chrome.storage.session.set({ daariSession: sess });
  aiRequests.length = 0;

  const s = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
  check('no call is made once the budget is gone', aiRequests.length, 0);
  check('falls back to the recipe', s.path, 'fallback');
  check('  reason names the budget', s.why, 'budget of 25 calls used up');
  check('  and the user is told once', s.notice, ctx.self.DAARI_STRINGS.ui.budgetSpent.en);

  const again = await call(Object.assign({ type: 'DAARI_STEP_DONE' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
  check('  but not told twice', again.notice, undefined);
}

console.log('\n10. Path logging, for the panel');
{
  const status = await call({ type: 'DAARI_GET_STATUS' });
  check('status reports the AI call count', status.aiCallCount, 25);
  check('and the cap', status.maxAiCalls, 25);
  check('and a path log', Array.isArray(status.pathLog), true);
  check('whose entries name the path', status.pathLog[0].path, 'fallback');
}

console.log('\n11. Navigation still works now the steps come from JSON');
{
  const BASE = 'https://daari-ai.vercel.app/practice/';
  const P = { search: BASE, results: BASE + 'results.html', passenger: BASE + 'passenger.html',
    payment: BASE + 'payment.html', confirm: BASE + 'confirmation.html' };
  const ANY = [{ i: 0, tag: 'button', type: 'button', name: 'Whatever', filled: false }];

  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiFail = 500;   // recipe-only, so the walk is deterministic
  await call({ type: 'DAARI_START_FLOW', goal: 'book a train ticket', tabId: 1 });

  const go = (url, els) => call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(url, els || ANY)));
  const done = (url, els) => call(Object.assign({ type: 'DAARI_STEP_DONE' }, page(url, els || ANY)));

  let s = await go(P.search, SEARCH_ELEMENTS);
  check('step 1 of 15', [s.number, s.total], [1, 15]);
  for (let i = 0; i < 3; i++) { s = await done(P.search, SEARCH_ELEMENTS); }
  check('on the Search step', s.number, 4);

  s = await go(P.results);
  check('navigating forward advances by itself', s.number, 5);
  s = await go(P.results);
  check('reloading the same page does not skip', s.number, 5);
  s = await go(BASE + 'pnr.html');
  check('an unknown page advances nothing', s.number, 5);

  s = await go(P.passenger);
  check('on the passenger page', s.number, 6);
  s = await go(P.search, SEARCH_ELEMENTS);
  check('pressing Back returns to the FIRST step of that page', s.number, 1);
  check('  and says so', s.notice, ctx.self.DAARI_STRINGS.ui.wentBack.en);

  check('page derivation: bare directory', ctx.self.DAARI_PAGE_OF(BASE), 'index');
  check('page derivation: with query', ctx.self.DAARI_PAGE_OF(P.payment + '?x=1'), 'payment');
}

console.log('\n12. The worker survives being killed mid-flow');
{
  const frozen = JSON.stringify(storage.session);
  ctx = loadWorker();            // a brand new worker, nothing cached
  const status = await call({ type: 'DAARI_GET_STATUS' });
  check('a fresh worker still knows the step', status.number, 1);
  check('and which recipe', status.flowId, 'book-ticket');
  check('storage was all it needed', frozen === JSON.stringify(storage.session), true);
}

console.log('\n13. api/step.js validates before it spends anything');
{
  const handler = require(path.join(ROOT, 'api', 'step.js'));

  function fakeRes() {
    const r = { code: null, body: null, headers: {} };
    r.setHeader = (k, v) => { r.headers[k] = v; };
    r.status = (c) => { r.code = c; return r; };
    r.json = (o) => { r.body = o; };
    r.send = (b) => { r.body = b; };
    r.end = () => { r.body = '(empty)'; };
    return r;
  }

  const GOOD_ELEMENTS = [{ i: 0, tag: 'button', type: 'submit', name: 'Go', filled: false }];
  const DAARI_HEADERS = { 'x-daari-client': 'daari/0.5', 'x-forwarded-for': '10.0.0.1' };

  const call2 = async (method, body, key, headers) => {
    const before = process.env.OPENAI_API_KEY;
    if (key === undefined) { delete process.env.OPENAI_API_KEY; }
    else { process.env.OPENAI_API_KEY = key; }
    const res = fakeRes();
    await handler({ method, body, headers: headers || DAARI_HEADERS }, res);
    if (before === undefined) { delete process.env.OPENAI_API_KEY; }
    else { process.env.OPENAI_API_KEY = before; }
    return res;
  };

  let r = await call2('OPTIONS', {}, 'x');
  check('OPTIONS preflight', [r.code, r.headers['Access-Control-Allow-Origin']], [204, '*']);

  r = await call2('GET', {}, 'x');
  check('GET refused', r.code, 405);

  r = await call2('POST', { goal: 'x', lang: 'en', elements: GOOD_ELEMENTS }, undefined);
  check('no key -> 500 with a helpful message', r.code, 500);
  check('  and the message never contains a key', /sk-/.test(r.body.error), false);

  r = await call2('POST', { goal: 'x', lang: 'fr', elements: GOOD_ELEMENTS }, 'k');
  check('bad language refused', [r.code, r.body.error], [400, 'lang must be te, hi or en.']);

  r = await call2('POST', { goal: 'x', lang: 'en', elements: [] }, 'k');
  check('empty elements refused', r.code, 400);

  r = await call2('POST', { goal: 'x'.repeat(400), lang: 'en', elements: GOOD_ELEMENTS }, 'k');
  check('over-long goal refused', r.code, 400);

  // The important one: a value must be REFUSED, not silently stripped.
  r = await call2('POST', {
    goal: 'x', lang: 'en',
    elements: [{ i: 0, tag: 'input', type: 'password', name: 'OTP', filled: true, value: '123456' }]
  }, 'k');
  check('a value in the payload is REFUSED, not dropped', r.code, 400);
  check('  and the refusal names the field', /value/.test(r.body.error), true);
  check('  and never echoes the value itself', /123456/.test(r.body.error), false);

  console.log('\n14. Server-side abuse guards');
  {
    const body = { goal: 'x', lang: 'en', elements: GOOD_ELEMENTS };

    // No client header at all.
    let g = await call2('POST', body, 'k', { 'x-forwarded-for': '10.0.0.9' });
    check('missing X-Daari-Client -> 403', g.code, 403);
    check('  and no key is needed to be turned away', /Daari extension/.test(g.body.error), true);

    // Wrong client header.
    g = await call2('POST', body, 'k',
      { 'x-daari-client': 'curl/8.0', 'x-forwarded-for': '10.0.0.9' });
    check('wrong X-Daari-Client -> 403', g.code, 403);

    // The header is allowed through CORS preflight, or the browser would strip it.
    g = await call2('OPTIONS', {}, 'k');
    check('preflight allows the custom header',
      /X-Daari-Client/.test(g.headers['Access-Control-Allow-Headers']), true);

    // Oversized body.
    g = await call2('POST', body, 'k',
      { 'x-daari-client': 'daari/0.5', 'content-length': '900000', 'x-forwarded-for': '10.0.0.8' });
    check('oversized content-length -> 413', g.code, 413);

    const fat = { goal: 'x', lang: 'en', elements: GOOD_ELEMENTS, junk: 'y'.repeat(40000) };
    g = await call2('POST', fat, 'k',
      { 'x-daari-client': 'daari/0.5', 'x-forwarded-for': '10.0.0.7' });
    check('oversized actual body -> 413, even with an honest header', g.code, 413);

    // Too many elements: refused, not quietly trimmed.
    const many = [];
    for (let i = 0; i < 200; i++) { many.push({ i, tag: 'a', type: '', name: 'x' + i, filled: false }); }
    g = await call2('POST', { goal: 'x', lang: 'en', elements: many }, 'k',
      { 'x-daari-client': 'daari/0.5', 'x-forwarded-for': '10.0.0.6' });
    check('200 elements -> 400 refused', g.code, 400);
    check('  and says what the limit is', /at most 80/.test(g.body.error), true);

    // Per-IP rate limit. One address, many tries; no key set, so nothing is
    // ever billed even if a request slipped through.
    let sawTooMany = false;
    let firstBlockAt = null;
    for (let n = 0; n < 70; n++) {
      const rr = await call2('POST', body, undefined,
        { 'x-daari-client': 'daari/0.5', 'x-forwarded-for': '203.0.113.5' });
      if (rr.code === 429) { sawTooMany = true; if (firstBlockAt === null) { firstBlockAt = n; } }
    }
    check('one address hammering it eventually gets 429', sawTooMany, true);
    check('  and is allowed a real session first (>=25 calls)', firstBlockAt >= 25, true);

    // A different address is unaffected.
    const other = await call2('POST', body, undefined,
      { 'x-daari-client': 'daari/0.5', 'x-forwarded-for': '198.51.100.2' });
    check('a different address is not punished for it', other.code === 429, false);
  }

  console.log('\n15. api/tts.js guards');
  {
    const tts = require(path.join(ROOT, 'api', 'tts.js'));
    const callTts = async (body, headers) => {
      const res = fakeRes();
      delete process.env.OPENAI_API_KEY;
      await tts({ method: 'POST', body, headers: headers || { 'x-daari-client': 'daari/0.5', 'x-forwarded-for': '10.1.1.1' } }, res);
      return res;
    };

    let t = await callTts({ text: 'hello' }, { 'x-forwarded-for': '10.1.1.2' });
    check('no client header -> 403', t.code, 403);

    t = await callTts({ text: 'x'.repeat(500) });
    check('over-long text -> 400', t.code, 400);
    check('  naming the 220 limit', /220/.test(t.body.error), true);

    t = await callTts({ text: '' });
    check('empty text -> 400', t.code, 400);
  }
}

console.log(failures === 0
  ? '\nAll checks passed.\n'
  : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
})();
