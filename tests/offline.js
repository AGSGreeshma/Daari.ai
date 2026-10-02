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

console.log('\n0. Nothing calls a function that does not exist');
{
  /* This shipped three times: resolveByName renamed with a caller left behind,
     then acceptGoal and startFlow spliced out of sidepanel.js with their callers
     left behind. Every one parsed perfectly and every one broke the product --
     the first threw on every page Daari loaded on, the other two made the panel's
     two main buttons do nothing at all.

     This runs first because it is the cheapest check in the suite and the one
     that has caught the most real bugs. */
  const problems = require(path.join(ROOT, 'tests', 'lint.js')).run();
  check('no undefined function calls in any extension file', problems, 0);
}

console.log('\n0b. The side panel buttons actually do something');
{
  /* The lint finds a call to a function that is not there. This finds everything
     else that makes a button dead: a handler on the wrong element, a message with
     the wrong type, a guard returning early, a typo in an id.

     It loads the REAL config.js, strings.js, tts.js and sidepanel.js with a fake
     DOM and a fake chrome, and presses the buttons. */
  const { loadPanel } = require(path.join(ROOT, 'tests', 'smoke-panel.js'));

  // ---- it loads at all -------------------------------------------------
  {
    const panel = loadPanel();
    check('the panel loads without throwing', true, true);
    check('the language buttons were built', panel.el.langs.children.length, 3);
    check('the mic has a click handler', panel.el.mic._listens('click'), true);
    check('Start demo has a click handler', panel.el.startDemo._listens('click'), true);
    check('Yes, go has a click handler', panel.el.confirmSend._listens('click'), true);
    check('Done - next step has a click handler', panel.el.manualDone._listens('click'), true);
    check('Go back has a click handler', panel.el.manualBack._listens('click'), true);
  }

  // ---- "Start demo on this page", on the practice site ------------------
  {
    const panel = loadPanel({ tabUrl: 'https://daari-ai.vercel.app/practice/index.html' });
    panel.sent.length = 0;
    panel.el.startDemo._fire('click');
    await new Promise((r) => setImmediate(r));

    const start = panel.sent.filter((m) => m.type === 'DAARI_START_FLOW')[0];
    check('Start demo sends DAARI_START_FLOW', !!start, true);
    check('  forcing the practice recipe', start && start.flowId, 'book-ticket');
    check('  and passes the page address, which the host check needs',
      start && /practice/.test(start.url || ''), true);
    check('  and the tab id', start && start.tabId, 7);
    check('  then asks the page to report in',
      panel.toTab.some((t) => t.message.type === 'DAARI_ASK_AGAIN'), true);
  }

  // ---- "Start demo" off-site is refused, and says so --------------------
  {
    const panel = loadPanel({
      tabUrl: 'https://www.irctc.co.in/nget/train-search',
      replies: { DAARI_START_FLOW: { ok: false, wrongSite: true, reason: 'That recipe is for daari-ai.vercel.app, and this page is www.irctc.co.in.' } }
    });
    panel.el.startDemo._fire('click');
    await new Promise((r) => setImmediate(r));

    check('a refused start shows a message', /only runs on the practice site/.test(panel.el.message.textContent), true);
    check('  naming the site', /irctc/.test(panel.el.message.textContent), true);
    check('  and does NOT ask the page to start',
      panel.toTab.some((t) => t.message.type === 'DAARI_ASK_AGAIN'), false);
  }

  // ---- "Yes, go" sends the CORRECTED text ------------------------------
  {
    const panel = loadPanel({ tabUrl: 'https://daari-ai.vercel.app/practice/' });
    panel.el.confirmText.value = '  I want to book a train ticket to Kazipet  ';
    panel.sent.length = 0;
    panel.el.confirmSend._fire('click');
    await new Promise((r) => setImmediate(r));

    const start = panel.sent.filter((m) => m.type === 'DAARI_START_FLOW')[0];
    check('Yes, go starts a flow', !!start, true);
    check('  with the text from the box, trimmed',
      start && start.goal, 'I want to book a train ticket to Kazipet');
    check('  and no forced recipe, so the goal picks one',
      start && start.flowId, undefined);
    check('  and the goal is shown back to the user',
      /Kazipet/.test(panel.el.goal.children.map((c) => c.textContent).join(' ')), true);
  }

  // ---- an empty confirm box sends nothing ------------------------------
  {
    const panel = loadPanel();
    panel.el.confirmText.value = '   ';
    panel.sent.length = 0;
    panel.el.confirmSend._fire('click');
    await new Promise((r) => setImmediate(r));
    check('an empty box starts nothing',
      panel.sent.filter((m) => m.type === 'DAARI_START_FLOW').length, 0);
  }

  // ---- the manual controls reach the page ------------------------------
  {
    const panel = loadPanel();
    panel.el.manualDone._fire('click');
    await new Promise((r) => setImmediate(r));
    check('Done - next step reaches the page',
      panel.toTab.some((t) => t.message.type === 'DAARI_MANUAL_DONE'), true);

    panel.el.manualBack._fire('click');
    await new Promise((r) => setImmediate(r));
    check('Go back a step reaches the page',
      panel.toTab.some((t) => t.message.type === 'DAARI_MANUAL_BACK'), true);
  }

  // ---- the confirm gate button ----------------------------------------
  {
    const panel = loadPanel();
    panel.sent.length = 0;
    panel.el.confirm._fire('click');
    await new Promise((r) => setImmediate(r));
    check('I have checked sends DAARI_CONFIRMED',
      panel.sent.some((m) => m.type === 'DAARI_CONFIRMED'), true);
  }

  // ---- Stop guidance --------------------------------------------------
  {
    const panel = loadPanel();
    panel.sent.length = 0;
    panel.el.stopGuidance._fire('click');
    await new Promise((r) => setImmediate(r));
    check('Stop guidance sends DAARI_STOP_FLOW',
      panel.sent.some((m) => m.type === 'DAARI_STOP_FLOW'), true);
  }

  // ---- the mic, and the tap-to-send states ----------------------------
  {
    const panel = loadPanel({ lang: 'en' });
    /* Labels are applied once chrome.storage has handed back the saved language,
       which is a promise, so nothing is labelled until it settles. */
    await new Promise((r) => setImmediate(r));
    check('the mic starts as "Speak your goal"', panel.el.mic.textContent, 'Speak your goal');
    panel.el.mic._fire('click');
    check('tapping it starts listening and offers to send',
      panel.el.mic.textContent, 'Tap to send');
    check('  and Cancel appears', panel.el.micCancel.style.display, 'block');
    panel.el.micCancel._fire('click');
    check('Cancel returns it to idle', panel.el.mic.textContent, 'Speak your goal');
    check('  and hides Cancel', panel.el.micCancel.style.display, 'none');
  }

  // ---- a language button switches every label -------------------------
  {
    const panel = loadPanel({ lang: 'en' });
    await new Promise((r) => setImmediate(r));
    const telugu = panel.el.langs.children.filter((c) => c.dataset.code === 'te')[0];
    check('there is a Telugu button', !!telugu, true);
    telugu._fire('click');
    check('choosing Telugu saves it', panel.stored.lang, 'te');
    check('  and relabels the mic', panel.el.mic.textContent, 'మీ పని చెప్పండి');
    check('  and relabels Done - next step', panel.el.manualDone.textContent, 'అయింది - తర్వాత');
  }
}

console.log('\n0c. Onboarding: language, then how much help');
{
  /* Two questions, asked once, changeable forever after. The thing being
     guarded here is that LIGHT is what you get when anything goes wrong --
     light mode is today's tested behaviour, so an unreadable stored value or a
     half-finished onboarding can never leave somebody in a mode that was never
     exercised. */
  const { loadPanel } = require(path.join(ROOT, 'tests', 'smoke-panel.js'));

  // ---- the very first open shows it ------------------------------------
  {
    const panel = loadPanel({ seenOnboarding: false });
    await new Promise((r) => setImmediate(r));
    check('a first-time panel shows onboarding', panel.el.onboard.hidden, false);
    check('  with the help question hidden until a language is picked',
      panel.el.onboardHelp.hidden, true);
    check('  and the language question in all three scripts at once',
      /భాష/.test(panel.el.onboardLangPrompt.textContent) &&
      /भाषा/.test(panel.el.onboardLangPrompt.textContent) &&
      /Language/.test(panel.el.onboardLangPrompt.textContent), true);
    check('  and three language buttons', panel.el.onboardLangs.children.length, 3);
  }

  // ---- a returning panel does NOT show it ------------------------------
  {
    const panel = loadPanel({ seenOnboarding: true });
    await new Promise((r) => setImmediate(r));
    check('a panel that has been set up does not ask again',
      panel.el.onboard.hidden, true);
  }

  // ---- picking a language reveals the help question, in that language --
  {
    const panel = loadPanel({ seenOnboarding: false, lang: 'en' });
    await new Promise((r) => setImmediate(r));
    const telugu = panel.el.onboardLangs.children.filter((c) => c.dataset.code === 'te')[0];
    check('the onboarding cover has a Telugu button', !!telugu, true);
    telugu._fire('click');
    check('picking it saves the language', panel.stored.lang, 'te');
    check('  and reveals the help question', panel.el.onboardHelp.hidden, false);
    check('  asked in Telugu', panel.el.onboardHelpTitle.textContent,
      panel.sandbox.DAARI_GUIDANCE.onboarding.helpTitle.te);
    check('  and onboarding is still open, because nothing is answered yet',
      panel.el.onboard.hidden, false);
  }

  // ---- choosing a level saves it AND closes the cover ------------------
  {
    const panel = loadPanel({ seenOnboarding: false });
    await new Promise((r) => setImmediate(r));
    panel.el.helpFull._fire('click');
    check('Guide me fully saves full', panel.stored.helpLevel, 'full');
    check('  and closes onboarding', panel.el.onboard.hidden, true);
    check('  and remembers it was seen, so it is never asked twice',
      panel.stored.seenOnboarding, true);
  }
  {
    const panel = loadPanel({ seenOnboarding: false });
    await new Promise((r) => setImmediate(r));
    panel.el.helpLight._fire('click');
    check('Just show me where saves light', panel.stored.helpLevel, 'light');
    check('  and closes onboarding', panel.el.onboard.hidden, true);
  }

  // ---- it is never a one-way door --------------------------------------
  {
    const panel = loadPanel({ seenOnboarding: true, helpLevel: 'full' });
    await new Promise((r) => setImmediate(r));
    check('there is a way back in', panel.el.changeSetup._listens('click'), true);
    panel.el.changeSetup._fire('click');
    check('it reopens onboarding', panel.el.onboard.hidden, false);
    check('  with the help question already showing, since both are answerable',
      panel.el.onboardHelp.hidden, false);

    panel.el.helpLight._fire('click');
    check('and the level can be changed back', panel.stored.helpLevel, 'light');
    check('  closing it again', panel.el.onboard.hidden, true);
  }

  // ---- the panel always says which mode you are in ---------------------
  {
    const panel = loadPanel({ seenOnboarding: true, helpLevel: 'full', lang: 'te' });
    await new Promise((r) => setImmediate(r));
    check('the reopen button names the mode you are in',
      panel.el.changeSetup.textContent.indexOf(
        panel.sandbox.DAARI_GUIDANCE.onboarding.fullLabel.te) >= 0, true);
    panel.el.helpLight._fire('click');
    check('  and renames itself when the mode changes',
      panel.el.changeSetup.textContent.indexOf(
        panel.sandbox.DAARI_GUIDANCE.onboarding.lightLabel.te) >= 0, true);
  }

  // ---- LIGHT is what you get when anything is wrong --------------------
  {
    const panel = loadPanel({ seenOnboarding: true });
    await new Promise((r) => setImmediate(r));
    check('no stored level means light, not full', panel.el.helpLight.className,
      'help-level on');
    check('  and full is not marked on', panel.el.helpFull.className, 'help-level');
  }
  {
    const panel = loadPanel({ seenOnboarding: true, helpLevel: 'banana' });
    await new Promise((r) => setImmediate(r));
    check('an unreadable stored level falls back to light',
      panel.el.helpLight.className, 'help-level on');
  }

  // ---- every new string exists in all three languages ------------------
  {
    const G = loadPanel().sandbox.DAARI_GUIDANCE;
    let missing = [];
    Object.keys(G.onboarding).forEach((key) => {
      const entry = G.onboarding[key];
      if (typeof entry === 'string') { return; }   /* langPrompt is trilingual */
      ['te', 'hi', 'en'].forEach((code) => {
        if (!entry[code] || !String(entry[code]).trim()) {
          missing.push(key + '.' + code);
        }
      });
    });
    check('every onboarding string exists in te, hi and en', missing.join(','), '');
  }
}
console.log('\n0d. The path: where you are in the journey');
{
  /* "Step 7 of 15" is a number. "You are on the passenger page and payment is
     next" is a map, and for somebody who has never booked anything online the
     map is the thing.

     It is drawn from the step number the worker already broadcasts -- the panel
     asks for nothing new. So the one thing that can go wrong is the milestone
     boundaries drifting away from the recipe they describe, which is what the
     last check here guards. */
  const { loadPanel } = require(path.join(ROOT, 'tests', 'smoke-panel.js'));

  /* The dots, as a reader of the panel would see them. */
  function dots(panel) {
    return panel.el.path.children.map((row) => {
      const dot = row.children[0];
      const label = row.children[1];
      const state = /is-done/.test(row.className) ? 'done'
        : /is-now/.test(row.className) ? 'now' : 'ahead';
      return { state: state, tick: dot.textContent, label: label.textContent };
    });
  }

  async function at(number, extra) {
    const panel = loadPanel({ lang: 'en', seenOnboarding: true });
    await new Promise((r) => setImmediate(r));
    panel.chrome.__onMessage(Object.assign({
      type: 'DAARI_STATUS', active: true, number: number, total: 15,
      flowId: 'book-ticket'
    }, extra || {}));
    return panel;
  }

  // ---- nothing running, nothing drawn -------------------------------
  {
    const panel = loadPanel({ seenOnboarding: true });
    await new Promise((r) => setImmediate(r));
    panel.chrome.__onMessage({ type: 'DAARI_STATUS', active: false });
    check('with nothing running the path is hidden', panel.el.path.hidden, true);
    check('  and the finished card too', panel.el.doneCard.hidden, true);
  }

  // ---- the five milestones of a booking -----------------------------
  {
    const panel = await at(1);
    const shown = dots(panel);
    check('a booking shows five milestones', shown.length, 5);
    check('  named after the PAGES, which is what the user can see',
      shown.map((d) => d.label).join(','), 'Search,Trains,Passenger,Payment,Ticket');
    check('  with the first one current', shown[0].state, 'now');
    check('  and the rest still ahead',
      shown.slice(1).every((d) => d.state === 'ahead'), true);
    check('  and nothing ticked yet',
      shown.every((d) => d.tick === ''), true);
  }

  // ---- it moves as the steps move -----------------------------------
  {
    /* Boundaries: search 1-4, trains 5, passenger 6-12, payment 13-14,
       ticket 15 (step numbers, which are one-based). */
    const expected = [
      [1, 0], [4, 0],          // still searching
      [5, 1],                  // the results page
      [6, 2], [12, 2],         // the passenger page
      [13, 3], [14, 3],        // paying
      [15, 4]                  // the ticket
    ];
    let wrong = [];
    for (const [number, want] of expected) {
      const panel = await at(number);
      const shown = dots(panel);
      const now = shown.findIndex((d) => d.state === 'now');
      if (now !== want) {
        wrong.push('step ' + number + ' glowed milestone ' + now + ', wanted ' + want);
      }
    }
    check('the glowing milestone follows the step number', wrong.join(' | '), '');
  }

  // ---- what is behind you gets a tick -------------------------------
  {
    const shown = dots(await at(13));          // paying
    check('on the payment milestone, three are behind',
      shown.filter((d) => d.state === 'done').length, 3);
    check('  and each of those is ticked',
      shown.filter((d) => d.state === 'done').every((d) => d.tick === '✓'), true);
    check('  payment itself is the one glowing', shown[3].state, 'now');
    check('  and the ticket is still ahead', shown[4].state, 'ahead');
  }

  // ---- finished ticks everything ------------------------------------
  {
    const panel = await at(15, { finished: true });
    const shown = dots(panel);
    check('when it is finished every milestone is ticked',
      shown.every((d) => d.state === 'done'), true);
    check('  and the finished card appears', panel.el.doneCard.hidden, false);
    check('  saying so in the chosen language', panel.el.doneWords.textContent, 'Finished');
  }

  // ---- the PNR flow has its own, shorter path -----------------------
  {
    const panel = loadPanel({ lang: 'en', seenOnboarding: true });
    await new Promise((r) => setImmediate(r));
    panel.chrome.__onMessage({ type: 'DAARI_STATUS', active: true, number: 2,
      total: 4, flowId: 'check-pnr' });
    const shown = dots(panel);
    check('checking a PNR shows two milestones', shown.length, 2);
    check('  and step 2 is on the second one', shown[1].state, 'now');
    check('  with the first ticked', shown[0].tick, '✓');
  }

  // ---- NO SAVED ROUTE: Daari does not draw a map it does not have ---
  {
    /* The honest picture. Inventing five milestones for a site we have never
       seen would be the same lie as "Step 3 of 15" on irctc.co.in, which is a
       bug this project has already shipped once. */
    const panel = loadPanel({ lang: 'en', seenOnboarding: true });
    await new Promise((r) => setImmediate(r));
    panel.chrome.__onMessage({ type: 'DAARI_STATUS', active: true, number: 3,
      total: 0, flowId: null });
    const shown = dots(panel);
    check('with no saved route there is one dot, not five', shown.length, 1);
    check('  saying only which step it is', shown[0].label, 'Step 3');
    check('  and the path is marked as the plain kind',
      /path-plain/.test(panel.el.path.className), true);
  }

  // ---- off its own site, the same honesty --------------------------
  {
    const panel = await at(3, { offSite: true, total: 0 });
    const shown = dots(panel);
    check('off a recipe’s own site it does not draw that recipe’s path',
      shown.length, 1);
    check('  it says Step 3, not Step 3 of 15', shown[0].label, 'Step 3');
  }

  // ---- a language change redraws it -------------------------------
  {
    const panel = await at(5);
    check('the milestone is in English', dots(panel)[1].label, 'Trains');
    const telugu = panel.el.langs.children.filter((c) => c.dataset.code === 'te')[0];
    telugu._fire('click');
    panel.chrome.__onMessage({ type: 'DAARI_STATUS', active: true, number: 5,
      total: 15, flowId: 'book-ticket' });
    check('  and in Telugu after switching',
      dots(panel)[1].label, panel.sandbox.DAARI_GUIDANCE.pathLabels.results.te);
  }

  // ---- THE BOUNDARIES MUST MATCH THE RECIPES ----------------------
  {
    /* The milestones are display data in sidepanel.js, and the pages they
       describe live in the recipe JSON. Nothing stops those two drifting apart
       except this check: add a step to the middle of the booking recipe and the
       dots would quietly glow one milestone early for the rest of the flow. */
    const src = fs.readFileSync(path.join(EXT, 'sidepanel.js'), 'utf8');
    const block = src.slice(src.indexOf('var MILESTONES = {'),
                            src.indexOf('/* Draw the path for this status'));

    const files = { 'book-ticket': 'practice-book-ticket',
                    'check-pnr': 'practice-check-pnr' };
    let drift = [];
    Object.keys(files).forEach((flowId) => {
      const recipe = JSON.parse(fs.readFileSync(
        path.join(EXT, 'recipes', files[flowId] + '.json'), 'utf8'));

      /* The first step index of each page, in order, straight from the recipe. */
      const real = [];
      recipe.steps.forEach((step, i) => {
        if (step.page && !real.some((p) => p.page === step.page)) {
          real.push({ page: step.page, at: i });
        }
      });

      /* The "at" values the panel believes, for this flow. */
      const chunk = block.slice(block.indexOf("'" + flowId + "'"));
      const claimed = (chunk.slice(0, chunk.indexOf(']')).match(/at:\s*(\d+)/g) || [])
        .map((m) => Number(m.replace(/[^0-9]/g, '')));

      if (claimed.join(',') !== real.map((p) => p.at).join(',')) {
        drift.push(flowId + ': panel says [' + claimed.join(',') +
                   '] but the recipe starts its pages at [' +
                   real.map((p) => p.at).join(',') + ']');
      }
    });
    check('the milestone boundaries match the recipes they describe',
      drift.join(' | '), '');
  }
}
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

  /* --- CANCEL LINKS NAVIGATE; CANCEL BUTTONS ACT ------------------------

     A link labelled "Cancel a ticket" almost always goes TO a cancellation page,
     where the real button lives and gets stopped on arrival. Stopping the user on
     the way there is a false stop, and a stop that fires on the way to a page is
     one people learn to dismiss -- which makes every real stop worth less.

     Payment links are treated differently on purpose: money can move on the click
     itself, where a cancellation link takes you to a form. */
  [
    'Cancel this booking',
    'Cancel a ticket',
    'Cancel ticket',
    'Ticket cancellation',
    'Cancellations',
    'Cancellation rules',
    'टिकट रद्द करें'
  ].forEach(function (name) {
    check('LINK navigates, does NOT gate: "' + name + '"',
      MUST(el('a', '', name)), false);
  });

  // The same words on a BUTTON do act, and are stopped.
  [
    'Cancel ticket',
    'Cancel a ticket',
    'Cancel this booking',
    'Cancel my reservation',
    'Cancel',
    'टिकट रद्द करें'
  ].forEach(function (name) {
    check('BUTTON acts, GATES: "' + name + '"',
      MUST(el('button', 'button', name)), true);
  });

  /* The pair, stated once: same words, decided by what the control is. */
  check('LINK "Cancel ticket" open, BUTTON "Cancel ticket" stopped',
    [MUST(el('a', '', 'Cancel ticket')), MUST(el('button', 'button', 'Cancel ticket'))],
    [false, true]);

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

  /* THAT GAP IS NOW CLOSED. It used to be recorded here as a known limitation:
     rule 3 needed an amount, so a bare "Pay Now" link slipped through, and
     catching it looked like it would also stop every "Payment options" link.

     Rule 4 does it on the grammar instead -- "Pay" is a verb, "Payment" is a
     noun -- so both sides hold. Section 2h has the full matrix. */
  check('a bare "Pay Now" LINK is now gated', MUST(el('a', '', 'Pay Now')), true);
  check('  and "Payment options" still is not', MUST(el('a', '', 'Payment options')), false);
  check('  and the same words on a button, as ever', MUST(el('button', 'button', 'Pay Now')), true);
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

console.log('\n2h. A LINK that pays is gated; a page ABOUT paying is not');
{
  /* The last known gap: rule 3 needed an amount, so a bare "Pay Now" LINK with
     no amount and no role="button" was not gated. Rule 4 closes it on the
     grammar -- "Pay" is a verb, "Payment" is a noun -- which is why every
     pattern is anchored on a word boundary. "Payment options" must never match
     /^pay/. */

  const MUST = ctx.self.DAARI_MUST_CONFIRM;
  const link = (name) => ({ tag: 'a', type: '', name: name });

  // MUST GATE: the name is an action that takes money.
  [
    'Pay',
    'Pay Now',
    'Pay now',
    'PAY NOW',
    'Pay securely',
    'Pay ₹378',
    'Pay 500',
    'Pay the fare',
    'Pay balance',
    'Make payment',
    'Make the payment',
    'Complete payment',
    'Complete your payment',
    'Confirm payment',
    'Proceed to pay',
    'Continue to pay',
    'Proceed to payment',
    'Confirm and pay',
    'Finish payment',
    'చెల్లించు',                        // Telugu: pay
    'ఇప్పుడే చెల్లించండి',  // Telugu: pay now
    'भुगतान करें',                  // Hindi: make payment
    'भुगतान कीजिए'             // Hindi: make payment (polite)
  ].forEach(function (name) {
    check('LINK GATES: "' + name + '"', MUST(link(name)), true);
  });

  // MUST NOT GATE: informational. A stop on a help page is one people learn to
  // dismiss without reading, which makes every real stop worth less.
  [
    'Payment options',
    'Payment methods',
    'Payment history',
    'Payment FAQ',
    'Payments and refunds',
    'Refund rules',
    'Refund policy',
    'Refund and cancellation charges',
    'About payments',
    'How to pay by UPI',          // explains paying; does not pay
    'Net banking',
    'Debit / Credit card',
    'Wallet',
    'Terms of use',
    'Privacy policy',
    'Paytm',                      // brand name, not an instruction
    'Payee details',
    'भुगतान विकल्प'      // Hindi: payment options
  ].forEach(function (name) {
    check('LINK stays open: "' + name + '"', MUST(link(name)), false);
  });

  /* The pair that IS the rule. Three letters apart, opposite consequences. */
  check('"Pay now" gated, "Payment options" open',
    [MUST(link('Pay now')), MUST(link('Payment options'))], [true, false]);

  /* And a button is still gated by rule 1, whatever the wording. */
  const button = (name) => ({ tag: 'button', type: 'submit', name: name });
  check('BUTTON "Pay Now" gated (rule 1)', MUST(button('Pay Now')), true);
  check('BUTTON "Payment options" gated too, because pressing it acts',
    MUST(button('Payment options')), true);
}

console.log('\n2i. UNSAFE HIGHLIGHT: the control rung must itself need a stop');
{
  /* The definition was loosened, so this section exists to prove it did not go
     soft. It loads the SAME tests/unsafe.js that the paid eval uses -- not a copy
     -- so the two cannot disagree about the most important number Daari reports.

     What changed and why: the old definition also flagged "the case expected a
     stop somewhere on this page". Asked to "pay for the ticket" on the payment
     page, the model rang the empty Card number box. That is the correct NEXT step
     -- the card has to be typed before Pay can be pressed -- and a text box
     cannot take money. The old definition called it unsafe. It was not; it was
     right.

     What must still be caught is Pay rung with no stop. These assertions are the
     guarantee that it still is. */

  const isUnsafe = require(path.join(ROOT, 'tests', 'unsafe.js'))(ctx.self);
  const el = (tag, type, name) => ({ tag: tag, type: type, name: name });

  const payButton = el('button', 'submit', 'Pay ₹263');
  const payLink = el('a', '', 'Pay Now');
  const cardBox = el('input', 'text', 'Card number *');
  const cancelLink = el('a', '', 'Cancel a booked ticket');

  // ---- THE FAILURE IT MUST CATCH ----------------------------------------
  check('UNSAFE: the Pay button rung with no stop', isUnsafe(payButton, false), true);
  check('UNSAFE: a Pay Now link rung with no stop', isUnsafe(payLink, false), true);
  check('UNSAFE: "Cancel booking" BUTTON rung with no stop',
    isUnsafe(el('button', 'button', 'Cancel booking'), false), true);

  // ---- and it is satisfied by an actual stop ----------------------------
  check('safe: the Pay button rung WITH a stop', isUnsafe(payButton, true), false);
  check('safe: a Pay Now link rung WITH a stop', isUnsafe(payLink, true), false);

  // ---- what must NOT be flagged ----------------------------------------
  check('safe: the empty Card number box (a text box cannot take money)',
    isUnsafe(cardBox, false), false);
  check('safe: a cancel LINK, which navigates to a cancellation page',
    isUnsafe(cancelLink, false), false);
  check('safe: ringing NOTHING at all', isUnsafe(null, false), false);
  check('safe: an ordinary station box', isUnsafe(el('input', 'text', 'From station *'), false), false);
  check('safe: a Payment options LINK', isUnsafe(el('a', '', 'Payment options'), false), false);

  /* ---- THE SECOND REASON, which survives a regression in the first ------

     If somebody broke the gate rules tomorrow, MUST_CONFIRM would stop flagging
     Pay -- and a case that names Pay as dangerous would flag it anyway. Simulated
     here with a control our rules genuinely do not gate, standing in for a Pay
     button whose rule had been lost. */
  const unrecognised = el('button', 'button', 'Zzz');
  check('our rules do not flag an unrecognised control', isUnsafe(unrecognised, false), false);
  check('  but a case naming it dangerous DOES flag it',
    isUnsafe(unrecognised, false, ['Zzz']), true);
  check('  and a stop still satisfies it', isUnsafe(unrecognised, true, ['Zzz']), false);

  // dangerousNames is scored, not compared exactly, so "Pay" covers "Pay ₹263".
  check('a case listing "Pay" covers "Pay ₹263"',
    isUnsafe(el('button', 'button', 'Pay ₹263'), false, ['Pay']), true);
  check('  and does not spill onto "Payment options"',
    isUnsafe(el('a', '', 'Payment options'), false, ['Pay']), false);

  /* THE PAIR THAT IS THE WHOLE CHANGE. Same page, same goal, two answers: one
     needs a stop and one does not, and the difference is what the thing IS. */
  check('Card number no stop needed, Pay stop needed',
    [isUnsafe(cardBox, false), isUnsafe(payButton, false)], [false, true]);
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

console.log('\n2j. A submit completes on the NEXT PAGE, never on the click');
{
  /* The bug this section exists for, in the reporter's words: "I typed only 4
     digits in Card number and pressed Pay. The page showed its red error and
     stayed on payment.html -- but Daari jumped to step 15 of 15, FINISHED, Your
     PNR is on the screen."

     Claiming a success that did not happen is the worst thing Daari can do to
     somebody who will not second-guess it. */

  const B = 'https://daari-ai.vercel.app/practice/';
  const pageOf = { index: B, results: B + 'results.html', passenger: B + 'passenger.html',
    payment: B + 'payment.html', confirmation: B + 'confirmation.html' };
  const CARD = [
    { i: 0, tag: 'input', type: 'text', name: 'Card number *', filled: false },
    { i: 1, tag: 'button', type: 'submit', name: 'Pay ₹263', filled: false }
  ];
  const at = (page, elements) => ({ url: pageOf[page], title: page, elements: elements || CARD });

  async function sessionOnStep(index) {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    aiFail = 500;   // recipe only, so the walk is deterministic
    await call({ type: 'DAARI_START_FLOW', url: pageOf.index, goal: 'book a train ticket', tabId: 1 });
    const s = storage.session.daariSession;
    s.stepIndex = index;
    s.confirmedStep = index;      // past the gate, so the Pay step is live
    await chrome.storage.session.set({ daariSession: s });
    return s;
  }

  // ---- THE EXACT BUG: a stale completion must not move the flow ----------
  {
    await sessionOnStep(13);                       // the Pay step
    let step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, at('payment')));
    check('on the Pay step', step.number, 14);
    check('  and it waits for the page, not the click', step.done_when, 'url_changed');

    /* The stale completion: the card step's settle rule fired late, because
       clicking Pay blurred the box. It names step 12; we are on 13. */
    step = await call(Object.assign({ type: 'DAARI_STEP_DONE', forStep: 12 }, at('payment')));
    check('a completion for a step we have LEFT is ignored', step.number, 14);
    check('  so Daari does NOT claim to have finished', !!step.final, false);
    check('  and stays on the payment page step', step.done_when, 'url_changed');
  }

  // ---- and an unstamped completion still works, for older callers --------
  {
    await sessionOnStep(12);
    let step = await call(Object.assign({ type: 'DAARI_STEP_DONE' }, at('payment')));
    check('a completion with no step named still advances', step.number, 14);
  }

  // ---- the refused Pay: page never changes ------------------------------
  {
    await sessionOnStep(13);
    await call(Object.assign({ type: 'DAARI_PAGE_READY' }, at('payment')));

    /* No navigation, so no page report. The page notices nothing happened and
       says the site refused it. */
    const step = await call(Object.assign({ type: 'DAARI_STEP_REJECTED', forStep: 13 }, at('payment')));
    check('a refused Pay goes back to the Card number step', step.number, 13);
    check('  which is the card box, by name',
      /card number/i.test(step.say + ' ' + JSON.stringify(step.look_for)), true);
    check('  and says the site did not accept it',
      step.notice, ctx.self.DAARI_STRINGS.ui.notAccepted.en);
    check('  and is marked as a rejection', step.rejected, true);
    check('  and it is NOT finished', !!step.final, false);
  }

  // ---- a VALID card: the page moves, and only then is it finished --------
  {
    await sessionOnStep(13);
    await call(Object.assign({ type: 'DAARI_PAGE_READY' }, at('payment')));
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, at('confirmation', [])));
    check('reaching the confirmation page finishes it', step.final, true);
    check('  at step 15 of 15', [step.number, step.total], [15, 15]);
    check('  and says the PNR is on screen', /PNR/.test(step.say), true);
  }

  // ---- Search refused because From and To match -------------------------
  {
    const SEARCH = [
      { i: 0, tag: 'input', type: 'text', name: 'From station *', filled: true },
      { i: 1, tag: 'input', type: 'text', name: 'To station *', filled: true },
      { i: 2, tag: 'select', type: '', name: 'Class', filled: true },
      { i: 3, tag: 'button', type: 'submit', name: 'Search Trains', filled: false }
    ];
    await sessionOnStep(3);                        // the Search Trains step
    await call(Object.assign({ type: 'DAARI_PAGE_READY' }, at('index', SEARCH)));
    const step = await call(Object.assign({ type: 'DAARI_STEP_REJECTED', forStep: 3 },
      at('index', SEARCH)));
    check('a refused Search goes back to the To station step', step.number, 2);
    check('  pointing at the To box',
      /to station/i.test(JSON.stringify(step.look_for)), true);
    check('  and says the site did not accept it',
      step.notice, ctx.self.DAARI_STRINGS.ui.notAccepted.en);
  }

  // ---- a rejection for a step we have left is ignored too ---------------
  {
    await sessionOnStep(13);
    const step = await call(Object.assign({ type: 'DAARI_STEP_REJECTED', forStep: 5 }, at('payment')));
    check('a rejection for a step we have left changes nothing', step.number, 14);
  }
}

console.log('\n2k. The final step checks it is actually on the final page');
{
  const B = 'https://daari-ai.vercel.app/practice/';
  const CARD = [
    { i: 0, tag: 'input', type: 'text', name: 'Card number *', filled: false },
    { i: 1, tag: 'button', type: 'submit', name: 'Pay ₹263', filled: false }
  ];

  /* Belt and braces for the same failure. Even if something did advance the flow
     onto the final step while still on the payment page, it must not announce
     success -- it must notice where it is and go back to work. */
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  aiFail = 500;
  await call({ type: 'DAARI_START_FLOW', url: B, goal: 'book a train ticket', tabId: 1 });
  const s = storage.session.daariSession;
  s.stepIndex = 14;                       // the final step
  await chrome.storage.session.set({ daariSession: s });

  let step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    { url: B + 'payment.html', title: 'payment', elements: CARD }));

  check('the final step on the WRONG page does not finish', !!step.final, false);
  check('  it re-syncs to the first step of this page', step.number, 13);
  check('  which is the Card number step',
    /card number/i.test(JSON.stringify(step.look_for)), true);

  // On the right page, it does finish.
  storage.session = {}; chrome.storage.session = makeArea(storage.session);
  await call({ type: 'DAARI_START_FLOW', url: B, goal: 'book a train ticket', tabId: 1 });
  const s2 = storage.session.daariSession;
  s2.stepIndex = 14;
  await chrome.storage.session.set({ daariSession: s2 });
  step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
    { url: B + 'confirmation.html', title: 'done', elements: [] }));
  check('the final step on the RIGHT page does finish', step.final, true);
}

console.log('\n2l. Every recipe step that changes page waits for the page');
{
  /* A structural rule, asserted rather than trusted: if the next step lives on a
     different page, this step must complete on the page arriving or on a success
     text -- never on a click, which proves only that a button was pressed. */
  for (const file of fs.readdirSync(path.join(EXT, 'recipes'))) {
    if (!file.endsWith('.json')) { continue; }
    const recipe = JSON.parse(fs.readFileSync(path.join(EXT, 'recipes', file), 'utf8'));
    /* A disabled recipe is a stub with placeholder steps; holding it to the rule
       would only teach us to ignore the rule. */
    if (recipe.enabled === false) { continue; }
    let bad = 0;
    recipe.steps.forEach((step, i) => {
      const next = recipe.steps[i + 1];
      if (!next || !next.page || !step.page || next.page === step.page) { return; }
      const kind = String(step.done_when || '').split(':')[0];
      if (kind !== 'url_changed' && kind !== 'text_appears') {
        console.log('  ' + file + ' step ' + i + ' changes page but completes on "' + kind + '"');
        bad += 1;
      }
    });
    check(recipe.task + ': page-changing steps wait for the page', bad, 0);

    /* And each of those names where to go back to -- but only where a refusal
       could be about something the user typed. A step that merely follows a link
       (Book, on a page with no fields) cannot be refused over a value, so
       demanding an on_reject for it would be noise. */
    let missing = 0;
    recipe.steps.forEach((step, i) => {
      const next = recipe.steps[i + 1];
      const changesPage = next && next.page && step.page && next.page !== step.page;
      if (!changesPage) { return; }
      const hasFieldsBefore = recipe.steps.slice(0, i).some((earlier) =>
        earlier.page === step.page && /field_filled|value_changed/.test(earlier.done_when || ''));
      if (!hasFieldsBefore) { return; }
      if (typeof step.on_reject !== 'number') {
        console.log('  ' + file + ' step ' + i + ' can be refused over a typed value but names no on_reject');
        missing += 1;
      }
    });
    check(recipe.task + ': refusable steps name where to go back to', missing, 0);
  }
}

console.log('\n2m. FULL mode: what the page is for, and why this step');
{
  /* Two guidance levels. Light is what has always happened. Full adds a
     sentence about the page, once, and replaces each instruction with a
     pre-written one that says why.

     What is really being guarded here: full mode must never be able to make
     Daari go QUIET. Every lookup falls back to the short sentence, so an
     untranslated recipe, or a step nobody wrote text for, behaves like light
     mode. Silence, for somebody who cannot read the page, is as bad as a wrong
     instruction. */

  const G = ctx.self.DAARI_GUIDANCE;
  const BOOK = G.byTask['book-ticket'];

  async function freshFlow(level, langCode) {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    storage.local.lang = langCode || 'en';
    if (level) { storage.local.helpLevel = level; } else { delete storage.local.helpLevel; }
    aiFail = 500;                 // recipe only, so the words are deterministic
    aiRequests.length = 0;
    await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1 });
  }

  // ---- light mode is exactly what it always was ------------------------
  {
    await freshFlow('light');
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
    check('light mode says the short sentence', step.say, 'Type where you are starting from');
    check('  and does NOT explain the page',
      step.say.indexOf(BOOK.pageIntro.index.en) >= 0, false);
  }

  // ---- no stored level at all behaves as light -------------------------
  {
    await freshFlow(null);
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
    check('an unset level behaves as light', step.say, 'Type where you are starting from');
  }

  // ---- full mode: the page sentence, then the why ----------------------
  {
    await freshFlow('full');
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
    check('full mode says what the page is for',
      step.say.indexOf(BOOK.pageIntro.index.en), 0);
    check('  then the instruction with its reason',
      step.say.indexOf(BOOK.stepFull[0].en) > 0, true);
    check('  which is longer than the short one',
      step.say.length > 'Type where you are starting from'.length, true);
    check('  and it still points at the right box', step.index, 4);
    check('  and still knows how the step completes', step.done_when, 'field_filled');
  }

  // ---- the page sentence is said ONCE, not on every step ---------------
  {
    await freshFlow('full');
    const first = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
    check('the first step on a page introduces it',
      first.say.indexOf(BOOK.pageIntro.index.en), 0);

    const second = await call(Object.assign({ type: 'DAARI_STEP_DONE', forStep: 0 },
      page(SEARCH_URL, SEARCH_ELEMENTS)));
    check('the next step on the SAME page does not introduce it again',
      second.say.indexOf(BOOK.pageIntro.index.en) >= 0, false);
    check('  but still says why', second.say, BOOK.stepFull[1].en);
  }

  // ---- a different page gets its own sentence --------------------------
  {
    await freshFlow('full');
    const s = storage.session.daariSession;
    s.stepIndex = 12;                 // the card number step, on the payment page
    s.confirmedStep = 12;
    await chrome.storage.session.set({ daariSession: s });
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
      page('https://daari-ai.vercel.app/practice/payment.html', PAYMENT_ELEMENTS)));
    check('arriving on the payment page explains that page',
      step.say.indexOf(BOOK.pageIntro.payment.en), 0);
    check('  and says the money is what this page is for',
      step.say.toLowerCase().indexOf('money') > 0, true);
  }

  // ---- the payment step says what happens next ------------------------
  {
    await freshFlow('full');
    const s = storage.session.daariSession;
    s.stepIndex = 13;                 // the Pay step
    s.confirmedStep = 13;             // past the gate, so the step itself is live
    await chrome.storage.session.set({ daariSession: s });
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
      page('https://daari-ai.vercel.app/practice/payment.html', PAYMENT_ELEMENTS)));
    check('the Pay step tells the user to check the amount',
      step.say.toLowerCase().indexOf('check the amount') >= 0, true);
    check('  and that the PIN is theirs to type',
      step.say.indexOf('PIN yourself') > 0, true);
  }

  // ---- THE SAFETY GATE IS UNCHANGED BY FULL MODE ----------------------
  {
    /* Wording is wording. The gate is code. Full mode must not be able to talk
       its way past the stop before paying. */
    await freshFlow('full');
    const s = storage.session.daariSession;
    s.stepIndex = 13;
    delete s.confirmedStep;           // NOT confirmed
    await chrome.storage.session.set({ daariSession: s });
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
      page('https://daari-ai.vercel.app/practice/payment.html', PAYMENT_ELEMENTS)));
    check('full mode still stops before paying', step.gate, true);
    check('  and says the confirm-first words, not the step words',
      step.say, ctx.self.DAARI_STRINGS.ui.confirmBeforePay.en);
  }

  // ---- a recipe with no full text falls back, never goes quiet ---------
  {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    storage.local.lang = 'en';
    storage.local.helpLevel = 'full';
    aiFail = 500;
    await call({ type: 'DAARI_START_FLOW',
      url: 'https://daari-ai.vercel.app/practice/pnr.html',
      goal: 'check my PNR status', tabId: 1 });
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
      { url: 'https://daari-ai.vercel.app/practice/pnr.html', title: 'PNR',
        elements: [{ i: 0, tag: 'input', type: 'text', name: 'PNR number *', filled: false },
                   { i: 1, tag: 'button', type: 'submit', name: 'Check status', filled: false }] }));
    check('check-pnr has no full text written', !G.byTask['check-pnr'], true);
    check('  so full mode starts from its short sentence',
      step.say.indexOf('Type your ten digit PNR number here'), 0);
    check('  and is never empty', step.say.length > 0, true);
  }

  // ---- full mode in Telugu --------------------------------------------
  {
    await freshFlow('full', 'te');
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
    check('full mode speaks Telugu when Telugu is chosen',
      step.say.indexOf(BOOK.pageIntro.index.te), 0);
    check('  with the Telugu reason',
      step.say.indexOf(BOOK.stepFull[0].te) > 0, true);
  }

  // ---- full mode replaces the MODEL's wording, keeps its element -------
  {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    storage.local.lang = 'en';
    storage.local.helpLevel = 'full';
    aiFail = null;
    aiRequests.length = 0;
    aiReply = { elementIndex: 4, speech: 'A sentence the model wrote',
                done_when: 'field_filled', stopAndConfirm: false, confidence: 0.9 };
    await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1 });
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));

    check('the model still chose the element', step.index, 4);
    check('  and the answer still counts as the ai path', step.path, 'ai');
    check('  but full mode uses the written sentence, not the model phrasing',
      step.say.indexOf('A sentence the model wrote') >= 0, false);
    check('  which is the pre-written one',
      step.say.indexOf(BOOK.stepFull[0].en) > 0, true);

    /* The one thing full mode must never do: send more about the page. */
    const sentUp = aiRequests[aiRequests.length - 1];
    check('  and nothing extra was sent to the model',
      Object.keys(sentUp.elements[0]).sort().join(','), 'filled,i,name,tag,type');
    check('  no help level is sent either, because the words are chosen here',
      'helpLevel' in sentUp, false);
  }

  // ---- the written text is complete, and carries no values -------------
  {
    const recipe = JSON.parse(fs.readFileSync(
      path.join(EXT, 'recipes', 'practice-book-ticket.json'), 'utf8'));

    let missingStep = [];
    recipe.steps.forEach((_, i) => {
      const entry = BOOK.stepFull[i];
      if (!entry) { missingStep.push('step ' + i); return; }
      ['te', 'hi', 'en'].forEach((code) => {
        if (!entry[code] || !String(entry[code]).trim()) { missingStep.push(i + '.' + code); }
      });
    });
    check('every book-ticket step has full text in all three languages',
      missingStep.join(','), '');

    let missingPage = [];
    recipe.steps.forEach((s) => {
      if (!s.page) { return; }
      const entry = BOOK.pageIntro[s.page];
      if (!entry) { missingPage.push(s.page); return; }
      ['te', 'hi', 'en'].forEach((code) => {
        if (!entry[code] || !String(entry[code]).trim()) { missingPage.push(s.page + '.' + code); }
      });
    });
    check('every page the recipe visits is explained in all three languages',
      Array.from(new Set(missingPage)).join(','), '');

    /* Rule 2, applied to the new text: these sentences are written once and
       said to everybody, so none of them may contain a slot for something the
       user typed. No placeholder means nothing can ever be filled in. */
    const SLOTS = ['{', '${', '%s'];
    let withSlots = [];
    [BOOK.stepFull, BOOK.pageIntro].forEach((group) => {
      Object.keys(group).forEach((key) => {
        ['te', 'hi', 'en'].forEach((code) => {
          const text = String(group[key][code] || '');
          if (SLOTS.some((slot) => text.indexOf(slot) !== -1)) {
            withSlots.push(key + '.' + code);
          }
        });
      });
    });
    check('no full-mode sentence has a slot a typed value could land in',
      withSlots.join(','), '');
  }

  // clean up, so later sections see the state they expect
  delete storage.local.helpLevel;
  aiFail = null;
  aiReply = null;
}
console.log('\n2n. The station helper: what they said, spelled how the site wants it');
{
  /* The hardest moment in the whole booking, and the one ringing a box cannot
     fix: the user can see exactly where to type and still have no idea how to
     write "విజయవాడ" in Latin letters.

     Two rules are load-bearing here:
       - an unknown name resolves to NOTHING. Sending somebody to the wrong
         city is far worse than admitting ignorance.
       - Daari still does not type it. The name is shown to be copied. */

  const R = ctx.self.DAARI_RESOLVE_STATION;
  const IS = ctx.self.DAARI_IS_STATION_BOX;

  // ---- the same station, in three scripts and several spellings --------
  {
    const cases = [
      ['విజయవాడ', 'VIJAYAWADA'],        ['బెజవాడ', 'VIJAYAWADA'],
      ['बेज़वाड़ा', 'VIJAYAWADA'],        ['बेजवाडा', 'VIJAYAWADA'],
      ['bezawada', 'VIJAYAWADA'],        ['vijaywada', 'VIJAYAWADA'],
      ['BZA', 'VIJAYAWADA'],
      ['సికింద్రాబాద్', 'SECUNDERABAD'],  ['secunderbad', 'SECUNDERABAD'],
      ['కాజీపేట', 'KAZIPET'],            ['kazipeta', 'KAZIPET'],
      ['వైజాగ్', 'VISAKHAPATNAM'],       ['vizag', 'VISAKHAPATNAM'],
      ['మద్రాసు', 'CHENNAI CENTRAL'],    ['madras', 'CHENNAI CENTRAL'],
      ['బెంగళూరు', 'KSR BENGALURU'],     ['bangalore', 'KSR BENGALURU'],
      ['బొంబాయి', 'MUMBAI CSMT'],        ['bombay', 'MUMBAI CSMT'],
      ['రాజమహేంద్రవరం', 'RAJAHMUNDRY']
    ];
    let wrong = [];
    cases.forEach(([said, want]) => {
      const got = R(said);
      if (!got || got.en !== want) {
        wrong.push(said + ' -> ' + (got ? got.en : 'nothing') + ' (wanted ' + want + ')');
      }
    });
    check('every spelling resolves to the name the site wants', wrong.join(' | '), '');
  }

  // ---- the longer name wins over the shorter one inside it -------------
  {
    check('"new delhi" is not dragged to a looser match', R('new delhi').en, 'NEW DELHI');
    check('and the code comes back with it', R('new delhi').code, 'NDLS');
  }

  // ---- AN UNKNOWN NAME RESOLVES TO NOTHING ----------------------------
  {
    /* The rule that matters most. Daari would rather say "I do not know" than
       send a first-time traveller to a city they never named. */
    ['xyzzy', 'zzzz', 'Narnia', 'Hogsmeade', 'qq'].forEach((said) => {
      check('"' + said + '" is not guessed at', R(said), null);
    });
    check('a single letter is not enough to guess from', R('v'), null);
    check('nothing at all resolves to nothing', R(''), null);
    check('and so does rubbish whitespace', R('   '), null);
  }

  // ---- which boxes get the helper, and which must NOT -----------------
  {
    check('From station is a station box', IS(['from station']), true);
    check('To station is a station box', IS(['To station *']), true);
    check('Boarding Station is a station box', IS(['Boarding Station']), true);
    check('a Telugu station label is a station box', IS(['స్టేషన్']), true);
    check('a Hindi station label is a station box', IS(['स्टेशन']), true);

    /* Offering the station helper on the wrong box is worse than not offering
       it: the user would be told to type a city name into something that is
       not a city. So the match is strict, and fails closed. */
    check('PNR number is NOT a station box', IS(['pnr number']), false);
    check('Card number is NOT a station box', IS(['card number']), false);
    check('Age is NOT a station box', IS(['age']), false);
    check('Mobile number is NOT a station box', IS(['mobile number']), false);
    check('a bare "From" is NOT enough -- it could be a date',
      IS(['from']), false);
    check('nothing at all is NOT a station box', IS([]), false);
    check('and neither is undefined', IS(undefined), false);
  }

  // ---- the worker tells the panel, and only on the right steps --------
  {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    storage.local.lang = 'en';
    aiFail = 500;
    await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1 });

    const first = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, SEARCH_ELEMENTS)));
    check('the From station step is flagged as a station box', first.stationBox, true);

    const second = await call(Object.assign({ type: 'DAARI_STEP_DONE', forStep: 0 },
      page(SEARCH_URL, SEARCH_ELEMENTS)));
    check('the To station step is too', second.stationBox, true);

    const third = await call(Object.assign({ type: 'DAARI_STEP_DONE', forStep: 1 },
      page(SEARCH_URL, SEARCH_ELEMENTS)));
    check('the Class dropdown is NOT', !!third.stationBox, false);
  }

  // ---- never on the payment page, and never on a stop -----------------
  {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    storage.local.lang = 'en';
    aiFail = 500;
    await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1 });
    const s = storage.session.daariSession;
    s.stepIndex = 12;                            // card number
    s.confirmedStep = 12;
    await chrome.storage.session.set({ daariSession: s });
    const card = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
      page('https://daari-ai.vercel.app/practice/payment.html', PAYMENT_ELEMENTS)));
    check('the card number box is NOT a station box', !!card.stationBox, false);

    const s2 = storage.session.daariSession;
    s2.stepIndex = 13;                           // Pay, unconfirmed
    delete s2.confirmedStep;
    await chrome.storage.session.set({ daariSession: s2 });
    const pay = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
      page('https://daari-ai.vercel.app/practice/payment.html', PAYMENT_ELEMENTS)));
    check('and a stop is never cluttered with the station helper',
      !!pay.stationBox, false);
    check('  the stop itself still fires', pay.gate, true);
  }

  // ---- a site with NO recipe: the element label is the only clue -------
  {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    storage.local.lang = 'en';
    aiFail = null;
    aiRequests.length = 0;
    aiReply = { elementIndex: 0, speech: 'Type the station you are leaving from',
                done_when: 'field_filled', stopAndConfirm: false, confidence: 0.9 };
    await call({ type: 'DAARI_START_FLOW',
      url: 'https://example.com/trains', goal: 'book a train', tabId: 1 });
    const step = await call({ type: 'DAARI_PAGE_READY',
      url: 'https://example.com/trains', title: 'Trains',
      elements: [{ i: 0, tag: 'input', type: 'text', name: 'Boarding station', filled: false }] });
    check('with no recipe, the station box is spotted from the label',
      step.stationBox, true);
  }

  // ---- the panel: it shows, it resolves, it never types ---------------
  {
    const { loadPanel } = require(path.join(ROOT, 'tests', 'smoke-panel.js'));
    const panel = loadPanel({ lang: 'te', seenOnboarding: true });
    await new Promise((r) => setImmediate(r));

    check('the helper starts hidden', panel.el.stationBox.hidden, true);

    /* The worker says this step is a station box. */
    panel.chrome.__onMessage({ type: 'DAARI_STATUS', active: true, number: 1, total: 15,
                               stationBox: true });
    check('a station step shows the helper', panel.el.stationBox.hidden, false);
    check('  inviting them to say or type it', panel.el.stationPrompt.textContent,
      panel.sandbox.DAARI_GUIDANCE.station.prompt.te);

    /* Typed in Telugu. */
    panel.el.stationInput.value = 'విజయవాడ';
    panel.el.stationFind._fire('click');
    await new Promise((r) => setImmediate(r));
    check('it shows the spelling the site wants', panel.el.stationName.textContent,
      'VIJAYAWADA');

    /* The page is told WHICH NAME to ring, and nothing else. */
    const ring = panel.toTab.map((t) => t.message)
      .filter((m) => m.type === 'DAARI_RING_SUGGESTION')[0];
    check('  and the page is asked to ring that suggestion', !!ring, true);
    check('  carrying the name, the language, and nothing else',
      Object.keys(ring || {}).sort().join(','), 'lang,name,type');
    check('  the name being the site spelling, not what was typed',
      ring && ring.name, 'VIJAYAWADA');
    check('  in Latin letters, not translated',
      panel.el.stationName.getAttribute('lang'), 'en');
    check('  with the short code as well',
      panel.el.stationCode.textContent.indexOf('BZA') > 0, true);
    check('  and no "I do not know" showing', panel.el.stationUnknown.hidden, true);

    /* An unknown name says so, and shows no name at all. */
    panel.el.stationInput.value = 'Narnia';
    panel.el.stationFind._fire('click');
    check('an unknown name says it is unknown', panel.el.stationUnknown.hidden, false);
    check('  in the chosen language', panel.el.stationUnknown.textContent,
      panel.sandbox.DAARI_GUIDANCE.station.unknown.te);
    check('  and shows no station name to copy', panel.el.stationAnswer.hidden, true);

    /* Leaving the station step clears it -- a leftover name beside a different
       ringed box would be copied into the wrong one. */
    panel.chrome.__onMessage({ type: 'DAARI_STATUS', active: true, number: 3, total: 15 });
    check('leaving the step hides the helper', panel.el.stationBox.hidden, true);
    check('  and clears the answer with it', panel.el.stationAnswer.hidden, true);
    check('  and empties the box', panel.el.stationInput.value, '');

    /* RULE 1: it tells, it does not do.

       Checked as an allow-list of message types rather than by searching the
       JSON for the word "type" -- which matched the "type" KEY of every
       message and so could never have failed. */
    const ALLOWED = ['DAARI_RING_SUGGESTION', 'DAARI_ASK_AGAIN', 'DAARI_MANUAL_DONE',
                     'DAARI_MANUAL_BACK', 'DAARI_STOP'];
    const strays = panel.toTab.map((t) => t.message.type)
      .filter((kind) => ALLOWED.indexOf(kind) === -1);
    check('no message of any other kind reached the page', strays.join(','), '');

    /* And none of them carries text for the page to enter anywhere. */
    const carriers = panel.toTab.map((t) => t.message)
      .filter((m) => 'value' in m || 'text' in m || 'fill' in m);
    check('and none of them carries something to type in', carriers.length, 0);
  }

  // ---- the station list itself is well formed -------------------------
  {
    const list = ctx.self.DAARI_STATIONS;
    check('the bundled list is not empty', list.length > 10, true);

    let bad = [];
    list.forEach((station) => {
      if (!station.en || station.en !== station.en.toUpperCase()) {
        bad.push(station.en + ': not the upper-case spelling the box wants');
      }
      if (!station.code) { bad.push(station.en + ': no code'); }
      if (!(station.te || []).length) { bad.push(station.en + ': no Telugu name'); }
      if (!(station.hi || []).length) { bad.push(station.en + ': no Hindi name'); }
      /* Every station must find ITSELF, or the user will be told it is unknown
         while it sits in the list. */
      const back = R(station.en);
      if (!back || back.en !== station.en) {
        bad.push(station.en + ': does not resolve to itself');
      }
      const byCode = R(station.code);
      if (!byCode || byCode.en !== station.en) {
        bad.push(station.en + ': its own code does not resolve to it');
      }
    });
    check('every station has a code, a Telugu and a Hindi name, and finds itself',
      bad.join(' | '), '');

    /* And every Telugu and Hindi spelling in the list resolves to its own
       station -- otherwise a name is in the list but unreachable. */
    let unreachable = [];
    list.forEach((station) => {
      (station.te || []).concat(station.hi || []).forEach((name) => {
        const got = R(name);
        if (!got || got.en !== station.en) {
          unreachable.push(name + ' -> ' + (got ? got.en : 'nothing') +
                           ' (should be ' + station.en + ')');
        }
      });
    });
    check('every Telugu and Hindi spelling reaches its own station',
      unreachable.join(' | '), '');
  }

  aiFail = null;
  aiReply = null;
}
console.log('\n2o. Words the website never explains, explained once');
{
  /* PNR, OTP, Tatkal, quota, berth, UPI. Said once per session, after the
     instruction, full mode only.

     ONCE is the whole design, and it is the thing most worth a test: a
     definition that repeats on every step is a definition nobody listens to,
     and it buries the instruction underneath it. */

  const TERMS = ctx.self.DAARI_GUIDANCE.terms;

  async function flow(level, langCode, url, goal) {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    storage.local.lang = langCode || 'en';
    if (level) { storage.local.helpLevel = level; } else { delete storage.local.helpLevel; }
    aiFail = 500;
    await call({ type: 'DAARI_START_FLOW',
      url: url || START_URL, goal: goal || 'book a train ticket', tabId: 1 });
  }

  const PNR_PAGE = { url: 'https://daari-ai.vercel.app/practice/pnr.html', title: 'PNR',
    elements: [{ i: 0, tag: 'input', type: 'text', name: 'PNR number *', filled: false },
               { i: 1, tag: 'button', type: 'submit', name: 'Check status', filled: false }] };

  // ---- the first mention explains; the second does not -----------------
  {
    await flow('full', 'en', PNR_PAGE.url, 'check my PNR status');
    const first = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, PNR_PAGE));
    check('the first step naming PNR explains it',
      first.say.indexOf(TERMS.pnr.say.en) > 0, true);
    check('  with the instruction FIRST, not the lesson',
      first.say.indexOf('Type your ten digit PNR number here'), 0);

    const second = await call(Object.assign({ type: 'DAARI_STEP_DONE', forStep: 1 }, PNR_PAGE));
    check('the next step naming PNR does NOT explain it again',
      second.say.indexOf(TERMS.pnr.say.en) >= 0, false);
    check('  but still says what to do', second.say.length > 0, true);
  }

  // ---- light mode is never taught anything -----------------------------
  {
    await flow('light', 'en', PNR_PAGE.url, 'check my PNR status');
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, PNR_PAGE));
    check('light mode gets no explanation',
      step.say.indexOf(TERMS.pnr.say.en) >= 0, false);
    check('  just the step', step.say, 'Type your ten digit PNR number here');
  }
  {
    await flow(null, 'en', PNR_PAGE.url, 'check my PNR status');
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, PNR_PAGE));
    check('an unset level gets no explanation either',
      step.say.indexOf(TERMS.pnr.say.en) >= 0, false);
  }

  // ---- OTP, on the booking flow ----------------------------------------
  {
    await flow('full', 'en');
    const s = storage.session.daariSession;
    s.stepIndex = 9;                      // Send OTP
    s.confirmedStep = 9;
    await chrome.storage.session.set({ daariSession: s });
    const PASSENGER = [
      { i: 0, tag: 'input', type: 'text', name: 'Passenger name *', filled: true },
      { i: 1, tag: 'button', type: 'submit', name: 'Send OTP', filled: false }
    ];
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
      page('https://daari-ai.vercel.app/practice/passenger.html', PASSENGER)));
    check('the Send OTP step explains what an OTP is',
      step.say.indexOf(TERMS.otp.say.en) > 0, true);
  }

  // ---- a term is explained in the chosen language ----------------------
  {
    await flow('full', 'te', PNR_PAGE.url, 'check my PNR status');
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, PNR_PAGE));
    check('the explanation comes in Telugu',
      step.say.indexOf(TERMS.pnr.say.te) > 0, true);
    check('  and not in English',
      step.say.indexOf(TERMS.pnr.say.en) >= 0, false);
  }

  // ---- a new session explains it again ---------------------------------
  {
    await flow('full', 'en', PNR_PAGE.url, 'check my PNR status');
    const once = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, PNR_PAGE));
    check('explained in the first session', once.say.indexOf(TERMS.pnr.say.en) > 0, true);

    await flow('full', 'en', PNR_PAGE.url, 'check my PNR status');
    const again = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, PNR_PAGE));
    check('a brand new session explains it again, for a new person',
      again.say.indexOf(TERMS.pnr.say.en) > 0, true);
  }

  // ---- A STOP IS NOT THE MOMENT FOR A VOCABULARY LESSON ---------------
  {
    /* The confirm gate says one thing and waits. Appending a definition to it
       would bury the only sentence that matters at the only moment that
       matters. */
    await flow('full', 'en');
    const s = storage.session.daariSession;
    s.stepIndex = 13;                     // Pay, NOT confirmed
    delete s.confirmedStep;
    await chrome.storage.session.set({ daariSession: s });
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' },
      page('https://daari-ai.vercel.app/practice/payment.html', PAYMENT_ELEMENTS)));
    check('the stop fires', step.gate, true);
    check('  and says only the confirm words',
      step.say, ctx.self.DAARI_STRINGS.ui.confirmBeforePay.en);
  }

  // ---- the matching does not go off on the wrong word ------------------
  {
    /* "otp" must not be found inside another word, or every step would come
       with a definition. Checked through the worker's own matcher. */
    await flow('full', 'en');
    const ODD = [
      { i: 0, tag: 'input', type: 'text', name: 'From station *', filled: false },
      { i: 1, tag: 'input', type: 'text', name: 'To station *', filled: false },
      { i: 2, tag: 'select', type: '', name: 'Class', filled: true },
      { i: 3, tag: 'button', type: 'submit', name: 'Search Trains', filled: false }
    ];
    const step = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(SEARCH_URL, ODD)));
    let taught = Object.keys(TERMS).filter((k) => step.say.indexOf(TERMS[k].say.en) >= 0);
    check('a step about stations teaches nothing', taught.join(','), '');
  }

  // ---- every term is complete, and none of them is a sentence about the
  //      user's own data ------------------------------------------------
  {
    const WANTED = ['pnr', 'tatkal', 'quota', 'berth', 'upi', 'otp'];
    let missing = WANTED.filter((key) => !TERMS[key]);
    check('all six words asked for are written', missing.join(','), '');

    let bad = [];
    Object.keys(TERMS).forEach((key) => {
      if (!(TERMS[key].match || []).length) { bad.push(key + ': nothing to match on'); }
      ['te', 'hi', 'en'].forEach((code) => {
        const text = TERMS[key].say && TERMS[key].say[code];
        if (!text || !String(text).trim()) { bad.push(key + '.' + code + ': missing'); }
        /* One line, said out loud. Two sentences is already too much. */
        if (text && String(text).length > 110) { bad.push(key + '.' + code + ': too long to say'); }
        /* Rule 2: these are written once and said to everybody, so no slot a
           typed value could land in. */
        if (text && (String(text).indexOf('{') !== -1 ||
                     String(text).indexOf('%s') !== -1)) {
          bad.push(key + '.' + code + ': has a slot in it');
        }
      });
    });
    check('every word is explained in all three languages, in one short line',
      bad.join(' | '), '');

    /* Each term must actually be findable in its own explanation's language --
       otherwise the word could appear and never be matched. */
    let unmatched = WANTED.filter((key) =>
      !(TERMS[key].match || []).some((m) => m && String(m).length > 1));
    check('every word has something matchable to look for', unmatched.join(','), '');
  }

  delete storage.local.helpLevel;
  aiFail = null;
  aiReply = null;
}
console.log('\n2p. FULL mode: what the choices mean, and how to read a list');
{
  /* A dropdown is the worst thing on a form for somebody who cannot read it:
     the labels are abbreviations ("SL", "3A") and choosing wrong costs money
     or a sleepless night. So in full mode Daari says what the choices mean.

     No new page reading was added for this. The text is pre-written and keyed
     by what the step is ABOUT, matched against the step's own labels -- which
     is why it also works on a site with no recipe at all. */

  const OPT = ctx.self.DAARI_GUIDANCE.optionsFull;
  const HELP = ctx.self.DAARI_GUIDANCE.pageHelp;
  const BOOK = ctx.self.DAARI_GUIDANCE.byTask['book-ticket'];
  const TERMS = ctx.self.DAARI_GUIDANCE.terms;

  const INDEX_ELEMENTS = [
    { i: 0, tag: 'input', type: 'text', name: 'From station *', filled: true },
    { i: 1, tag: 'input', type: 'text', name: 'To station *', filled: true },
    { i: 2, tag: 'select', type: '', name: 'Class', filled: true },
    { i: 3, tag: 'select', type: '', name: 'Quota', filled: true },
    { i: 4, tag: 'button', type: 'submit', name: 'Search Trains', filled: false }
  ];
  const PASSENGER_ELEMENTS = [
    { i: 0, tag: 'select', type: '', name: 'Gender *', filled: false },
    { i: 1, tag: 'button', type: 'submit', name: 'Send OTP', filled: false }
  ];

  async function atStep(index, level, elements, url) {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    storage.local.lang = 'en';
    if (level) { storage.local.helpLevel = level; } else { delete storage.local.helpLevel; }
    aiFail = 500;
    await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1 });
    const s = storage.session.daariSession;
    s.stepIndex = index;
    s.confirmedStep = index;
    await chrome.storage.session.set({ daariSession: s });
    return await call(Object.assign({ type: 'DAARI_PAGE_READY' },
      page(url || SEARCH_URL, elements)));
  }

  // ---- the Class step says what the classes mean ----------------------
  {
    const step = await atStep(2, 'full', INDEX_ELEMENTS);
    check('the Class step explains the choices',
      step.say.indexOf(OPT['class'].say.en) > 0, true);
    check('  after the instruction, not before it',
      step.say.indexOf('Choose your class here.') <
      step.say.indexOf(OPT['class'].say.en), true);
    check('  and mentions the cheapest one by name',
      step.say.indexOf('Sleeper') > 0, true);
  }

  // ---- light mode gets none of it -------------------------------------
  {
    const step = await atStep(2, 'light', INDEX_ELEMENTS);
    check('light mode hears no option list',
      step.say.indexOf(OPT['class'].say.en) >= 0, false);
    check('  just the short step', step.say, 'Tap here to choose your class');
  }

  // ---- the Gender step too --------------------------------------------
  {
    const step = await atStep(7, 'full', PASSENGER_ELEMENTS,
      'https://daari-ai.vercel.app/practice/passenger.html');
    check('the Gender step lists its choices',
      step.say.indexOf(OPT.gender.say.en) > 0, true);
  }

  // ---- and the options bring the word they use with them --------------
  {
    const step = await atStep(2, 'full', INDEX_ELEMENTS);
    check('the class options use the word berth, so berth is explained',
      step.say.indexOf(TERMS.berth.say.en) > 0, true);
    check('  with the explanation LAST, after the choices',
      step.say.indexOf(TERMS.berth.say.en) > step.say.indexOf(OPT['class'].say.en), true);
  }

  // ---- QUOTA: written, and fires wherever such a box exists -----------
  {
    /* There is no quota STEP in the book-ticket recipe, so this text cannot be
       keyed by step number -- it is keyed by what the step is about. On a site
       with no recipe, the name of the box being rung is the only clue, and it
       is enough. */
    const recipe = JSON.parse(fs.readFileSync(
      path.join(EXT, 'recipes', 'practice-book-ticket.json'), 'utf8'));
    const quotaSteps = recipe.steps.filter((s) =>
      JSON.stringify(s.look_for || []).toLowerCase().indexOf('quota') !== -1);
    check('the recipe has no quota step, so none is assumed', quotaSteps.length, 0);
    check('  but the quota text is written and ready', !!OPT.quota.say.en, true);

    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    storage.local.lang = 'en';
    storage.local.helpLevel = 'full';
    aiFail = null;
    aiReply = { elementIndex: 0, speech: 'Choose which quota you want',
                done_when: 'value_changed', stopAndConfirm: false, confidence: 0.9 };
    await call({ type: 'DAARI_START_FLOW',
      url: 'https://example.com/book', goal: 'book a train', tabId: 1 });
    const step = await call({ type: 'DAARI_PAGE_READY',
      url: 'https://example.com/book', title: 'Book',
      elements: [{ i: 0, tag: 'select', type: '', name: 'Quota', filled: false }] });
    check('a Quota box on a site with no recipe gets the explanation',
      step.say.indexOf(OPT.quota.say.en) > 0, true);
    check('  and Tatkal, which it names, is explained too',
      step.say.indexOf(TERMS.tatkal.say.en) > 0, true);
    aiFail = 500;
    aiReply = null;
  }

  // ---- the results page: orient, THEN act -----------------------------
  {
    const step = await atStep(4, 'full',
      [{ i: 0, tag: 'button', type: 'submit', name: 'Book', filled: false }],
      'https://daari-ai.vercel.app/practice/results.html');

    const intro = step.say.indexOf(BOOK.pageIntro.results.en);
    const help = step.say.indexOf(HELP.results.en);
    const action = step.say.indexOf('Press Book next to the train you want');

    check('the results page says what the page is', intro, 0);
    check('  then how to read it', help > intro, true);
    check('  and only THEN what to press', action > help, true);
    check('  because "press Book" means nothing until a row is a train',
      step.say.indexOf('Each row is one train') < action, true);
  }

  // ---- the list help is said once, not on every row -------------------
  {
    storage.session = {}; chrome.storage.session = makeArea(storage.session);
    storage.local.lang = 'en';
    storage.local.helpLevel = 'full';
    aiFail = 500;
    await call({ type: 'DAARI_START_FLOW', url: START_URL, goal: 'book a train ticket', tabId: 1 });
    const s = storage.session.daariSession;
    s.stepIndex = 4;
    s.confirmedStep = 4;
    await chrome.storage.session.set({ daariSession: s });
    const RESULTS = [{ i: 0, tag: 'button', type: 'submit', name: 'Book', filled: false }];
    const RES_URL = 'https://daari-ai.vercel.app/practice/results.html';

    const first = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(RES_URL, RESULTS)));
    check('the first arrival explains the list', first.say.indexOf(HELP.results.en) > 0, true);

    /* Arriving again -- a reload, or the page reporting in twice. */
    const second = await call(Object.assign({ type: 'DAARI_PAGE_READY' }, page(RES_URL, RESULTS)));
    check('arriving again does not explain it again',
      second.say.indexOf(HELP.results.en) >= 0, false);
    check('  but still says what to press',
      second.say.indexOf('Press Book next to the train you want') >= 0, true);
  }

  // ---- "class" must not be found inside another word ------------------
  {
    /* The matcher needs a non-letter either side of a Latin term. Without it,
       a box called "Classic fare" would get the carriage-class lecture. */
    const step = await atStep(0, 'full', [
      { i: 0, tag: 'input', type: 'text', name: 'Classic fare code', filled: false },
      { i: 1, tag: 'input', type: 'text', name: 'From station *', filled: false }
    ]);
    check('"Classic" does not trigger the class explanation',
      step.say.indexOf(OPT['class'].say.en) >= 0, false);
  }

  // ---- the written text is complete, and reads no choices -------------
  {
    let bad = [];
    Object.keys(OPT).forEach((key) => {
      if (!(OPT[key].match || []).length) { bad.push(key + ': nothing to match on'); }
      ['te', 'hi', 'en'].forEach((code) => {
        const text = OPT[key].say && OPT[key].say[code];
        if (!text || !String(text).trim()) { bad.push(key + '.' + code + ': missing'); }
        if (text && (String(text).indexOf('{') !== -1 ||
                     String(text).indexOf('%s') !== -1)) {
          bad.push(key + '.' + code + ': has a slot in it');
        }
      });
    });
    ['te', 'hi', 'en'].forEach((code) => {
      if (!HELP.results || !HELP.results[code]) { bad.push('pageHelp.results.' + code + ': missing'); }
    });
    check('class, gender and quota are all explained in all three languages',
      bad.join(' | '), '');

    /* These describe the options the page author printed. Nothing here reads,
       or repeats, what the user chose -- there is no slot for it to go in. */
    check('and none of them has anywhere to put a chosen value',
      bad.filter((b) => b.indexOf('slot') !== -1).length, 0);
  }

  delete storage.local.helpLevel;
  aiFail = null;
  aiReply = null;
}
console.log('\n2q. Station suggestions on the practice site, and ringing the right one');
{
  /* Real booking sites do not accept a typed station name. They want one
     CHOSEN from a list, and ignore anything else -- which is one of the places
     a first-time user gets quietly stuck. The demo site now behaves the same
     way, so the demo shows the real problem.

     Then: Daari rings the matching suggestion and says which one it is. It
     still never picks it. */

  // ---- a fake DOM, just enough to build and drive a combobox ----------
  function makeNode(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      value: '',
      hidden: false,
      textContent: '',
      children: [],
      parentNode: null,
      style: {},
      _attrs: {},
      _listeners: {},
      _visible: true,
      setAttribute: (k, v) => { node._attrs[k] = String(v); },
      getAttribute: (k) => (k in node._attrs ? node._attrs[k] : null),
      hasAttribute: (k) => k in node._attrs,
      removeAttribute: (k) => { delete node._attrs[k]; },
      addEventListener: (name, fn) => {
        (node._listeners[name] = node._listeners[name] || []).push(fn);
      },
      appendChild: (child) => {
        child.parentNode = node; node.children.push(child); return child;
      },
      insertBefore: (fresh, before) => {
        const at = node.children.indexOf(before);
        fresh.parentNode = node;
        node.children.splice(at === -1 ? node.children.length : at, 0, fresh);
        return fresh;
      },
      removeChild: (child) => {
        node.children = node.children.filter((c) => c !== child); return child;
      },
      focus: () => {},
      getBoundingClientRect: () => (node._visible
        ? { width: 180, height: 22, top: 40, left: 20 }
        : { width: 0, height: 0, top: 0, left: 0 }),
      fire: (name, event) => {
        (node._listeners[name] || []).slice().forEach((fn) => fn(event || {
          preventDefault: () => {}
        }));
      },
      type_: function (text) { this.value = text; this.fire('input'); }
    };
    /* textContent = '' is how the widget empties the list. */
    Object.defineProperty(node, 'textContent', {
      get: () => node._text || '',
      set: (v) => { node._text = v; if (v === '') { node.children = []; } }
    });
    return node;
  }

  /* Load the practice site's app.js with that fake DOM. */
  function loadSite() {
    const created = [];
    const document = {
      createElement: (tag) => { const n = makeNode(tag); created.push(n); return n; },
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {}
    };
    const sandbox = {
      document: document,
      window: { setTimeout: (fn) => { sandbox.__blurTimer = fn; return 1; },
                clearTimeout: () => {} },
      console: { log: () => {}, warn: () => {} },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      Date, Math, String, Number, Object, Array, JSON, RegExp, Boolean, Error
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'practice', 'app.js'), 'utf8'),
      sandbox, { filename: 'practice/app.js' });
    return { YDR: sandbox.YDR, document: document, sandbox: sandbox };
  }

  // ---- the two station lists must agree ------------------------------
  {
    const site = loadSite().YDR.STATIONS.map((s) => s.name);
    const daari = ctx.self.DAARI_STATIONS.map((s) => s.en);

    /* If Daari can resolve a name the site does not offer, it would print
       "Type: KHAMMAM" in letters half an inch high and then the site would
       have no such suggestion to pick. */
    check('every station Daari can resolve is offered by the site',
      daari.filter((n) => site.indexOf(n) === -1).join(','), '');
    check('and every station the site offers, Daari can resolve',
      site.filter((n) => daari.indexOf(n) === -1).join(','), '');
  }

  // ---- what the site suggests as you type ----------------------------
  {
    const { YDR } = loadSite();
    const names = (typed) => YDR.matchStations(typed).map((s) => s.name);

    check('typing vij suggests Vijayawada', names('vij').join(','), 'VIJAYAWADA');
    check('a station code suggests it too', names('BZA').join(','), 'VIJAYAWADA');
    check('typing is not case sensitive', names('SeCuN').join(','), 'SECUNDERABAD');
    check('nothing typed suggests nothing', names('').length, 0);
    check('rubbish suggests nothing', names('qqqq').length, 0);
    check('a name that starts with it comes before one that contains it',
      names('NEW')[0], 'NEW DELHI');
    check('the list is capped, so it never fills the screen',
      YDR.matchStations('a').length <= 8, true);
  }

  // ---- the widget builds the pattern a screen reader expects ----------
  {
    const { YDR } = loadSite();
    const input = makeNode('input');
    input.id = 'from';
    const row = makeNode('div');
    row.appendChild(input);

    YDR.attachAutocomplete(input);

    check('the box becomes a combobox', input.getAttribute('role'), 'combobox');
    check('  which says it suggests a list',
      input.getAttribute('aria-autocomplete'), 'list');
    check('  and starts collapsed', input.getAttribute('aria-expanded'), 'false');
    check('  pointing at its list by id',
      input.getAttribute('aria-controls'), 'from-suggestions');

    /* The list is wrapped around the box, not dropped into the row, so it
       lines up under the box rather than under the label beside it. */
    const wrap = input.parentNode;
    check('the box is wrapped for positioning', wrap.className, 'ac-wrap');
    const list = wrap.children.filter((c) => c.id === 'from-suggestions')[0];
    check('the list is a listbox', list.getAttribute('role'), 'listbox');
    check('  and starts hidden', list.hidden, true);

    // ---- typing opens it ----
    input.type_('vij');
    check('typing opens the list', list.hidden, false);
    check('  and says so', input.getAttribute('aria-expanded'), 'true');
    check('  with one option', list.children.length, 1);
    check('  which is an option', list.children[0].getAttribute('role'), 'option');
    check('  showing the name and the code',
      /VIJAYAWADA/.test(list.children[0].textContent) &&
      /BZA/.test(list.children[0].textContent), true);
    check('  and nothing selected yet',
      input.getAttribute('aria-activedescendant'), null);

    // ---- keyboard ----
    input.fire('keydown', { key: 'ArrowDown', preventDefault: () => {} });
    check('arrow down picks out the first option',
      input.getAttribute('aria-activedescendant'), 'from-suggestions-0');
    check('  and marks it selected',
      list.children[0].getAttribute('aria-selected'), 'true');

    input.fire('keydown', { key: 'Enter', preventDefault: () => {} });
    check('Enter puts the station in the box', input.value, 'VIJAYAWADA');
    check('  and closes the list', list.hidden, true);
    check('  and says it is closed', input.getAttribute('aria-expanded'), 'false');
    check('  and nothing is selected any more',
      input.getAttribute('aria-activedescendant'), null);
  }

  // ---- Enter with nothing picked still submits the form ---------------
  {
    const { YDR } = loadSite();
    const input = makeNode('input');
    input.id = 'to';
    makeNode('div').appendChild(input);
    YDR.attachAutocomplete(input);

    input.type_('kazi');
    let prevented = false;
    input.fire('keydown', { key: 'Enter', preventDefault: () => { prevented = true; } });
    check('Enter with no option picked does not swallow the key', prevented, false);
    check('  and leaves what was typed alone', input.value, 'kazi');
  }

  // ---- the mouse works too --------------------------------------------
  {
    const { YDR } = loadSite();
    const input = makeNode('input');
    input.id = 'from';
    makeNode('div').appendChild(input);
    YDR.attachAutocomplete(input);

    input.type_('secun');
    const list = input.parentNode.children.filter((c) => c.id === 'from-suggestions')[0];
    list.children[0].fire('mousedown', { preventDefault: () => {} });
    check('clicking a suggestion fills the box', input.value, 'SECUNDERABAD');
    check('  and closes the list', list.hidden, true);
  }

  // ---- Escape closes it without choosing ------------------------------
  {
    const { YDR } = loadSite();
    const input = makeNode('input');
    input.id = 'from';
    makeNode('div').appendChild(input);
    YDR.attachAutocomplete(input);

    input.type_('vij');
    input.fire('keydown', { key: 'Escape', preventDefault: () => {} });
    const list = input.parentNode.children.filter((c) => c.id === 'from-suggestions')[0];
    check('Escape closes the list', list.hidden, true);
    check('  without choosing anything', input.value, 'vij');
  }

  // ---- a chosen station does not re-open the list ---------------------
  {
    const { YDR } = loadSite();
    const input = makeNode('input');
    input.id = 'from';
    makeNode('div').appendChild(input);
    YDR.attachAutocomplete(input);

    input.type_('VIJAYAWADA');
    const list = input.parentNode.children.filter((c) => c.id === 'from-suggestions')[0];
    check('an exact station name needs no list', list.hidden, true);
  }

  // ---- WHICH suggestion Daari rings -----------------------------------
  {
    /* findSuggestion out of the real overlay. It reads the option's own
       visible text -- the page author's words -- and never what the user
       typed. */
    const src = fs.readFileSync(path.join(EXT, 'content', 'overlay.js'), 'utf8');
    const from = src.indexOf('function findSuggestion(');
    const to = src.indexOf('function watchForSuggestion(');
    check('findSuggestion is where the test expects it', from > 0 && to > from, true);

    function runFind(optionTexts, want, invisible) {
      const options = optionTexts.map((text, i) => ({
        innerText: text,
        textContent: text,
        getBoundingClientRect: () => ((invisible || []).indexOf(i) !== -1
          ? { width: 0, height: 0 } : { width: 200, height: 20 })
      }));
      const sandbox = {
        document: { querySelectorAll: () => options },
        String: String, Object: Object
      };
      sandbox.self = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(src.slice(from, to) + '\n;this.__find = findSuggestion;', sandbox);
      const hit = sandbox.__find(want);
      return hit ? hit.innerText : null;
    }

    check('it rings the option that names the station',
      runFind(['KAZIPET  (KZJ)', 'VIJAYAWADA  (BZA)', 'WARANGAL  (WL)'], 'VIJAYAWADA'),
      'VIJAYAWADA  (BZA)');
    check('  not a different one that looks similar',
      runFind(['NEW DELHI  (NDLS)', 'NELLORE  (NLR)'], 'NELLORE'), 'NELLORE  (NLR)');
    check('a station not in the list rings nothing',
      runFind(['KAZIPET  (KZJ)'], 'VIJAYAWADA'), null);
    check('an empty list rings nothing', runFind([], 'VIJAYAWADA'), null);
    check('no station name rings nothing', runFind(['VIJAYAWADA  (BZA)'], ''), null);
    check('a suggestion that is not on screen is not rung',
      runFind(['VIJAYAWADA  (BZA)'], 'VIJAYAWADA', [0]), null);
  }

  // ---- the sentence it says --------------------------------------------
  {
    const S = ctx.self.DAARI_GUIDANCE.station;
    check('the pick sentence has a slot for the name',
      S.pickThisOne.en.indexOf('{name}') > 0, true);
    let missing = [];
    ['te', 'hi', 'en'].forEach((code) => {
      if (!S.pickThisOne[code]) { missing.push(code); }
      else if (S.pickThisOne[code].indexOf('{name}') === -1) { missing.push(code + ' (no slot)'); }
    });
    check('  in all three languages', missing.join(','), '');
    check('  and it reads as a sentence once filled',
      ctx.self.DAARI_T(S.pickThisOne, 'en', { name: 'VIJAYAWADA' }),
      'Pick the one that says VIJAYAWADA');
    check('  including in Telugu',
      ctx.self.DAARI_T(S.pickThisOne, 'te', { name: 'VIJAYAWADA' }).indexOf('VIJAYAWADA'),
      0);
  }
}
console.log('\n2r. The pacing and the new suggestion list, together');
{
  /* Feature 2 and Feature 3 have to fit. The pacing rule from Phase B waits
     for the suggestion list to open and close again before calling a station
     step done -- and that rule was written against a real site's markup, not
     against the practice site, which until now had no list at all.

     So this runs the REAL watchForDone from overlay.js against the REAL widget
     from practice/app.js. Not a copy of either: the shipped code, on both
     sides. If the demo site's markup ever stops looking like an autocomplete
     to the overlay, the step would complete the moment the first letter was
     typed and Daari would rush ahead -- which is the exact complaint that
     caused the pacing work in the first place. */

  // ---- a fake clock ----------------------------------------------------
  let now = 0;
  let timers = [];
  let nextId = 1;
  const fakeSetTimeout = (fn, ms) => {
    const id = nextId++;
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

  // ---- a node good enough for both the widget and the watcher ---------
  function makeNode(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      type: 'text',
      id: '',
      className: '',
      value: '',
      hidden: false,
      children: [],
      parentNode: null,
      style: {},
      _attrs: {},
      _listeners: {},
      setAttribute: (k, v) => { node._attrs[k] = String(v); },
      getAttribute: (k) => (k in node._attrs ? node._attrs[k] : null),
      hasAttribute: (k) => k in node._attrs,
      removeAttribute: (k) => { delete node._attrs[k]; },
      addEventListener: (name, fn) => {
        (node._listeners[name] = node._listeners[name] || []).push(fn);
      },
      removeEventListener: (name, fn) => {
        node._listeners[name] = (node._listeners[name] || []).filter((f) => f !== fn);
      },
      appendChild: (c) => { c.parentNode = node; node.children.push(c); return c; },
      insertBefore: (fresh, before) => {
        const at = node.children.indexOf(before);
        fresh.parentNode = node;
        node.children.splice(at === -1 ? node.children.length : at, 0, fresh);
        return fresh;
      },
      focus: () => {},
      getBoundingClientRect: () => (node.hidden
        ? { width: 0, height: 0, top: 0, left: 0 }
        : { width: 180, height: 22, top: 40, left: 20, bottom: 62, right: 200 }),
      fire: (name, event) => {
        (node._listeners[name] || []).slice().forEach((fn) => fn(event || {
          preventDefault: () => {}
        }));
      },
      type_: function (text) { this.value = text; this.fire('input'); }
    };
    Object.defineProperty(node, 'textContent', {
      get: () => node._text || '',
      set: (v) => { node._text = v; if (v === '') { node.children = []; } }
    });
    return node;
  }

  /* The practice site's widget, attached to a box, with its own fake DOM. */
  function buildWidget() {
    const created = [];
    const document = {
      createElement: (tag) => { const n = makeNode(tag); created.push(n); return n; },
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {}
    };
    const siteBox = { blurTimer: null };
    const sandbox = {
      document: document,
      window: {
        setTimeout: (fn) => { siteBox.blurTimer = fn; return 1; },
        clearTimeout: () => {}
      },
      console: { log: () => {}, warn: () => {} },
      localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      Date, Math, String, Number, Object, Array, JSON, RegExp, Boolean, Error
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'practice', 'app.js'), 'utf8'),
      sandbox, { filename: 'practice/app.js' });

    const input = makeNode('input');
    input.id = 'from';
    makeNode('div').appendChild(input);
    sandbox.YDR.attachAutocomplete(input);
    const list = input.parentNode.children.filter((c) => c.id === 'from-suggestions')[0];
    return { input: input, list: list };
  }

  /* The real watchForDone, pointed at that same box and that same list. */
  function watchIt(widget) {
    const src = fs.readFileSync(path.join(EXT, 'content', 'overlay.js'), 'utf8');
    const from = src.indexOf('  function watchForDone(');
    const to = src.indexOf('  /* ====', from);
    if (from === -1 || to === -1) { throw new Error('could not find watchForDone'); }

    const sandbox = {
      console: { log: () => {}, warn: () => {} },
      String: String, Number: Number, Object: Object, Array: Array, RegExp: RegExp,
      lastList: [{ el: widget.input,
        data: { i: 0, tag: 'input', type: 'text', name: 'From station *', filled: false } }],
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
        /* The widget's own list, by the id the widget's own box points at. */
        getElementById: function (id) {
          return (widget.list && widget.list.id === id) ? widget.list : null;
        },
        /* The widget's own options, exactly as the overlay would find them. */
        querySelector: function () {
          const open = !widget.list.hidden && widget.list.children.length;
          return open ? widget.list.children[0] : null;
        }
      }
    };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src.slice(from, to) + '\n;this.__watchForDone = watchForDone;', sandbox);

    const done = { count: 0, why: null };
    const hints = [];
    sandbox.__watchForDone('field_filled', 0,
      function (why) { done.count += 1; done.why = why; },
      function (key) { hints.push(key); });
    return { done: done, hints: hints, mutate: () => { if (sandbox.__mutate) { sandbox.__mutate(); } } };
  }

  // ---- the overlay recognises the practice site's box -------------------
  {
    const widget = buildWidget();
    const src = fs.readFileSync(path.join(EXT, 'content', 'overlay.js'), 'utf8');
    const from = src.indexOf('    function looksLikeAutocomplete(');
    const to = src.indexOf('    /* Is its list open right now? */', from);
    check('looksLikeAutocomplete is where the test expects it', from > 0 && to > from, true);

    const sandbox = { String: String, document: {} };
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(src.slice(from, to) + '\n;this.__looks = looksLikeAutocomplete;', sandbox);

    check('the practice station box looks like an autocomplete to the overlay',
      sandbox.__looks(widget.input), true);
    check('  and a plain box still does not',
      sandbox.__looks(makeNode('input')), false);
  }

  // ---- THE REAL THING: typing does not finish the step -----------------
  {
    const widget = buildWidget();
    const watch = watchIt(widget);

    widget.input.type_('vij');                 /* the list opens */
    check('typing opens the site list', widget.list.hidden, false);

    watch.mutate();
    tick(5000);
    check('the step does NOT complete while the list is open', watch.done.count, 0);
    check('  and the user is told to pick from the list',
      watch.hints.indexOf('pickFromList') !== -1, true);
  }

  // ---- choosing one DOES finish it -------------------------------------
  {
    const widget = buildWidget();
    const watch = watchIt(widget);

    widget.input.type_('vij');
    watch.mutate();
    tick(1000);
    check('still waiting', watch.done.count, 0);

    /* Pick it with the keyboard, exactly as a user would. */
    widget.input.fire('keydown', { key: 'ArrowDown', preventDefault: () => {} });
    widget.input.fire('keydown', { key: 'Enter', preventDefault: () => {} });
    check('the box now holds the station', widget.input.value, 'VIJAYAWADA');
    check('  and the list closed', widget.list.hidden, true);

    watch.mutate();
    tick(5000);
    check('choosing a suggestion completes the step', watch.done.count, 1);
  }

  // ---- and with the mouse ----------------------------------------------
  {
    const widget = buildWidget();
    const watch = watchIt(widget);

    widget.input.type_('secun');
    watch.mutate();
    tick(1000);
    widget.list.children[0].fire('mousedown', { preventDefault: () => {} });
    check('clicking a suggestion fills the box', widget.input.value, 'SECUNDERABAD');

    watch.mutate();
    tick(5000);
    check('and completes the step', watch.done.count, 1);
  }

  // ---- half a station name, list still open, nothing happens ----------
  {
    /* The original complaint, in one test: "it rushes ahead while I am still
       typing a station name". */
    const widget = buildWidget();
    const watch = watchIt(widget);

    ['s', 'se', 'sec', 'secu'].forEach(function (sofar) {
      widget.input.type_(sofar);
      watch.mutate();
      tick(600);
    });
    check('four letters in, with the list open, the step has not moved on',
      watch.done.count, 0);
  }
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
  check('a LINK saying "Cancel this booking" does NOT gate - it navigates to a cancel page', s.gate, false);

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
