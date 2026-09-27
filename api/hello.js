// Health check. Answers "yes, the API is alive and the extension can reach me".
//
// This is deliberately boring: no OpenAI key, no AI, nothing secret. Its only
// job is to prove the whole pipe works end to end -- extension -> internet ->
// Vercel -> back again -- before we build anything that depends on that pipe.
//
// Try it in a browser:  https://<your-project>.vercel.app/api/hello

module.exports = (req, res) => {
  // The extension lives at chrome-extension://<some id>, which counts as a
  // different website to the browser. Without these headers the browser
  // blocks our own extension from reading the reply. "*" means "anyone may
  // call this". Safe here because there is nothing private in the answer.
  // Phase 5 tightens this once real endpoints exist.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Browsers sometimes send a practice request called OPTIONS first, asking
  // "am I allowed?". Answer yes, with no body, and stop there.
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  res.status(200).json({
    ok: true,
    service: 'daari',
    time: new Date().toISOString()
  });
};
