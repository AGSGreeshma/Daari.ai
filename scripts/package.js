/* Zip extension/ into site/daari-extension.zip, which is what the landing page
 * hands people to install.
 *
 *   npm run package
 *
 * Uses PowerShell's built-in Compress-Archive rather than an npm package,
 * because CLAUDE.md says no build step and this needs no dependency at all.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension');
const OUT = path.join(ROOT, 'site', 'daari-extension.zip');

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

if (!fs.existsSync(SOURCE)) { fail('No extension/ folder found.'); }
if (!fs.existsSync(path.join(SOURCE, 'manifest.json'))) {
  fail('extension/manifest.json is missing. Chrome will refuse the ZIP.');
}

/* The key must never end up in a ZIP published on the web. config.js ships in
   the extension by design and holds only the API address, but check anyway --
   this is the one file that gets handed to strangers. */
const suspicious = [];
for (const file of fs.readdirSync(SOURCE)) {
  if (file === '.env' || file.startsWith('.env')) { suspicious.push(file); }
}
const configText = fs.readFileSync(path.join(SOURCE, 'config.js'), 'utf8');
if (/sk-[A-Za-z0-9]{10,}/.test(configText)) {
  fail('REFUSING TO PACKAGE: config.js appears to contain an API key.\n' +
       'The key belongs in Vercel environment variables, never in the extension.');
}
if (suspicious.length) {
  fail('REFUSING TO PACKAGE: extension/ contains ' + suspicious.join(', '));
}

fs.mkdirSync(path.join(ROOT, 'site'), { recursive: true });
if (fs.existsSync(OUT)) { fs.unlinkSync(OUT); }

/* -Force so a rebuild overwrites; the * keeps manifest.json at the root of the
   ZIP, which is what Chrome's Load unpacked expects after extraction. */
const command =
  '$ErrorActionPreference = "Stop"; ' +
  'Compress-Archive -Path "' + path.join(SOURCE, '*') + '" ' +
  '-DestinationPath "' + OUT + '" -Force';

try {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command],
    { stdio: 'inherit' });
} catch (error) {
  fail('Compress-Archive failed. Are you on Windows with PowerShell available?');
}

if (!fs.existsSync(OUT)) { fail('The ZIP was not created.'); }

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
const version = JSON.parse(fs.readFileSync(path.join(SOURCE, 'manifest.json'), 'utf8')).version;

console.log('\n  Packaged Daari ' + version + '  ->  site/daari-extension.zip  (' + kb + ' KB)');
console.log('  Deploy with "vercel --prod" to publish it on the landing page.\n');
