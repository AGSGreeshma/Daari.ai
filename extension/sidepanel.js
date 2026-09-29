/* Daari side panel -- ears and mouth.

   Why the panel and not a popup: a popup closes the instant the user clicks
   anywhere on the page, and clicking the page is the whole point of Daari.
   The panel stays open while they work, and it survives page navigation, so
   speech carries on across a booking flow.

   Why the panel and not an offscreen document: an offscreen document has no
   UI, and this phase needs a visible surface anyway -- the language picker,
   the microphone, the live transcript, Repeat and Stop. The panel sits at the
   chrome-extension:// origin, so it earns the same one-time microphone grant
   an offscreen document would have.

   No AI here. This file only listens, speaks, and shows. */

(function () {
  'use strict';

  var T = DAARI_T;
  var S = DAARI_STRINGS;

  /* Telugu is the default, because Daari is for Telugu speakers first.
     Defaulting to English would quietly re-centre the product on English. */
  var lang = 'te';

  var recognition = null;
  var voices = [];
  var lastSpoken = null;   /* { text, lang } -- what Repeat says again */
  var audioCtx = null;

  var el = {
    langs: document.getElementById('langs'),
    mic: document.getElementById('mic'),
    transcript: document.getElementById('transcript'),
    placeholder: document.getElementById('placeholder'),
    goal: document.getElementById('goal'),
    typedGoal: document.getElementById('typedGoal'),
    useTyped: document.getElementById('useTyped'),
    message: document.getElementById('message'),
    instruction: document.getElementById('instruction'),
    counter: document.getElementById('counter'),
    confirm: document.getElementById('confirm'),
    repeat: document.getElementById('repeat'),
    stopSpeak: document.getElementById('stopSpeak'),
    startDemo: document.getElementById('startDemo'),
    stopGuidance: document.getElementById('stopGuidance'),
    voiceStatus: document.getElementById('voiceStatus'),
    devBody: document.getElementById('devBody'),
    micHint: document.getElementById('micHint'),
    micCancel: document.getElementById('micCancel'),
    confirmBox: document.getElementById('confirmBox'),
    confirmHeading: document.getElementById('confirmHeading'),
    confirmText: document.getElementById('confirmText'),
    confirmSend: document.getElementById('confirmSend'),
    confirmAgain: document.getElementById('confirmAgain'),
    manualDone: document.getElementById('manualDone'),
    manualBack: document.getElementById('manualBack')
  };

  /* The recipe "Start demo" forces, for when you want the booking walk without
     speaking a goal. A spoken goal picks its own recipe by match_phrases. */
  var DEMO_FLOW_ID = 'book-ticket';

  /* =================================================================
     Messages to the user
     ================================================================= */

  function showMessage(kind, text, buttonLabel, onButton) {
    el.message.className = 'msg ' + kind;
    el.message.textContent = text;
    if (buttonLabel) {
      var button = document.createElement('button');
      button.textContent = buttonLabel;
      button.addEventListener('click', onButton);
      el.message.appendChild(button);
    }
  }

  function clearMessage() {
    el.message.className = 'msg';
    el.message.textContent = '';
  }

  /* Send something to the overlay in the current tab. */
  async function tellPage(message) {
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) { await chrome.tabs.sendMessage(tabs[0].id, message); }
    } catch (e) {
      showMessage('bad',
        'That page is not listening. Reload it (F5) and try again.');
    }
  }

  function openPermissionPage() {
    chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  }

  /* =================================================================
     Language
     ================================================================= */

  function buildLanguageButtons() {
    S.langs.forEach(function (entry) {
      var button = document.createElement('button');
      button.className = 'lang';
      button.textContent = entry.label;
      button.dataset.code = entry.code;
      button.setAttribute('lang', entry.code);
      button.addEventListener('click', function () { setLanguage(entry.code); });
      el.langs.appendChild(button);
    });
  }

  function speechCodeFor(code) {
    for (var i = 0; i < S.langs.length; i++) {
      if (S.langs[i].code === code) { return S.langs[i].speech; }
    }
    return 'en-IN';
  }

  function setLanguage(code) {
    lang = code;
    chrome.storage.local.set({ lang: code });

    /* If the user switches language mid-sentence, the old recogniser is
       listening for the wrong language. Stop it. */
    if (micState === 'listening') { cancelListening(); }

    applyLanguage();
    describeVoices();
  }

  /* Put every visible word into the chosen language. */
  function applyLanguage() {
    var buttons = el.langs.querySelectorAll('.lang');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].className = 'lang' + (buttons[i].dataset.code === lang ? ' on' : '');
    }

    el.mic.textContent = T(micState === 'listening' ? S.ui.micSend : S.ui.micIdle, lang);
    el.micCancel.textContent = T(S.ui.micCancel, lang);
    el.confirmHeading.textContent = T(S.ui.confirmHeading, lang);
    el.confirmSend.textContent = T(S.ui.confirmSend, lang);
    el.confirmAgain.textContent = T(S.ui.confirmAgain, lang);
    el.manualDone.textContent = T(S.ui.manualDone, lang);
    el.manualBack.textContent = T(S.ui.goBackStep, lang);
    el.mic.setAttribute('lang', lang);

    if (el.placeholder) {
      el.placeholder.textContent = T(S.ui.transcriptPlaceholder, lang);
    }
    el.typedGoal.placeholder = T(S.ui.typeInstead, lang);
    el.typedGoal.setAttribute('lang', lang);
    el.useTyped.textContent = T(S.ui.use, lang);
    el.repeat.textContent = '\u{1F501} ' + T(S.ui.repeat, lang);
    el.stopSpeak.textContent = '⏸ ' + T(S.ui.stopSpeaking, lang);
    el.startDemo.textContent = T(S.ui.startDemo, lang);
    el.confirm.textContent = T(S.ui.iHaveChecked, lang);
    el.stopGuidance.textContent = T(S.ui.stopGuidance, lang);
    document.documentElement.setAttribute('lang', lang);
  }

  /* =================================================================
     Where are we? -- driven entirely by the worker

     The panel keeps no idea of its own about the flow. The worker owns the
     session and broadcasts after every change, so a panel opened halfway
     through a booking shows the right step immediately.
     ================================================================= */

  function applyStatus(status) {
    if (!status || !status.active) {
      el.counter.textContent = '';
      el.confirm.style.display = 'none';
      el.stopGuidance.style.display = 'none';
      el.manualDone.style.display = 'none';
      el.manualBack.style.display = 'none';
      el.devBody.textContent = 'Nothing running.';
      return;
    }

    /* With no recipe there is no known total, and Daari does not invent one.
       That includes being off a recipe's own site: the worker sends total 0 there,
       so the panel stops claiming "Step 3 of 15" about a recipe that is not
       running on this page. That exact claim appeared on irctc.co.in. */
    el.counter.textContent = status.total
      ? T(S.ui.stepOf, lang, { n: status.number, total: status.total })
      : T(S.ui.stepOnly, lang, { n: status.number });

    el.stopGuidance.style.display = 'block';
    el.confirm.style.display = status.awaitingConfirm ? 'block' : 'none';
    /* Hidden while a confirm gate is up: the only thing to press there is "I have
       checked", and offering "Done - next step" beside it would let somebody skip
       the very stop that exists to slow them down. */
    var guiding = !status.awaitingConfirm && !status.finished;
    el.manualDone.style.display = guiding ? 'block' : 'none';
    el.manualBack.style.display = guiding ? 'block' : 'none';

    showDeveloperDetails(status);
  }

  /* Which route each step took: "ai" means the model wrote the sentence and
     picked the element; "fallback" means its answer was rejected and the
     recipe's own element and pre-written phrase were used instead. */
  function showDeveloperDetails(status) {
    var lines = [];
    lines.push('recipe: ' + (status.flowId || 'none (model only)'));
    lines.push('AI calls: ' + status.aiCallCount + ' / ' + status.maxAiCalls);
    lines.push('last path: ' + (status.lastPath || '-'));
    lines.push('Telugu audio cached: ' + DAARI_TTS.cached() + ' phrase(s)');
    if (DAARI_TTS.lastError()) { lines.push('TTS error: ' + DAARI_TTS.lastError()); }
    lines.push('');

    el.devBody.textContent = lines.join('\n');

    (status.pathLog || []).forEach(function (entry) {
      var row = document.createElement('div');
      var tag = document.createElement('span');
      tag.className = 'path-' + entry.path;
      tag.textContent = entry.path;
      row.appendChild(document.createTextNode('step ' + entry.step + ': '));
      row.appendChild(tag);
      if (entry.why) { row.appendChild(document.createTextNode('  (' + entry.why + ')')); }
      el.devBody.appendChild(row);
    });
  }

  function refreshStatus() {
    chrome.runtime.sendMessage({ type: 'DAARI_GET_STATUS' })
      .then(applyStatus)
      .catch(function () { /* worker still waking up */ });
  }

  /* =================================================================
     MOUTH -- speaking
     ================================================================= */

  function refreshVoices() {
    voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  }

  /* Find the best installed voice for a language.

     For English and Hindi we prefer an Indian voice, so Daari does not read
     Indian station names in an American accent. */
  function pickVoice(code) {
    if (!voices.length) { return null; }

    var wanted = { te: 'te', hi: 'hi', en: 'en' }[code] || 'en';
    var matches = voices.filter(function (voice) {
      return (voice.lang || '').toLowerCase().indexOf(wanted) === 0;
    });
    if (!matches.length) { return null; }

    var indian = matches.filter(function (voice) {
      return (voice.lang || '').toLowerCase().indexOf('-in') !== -1;
    });
    return indian.length ? indian[0] : matches[0];
  }

  /* A soft chime, for when there is no voice in the user's language.

     Silence would read as "Daari is broken". A wrong-language voice would be
     worse -- CLAUDE.md forbids a Hindi voice reading Telugu, because it
     mispronounces badly enough to be worse than saying nothing. So: a short
     tone that means "a new instruction has appeared, read it". */
  function chime() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') { audioCtx.resume(); }

      var now = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.linearRampToValueAtTime(1180, now + 0.09);

      /* Ramp the volume rather than switching it on, or it clicks. Quiet on
         purpose: this repeats on every step. */
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.13, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.32);
    } catch (e) {
      /* No audio available. The caption still carries the instruction. */
    }
  }

  /* Say something out loud.

     Three routes, in order of preference:
       1. A voice Windows already has, in the right language.
       2. For Telugu with no local voice: a chime, then audio from our API.
       3. Nothing but the chime -- and the large caption does the work.

     Never a wrong-language voice. A Hindi voice reading Telugu mispronounces
     badly enough to be worse than saying nothing, and for the primary persona
     that would undermine the whole thing. */
  /* Speech is QUEUED, not interrupted.

     "After any step completes: a pause, a gentle Good, then the next
     instruction" only works if the next instruction waits its turn. Cancelling
     the previous utterance would clip the acknowledgement to "Goo-" and make the
     pacing worse than having none. Stop speaking still clears the queue, because
     that is the user asking for silence. */
  var speechQueue = [];
  var speaking = false;

  function drainQueue() {
    if (speaking || !speechQueue.length) { return; }
    var next = speechQueue.shift();
    speaking = true;
    sayNow(next.text, next.lang, function () {
      speaking = false;
      drainQueue();
    });
  }

  function speak(text, code) {
    if (!text) { return; }
    lastSpoken = { text: text, lang: code };
    speechQueue.push({ text: text, lang: code });
    /* Two queued is plenty -- an acknowledgement and an instruction. More than
       that means the user has got ahead of us and the old ones are stale. */
    while (speechQueue.length > 2) { speechQueue.shift(); }
    drainQueue();
  }

  function silence() {
    speechQueue = [];
    speaking = false;
    DAARI_TTS.stop();
    if (window.speechSynthesis) { window.speechSynthesis.cancel(); }
  }

  function sayNow(text, code, whenDone) {
    var voice = pickVoice(code);

    if (voice && window.speechSynthesis) {
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      /* Slowly. These users are not in a hurry and may be hearing the
         instruction for the first time. */
      utterance.rate = 0.8;
      utterance.pitch = 1;
      utterance.onend = whenDone;
      /* If the voice never reports back -- it happens -- do not wedge the queue. */
      utterance.onerror = whenDone;
      window.speechSynthesis.speak(utterance);
      return;
    }

    /* The chime stays, even now that Telugu can be spoken: it is the signal
       that a NEW step has arrived, and it reads as such before the sentence
       has even begun. */
    chime();

    /* Fetched Telugu speech is off by default -- it was not clear enough, and a
       bad voice is worse than silence for the primary persona. The chime above
       plus the large Telugu caption is the stated fallback in CLAUDE.md. */
    if (code === 'te' && DAARI_CONFIG.TELUGU_TTS) {
      /* Let the chime finish first, or the two overlap and neither is clear. */
      window.setTimeout(function () {
        DAARI_TTS.speak(text, code).then(function (spoke) {
          if (!spoke) { describeVoices(); }   /* say why, honestly */
          whenDone();
        });
      }, 380);
      return;
    }

    /* Captions only: nothing to wait for, so release the queue after a beat long
       enough to read a short line. */
    window.setTimeout(whenDone, 900);
  }

  /* Tell the user honestly what Windows can and cannot say. */
  function describeVoices() {
    refreshVoices();
    var parts = [];
    S.langs.forEach(function (entry) {
      var voice = pickVoice(entry.code);
      parts.push('<b>' + entry.english + ':</b> ' +
        (voice ? voice.name : 'no voice installed, captions and a chime only'));
    });
    var note;
    if (pickVoice('te')) {
      note = 'Telugu has a local voice, so nothing needs fetching.';
    } else if (DAARI_CONFIG.TELUGU_TTS) {
      note = 'No local Telugu voice, so Telugu is fetched as audio: a chime, then the ' +
        'sentence. ' + DAARI_TTS.cached() + ' phrase(s) cached' +
        (DAARI_TTS.lastError() ? '. Last attempt failed: ' + DAARI_TTS.lastError() +
          ' - the large caption is carrying it instead.' : '.');
    } else {
      note = '<b>Telugu is read, not spoken.</b> Fetched Telugu speech was turned off ' +
        'because it was not clear enough, and a wrong-sounding voice is worse than ' +
        'silence. A Telugu step plays a short chime and shows large Telugu text. ' +
        'Set TELUGU_TTS to true in config.js to try it again.';
    }

    el.voiceStatus.innerHTML = parts.join('<br>') + '<br><br>' + note;
  }

  /* =================================================================
     EARS -- listening

     TAP TO SPEAK, TAP TO SEND.

     The old mic used continuous:false, so Chrome ended the session at the first
     pause and real testing said it "stops listening before I finish my
     sentence". Someone thinking about which station they want pauses constantly.

     So now: continuous recognition, and when Chrome ends the session anyway --
     which it still does, on a network hiccup or a long silence -- we start it
     again silently and keep everything heard so far. Nothing is sent until the
     user taps send, and even then they get a chance to fix a misheard word by
     typing over it.

     Three states, and the button always says what tapping it will DO:
       idle       "Speak your goal"
       listening  "Tap to send"   (+ a quiet Cancel)
       confirming the editable box, "Is this right?"
     ================================================================= */

  var SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

  /* Stop after this long with nothing heard at all, keeping what we have. A
     safety net so a forgotten open mic does not listen indefinitely. */
  var TOTAL_SILENCE_MS = 30000;

  var micState = 'idle';          /* idle | listening | confirming */
  var heard = '';                 /* everything finalised so far, across restarts */
  var silenceTimer = null;
  var restarts = 0;

  function setMicState(state) {
    micState = state;
    el.mic.className = 'mic' + (state === 'listening' ? ' sending' : '');
    el.micCancel.style.display = state === 'listening' ? 'block' : 'none';
    el.confirmBox.style.display = state === 'confirming' ? 'block' : 'none';
    el.micHint.textContent = state === 'listening' ? T(S.ui.micListeningHint, lang) : '';
    el.mic.disabled = state === 'confirming';
    applyLanguage();
  }

  function setTranscript(text, isFinal) {
    el.transcript.className = 'transcript ' + (isFinal ? 'final' : 'interim');
    el.transcript.textContent = text;
    el.transcript.setAttribute('lang', lang);
  }

  function armSilenceTimer() {
    if (silenceTimer !== null) { window.clearTimeout(silenceTimer); }
    silenceTimer = window.setTimeout(function () {
      silenceTimer = null;
      if (micState !== 'listening') { return; }
      /* Keep whatever was heard -- throwing it away would be the rudest possible
         end to a long sentence. */
      if (heard.trim()) {
        finishListening();
      } else {
        cancelListening();
        showMessage('info', T(S.ui.micSilence, lang));
      }
    }, TOTAL_SILENCE_MS);
  }

  function stopRecogniser() {
    if (!recognition) { return; }
    /* Detach first, or onend will helpfully restart the thing we are stopping. */
    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;
    try { recognition.stop(); } catch (e) { /* already stopping */ }
    recognition = null;
  }

  function startRecogniser() {
    if (!SpeechRecognitionClass) { return false; }

    try {
      recognition = new SpeechRecognitionClass();
    } catch (e) {
      showMessage('bad', 'Could not start listening: ' + e.message + '. Please type instead.');
      return false;
    }

    recognition.lang = speechCodeFor(lang);
    recognition.interimResults = true;
    recognition.continuous = true;      /* do NOT stop at a pause */
    recognition.maxAlternatives = 1;

    recognition.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) { heard += result[0].transcript; }
        else { interim += result[0].transcript; }
      }
      /* Anything at all counts as not-silence. */
      armSilenceTimer();
      setTranscript((heard + ' ' + interim).trim() || '...', false);
    };

    recognition.onerror = function (event) {
      var code = event.error;

      if (code === 'not-allowed' || code === 'service-not-allowed') {
        cancelListening();
        showMessage('bad',
          'Chrome has not given Daari permission to use the microphone.\n\n' +
          'This takes one click and you only do it once.',
          'Allow microphone', openPermissionPage);
        return;
      }
      if (code === 'language-not-supported') {
        cancelListening();
        showMessage('bad',
          'Chrome cannot recognise ' + speechCodeFor(lang) + ' speech on this computer.\n\n' +
          'Please type your goal in the box instead. Tell Claude this happened -- it is ' +
          'worth knowing before the demo.');
        return;
      }
      if (code === 'network') {
        cancelListening();
        showMessage('bad',
          'Speech recognition needs the internet, and the connection failed. ' +
          'Check your connection, or type your goal instead.');
        return;
      }
      /* "no-speech" and "aborted" are NOT failures here. They are what a thinking
         pause looks like from Chrome's side, and onend will restart us. */
    };

    recognition.onend = function () {
      /* Chrome ended the session on its own. If the user has not tapped send or
         cancel, that was not their decision, so start again and say nothing. */
      if (micState !== 'listening') { return; }

      restarts += 1;
      if (restarts > 60) {
        /* Something is wrong at a level we cannot fix by trying harder. */
        finishListening();
        return;
      }
      window.setTimeout(function () {
        if (micState === 'listening') { startRecogniser(); }
      }, 150);
    };

    try {
      recognition.start();
      return true;
    } catch (e) {
      /* Already started is harmless; anything else is not worth a restart loop. */
      return true;
    }
  }

  function startListening() {
    if (!SpeechRecognitionClass) {
      showMessage('bad',
        'This copy of Chrome cannot listen. Type your goal in the box instead -- ' +
        'everything else works the same way.');
      return;
    }

    clearMessage();
    heard = '';
    restarts = 0;
    setMicState('listening');
    setTranscript('...', false);
    armSilenceTimer();

    if (!startRecogniser()) { setMicState('idle'); }
  }

  /* The user tapped send. Stop, and show what we heard for checking. */
  function finishListening() {
    if (silenceTimer !== null) { window.clearTimeout(silenceTimer); silenceTimer = null; }
    stopRecogniser();

    var text = heard.trim();
    if (!text) {
      setMicState('idle');
      showMessage('info', T(S.ui.micSilence, lang));
      return;
    }

    setMicState('confirming');
    setTranscript(text, true);
    el.confirmText.value = text;
    el.confirmText.setAttribute('lang', lang);
    el.confirmText.focus();
  }

  function cancelListening() {
    if (silenceTimer !== null) { window.clearTimeout(silenceTimer); silenceTimer = null; }
    stopRecogniser();
    heard = '';
    setMicState('idle');
    setTranscript('', false);
    if (el.placeholder) {
      el.transcript.textContent = '';
      el.transcript.appendChild(el.placeholder);
    }
  }

  /* =================================================================
     What to DO with a goal

     These two were deleted by accident in the Phase B mic rewrite: they lived
     inside the section that got replaced, and their callers were left behind.
     "Yes, go" and "Start demo on this page" both threw a ReferenceError and did
     nothing at all. node --check could not see it, because the file parsed
     perfectly -- which is the whole reason tests/lint.js and
     tests/smoke-panel.js now exist.
     ================================================================= */

  function acceptGoal(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) { return; }
    setTranscript(trimmed, true);
    el.goal.textContent = '';
    var cap = document.createElement('span');
    cap.className = 'cap';
    cap.textContent = T(S.ui.yourGoal, lang);
    var words = document.createElement('span');
    words.textContent = trimmed;
    el.goal.appendChild(cap);
    el.goal.appendChild(words);
    el.goal.style.display = 'block';
    el.goal.setAttribute('lang', lang);

    /* Saying what you want IS the instruction. One action for the user: speak,
       and the first ring appears. Stop guidance is right there if Daari
       mis-heard. */
    startFlow(trimmed, null);
  }

  async function startFlow(goal, forcedFlowId) {
    clearMessage();
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs[0];
      if (!tab) { throw new Error('No page is open.'); }

      var reply = await chrome.runtime.sendMessage({
        type: 'DAARI_START_FLOW',
        goal: goal,
        flowId: forcedFlowId || undefined,
        tabId: tab.id,
        /* The worker needs the address, not just the tab: a recipe only runs on
           its own site, and it checks that before anything else. */
        url: tab.url || ''
      });

      /* Asking for a specific recipe on the wrong site is refused outright, and
         no session is created. Say so plainly rather than starting something
         that would then claim "Step 3 of 15" about a page it does not know. */
      if (reply && reply.wrongSite) {
        showMessage('bad',
          'That demo only runs on the practice site.\n\n' +
          reply.reason + '\n\n' +
          'Open the practice site to run the demo, or just say what you want to do ' +
          'here and I will read this page myself.');
        return;
      }

      /* The session exists now, so ask the page to report in with what it can
         see. Everything after this is the worker's decision. */
      await chrome.tabs.sendMessage(tab.id, { type: 'DAARI_ASK_AGAIN' });
      refreshStatus();

      if (reply && reply.aiOnly) {
        showMessage('info',
          'I have no saved route for this site, so I will read the page myself. ' +
          'I will tell you if I am unsure rather than guessing.');
      }
    } catch (e) {
      showMessage('bad',
        'Could not start on that page.\n\n' +
        'If the page was already open when the extension was reloaded, reload the ' +
        'page (F5) and try again.\n\nDetails: ' + e.message);
    }
  }


  /* =================================================================
     Messages from the overlay inside the page
     ================================================================= */

  function showInstruction(text, stepLabel) {
    el.instruction.textContent = '';
    if (stepLabel) {
      var which = document.createElement('span');
      which.className = 'which';
      which.textContent = stepLabel;
      el.instruction.appendChild(which);
    }
    var words = document.createElement('span');
    words.textContent = text;
    el.instruction.appendChild(words);
    el.instruction.style.display = 'block';
    el.instruction.setAttribute('lang', lang);
  }

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || !message.type) { return; }

    if (message.type === 'DAARI_SPEAK') {
      showInstruction(message.text, message.stepLabel);
      speak(message.text, message.lang || lang);
      return;
    }

    if (message.type === 'DAARI_STATUS') {
      applyStatus(message);
    }
  });

  /* =================================================================
     Buttons
     ================================================================= */

  /* One button, two meanings, and it always says which one is live. */
  el.mic.addEventListener('click', function () {
    if (micState === 'listening') { finishListening(); } else { startListening(); }
  });

  el.micCancel.addEventListener('click', cancelListening);

  /* Send what is in the box -- typed corrections included.

     A named function rather than a handler, so Enter can call it directly. The
     obvious shortcut would be to invoke the button's own click method, and that
     is precisely the call the no-clicking grep hunts for. Keeping that check at
     ZERO everywhere is worth more than the one line it saves: a rule with no
     exceptions cannot be misapplied, and "zero" is checkable by anyone in one
     command. This comment is worded to avoid tripping it too. */
  function sendConfirmedGoal() {
    var text = el.confirmText.value.trim();
    setMicState('idle');
    if (text) { acceptGoal(text); }
  }

  el.confirmSend.addEventListener('click', sendConfirmedGoal);

  el.confirmAgain.addEventListener('click', function () {
    setMicState('idle');
    startListening();
  });

  /* Enter sends; Shift+Enter leaves room for a longer correction. */
  el.confirmText.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendConfirmedGoal();
    }
  });

  /* Manual advance, always available while guiding. */
  el.manualDone.addEventListener('click', function () {
    tellPage({ type: 'DAARI_MANUAL_DONE' });
  });

  el.manualBack.addEventListener('click', function () {
    tellPage({ type: 'DAARI_MANUAL_BACK' });
  });

  el.useTyped.addEventListener('click', function () {
    acceptGoal(el.typedGoal.value);
    el.typedGoal.value = '';
  });

  el.typedGoal.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      acceptGoal(el.typedGoal.value);
      el.typedGoal.value = '';
    }
  });

  el.repeat.addEventListener('click', function () {
    if (lastSpoken) { speak(lastSpoken.text, lastSpoken.lang); }
  });

  el.stopSpeak.addEventListener('click', silence);

  /* The manual way in, for when you want the booking walk without speaking.
     Forces the recipe rather than matching a goal. */
  el.startDemo.addEventListener('click', function () {
    startFlow(el.typedGoal.value.trim() || 'book a train ticket', DEMO_FLOW_ID);
  });

  /* The confirm gate. The user is telling Daari they have read the screen --
     only then will it point at the Pay button. */
  el.confirm.addEventListener('click', function () {
    el.confirm.style.display = 'none';
    chrome.runtime.sendMessage({ type: 'DAARI_CONFIRMED' })
      .catch(function () { refreshStatus(); });
  });

  el.stopGuidance.addEventListener('click', function () {
    chrome.runtime.sendMessage({ type: 'DAARI_STOP_FLOW' })
      .catch(function () {})
      .then(function () {
        el.instruction.style.display = 'none';
        if (window.speechSynthesis) { window.speechSynthesis.cancel(); }
        applyStatus(null);
      });
  });

  /* =================================================================
     Start up
     ================================================================= */

  buildLanguageButtons();

  /* Voices often arrive a moment after the page does, so describe them again
     when Chrome says the list has changed. */
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = describeVoices;
  }

  chrome.storage.local.get({ lang: 'te' }).then(function (saved) {
    lang = saved.lang;
    applyLanguage();
    describeVoices();
    /* A panel opened halfway through a booking should show the right step at
       once, so ask the worker rather than assuming nothing is happening. */
    refreshStatus();
  });

  /* If the microphone has not been granted yet, say so before the user
     discovers it by being refused. */
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'microphone' }).then(function (status) {
      if (status.state !== 'granted') {
        showMessage('info',
          'Daari needs permission to use your microphone. One click, once, and never again.',
          'Allow microphone', openPermissionPage);
      }
    }).catch(function () { /* Chrome would not tell us; the mic button will find out. */ });
  }
}());
