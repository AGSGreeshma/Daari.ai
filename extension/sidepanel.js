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

  var T = window.DAARI_T;
  var S = window.DAARI_STRINGS;

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
    repeat: document.getElementById('repeat'),
    stopSpeak: document.getElementById('stopSpeak'),
    startDemo: document.getElementById('startDemo'),
    voiceStatus: document.getElementById('voiceStatus')
  };

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
    document.documentElement.setAttribute('lang', lang);
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

  /* Say something out loud. Returns true if a real voice spoke it. */
  function speak(text, code) {
    if (!text || !window.speechSynthesis) { return false; }

    lastSpoken = { text: text, lang: code };

    var voice = pickVoice(code);
    if (!voice) {
      /* No voice for this language. Chime instead, and let the large caption
         do the work. Phase 5 fills this gap for Telugu with OpenAI TTS. */
      chime();
      return false;
    }

    window.speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    /* Slowly. These users are not in a hurry and may be hearing the
       instruction for the first time. */
    utterance.rate = 0.8;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    return true;
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
    el.voiceStatus.innerHTML = parts.join('<br>') +
      '<br><br>Telugu speech arrives in Phase 5. Until then a Telugu step shows large ' +
      'text and plays a short chime, rather than being read in the wrong language.';
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
    if (!message || message.type !== 'DAARI_SPEAK') { return; }
    showInstruction(message.text, message.stepLabel);
    speak(message.text, message.lang || lang);
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
  });

  el.startDemo.addEventListener('click', async function () {
    clearMessage();
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      var tab = tabs[0];
      if (!tab) { throw new Error('No page is open.'); }
      await chrome.tabs.sendMessage(tab.id, { type: 'DAARI_START_DEMO' });
    } catch (e) {
      showMessage('bad',
        'Daari is not running in that page yet.\n\n' +
        'Reload the page (F5) and try again. A tab that was already open when the extension ' +
        'was installed or reloaded does not have Daari in it until the page is reloaded.');
    }
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
