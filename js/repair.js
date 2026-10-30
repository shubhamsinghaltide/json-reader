// Best-effort repair of common JSON mistakes: trailing commas, single quotes, unquoted keys, comments, Python-style
// literals, missing commas or brackets, raw line breaks and bad escapes in strings.
// repair(text) returns { text, fixes } where text is valid JSON and each fix has a message and its 1-based line and column
// in the input. Returns null when the input cannot be repaired.
const JsonRepair = (function () {
  const CLOSER = { '{': '}', '[': ']' };
  const WORDS = { True: 'true', False: 'false', None: 'null', undefined: 'null', NaN: 'null', Infinity: 'null', '-Infinity': 'null' };
  const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
  const QUOTES = { '"': 'dq', '“': 'sm', '”': 'sm', "'": 'sq', '‘': 'sq', '’': 'sq' };
  const WORD = /[\w$+.-]+/y, COLON = /\s*:/y, TAIL = /\s*(?:[,:}\]]|$)/y;
  const ESC = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
  const hasWord = (w) => Object.prototype.hasOwnProperty.call(WORDS, w);

  function repair(input) {
    const src = input.replace(/^﻿/, '');
    const n = src.length;
    const at = (re, pos) => { re.lastIndex = pos; return re.exec(src); };
    const isClose = (ch, kind) => kind === 'dq' ? ch === '"' : kind === 'sm' ? ch === '"' || ch === '“' || ch === '”' : ch === "'" || ch === '‘' || ch === '’';

    const newlines = [];
    for (let k = src.indexOf('\n'); k !== -1; k = src.indexOf('\n', k + 1)) newlines.push(k);
    const fixes = [];
    const fix = (message, pos) => {
      let lo = 0, hi = newlines.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (newlines[mid] < pos) lo = mid + 1; else hi = mid; }
      fixes.push({ message, line: lo + 1, col: pos - (lo ? newlines[lo - 1] + 1 : 0) + 1 });
    };

    // Reads a quoted string starting at i and returns its JSON form and the index after it.
    function readString(i) {
      const kind = QUOTES[src[i]];
      let out = '"', j = i + 1, reported = false;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\') {
          const nx = src[j + 1];
          if (nx === undefined) break;
          if (nx === "'") { fix("Replaced \\' with '", j); out += "'"; j += 2; }
          else if ('"\\/bfnrt'.includes(nx) || (nx === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(j + 2, j + 6)))) { out += ch + nx; j += 2; }
          else { fix(`Escaped invalid "\\${nx}" in string`, j); out += '\\\\'; j += 1; }
          continue;
        }
        // single-quoted strings only end at a quote that is followed by a separator, so apostrophes inside stay put
        if (isClose(ch, kind) && (kind !== 'sq' || at(TAIL, j + 1))) return { json: out + '"', end: j + 1 };
        // a line break followed by a quote or a closing bracket means the closing quote was forgotten
        if ((ch === '\n' || ch === '\r') && /^\s*(?:["“”'‘’}\]])/.test(src.slice(j + 1, j + 80))) {
          fix('Added missing closing quote at end of line', j);
          return { json: out.replace(/\s+$/, '') + '"', end: j };
        }
        if (ch < ' ') {
          if (!reported) fix('Escaped raw line break or control character in string', j);
          reported = true;
          out += ESC[ch] || '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
        }
        else out += ch === '"' ? '\\"' : ch;
        j++;
      }
      fix('Closed unterminated string', n);
      return { json: out + '"', end: n };
    }

    const out = [], stack = [], quoteSwaps = {};
    let state = 'value'; // value | start | afterComma | afterValue | colon | done
    const inObj = () => stack[stack.length - 1] === '{';
    const expectsKey = () => inObj() && (state === 'start' || state === 'afterComma');
    // Inserts the comma that a previous value needs before a new item. Returns false if no item can start here.
    function beginItem(pos) {
      if (state === 'afterValue') { out.push(','); fix('Added missing comma', pos); state = 'afterComma'; }
      return state !== 'done' && state !== 'colon';
    }
    function endValue() { state = stack.length ? 'afterValue' : 'done'; }
    // Closes the innermost container, fixing a trailing comma or a missing value on the way. Returns false if unrecoverable.
    function close(pos, missing) {
      const closer = CLOSER[stack[stack.length - 1]];
      if (state === 'colon') return false;
      if (state === 'afterComma') { out.pop(); fix('Removed trailing comma', pos); }
      else if (state === 'value') { out.push('null'); fix('Added null for missing value', pos); }
      if (missing) fix(`Added missing "${closer}"`, pos);
      out.push(closer); stack.pop(); endValue();
      return true;
    }

    let i = 0;
    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { fix('Removed // comment', i); const e = src.indexOf('\n', i); i = e === -1 ? n : e; continue; }
      if (c === '/' && src[i + 1] === '*') { fix('Removed /* */ comment', i); const e = src.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
      if (c === '}' || c === ']') {
        if (state === 'done') fix(`Removed extra "${c}"`, i);
        else {
          if (!stack.length) return null;
          if (c !== CLOSER[stack[stack.length - 1]]) fix(`Replaced "${c}" with "${CLOSER[stack[stack.length - 1]]}"`, i);
          if (!close(i, false)) return null;
        }
        i++; continue;
      }
      if (c === ':') { if (state !== 'colon') return null; out.push(':'); state = 'value'; i++; continue; }
      if (c === ',') {
        if (state === 'afterValue') { out.push(','); state = 'afterComma'; }
        else if (state === 'value') { out.push('null', ','); fix('Added null for missing value', i); state = 'afterComma'; }
        else if (state === 'start' || state === 'afterComma') fix('Removed stray comma', i);
        else return null;
        i++; continue;
      }
      if (c === ';' && state === 'done') { fix('Removed trailing semicolon', i); i++; continue; }
      if (QUOTES[c]) {
        if (!beginItem(i)) return null;
        const key = expectsKey();
        if (c !== '"') { (quoteSwaps[QUOTES[c]] = quoteSwaps[QUOTES[c]] || { count: 0, pos: i }).count++; }
        const s = readString(i);
        out.push(s.json); i = s.end;
        if (key) state = 'colon'; else endValue();
        continue;
      }
      if (c === '{' || c === '[') {
        if (!beginItem(i) || expectsKey()) return null;
        out.push(c); stack.push(c); state = 'start'; i++; continue;
      }
      // Bare word: an unquoted key, a number, a literal, or an unquoted string value
      const m = at(WORD, i);
      if (!m) return null;
      const w = m[0], end = i + w.length;
      if (state === 'afterValue' && !(inObj() ? at(COLON, end) : NUMBER.test(w) || w === 'true' || w === 'false' || w === 'null' || hasWord(w))) return null;
      if (!beginItem(i)) return null;
      if (expectsKey()) { out.push(JSON.stringify(w)); fix(`Added quotes around key "${w}"`, i); state = 'colon'; }
      else if (NUMBER.test(w) || w === 'true' || w === 'false' || w === 'null') { out.push(w); endValue(); }
      else if (hasWord(w)) { out.push(WORDS[w]); fix(`Replaced ${w} with ${WORDS[w]}`, i); endValue(); }
      else if (/^[-+.\d]/.test(w) || !stack.length) return null;
      else { out.push(JSON.stringify(w)); fix(`Added quotes around value "${w}"`, i); endValue(); }
      i = end;
    }

    if (!stack.length && state !== 'done') return null;
    while (stack.length) if (!close(n, true)) return null;
    const text = out.join('');
    try { JSON.parse(text); } catch (e) { return null; }
    // quote swaps are reported once per quote style (with the first place and a count), not once per string
    const LABEL = { sm: 'curly quotes', sq: 'single quotes' };
    Object.keys(quoteSwaps).forEach(k => fix(`Replaced ${quoteSwaps[k].count} pair${quoteSwaps[k].count > 1 ? 's' : ''} of ${LABEL[k]} with straight double quotes (first one here)`, quoteSwaps[k].pos));
    fixes.sort((a, b) => a.line - b.line || a.col - b.col);
    return { text, fixes };
  }

  return { repair };
})();
