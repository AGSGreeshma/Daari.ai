/* ============================================================================
   ***  ALL NEW TELUGU AND HINDI WRITTEN ON 2 OCT -- PLEASE REVIEW THIS FILE  ***

   Everything added for the two guidance levels and the station helper is in
   this one file so it can be read and corrected in a single pass. Nothing else
   added today contains Telugu or Hindi. Change any line here and nothing else
   needs to move.

   These were written by Claude, NOT by a native speaker. The English is the
   source of truth for meaning. If a translation reads badly, rewrite it.

   The style rules (set by the project owner, a Telugu speaker):
   - Use "here" -- ఇక్కడ / यहाँ -- so the sentence points at the ringed box.
   - Everyday loan words people actually say: స్టేషన్, టికెట్, బటన్ /
     स्टेशन, टिकट, बटन. Not formal Sanskritised equivalents.
   - ONE action per sentence.
   - As short as possible. Shorter than feels comfortable in English.
   - Say what to DO, not what the thing is called.
   - Never blame the user.

   FULL mode adds one extra freedom to those rules: a sentence may say WHY as
   well as what, because the whole point of full mode is the user who cannot
   read the page and needs to know what they are agreeing to. It still says it
   in one breath.
   ============================================================================ */

self.DAARI_GUIDANCE = {

  /* ------------------------------------------------------------------
     1. ONBOARDING -- the first screen, and the two help levels
     ------------------------------------------------------------------ */
  onboarding: {

    /* The language question is shown BEFORE a language is chosen, so it is
       printed in all three scripts at once rather than translated. */
    langPrompt: 'భాష  ·  भाषा  ·  Language',

    helpTitle: {
      en: 'How much help do you want?',
      hi: 'आपको कितनी मदद चाहिए?',
      te: 'మీకు ఎంత సహాయం కావాలి?'
    },

    lightLabel: {
      en: 'Just show me where',
      hi: 'बस जगह दिखाइए',
      te: 'చోటు చూపించండి చాలు'
    },
    lightHint: {
      en: 'You read English. Short steps only.',
      hi: 'आप अंग्रेज़ी पढ़ लेते हैं। छोटे कदम।',
      te: 'మీకు ఇంగ్లీష్ వస్తుంది. చిన్న స్టెప్‌లు చాలు.'
    },

    fullLabel: {
      en: 'Guide me fully',
      hi: 'पूरी तरह मदद कीजिए',
      te: 'పూర్తిగా సహాయం చేయండి'
    },
    fullHint: {
      en: 'Daari explains each page, and why.',
      hi: 'दारी हर पेज बताएगी, और क्यों।',
      te: 'దారి ప్రతి పేజీ, ఎందుకో చెబుతుంది.'
    },

    /* The way back in. Onboarding must never be a one-way door. */
    change: {
      en: 'Change language or help',
      hi: 'भाषा या मदद बदलिए',
      te: 'భాష లేదా సహాయం మార్చండి'
    },

    /* Shown under the help buttons so the choice does not feel final. */
    canChange: {
      en: 'You can change this later.',
      hi: 'यह बाद में बदल सकते हैं।',
      te: 'ఇది తరువాత మార్చుకోవచ్చు.'
    }
  }
};
