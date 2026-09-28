// One-time microphone grant.
//
// Why this page exists: Chrome ties microphone permission to an ORIGIN. If we
// asked for the mic from inside each website, an elderly user would face a
// permission prompt on every single site. Asking here instead means the
// permission belongs to Daari itself (the chrome-extension:// origin) and is
// granted exactly once.
//
// It runs in a normal tab rather than in the side panel, because an extension
// panel does not reliably get to show Chrome's own permission prompt.

const askBtn = document.getElementById('ask');
const box = document.getElementById('box');

function show(kind, title, detail) {
  box.className = 'box ' + kind;
  box.textContent = '';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const para = document.createElement('p');
  para.textContent = detail;
  box.appendChild(heading);
  box.appendChild(para);
  box.style.display = 'block';
}

askBtn.addEventListener('click', async () => {
  askBtn.disabled = true;
  askBtn.textContent = 'Waiting for your answer...';

  try {
    // This is what makes Chrome show the prompt. We want the permission, not
    // the audio, so the microphone is released again immediately.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());

    await chrome.storage.local.set({ micGranted: true });

    show('good', 'Microphone allowed',
      'Daari can now listen. You will not be asked again, on any website. ' +
      'Close this tab and go back to the Daari panel.');
    askBtn.style.display = 'none';

  } catch (error) {
    const name = error ? error.name : 'unknown';
    let detail;

    if (name === 'NotAllowedError') {
      detail = 'You chose Block, or Chrome blocked it. To change your mind: click the padlock ' +
               'icon in the address bar of this tab, set Microphone to Allow, then reload this ' +
               'page. Or skip it entirely and type your goal in the Daari panel instead.';
    } else if (name === 'NotFoundError') {
      detail = 'Chrome could not find a microphone on this computer. Check that one is plugged ' +
               'in and enabled in Windows sound settings. You can still use Daari by typing.';
    } else {
      detail = 'Something went wrong (' + name + '). You can still use Daari by typing your ' +
               'goal in the panel instead.';
    }

    show('bad', 'Microphone not allowed', detail);
    askBtn.disabled = false;
    askBtn.textContent = 'Try again';
  }
});
