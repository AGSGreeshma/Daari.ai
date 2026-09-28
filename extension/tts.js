/* Telugu speech, from our own API.

   Windows usually has no Telugu voice, and CLAUDE.md forbids the obvious cheat
   of letting a Hindi voice read Telugu -- it mispronounces badly enough to be
   worse than silence. So Telugu sentences are fetched as audio instead.

   Everything is cached by sentence. Daari says the same dozen sentences over
   and over, speech is charged by the character, and the budget is five dollars
   in total, so the second time through a booking costs nothing at all. Repeat
   is free for the same reason.

   The cache lives in memory in the panel, so it is lost when the panel is
   closed. That is the right trade for now: it covers a whole session, which is
   what matters, without putting audio into extension storage. */

self.DAARI_TTS = (function () {
  'use strict';

  var MAX_CACHED = 40;

  var cache = new Map();     /* "te:sentence" -> blob URL */
  var playing = null;        /* the Audio element currently speaking */
  var lastError = null;

  function stop() {
    if (playing) {
      try { playing.pause(); } catch (e) { /* already gone */ }
      playing = null;
    }
  }

  /* Oldest out first. Map preserves insertion order, so the first key is the
     oldest one. */
  function trim() {
    while (cache.size > MAX_CACHED) {
      var oldest = cache.keys().next().value;
      var url = cache.get(oldest);
      cache.delete(oldest);
      try { URL.revokeObjectURL(url); } catch (e) { /* nothing to free */ }
    }
  }

  async function fetchAudio(text, lang) {
    var base = self.DAARI_CONFIG && self.DAARI_CONFIG.API_BASE;
    if (!base) { throw new Error('no API_BASE in config.js'); }

    var response = await fetch(base + '/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        /* The API refuses requests without this. See config.js. */
        'X-Daari-Client': self.DAARI_CONFIG.CLIENT
      },
      body: JSON.stringify({ text: text, lang: lang })
    });

    if (!response.ok) {
      var detail = '';
      try { detail = (await response.json()).error || ''; } catch (e) { /* not JSON */ }
      throw new Error('status ' + response.status + (detail ? ': ' + detail : ''));
    }

    return URL.createObjectURL(await response.blob());
  }

  /* Say it. Resolves true if audio actually played.
     Returns false rather than throwing, because the caller's fallback is
     simply to leave the large caption on screen. */
  async function speak(text, lang) {
    var key = lang + ':' + text;

    try {
      var url = cache.get(key);
      if (!url) {
        url = await fetchAudio(text, lang);
        cache.set(key, url);
        trim();
      }

      stop();
      playing = new Audio(url);
      await playing.play();
      lastError = null;
      return true;

    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
      return false;
    }
  }

  return {
    speak: speak,
    stop: stop,
    cached: function () { return cache.size; },
    lastError: function () { return lastError; }
  };
}());
