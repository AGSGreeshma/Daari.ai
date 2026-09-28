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

const MAX_TEXT = 300;

// Overridable, so the cheapest available voice model can be chosen without a
// code change.
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'tts-1';
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy';

const TIMEOUT_MS = 8000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Use POST.' });
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
        /* Slowly. Same reason the browser voices run at 0.8: the listener may
           be hearing this instruction for the first time. */
        speed: 0.85
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
