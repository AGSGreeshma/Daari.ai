// Phase 0 popup: one button that asks the API "are you alive?".
//
// This exists to prove the extension can actually reach our server. If this
// works, every later phase can assume the pipe is good and debug elsewhere.

const button = document.getElementById('test');
const result = document.getElementById('result');
const urlLine = document.getElementById('url');

// Read the API address from config.js, and build the full address to call.
const apiBase = window.DAARI_CONFIG.API_BASE;
const helloUrl = apiBase + '/api/hello';

// Always show which address we are testing. Most "it doesn't work" moments
// are really "it tested the wrong URL".
urlLine.textContent = 'Testing: ' + helloUrl;

function show(isGood, message) {
  result.className = isGood ? 'good' : 'bad';
  result.textContent = message;
}

button.addEventListener('click', async () => {
  button.disabled = true;
  button.textContent = 'Checking...';
  show(true, 'Contacting the server...');

  try {
    const response = await fetch(helloUrl);

    // The server answered, but maybe with an error code like 404 or 500.
    if (!response.ok) {
      show(false,
        'The server answered, but with an error (' + response.status + ').\n\n' +
        'If this is 404, check that api/hello.js was deployed.');
      return;
    }

    const data = await response.json();

    if (data.ok === true) {
      show(true, 'ok: true\nservice: ' + data.service + '\n\nConnection works.');
    } else {
      // Reached the right place, but the answer was not what we expect.
      show(false, 'Unexpected answer:\n' + JSON.stringify(data, null, 2));
    }
  } catch (error) {
    // No answer at all: server not running, wrong URL, or no internet.
    show(false,
      'Could not reach the server.\n\n' +
      'Check that:\n' +
      '1. The URL above is correct (edit extension/config.js)\n' +
      '2. "vercel dev" is running, if testing locally\n' +
      '3. You reloaded the extension after editing config.js\n\n' +
      'Details: ' + error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Test connection';
  }
});
