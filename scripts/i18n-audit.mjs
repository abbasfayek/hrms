import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const uiRoots = [
  'public/js/components',
  'public/js/engines',
  'public/js/app.js',
  'public/js/auth.js',
  'index.html',
];
const ignoredTerms = /\b(WPS|GOSI|EOSB)\b/g;
const arabic = /[\u0600-\u06FF]/;
const english = /[A-Za-z]/;

function filesAt(relative) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesAt(path.join(relative, entry.name)) : [path.join(full, entry.name)],
  );
}

function isUiLiteral(line) {
  return /(?:innerHTML|textContent|placeholder|title=|aria-label|toast\.|showConfirmDialog|createModal|<(?:h\d|p|th|td|button|label|option|span|div)\b)/.test(line);
}

const violations = [];
for (const relative of uiRoots) {
  for (const file of filesAt(relative).filter((name) => /\.(?:js|html)$/.test(name))) {
    if (file.endsWith(`${path.sep}i18n.js`)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes('i18n-ignore') || !isUiLiteral(line)) return;
      const visible = line.replace(ignoredTerms, '');
      if (arabic.test(visible) || (arabic.test(visible) && english.test(visible))) {
        violations.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

if (violations.length) {
  console.error(`i18n audit failed: ${violations.length} hard-coded UI literal(s).`);
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('i18n audit passed: no hard-coded Arabic UI literals found.');
}
