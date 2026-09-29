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
