// Daari popup.
//
// Three buttons:
//   Open Daari panel      - the real surface: language, microphone, demo
//   Show what Daari sees  - prints the serialized page, to prove no values leak
//   Test connection       - asks the API if it is alive (Phase 0)
//
// Starting the demo moved into the side panel in Phase 3, because the panel is
// where the language is chosen and where the speaking happens.
//
// The popup is only a remote control. All the real work happens in the
// content script inside the page, which is why every button here just sends
// a message and reports what came back.

const openPanelBtn = document.getElementById('openPanel');
const debugBtn = document.getElementById('debug');
const testBtn = document.getElementById('test');
const result = document.getElementById('result');
const urlLine = document.getElementById('url');

// Read the API address from config.js, and build the full address to call.
const apiBase = window.DAARI_CONFIG.API_BASE;
const helloUrl = apiBase + '/api/hello';

// Always show which address we are testing. Most "it doesn't work" moments
// are really "it tested the wrong URL".
urlLine.textContent = 'API: ' + helloUrl;

function show(kind, message) {
  result.className = kind;
  result.textContent = message;
}

// Which tab is the user looking at?
async function currentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

// Send a message to the overlay running inside the page.
//
// This throws if there is no content script to talk to -- on a chrome://
// page, the Chrome Web Store, or a tab that was already open before the
// extension was installed or reloaded. That last one catches everybody at
// least once, so it gets its own explanation.
async function sendToPage(message) {
  const tab = await currentTab();
  if (!tab) { throw new Error('No active tab.'); }

  if (/^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url || '')) {
    throw new Error(
      'Daari cannot run on this kind of page.\n\n' +
      'Chrome blocks extensions on its own pages. Open a normal website, ' +
      'such as the practice site, and try again.');
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    throw new Error(
      'Daari is not running in this page yet.\n\n' +
      'Reload the page (F5) and try again. A tab that was already open when ' +
      'the extension was installed or reloaded does not have Daari in it ' +
      'until the page is reloaded.');
  }
}

// ----------------------------------------------------------- Open the panel
openPanelBtn.addEventListener('click', async () => {
  openPanelBtn.disabled = true;
  try {
    const tab = await currentTab();
    // Opening the panel needs a real user gesture, which this click is.
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close(); // get the popup out of the way
  } catch (e) {
    show('bad',
      'Could not open the Daari panel.\n\n' +
      'If your Chrome is older than version 116 it has no side panel. ' +
      'Details: ' + e.message);
  } finally {
    openPanelBtn.disabled = false;
  }
});

// ------------------------------------------------------ Show what Daari sees
debugBtn.addEventListener('click', async () => {
  debugBtn.disabled = true;
  try {
    const reply = await sendToPage({ type: 'DAARI_DEBUG_SERIALIZE' });
    if (reply && reply.ok) {
      // The full table goes to the PAGE's console. Here we show the summary,
      // plus the list of keys -- which is the safety proof: if "value" ever
      // appeared in the payload, it would show up in this line.
      show('info',
        reply.count + ' elements seen\n' +
        reply.filledCount + ' of them already filled in\n' +
        reply.namelessCount + ' with no name at all\n\n' +
        'Fields sent per element:\n' + reply.keys.join(', ') + '\n\n' +
        (reply.keys.includes('value')
          ? 'WARNING: a value field is present. This is a bug.'
          : 'No value field. Nothing you typed is included.') + '\n\n' +
        'The full table is in the page console: press F12 on the web page ' +
        '(not on this popup) and open the Console tab.');
    } else {
      show('bad', 'The page did not answer.');
    }
  } catch (e) {
    show('bad', e.message);
  } finally {
    debugBtn.disabled = false;
  }
});

// ----------------------------------------------------------- Test connection
testBtn.addEventListener('click', async () => {
  testBtn.disabled = true;
  testBtn.textContent = 'Checking...';
  show('info', 'Contacting the server...');

  try {
    const response = await fetch(helloUrl);

    // The server answered, but maybe with an error code like 404 or 500.
    if (!response.ok) {
      show('bad',
        'The server answered, but with an error (' + response.status + ').\n\n' +
        'If this is 404, check that api/hello.js was deployed.');
      return;
    }

    const data = await response.json();

    if (data.ok === true) {
      show('good', 'ok: true\nservice: ' + data.service + '\n\nConnection works.');
    } else {
      // Reached the right place, but the answer was not what we expect.
      show('bad', 'Unexpected answer:\n' + JSON.stringify(data, null, 2));
    }
  } catch (error) {
    // No answer at all: server not running, wrong URL, or no internet.
    show('bad',
      'Could not reach the server.\n\n' +
      'Check that:\n' +
      '1. The URL above is correct (edit extension/config.js)\n' +
      '2. "vercel dev" is running, if testing locally\n' +
      '3. You reloaded the extension after editing config.js\n\n' +
      'Details: ' + error.message);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = 'Test connection';
  }
});
