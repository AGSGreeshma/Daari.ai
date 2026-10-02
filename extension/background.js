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

importScripts('config.js', 'strings.js', 'strings-guidance.js', 'safety.js',
              'matching.js');

var SESSION_KEY = 'daariSession';

/* The recipes Daari knows. An extension cannot list its own directory, so the
   filenames are named here. */
var RECIPE_FILES = ['practice-book-ticket', 'practice-check-pnr', 'real-pnr-enquiry'];

/* Budget, from CLAUDE.md rule 6. Counted in the worker, which is the only place
   that can actually spend money. */
var MAX_AI_CALLS = 25;

/* How long to wait for our API before giving up and using the recipe. The page
   speaks "one moment" at 1.5s so the user is not left in silence. */
var AI_TIMEOUT_MS = 6000;

/* Below this, the model's answer is not trusted. A wrong instruction is far
   worse for this audience than admitting uncertainty. */
var MIN_CONFIDENCE = 0.45;

/* Higher bar when there is no recipe to agree with. A recipe-backed answer has a
   second opinion behind it; an unaccompanied one has only itself, and the first
   live run showed the model reporting 0.9 whatever it actually knew. */
var MIN_CONFIDENCE_ALONE = 0.7;

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

/* Which recipe, if any, is this goal asking for ON THIS PAGE?

   BOTH have to agree: the goal must match the recipe's phrases AND the page must
   be on one of the recipe's hosts. The goal alone is not enough, and finding that
   out the hard way is why this function takes a url.

   What happened without it: on irctc.co.in the practice-site recipe matched the
   goal "book a ticket", found From and To by luck, the panel announced "Step 3 of
   15", and then Daari said "I am not sure" at the Class step. Confidently wrong on
   somebody's real booking page is the worst thing it can do.

   Every language's phrases are checked regardless of the chosen language, because
   people mix languages when they speak -- "PNR status చెక్ చేయాలి" is completely
   normal. The recipe matching the most phrases wins. */
async function matchRecipe(goal, url) {
  var text = String(goal || '').toLowerCase();
  if (!text) { return null; }

  var recipes = await allRecipes();
  var best = null;
  var bestHits = 0;

  Object.keys(recipes).forEach(function (task) {
    /* A recipe can be switched off while it is still being written. A stub with
       placeholder labels would match a goal and then resolve to nothing, so
       Daari would say "I am not sure" on a page it could otherwise have read
       with no recipe at all -- worse than having no recipe. */
    if (recipes[task].enabled === false) { return; }

    /* Wrong site: not a candidate, however well the words line up. */
    if (!self.DAARI_RECIPE_APPLIES(recipes[task], url)) { return; }

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

/* How much help the user asked for, read fresh for the same reason as the
   language: switching mode mid-booking takes effect on the very next step.

   Anything that is not exactly 'full' is 'light'. Light is today's tested
   behaviour, so a missing or corrupted value lands the user somewhere known
   to work rather than somewhere half-built. */
async function currentHelpLevel() {
  var stored = await chrome.storage.local.get({ helpLevel: 'light' });
  return stored.helpLevel === 'full' ? 'full' : 'light';
}

/* The pre-written full-mode text for a recipe, or null. */
function guidanceFor(recipe) {
  var all = self.DAARI_GUIDANCE && self.DAARI_GUIDANCE.byTask;
  if (!all || !recipe || !recipe.task) { return null; }
  return all[recipe.task] || null;
}

/* The sentence for a step.

   In full mode a pre-written sentence that says WHY replaces the short one.
   Where no full sentence has been written -- the whole check-pnr recipe, for
   instance -- this returns the ordinary one, so an unfinished translation
   behaves exactly like light mode instead of going silent. */
function stepSentence(recipe, recipeStep, stepIndex, lang, helpLevel) {
  if (helpLevel === 'full') {
    var g = guidanceFor(recipe);
    var full = g && g.stepFull && g.stepFull[stepIndex];
    if (full && full[lang]) { return self.DAARI_T(full, lang); }
  }
  return self.DAARI_T(recipeStep.say, lang);
}

/* In full mode, the first time this session lands on a page, say what the page
   is for -- then the instruction, in the same breath.

   Joined into one sentence rather than sent as a second message: the caption
   in the page and the speech in the panel then cannot get out of order, and
   nothing in the overlay or the panel had to change to carry it.

   Once per page per session. Somebody who goes back a page does not need to be
   told again what they are looking at. */
function withPageIntro(sentence, recipe, recipeStep, session, lang, helpLevel) {
  if (helpLevel !== 'full' || !recipeStep || !recipeStep.page) { return sentence; }

  var g = guidanceFor(recipe);
  var intro = g && g.pageIntro && g.pageIntro[recipeStep.page];
  if (!intro || !intro[lang]) { return sentence; }

  session.introduced = session.introduced || [];
  if (session.introduced.indexOf(recipeStep.page) !== -1) { return sentence; }
  session.introduced.push(recipeStep.page);

  return self.DAARI_T(intro, lang) + ' ' + sentence;
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

/* The same thing looking the other way: the earliest step on this page among the
   ones still ahead. Used when the browser's Forward button lands the user
   somewhere they had already been.

   Skips the immediate next step, because that case is a normal forward
   navigation and is handled by its own rule before this one is consulted. */
function nextStepOnPage(recipe, page, afterIndex) {
  for (var i = afterIndex + 2; i < recipe.steps.length; i++) {
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

async function callAi(session, page, recipeStep, lang, hintIndex) {
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
          ? {
              look_for: recipeStep.look_for,
              sensitive: !!recipeStep.sensitive,
              /* The element our own matcher already resolved this step to, by
                 index into the very list being sent. On a recipe-backed step the
                 model no longer has to FIND the element -- it confirms it and
                 writes the sentence. Asking it to choose independently was the
                 single biggest source of disagreement in the first live run: it
                 picked the submit button every time, answering the whole goal in
                 one move instead of naming the next step. -1 when the recipe
                 could not resolve, in which case it does have to choose. */
              expectedElementIndex: typeof hintIndex === 'number' ? hintIndex : -1
            }
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

  /* A session can wander. Someone starts on the practice site and then opens
     IRCTC in the same tab, and the recipe's steps are meaningless there -- its
     page names, its labels, its count. So the recipe is re-checked against THIS
     page every single step, not just when the session began, and if it does not
     belong here the model works alone. */
  var hadRecipe = !!recipe;
  var onItsSite = recipe ? self.DAARI_RECIPE_APPLIES(recipe, page && page.url) : false;
  if (recipe && !onItsSite) { recipe = null; }

  var recipeStep = recipe ? recipe.steps[session.stepIndex] : null;
  var lang = await currentLang();
  var helpLevel = await currentHelpLevel();
  var S = self.DAARI_STRINGS;

  if (recipe && !recipeStep) {
    return { active: false, finished: true };
  }

  var payload = {
    active: true,
    /* The step's own index, sent explicitly so the page can stamp a completion
       with it. Deriving it from "number" invites an off-by-one in the one place
       an off-by-one would silently skip a step. */
    stepIndex: session.stepIndex,
    number: session.stepIndex + 1,
    /* The labels this step is looking for.

       These stopped being sent in Phase 5, when the worker began resolving the
       element itself -- which quietly killed waitForElement() in the overlay, the
       recovery path for an element that has not rendered yet. It resolved against
       an undefined list, found nothing, and retried forever. Sent again. */
    look_for: [],
    total: recipe ? recipe.steps.length : 0,
    lang: lang,
    sensitive: !!(recipeStep && recipeStep.sensitive),
    final: !!(recipeStep && recipeStep.final),
    gate: false,
    index: -1,
    done_when: '',
    stepLabel: '',
    /* True when the session HAS a recipe but we are not on its site, so the
       panel shows "Step 4" instead of "Step 4 of 15" about a recipe that is not
       running here. */
    offSite: hadRecipe && !onItsSite,
    /* Sent so the page can run its own independent gate check. Defence in
       depth: a safety rule should not have exactly one guard. */
    confirmed: session.confirmedStep === session.stepIndex
  };

  if (recipeStep && recipeStep.look_for) { payload.look_for = recipeStep.look_for; }

  payload.stepLabel = payload.total
    ? self.DAARI_T(S.ui.stepOf, lang, { n: payload.number, total: payload.total })
    : self.DAARI_T(S.ui.stepOnly, lang, { n: payload.number });

  /* The last step of a recipe points at nothing -- but it must FIRST be sure it
     is actually on the page where finishing happens.

     "Finished. Your PNR is on the screen" announced on the payment page, with a
     validation error showing, is the worst thing Daari can say: it is a claim of
     success to somebody who will not second-guess it. So the final step checks
     the page it is standing on, and if it is the wrong one, re-syncs to the first
     step that belongs to this page instead of announcing anything. */
  if (payload.final) {
    var whereWeAre = self.DAARI_PAGE_OF(page && page.url);
    var onTheRightPage = !recipeStep.page || whereWeAre === recipeStep.page;

    if (!onTheRightPage) {
      var resync = firstStepOnPage(recipe, whereWeAre, recipe.steps.length);
      if (resync !== -1) {
        console.warn('[Daari] final step reached on "' + whereWeAre +
                     '" instead of "' + recipeStep.page + '"; re-syncing to step ' + resync);
        session.stepIndex = resync;
        session.finished = false;
        session.confirmedStep = null;
        session.awaitingConfirm = null;
        /* Decide again from the corrected position. One retry only: the new step
           is never final, because a final step is only ever the last one. */
        return await decideStep(session, page);
      }
      /* This page is in no recipe step at all. Say so rather than claim success. */
      payload.final = false;
      payload.index = -1;
      payload.say = self.DAARI_T(S.ui.notSure, lang);
      payload.path = 'none';
      payload.why = 'final step reached on the wrong page (' + whereWeAre + ')';
      return payload;
    }

    payload.say = withPageIntro(
      stepSentence(recipe, recipeStep, session.stepIndex, lang, helpLevel),
      recipe, recipeStep, session, lang, helpLevel);
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
      gateApplies(elements[recipeIndex], recipeStep, null) &&
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
    var attempt = await callAi(session, page, recipeStep, lang, recipeIndex);

    /* One retry, and only for a failure that might not happen twice: a network
       blip, a 5xx, a timeout. Never for a 4xx, which means the request itself
       was wrong and sending it again would just spend the budget twice. */
    if (!attempt.ok && session.aiCallCount < MAX_AI_CALLS &&
        /^(timeout|http 5|TypeError|Error)/.test(attempt.reason)) {
      session.aiCallCount += 1;
      var second = await callAi(session, page, recipeStep, lang, recipeIndex);
      if (second.ok) { attempt = second; }
      else { attempt.reason = attempt.reason + ', then ' + second.reason; }
    }

    if (attempt.ok) { ai = attempt.answer; } else { reason = attempt.reason; }
  } else {
    reason = 'nothing on the page to choose from';
  }

  payload.modelWantedStop = !!(ai && ai.stopAndConfirm === true);

  /* ---- THE VALIDATION GATE ------------------------------------------------

     The model's answer is used only when it agrees with the recipe about WHICH
     element. Note what this compares: two indices, computed by the same
     matching code on the same list. Not two strings, fuzzily.

     goal_supported is checked FIRST and independently of confidence. The live
     evaluation found the model returning confidence 0.9 on 30 of 31 answers --
     a constant, not a judgement -- which left the threshold doing nothing at
     all. Asked in Hindi to apply for a passport, on the payment page, it
     confidently pointed at the Pay button. Making the model answer "can this
     goal be done here at all?" as its own separate field is what gives Daari a
     way to say "I am not sure" and mean it.

     With no recipe there is nothing to agree with, so the bar is higher: 0.7
     rather than 0.45. A recipe-backed answer has a second opinion behind it; an
     unaccompanied one has only itself. */
  var wrongPage = ai && ai.goal_supported === false;
  var needed = recipeStep ? MIN_CONFIDENCE : MIN_CONFIDENCE_ALONE;

  var usable = ai && !wrongPage &&
               ai.elementIndex !== null &&
               ai.confidence >= needed &&
               elements[ai.elementIndex];

  /* On a recipe-backed step the model was TOLD which element it is, so the only
     question is whether it agreed. hint_ok false means it thinks the recipe is
     pointing at the wrong thing -- we believe the recipe anyway, because the
     recipe is the safety net and the model is the thing being checked, but the
     disagreement is logged so a stale recipe shows up in the numbers. */
  var rejectedHint = recipeStep && recipeIndex !== -1 && ai && ai.hint_ok === false;

  if (usable && !rejectedHint && (!recipeStep || ai.elementIndex === recipeIndex)) {
    payload.index = ai.elementIndex;
    /* The model's phrasing, EXCEPT in full mode where a sentence has been
       pre-written for this step. The owner asked for the explanations to be
       pre-written per step so full mode costs nothing extra and says the same
       thing every time. The model still chose the element, and the validation
       gate above still had to agree with the recipe before we got here --
       only the words are ours. */
    payload.say = withPageIntro(
      (helpLevel === 'full' && recipeStep)
        ? stepSentence(recipe, recipeStep, session.stepIndex, lang, helpLevel)
        : ai.speech,
      recipe, recipeStep, session, lang, helpLevel);
    payload.done_when = ai.done_when || (recipeStep && recipeStep.done_when) || 'clicked';
    payload.path = 'ai';
    payload.confidence = ai.confidence;

  } else if (recipeStep && recipeIndex !== -1) {
    payload.index = recipeIndex;
    payload.say = withPageIntro(
      stepSentence(recipe, recipeStep, session.stepIndex, lang, helpLevel),
      recipe, recipeStep, session, lang, helpLevel);
    payload.done_when = recipeStep.done_when || 'clicked';
    payload.path = 'fallback';
    payload.why = ai
      ? (rejectedHint ? 'model rejected the recipe hint'
          : wrongPage ? 'model says the goal cannot be done here'
          : ai.elementIndex === null ? 'model found nothing'
          : ai.confidence < needed ? 'model unsure (' + ai.confidence + ' < ' + needed + ')'
          : 'model chose a different element')
      : reason;

  } else {
    /* Neither the model nor a recipe can say what to do. Say so. */
    payload.index = -1;
    payload.say = self.DAARI_T(S.ui.notSure, lang);
    payload.path = 'none';
    payload.why = wrongPage ? 'model says the goal cannot be done here'
                : reason ? reason
                : !ai ? 'no answer from the model'
                : ai.elementIndex === null ? 'model found nothing'
                : ai.confidence < needed
                    ? 'model unsure (' + ai.confidence + ' < ' + needed + ')'
                : 'no element matched';
  }

  /* ---- the confirm gate, part two ----------------------------------------

     For an element the model chose on its own, the gate is checked here, once
     we know what it picked. The model's stopAndConfirm is OR-ed in, so it can
     only ever ADD a stop -- never remove the one our own code decided on. */
  if (payload.index !== -1 &&
      gateApplies(elements[payload.index], recipeStep,
                  payload.path === 'ai' ? ai : null) &&
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

   Two independent halves.

   OUR CODE, always: an actionable control whose name trips the word list in
   safety.js, or a recipe step marked confirm. Actionable matters -- a link or
   tab called "Cancellations" navigates to a page about cancelling and does not
   cancel anything, so stopping the user from reading it is a false stop.

   THE MODEL, only when its answer was accepted. Its stopAndConfirm can ADD a
   stop to an element it chose itself, which is the "can only add, never remove"
   rule. But when the validation gate has DISCARDED its answer, its opinion goes
   with it: we are no longer pointing where it said, so its judgement is about a
   different element than the one on screen.

   That distinction is what fixed the 9 false stops out of 31 in the first live
   run, where the model asked to stop on "From station", "To station", "Class"
   and "PNR number". A stop that fires on every step is a stop nobody reads. */
function gateApplies(element, recipeStep, acceptedAi) {
  if (!element) { return false; }

  /* One call, three rules, all in safety.js: an actionable control with
     dangerous words, a link that cancels something booked, or a link naming
     money AND an amount. */
  if (self.DAARI_MUST_CONFIRM(element)) { return true; }
  if (recipeStep && recipeStep.confirm === true) { return true; }
  if (acceptedAi && acceptedAi.stopAndConfirm === true) { return true; }

  return false;
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
    /* Zero while off the recipe's site, so the panel says "Step 4" rather than
       "Step 4 of 15" about a recipe that is not running here. */
    payload.total = session.offSite ? 0 : (session.total || 0);
    payload.offSite = !!session.offSite;
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
    var recipes = await allRecipes();
    var task = null;

    if (message.flowId) {
      /* The panel asked for a specific recipe -- "Start demo on this page". It
         only gets it if this really is that recipe's site. */
      var asked = recipes[message.flowId];
      if (asked && self.DAARI_RECIPE_APPLIES(asked, message.url)) {
        task = message.flowId;
      } else {
        return {
          ok: false,
          wrongSite: true,
          reason: asked
            ? 'That recipe is for ' + (asked.hosts || []).join(', ') +
              ', and this page is ' + (self.DAARI_HOST_OF(message.url) || 'unknown') + '.'
            : 'No such recipe.'
        };
      }
    } else {
      task = await matchRecipe(message.goal, message.url);
    }

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

    /* Off its own site, a recipe's page names mean nothing, so none of the
       forward/back reasoning below can be trusted. Record it so the panel stops
       claiming "Step 3 of 15" on a site the recipe knows nothing about. */
    var recipeHere = recipe && self.DAARI_RECIPE_APPLIES(recipe, message.url);
    session.offSite = !!recipe && !recipeHere;
    if (!recipeHere) { recipe = null; }

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

        } else {
          /* Not behind us, and not the next step either -- so the user has
             jumped AHEAD, almost always with the browser's Forward button after
             going back. Pick it up from the first step on that page rather than
             sitting on a step whose element is nowhere to be found. */
          var forwardTo = nextStepOnPage(recipe, here, session.stepIndex);
          if (forwardTo !== -1) {
            session.stepIndex = forwardTo;
            session.confirmedStep = null;
            session.awaitingConfirm = null;
            session.finished = false;
            notice = 'wentForward';
          }
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

  /* The page saw the step finish, locally and for free.

     IT MUST SAY WHICH STEP. This used to advance unconditionally, and that let a
     stale completion move the flow: clicking Pay blurred the Card number box, the
     card step's settle rule fired and scheduled a completion, a confirm round trip
     started a new step, and the old timer then advanced AGAIN -- 13 to 14, which
     was the final step. Daari announced "Finished. Your PNR is on the screen" on
     the payment page, having watched a validation error appear.

     Claiming a success that did not happen is the worst thing Daari can do to
     somebody who will not second-guess it. So a completion now carries the step
     it is about, and one for a step we have already left is dropped. The page
     also cancels its own stale timers, but this is the half that does not depend
     on the page getting it right. */
  DAARI_STEP_DONE: async function (message) {
    var session = await getSession();
    if (!session) { return { active: false }; }

    if (typeof message.forStep === 'number' && message.forStep !== session.stepIndex) {
      console.warn('[Daari] ignoring a completion for step ' + message.forStep +
                   ' while on step ' + session.stepIndex);
      return await decideStep(session, message);
    }

    var recipe = await recipeFor(session);
    advance(session, recipe, message.url);

    var payload = await decideStep(session, message);
    if (payload.final) { session.finished = true; }
    await saveSession(session);
    return payload;
  },

  /* The site refused what was typed and the page did not move.

     A submit step completes only on reaching the next page, so a refusal leaves
     Daari standing on a submit step with nothing left to do. Rather than wait
     forever, it goes back to the step the complaint is about -- named by the
     recipe, because "one step back" is right for Pay and wrong for Search, where
     the rejection is about stations three steps earlier. */
  DAARI_STEP_REJECTED: async function (message) {
    var session = await getSession();
    if (!session) { return { active: false }; }

    var recipe = await recipeFor(session);
    var step = recipe ? recipe.steps[session.stepIndex] : null;

    /* Ignore a rejection for a step we have already left, for the same reason
       completions are checked. */
    if (typeof message.forStep === 'number' && message.forStep !== session.stepIndex) {
      return await decideStep(session, message);
    }

    var back = step && typeof step.on_reject === 'number'
      ? step.on_reject
      : Math.max(0, session.stepIndex - 1);

    session.stepIndex = back;
    session.confirmedStep = null;
    session.awaitingConfirm = null;
    session.finished = false;

    var payload = await decideStep(session, message);
    payload.notice = self.DAARI_T(self.DAARI_STRINGS.ui.notAccepted, await currentLang());
    payload.rejected = true;
    await saveSession(session);
    return payload;
  },

  /* "Go back a step". Exactly one step, and never past the beginning.

     Automatic detection is good but not perfect, and a user who cannot go back is
     a user who has to start the whole booking again. Going back also clears any
     confirmation they had given, because that answer was about the step they are
     leaving. */
  DAARI_STEP_BACK: async function (message) {
    var session = await getSession();
    if (!session) { return { active: false }; }

    if (session.stepIndex > 0) { session.stepIndex -= 1; }
    session.confirmedStep = null;
    session.awaitingConfirm = null;
    session.finished = false;
    if (session.history.length) { session.history.pop(); }

    var payload = await decideStep(session, message);
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
      total: session.offSite ? 0 : (session.total || 0),
      offSite: !!session.offSite,
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
