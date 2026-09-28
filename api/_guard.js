// Shared abuse guards for the public endpoints.
//
// The extension caps itself at 25 AI calls per session, but that cap lives in
// the extension -- and these URLs are open to the whole internet. Anyone who
// finds them could run up the five dollar budget in a minute. These are the
// guards on the server side, where they cannot be edited away.
//
// The filename starts with an underscore so Vercel treats it as a helper rather
// than as a route of its own.
//
// None of this is real security. It is a locked screen door: it stops casual
// traffic and accidents, not somebody who actually wants in. The thing that
// genuinely protects the money is the hard spending limit set in the OpenAI
// dashboard.

// ---------------------------------------------------------------- rate limits
//
// In memory, deliberately. Vercel may run several instances, so each keeps its
// own count and the real limit is higher than the number below. That is an
// acceptable trade for needing no database on a free tier -- the limit only has
// to be low enough to stop a script, not to be exact.

const WINDOW_MS = 5 * 60 * 1000;
const hits = new Map();   // ip -> array of timestamps

function tooManyFrom(ip, maxInWindow) {
  const now = Date.now();
  const since = now - WINDOW_MS;

  // Prune while we are here, or this Map grows forever on a warm instance.
  for (const [key, times] of hits) {
    const kept = times.filter((t) => t > since);
    if (kept.length) { hits.set(key, kept); } else { hits.delete(key); }
  }

  const mine = hits.get(ip) || [];
  if (mine.length >= maxInWindow) { return true; }

  mine.push(now);
  hits.set(ip, mine);
  return false;
}

function callerIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || 'unknown';
}

// ------------------------------------------------------------------ the guard

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // The client header has to be allowed here or the browser's preflight will
  // refuse to send it.
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Daari-Client');
}

// Returns null when the request may proceed, or { status, error } when it may
// not. The caller sends that straight back.
function check(req, options) {
  const maxBytes = options.maxBytes;
  const maxPerWindow = options.maxPerWindow;

  // 1. Is this Daari at all?
  //
  // Not a secret -- it ships in config.js where anyone can read it. It only
  // turns away traffic that never meant to be here: a crawler, a copied URL, a
  // script written without looking.
  const client = req.headers['x-daari-client'];
  if (typeof client !== 'string' || client.indexOf('daari/') !== 0) {
    return {
      status: 403,
      error: 'This endpoint only serves the Daari extension.'
    };
  }

  // 2. Is the body a sensible size?
  //
  // Checked from the header first, because that is known before anything is
  // parsed, then again from what actually arrived in case the header lied.
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxBytes) {
    return { status: 413, error: 'Request too large.' };
  }
  let actual = 0;
  try { actual = JSON.stringify(req.body || {}).length; } catch (e) { actual = maxBytes + 1; }
  if (actual > maxBytes) {
    return { status: 413, error: 'Request too large.' };
  }

  // 3. Has this address had enough for now?
  if (tooManyFrom(callerIp(req), maxPerWindow)) {
    return {
      status: 429,
      error: 'Too many requests. Please wait a few minutes and try again.'
    };
  }

  return null;
}

module.exports = { check, setCors, WINDOW_MS };
