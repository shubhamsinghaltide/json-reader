/* Insights: structural analysis of a parsed JSON value. */
(function (g) {
  const type = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  const RX = {
    url: /^https?:\/\/\S+$/i,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    iso: /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    color: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i,
  };

  function pathStr(p) {
    return '$' + p.map(k => typeof k === 'number' ? '[' + k + ']' : /^[A-Za-z_$][\w$]*$/.test(k) ? '.' + k : '["' + k + '"]').join('');
  }

  function analyze(root, rawText) {
    const s = {
      nodes: 0, types: { object: 0, array: 0, string: 0, number: 0, boolean: 0, null: 0 },
      maxDepth: 0, deepest: [], keys: new Map(), emptyContainers: 0, emptyStrings: 0,
      formats: { url: 0, email: 0, uuid: 0, iso: 0, color: 0 },
      largestArrays: [], longestStrings: [], warnings: [], numeric: { min: Infinity, max: -Infinity, count: 0 },
      arrayInfo: [],
    };
    const arrays = [], strings = [];

    (function walk(v, path) {
      s.nodes++;
      const t = type(v);
      s.types[t]++;
      if (path.length > s.maxDepth) { s.maxDepth = path.length; s.deepest = path; }
      if (t === 'string') {
        if (v === '') s.emptyStrings++;
        else {
          for (const f in RX) if (RX[f].test(v)) { s.formats[f]++; break; }
          if (v.length > 80) strings.push({ path, len: v.length });
          if (/^\s|\s$/.test(v)) s.warnings.push('Leading/trailing whitespace at ' + pathStr(path));
        }
      } else if (t === 'number') {
        s.numeric.count++;
        if (v < s.numeric.min) s.numeric.min = v;
        if (v > s.numeric.max) s.numeric.max = v;
        if (Number.isInteger(v) && !Number.isSafeInteger(v)) s.warnings.push('Unsafe integer at ' + pathStr(path));
      } else if (t === 'array') {
        if (!v.length) s.emptyContainers++;
        arrays.push({ path, len: v.length, v });
        v.forEach((c, i) => walk(c, path.concat(i)));
      } else if (t === 'object') {
        const ks = Object.keys(v);
        if (!ks.length) s.emptyContainers++;
        ks.forEach(k => {
          let e = s.keys.get(k);
          if (!e) s.keys.set(k, e = { count: 0, types: {} });
          e.count++;
          const ct = type(v[k]);
          e.types[ct] = (e.types[ct] || 0) + 1;
          walk(v[k], path.concat(k));
        });
      }
    })(root, []);

    arrays.sort((a, b) => b.len - a.len);
    s.largestArrays = arrays.slice(0, 5);
    strings.sort((a, b) => b.len - a.len);
    s.longestStrings = strings.slice(0, 3);

    // array homogeneity
    arrays.slice(0, 30).forEach(a => {
      if (a.len < 2) return;
      const ts = new Set(a.v.map(type));
      if (ts.size > 1) s.warnings.push('Mixed types [' + [...ts].join(', ') + '] in array ' + pathStr(a.path));
      const objs = a.v.filter(x => type(x) === 'object');
      if (objs.length > 1 && objs.length === a.len) {
        const kc = new Map();
        objs.forEach(o => Object.keys(o).forEach(k => kc.set(k, (kc.get(k) || 0) + 1)));
        const missing = [...kc].filter(([, c]) => c < objs.length);
        if (missing.length) s.warnings.push('Inconsistent keys in ' + pathStr(a.path) + ': ' + missing.slice(0, 4).map(([k, c]) => k + ' (' + c + '/' + objs.length + ')').join(', '));
      }
    });
    // keys with mixed types
    for (const [k, e] of s.keys) {
      const ts = Object.keys(e.types).filter(t => t !== 'null');
      if (ts.length > 1) s.warnings.push('Key "' + k + '" has mixed types: ' + ts.join(', '));
    }
    // large numbers lost precision in raw text
    if (rawText && /[:\[,]\s*-?\d{17,}\s*[,}\]]/.test(rawText)) s.warnings.push('Raw text has integers over 16 digits; precision may be lost when parsed (consider treating as strings).');
    if (s.warnings.length > 12) s.warnings = s.warnings.slice(0, 12).concat('…and more');

    s.bytes = rawText ? new Blob([rawText]).size : 0;
    s.minBytes = new Blob([JSON.stringify(root)]).size;
    return s;
  }

  const esc = (x) => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtBytes = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';

  function render(s, root) {
    const total = s.nodes || 1;
    const card = (v, l) => `<div class="card"><b>${esc(v)}</b><span>${l}</span></div>`;
    let h = '<div class="cards">' +
      card(type(root), 'root type') + card(s.nodes.toLocaleString(), 'total values') +
      card(s.maxDepth, 'max depth') + card(s.keys.size, 'unique keys') +
      card(fmtBytes(s.bytes || s.minBytes), 'size') + card(fmtBytes(s.minBytes), 'minified') + '</div>';

    h += '<h3>Type distribution</h3>';
    for (const t in s.types) if (s.types[t]) {
      const pct = (s.types[t] / total * 100);
      h += `<div class="bar"><span class="lbl">${t}</span><span class="track"><span class="fill" style="width:${pct}%;display:block"></span></span><span>${s.types[t]} (${pct.toFixed(0)}%)</span></div>`;
    }

    if (s.warnings.length) {
      h += '<h3>Heads up</h3>' + s.warnings.map(w => `<div class="warn">${esc(w)}</div>`).join('');
    }

    const fm = Object.entries(s.formats).filter(([, c]) => c);
    if (fm.length || s.emptyStrings || s.emptyContainers || s.types.null) {
      h += '<h3>Detected</h3><table>' +
        fm.map(([f, c]) => `<tr><td>${f} strings</td><td>${c}</td></tr>`).join('') +
        (s.types.null ? `<tr><td>null values</td><td>${s.types.null}</td></tr>` : '') +
        (s.emptyStrings ? `<tr><td>empty strings</td><td>${s.emptyStrings}</td></tr>` : '') +
        (s.emptyContainers ? `<tr><td>empty objects/arrays</td><td>${s.emptyContainers}</td></tr>` : '') + '</table>';
    }
    if (s.numeric.count) {
      h += `<h3>Numbers</h3><table><tr><td>count</td><td>${s.numeric.count}</td></tr><tr><td>min</td><td>${s.numeric.min}</td></tr><tr><td>max</td><td>${s.numeric.max}</td></tr></table>`;
    }
    if (s.largestArrays.length) {
      h += '<h3>Largest arrays</h3><table>' + s.largestArrays.map(a =>
        `<tr><td class="path" data-path='${esc(JSON.stringify(a.path))}'>${esc(pathStr(a.path))}</td><td>${a.len}</td></tr>`).join('') + '</table>';
    }
    if (s.maxDepth > 0) {
      h += `<h3>Deepest path</h3><table><tr><td class="path" data-path='${esc(JSON.stringify(s.deepest))}'>${esc(pathStr(s.deepest))}</td><td>${s.maxDepth}</td></tr></table>`;
    }
    if (s.longestStrings.length) {
      h += '<h3>Longest strings</h3><table>' + s.longestStrings.map(a =>
        `<tr><td class="path" data-path='${esc(JSON.stringify(a.path))}'>${esc(pathStr(a.path))}</td><td>${a.len} ch</td></tr>`).join('') + '</table>';
    }
    const keys = [...s.keys].sort((a, b) => b[1].count - a[1].count).slice(0, 15);
    if (keys.length) {
      h += '<h3>Most common keys</h3><table>' + keys.map(([k, e]) =>
        `<tr><td>${esc(k)}</td><td>${e.count}×</td><td>${esc(Object.keys(e.types).join('|'))}</td></tr>`).join('') + '</table>';
    }
    return h;
  }

  g.Insights = { analyze, render, pathStr, type };
})(window);
