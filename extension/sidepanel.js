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
  var listening = false;
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
    devBody: document.getElementById('devBody')
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
    if (listening) { stopListening(); }

    applyLanguage();
    describeVoices();
  }

  /* Put every visible word into the chosen language. */
  function applyLanguage() {
    var buttons = el.langs.querySelectorAll('.lang');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].className = 'lang' + (buttons[i].dataset.code === lang ? ' on' : '');
    }

    el.mic.textContent = T(listening ? S.ui.micListening : S.ui.micIdle, lang);
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
  function speak(text, code) {
    if (!text) { return; }

    lastSpoken = { text: text, lang: code };
    DAARI_TTS.stop();
    if (window.speechSynthesis) { window.speechSynthesis.cancel(); }

    var voice = pickVoice(code);

    if (voice && window.speechSynthesis) {
      var utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      /* Slowly. These users are not in a hurry and may be hearing the
         instruction for the first time. */
      utterance.rate = 0.8;
      utterance.pitch = 1;
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
        });
      }, 380);
    }
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
     ================================================================= */

  var SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

  function setTranscript(text, isFinal) {
    el.transcript.className = 'transcript ' + (isFinal ? 'final' : 'interim');
    el.transcript.textContent = text;
    el.transcript.setAttribute('lang', lang);
  }

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

  /* Begin guiding. The worker matches the goal to a recipe, or decides there is
     none and lets the model work alone. */
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

  function stopListening() {
    if (recognition) {
      try { recognition.stop(); } catch (e) { /* already stopping */ }
    }
    listening = false;
    el.mic.className = 'mic';
    applyLanguage();
  }

  function startListening() {
    if (!SpeechRecognitionClass) {
      showMessage('bad',
        'This copy of Chrome cannot listen. Type your goal in the box instead -- ' +
        'everything else works the same way.');
      return;
    }

    clearMessage();

    try {
      recognition = new SpeechRecognitionClass();
    } catch (e) {
      showMessage('bad', 'Could not start listening: ' + e.message + '. Please type instead.');
      return;
    }

    recognition.lang = speechCodeFor(lang);
    recognition.interimResults = true;   /* so the user sees words appear live */
    recognition.continuous = false;      /* one sentence, then stop */
    recognition.maxAlternatives = 1;

    recognition.onresult = function (event) {
      var interim = '';
      var final = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) { final += result[0].transcript; }
        else { interim += result[0].transcript; }
      }
      if (final) { acceptGoal(final); }
      else if (interim) { setTranscript(interim, false); }
    };

    recognition.onerror = function (event) {
      var code = event.error;

      if (code === 'not-allowed' || code === 'service-not-allowed') {
        showMessage('bad',
          'Chrome has not given Daari permission to use the microphone.\n\n' +
          'This takes one click and you only do it once.',
          'Allow microphone', openPermissionPage);

      } else if (code === 'language-not-supported') {
        showMessage('bad',
          'Chrome cannot recognise ' + speechCodeFor(lang) + ' speech on this computer.\n\n' +
          'Please type your goal in the box instead. Tell Claude this happened -- it is worth ' +
          'knowing before the demo.');

      } else if (code === 'no-speech') {
        showMessage('info',
          'I did not hear anything. Tap the button and speak a little closer to the microphone.');

      } else if (code === 'network') {
        showMessage('bad',
          'Speech recognition needs the internet, and the connection failed. ' +
          'Check your connection, or type your goal instead.');

      } else if (code !== 'aborted') {
        showMessage('bad', 'Listening stopped (' + code + '). Please try again, or type instead.');
      }

      stopListening();
    };

    recognition.onend = function () { stopListening(); };

    try {
      recognition.start();
      listening = true;
      el.mic.className = 'mic listening';
      applyLanguage();
      setTranscript('...', false);
    } catch (e) {
      showMessage('bad', 'Could not start listening: ' + e.message);
      stopListening();
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

  el.mic.addEventListener('click', function () {
    if (listening) { stopListening(); } else { startListening(); }
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

  el.stopSpeak.addEventListener('click', function () {
    if (window.speechSynthesis) { window.speechSynthesis.cancel(); }
    DAARI_TTS.stop();   /* fetched Telugu audio has to be stopped separately */
  });

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
