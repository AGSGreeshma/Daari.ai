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
  API_BASE: "https://daari-ai.vercel.app",  // <-- EDIT THIS ONE LINE

  // Sent as the X-Daari-Client header. The API turns away anything without it.
  //
  // This is NOT a secret and is not pretending to be one -- it ships inside the
  // extension where anyone can read it. It is a locked screen door: it stops a
  // crawler or a copied URL from spending the budget. The thing that actually
  // protects the money is the hard spending limit in the OpenAI dashboard.
  CLIENT: "daari/0.5"
};
