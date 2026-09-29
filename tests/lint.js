/* A dependency-free check for calls to functions that do not exist.
 *
 * This exists because that bug shipped three times.
 *
 *   resolveByName   renamed to DAARI_RESOLVE_BY_NAME, one caller left behind,
 *                   and every page Daari loaded on threw.
 *   acceptGoal      spliced out during the Phase B mic rewrite; the "Yes, go"
 *                   button threw and did nothing.
 *   startFlow       same splice; "Start demo on this page" threw and did nothing.
 *
 * Every one was invisible to `node --check`, which only parses. Every one would
 * have been caught by this file in under a second.
 *
 * WHY NOT ESLINT. It would do this better, and if this project had a build step
 * it would be the right answer. It does not: CLAUDE.md says no build step and the
 * extension has zero dependencies, so adding a hundred packages and an install
 * step that can fail is a worse trade than ninety lines that need nothing. The
 * scope here is narrow on purpose -- bare `name(...)` calls where `name` is never
 * declared anywhere the file can see.
 *
 * It is a lint, not a type checker. It will not catch a wrong argument or a
 * misspelled property. It catches exactly the class of bug that has actually
 * bitten, which is the class worth spending code on.
 */

const fs = require('fs');
const path = require('path');

const EXT = path.join(__dirname, '..', 'extension');

/* Globals the browser, the extension platform and JavaScript itself provide. */
const KNOWN_GLOBALS = new Set([
  // JavaScript
  'Array', 'Boolean', 'Date', 'Error', 'Function', 'JSON', 'Map', 'Math', 'Number',
  'Object', 'Promise', 'Proxy', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol',
  'WeakMap', 'WeakSet', 'BigInt', 'Intl', 'parseInt', 'parseFloat', 'isNaN',
  'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'eval', 'escape', 'unescape', 'structuredClone', 'queueMicrotask',
  // browser
  'window', 'self', 'document', 'console', 'location', 'navigator', 'fetch',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'alert', 'confirm', 'prompt', 'getComputedStyle',
  'MutationObserver', 'IntersectionObserver', 'ResizeObserver', 'CSSStyleSheet',
  'Audio', 'AudioContext', 'webkitAudioContext', 'Blob', 'File', 'FileReader',
  'FormData', 'Headers', 'Request', 'Response', 'URL', 'URLSearchParams',
  'AbortController', 'TextEncoder', 'TextDecoder', 'atob', 'btoa', 'Image',
  'SpeechSynthesisUtterance', 'SpeechRecognition', 'webkitSpeechRecognition',
  'speechSynthesis', 'Event', 'CustomEvent', 'Node', 'Element', 'HTMLElement',
  'importScripts', 'clients', 'caches', 'indexedDB', 'crypto', 'performance',
  // the extension platform
  'chrome', 'browser',
  // CommonJS, for the api/ and scripts/ files if they are ever checked here
  'require', 'module', 'exports', '__dirname', '__filename', 'process', 'Buffer'
]);

/* Words that are followed by "(" but are not calls. */
const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof',
  'function', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'case', 'throw',
  'await', 'yield', 'with', 'super', 'this', 'class', 'extends', 'let', 'const',
  'var', 'try', 'finally', 'break', 'continue', 'default', 'export', 'import',
  'async', 'get', 'set', 'static'
]);

/* Strings and comments are stripped first, so a function name mentioned in prose
   is not mistaken for a call. That matters: these files carry a lot of prose. */
function stripStringsAndComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const two = source.slice(i, i + 2);

    if (two === '//') {
      while (i < n && source[i] !== '\n') { i++; }
      continue;
    }
    if (two === '/*') {
      i += 2;
      while (i < n && source.slice(i, i + 2) !== '*/') { i++; }
      i += 2;
      continue;
    }
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        /* Inside a template literal, ${...} is real code and must be kept. */
        if (quote === '`' && source.slice(i, i + 2) === '${') {
          let depth = 1;
          i += 2;
          const from = i;
          while (i < n && depth > 0) {
            if (source[i] === '{') { depth++; }
            if (source[i] === '}') { depth--; }
            i++;
          }
          out += ' ' + source.slice(from, i - 1) + ' ';
          continue;
        }
        i++;
      }
      out += ' ';
      continue;
    }

    /* A regex literal would confuse the scan, and its contents are never calls.
       Detected by what can legally precede one. */
    if (ch === '/') {
      const before = out.replace(/\s+$/, '').slice(-1);
      if (before === '' || '(,=:[!&|?{};+-*%<>~^'.indexOf(before) !== -1) {
        i++;
        while (i < n && source[i] !== '/') {
          if (source[i] === '\\') { i++; }
          if (source[i] === '\n') { break; }
          i++;
        }
        i++;
        out += ' ';
        continue;
      }
    }

    out += ch;
    i++;
  }
  return out;
}

/* Everything this file, or a file loaded beside it, could legally provide. */
function declaredNames(code) {
  const names = new Set();
  const add = (m) => { if (m) { names.add(m); } };

  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) { add(m[1]); }
  for (const m of code.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) { add(m[1]); }
  /* const { a, b } = ... */
  for (const m of code.matchAll(/\b(?:var|let|const)\s*\{([^}]*)\}/g)) {
    m[1].split(',').forEach((part) => add((part.split(':').pop() || '').trim()));
  }
  /* class Foo */
  for (const m of code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) { add(m[1]); }
  /* parameters, of any function-ish thing */
  for (const m of code.matchAll(/(?:function\s*\*?\s*[\w$]*\s*|catch\s*)\(([^)]*)\)/g)) {
    m[1].split(',').forEach((part) => add(part.trim().replace(/[=].*$/, '').trim()));
  }
  /* arrow parameters: (a, b) => and a => */
  for (const m of code.matchAll(/\(([^)(]*)\)\s*=>/g)) {
    m[1].split(',').forEach((part) => add(part.trim().replace(/[=].*$/, '').trim()));
  }
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) { add(m[1]); }
  /* self.NAME = ... and window.NAME = ..., which is how these files share */
  for (const m of code.matchAll(/\b(?:self|window|globalThis)\s*\.\s*([A-Za-z_$][\w$]*)\s*=/g)) {
    add(m[1]);
  }
  /* labels and object keys that look like calls are handled by the caller scan */
  return names;
}

/* Bare identifier calls: name( , not .name( and not obj?.name( */
function calledNames(code) {
  const found = new Map();
  const lines = code.split('\n');
  lines.forEach((line, index) => {
    for (const m of line.matchAll(/(^|[^.\w$?])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const name = m[2];
      if (KEYWORDS.has(name)) { continue; }
      if (!found.has(name)) { found.set(name, index + 1); }
    }
  });
  return found;
}

function run() {
  /* Files that share a global scope can see each other's declarations, so they
     are checked as groups rather than in isolation. Matches how the manifest
     loads them. */
  const GROUPS = [
    { name: 'content script', files: ['strings.js', 'safety.js', 'matching.js', 'content/overlay.js'] },
    { name: 'service worker', files: ['config.js', 'strings.js', 'safety.js', 'matching.js', 'background.js'] },
    { name: 'side panel', files: ['config.js', 'strings.js', 'tts.js', 'sidepanel.js'] },
    { name: 'popup', files: ['config.js', 'popup.js'] },
    { name: 'permission page', files: ['permission.js'] }
  ];

  let problems = 0;

  for (const group of GROUPS) {
    const stripped = group.files.map((f) => ({
      file: f,
      code: stripStringsAndComments(fs.readFileSync(path.join(EXT, f), 'utf8'))
    }));

    /* Everything the whole group declares between them. */
    const available = new Set(KNOWN_GLOBALS);
    stripped.forEach((one) => {
      declaredNames(one.code).forEach((n) => available.add(n));
    });

    for (const one of stripped) {
      for (const [name, line] of calledNames(one.code)) {
        if (available.has(name)) { continue; }
        console.log('  UNDEFINED  ' + one.file + ':' + line + '  ' + name + '()' +
                    '   [' + group.name + ']');
        problems += 1;
      }
    }
  }

  return problems;
}

module.exports = { run };
