/**
 * Conservative i18n migration for the legacy UI.
 *
 * It only replaces a literal when an exact, complete Arabic phrase already
 * has a bilingual entry in i18n.js.  This is deliberate: inventing an English
 * value from individual Arabic words would create the mixed UI this migration
 * is intended to eliminate.  Unmatched phrases are emitted to a review file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const uiRoots = [
  'public/js/components',
  'public/js/engines',
  'public/js/app.js',
  'public/js/auth.js',
  'index.html',
];
const i18nPath = path.join(root, 'public/js/i18n.js');
const arabic = /[\u0600-\u06FF]/;
const uiLine = /(?:innerHTML|textContent|placeholder|title=|aria-label|toast\.|showConfirmDialog|createModal|<(?:h\d|p|th|td|button|label|option|span|div)\b)/;

function walk(relative) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(path.join(relative, entry.name)) : [path.join(full, entry.name)],
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keyFor(ar, translations) {
  const candidates = Object.keys(translations.ar)
    .filter((key) => translations.ar[key] === ar && typeof translations.en[key] === 'string' && !arabic.test(translations.en[key]));
  return candidates.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

function addTImport(source, file) {
  if (/import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*i18n\.js['"]/.test(source)) return source;
  const i18nImport = file.endsWith('index.html') ? null : `import { t } from '${file.includes(`${path.sep}components${path.sep}`) ? '../' : './'}i18n.js';\n`;
  if (!i18nImport) return source;
  const imports = [...source.matchAll(/^import[\s\S]*?;\r?\n/gm)];
  if (imports.length) {
    const last = imports.at(-1);
    return `${source.slice(0, last.index + last[0].length)}${i18nImport}${source.slice(last.index + last[0].length)}`;
  }
  return `${i18nImport}${source}`;
}

function replaceKnownPhrases(source, phraseMap, unresolved) {
  let changed = false;
  const phrases = [...phraseMap.keys()].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    if (!source.includes(phrase)) continue;
    const key = phraseMap.get(phrase);
    const escaped = escapeRegExp(phrase);
    const before = source;

    // Plain toast and dialog values are JavaScript expressions, not HTML.
    source = source.replace(new RegExp(`(toast\\.(?:success|error|warning|info)\\()(['"])${escaped}\\2`, 'g'), `$1t('${key}')`);
    source = source.replace(new RegExp(`((?:title|confirmText|cancelText)\\s*:\\s*)(['"])${escaped}\\2`, 'g'), `$1t('${key}')`);
    source = source.replace(new RegExp(`(>\\s*)${escaped}(\\s*<)`, 'g'), `$1\${t('${key}')}$2`);
    source = source.replace(new RegExp(`((?:placeholder|title|aria-label)=(['"]))${escaped}\\2`, 'g'), `$1\${t('${key}')}`);
    source = source.replace(new RegExp(`(textContent\\s*=\\s*)(['"])${escaped}\\2`, 'g'), `$1t('${key}')`);
    if (source !== before) changed = true;
  }

  // Capture audit-visible Arabic literals still present so a human can add a
  // complete semantic phrase to i18n.js; they are never auto-translated.
  source.split(/\r?\n/).forEach((line) => {
    if (uiLine.test(line) && arabic.test(line) && !line.includes('i18n-ignore')) unresolved.add(line.trim());
  });
  return { source, changed };
}

async function loadTranslations() {
  globalThis.localStorage = { getItem: () => 'ar', setItem: () => {} };
  globalThis.document = { documentElement: {}, body: { classList: { toggle: () => {} } } };
  const module = await import(`${pathToFileURL(i18nPath).href}?migration=${Date.now()}`);
  return module.translations;
}

const backupDir = path.join(root, '.i18n-backups', new Date().toISOString().replace(/[:.]/g, '-'));
const files = uiRoots.flatMap(walk).filter((file) => /\.(?:js|html)$/.test(file) && file !== i18nPath);
fs.mkdirSync(backupDir, { recursive: true });
for (const file of [...files, i18nPath]) {
  const destination = path.join(backupDir, path.relative(root, file));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
}

const translations = await loadTranslations();
const phraseMap = new Map();
for (const [key, ar] of Object.entries(translations.ar)) {
  if (typeof ar === 'string' && ar.trim() && typeof translations.en[key] === 'string' && translations.en[key].trim() && !arabic.test(translations.en[key])) {
    const selected = keyFor(ar, translations);
    if (selected) phraseMap.set(ar, selected);
  }
}

let migrated = 0;
const modified = [];
const unresolved = new Set();
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  const result = replaceKnownPhrases(original, phraseMap, unresolved);
  if (!result.changed) continue;
  const withImport = file.endsWith('index.html') ? result.source : addTImport(result.source, file);
  migrated += [...phraseMap.keys()].filter((phrase) => original.includes(phrase) && !withImport.includes(phrase)).length;
  fs.writeFileSync(file, withImport, 'utf8');
  modified.push(path.relative(root, file));
}

const reviewPath = path.join(root, 'scripts', 'i18n-migration-unresolved.txt');
fs.writeFileSync(reviewPath, [...unresolved].sort().join('\n') + (unresolved.size ? '\n' : ''), 'utf8');
console.log(JSON.stringify({ backupDir: path.relative(root, backupDir), migrated, modified, unresolved: unresolved.size, reviewPath: path.relative(root, reviewPath) }, null, 2));
