/* Every word Daari says or shows, in all three languages, in one place.

   Why one file: this is loaded both by the side panel (Daari's mouth) and by
   the content script (Daari's captions), so the spoken sentence and the
   written one can never drift apart. It is also the only file a translator
   needs to touch.

   PLEASE CHECK THE TELUGU AND HINDI. These were written by Claude, not by a
   native speaker. The English is the source of truth for meaning; if a
   translation reads awkwardly to you, change it here and nothing else needs
   to move.

   Style rules for anything added here (set by the project owner, a Telugu
   speaker, after reviewing the first draft):
   - Use "here" -- ఇక్కడ / यहाँ -- so the sentence points at the ringed box.
   - Use the everyday loan words people actually say: స్టేషన్, టికెట్, బటన్ /
     स्टेशन, टिकट, बटन. Not the formal Sanskritised equivalents.
   - ONE action per sentence.
   - As short as possible. Shorter than feels comfortable in English.
   - Say what to DO, not what the thing is called.
   - Never blame the user. */

self.DAARI_STRINGS = {

  /* The three languages, in the order they appear in the picker.
     "speech" is the code Chrome's speech recogniser wants. */
  langs: [
    { code: 'te', label: 'తెలుగు',  speech: 'te-IN', english: 'Telugu' },
    { code: 'hi', label: 'हिन्दी',   speech: 'hi-IN', english: 'Hindi' },
    { code: 'en', label: 'English', speech: 'en-IN', english: 'English' }
  ],

  ui: {
    /* The confirm gate. Daari stops and will not point at the button until
       the user says they have looked. */
    confirmBeforePay: {
      en: 'Please check the details on screen before paying',
      hi: 'भुगतान से पहले स्क्रीन पर दी गई जानकारी जाँच लीजिए',
      te: 'చెల్లించే ముందు స్క్రీన్ మీద ఉన్న వివరాలు చూడండి'
    },
    checkFirst: {
      en: 'Please check',
      hi: 'जाँच लीजिए',
      te: 'చూడండి'
    },
    iHaveChecked: {
      en: 'I have checked - continue',
      hi: 'मैंने जाँच लिया - आगे बढ़िए',
      te: 'నేను చూశాను - ముందుకు వెళ్ళండి'
    },
    stopGuidance: {
      en: 'Stop guidance',
      hi: 'मदद बंद कीजिए',
      te: 'సహాయం ఆపండి'
    },
    /* Said before the instruction when the user pressed the Back button, so
       the ring moving backwards reads as understanding rather than confusion. */
    wentBack: {
      en: 'You went back - let us continue from here.',
      hi: 'आप पीछे आ गए - यहाँ से आगे चलिए।',
      te: 'మీరు వెనక్కి వచ్చారు - ఇక్కడ నుండి కొనసాగిద్దాం.'
    },

    /* The Back button's counterpart: the user jumped ahead, usually by pressing
       Forward after having gone back. */
    wentForward: {
      en: 'You moved ahead - let us carry on from here.',
      hi: 'आप आगे आ गए - यहाँ से आगे चलिए।',
      te: 'మీరు ముందుకు వచ్చారు - ఇక్కడ నుండి కొనసాగిద్దాం.'
    },

    /* The website refused what was typed. Daari pressed nothing and cannot read
       the site's own error message yet, so it says the honest minimum: the site
       did not accept it, look at this box. Reading the exact message aloud is
       Phase C. */
    notAccepted: {
      en: 'The website did not accept that. Please check this box.',
      hi: 'वेबसाइट ने इसे स्वीकार नहीं किया। यह बॉक्स देख लीजिए।',
      te: 'వెబ్‌సైట్ దీన్ని అంగీకరించలేదు. ఈ బాక్స్ చూడండి.'
    },

    /* Said after a step finishes, before the next instruction, with about a
       second of quiet either side. Real testing said the steps "rush ahead while
       I am still typing" -- this is the pause made audible, so finishing a step
       feels acknowledged rather than overtaken. */
    good: {
      en: 'Good',
      hi: 'बढ़िया',
      te: 'బాగుంది'
    },

    /* An autocomplete list is open. Typing is not enough -- a suggestion has to
       be chosen, or the site will not accept the station. */
    pickFromList: {
      en: 'Now pick your station from the list',
      hi: 'अब सूची से अपना स्टेशन चुनिए',
      te: 'ఇప్పుడు లిస్ట్ నుండి మీ స్టేషన్ ఎంచుకోండి'
    },

    /* A box that already had something in it -- IRCTC filling From from your
       location, for instance. Daari does NOT skip past it, and does NOT read the
       value out. It asks the user to look. */
    prefilledCheck: {
      en: 'This box already has something in it. Check it is right - change it if not, then tap Done.',
      hi: 'इस बॉक्स में पहले से कुछ लिखा है। देख लीजिए कि सही है - न हो तो बदलिए, फिर Done दबाइए।',
      te: 'ఈ బాక్స్‌లో ఇప్పటికే ఏదో ఉంది. సరిగ్గా ఉందో చూడండి - కాకపోతే మార్చండి, తర్వాత Done నొక్కండి.'
    },

    /* Always visible while guiding, because automatic detection will sometimes
       miss and the user must never be stuck. */
    manualDone: {
      en: 'Done - next step',
      hi: 'हो गया - आगे',
      te: 'అయింది - తర్వాత'
    },

    goBackStep: {
      en: 'Go back a step',
      hi: 'एक कदम पीछे',
      te: 'ఒక అడుగు వెనక్కి'
    },

    notGuiding: {
      en: 'Not guiding right now',
      hi: 'अभी मदद नहीं चल रही',
      te: 'ఇప్పుడు సహాయం జరగడం లేదు'
    },

    wellDone: {
      en: 'Well done!',
      hi: 'बहुत बढ़िया!',
      te: 'బాగా చేశారు!'
    },

    /* The failure voice from CLAUDE.md. Never a confident wrong instruction. */
    notSure: {
      en: 'I am not sure about this page. Can you tell me what you see?',
      hi: 'मुझे इस पेज के बारे में पक्का पता नहीं है। आपको क्या दिख रहा है, बताइए?',
      te: 'ఈ పేజీ గురించి నాకు స్పష్టంగా తెలియదు. మీకు ఏమి కనిపిస్తుందో చెప్పగలరా?'
    },

    /* {n} and {total} are replaced with numbers. */
    stepOf: {
      en: 'Step {n} of {total}',
      hi: 'चरण {n} / {total}',
      te: 'అడుగు {n} / {total}'
    },

    /* On a site with no recipe there is no known total, so Daari does not
       pretend to know one. */
    stepOnly: {
      en: 'Step {n}',
      hi: 'चरण {n}',
      te: 'అడుగు {n}'
    },

    /* Said at 1.5 seconds, while we are still waiting on the model. Silence
       reads as "broken" to a first-time user; this is the cheapest possible
       way to say "still here". */
    oneMoment: {
      en: 'One moment...',
      hi: 'एक पल...',
      te: 'ఒక క్షణం...'
    },

    /* The 25-call budget is gone. Daari carries on from its own known route,
       and says so rather than quietly getting worse. */
    budgetSpent: {
      en: 'I will use my saved route from here.',
      hi: 'अब मैं अपना सहेजा हुआ रास्ता इस्तेमाल करूँगा।',
      te: 'ఇక్కడ నుండి నా దగ్గర ఉన్న దారిని వాడుతాను.'
    },

    finished: {
      en: 'Finished',
      hi: 'पूरा हुआ',
      te: 'పూర్తయింది'
    },

    micIdle: {
      en: 'Speak your goal',
      hi: 'अपना काम बोलिए',
      te: 'మీ పని చెప్పండి'
    },

    /* The mic no longer stops when you pause. Tap to speak, tap to send -- so
       the button says what tapping it will DO, not what Daari is doing. */
    micSend: {
      en: 'Tap to send',
      hi: 'भेजने के लिए दबाइए',
      te: 'పంపడానికి నొక్కండి'
    },

    micCancel: {
      en: 'Cancel',
      hi: 'रद्द',
      te: 'రద్దు'
    },

    /* Said under the button while listening. "Take your time" is the whole point
       of the change: the old mic cut people off mid-sentence. */
    micListeningHint: {
      en: 'I am listening. Take your time.',
      hi: 'मैं सुन रहा हूँ। जल्दी नहीं है।',
      te: 'నేను వింటున్నాను. తొందర లేదు.'
    },

    micSilence: {
      en: 'I heard nothing for a while, so I stopped. Tap to try again.',
      hi: 'कुछ देर कुछ सुनाई नहीं दिया, इसलिए मैंने रोक दिया। फिर दबाइए।',
      te: 'కొంతసేపు ఏమీ వినిపించలేదు, ఆపేశాను. మళ్ళీ నొక్కండి.'
    },

    /* The check before anything happens: a misheard word can be typed over. */
    confirmHeading: {
      en: 'Is this right?',
      hi: 'क्या यह सही है?',
      te: 'ఇది సరిగ్గా ఉందా?'
    },

    confirmSend: {
      en: 'Yes, go',
      hi: 'हाँ, चलिए',
      te: 'అవును, వెళ్ళండి'
    },

    confirmAgain: {
      en: 'Speak again',
      hi: 'फिर बोलिए',
      te: 'మళ్ళీ మాట్లాడండి'
    },

    micListening: {
      en: 'Listening... tap to stop',
      hi: 'सुन रहा हूँ... रोकने के लिए दबाइए',
      te: 'వింటున్నాను... ఆపడానికి నొక్కండి'
    },

    transcriptPlaceholder: {
      en: 'What do you want to do? Tap the button above and say it.',
      hi: 'आप क्या करना चाहते हैं? ऊपर का बटन दबाकर बोलिए।',
      te: 'మీరు ఏమి చేయాలనుకుంటున్నారు? పైన ఉన్న బటన్ నొక్కి చెప్పండి.'
    },

    yourGoal: {
      en: 'Your goal',
      hi: 'आपका काम',
      te: 'మీ పని'
    },

    typeInstead: {
      en: 'Or type it here instead',
      hi: 'या यहाँ लिखिए',
      te: 'లేదా ఇక్కడ టైప్ చేయండి'
    },

    use: {
      en: 'Use this',
      hi: 'यही',
      te: 'ఇదే'
    },

    repeat: {
      en: 'Repeat',
      hi: 'दोहराइए',
      te: 'మళ్ళీ చెప్పండి'
    },

    stopSpeaking: {
      en: 'Stop speaking',
      hi: 'बोलना बंद',
      te: 'ఆపండి'
    },

    startDemo: {
      en: 'Start demo on this page',
      hi: 'इस पेज पर डेमो शुरू करें',
      te: 'ఈ పేజీలో డెమో మొదలుపెట్టండి'
    }
  }
};

/* Look up a string in the chosen language, falling back to English rather
   than showing a blank. Also fills in {n} / {total} placeholders. */
self.DAARI_T = function (entry, lang, fill) {
  if (!entry) { return ''; }
  var text = entry[lang] || entry.en || '';
  if (fill) {
    Object.keys(fill).forEach(function (key) {
      text = text.split('{' + key + '}').join(String(fill[key]));
    });
  }
  return text;
};
