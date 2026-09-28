// Which API to talk to. This is the ONLY file you edit when you redeploy.
//
// While testing locally with "vercel dev":
//     API_BASE: "http://localhost:3000"
//
// After running "vercel --prod", use the URL it printed:
//     API_BASE: "https://daari-something.vercel.app"
//
// No trailing slash. No API key here, ever -- this file ships inside the
// extension, so anyone who installs Daari can read it.

self.DAARI_CONFIG = {
  API_BASE: "https://daari-ai.vercel.app"  // <-- EDIT THIS ONE LINE
};
