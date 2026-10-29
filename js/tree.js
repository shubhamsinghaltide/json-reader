/* Tree / Table / Raw renderers. */
(function (g) {
  const type = Insights.type, pathStr = Insights.pathStr;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function hl(text, q) {
    const frag = document.createDocumentFragment();
    if (!q) { frag.append(text); return frag; }
    const lt = text.toLowerCase(), lq = q.toLowerCase();
    let i = 0, j;
    while ((j = lt.indexOf(lq, i)) !== -1) {
      frag.append(text.slice(i, j));
      frag.append(el('mark', 'hit', text.slice(j, j + q.length)));
      i = j + q.length;
    }
    frag.append(text.slice(i));
    return frag;
  }

  function scalarSpan(v, q) {
    const t = type(v);
    if (t === 'string') {
      const sp = el('span', 's');
      sp.append('"');
      if (/^https?:\/\/\S+$/i.test(v)) { const a = el('a', 'url'); a.href = v; a.target = '_blank'; a.rel = 'noopener'; a.append(hl(v, q)); sp.append(a); }
      else sp.append(hl(v, q));
      sp.append('"');
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { const sw = el('span', 'swatch'); sw.style.background = v; sp.append(sw); }
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !isNaN(Date.parse(v))) sp.append(el('span', 'meta', new Date(v).toLocaleString()));
      return sp;
    }
    if (t === 'number') { const sp = el('span', 'n'); sp.append(hl(String(v), q)); return sp; }
    if (t === 'boolean') { const sp = el('span', 'b'); sp.append(hl(String(v), q)); return sp; }
    return el('span', 'nl', 'null');
  }

  // Find paths (as strings) of nodes whose subtree contains a match.
  function matchSet(root, q) {
    const open = new Set(); let count = 0;
    if (!q) return { open, count };
    const lq = q.toLowerCase();
    (function w(v, path) {
      let hit = false;
      const t = type(v);
      if (t === 'object') {
        for (const k of Object.keys(v)) {
          if (k.toLowerCase().includes(lq)) { hit = true; count++; }
          if (w(v[k], path.concat(k))) hit = true;
        }
      } else if (t === 'array') {
        v.forEach((c, i) => { if (w(c, path.concat(i))) hit = true; });
      } else if (String(v).toLowerCase().includes(lq)) { hit = true; count++; }
      if (hit) open.add(JSON.stringify(path));
      return hit;
    })(root, []);
    return { open, count };
  }

  function renderTree(root, host, o) {
    host.textContent = '';
    const { open, count } = matchSet(root, o.query);
    const wrap = el('div', 'root');
    const CHUNK = 200;

    function build(key, v, path, depth) {
      const node = el('div', 'node');
      const row = el('div', 'row');
      row.dataset.path = JSON.stringify(path);
      const t = type(v);
      const isC = t === 'object' || t === 'array';
      if (key !== null) {
        const ks = el('span', 'k'); ks.append(typeof key === 'number' ? String(key) : '"', ...(typeof key === 'number' ? [] : [hl(key, o.query), '"']));
        row.append(isC ? el('span', 'tog', '') : el('span', 'tog', ''), ks, ': ');
      } else row.append(el('span', 'tog'));
      if (!isC) { row.append(scalarSpan(v, o.query)); node.append(row); return node; }

      const keys = t === 'array' ? null : Object.keys(v);
      const len = t === 'array' ? v.length : keys.length;
      const [ob, cb] = t === 'array' ? ['[', ']'] : ['{', '}'];
      const tog = row.querySelector('.tog');
      row.append(ob);
      const meta = el('span', 'meta', len ? `${len} ${t === 'array' ? 'items' : 'keys'}` : 'empty');
      row.append(meta);
      node.append(row);
      if (!len) { row.append(cb); meta.textContent = ''; return node; }
      const kids = el('div', 'children');
      node.append(kids);
      const close = el('div', 'row', cb);
      close.style.marginLeft = '0'; close.className = 'row closer';
      node.append(close);

      let built = false;
      const fill = () => {
        if (built) return; built = true;
        const entries = t === 'array' ? v.map((c, i) => [i, c]) : keys.map(k => [k, v[k]]);
        let shown = 0;
        const more = el('div', 'row meta');
        const addChunk = () => {
          entries.slice(shown, shown + CHUNK).forEach(([k, c]) => kids.insertBefore(build(k, c, path.concat(k), depth + 1), more));
          shown = Math.min(entries.length, shown + CHUNK);
          if (shown >= entries.length) more.remove();
          else { more.textContent = `… ${entries.length - shown} more (click to show)`; more.style.cursor = 'pointer'; }
        };
        more.onclick = addChunk;
        kids.append(more);
        addChunk();
      };
      const setOpen = (on) => {
        node.classList.toggle('collapsed', !on);
        tog.textContent = on ? '▾' : '▸';
        if (on) fill();
      };
      const key0 = JSON.stringify(path);
      const startOpen = o.expandAll || (o.query ? open.has(key0) : depth < 2);
      setOpen(startOpen);
      tog.onclick = (e) => { e.stopPropagation(); setOpen(node.classList.contains('collapsed')); };
      row.ondblclick = () => setOpen(node.classList.contains('collapsed'));
      node._setOpen = setOpen;
      return node;
    }
    wrap.append(build(null, root, [], 0));
    host.append(wrap);
    return count;
  }

  function findTable(root, prefer) {
    const ok = (a) => Array.isArray(a) && a.length && a.every(x => type(x) === 'object');
    const okObj = (o) => type(o) === 'object' && Object.keys(o).length && Object.values(o).every(x => type(x) === 'object');
    const get = (p) => p.reduce((a, k) => a == null ? a : a[k], root);
    if (prefer) { const v = get(prefer); if (ok(v)) return { path: prefer, rows: v.map((r, i) => [i, r]) }; if (okObj(v)) return { path: prefer, rows: Object.entries(v) }; }
    if (ok(root)) return { path: [], rows: root.map((r, i) => [i, r]) };
    if (okObj(root)) return { path: [], rows: Object.entries(root) };
    let best = null;
    (function w(v, path) {
      if (ok(v) && (!best || v.length > best.rows.length)) best = { path, rows: v.map((r, i) => [i, r]) };
      if (type(v) === 'object') Object.keys(v).forEach(k => w(v[k], path.concat(k)));
      else if (type(v) === 'array') v.slice(0, 50).forEach((c, i) => w(c, path.concat(i)));
    })(root, []);
    return best;
  }

  function renderTable(root, host, o) {
    host.textContent = '';
    const tbl = findTable(root, o.selected);
    if (!tbl) { host.append(el('p', 'muted', 'No array of objects found to show as a table. Use Tree or Raw view.')); return; }
    const cols = [];
    tbl.rows.forEach(([, r]) => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
    const q = (o.query || '').toLowerCase();
    let rows = tbl.rows.map(([k, r]) => ({ k, r }));
    if (q) rows = rows.filter(({ r }) => JSON.stringify(r).toLowerCase().includes(q));
    host.append(el('div', 'meta', `Table of ${pathStr(tbl.path)} — ${rows.length} of ${tbl.rows.length} rows, ${cols.length} columns. Click a header to sort.`));
    const table = el('table', 't');
    const thead = el('thead'), trh = el('tr');
    trh.append(el('th', null, '#'));
    let sort = { col: null, dir: 1 };
    const body = el('tbody');
    const cellText = (v) => v === undefined ? '' : (type(v) === 'object' || type(v) === 'array') ? JSON.stringify(v) : String(v);
    const draw = () => {
      body.textContent = '';
      let rs = rows.slice();
      if (sort.col !== null) rs.sort((a, b) => {
        const x = a.r[sort.col], y = b.r[sort.col];
        if (x === y) return 0; if (x === undefined) return 1; if (y === undefined) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : cellText(x).localeCompare(cellText(y), undefined, { numeric: true })) * sort.dir;
      });
      rs.slice(0, 2000).forEach(({ k, r }) => {
        const tr = el('tr'); tr.append(el('td', 'muted', String(k)));
        cols.forEach(c => { const td = el('td'); const v = r[c]; if (v === undefined) td.className = 'muted'; else td.append(type(v) === 'object' || type(v) === 'array' ? el('span', 'meta', cellText(v)) : scalarSpan(v, o.query)); tr.append(td); });
        body.append(tr);
      });
      if (rs.length > 2000) host.append(el('p', 'muted', 'Showing first 2000 rows.'));
    };
    cols.forEach(c => {
      const th = el('th', null, c);
      th.onclick = () => { sort = { col: c, dir: sort.col === c ? -sort.dir : 1 }; draw(); };
      trh.append(th);
    });
    thead.append(trh); table.append(thead, body); host.append(table);
    draw();
  }

  function renderRaw(root, host, o) {
    host.textContent = '';
    const pre = el('pre', 'raw');
    pre.append(hl(JSON.stringify(root, null, 2), o.query));
    host.append(pre);
  }

  g.TreeView = { renderTree, renderTable, renderRaw };
})(window);
