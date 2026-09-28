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

window.DAARI_STRINGS = {

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

  ui: {
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
window.DAARI_T = function (entry, lang, fill) {
  if (!entry) { return ''; }
  var text = entry[lang] || entry.en || '';
  if (fill) {
    Object.keys(fill).forEach(function (key) {
      text = text.split('{' + key + '}').join(String(fill[key]));
    });
  }
  return text;
};
