/* Load the real side panel with a fake browser, and click its buttons.
 *
 * The lint next door catches a call to a function that does not exist. This
 * catches everything else that can make a button do nothing: a handler attached
 * to the wrong element, a message with the wrong type, a guard that returns
 * early, a typo in an id.
 *
 * It is the test that would have caught the bug that prompted it. "Yes, go" and
 * "Start demo on this page" both threw a ReferenceError and did nothing, on the
 * practice site and on IRCTC, and nothing in the suite noticed -- because
 * everything in the suite tested the worker, the page, or pure functions, and
 * nobody had ever pressed a button.
 *
 * The fakes are deliberately thin: just enough DOM for sidepanel.js to run, and a
 * chrome that records what it was asked to do. If the panel starts needing more
 * of a browser than this, that is worth knowing too.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'extension');

function makeElement(id) {
  const listeners = {};
  const el = {
    id: id,
    tagName: 'DIV',
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    placeholder: '',
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    _attrs: {},
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener: (name, fn) => {
      listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
    },
    appendChild: (child) => { el.children.push(child); return child; },
    setAttribute: (k, v) => { el._attrs[k] = v; },
    getAttribute: (k) => (k in el._attrs ? el._attrs[k] : null),
    hasAttribute: (k) => k in el._attrs,
    querySelectorAll: () => el.children.filter((c) => c && c.className === 'lang'),
    focus: () => {},
    getBoundingClientRect: () => ({ width: 100, height: 20, top: 0, left: 0 }),
    // test helper
    _fire: (name, event) => {
      const fns = listeners[name] || [];
      if (!fns.length) { throw new Error('nothing listening for "' + name + '" on #' + id); }
      fns.slice().forEach((fn) => fn(event || {}));
    },
    _listens: (name) => (listeners[name] || []).length > 0
  };
  return el;
}

/* Load the panel, and hand back the fakes so a test can poke at them. */
function loadPanel(options) {
  const opts = options || {};
  const elements = {};
  const sent = [];          /* chrome.runtime.sendMessage */
  const toTab = [];         /* chrome.tabs.sendMessage */
  const created = [];       /* chrome.tabs.create */
  const stored = { lang: opts.lang || 'en' };
  const timers = [];

  const document = {
    documentElement: { setAttribute: () => {} },
    getElementById: (id) => {
      if (!elements[id]) { elements[id] = makeElement(id); }
      return elements[id];
    },
    createElement: (tag) => makeElement('created-' + tag),
    addEventListener: () => {},
    querySelector: () => null
  };

  const chrome = {
    runtime: {
      getURL: (p) => 'chrome-extension://fake/' + p,
      sendMessage: (message) => {
        sent.push(message);
        const reply = opts.replies && opts.replies[message.type];
        return Promise.resolve(reply === undefined ? { ok: true } : reply);
      },
      onMessage: { addListener: (fn) => { chrome.__onMessage = fn; } }
    },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: opts.tabUrl || 'https://daari-ai.vercel.app/practice/' }]),
      sendMessage: (id, message) => { toTab.push({ id: id, message: message }); return Promise.resolve({ ok: true }); },
      create: (o) => { created.push(o); }
    },
    storage: {
      local: {
        get: (defaults) => {
          const out = {};
          Object.keys(defaults || {}).forEach((k) => {
            out[k] = k in stored ? stored[k] : defaults[k];
          });
          return Promise.resolve(out);
        },
        set: (o) => { Object.assign(stored, o); return Promise.resolve(); }
      },
      onChanged: { addListener: () => {} }
    }
  };

  const windowStub = {
    speechSynthesis: {
      getVoices: () => (opts.voices || []),
      speak: () => {},
      cancel: () => {},
      onvoiceschanged: null
    },
    SpeechRecognition: function () {
      this.start = () => { if (opts.recogniserThrows) { throw new Error('boom'); } };
      this.stop = () => {};
      this.abort = () => {};
    },
    setTimeout: (fn, ms) => { timers.push({ fn: fn, ms: ms }); return timers.length; },
    clearTimeout: () => {},
    AudioContext: function () {
      this.state = 'running';
      this.currentTime = 0;
      this.resume = () => {};
      this.createOscillator = () => ({
        type: '', frequency: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
        connect: () => {}, start: () => {}, stop: () => {}
      });
      this.createGain = () => ({
        gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
        connect: () => {}
      });
      this.destination = {};
    }
  };

  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    document: document,
    chrome: chrome,
    navigator: { permissions: { query: () => Promise.resolve({ state: 'granted' }) } },
    fetch: () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    setTimeout: windowStub.setTimeout,
    clearTimeout: windowStub.clearTimeout,
    URL: URL, Promise: Promise, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, Math: Math, Date: Date, RegExp: RegExp,
    Error: Error, Map: Map, Set: Set, Boolean: Boolean,
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    Audio: function () { this.play = () => Promise.resolve(); this.pause = () => {}; }
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  Object.assign(sandbox, windowStub);
  sandbox.window.speechSynthesis = windowStub.speechSynthesis;

  vm.createContext(sandbox);

  /* The real files, in the order sidepanel.html loads them. */
  ['config.js', 'strings.js', 'tts.js', 'sidepanel.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(EXT, file), 'utf8'), sandbox, { filename: file });
  });

  return { el: elements, sent: sent, toTab: toTab, created: created, stored: stored,
           timers: timers, sandbox: sandbox, chrome: chrome };
}

module.exports = { loadPanel };
