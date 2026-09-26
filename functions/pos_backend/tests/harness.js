/* Test harness: loads pure functions from ../index.js source without
   booting Express (top-level requires/env would crash a plain require).
   Extraction is brace-matched on the real source, so tests always run
   against the shipped implementation. */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

function extractSource(keyword) {
  const start = SRC.indexOf(keyword);
  if (start < 0) throw new Error(`source not found: ${keyword}`);
  const brace = SRC.indexOf('{', start);
  let depth = 0;
  let i = brace;
  for (; i < SRC.length; i++) {
    const c = SRC[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return SRC.slice(start, i + 1);
}

function loadFunctions(names) {
  return loadScope(names, []);
}

/* Load functions plus the module-level consts they close over
   (e.g. posNormalizeLine needs posRound2/posClampPct). */
function loadScope(fnNames = [], constNames = []) {
  const parts = [
    ...constNames.map((n) => extractStatement(`const ${n} =`)),
    ...fnNames.map((n) => extractSource(`function ${n}(`)),
  ];
  const all = [...constNames, ...fnNames];
  const factory = new Function(`${parts.join('\n')}\nreturn { ${all.join(', ')} };`);
  return factory();
}

/* Statement extraction for const literals (arrays/objects): balances all
   bracket types and stops at the terminating semicolon. Quote-aware for
   plain strings; not for ${} inside template literals (unused here). */
function extractStatement(keyword) {
  const start = SRC.indexOf(keyword);
  if (start < 0) throw new Error(`source not found: ${keyword}`);
  let depth = 0;
  let quote = null;
  let i = start;
  for (; i < SRC.length; i++) {
    const c = SRC[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;
    else if (c === ';' && depth === 0) break;
  }
  return SRC.slice(start, i + 1);
}

function extractConstObject(name) {
  const src = extractStatement(`const ${name} =`);
  const factory = new Function(`${src}\nreturn ${name};`);
  return factory();
}

module.exports = { SRC, extractSource, loadFunctions, loadScope, extractConstObject };
