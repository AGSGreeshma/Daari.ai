/* Station names, and turning what somebody SAID into what the box NEEDS.

   The problem this solves: the user speaks "విజయవాడ" or "बेज़वाड़ा", and the
   website will only accept "VIJAYAWADA" typed in Latin letters. That gap is
   the single hardest moment in the whole booking for the people Daari is for,
   and no amount of ringing the right box helps with it -- the box is already
   ringed; they simply cannot spell what they want in a script they do not
   read.

   So Daari resolves the name and shows it, large, for them to copy. It does
   NOT type it. Rule 1 is not bent here: the user still types, and what they
   type is still never read back.

   Bundled rather than fetched: this must work when the API is down, which is
   exactly when a user is most stuck. The list is small on purpose -- these are
   the stations the practice site and the demo use, plus the big ones a Telugu
   or Hindi speaker is most likely to name. An unknown name resolves to
   nothing, and Daari says it does not know rather than guessing a station the
   user never asked for. Sending somebody to the wrong city is far worse than
   admitting ignorance.

   Telugu and Hindi spellings are in extension/strings-guidance.js territory in
   spirit, but they live here because they are DATA, matched against, never
   spoken. The file is still short enough to check by eye. */

self.DAARI_STATIONS = [
  /* en    -- exactly what must be typed into the box, as the site wants it.
     code  -- the station code, shown as a hint because many older travellers
              know the code better than the spelling.
     te/hi -- how people say it. More than one, because people really do.
     also  -- Latin misspellings and older names that are still in daily use. */
  { en: 'VIJAYAWADA',    code: 'BZA',
    te: ['విజయవాడ', 'బెజవాడ'],            hi: ['विजयवाड़ा', 'बेज़वाड़ा'],
    also: ['bezawada', 'vijaywada', 'bezwada'] },
  { en: 'SECUNDERABAD',  code: 'SC',
    te: ['సికింద్రాబాద్'],                  hi: ['सिकंदराबाद'],
    also: ['secunderbad', 'sikindrabad'] },
  { en: 'HYDERABAD',     code: 'HYB',
    te: ['హైదరాబాద్'],                     hi: ['हैदराबाद'],
    also: ['nampally', 'hyd'] },
  { en: 'KAZIPET',       code: 'KZJ',
    te: ['కాజీపేట'],                       hi: ['काज़ीपेट'],
    also: ['kazipeta'] },
  { en: 'WARANGAL',      code: 'WL',
    te: ['వరంగల్', 'ఓరుగల్లు'],            hi: ['वरंगल'],
    also: ['varangal'] },
  { en: 'GUNTUR',        code: 'GNT',
    te: ['గుంటూరు'],                       hi: ['गुंटूर'],
    also: [] },
  { en: 'TIRUPATI',      code: 'TPTY',
    te: ['తిరుపతి'],                       hi: ['तिरुपति'],
    also: ['thirupathi', 'tirupathi'] },
  { en: 'VISAKHAPATNAM', code: 'VSKP',
    te: ['విశాఖపట్నం', 'వైజాగ్'],          hi: ['विशाखापत्तनम'],
    also: ['vizag', 'waltair', 'vishakhapatnam'] },
  { en: 'RAJAHMUNDRY',   code: 'RJY',
    te: ['రాజమండ్రి', 'రాజమహేంద్రవరం'],   hi: ['राजमुंदरी'],
    also: ['rajamundry', 'rajamahendravaram'] },
  { en: 'NELLORE',       code: 'NLR',
    te: ['నెల్లూరు'],                      hi: ['नेल्लोर'],
    also: [] },
  { en: 'KURNOOL CITY',  code: 'KRNT',
    te: ['కర్నూలు'],                       hi: ['कुरनूल'],
    also: ['kurnool'] },
  { en: 'NIZAMABAD',     code: 'NZB',
    te: ['నిజామాబాద్'],                    hi: ['निज़ामाबाद'],
    also: ['indur'] },
  { en: 'KHAMMAM',       code: 'KMT',
    te: ['ఖమ్మం'],                         hi: ['खम्मम'],
    also: [] },
  { en: 'ELURU',         code: 'EE',
    te: ['ఏలూరు'],                         hi: ['एलुरु'],
    also: ['eluru'] },
  { en: 'NEW DELHI',     code: 'NDLS',
    te: ['ఢిల్లీ', 'న్యూ ఢిల్లీ'],          hi: ['दिल्ली', 'नई दिल्ली'],
    also: ['delhi'] },
  { en: 'CHENNAI CENTRAL', code: 'MAS',
    te: ['చెన్నై', 'మద్రాసు'],             hi: ['चेन्नई', 'मद्रास'],
    also: ['madras', 'chennai'] },
  { en: 'KSR BENGALURU', code: 'SBC',
    te: ['బెంగళూరు', 'బెంగుళూరు'],         hi: ['बेंगलुरु', 'बंगलौर'],
    also: ['bangalore', 'bengaluru', 'majestic'] },
  { en: 'MUMBAI CSMT',   code: 'CSMT',
    te: ['ముంబై', 'బొంబాయి'],              hi: ['मुंबई', 'बॉम्बे'],
    also: ['bombay', 'mumbai', 'vt'] }
];

/* Strip everything that differs between two people saying the same name:
   case, spaces, dots, hyphens, and the Telugu/Hindi trailing vowel marks that
   speech-to-text adds or drops more or less at random. */
function daariNormalise(text) {
  return String(text || '')
    .toLowerCase()
    /* The Devanagari nukta: ज़ and ज, ड़ and ड. Speech-to-text puts it in or
       leaves it out more or less at random, and nobody hears the difference,
       so neither does the matching. */
    .replace(/़/g, '')
    .replace(/[\s.\-_,'"]/g, '')
    .trim();
}

/* Every string that should resolve to one station. */
function daariStationNames(station) {
  return [station.en, station.code]
    .concat(station.te || [], station.hi || [], station.also || []);
}

/* What did they say?

   Returns { en, code, heard } or null. Null means "I do not know this one",
   and that is a perfectly good answer -- the caller says so out loud instead
   of sending somebody to a station they never named.

   Scored rather than first-match, because "chennai" must not be answered by
   the first entry that merely contains it. Exact beats starts-with beats
   contains, and a longer matched name beats a shorter one -- so "new delhi"
   resolves to NEW DELHI rather than being dragged to DELHI by a loose
   substring. */
self.DAARI_RESOLVE_STATION = function (spoken) {
  var said = daariNormalise(spoken);
  if (!said) { return null; }

  /* An exact station code first, before the length guard below.
     Several real codes are only two letters -- SC, WL, EE -- and the code is
     precisely what an older traveller is most likely to know by heart. The
     guard was turning those away. */
  var exactCode = null;
  self.DAARI_STATIONS.forEach(function (station) {
    if (daariNormalise(station.code) === said) {
      exactCode = { en: station.en, code: station.code, heard: station.code };
    }
  });
  if (exactCode) { return exactCode; }

  /* Below three characters nothing else is safe to guess from. */
  if (said.length < 3) { return null; }

  var best = null;
  var bestScore = 0;

  self.DAARI_STATIONS.forEach(function (station) {
    daariStationNames(station).forEach(function (name) {
      var candidate = daariNormalise(name);
      if (!candidate) { return; }

      var score = 0;
      if (candidate === said) {
        score = 100;
      } else if (said.indexOf(candidate) === 0 || candidate.indexOf(said) === 0) {
        /* One is the start of the other. "vijayawad" for "vijayawada", or
           "vijayawada junction" for "vijayawada". */
        score = 70;
      } else if (candidate.indexOf(said) !== -1 || said.indexOf(candidate) !== -1) {
        score = 40;
      }
      if (!score) { return; }

      /* Longer agreement is stronger agreement. */
      score += Math.min(candidate.length, said.length);

      if (score > bestScore) {
        bestScore = score;
        best = { en: station.en, code: station.code, heard: name };
      }
    });
  });

  /* A bare substring hit on a very short word is not enough. */
  if (bestScore < 44) { return null; }
  return best;
};

/* Is the ringed thing a station box?

   Deliberately strict: it must actually say "station" (in any of the three
   scripts) or "city". A box labelled only "From" could be a date, a price or a
   platform, and offering the station helper on the wrong box is worse than not
   offering it -- the user would be told to type a city name into something
   that is not a city. Fails closed, like every other match in Daari. */
self.DAARI_IS_STATION_BOX = function (names) {
  var list = [].concat(names || []).map(daariNormalise).join(' ');
  if (!list) { return false; }
  return list.indexOf('station') !== -1 ||
         list.indexOf('city') !== -1 ||
         list.indexOf('స్టేషన్') !== -1 ||
         list.indexOf('स्टेशन') !== -1;
};
