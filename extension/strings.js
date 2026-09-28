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

  /* What Daari says for each of the three demo steps.

     These line up BY INDEX with DEMO_STEPS in content/overlay.js, which holds
     the matching look_for labels and done_when rules. Text lives here, logic
     lives there. Both disappear in Phase 4, when real steps come from the AI. */
  demoSay: [
    {
      en: 'Type where you are starting from',
      hi: 'यहाँ अपना शुरुआती स्टेशन लिखिए',
      te: 'మీరు ఏ స్టేషన్ నుండి బయలుదేరుతున్నారో ఇక్కడ టైప్ చేయండి'
    },
    {
      en: 'Now type where you are going',
      hi: 'अब आप कहाँ जा रहे हैं, वह लिखिए',
      te: 'ఇప్పుడు మీరు ఎక్కడికి వెళ్తున్నారో టైప్ చేయండి'
    },
    {
      en: 'Now press the Search Trains button',
      hi: 'अब Search Trains बटन दबाइए',
      te: 'ఇప్పుడు Search Trains బటన్ నొక్కండి'
    }
  ],

  /* The full booking walk. Keys match sayKey in flows.js.

     Every one of these is read aloud to someone who may be nervous and may be
     hearing it for the first time, so: one action, "here" pointing at the
     ring, and the loan words people actually say. Button names are left in
     English on purpose, because that is what is printed on the screen -- a
     translated button name would send the user hunting for words that are not
     there. */
  flow: {
    fromStation: {
      en: 'Type where you are starting from',
      hi: 'यहाँ अपना शुरुआती स्टेशन लिखिए',
      te: 'మీరు ఏ స్టేషన్ నుండి బయలుదేరుతున్నారో ఇక్కడ టైప్ చేయండి'
    },
    toStation: {
      en: 'Now type the station you are going to',
      hi: 'यहाँ अपना पहुँचने वाला स्टेशन लिखिए',
      te: 'ఇప్పుడు వెళ్ళే స్టేషన్ ఇక్కడ టైప్ చేయండి'
    },
    chooseClass: {
      en: 'Tap here to choose your class',
      hi: 'क्लास चुनने के लिए यहाँ दबाइए',
      te: 'క్లాస్ ఎంచుకోడానికి ఇక్కడ నొక్కండి'
    },
    pressSearch: {
      en: 'Now press this Search Trains button',
      hi: 'अब यह Search Trains बटन दबाइए',
      te: 'ఇప్పుడు ఈ Search Trains బటన్ నొక్కండి'
    },
    pressBook: {
      en: 'Press Book next to the train you want',
      hi: 'अपनी ट्रेन के आगे Book बटन दबाइए',
      te: 'మీ ట్రైన్ పక్కన Book బటన్ నొక్కండి'
    },
    passengerName: {
      en: 'Type the passenger name here',
      hi: 'यहाँ यात्री का नाम लिखिए',
      te: 'ప్రయాణికుడి పేరు ఇక్కడ టైప్ చేయండి'
    },
    age: {
      en: 'Type the age here',
      hi: 'यहाँ उम्र लिखिए',
      te: 'వయస్సు ఇక్కడ టైప్ చేయండి'
    },
    gender: {
      en: 'Choose the gender here',
      hi: 'यहाँ लिंग चुनिए',
      te: 'ఇక్కడ లింగం ఎంచుకోండి'
    },
    mobile: {
      en: 'Type the ten digit mobile number here',
      hi: 'यहाँ दस अंकों का मोबाइल नंबर लिखिए',
      te: 'పది అంకెల మొబైల్ నంబర్ ఇక్కడ టైప్ చేయండి'
    },
    sendOtp: {
      en: 'Press this Send OTP button',
      hi: 'यह Send OTP बटन दबाइए',
      te: 'ఈ Send OTP బటన్ నొక్కండి'
    },

    /* Sensitive. Daari says where the code is, and never what it is. */
    typeOtp: {
      en: 'The code is on the screen. Type it here yourself.',
      hi: 'कोड स्क्रीन पर है। उसे खुद यहाँ लिखिए।',
      te: 'కోడ్ స్క్రీన్ మీద ఉంది. దాన్ని మీరే ఇక్కడ టైప్ చేయండి.'
    },

    continuePay: {
      en: 'Now press Continue to Payment',
      hi: 'अब Continue to Payment दबाइए',
      te: 'ఇప్పుడు Continue to Payment నొక్కండి'
    },

    /* Sensitive. The second sentence is a promise, and it is true: see
       accessibleName() and isFilled() in content/overlay.js. */
    cardNumber: {
      en: 'Type your card number here yourself. I never read it.',
      hi: 'अपना कार्ड नंबर खुद यहाँ लिखिए। मैं उसे कभी नहीं पढ़ता।',
      te: 'మీ కార్డ్ నంబర్ మీరే ఇక్కడ టైప్ చేయండి. నేను దాన్ని ఎప్పుడూ చదవను.'
    },

    pressPay: {
      en: 'Now press the Pay button',
      hi: 'अब Pay बटन दबाइए',
      te: 'ఇప్పుడు Pay బటన్ నొక్కండి'
    },
    finished: {
      en: 'Your PNR is on the screen. Well done!',
      hi: 'आपका PNR स्क्रीन पर है। बहुत बढ़िया!',
      te: 'మీ PNR స్క్రీన్ మీద ఉంది. బాగా చేశారు!'
    }
  },

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
