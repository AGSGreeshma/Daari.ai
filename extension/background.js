/* Daari's brain -- the service worker.

   It holds the session: what the user is trying to do, which step they are on,
   and what has happened. It lives here and not in the page because the content
   script is destroyed on every page load, and a booking flow is nothing but
   page loads.

   THE ONE RULE IN THIS FILE: the session is read from chrome.storage.session
   at the start of every single message, and written back at the end. There is
   no in-memory copy. Chrome can stop this worker between any two messages --
   after about 30 seconds of quiet -- and with no cached state there is nothing
   to lose and nothing to restore. "Reload it on worker start" becomes a
   non-event rather than a code path that has to be right.

   No AI here yet. Phase 5 adds the call; aiCallCount is already in the session
   so the 25-step budget cap has somewhere to live. */

importScripts('strings.js', 'safety.js', 'flows.js');

var SESSION_KEY = 'daariSession';

/* =================================================================
   The session
   ================================================================= */

async function getSession() {
  var stored = await chrome.storage.session.get(SESSION_KEY);
  return stored[SESSION_KEY] || null;
}

async function saveSession(session) {
  await chrome.storage.session.set({ daariSession: session });
  broadcastStatus(session);
}

async function clearSession() {
  await chrome.storage.session.remove(SESSION_KEY);
  broadcastStatus(null);
}

/* The language is read fresh from storage rather than trusted from the
   session, so switching language halfway through a booking takes effect on
   the very next instruction. */
async function currentLang() {
  var stored = await chrome.storage.local.get({ lang: 'te' });
  return stored.lang;
}

function flowFor(session) {
  return session ? self.DAARI_FLOWS[session.flowId] : null;
}

function stepAt(session) {
  var flow = flowFor(session);
  if (!flow) { return null; }
  return flow.steps[session.stepIndex] || null;
}

/* "field_filled:mobile number" -> "field_filled" */
function ruleKind(rule) {
  return String(rule || '').split(':')[0];
}

/* =================================================================
   Describing a step to the page

   The worker resolves the SENTENCE (it knows the language) and the page
   resolves the ELEMENT (it knows the DOM). Neither does the other's job.
   ================================================================= */

async function describeStep(session) {
  var flow = flowFor(session);
  if (!flow) { return { active: false }; }

  var step = flow.steps[session.stepIndex];
  var lang = await currentLang();

  if (!step) {
    /* Walked off the end of the flow. */
    return { active: false, finished: true };
  }

  return {
    active: true,
    index: session.stepIndex,
    number: session.stepIndex + 1,
    total: flow.steps.length,
    lang: lang,
    look_for: step.look_for || [],
    done_when: step.done_when || '',
    sensitive: !!step.sensitive,
    final: !!step.final,
    /* Has the user already said "I have checked" for this exact step? */
    confirmed: session.confirmedStep === session.stepIndex,
    say: self.DAARI_T(self.DAARI_STRINGS.flow[step.sayKey], lang),
    stepLabel: self.DAARI_T(self.DAARI_STRINGS.ui.stepOf, lang, {
      n: session.stepIndex + 1,
      total: flow.steps.length
    })
  };
}

/* Move to the next step.

   history deliberately records only the step number, its key and the time.
   Nothing read from the page goes in here -- not even an element's label --
   so there is no route by which anything the user typed could end up in
   stored state. */
function advance(session, url) {
  var step = stepAt(session);
  session.history.push({
    step: session.stepIndex,
    sayKey: step ? step.sayKey : null,
    at: Date.now()
  });
  session.stepIndex += 1;
  session.confirmedStep = null;
  session.awaitingConfirm = null;
  if (url) { session.stepUrl = url; }
}

/* =================================================================
   Talking to the page and the panel
   ================================================================= */

async function activeTabId() {
  var tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs.length ? tabs[0].id : null;
}

async function tellPage(message, tabId) {
  var id = tabId || await activeTabId();
  if (id === null) { return; }
  try {
    await chrome.tabs.sendMessage(id, message);
  } catch (e) {
    /* No content script in that tab (a chrome:// page, or one not reloaded
       since the extension was installed). Not an error worth shouting about. */
  }
}

/* Tell the side panel where we are. The panel is often closed, and that is
   fine -- nobody is listening and the guidance carries on regardless. */
function broadcastStatus(session) {
  var payload = { type: 'DAARI_STATUS', active: false };

  if (session) {
    var flow = flowFor(session);
    payload.active = true;
    payload.number = session.stepIndex + 1;
    payload.total = flow ? flow.steps.length : 0;
    payload.awaitingConfirm = session.awaitingConfirm !== null &&
                              session.awaitingConfirm !== undefined;
    payload.finished = !!session.finished;
  }

  try {
    var sending = chrome.runtime.sendMessage(payload);
    if (sending && sending.catch) { sending.catch(function () {}); }
  } catch (e) { /* panel closed */ }
}

/* =================================================================
   Message handlers
   ================================================================= */

var HANDLERS = {

  /* The panel pressed "start". */
  DAARI_START_FLOW: async function (message) {
    var lang = await currentLang();
    var session = {
      goal: message.goal || '',
      lang: lang,
      flowId: message.flowId,
      stepIndex: 0,
      history: [],
      aiCallCount: 0,        /* Phase 5 budget cap lives here */
      stepUrl: null,
      confirmedStep: null,
      awaitingConfirm: null,
      finished: false,
      startedAt: Date.now()
    };
    await saveSession(session);

    var payload = await describeStep(session);
    await tellPage({ type: 'DAARI_RUN_STEP', step: payload }, message.tabId);
    return { ok: true };
  },

  /* A page just finished loading and is asking whether it has a job.

     This is also where the url_changed rule is settled. Doing it here rather
     than in the page means nothing depends on a message escaping a page that
     is in the middle of being destroyed -- which is the race that makes
     cross-page flows flaky. */
  DAARI_PAGE_READY: async function (message) {
    var session = await getSession();
    if (!session) { return { active: false }; }

    var step = stepAt(session);
    if (step &&
        ruleKind(step.done_when) === 'url_changed' &&
        session.stepUrl &&
        session.stepUrl !== message.url) {
      advance(session, message.url);
    }

    session.stepUrl = message.url;
    var payload = await describeStep(session);
    if (payload.final) { session.finished = true; }
    await saveSession(session);
    return payload;
  },

  /* The page saw the step finish, locally and for free. */
  DAARI_STEP_DONE: async function (message) {
    var session = await getSession();
    if (!session) { return { active: false }; }

    advance(session, message.url);
    var payload = await describeStep(session);
    if (payload.final) { session.finished = true; }
    await saveSession(session);
    return payload;
  },

  /* The page is about to point at something dangerous and has stopped. */
  DAARI_NEEDS_CONFIRM: async function () {
    var session = await getSession();
    if (!session) { return { ok: false }; }
    session.awaitingConfirm = session.stepIndex;
    await saveSession(session);
    return { ok: true };
  },

  /* The user pressed "I have checked". */
  DAARI_CONFIRMED: async function () {
    var session = await getSession();
    if (!session) { return { ok: false }; }

    session.confirmedStep = session.stepIndex;
    session.awaitingConfirm = null;
    await saveSession(session);

    var payload = await describeStep(session);
    await tellPage({ type: 'DAARI_RUN_STEP', step: payload });
    return { ok: true };
  },

  DAARI_STOP_FLOW: async function () {
    await clearSession();
    await tellPage({ type: 'DAARI_CLEAR' });
    return { ok: true };
  },

  DAARI_GET_STATUS: async function () {
    var session = await getSession();
    if (!session) { return { active: false }; }
    var flow = flowFor(session);
    return {
      active: true,
      number: session.stepIndex + 1,
      total: flow ? flow.steps.length : 0,
      awaitingConfirm: session.awaitingConfirm !== null &&
                       session.awaitingConfirm !== undefined,
      finished: !!session.finished,
      goal: session.goal
    };
  }
};

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  /* Anything we do not handle is left alone. The panel and the content script
     talk to each other through this same channel, and returning true for
     their messages would leave those senders waiting for a reply that never
     comes. */
  if (!message || !message.type || !HANDLERS[message.type]) { return false; }

  HANDLERS[message.type](message, sender).then(sendResponse).catch(function (error) {
    console.error('[Daari] ' + message.type + ' failed:', error);
    sendResponse({ ok: false, error: String(error) });
  });

  return true;   /* keep the channel open for the async reply */
});
