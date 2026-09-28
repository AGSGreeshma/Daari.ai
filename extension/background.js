/* Daari's brain -- the service worker.

   It holds the session, decides each step, and is the only place that talks to
   our API. It lives here and not in the page because the content script is
   destroyed on every page load, and a booking flow is nothing but page loads.

   THE ONE RULE IN THIS FILE: the session is read from chrome.storage.session at
   the start of every single message and written back at the end. There is no
   in-memory copy. Chrome can stop this worker between any two messages -- after
   about 30 seconds of quiet -- and with no cached state there is nothing to lose
   and nothing to restore.

   HOW A STEP IS DECIDED, in one paragraph. The recipe (if any) is resolved
   locally first, so the safety net is ready BEFORE we ask anyone anything. Then
   the model is asked, on every step, with the recipe passed in as a hint. Its
   answer is used only if it agrees with the recipe about WHICH element; on any
   disagreement, timeout, bad schema or low confidence, Daari falls back to the
   recipe's own element and its pre-written sentence. With no recipe at all the
   model works alone, and is believed only when it is confident. */

importScripts('config.js', 'strings.js', 'safety.js', 'matching.js');

var SESSION_KEY = 'daariSession';

/* The recipes Daari knows. An extension cannot list its own directory, so the
   filenames are named here. */
var RECIPE_FILES = ['practice-book-ticket', 'practice-check-pnr'];

/* Budget, from CLAUDE.md rule 6. Counted in the worker, which is the only place
   that can actually spend money. */
var MAX_AI_CALLS = 25;

/* How long to wait for our API before giving up and using the recipe. The page
   speaks "one moment" at 1.5s so the user is not left in silence. */
var AI_TIMEOUT_MS = 6000;

/* Below this, the model's answer is not trusted. A wrong instruction is far
   worse for this audience than admitting uncertainty. */
var MIN_CONFIDENCE = 0.45;

/* =================================================================
   Recipes -- static data, so caching them in the worker is fine.
   Losing the cache when the worker sleeps costs one re-read of two
   small files.
   ================================================================= */

var recipeCache = null;

async function allRecipes() {
  if (recipeCache) { return recipeCache; }

  var loaded = {};
  for (var i = 0; i < RECIPE_FILES.length; i++) {
    var name = RECIPE_FILES[i];
    try {
      var response = await fetch(chrome.runtime.getURL('recipes/' + name + '.json'));
      var recipe = await response.json();
      loaded[recipe.task] = recipe;
    } catch (e) {
      console.error('[Daari] could not load recipe ' + name, e);
    }
  }
  recipeCache = loaded;
  return loaded;
}

/* Which recipe, if any, is this spoken goal asking for?

   Every language's phrases are checked regardless of the chosen language,
   because people mix languages when they speak -- "PNR status చెక్ చేయాలి" is
   completely normal. The recipe matching the most phrases wins. */
async function matchRecipe(goal) {
  var text = String(goal || '').toLowerCase();
  if (!text) { return null; }

  var recipes = await allRecipes();
  var best = null;
  var bestHits = 0;

  Object.keys(recipes).forEach(function (task) {
    var phrases = recipes[task].match_phrases || {};
    var hits = 0;
    Object.keys(phrases).forEach(function (lang) {
      (phrases[lang] || []).forEach(function (phrase) {
        if (text.indexOf(String(phrase).toLowerCase()) !== -1) { hits += 1; }
      });
    });
    if (hits > bestHits) { bestHits = hits; best = task; }
  });

  return best;
}

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

/* Read fresh rather than trusted from the session, so switching language
   halfway through a booking takes effect on the very next instruction. */
async function currentLang() {
  var stored = await chrome.storage.local.get({ lang: 'te' });
  return stored.lang;
}

async function recipeFor(session) {
  if (!session || !session.flowId) { return null; }
  var recipes = await allRecipes();
  return recipes[session.flowId] || null;
}

/* "field_filled:mobile number" -> "field_filled" */
function ruleKind(rule) {
  return String(rule || '').split(':')[0];
}

/* The earliest step that belongs to this page, looking only at steps already
   walked past. -1 if the user has not been on this page yet.

   The FIRST step on the page, deliberately: arriving back at the search page
   means filling the search form again from the top, not resuming halfway down a
   form whose boxes have been reset. */
function firstStepOnPage(recipe, page, beforeIndex) {
  for (var i = 0; i < beforeIndex && i < recipe.steps.length; i++) {
    if (recipe.steps[i].page === page) { return i; }
  }
  return -1;
}

/* Move to the next step.

   history records only the step number, the recipe's own label for it, and the
   time. Nothing read from the page is stored -- not even an element's label --
   so there is no route by which anything the user typed could reach stored
   state. */
function advance(session, recipe, url) {
  var step = recipe ? recipe.steps[session.stepIndex] : null;
  session.history.push({
    step: session.stepIndex,
    label: step && step.look_for ? step.look_for[0] : null,
    at: Date.now()
  });
  if (session.history.length > 40) { session.history.shift(); }
  session.stepIndex += 1;
  session.confirmedStep = null;
  session.awaitingConfirm = null;
  if (url) { session.stepUrl = url; }
}

/* =================================================================
   Asking the model
   ================================================================= */

async function callAi(session, page, recipeStep, lang) {
  var base = self.DAARI_CONFIG && self.DAARI_CONFIG.API_BASE;
  if (!base) { return { ok: false, reason: 'no API_BASE in config.js' }; }

  /* Rule 2, checked again on the way out. The page already promises this, but
     a rule this important does not depend on one place remembering. */
  var forbidden = self.DAARI_FIND_FORBIDDEN_FIELDS(page.elements);
  if (forbidden.length) {
    console.error('[Daari] REFUSING to send elements carrying: ' + forbidden.join(', '));
    return { ok: false, reason: 'forbidden fields in payload' };
  }

  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, AI_TIMEOUT_MS);

  try {
    var response = await fetch(base + '/api/step', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        /* The API refuses requests without this. See config.js. */
        'X-Daari-Client': self.DAARI_CONFIG.CLIENT
      },
      body: JSON.stringify({
        goal: session.goal || '',
        lang: lang,
        url: page.url,
        title: page.title,
        elements: page.elements,
        recipeStep: recipeStep
          ? { look_for: recipeStep.look_for, sensitive: !!recipeStep.sensitive }
          : null,
        history: session.history.slice(-8).map(function (h) {
          return h.label || ('step ' + (h.step + 1));
        })
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return { ok: false, reason: 'http ' + response.status };
    }

    var answer = await response.json();

    /* Schema check. An answer that is the wrong shape is treated exactly like
       no answer at all: the recipe takes over. */
    if (typeof answer.speech !== 'string' || !answer.speech.trim()) {
      return { ok: false, reason: 'no speech in answer' };
    }
    if (typeof answer.confidence !== 'number') {
      return { ok: false, reason: 'no confidence in answer' };
    }
    if (answer.elementIndex !== null && !Number.isInteger(answer.elementIndex)) {
      return { ok: false, reason: 'elementIndex not an integer' };
    }

    return { ok: true, answer: answer };

  } catch (error) {
    return { ok: false, reason: error && error.name === 'AbortError' ? 'timeout' : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/* =================================================================
   Deciding one step

   The worker resolves the SENTENCE and WHICH element; the page resolves the
   DOM and draws. Neither does the other's job.
   ================================================================= */

async function decideStep(session, page) {
  var recipe = await recipeFor(session);
  var recipeStep = recipe ? recipe.steps[session.stepIndex] : null;
  var lang = await currentLang();
  var S = self.DAARI_STRINGS;

  if (recipe && !recipeStep) {
    return { active: false, finished: true };
  }

  var payload = {
    active: true,
    number: session.stepIndex + 1,
    total: recipe ? recipe.steps.length : 0,
    lang: lang,
    sensitive: !!(recipeStep && recipeStep.sensitive),
    final: !!(recipeStep && recipeStep.final),
    gate: false,
    index: -1,
    done_when: '',
    stepLabel: '',
    /* Sent so the page can run its own independent gate check. Defence in
       depth: a safety rule should not have exactly one guard. */
    confirmed: session.confirmedStep === session.stepIndex
  };

  payload.stepLabel = payload.total
    ? self.DAARI_T(S.ui.stepOf, lang, { n: payload.number, total: payload.total })
    : self.DAARI_T(S.ui.stepOnly, lang, { n: payload.number });

  /* The last step of a recipe points at nothing. */
  if (payload.final) {
    payload.say = self.DAARI_T(recipeStep.say, lang);
    payload.path = 'recipe';
    return payload;
  }

  var elements = (page && page.elements) || [];

  /* The safety net is built FIRST, before anyone is asked anything, so it is
     already in hand whatever happens next. */
  var recipeIndex = recipeStep
    ? self.DAARI_RESOLVE_BY_NAME(elements, recipeStep.look_for || [])
    : -1;

  /* ---- the confirm gate, part one ------------------------------------------

     When the recipe already knows which element this is, the gate is checked
     BEFORE spending a call on it. There is no point paying the model to phrase
     a step we are not going to show yet. */
  if (recipeIndex !== -1 &&
      gateApplies(elements[recipeIndex], recipeStep) &&
      session.confirmedStep !== session.stepIndex) {
    return gatePayload(payload, session, lang);
  }

  /* ---- ask the model ------------------------------------------------------ */
  var ai = null;
  var reason = null;

  if (session.aiCallCount >= MAX_AI_CALLS) {
    session.budgetHit = true;
    reason = 'budget of ' + MAX_AI_CALLS + ' calls used up';
  } else if (elements.length) {
    session.aiCallCount += 1;
    var attempt = await callAi(session, page, recipeStep, lang);
    if (attempt.ok) { ai = attempt.answer; } else { reason = attempt.reason; }
  } else {
    reason = 'nothing on the page to choose from';
  }

  payload.modelWantedStop = !!(ai && ai.stopAndConfirm === true);

  /* ---- THE VALIDATION GATE ------------------------------------------------

     The model's answer is used only when it agrees with the recipe about WHICH
     element. Note what this compares: two indices, computed by the same
     matching code on the same list. Not two strings, fuzzily.

     When there is no recipe, there is nothing to agree with, so the answer is
     judged on its own.

     goalAchievableHere is checked FIRST and independently of confidence. The
     live evaluation found the model returning confidence 0.9 on 30 of 31
     answers -- a constant, not a judgement -- which left the threshold below
     doing nothing at all. Asked in Hindi to apply for a passport, on the
     payment page, it confidently pointed at the Pay button. Making the model
     answer "can this page do this at all?" as its own separate field is what
     gives Daari a way to say "I am not sure" and mean it. */
  var wrongPage = ai && ai.goalAchievableHere === false;

  var usable = ai && !wrongPage &&
               ai.elementIndex !== null &&
               ai.confidence >= MIN_CONFIDENCE &&
               elements[ai.elementIndex];

  if (usable && (!recipeStep || ai.elementIndex === recipeIndex)) {
    payload.index = ai.elementIndex;
    payload.say = ai.speech;
    payload.done_when = ai.done_when || (recipeStep && recipeStep.done_when) || 'clicked';
    payload.path = 'ai';
    payload.confidence = ai.confidence;

  } else if (recipeStep && recipeIndex !== -1) {
    payload.index = recipeIndex;
    payload.say = self.DAARI_T(recipeStep.say, lang);
    payload.done_when = recipeStep.done_when || 'clicked';
    payload.path = 'fallback';
    payload.why = ai
      ? (wrongPage ? 'model says this page cannot do it'
          : ai.elementIndex === null ? 'model found nothing'
          : ai.confidence < MIN_CONFIDENCE ? 'model unsure (' + ai.confidence + ')'
          : 'model chose a different element')
      : reason;

  } else {
    /* Neither the model nor a recipe can say what to do. Say so. */
    payload.index = -1;
    payload.say = self.DAARI_T(S.ui.notSure, lang);
    payload.path = 'none';
    payload.why = wrongPage ? 'model says this page cannot do it'
                : reason || 'no element matched';
  }

  /* ---- the confirm gate, part two ----------------------------------------

     For an element the model chose on its own, the gate is checked here, once
     we know what it picked. The model's stopAndConfirm is OR-ed in, so it can
     only ever ADD a stop -- never remove the one our own code decided on. */
  if (payload.index !== -1 &&
      gateApplies(elements[payload.index], recipeStep) &&
      session.confirmedStep !== session.stepIndex) {
    return gatePayload(payload, session, lang);
  }

  session.awaitingConfirm = null;
  session.lastPath = payload.path;
  rememberPath(session, payload);

  if (session.budgetHit && !session.budgetToldUser) {
    session.budgetToldUser = true;
    payload.notice = self.DAARI_T(S.ui.budgetSpent, lang);
  }

  return payload;
}

/* Does Daari have to stop before pointing at this?

   OUR CODE DECIDES. The model's stopAndConfirm is recorded but never acted on.

   It used to be OR-ed in, on the reasoning that the model could only ever ADD a
   stop and so could only make things safer. The live evaluation showed why that
   was wrong: the model asked for a stop on "From station", "To station",
   "Class" and "PNR number" -- 9 false stops in 31 cases. A user would have had
   to press "I have checked" on nearly every step, which does not make anything
   safer, it just teaches them to press it without looking. A stop that fires
   constantly is a stop nobody reads.

   It also quietly broke CLAUDE.md rule 3. "Safety is enforced in code, never
   delegated to the model" has to mean both directions: the model may not remove
   a stop, and it may not invent one either.

   The trade, stated plainly: a dangerous button whose label contains no risky
   word will not be caught. In the evaluation our own list caught 3 out of 3
   anyway -- the model never contributed a stop that mattered. If a real site
   turns up such a button, its wording goes in safety.js where it can be tested. */
function gateApplies(element, recipeStep) {
  if (!element) { return false; }
  return self.DAARI_NEEDS_CONFIRM(element.name) ||
         !!(recipeStep && recipeStep.confirm === true);
}

/* A gated step carries NO element index, so the page cannot ring the button
   even if it wanted to. */
function gatePayload(payload, session, lang) {
  session.awaitingConfirm = session.stepIndex;
  payload.gate = true;
  payload.index = -1;
  payload.done_when = '';
  payload.say = self.DAARI_T(self.DAARI_STRINGS.ui.confirmBeforePay, lang);
  payload.stepLabel = self.DAARI_T(self.DAARI_STRINGS.ui.checkFirst, lang);
  payload.path = 'gate';
  return payload;
}

function rememberPath(session, payload) {
  session.pathLog = session.pathLog || [];
  session.pathLog.push({
    step: session.stepIndex + 1,
    path: payload.path,
    why: payload.why || null,
    /* Recorded, not obeyed. Worth seeing how often the model asks for a stop we
       did not give it -- that number is the evidence for the decision above. */
    modelWantedStop: !!payload.modelWantedStop
  });
  if (session.pathLog.length > 30) { session.pathLog.shift(); }
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
       since the extension was installed). Not worth shouting about. */
  }
}

/* Tell the side panel where we are. The panel is often closed, and that is fine
   -- nobody is listening and the guidance carries on regardless. */
function broadcastStatus(session) {
  var payload = { type: 'DAARI_STATUS', active: false };

  if (session) {
    payload.active = true;
    payload.number = session.stepIndex + 1;
    payload.total = session.total || 0;
    payload.awaitingConfirm = session.awaitingConfirm !== null &&
                              session.awaitingConfirm !== undefined;
    payload.finished = !!session.finished;
    payload.lastPath = session.lastPath || null;
    payload.aiCallCount = session.aiCallCount || 0;
    payload.maxAiCalls = MAX_AI_CALLS;
    payload.pathLog = (session.pathLog || []).slice(-8);
    payload.flowId = session.flowId || null;
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

  /* A goal was spoken or typed. Match it to a recipe if we can; otherwise the
     model works alone on whatever site this is. */
  DAARI_START_FLOW: async function (message) {
    var lang = await currentLang();
    var task = message.flowId || await matchRecipe(message.goal);
    var recipes = await allRecipes();
    var recipe = task ? recipes[task] : null;

    var session = {
      goal: message.goal || '',
      lang: lang,
      flowId: task || null,
      total: recipe ? recipe.steps.length : 0,
      stepIndex: 0,
      history: [],
      aiCallCount: 0,
      pathLog: [],
      stepUrl: null,
      confirmedStep: null,
      awaitingConfirm: null,
      finished: false,
      budgetHit: false,
      budgetToldUser: false,
      lastPath: null,
      startedAt: Date.now()
    };
    await saveSession(session);

    return { ok: true, flowId: session.flowId, aiOnly: !recipe };
  },

  /* A page loaded (or was resumed) and is asking what to do, handing over what
     it can see.

     This is also where every URL decision is settled. Doing it here rather than
     in the page means nothing depends on a message escaping a page that is
     being destroyed -- the race that makes cross-page flows flaky.

       the page of the current step  -> carry on, same step
       the page of the NEXT step     -> the step completed, advance
       the page of an EARLIER step   -> the user pressed Back
       anything else                 -> leave the step alone */
  DAARI_PAGE_READY: async function (message) {
    var session = await getSession();
    if (!session) { return { active: false }; }

    var recipe = await recipeFor(session);
    var step = recipe ? recipe.steps[session.stepIndex] : null;
    var here = self.DAARI_PAGE_OF(message.url);
    var notice = null;

    if (recipe && step) {
      var nextStep = recipe.steps[session.stepIndex + 1];

      if (step.page && here === step.page) {
        /* Same page. A reload, or coming straight back. Nothing to do. */

      } else if (ruleKind(step.done_when) === 'url_changed' &&
                 nextStep && nextStep.page && here === nextStep.page) {
        advance(session, recipe, message.url);

      } else {
        var backTo = firstStepOnPage(recipe, here, session.stepIndex);
        if (backTo !== -1) {
          session.stepIndex = backTo;
          session.confirmedStep = null;
          session.awaitingConfirm = null;
          session.finished = false;
          notice = 'wentBack';
        }
      }
    }

    session.stepUrl = message.url;
    var payload = await decideStep(session, message);
    if (notice) {
      payload.notice = self.DAARI_T(self.DAARI_STRINGS.ui[notice], await currentLang());
    }
    if (payload.final) { session.finished = true; }
    await saveSession(session);
    return payload;
  },

  /* The page saw the step finish, locally and for free. */
  DAARI_STEP_DONE: async function (message) {
    var session = await getSession();
    if (!session) { return { active: false }; }

    var recipe = await recipeFor(session);
    advance(session, recipe, message.url);

    var payload = await decideStep(session, message);
    if (payload.final) { session.finished = true; }
    await saveSession(session);
    return payload;
  },

  /* The user pressed "I have checked". The page is asked to report in again
     with fresh elements, rather than the worker keeping a copy of the page. */
  DAARI_CONFIRMED: async function () {
    var session = await getSession();
    if (!session) { return { ok: false }; }

    session.confirmedStep = session.stepIndex;
    session.awaitingConfirm = null;
    await saveSession(session);

    await tellPage({ type: 'DAARI_ASK_AGAIN' });
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
    return {
      active: true,
      number: session.stepIndex + 1,
      total: session.total || 0,
      awaitingConfirm: session.awaitingConfirm !== null &&
                       session.awaitingConfirm !== undefined,
      finished: !!session.finished,
      goal: session.goal,
      lastPath: session.lastPath || null,
      aiCallCount: session.aiCallCount || 0,
      maxAiCalls: MAX_AI_CALLS,
      pathLog: (session.pathLog || []).slice(-8),
      flowId: session.flowId || null
    };
  }
};

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  /* Anything we do not handle is left alone. The panel and the content script
     talk to each other through this same channel, and returning true for their
     messages would leave those senders waiting for a reply that never comes. */
  if (!message || !message.type || !HANDLERS[message.type]) { return false; }

  HANDLERS[message.type](message, sender).then(sendResponse).catch(function (error) {
    console.error('[Daari] ' + message.type + ' failed:', error);
    sendResponse({ ok: false, error: String(error) });
  });

  return true;   /* keep the channel open for the async reply */
});
