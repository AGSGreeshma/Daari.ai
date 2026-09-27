# extension/

The Chrome extension itself (Manifest V3, plain JavaScript, no build step).

- `manifest.json` — permissions and entry points.
- `config.js` — which API URL to talk to. The only file you edit when you redeploy.
- `popup.html` / `popup.js` — the small window that opens when you click the Daari icon.
- `content/` — code that runs *inside* the web page being guided (see its own README).

Later phases add `background.js` (the brain, holds the session) and the voice
surface (microphone and speech). Nothing here ever contains the OpenAI key.
