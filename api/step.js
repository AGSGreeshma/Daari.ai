// Decide the next step.
//
// The only place in Daari that talks to OpenAI, because this runs on a server
// where the key can live. The extension never sees it.
//
// In:  { goal, lang, url, title, elements[], recipeStep?, history[] }
// Out: { elementIndex|null, speech, done_when, stopAndConfirm, confidence }
//
// WHAT NEVER ARRIVES HERE: anything the user typed. Each element carries only
// { i, tag, type, name, filled } -- a label, a kind, and whether the box has
// something in it. This file re-checks that and refuses the request outright if
// an unexpected field turns up, so a bug in the extension cannot leak a value
// through a server that was willing to forward it.

const guard = require('./_guard.js');

const ALLOWED_ELEMENT_FIELDS = ['i', 'tag', 'type', 'name', 'filled'];
const MAX_ELEMENTS = 60;
const MAX_NAME = 120;
const MAX_GOAL = 300;
const MAX_HISTORY = 8;

// Abuse guards. The extension caps itself at 25 calls a session, but that cap
// lives in the extension and this URL is open to the internet.
const MAX_BODY_BYTES = 24 * 1024;   // 60 elements of labels is a few KB
const MAX_PER_WINDOW = 60;          // per IP per 5 minutes -- a session needs 25

// Refuse an oversized list rather than quietly trimming it: a caller sending
// 500 elements is not Daari, and silently serving them teaches nobody anything.
const REFUSE_ABOVE_ELEMENTS = 80;

// The vocabulary the page can actually evaluate. Anything else is meaningless
// to Daari, so the model is held to this list.
const DONE_WHEN = ['url_changed', 'field_filled', 'value_changed', 'clicked',
                   'element_gone', 'text_appears'];

// Overridable so the cheapest available model can be chosen without a code
// change. Check your own usage dashboard -- a newer mini model may have
// superseded this one.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Answer before the extension's own 6s patience runs out, so it gets a real
// reply rather than a hang.
const UPSTREAM_TIMEOUT_MS = 5000;

function fail(res, status, message) {
  res.status(status).json({ error: message });
}

// ---------------------------------------------------------------- the prompt

const SYSTEM_PROMPT = [
  'You are Daari, a voice guide for first-time and elderly Indian users of websites.',
  'You are given a list of the things on a web page and what the user is trying to do.',
  'Your job: name the ONE element they should act on next, and write one short',
  'sentence telling them what to do with it.',
  '',
  'Hard rules:',
  '1. Never act for the user and never describe doing it for them. They do it',
  '   themselves. You point and speak.',
  '2. Write the sentence in the requested language, and ONLY that language.',
  '   Leave button names in Latin script exactly as they appear on screen,',
  '   because that is what the user is hunting for with their eyes.',
  '3. ONE action per sentence. As short as you can make it. Say "here" so the',
  '   sentence pairs with the highlight the user can see.',
  '4. You are never told what the user typed, only whether a box is filled.',
  '   Never ask them to read a value back, and never repeat one.',
  '5. For a one-time code, card number, password or PIN, say only that they',
  '   should type it themselves.',
  '6. YOU ARE CHOOSING ONE STEP IN AN ORDER, NOT FINISHING THE JOB.',
  '   This is the mistake to avoid above all others. The user is filling in a',
  '   form one box at a time, and you are asked once per step. Name the NEXT',
  '   thing to do, not the thing that completes the whole goal.',
  '   Concretely: do NOT pick the search, submit or continue button while boxes',
  '   that need filling are still empty. Each element below says whether it is',
  '   "filled" or "empty" - use that. Work top to bottom: the first empty box',
  '   that the goal needs is almost always the answer. The button comes last,',
  '   once the boxes are filled.',
  '   If "Already done" lists nothing, assume nothing has been done yet and the',
  '   user is at the very beginning.',
  '   BUT: if a known route names an element below, it OVERRIDES all of this',
  '   ordering -- see the route instructions in the next message.',
  '   Many sites pre-fill boxes with a default, so "filled" does not mean the',
  '   user has checked it or meant it. A box the route names is the next step',
  '   even when it already has something in it.',
  '7. FIRST, before choosing anything, answer goal_supported. It asks ONE thing:',
  '   is the user\'s goal the kind of thing THIS SITE is for?',
  '',
  '   It is NOT asking whether you can do it. You never do anything - you point,',
  '   and the user acts. It is NOT asking whether the action is safe, or',
  '   reversible, or involves money. Stopping before money is decided by separate',
  '   code and is not your decision to make.',
  '',
  '   Answer TRUE whenever something in the list below could plausibly be the',
  '   next step toward the goal - including when that thing pays, books, submits',
  '   or cancels. A page with a Pay button on it can be used to pay.',
  '',
  '   Answer FALSE only when this site is for something else entirely.',
  '',
  '   Get these right:',
  '     "pay for the ticket", on a page with a Pay button -> TRUE',
  '     "book a ticket", on a train search page            -> TRUE',
  '     "cancel my booking", on a page with a cancel link  -> TRUE',
  '     "pay my electricity bill", on a railway site       -> FALSE',
  '     "apply for a passport", on a railway site          -> FALSE',
  '',
  '   If it is false, set elementIndex to null too. Being unable to help here is',
  '   a normal, correct answer. But answering false when the page CAN do the job',
  '   leaves the user stranded in front of the very button they needed.',
  '8. confidence must be a real judgement, not a habit. Use the whole range.',
  '   Below 0.4 means you are guessing. Do not answer 0.9 out of politeness.',
  '9. stopAndConfirm: true ONLY for money, a final booking confirmation, or',
  '   cancelling something already booked.',
  '   NEVER for typing in a box, searching, choosing from a dropdown, or moving',
  '   to the next page. Those are not irreversible and a stop on them just',
  '   teaches the user to dismiss stops without reading them.',
  '',
  'done_when says how to tell the step is finished. Choose exactly one of:',
  '  url_changed    pressing it loads a different page',
  '  field_filled   it is a box they type into',
  '  value_changed  it is a dropdown that already has a value',
  '  clicked        they press it and the page stays',
  '  element_gone   it disappears once used',
  '  text_appears   something new becomes visible instead',
  '',
  'confidence is 0 to 1: how sure you are that this is the right element.'
].join('\n');

const RESPONSE_SCHEMA = {
  name: 'daari_step',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    /* goal_supported is FIRST on purpose: the model fills the fields in
       order, so it has to decide whether the page can do the job before it has
       committed to an element. Asking afterwards gets a rationalisation. */
    required: ['goal_supported', 'hint_ok', 'elementIndex', 'speech', 'done_when',
               'stopAndConfirm', 'confidence'],
    properties: {
      goal_supported: { type: 'boolean' },
      hint_ok: { type: 'boolean' },
      elementIndex: { type: ['integer', 'null'] },
      speech: { type: 'string' },
      done_when: { type: 'string', enum: DONE_WHEN },
      stopAndConfirm: { type: 'boolean' },
      confidence: { type: 'number' }
    }
  }
};

const LANGUAGE_NAMES = { te: 'Telugu', hi: 'Hindi', en: 'Indian English' };

function buildUserPrompt(body) {
  const lines = [];
  lines.push('The user wants to: ' + (body.goal || '(not stated)'));
  lines.push('Write the sentence in: ' + LANGUAGE_NAMES[body.lang]);
  lines.push('Page address: ' + body.url);
  lines.push('Page title: ' + body.title);

  if (body.history.length) {
    lines.push('');
    lines.push('Already done: ' + body.history.slice(-MAX_HISTORY).join('; '));
  }

  if (body.recipeStep) {
    lines.push('');
    var hinted = body.recipeStep.expectedElementIndex;
    if (typeof hinted === 'number' && hinted >= 0) {
      var hintedElement = body.elements.filter(function (e) { return e.i === hinted; })[0];
      lines.push('THE ELEMENT IS ALREADY DECIDED FOR THIS STEP.');
      lines.push('A known route through this site says the next thing to do is');
      lines.push('index ' + hinted + ': "' + (hintedElement ? hintedElement.name : '?') + '".');
      lines.push('');
      lines.push('So you are NOT searching. Do this instead:');
      lines.push('  - set elementIndex to ' + hinted);
      lines.push('  - set hint_ok true');
      lines.push('  - write the sentence for THAT element, in the language asked for');
      lines.push('');
      lines.push('Set hint_ok FALSE only if index ' + hinted + ' is plainly wrong for');
      lines.push('this step -- not merely because you would have chosen a different');
      lines.push('one, and not because the box already has something in it. Many');
      lines.push('sites pre-fill boxes with a default, and a pre-filled box the route');
      lines.push('names is still the next step.');
    } else {
      lines.push('A known route expects an element labelled one of: ' +
                 (body.recipeStep.look_for || []).join(', '));
      lines.push('Nothing below matched it, so choose the closest thing yourself');
      lines.push('and set hint_ok true.');
    }
    if (body.recipeStep.sensitive) {
      lines.push('This step is a code or card number: tell them to type it themselves.');
    }
  }

  lines.push('');
  lines.push('Things on the page (index | tag | type | label | filled):');
  body.elements.forEach(function (el) {
    lines.push([el.i, el.tag, el.type || '-', el.name || '(no label)',
                el.filled ? 'filled' : 'empty'].join(' | '));
  });

  return lines.join('\n');
}

// ------------------------------------------------------------------ validate

// Keep only the five allowed fields, and report anything else that turned up.
function cleanElements(raw) {
  const forbidden = new Set();
  const cleaned = [];

  for (const element of raw.slice(0, MAX_ELEMENTS)) {
    if (!element || typeof element !== 'object') { continue; }
    for (const key of Object.keys(element)) {
      if (!ALLOWED_ELEMENT_FIELDS.includes(key)) { forbidden.add(key); }
    }
    cleaned.push({
      i: Number(element.i),
      tag: String(element.tag || '').slice(0, 20),
      type: String(element.type || '').slice(0, 20),
      name: String(element.name || '').slice(0, MAX_NAME),
      filled: element.filled === true
    });
  }

  return { cleaned: cleaned, forbidden: [...forbidden] };
}

// --------------------------------------------------------------------- OpenAI

async function askOpenAI(apiKey, userPrompt, useSchema) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, UPSTREAM_TIMEOUT_MS);

  const payload = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2,
    /* One short sentence plus four small fields. 150 is comfortable for that
       and puts a hard ceiling on what any single call can cost. */
    max_tokens: 150,
    response_format: useSchema
      ? { type: 'json_schema', json_schema: RESPONSE_SCHEMA }
      : { type: 'json_object' }
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    return { status: response.status, text: text };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- the handler

module.exports = async (req, res) => {
  guard.setCors(res);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { return fail(res, 405, 'Use POST.'); }

  // Turned away before a single token is spent: wrong client, oversized body,
  // or too many requests from one address.
  const blocked = guard.check(req, {
    maxBytes: MAX_BODY_BYTES,
    maxPerWindow: MAX_PER_WINDOW
  });
  if (blocked) { return fail(res, blocked.status, blocked.error); }

  // Validate the REQUEST before complaining about the SERVER. A malformed
  // request is a 400 whether or not a key happens to be configured, and
  // checking it first means a bad request can never reach anything billable.
  const body = req.body || {};

  if (typeof body.goal !== 'string' || body.goal.length > MAX_GOAL) {
    return fail(res, 400, 'goal must be a string of at most ' + MAX_GOAL + ' characters.');
  }
  if (['te', 'hi', 'en'].indexOf(body.lang) === -1) {
    return fail(res, 400, 'lang must be te, hi or en.');
  }
  if (!Array.isArray(body.elements) || body.elements.length === 0) {
    return fail(res, 400, 'elements must be a non-empty array.');
  }
  if (body.elements.length > REFUSE_ABOVE_ELEMENTS) {
    return fail(res, 400,
      'elements must be at most ' + REFUSE_ABOVE_ELEMENTS + ' long. Daari sends ' +
      MAX_ELEMENTS + ' at most.');
  }

  const checked = cleanElements(body.elements);

  // Rule 2, enforced on the server as well as in the extension. If a value ever
  // reaches this far the right answer is to refuse, not to quietly drop it -- a
  // silent strip would hide the bug that let it happen.
  if (checked.forbidden.length) {
    return fail(res, 400,
      'Refused: elements carried unexpected fields (' + checked.forbidden.join(', ') +
      '). Only i, tag, type, name and filled may be sent.');
  }
  if (!checked.cleaned.length) {
    return fail(res, 400, 'No usable elements after validation.');
  }

  // The key is read here and nowhere else. It is never logged, never returned,
  // and never put into an error message.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fail(res, 500,
      'This server has no OPENAI_API_KEY set. Add it in the Vercel project ' +
      'settings, or in a local .env for vercel dev, then redeploy.');
  }

  const prompt = buildUserPrompt({
    goal: body.goal,
    lang: body.lang,
    url: String(body.url || '').slice(0, 300),
    title: String(body.title || '').slice(0, 200),
    history: Array.isArray(body.history) ? body.history.map(String) : [],
    recipeStep: body.recipeStep || null,
    elements: checked.cleaned
  });

  let result;
  try {
    result = await askOpenAI(apiKey, prompt, true);

    // Not every model supports json_schema. One retry in the simpler mode
    // rather than losing the whole step.
    if (result.status === 400 && /response_format|json_schema/i.test(result.text)) {
      result = await askOpenAI(apiKey, prompt, false);
    }
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return fail(res, 504, 'The model took too long. Daari will use its own route instead.');
    }
    return fail(res, 502, 'Could not reach the model (' + (error ? error.name : 'unknown') + ').');
  }

  if (result.status !== 200) {
    // Pass the status through, never the raw upstream body, which can echo back
    // parts of the request.
    return fail(res, 502, 'The model refused the request (status ' + result.status + ').');
  }

  let answer;
  try {
    const envelope = JSON.parse(result.text);
    answer = JSON.parse(envelope.choices[0].message.content);
  } catch (e) {
    return fail(res, 502, 'The model did not return usable JSON.');
  }

  // Only ever hand back an index that actually exists in what we were given.
  const index = answer.elementIndex;
  const realIndex = checked.cleaned.some(function (el) { return el.i === index; });

  /* Default to true only when the field is genuinely absent (an older model in
     json_object mode). An explicit false is always honoured. */
  const achievable = answer.goal_supported !== false;
  const hintOk = answer.hint_ok !== false;

  res.status(200).json({
    goal_supported: achievable,
    hint_ok: hintOk,
    elementIndex: achievable && realIndex ? index : null,
    speech: String(answer.speech || '').slice(0, 300),
    done_when: DONE_WHEN.indexOf(answer.done_when) !== -1 ? answer.done_when : 'clicked',
    stopAndConfirm: answer.stopAndConfirm === true,
    confidence: Math.max(0, Math.min(1, Number(answer.confidence) || 0)),
    model: MODEL
  });
};
