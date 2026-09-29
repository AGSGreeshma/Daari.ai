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
    Object, Math, Map, Set, Array, Boolean, Error, URL, fetch: fakeFetch,
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
/* Recipes only run on their own site, so every start-a-flow call has to say
   where it is. Tests about the practice recipe start on the practice site. */
const START_URL = SEARCH_URL;
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
    const reply = await call({ type: 'DAARI_START_FLOW', url: START_URL, goal, tabId: 1  });
    check(label, reply.flowId, want);
  }
}

console.log('\n2b. The confirm gate word rules');
{
  const NC = ctx.self.DAARI_NEEDS_CONFIRM;

  // RULE ONE: one word is enough.
  [
    'Pay ₹378', 'Pay now', 'Proceed to payment', 'Continue to Payment',
    'Submit application', 'Confirm booking', 'Booking Confirmed',
    'చెల్లించు',              // Telugu: pay
    'भुगतान करें'         // Hindi: make payment
  ].forEach((name) => check('gates on one word: "' + name + '"', NC(name), true));

  // RULE TWO: cancelling needs a cancel word AND a booking word, any order,
  // anything in between. This is the gap that was fixed: the list used to hold
  // the single phrase "cancel ticket", and "Cancel a ticket" defeated it.
  [
    'Cancel ticket',
    'Cancel a ticket',                 // the phrasing that used to slip through
    'Cancel this booking',
    'Cancel my reservation',
    'Ticket cancellation',             // reversed order
    'Cancellation of booking',
    'Cancel the ticket now please',    // words in between
    'Cancel PNR',
    'टिकट रद्द करें',   // Hindi: cancel ticket
    'रद्द टिकट',                            // Hindi, reversed
    'టికెట్ రద్దు'           // Telugu: ticket cancel
  ].forEach((name) => check('gates on cancel+booking: "' + name + '"', NC(name), true));

  // A cancel word with NO booking word is a help page or a menu tab. Stopping
  // someone from reading the rules is a false stop for no gain.
  [
    'Cancellations',                   // the menu tab - the case that drove this
    'Cancellation rules',
    'Cancellation policy',
    'Refund and cancellation charges'
  ].forEach((name) => check('does NOT gate: "' + name + '"', NC(name), false));

  // A booking word with no cancel word is not enough either.
  ['Book Ticket', 'Book', 'PNR Status', 'Ticket history']
    .forEach((name) => check('does NOT gate: "' + name + '"', NC(name), false));

  // Ordinary controls stay ungated.
  ['From station *', 'Send OTP', 'Card number *', 'Age *', 'Search Trains', '']
    .forEach((name) => check('does NOT gate: "' + (name || '(empty)') + '"', NC(name), false));

  // A known, deliberate gap, recorded so it is a decision and not an accident:
  // a bare "Cancel" with nothing else in its label gets through.
  check('KNOWN GAP: a bare "Cancel" does not gate', NC('Cancel'), false);
}

console.log('\n2c. THE GATE DECISION: what a thing says AND what it is');
{
  const MUST = ctx.self.DAARI_MUST_CONFIRM;
  const ACT = ctx.self.DAARI_IS_ACTIONABLE;
  const el = (tag, type, name) => ({ tag: tag, type: type, name: name });

  // --- what counts as something that ACTS
  check('<button> acts', ACT(el('button', 'submit', 'x')), true);
  check('<input type=submit> acts', ACT(el('input', 'submit', 'x')), true);
  check('<input type=image> acts', ACT(el('input', 'image', 'x')), true);
  check('a link with role=button acts', ACT(el('a', 'button', 'x')), true);
  check('a plain link does not', ACT(el('a', '', 'x')), false);
  check('a tab does not', ACT(el('a', 'tab', 'x')), false);
  check('a text box does not', ACT(el('input', 'text', 'x')), false);
  check('a dropdown does not', ACT(el('select', '', 'x')), false);

  // --- RULE 1: it acts, and its words are dangerous
  [
    ['button', 'submit', 'Pay ₹378'],
    ['button', 'submit', 'Submit application'],
    ['button', 'button', 'Confirm booking'],
    ['input', 'submit', 'Proceed to payment'],
    ['a', 'button', 'Checkout'],
    ['button', 'button', 'Cancel booking'],
    // A BARE "Cancel" on a real control now gates. That was the known gap, and
    // it is safe to close here precisely because we know this is a button and
    // not a menu tab.
    ['button', 'button', 'Cancel'],
    ['button', 'button', 'रद्द करें']
  ].forEach(function (row) {
    check('GATES (rule 1, it acts): <' + row[0] + '> "' + row[2] + '"',
      MUST(el(row[0], row[1], row[2])), true);
  });

  // --- RULE 2: a LINK that names a booking it would cancel
  [
    'Cancel this booking',
    'Cancel a ticket',
    'Ticket cancellation',
    'टिकट रद्द करें'
  ].forEach(function (name) {
    check('GATES (rule 2, link cancels a booking): "' + name + '"',
      MUST(el('a', '', name)), true);
  });

  // --- RULE 3: a LINK naming money AND an amount
  check('GATES (rule 3, link with an amount): "Pay ₹378"',
    MUST(el('a', '', 'Pay ₹378')), true);
  check('GATES (rule 3): "Pay 500 now"', MUST(el('a', '', 'Pay 500 now')), true);

  // --- what must NOT gate
  [
    ['a', '', 'Cancellations'],               // the menu tab that drove all this
    ['a', '', 'Cancellation rules'],
    ['a', '', 'Cancellation policy'],
    ['a', '', 'Payment options'],             // money word, no amount, just a link
    ['a', '', 'Net banking'],
    ['a', '', 'Book Ticket'],
    ['a', '', 'PNR Status'],
    ['input', 'text', 'Card number *'],
    ['input', 'text', 'From station *'],
    ['button', 'submit', 'Search Trains'],
    ['button', 'button', 'Send OTP'],
    ['select', '', 'Class'],
    ['button', 'button', '']
  ].forEach(function (row) {
    check('does NOT gate: <' + row[0] + '> "' + (row[2] || '(no name)') + '"',
      MUST(el(row[0], row[1], row[2])), false);
  });

  check('nothing at all does not gate', MUST(null), false);

  /* THE PAIR THAT JUSTIFIES THE WHOLE DESIGN. The same word, opposite
     consequences, settled by what the control IS rather than what it says. */
  check('LINK "Cancellations" stays open, BUTTON "Cancel" is stopped',
    [MUST(el('a', '', 'Cancellations')), MUST(el('button', 'button', 'Cancel'))],
    [false, true]);

  /* THE GAP THAT REMAINS, recorded so it reads as a decision rather than an
     oversight. Rule 3 needs an amount; a bare "Pay Now" link has none, and
     catching it would also stop every "Payment options" link. */
  check('KNOWN GAP: a bare "Pay Now" LINK is not caught',
    MUST(el('a', '', 'Pay Now')), false);
  check('  but the same words on a button are', MUST(el('button', 'button', 'Pay Now')), true);
}

console.log('\n2d. A recipe only ever runs on its OWN site');
{
  /* This section exists because of a real failure on a real site. On
     irctc.co.in the practice-site recipe matched the goal "book a ticket", found
     From and To by luck, the panel announced "Step 3 of 15", and then Daari said
     "I am not sure" at the Class step. Confidently wrong on somebody's real
     booking page is the worst thing Daari can do. */

  const APPLIES = ctx.self.DAARI_RECIPE_APPLIES;
  const HOST = ctx.self.DAARI_HOST_OF;
  const recipes = JSON.parse(JSON.stringify(ctx.self.DAARI_FLOWS || {}));

  check('hostname of a normal url', HOST('https://www.irctc.co.in/nget/train-search'), 'www.irctc.co.in');
  check('hostname with a port', HOST('http://localhost:3000/practice/'), 'localhost');
  check('hostname of rubbish', HOST('not a url'), '');
  check('hostname of nothing', HOST(undefined), '');

  const practice = {
    hosts: ['daari-ai.vercel.app', 'localhost', '127.0.0.1'],
    path_prefix: '/practice/'
  };

  // Where it SHOULD run.
  [
    'https://daari-ai.vercel.app/practice/',
    'https://daari-ai.vercel.app/practice/passenger.html',
    'http://localhost:3000/practice/index.html',
    'http://127.0.0.1:3000/practice/results.html'
  ].forEach(function (url) {
    check('runs on ' + url, APPLIES(practice, url), true);
  });

  // THE BUG: real booking sites. A matching goal must change nothing.
  [
    'https://www.irctc.co.in/nget/train-search',
    'https://irctc.co.in/',
    'https://www.redbus.in/',
    'https://redbus.in/bus-tickets/hyderabad-to-warangal',
    'https://www.abhibus.com/',
    'https://abhibus.com/bus-booking'
  ].forEach(function (url) {
    check('does NOT run on ' + url, APPLIES(practice, url), false);
  });

  // Right host, wrong part of it: the landing page is not the practice site.
  check('not on the landing page of its own host',
    APPLIES(practice, 'https://daari-ai.vercel.app/'), false);
  check('not on the repo README either',
    APPLIES(practice, 'https://daari-ai.vercel.app/site/index.html'), false);

  // A lookalike hostname must not slip through.
  check('not on a lookalike host',
    APPLIES(practice, 'https://daari-ai.vercel.app.evil.com/practice/'), false);

  // Subdomain wildcards, for recipes that need them.
  const wild = { hosts: ['*.irctc.co.in'] };
  check('wildcard covers a subdomain', APPLIES(wild, 'https://www.irctc.co.in/x'), true);
  check('wildcard covers the bare domain', APPLIES(wild, 'https://irctc.co.in/x'), true);
  check('wildcard is not fooled by a suffix match',
    APPLIES(wild, 'https://notirctc.co.in/x'), false);

  // IT FAILS CLOSED. This is the property that stops the bug coming back.
  check('a recipe with NO hosts runs nowhere',
    APPLIES({ steps: [] }, 'https://daari-ai.vercel.app/practice/'), false);
  check('a recipe with an empty hosts list runs nowhere',
    APPLIES({ hosts: [] }, 'https://daari-ai.vercel.app/practice/'), false);
  check('a disabled recipe runs nowhere',
    APPLIES({ hosts: ['daari-ai.vercel.app'], enabled: false },
      'https://daari-ai.vercel.app/practice/'), false);

  // And the REAL recipe files, as shipped.
  const shipped = {};
  for (const file of fs.readdirSync(path.join(EXT, 'recipes'))) {
    if (!file.endsWith('.json')) { continue; }
    const r = JSON.parse(fs.readFileSync(path.join(EXT, 'recipes', file), 'utf8'));
    shipped[r.task] = r;
  }

  ['book-ticket', 'check-pnr'].forEach(function (task) {
    check(task + ' declares its hosts', Array.isArray(shipped[task].hosts) &&
      shipped[task].hosts.length > 0, true);
    check(task + ' runs on the practice site',
      APPLIES(shipped[task], 'https://daari-ai.vercel.app/practice/index.html'), true);
    ['https://www.irctc.co.in/nget/train-search',
     'https://www.redbus.in/',
     'https://www.abhibus.com/'].forEach(function (url) {
      check(task + ' does NOT run on ' + HOST(url),
        APPLIES(shipped[task], url), false);
    });
  });

  check('the stub real-site recipe runs nowhere yet',
    APPLIES(shipped['real-pnr'], 'https://www.irctc.co.in/'), false);
}

console.log('\n2e. Matching a goal requires the right site TOO');
{
  /* The end-to-end version of the same thing, through the real worker: a goal
     that matches perfectly must still produce no recipe on the wrong site. */
  const start = async (goal, url, flowId) => {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    return call({ type: 'DAARI_START_FLOW', goal: goal, url: url, flowId: flowId, tabId: 1 });
  };

  const PRACTICE = 'https://daari-ai.vercel.app/practice/index.html';

  let r = await start('I want to book a train ticket', PRACTICE);
  check('on the practice site, a matching goal finds the recipe', r.flowId, 'book-ticket');

  // The reported bug, end to end.
  for (const url of ['https://www.irctc.co.in/nget/train-search',
                     'https://www.redbus.in/',
                     'https://www.abhibus.com/']) {
    r = await start('I want to book a train ticket', url);
    check('no recipe on ' + ctx.self.DAARI_HOST_OF(url) + ' despite a matching goal',
      [r.flowId, r.aiOnly], [null, true]);
  }

  // Telugu goal, same rule.
  r = await start('నాకు ట్రైన్ టికెట్ బుక్ చేయాలి', 'https://www.irctc.co.in/');
  check('no recipe on IRCTC for the Telugu goal either', r.flowId, null);

  // PNR goal on a real railway site: tempting, still refused.
  r = await start('check my PNR status', 'https://www.irctc.co.in/nget/train-search');
  check('no recipe on IRCTC for a PNR goal', r.flowId, null);
  r = await start('check my PNR status', PRACTICE);
  check('but it works on the practice site', r.flowId, 'check-pnr');

  // "Start demo on this page" is refused off-site, and creates no session.
  r = await start('book a ticket', 'https://www.irctc.co.in/', 'book-ticket');
  check('forcing the demo off-site is refused', [r.ok, r.wrongSite], [false, true]);
  check('  and the refusal names the site', /irctc/.test(r.reason || ''), true);
  check('  and NO session was created', storage.session.daariSession, undefined);

  r = await start('book a ticket', PRACTICE, 'book-ticket');
  check('forcing the demo on its own site works', r.flowId, 'book-ticket');

  /* And a session that WANDERS: started on the practice site, then the user
     opens a real site in the same tab. The recipe must stop applying, and the
     panel must stop claiming a step count from it. */
  const els = [{ i: 0, tag: 'input', type: 'text', name: 'From station *', filled: false }];
  let step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    { url: PRACTICE, title: 'practice', elements: els }));
  check('on its own site the recipe drives, 15 steps', step.total, 15);

  step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    { url: 'https://www.irctc.co.in/nget/train-search', title: 'IRCTC', elements: els }));
  check('wandering off-site drops the recipe', step.total, 0);
  check('  so the panel cannot say "of 15"', step.offSite, true);

  const status = await call({ type: 'DAARI_GET_STATUS' });
  check('  and the status agrees', [status.total, status.offSite], [0, true]);

  step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    { url: PRACTICE, title: 'practice', elements: els }));
  check('coming back restores the recipe', [step.total, step.offSite], [15, false]);
}

console.log('\n2f. PACING: the step waits for the user');
{
  /* These rules are behavioural -- "advances on blur, on Enter, or after 2.5
     seconds of not typing" cannot be checked by reading the code. So the real
     watchForDone from overlay.js runs here against a fake DOM and a fake clock.

     It exists because real testing said the steps "rush ahead while I am still
     typing a station name". Typing one letter of "Secunderabad" is not finishing
     the step. */

  // ---- a fake clock, so 2.5 seconds costs nothing ------------------------
  let now = 0;
  let timers = [];
  let nextTimerId = 1;
  const fakeSetTimeout = (fn, ms) => {
    const id = nextTimerId++;
    timers.push({ id: id, at: now + (ms || 0), fn: fn });
    return id;
  };
  const fakeClearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
  function tick(ms) {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) { break; }
      timers = timers.filter((t) => t !== due);
      now = due.at;
      due.fn();
    }
    now = until;
  }

  // ---- a fake element, just enough of one --------------------------------
  function makeField(attrs) {
    const listeners = {};
    return {
      tagName: 'INPUT',
      type: 'text',
      value: (attrs && attrs.value) || '',
      _attrs: Object.assign({}, attrs && attrs.attrs),
      addEventListener: function (name, fn) {
        (listeners[name] = listeners[name] || []).push(fn);
      },
      removeEventListener: function (name, fn) {
        listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
      },
      getAttribute: function (n) {
        return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null;
      },
      hasAttribute: function (n) {
        return Object.prototype.hasOwnProperty.call(this._attrs, n);
      },
      getBoundingClientRect: function () { return { width: 120, height: 24, top: 10, left: 10, bottom: 34, right: 130 }; },
      // test helpers
      fire: function (name, event) {
        (listeners[name] || []).slice().forEach((fn) => fn(event || {}));
      },
      type_: function (text) { this.value += text; this.fire('input'); }
    };
  }

  /* Pull the REAL watchForDone out of overlay.js and run it with everything it
     touches stubbed. Not a copy of the logic -- the shipped logic. */
  function makeWatcher(field, opts) {
    const src = fs.readFileSync(path.join(EXT, 'content', 'overlay.js'), 'utf8');
    const from = src.indexOf('  function watchForDone(');
    const to = src.indexOf('  /* ====', from);
    if (from === -1 || to === -1) { throw new Error('could not find watchForDone'); }

    const listOpen = { value: (opts && opts.listOpen) || false };
    const optionVisible = { value: false };

    const sandbox = {
      console: console,
      String: String, Number: Number, Object: Object, Array: Array, RegExp: RegExp,
      // the element under test, at index 0
      lastList: [{ el: field, data: { i: 0, tag: 'input', type: 'text', name: 'From station *', filled: !!field.value } }],
      isFilled: function (el) { return String(el.value || '').length > 0; },
      serializePage: function () { return [{ i: 0, name: 'From station *' }]; },
      DAARI_RESOLVE_BY_NAME: function () { return 0; },
      visiblePageText: function () { return ''; },
      window: { setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout },
      MutationObserver: function (cb) {
        this.observe = function () { sandbox.__mutate = cb; };
        this.disconnect = function () { sandbox.__mutate = null; };
      },
      document: {
        documentElement: {},
        addEventListener: function () {},
        removeEventListener: function () {},
        getElementById: function () {
          return listOpen.value
            ? { getBoundingClientRect: () => ({ width: 200, height: 100 }) } : null;
        },
        querySelector: function () {
          return optionVisible.value
            ? { getBoundingClientRect: () => ({ width: 200, height: 20 }) } : null;
        }
      }
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src.slice(from, to) + '\n;this.__watchForDone = watchForDone;', sandbox);

    const done = { count: 0, why: null };
    const hints = [];
    const stop = sandbox.__watchForDone('field_filled', 0,
      function (why) { done.count += 1; done.why = why; },
      function (key) { hints.push(key); });

    return {
      done: done, hints: hints, stop: stop,
      openList: function () { listOpen.value = true; if (sandbox.__mutate) { sandbox.__mutate(); } },
      closeList: function () { listOpen.value = false; if (sandbox.__mutate) { sandbox.__mutate(); } }
    };
  }

  // ---- THE BUG: one keystroke used to finish the step --------------------
  {
    const field = makeField();
    const w = makeWatcher(field);
    field.type_('S');
    check('one keystroke does NOT finish the step', w.done.count, 0);
    field.type_('ecunderabad');
    tick(1000);
    check('still not finished a second later', w.done.count, 0);
    tick(1400);
    check('still not finished at 2.4s', w.done.count, 0);
    tick(200);
    check('finishes after 2.5s of not typing', w.done.count, 1);
    check('  and says why', w.done.why, 'stopped typing');
  }

  // ---- typing again restarts the wait -----------------------------------
  {
    const field = makeField();
    const w = makeWatcher(field);
    field.type_('Sec');
    tick(2000);
    field.type_('underabad');          // still going
    tick(2000);
    check('typing again restarts the 2.5s wait', w.done.count, 0);
    tick(600);
    check('  and it finishes 2.5s after the LAST keystroke', w.done.count, 1);
  }

  // ---- leaving the box finishes it at once ------------------------------
  {
    const field = makeField();
    const w = makeWatcher(field);
    field.type_('Kazipet');
    field.fire('blur');
    check('leaving the box finishes immediately', w.done.count, 1);
    check('  and says why', w.done.why, 'left the box');
  }

  // ---- Enter finishes it at once ----------------------------------------
  {
    const field = makeField();
    const w = makeWatcher(field);
    field.type_('Kazipet');
    field.fire('keydown', { key: 'Enter' });
    check('Enter finishes immediately', w.done.count, 1);
    check('  and says why', w.done.why, 'pressed Enter');
  }

  // ---- an empty box never finishes, however long you wait ---------------
  {
    const field = makeField();
    const w = makeWatcher(field);
    field.fire('blur');
    tick(10000);
    check('an empty box never finishes on blur', w.done.count, 0);
    field.fire('keydown', { key: 'Enter' });
    check('  nor on Enter', w.done.count, 0);
  }

  // ---- a PRE-FILLED box is not skipped ---------------------------------
  {
    const field = makeField({ value: 'NEW DELHI', attrs: {} });
    const w = makeWatcher(field);
    check('a pre-filled box asks the user to check it', w.hints[0], 'prefilledCheck');
    tick(10000);
    check('  and does NOT auto-skip, however long we wait', w.done.count, 0);
    field.fire('blur');
    check('  nor when the user simply leaves it', w.done.count, 0);
    // Only once they have actually changed it.
    field.type_('!');
    tick(2600);
    check('  but finishes once they change it and settle', w.done.count, 1);
  }

  // ---- an AUTOCOMPLETE waits for a suggestion to be chosen -------------
  {
    const field = makeField({ attrs: { 'aria-expanded': 'false', 'aria-controls': 'list1' } });
    const w = makeWatcher(field);
    field.type_('Secun');
    w.openList();
    tick(200);
    check('an open list asks the user to pick from it', w.hints.indexOf('pickFromList') !== -1, true);
    tick(5000);
    check('  and 2.5s of not typing does NOT finish while it is open', w.done.count, 0);
    field.fire('blur');
    check('  nor does leaving the box', w.done.count, 0);
    w.closeList();
    tick(200);
    check('  it finishes when a suggestion closes the list', w.done.count, 1);
    check('  and says why', w.done.why, 'picked from the list');
  }

  // ---- an autocomplete whose list never opens still finishes -----------
  {
    const field = makeField({ attrs: { 'aria-autocomplete': 'list' } });
    const w = makeWatcher(field);
    field.type_('Warangal');
    tick(2600);
    check('an autocomplete whose list never opens falls back to the 2.5s rule',
      w.done.count, 1);
  }

  // ---- stopping detaches everything ------------------------------------
  {
    const field = makeField();
    const w = makeWatcher(field);
    field.type_('Kazipet');
    w.stop();
    tick(10000);
    check('after stop(), nothing fires', w.done.count, 0);
  }
}

console.log('\n2g. Manual advance: exactly one step, and back again');
{
  const els = [{ i: 0, tag: 'input', type: 'text', name: 'From station *', filled: false }];
  const at = (url, elements) => ({ url: url, title: 'practice', elements: elements || els });
  const PRACTICE = 'https://daari-ai.vercel.app/practice/index.html';

  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiFail = 500;   // recipe-only, so the walk is deterministic
  await call({ type: 'DAARI_START_FLOW', url: PRACTICE, goal: 'book a train ticket', tabId: 1 });

  let step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, at(PRACTICE)));
  check('starts at step 1', step.number, 1);

  step = await call(Object.assign({ type: 'DAARI_STEP_DONE' }, at(PRACTICE)));
  check('one manual Done advances exactly one step', step.number, 2);

  step = await call(Object.assign({ type: 'DAARI_STEP_DONE' }, at(PRACTICE)));
  check('again: exactly one more', step.number, 3);

  step = await call(Object.assign({ type: 'DAARI_STEP_BACK' }, at(PRACTICE)));
  check('Go back returns exactly one step', step.number, 2);

  step = await call(Object.assign({ type: 'DAARI_STEP_BACK' }, at(PRACTICE)));
  check('and again', step.number, 1);

  step = await call(Object.assign({ type: 'DAARI_STEP_BACK' }, at(PRACTICE)));
  check('going back at step 1 stays at step 1', step.number, 1);

  /* Going back must clear a confirmation: that answer was about the step they
     are leaving, not the one they are returning to. */
  await call({ type: 'DAARI_CONFIRMED' });
  step = await call(Object.assign({ type: 'DAARI_STEP_BACK' }, at(PRACTICE)));
  check('going back clears any confirmation given', step.confirmed, false);
}

console.log('\n3. The AI path: model agrees with the recipe');
{
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiRequests.length = 0; aiFail = null;
  // The recipe wants "from station", which is index 4.
  aiReply = { elementIndex: 4, speech: 'Type your starting station here',
              done_when: 'field_filled', stopAndConfirm: false, confidence: 0.9 };

  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1  });
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
    await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1  });
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
  check('  reason names the confidence and the bar', s.why, 'model unsure (0.2 < 0.45)');

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
  check('  reason names both attempts', s.why, 'timeout, then timeout');

  // API down entirely -> recipe wins. THIS IS THE DEMO SAFETY NET.
  s = await decideWith(null, 500);
  check('API 500 -> fallback', s.path, 'fallback');
  check('  reason names both attempts', s.why, 'http 500, then http 500');
  check('  still points at the right element', s.index, 4);
  check('  still speaks the right sentence', s.say, RECIPE_SAY_EN);
}

console.log('\n5. The whole booking completes with the API dead');
{
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiFail = 500; aiReply = null;
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1  });

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

  const started = await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'find something', tabId: 1  });
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
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'find something', tabId: 1  });
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
  await call({ type: 'DAARI_START_FLOW', url: START_URL, flowId: 'book-ticket', goal: 'book', tabId: 1  });
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

  /* The model's stopAndConfirm depends on whether ITS answer was accepted.

     ACCEPTED: it may add a stop to the element it chose. That is the "can only
     add, never remove" rule.

     DISCARDED: its opinion goes with its answer. We are no longer pointing where
     it said, so its judgement is about a different element than the one on
     screen. This is what fixed 8 of the 9 false stops in the first live run,
     where it asked to stop on "From station", "To station", "Class" and
     "PNR number" while the recipe was overruling it. */

  // ACCEPTED answer, with no recipe to disagree with -> its stop counts.
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  const ORDINARY = [{ i: 0, tag: 'input', type: 'text', name: 'Some box', filled: false }];
  aiReply = { goal_supported: true, elementIndex: 0, speech: 'Type here',
              done_when: 'field_filled', stopAndConfirm: true, confidence: 0.9 };
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'do a thing', tabId: 1  });
  s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://somewhere.else/x', ORDINARY)));
  check('an ACCEPTED answer may add a stop', [s.path, s.gate], ['gate', true]);

  /* DISCARDED answer -> its stop is dropped with it. The recipe wants "from
     station" at index 0; the model picks index 1 and asks for a stop. The
     element we actually point at is the recipe's, so the model's opinion about
     a different element does not travel with it. */
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiReply = { goal_supported: true, elementIndex: 7, speech: 'Press Search',
              done_when: 'clicked', stopAndConfirm: true, confidence: 0.9 };
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1  });
  s = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
  check('a DISCARDED answer loses its stop too', [s.path, s.gate], ['fallback', false]);
  check('  it is still recorded, so the ask is visible', s.modelWantedStop, true);
  check('  and the recipe step runs normally', s.index, 4);

  // Our own list decides regardless of what the model says.
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  const DANGEROUS = [{ i: 0, tag: 'button', type: 'submit', name: 'Pay ₹500', filled: false }];
  aiReply = { goal_supported: true, elementIndex: 0, speech: 'Press it',
              done_when: 'url_changed', stopAndConfirm: false, confidence: 0.9 };
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'do a thing', tabId: 1  });
  s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://somewhere.else/x', DANGEROUS)));
  check('our word list still stops, even when the model says not to', s.gate, true);

  /* And the gate no longer fires on a LINK, however alarming its label. */
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  const SCARY_LINK = [{ i: 0, tag: 'a', type: '', name: 'Cancel this booking', filled: false }];
  aiReply = { goal_supported: true, elementIndex: 0, speech: 'Press it',
              done_when: 'url_changed', stopAndConfirm: false, confidence: 0.9 };
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'do a thing', tabId: 1  });
  s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://somewhere.else/x', SCARY_LINK)));
  check('a LINK saying "Cancel this booking" GATES (it names a booking)', s.gate, true);

  // The same words on a BUTTON do.
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  const SCARY_BUTTON = [{ i: 0, tag: 'button', type: 'button', name: 'Cancel this booking', filled: false }];
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'do a thing', tabId: 1  });
  s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://somewhere.else/x', SCARY_BUTTON)));
  check('a BUTTON saying "Cancel this booking" GATES', s.gate, true);
}

console.log('\n7c. No recipe means a higher bar for confidence');
{
  const PLAIN = [{ i: 0, tag: 'button', type: 'button', name: 'Continue', filled: false }];

  // 0.5 clears the recipe-backed bar of 0.45 but not the alone bar of 0.7.
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiFail = null;
  aiReply = { goal_supported: true, elementIndex: 0, speech: 'Press Continue',
              done_when: 'clicked', stopAndConfirm: false, confidence: 0.5 };
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'do a thing', tabId: 1  });
  let s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://somewhere.else/x', PLAIN)));
  check('0.5 with no recipe is not believed', s.path, 'none');
  check('  and the bar is named in the reason', s.why, 'model unsure (0.5 < 0.7)');

  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiReply.confidence = 0.75;
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'do a thing', tabId: 1  });
  s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://somewhere.else/x', PLAIN)));
  check('0.75 with no recipe is believed', s.path, 'ai');
}

console.log('\n7b. goal_supported: saying "I am not sure" and meaning it');
{
  const PAYMENT = [
    { i: 0, tag: 'input', type: 'text', name: 'Card number *', filled: false },
    { i: 1, tag: 'button', type: 'submit', name: 'Pay ₹263', filled: false }
  ];

  /* The real failure this fixes: asked in Hindi to apply for a passport, on the
     payment page, the live model pointed at the Pay button with confidence 0.9.
     Confidence could not catch it, because 30 of 31 answers came back at 0.9 --
     a constant, not a judgement. */
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiFail = null;
  aiReply = { goal_supported: false, elementIndex: 1, speech: 'Press Pay',
              done_when: 'url_changed', stopAndConfirm: false, confidence: 0.9 };
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'apply for a passport', tabId: 1  });
  let s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://x.dev/payment.html', PAYMENT)));
  check('a false goal_supported overrides a confident element choice', s.path, 'none');
  check('  points at nothing', s.index, -1);
  check('  and says so', s.say, ctx.self.DAARI_STRINGS.ui.notSure.en);
  check('  with the reason recorded', s.why, 'model says the goal cannot be done here');

  /* And it must not block a legitimate answer. The goal deliberately contains
     no recipe match_phrase, so this really is the model working alone -- a goal
     mentioning "ticket" would match the booking recipe and be judged against
     its first step instead. */
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiReply = { goal_supported: true, elementIndex: 0, speech: 'Type your card number here',
              done_when: 'field_filled', stopAndConfirm: false, confidence: 0.9 };
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'complete this form', tabId: 1  });
  s = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    page('https://x.dev/payment.html', PAYMENT)));
  check('a true goal_supported lets the answer through', s.path, 'ai');
  check('  pointing at the card box', s.index, 0);
}

console.log('\n8. Rule 2: nothing the user typed can leave');
{
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiRequests.length = 0; aiFail = null;
  aiReply = { elementIndex: 4, speech: 'ok', done_when: 'field_filled',
              stopAndConfirm: false, confidence: 0.9 };
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1  });
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
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1  });
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
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1  });

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
  await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1  });

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
