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
  },

  /* ------------------------------------------------------------------
     3. THE STATION HELPER

     Shown when the ringed box is a station box. The user says the name in
     their own language; Daari shows the English spelling, large, for them to
     copy. Daari does not type it -- the whole point is that they can.
     ------------------------------------------------------------------ */
  station: {

    /* The invitation, shown above the box. */
    prompt: {
      en: 'Say or type your station',
      hi: 'अपना स्टेशन बोलिए या लिखिए',
      te: 'మీ స్టేషన్ చెప్పండి లేదా టైప్ చేయండి'
    },

    /* The label above the big English spelling. Short, because the name under
       it is what matters. */
    typeThis: {
      en: 'Type:',
      hi: 'यह लिखिए:',
      te: 'ఇది టైప్ చేయండి:'
    },

    /* Said out loud once the name is resolved. The spelling itself is shown,
       not spoken letter by letter -- reading it out in Telugu would be worse
       than useless. */
    nowType: {
      en: 'Type this name in the ringed box.',
      hi: 'यह नाम घेरे हुए बॉक्स में लिखिए।',
      te: 'ఈ పేరు గుర్తు పెట్టిన బాక్స్‌లో టైప్ చేయండి.'
    },

    /* The station code, offered because many older travellers know the code
       better than the spelling. */
    orCode: {
      en: 'The short code works too:',
      hi: 'छोटा कोड भी चलेगा:',
      te: 'చిన్న కోడ్ కూడా పనిచేస్తుంది:'
    },

    /* The honest answer. Never a guessed station: sending somebody to the
       wrong city is far worse than admitting ignorance. */
    unknown: {
      en: 'I do not know that station. Please type it yourself.',
      hi: 'वह स्टेशन मुझे नहीं पता। आप ही लिख दीजिए।',
      te: 'ఆ స్టేషన్ నాకు తెలియదు. మీరే టైప్ చేయండి.'
    },

    /* The button on the typing fallback. */
    find: {
      en: 'Find it',
      hi: 'ढूँढिए',
      te: 'వెతకండి'
    }
  },

  /* ------------------------------------------------------------------
     2. FULL MODE -- what each page is for, and why each step exists

     Keyed by the recipe's own "task" name, then by step number. Written out
     here rather than inside the recipe JSON so that every word needing review
     is in this one file.

     A missing entry is not a bug: the worker falls back to the recipe's
     ordinary "say" for that step. So a half-translated recipe behaves exactly
     like today instead of going quiet.

     ONLY book-ticket is written. check-pnr deliberately has none, and falls
     back to its short sentences.
     ------------------------------------------------------------------ */
  byTask: {

    'book-ticket': {

      /* Said once, when the user first arrives on that page. One sentence on
         what the page is FOR -- not what is on it. */
      pageIntro: {
        index: {
          en: 'This page is for finding trains.',
          hi: 'इस पेज पर ट्रेन ढूँढते हैं।',
          te: 'ఈ పేజీలో ట్రైన్లు వెతుకుతారు.'
        },
        results: {
          en: 'These are the trains for that day.',
          hi: 'उस दिन की ट्रेनें ये हैं।',
          te: 'ఆ రోజు ఉన్న ట్రైన్లు ఇవి.'
        },
        passenger: {
          en: 'This page asks who is travelling.',
          hi: 'इस पेज पर कौन यात्रा करेगा, यह पूछते हैं।',
          te: 'ఈ పేజీలో ఎవరు ప్రయాణం చేస్తారో అడుగుతారు.'
        },
        payment: {
          en: 'This page takes the money for the ticket.',
          hi: 'इस पेज पर टिकट के पैसे देने होते हैं।',
          te: 'ఈ పేజీలో టికెట్ డబ్బు కట్టాలి.'
        },
        confirmation: {
          en: 'The ticket is booked. This page is your proof.',
          hi: 'टिकट बुक हो गया। यह पेज आपका सबूत है।',
          te: 'టికెట్ బుక్ అయింది. ఈ పేజీ మీ ఆధారం.'
        }
      },

      /* The instruction, saying what to do AND why, in one breath. Step
         numbers match extension/recipes/practice-book-ticket.json. */
      stepFull: {
        0: {
          en: 'Type where your journey starts, so the site knows which trains to show.',
          hi: 'यहाँ अपना शुरुआती स्टेशन लिखिए, तभी साइट ट्रेनें दिखाएगी।',
          te: 'మీ ప్రయాణం ఏ స్టేషన్ నుండి మొదలవుతుందో ఇక్కడ టైప్ చేయండి, అప్పుడే సైట్ ట్రైన్లు చూపిస్తుంది.'
        },
        1: {
          en: 'Now type where you are going, so it can find trains between the two.',
          hi: 'अब यहाँ लिखिए कहाँ जाना है, तब दोनों के बीच की ट्रेनें मिलेंगी।',
          te: 'ఇప్పుడు మీరు ఎక్కడికి వెళ్తున్నారో ఇక్కడ టైప్ చేయండి, ఆ రెండు స్టేషన్ల మధ్య ట్రైన్లు కనిపిస్తాయి.'
        },
        2: {
          en: 'Choose your class here. It decides the seat and the fare.',
          hi: 'यहाँ क्लास चुनिए। सीट और किराया इससे तय होता है।',
          te: 'ఇక్కడ క్లాస్ సెలెక్ట్ చేసుకోండి. సీటు, ఛార్జి ఇది నిర్ణయిస్తుంది.'
        },
        3: {
          en: 'Press Search Trains. The next page will list the trains.',
          hi: 'Search Trains दबाइए। अगले पेज पर ट्रेनों की लिस्ट आएगी।',
          te: 'Search Trains నొక్కండి. తర్వాత పేజీలో ట్రైన్ల లిస్ట్ వస్తుంది.'
        },
        4: {
          en: 'Press Book next to the train you want. That picks this train.',
          hi: 'जो ट्रेन चाहिए उसके आगे Book दबाइए। वही ट्रेन चुनी जाएगी।',
          te: 'మీకు కావాల్సిన ట్రైన్ పక్కన Book నొక్కండి. అదే ట్రైన్ ఎంచుకుంటారు.'
        },
        5: {
          en: "Type the passenger's name here. It is printed on the ticket.",
          hi: 'यात्री का नाम यहाँ लिखिए। यही टिकट पर छपता है।',
          te: 'ప్రయాణం చేసే వారి పేరు ఇక్కడ టైప్ చేయండి. ఇదే టికెట్ మీద వస్తుంది.'
        },
        6: {
          en: 'Type the age here. The fare can depend on it.',
          hi: 'उम्र यहाँ लिखिए। किराया इस पर निर्भर करता है।',
          te: 'వయస్సు ఇక్కడ టైప్ చేయండి. ఛార్జి దానిపై ఆధారపడుతుంది.'
        },
        7: {
          en: 'Choose the gender here. It is needed on the ticket.',
          hi: 'यहाँ जेंडर चुनिए। टिकट पर यह ज़रूरी है।',
          te: 'జెండర్ ఇక్కడ సెలెక్ట్ చేయండి. టికెట్ మీద ఇది కావాలి.'
        },
        8: {
          en: 'Type the ten digit mobile number. The ticket message comes to it.',
          hi: 'दस अंकों का मोबाइल नंबर लिखिए। टिकट का मैसेज उसी पर आएगा।',
          te: 'పది అంకెల మొబైల్ నంబర్ ఇక్కడ టైప్ చేయండి. టికెట్ మెసేజ్ దానికే వస్తుంది.'
        },
        9: {
          en: 'Press Send OTP. A code will appear, to prove the number is yours.',
          hi: 'Send OTP दबाइए। नंबर आपका है, यह दिखाने के लिए एक कोड आएगा।',
          te: 'Send OTP నొక్కండి. నంబర్ మీదేనని చూపడానికి ఒక కోడ్ వస్తుంది.'
        },
        10: {
          en: 'The code is on the screen. Type it here yourself.',
          hi: 'कोड स्क्रीन पर है। उसे आप ही यहाँ लिखिए।',
          te: 'కోడ్ స్క్రీన్ మీద ఉంది. దాన్ని మీరే ఇక్కడ టైప్ చేయండి.'
        },
        11: {
          en: 'Press Continue to Payment. The next page asks for money.',
          hi: 'Continue to Payment दबाइए। अगले पेज पर पैसे मांगे जाएंगे।',
          te: 'Continue to Payment నొక్కండి. తర్వాత పేజీలో డబ్బు అడుగుతారు.'
        },
        12: {
          en: 'Type your card number here yourself. I never read it.',
          hi: 'अपना कार्ड नंबर आप ही यहाँ लिखिए। मैं उसे कभी नहीं पढ़ती।',
          te: 'మీ కార్డ్ నంబర్ మీరే ఇక్కడ టైప్ చేయండి. నేను దాన్ని ఎప్పుడూ చదవను.'
        },
        /* The payment step. This is the one the owner asked to say what
           happens NEXT, because this is where a wrong press costs money. The
           code gate still stops here and waits; this only changes the words. */
        13: {
          en: 'Check the amount on screen first. Press Pay, then type your PIN yourself.',
          hi: 'पहले स्क्रीन पर रकम देख लीजिए। Pay दबाकर अपना पिन आप ही डालिए।',
          te: 'ముందు స్క్రీన్ మీద మొత్తం చూడండి. Pay నొక్కి, మీ పిన్ మీరే టైప్ చేయండి.'
        },
        14: {
          en: 'The ticket is booked. Your PNR is on the screen - keep that number.',
          hi: 'टिकट बुक हो गया। आपका PNR स्क्रीन पर है - वह नंबर रख लीजिए।',
          te: 'టికెట్ బుక్ అయింది. మీ PNR స్క్రీన్ మీద ఉంది - ఆ నంబర్ దగ్గర పెట్టుకోండి.'
        }
      }
    }
  }
};
