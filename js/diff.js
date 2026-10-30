/* Line diff (LCS) with word-level highlighting for modified lines. */
(function (g) {
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => o[k] = sortKeys(v[k])); return o; }
    return v;
  }

  // Total order over JSON values: type first, then content.
  // Objects compare key by key in alphabetical order: the key name first, then its value.
  const rank = (v) => v === null ? 0 : typeof v === 'boolean' ? 1 : typeof v === 'number' ? 2 : typeof v === 'string' ? 3 : Array.isArray(v) ? 4 : 5;
  function cmpValue(a, b) {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 4) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmpValue(a[i], b[i]); if (c) return c; }
      return a.length - b.length;
    }
    if (ra === 5) {
      const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
      for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
        if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
        const c = cmpValue(a[ka[i]], b[kb[i]]); if (c) return c;
      }
      return ka.length - kb.length;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  // Sorts every array (recursively) into alphabetical key/value order so list item order does not affect the diff.
  // Object keys are also sorted, so items with the same content but different key order line up.
  function sortLists(v) {
    if (Array.isArray(v)) return v.map(sortLists).sort(cmpValue);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => o[k] = sortLists(v[k])); return o; }
    return v;
  }

  // Returns ops: [{t:'eq'|'del'|'add', a?:idx, b?:idx}]
  function diffSeq(A, B) {
    let s = 0;
    while (s < A.length && s < B.length && A[s] === B[s]) s++;
    let ea = A.length, eb = B.length;
    while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
    const ops = [];
    for (let i = 0; i < s; i++) ops.push({ t: 'eq', a: i, b: i });
    const a = A.slice(s, ea), b = B.slice(s, eb), n = a.length, m = b.length;
    if (n * m > 25e6) { // too large for full LCS: treat middle as replaced
      a.forEach((_, i) => ops.push({ t: 'del', a: s + i }));
      b.forEach((_, j) => ops.push({ t: 'add', b: s + j }));
    } else {
      const w = m + 1, L = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
        L[i * w + j] = a[i] === b[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (a[i] === b[j]) { ops.push({ t: 'eq', a: s + i, b: s + j }); i++; j++; }
        else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) ops.push({ t: 'del', a: s + i++ });
        else ops.push({ t: 'add', b: s + j++ });
      }
      while (i < n) ops.push({ t: 'del', a: s + i++ });
      while (j < m) ops.push({ t: 'add', b: s + j++ });
    }
    for (let i = ea; i < A.length; i++) ops.push({ t: 'eq', a: i, b: eb + (i - ea) });
    return ops;
  }

  // Group into rows for side-by-side: eq rows, and change blocks paired line by line.
  function buildRows(A, B) {
    const ops = diffSeq(A, B), rows = [];
    for (let k = 0; k < ops.length;) {
      if (ops[k].t === 'eq') { rows.push({ t: 'eq', l: ops[k].a, r: ops[k].b }); k++; continue; }
      const dels = [], adds = [];
      while (k < ops.length && ops[k].t !== 'eq') { (ops[k].t === 'del' ? dels : adds).push(ops[k]); k++; }
      const n = Math.max(dels.length, adds.length);
      for (let i = 0; i < n; i++) {
        const d = dels[i], a = adds[i];
        rows.push({ t: d && a ? 'chg' : d ? 'del' : 'add', l: d ? d.a : null, r: a ? a.b : null });
      }
    }
    return rows;
  }

  const tok = (s) => s.match(/\s+|[A-Za-z0-9_.\-+]+|./g) || [];
  function wordDiff(x, y) {
    const a = tok(x), b = tok(y), ops = diffSeq(a, b);
    let L = '', R = '';
    const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    ops.forEach(o => {
      if (o.t === 'eq') { L += esc(a[o.a]); R += esc(b[o.b]); }
      else if (o.t === 'del') L += `<mark class="w-del">${esc(a[o.a])}</mark>`;
      else R += `<mark class="w-add">${esc(b[o.b])}</mark>`;
    });
    return { L: L.replace(/<\/mark><mark class="w-del">/g, ''), R: R.replace(/<\/mark><mark class="w-add">/g, '') };
  }

  function render(textL, textR, host, opts) {
    const A = textL.split('\n'), B = textR.split('\n');
    const rows = buildRows(A, B);
    const stats = { add: 0, del: 0, chg: 0 };
    rows.forEach(r => { if (r.t !== 'eq') stats[r.t]++; });
    host.textContent = '';
    if (!stats.add && !stats.del && !stats.chg) { host.innerHTML = '<p class="muted" style="padding:12px">Documents are identical.</p>'; return { stats, blocks: [] }; }

    const CTX = 3, keep = new Array(rows.length).fill(!opts.changedOnly);
    if (opts.changedOnly) rows.forEach((r, i) => { if (r.t !== 'eq') for (let j = Math.max(0, i - CTX); j <= Math.min(rows.length - 1, i + CTX); j++) keep[j] = true; });

    const esc = (s) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const frag = document.createDocumentFragment();
    const blocks = [];
    let prevChanged = false;
    const mk = (r) => {
      const d = document.createElement('div');
      d.className = 'drow sbs ' + r.t;
      let lh = r.l != null ? esc(A[r.l]) : '', rh = r.r != null ? esc(B[r.r]) : '';
      if (r.t === 'chg') { const w = wordDiff(A[r.l], B[r.r]); lh = w.L; rh = w.R; }
      if (r.t === 'chg') { lh = lh.replace(/w-del/g, 'w-chg'); rh = rh.replace(/w-add/g, 'w-chg'); }
      const cellCls = (side) => 'cell ' + (r.t === 'eq' ? '' : r.t === 'chg' ? 'chg' : (r.t === 'del' ? (side === 'l' ? 'del' : 'empty') : (side === 'r' ? 'add' : 'empty')));
      d.innerHTML = `<div class="ln">${r.l != null ? r.l + 1 : ''}</div><div class="${cellCls('l')}">${lh || '&nbsp;'}</div><div class="ln">${r.r != null ? r.r + 1 : ''}</div><div class="${cellCls('r')}">${rh || '&nbsp;'}</div>`;
      return d;
    };
    for (let i = 0; i < rows.length;) {
      if (!keep[i]) {
        let j = i; while (j < rows.length && !keep[j]) j++;
        const f = document.createElement('div'); f.className = 'fold';
        f.textContent = `⋯ ${j - i} unchanged lines (click to show)`;
        const s = i, e = j;
        f.onclick = () => { const fr = document.createDocumentFragment(); for (let k = s; k < e; k++) fr.append(mk(rows[k])); f.replaceWith(fr); };
        frag.append(f); i = j; prevChanged = false; continue;
      }
      const el = mk(rows[i]);
      if (rows[i].t !== 'eq') { if (!prevChanged) blocks.push(el); prevChanged = true; } else prevChanged = false;
      frag.append(el); i++;
    }
    host.append(frag);
    return { stats, blocks };
  }

  g.JsonDiff = { render, sortKeys, sortLists, buildRows };
})(window);
