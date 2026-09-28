/* Daari overlay -- the part that runs inside the page being guided.
   Eyes and paintbrush only. Three jobs, in the words of the core loop:

     PERCEIVE  serializePage()  - list what is on the page, labels only
     POINT     highlight(i)     - draw the ring, show the caption
     VERIFY    watchForDone()   - notice the step finished, without any AI

   Two things this file must never do:
     1. Click, type or submit anything. It only listens and draws.
     2. Read out a USER-ENTERED value to anyone. Those never leave this file.
        We report "filled: true" and nothing more. The one exception is a
        button written as <input type="submit">, whose value attribute is the
        author's own label and can never hold typed input -- see
        accessibleName() and rule 2 in CLAUDE.md.

   This script is destroyed and re-created on every page load, so it must
   never be where session state lives. The brain arrives in Phase 4.
*/

(function () {
  'use strict';

  /* A page could get this script twice (an extension reload while the tab is
     open). Without this guard we would end up with two rings. */
  if (window.__daariOverlayLoaded) { return; }
  window.__daariOverlayLoaded = true;

  var HOST_ID = 'daari-overlay-root';
  var MAX_ELEMENTS = 60;

  /* What counts as something a user can act on. */
  var SELECTOR = [
    'a[href]', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="tab"]',
    '[role="checkbox"]', '[role="radio"]'
  ].join(', ');

  var host = null;       /* the element we put in the page */
  var shadow = null;     /* its shadow root -- the page cannot style inside */
  var ring = null;
  var caption = null;
  var captionStep = null;
  var captionSay = null;

  var currentEl = null;  /* the element the ring is following right now */
  var rafId = null;
  var lastList = [];     /* [{ el: Element, data: {...} }] -- index is the "i" */

  /* =================================================================
     PERCEIVE
     ================================================================= */

  /* Is this element, or anything above it, hidden from assistive tools? */
  function ariaHidden(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') {
        return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  /* Visible text, skipping anything marked aria-hidden.

     This matters more than it looks. The info button on the practice site
     contains only a symbol wrapped in an aria-hidden span, so a naive
     textContent would name that button after a glyph nobody can pronounce.
     Skipping aria-hidden subtrees makes it fall through to its aria-label. */
  function visibleText(el) {
    var out = '';
    var kids = el.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      if (node.nodeType === 3) {
        out += node.nodeValue;
      } else if (node.nodeType === 1 && !ariaHidden(node)) {
        out += visibleText(node);
      }
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  /* The accessible name: the words a person would use for this thing.

     Tried in the order real browsers use, stopping at the first that gives
     us something. A user-entered value is never consulted -- see the one
     narrow exception for button-shaped inputs below. */

  /* The four input types that are buttons rather than boxes. For these, and
     only these, the value attribute is the author's own label -- the words
     printed on the button -- and the field cannot be typed into at all, so
     reading it can never expose anything the user entered. */
  var BUTTON_INPUT_TYPES = ['submit', 'button', 'reset', 'image'];

  function isButtonInput(el) {
    return el.tagName.toLowerCase() === 'input' &&
           BUTTON_INPUT_TYPES.indexOf((el.type || '').toLowerCase()) !== -1;
  }

  function accessibleName(el) {
    var name = (el.getAttribute('aria-label') || '').trim();
    if (name) { return name; }

    /* aria-labelledby: the label lives in another element, named by id.
       Extremely common on real portals. */
    var ids = (el.getAttribute('aria-labelledby') || '').trim();
    if (ids) {
      var parts = [];
      ids.split(/\s+/).forEach(function (id) {
        var ref = document.getElementById(id);
        if (ref) { parts.push(visibleText(ref)); }
      });
      name = parts.join(' ').trim();
      if (name) { return name; }
    }

    /* A button written as an input. Without this, <input type="submit"
       value="Submit"> comes back nameless, and Daari cannot describe the one
       button that matters on a lot of older government forms. The alt text
       comes first for type="image", which is how such buttons are labelled. */
    if (isButtonInput(el)) {
      name = (el.getAttribute('alt') || '').trim();
      if (name) { return name; }
      name = (el.getAttribute('value') || '').trim();
      if (name) { return name; }
    }

    /* A real <label>. Browsers give form controls an .labels list, which
       handles both <label for="x"> and a label wrapped around the field. */
    if (el.labels && el.labels.length) {
      for (var i = 0; i < el.labels.length; i++) {
        name = visibleText(el.labels[i]);
        if (name) { return name; }
      }
    }
    var wrapping = el.closest ? el.closest('label') : null;
    if (wrapping) {
      name = visibleText(wrapping);
      if (name) { return name; }
    }

    name = (el.getAttribute('placeholder') || '').trim();
    if (name) { return name; }

    name = visibleText(el);
    if (name) { return name; }

    name = (el.getAttribute('title') || '').trim();
    if (name) { return name; }

    /* Genuinely nameless. Say so honestly rather than inventing something --
       a later phase must be able to tell that this element is unusable. */
    return '';
  }

  /* Can the user actually see and use this? */
  function isUsable(el) {
    if (el.id === HOST_ID) { return false; }
    if (el.closest && el.closest('#' + HOST_ID)) { return false; }

    /* Disabled controls are left out entirely, so Daari can never point at
       something the user is unable to press. */
    if (el.disabled) { return false; }
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') { return false; }

    if (el.type === 'hidden') { return false; }
    if (ariaHidden(el)) { return false; }

    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) { return false; }

    var style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') { return false; }
    if (style.display === 'none') { return false; }
    if (Number(style.opacity) < 0.05) { return false; }

    return true;
  }

  function inViewport(rect) {
    return rect.bottom > 0 &&
           rect.right > 0 &&
           rect.top < (window.innerHeight || 0) &&
           rect.left < (window.innerWidth || 0);
  }

  /* Has this field got something in it? A boolean, and only ever a boolean. */
  function isFilled(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      if (el.type === 'checkbox' || el.type === 'radio') { return el.checked === true; }
      /* A button is not a box, so it is never "filled". Its value attribute
         is a label, and saying filled:true here would be nonsense. */
      if (isButtonInput(el)) { return false; }
      return String(el.value || '').length > 0;
    }
    if (tag === 'textarea') { return String(el.value || '').length > 0; }
    if (tag === 'select') { return String(el.value || '').length > 0; }
    return false;
  }

  /* A short kind for the element: the input type, or its ARIA role. */
  function kindOf(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'button') { return (el.type || '').toLowerCase(); }
    var role = el.getAttribute('role');
    return role ? role.toLowerCase() : '';
  }

  /* Build the list Daari works from.

     The 60-element cap is applied by priority, not document order: what the
     user can currently see comes first. The element that matters must never
     be the one the cap throws away. */
  function serializePage() {
    var found = document.querySelectorAll(SELECTOR);
    var inView = [];
    var offView = [];

    for (var i = 0; i < found.length; i++) {
      var el = found[i];
      if (!isUsable(el)) { continue; }
      var bucket = inViewport(el.getBoundingClientRect()) ? inView : offView;
      bucket.push(el);
    }

    /* Document order is preserved inside each group, so the reading order of
       a form still makes sense. */
    var ordered = inView.concat(offView).slice(0, MAX_ELEMENTS);

    lastList = ordered.map(function (el, index) {
      return {
        el: el,
        data: {
          i: index,
          tag: el.tagName.toLowerCase(),
          type: kindOf(el),
          name: accessibleName(el),
          filled: isFilled(el)
        }
      };
    });

    return lastList.map(function (entry) { return entry.data; });
  }

  /* =================================================================
     POINT
     ================================================================= */

  /* Build our island in the page: one host element with a shadow root, so
     the website's CSS cannot reach our ring and ours cannot leak out. */
  function ensureOverlay() {
    if (host && document.documentElement.contains(host)) { return; }

    host = document.createElement('div');
    host.id = HOST_ID;
    /* Set directly rather than in the stylesheet, because these few rules
       must hold even before the stylesheet has arrived. */
    host.style.cssText = 'all: initial; position: fixed; inset: 0; ' +
                         'pointer-events: none; z-index: 2147483647;';
    shadow = host.attachShadow({ mode: 'open' });

    var layer = document.createElement('div');
    layer.className = 'layer';

    ring = document.createElement('div');
    ring.className = 'ring';

    caption = document.createElement('div');
    caption.className = 'caption';
    captionStep = document.createElement('div');
    captionStep.className = 'step';
    captionSay = document.createElement('div');
    captionSay.className = 'say';
    caption.appendChild(captionStep);
    caption.appendChild(captionSay);

    layer.appendChild(ring);
    layer.appendChild(caption);
    shadow.appendChild(layer);
    document.documentElement.appendChild(host);

    loadStyles();
  }

  /* Pull overlay.css in and apply it inside the shadow root.

     fetch + adoptedStyleSheets is used instead of a <link> because a site
     with a strict Content-Security-Policy can refuse an extension stylesheet
     link, while a constructable stylesheet is not subject to page CSP. */
  function loadStyles() {
    var url = chrome.runtime.getURL('content/overlay.css');
    fetch(url).then(function (response) {
      return response.text();
    }).then(function (css) {
      try {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
      } catch (e) {
        /* Very old Chrome: fall back to a plain style element. */
        var style = document.createElement('style');
        style.textContent = css;
        shadow.appendChild(style);
      }
    }).catch(function () {
      /* Without the stylesheet the ring would be invisible, which would look
         like Daari is broken. Say so in the console rather than failing mute. */
      console.warn('[Daari] could not load overlay.css -- the ring will not be visible');
    });
  }

  /* Keep the ring glued to the element, every frame.

     Re-reading the rectangle each frame is what makes the ring survive
     scrolling, window resizing, and the page moving things around by itself. */
  function syncRing() {
    rafId = window.requestAnimationFrame(syncRing);
    if (!currentEl || !ring) { return; }

    /* The element can vanish underneath us -- a dropdown closing, a row being
       replaced. Hide the ring rather than pointing at nothing. */
    if (!document.documentElement.contains(currentEl)) {
      ring.style.display = 'none';
      return;
    }

    var rect = currentEl.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      ring.style.display = 'none';
      return;
    }

    var pad = 6;
    ring.style.display = 'block';
    ring.style.left = (rect.left - pad) + 'px';
    ring.style.top = (rect.top - pad) + 'px';
    ring.style.width = (rect.width + pad * 2) + 'px';
    ring.style.height = (rect.height + pad * 2) + 'px';
  }

  /* Draw the ring around element number i from the last serialized list. */
  function highlight(i) {
    var entry = lastList[i];
    if (!entry) { return false; }

    ensureOverlay();
    currentEl = entry.el;

    /* Bring it into view first -- pointing at something off screen is no
       help at all. */
    if (currentEl.scrollIntoView) {
      currentEl.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }

    if (rafId === null) { syncRing(); }
    return true;
  }

  /* Show the instruction as large text. textContent, never innerHTML: the
     words can come from a web page or later from a model, and neither gets
     to put markup on the screen. */
  function showCaption(text, stepLabel, kind) {
    ensureOverlay();
    caption.className = 'caption' + (kind ? ' ' + kind : '');
    captionStep.textContent = stepLabel || '';
    captionStep.style.display = stepLabel ? 'block' : 'none';
    captionSay.textContent = text || '';
    caption.style.display = text ? 'block' : 'none';
  }

  function hideRing() {
    currentEl = null;
    if (ring) { ring.style.display = 'none'; }
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function clearAll() {
    hideRing();
    if (caption) { caption.style.display = 'none'; }
  }

  /* =================================================================
     VERIFY  -- local, free, no AI involved
     ================================================================= */

  /* ---- matching a step's words to an element on this page ---------------

     Steps target elements BY NAME, never by index. An index is a property of
     one particular page at one particular moment; "Send OTP" is a property of
     the thing itself. */

  function normalizeName(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[*:]/g, ' ')          /* "Age *" and "Age:" both become "age" */
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeForRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* How well does this element's name match what we are looking for?

     Plain substring matching is not enough, and the practice site proves it:
     looking for "age" on the passenger page, an indexOf would match "Tourism
     Packages" up in the menu long before reaching the Age box. So an exact
     match wins, then a match at the start, then a whole word, and only then a
     substring. */
  function nameScore(name, want) {
    var have = normalizeName(name);
    var need = normalizeName(want);
    if (!have || !need) { return 0; }
    if (have === need) { return 100; }
    if (have.indexOf(need) === 0) { return 80; }
    if (new RegExp('(^|\\s)' + escapeForRegExp(need) + '($|\\s)').test(have)) { return 60; }
    if (have.indexOf(need) !== -1) { return 30; }
    return 0;
  }

  /* Which element is this step talking about? -1 when nothing matches, and
     Daari then says it is not sure rather than pointing at a guess.

     Labels are tried in priority order: if the first one matches anything at
     all, later ones are not consulted. Within a label the best score wins,
     and ties go to whatever comes first -- which, after serializePage, means
     whatever is on screen. */
  function resolveByName(list, labels) {
    for (var l = 0; l < labels.length; l++) {
      var bestIndex = -1;
      var bestScore = 0;
      for (var i = 0; i < list.length; i++) {
        var score = nameScore(list[i].name, labels[l]);
        if (score > bestScore) { bestScore = score; bestIndex = i; }
      }
      if (bestIndex !== -1) { return bestIndex; }
    }
    return -1;
  }

  /* Text the user can actually see. innerText respects display:none, which
     textContent does not -- and that difference matters: the practice site's
     OTP message sits in the page from the start, just hidden. Matching on
     textContent would declare the step finished before the user pressed
     anything. */
  function visiblePageText() {
    return (document.body && (document.body.innerText || document.body.textContent)) || '';
  }

  /* Watch for a step being finished. Returns a function that stops watching.

     The whole vocabulary, evaluated here in the page, for free:

       clicked[:name]           the user clicked it, themselves
       field_filled[:name]      the box has something in it
       element_gone:name        it is no longer on the page
       text_appears:some words  those words became visible

     With no :name, the rule applies to the step's own element.

     url_changed is deliberately NOT handled here. A page that is navigating
     away is being destroyed, and a message sent from it may never arrive. The
     worker settles that rule instead, by comparing the URL a step started on
     against the URL of the next page that reports in. Nothing races.

     Note how "clicked" works: we LISTEN for the user's own click, in the
     capture phase, and never call preventDefault. Daari produces no clicks. */
  function watchForDone(rule, defaultIndex, onDone) {
    var raw = String(rule || '');
    var colon = raw.indexOf(':');
    var kind = colon === -1 ? raw : raw.slice(0, colon);
    var argument = colon === -1 ? '' : raw.slice(colon + 1);

    var finished = false;
    var observer = null;
    var recheckTimer = null;

    /* Which element does this rule watch? Its own, unless named otherwise. */
    var el = null;
    if (kind === 'clicked' || kind === 'field_filled') {
      var index = defaultIndex;
      if (argument) {
        index = resolveByName(lastList.map(function (e) { return e.data; }), [argument]);
      }
      el = lastList[index] ? lastList[index].el : null;
    }

    function finish() {
      if (finished) { return; }
      finished = true;
      stop();
      onDone();
    }

    function onClick(event) {
      if (!el) { return; }
      if (event.target === el || el.contains(event.target)) { finish(); }
    }

    function onInput() {
      if (el && isFilled(el)) { finish(); }
    }

    /* Both of the watch-the-whole-page rules go through here, debounced,
       because a busy page can fire hundreds of mutations a second and
       innerText is not cheap. */
    function recheck() {
      if (recheckTimer !== null) { return; }
      recheckTimer = window.setTimeout(function () {
        recheckTimer = null;
        if (finished) { return; }

        if (kind === 'text_appears') {
          if (visiblePageText().toLowerCase().indexOf(argument.toLowerCase()) !== -1) {
            finish();
          }
        } else if (kind === 'element_gone') {
          var list = serializePage();
          if (resolveByName(list, [argument]) === -1) { finish(); }
        }
      }, 200);
    }

    function stop() {
      document.removeEventListener('click', onClick, true);
      if (el) {
        el.removeEventListener('input', onInput);
        el.removeEventListener('change', onInput);
        el.removeEventListener('blur', onInput);
      }
      if (observer) { observer.disconnect(); observer = null; }
      if (recheckTimer !== null) { window.clearTimeout(recheckTimer); recheckTimer = null; }
    }

    if (kind === 'clicked') {
      document.addEventListener('click', onClick, true);

    } else if (kind === 'field_filled') {
      if (el && isFilled(el)) {
        /* Already done before we began watching. Deferred by a tick so the
           caller has finished wiring up before onDone fires. */
        window.setTimeout(finish, 0);
      } else if (el) {
        el.addEventListener('input', onInput);
        el.addEventListener('change', onInput);
        el.addEventListener('blur', onInput);
      }

    } else if (kind === 'text_appears' || kind === 'element_gone') {
      observer = new MutationObserver(recheck);
      observer.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['style', 'class', 'hidden']
      });
      recheck();   /* it may already be true */
    }

    return stop;
  }

  /* =================================================================
     THE STEP RUNNER

     Phase 2's hardcoded demo driver is gone. The page no longer decides
     anything about the flow: it asks the worker what to do, does that one
     thing, and reports back. All the deciding, and all the remembering,
     lives in background.js -- because this file is destroyed on every
     navigation, and a booking flow is nothing but navigations.
     ================================================================= */

  var stopWatching = null;      /* how to stop watching the current step */
  var retryObserver = null;     /* watching for a late-arriving element */
  var currentStepPayload = null;

  /* Say it and show it, in one call.

     The caption is drawn here in the page, right next to the ring where the
     user is already looking. The speaking happens in the side panel, because
     that is the one part of Daari that survives a page navigation -- this
     script does not. If the panel is closed there is nobody listening, and
     that is fine: the caption alone still carries the instruction. */
  function announce(text, stepLabel, kind, lang) {
    showCaption(text, stepLabel, kind);
    send({
      type: 'DAARI_SPEAK',
      text: text,
      stepLabel: stepLabel,
      lang: lang || (currentStepPayload && currentStepPayload.lang) || 'te'
    });
  }

  /* Fire-and-forget message. Nothing here should ever break because the panel
     happens to be closed or the worker happens to be asleep. */
  function send(message) {
    try {
      var sending = chrome.runtime.sendMessage(message);
      if (sending && sending.catch) { sending.catch(function () {}); }
    } catch (e) { /* nobody listening */ }
  }

  /* Ask the worker something and wait for the answer. */
  function ask(message) {
    return chrome.runtime.sendMessage(message).catch(function () { return null; });
  }

  function stopEverything() {
    if (stopWatching) { stopWatching(); stopWatching = null; }
    if (retryObserver) { retryObserver.disconnect(); retryObserver = null; }
    currentStepPayload = null;
    clearAll();
  }

  /* Do one step: find the thing, check it is safe to point at, point at it,
     then watch for the user to do it. */
  function runStep(payload) {
    if (stopWatching) { stopWatching(); stopWatching = null; }
    if (retryObserver) { retryObserver.disconnect(); retryObserver = null; }

    if (!payload || !payload.active) { return; }
    currentStepPayload = payload;

    var S = DAARI_STRINGS;
    var lang = payload.lang;

    /* The last step has nothing to point at. It announces, and the caption
       STAYS -- no auto-clear, because the PNR is the thing the user needs. */
    if (payload.final) {
      hideRing();
      announce('✅ ' + payload.say, DAARI_T(S.ui.finished, lang), 'done', lang);
      return;
    }

    var list = serializePage();
    var index = resolveByName(list, payload.look_for);

    if (index === -1) {
      /* The failure voice from CLAUDE.md, never a confident wrong pointer.
         The element may simply not have rendered yet, so keep watching for it
         rather than giving up on a slow page. */
      hideRing();
      announce(DAARI_T(S.ui.notSure, lang), payload.stepLabel, 'lost', lang);
      waitForElement(payload);
      return;
    }

    var name = list[index].name;

    /* THE CONFIRM GATE.

       Checked here, against the real accessible name of the element we are
       about to ring, every time -- not against a flag in the flow that
       somebody might forget to set. See safety.js. */
    if (DAARI_NEEDS_CONFIRM(name) && !payload.confirmed) {
      hideRing();
      announce(DAARI_T(S.ui.confirmBeforePay, lang),
               DAARI_T(S.ui.checkFirst, lang), 'lost', lang);
      send({ type: 'DAARI_NEEDS_CONFIRM' });
      return;   /* no ring until the user says they have looked */
    }

    highlight(index);
    announce(payload.say, payload.stepLabel, '', lang);

    stopWatching = watchForDone(payload.done_when, index, function () {
      ask({ type: 'DAARI_STEP_DONE', url: location.href }).then(function (next) {
        if (next && next.active) { runStep(next); }
      });
    });
  }

  /* The element we need is not here yet. Watch the page and try again when
     something changes. Cleared when the step changes or guidance stops. */
  function waitForElement(payload) {
    var pending = false;
    retryObserver = new MutationObserver(function () {
      if (pending) { return; }
      pending = true;
      window.setTimeout(function () {
        pending = false;
        if (currentStepPayload !== payload) { return; }
        var list = serializePage();
        if (resolveByName(list, payload.look_for) !== -1) {
          runStep(payload);
        }
      }, 250);
    });
    retryObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* =================================================================
     Starting up on every page load

     This is what makes a flow survive navigation: the page does not remember
     anything, it just asks. The worker knows whether there is a session, and
     works out whether the navigation itself completed the last step.
     ================================================================= */

  function reportIn() {
    ask({ type: 'DAARI_PAGE_READY', url: location.href }).then(function (payload) {
      if (payload && payload.active) { runStep(payload); }
    });
  }

  reportIn();

  /* Single-page sites change the URL without reloading, so no new content
     script is created. Route those through exactly the same path, so there is
     only one way a step can advance on a URL change. */
  window.addEventListener('popstate', reportIn);
  window.addEventListener('hashchange', reportIn);

  /* =================================================================
     Messages in
     ================================================================= */

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || !message.type) { return; }

    /* The worker telling us what to do -- at the start of a flow, and again
       after the user has confirmed a dangerous step. */
    if (message.type === 'DAARI_RUN_STEP') {
      runStep(message.step);
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'DAARI_CLEAR') {
      stopEverything();
      sendResponse({ ok: true });
      return;
    }

    if (message.type === 'DAARI_DEBUG_SERIALIZE') {
      var list = serializePage();

      console.log('%c[Daari] what Daari sees on this page', 'font-weight:bold;color:#c25a00');
      console.log('Labels only. No input value is ever read out -- a field you have typed' +
                  ' into shows as filled: true and nothing more.');
      console.table(list);

      /* Prove the shape, rather than asking anyone to take it on trust:
         list every key present across the whole payload. */
      var keys = {};
      list.forEach(function (row) {
        Object.keys(row).forEach(function (k) { keys[k] = true; });
      });
      var keyNames = Object.keys(keys).sort();
      console.log('Keys present in the payload:', keyNames.join(', '));

      sendResponse({
        ok: true,
        count: list.length,
        filledCount: list.filter(function (r) { return r.filled; }).length,
        namelessCount: list.filter(function (r) { return r.name === ''; }).length,
        keys: keyNames
      });
      return;
    }
  });

  /* Handy while developing: window.daari.serializePage() in the page console. */
  window.daari = {
    serializePage: serializePage,
    resolveByName: resolveByName,
    highlight: highlight,
    showCaption: showCaption,
    clearAll: clearAll
  };
}());
