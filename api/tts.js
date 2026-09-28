// Telugu speech.
//
// Windows usually has no Telugu voice, and CLAUDE.md forbids the obvious cheat
// of letting a Hindi voice read Telugu text -- it mispronounces badly enough to
// be worse than silence. So Telugu sentences come from here instead.
//
// In:  { text, lang }
// Out: audio/mpeg bytes
//
// Cost control: short inputs only, and the extension caches by sentence so a
// repeated step or a press of Repeat costs nothing. Speech is charged by
// character, and Daari says the same dozen sentences over and over.

const guard = require('./_guard.js');

/* Speech is charged by the character, so this is the main cost lever here.
   Daari's sentences are one instruction long; 220 is generous for that. */
const MAX_TEXT = 220;

const MAX_BODY_BYTES = 4 * 1024;
/* Lower than the step endpoint: the extension caches by sentence, so a real
   session fetches a dozen distinct phrases, not hundreds. */
const MAX_PER_WINDOW = 40;

// Overridable, so the cheapest available voice model can be chosen without a
// code change.
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'tts-1';
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy';

const TIMEOUT_MS = 8000;

module.exports = async (req, res) => {
  guard.setCors(res);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  // Turned away before a single character is billed.
  const blocked = guard.check(req, {
    maxBytes: MAX_BODY_BYTES,
    maxPerWindow: MAX_PER_WINDOW
  });
  if (blocked) {
    res.status(blocked.status).json({ error: blocked.error });
    return;
  }

  // Validate the REQUEST before complaining about the SERVER. A malformed
  // request is a 400 whether or not a key happens to be configured, and
  // checking it first means a bad request can never reach anything billable.
  const body = req.body || {};
  const text = String(body.text || '').trim();

  if (!text) {
    res.status(400).json({ error: 'text is required.' });
    return;
  }
  if (text.length > MAX_TEXT) {
    res.status(400).json({ error: 'text must be at most ' + MAX_TEXT + ' characters.' });
    return;
  }

  // Read here and nowhere else. Never logged, never returned.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'This server has no OPENAI_API_KEY set. Daari will fall back to ' +
             'captions and a chime.'
    });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  try {
    const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: text,
        response_format: 'mp3',
        /* Left at normal speed on purpose.
           It was 0.85, for the same reason the browser voices run at 0.8 -- the
           listener may be hearing the instruction for the first time. But the
           Telugu output was unclear and seemed to skip words, and slowed
           synthesis is a plausible cause of exactly that. If Telugu speech is
           re-enabled, try it at this speed first before blaming the voice. */
        speed: Number(process.env.OPENAI_TTS_SPEED || 1)
      }),
      signal: controller.signal
    });

    if (!upstream.ok) {
      res.status(502).json({
        error: 'Speech service refused the request (status ' + upstream.status + ').'
      });
      return;
    }

    const audio = Buffer.from(await upstream.arrayBuffer());

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', String(audio.length));
    /* The same sentence always produces the same audio, so let the browser and
       any CDN in between keep it. */
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(audio);

  } catch (error) {
    const name = error ? error.name : 'unknown';
    res.status(name === 'AbortError' ? 504 : 502).json({
      error: name === 'AbortError'
        ? 'Speech took too long. Daari will show the caption instead.'
        : 'Could not reach the speech service (' + name + ').'
    });
  } finally {
    clearTimeout(timer);
  }
};
