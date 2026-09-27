# api/

Vercel serverless functions. This is the ONLY place the OpenAI key is used,
because code here runs on a server, not in the user's browser.

- `hello.js` — health check. Returns `{ ok: true }`. No key needed.

Later phases add `step.js` (decides the next step) and `tts.js` (Telugu
speech). The key is read from `process.env.OPENAI_API_KEY`, which is set in
the Vercel dashboard for production and in a local `.env` file for `vercel dev`.
