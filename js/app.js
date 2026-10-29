(function () {
  const $ = (id) => document.getElementById(id);
  const SAMPLE = {
    id: "9b2c1c1e-5a1f-4d6b-8d3e-1b1a2c3d4e5f", name: "Acme Ltd", active: true, createdAt: "2026-03-14T09:30:00Z",
    status: "ACTIVE", paymentOptionType: "UPI", payment_tracking_id: "trk_123", documentUrl: "https://example.com/invoice.pdf", urlExpiryTime: "2020-01-01T00:00:00Z", amount: "12.50",
    contact: { email: "ops@acme.example", site: "https://acme.example", brand: "#4f46e5" },
    plans: [
      { code: "BCA", market: "UK", price: 9.99, features: ["cards", "invoices"] },
      { code: "TCA_PPI", market: "IN", price: 499, features: ["upi", "cards"], trial: null },
      { code: "CoF", market: "UK", price: "12.00" }
    ],
    notes: ""
  };

  // theme
  const root = document.documentElement;
  const saved = localStorage.getItem('jr-theme');
  if (saved) root.dataset.theme = saved;
  $('themeBtn').onclick = () => { const t = root.dataset.theme === 'dark' ? 'light' : 'dark'; root.dataset.theme = t; localStorage.setItem('jr-theme', t); };

  // tabs
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    collapseFull();
  });

  // expand to full width
  function collapseFull() {
    document.querySelectorAll('.panel.fullwidth').forEach(p => p.classList.remove('fullwidth'));
    document.body.classList.remove('has-full');
    document.querySelectorAll('.expand').forEach(b => b.textContent = '⤢');
  }
  document.querySelectorAll('.expand').forEach(b => b.onclick = () => {
    const p = $(b.dataset.expand), on = !p.classList.contains('fullwidth');
    collapseFull();
    if (on) { p.classList.add('fullwidth'); document.body.classList.add('has-full'); b.textContent = '⤡'; }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') collapseFull(); });

  // Extract body (and metadata) from a "NETWORK RESPONSE --START ... ----BODY: {...} --END" dump.
  function extractEnvelope(text) {
    const bi = text.search(/----\s*BODY\s*:/i);
    if (bi === -1) return null;
    let body = text.slice(text.indexOf(':', bi) + 1);
    body = body.replace(/\n?\s*--\s*END\s*$/i, '').trim();
    const head = text.slice(0, bi);
    const line = (name) => { const m = new RegExp('----\\s*' + name + '\\s*:\\s*(.*)', 'i').exec(head); return m ? m[1].trim() : null; };
    let headers = null;
    try { headers = JSON.parse(line('HEADERS')); } catch (e) { /* keep null */ }
    return { body, status: line('STATUS CODE'), time: line('TIME'), headers };
  }
  const bodyOnly = () => $('unwrapData') && $('unwrapData').checked;

  function parse(text) {
    let t = text.trim();
    if (!t) return { empty: true };
    let envelope = null;
    if (!/^[\[{"\d-]|^(true|false|null)\b/.test(t) || /----\s*BODY\s*:/i.test(t)) {
      envelope = extractEnvelope(t);
      if (envelope) t = envelope.body;
    }
    if (!t) return { error: 'Network response has an empty BODY', envelope };
    try {
      let value = JSON.parse(t);
      if (envelope && bodyOnly() && value && typeof value === 'object' && !Array.isArray(value) && 'data' in value) value = value.data;
      return { value, envelope };
    }
    catch (e) {
      let msg = e.message, m = /position (\d+)/.exec(msg);
      if (m && !/line \d+/.test(msg)) { const pos = +m[1], before = t.slice(0, pos).split('\n'); msg += ` (line ${before.length}, col ${before[before.length - 1].length + 1})`; }
      return { error: msg, envelope };
    }
  }
  function envelopeHtml(env) {
    const h = env.headers || {};
    const pick = ['content-type', 'content-length', 'cache-control', 'x-rate-limit-remaining', 'x-rate-limit-limit', 'x-gravitee-request-id'];
    const code = parseInt(env.status, 10);
    const cls = code >= 400 ? 'color:#dc2626' : code >= 300 ? 'color:#b45309' : 'color:#059669';
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const ct = h['content-type'] || '';
    const ver = /version=(\d+)/.exec(ct), vnd = /vnd\.([^+;]+)/.exec(ct);
    let s = '<h3>Network response</h3><div class="cards">' +
      `<div class="card"><b style="${cls}">${esc(env.status || '?')}</b><span>status</span></div>` +
      (env.time ? `<div class="card"><b style="font-size:12px">${esc(env.time.replace(/\.\d+Z?$/, ''))}</b><span>time</span></div>` : '') +
      (vnd ? `<div class="card"><b style="font-size:12px">${esc(vnd[1].split('.').pop())}${ver ? ' v' + ver[1] : ''}</b><span>media type</span></div>` : '') + '</div>';
    const rows = pick.filter(k => k in h).map(k => `<tr><td>${k}</td><td>${esc(h[k])} <button class="cp" data-copy="${esc(h[k])}">copy</button></td></tr>`);
    if (rows.length) s += '<table>' + rows.join('') + '</table>';
    if (env.headers) s += `<details style="margin-top:6px"><summary class="muted">All headers (${Object.keys(h).length})</summary><table>` +
      Object.entries(h).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('') + '</table></details>';
    const warns = [];
    if (code >= 400) warns.push('Error status code ' + code);
    if (h['x-rate-limit-remaining'] !== undefined && +h['x-rate-limit-remaining'] < 20) warns.push('Rate limit nearly exhausted');
    if (h['content-length'] !== undefined && +h['content-length'] === 0) warns.push('Empty content-length');
    return s + warns.map(w => `<div class="warn">${esc(w)}</div>`).join('');
  }
  function setStatus(el, r, extra) {
    el.className = 'status' + (r.error ? ' err' : r.value !== undefined ? ' ok' : '');
    el.textContent = r.error ? r.error : r.empty ? '' : 'Valid JSON' + (extra || '');
  }
  function readFile(input, target, cb) {
    input.onchange = () => { const f = input.files[0]; if (!f) return; f.text().then(t => { target.value = t; input.value = ''; cb(); }); };
  }
  function dropTo(el, target, cb) {
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) f.text().then(t => { target.value = t; cb(); }); });
  }

  // ===== Reader =====
  const A = { text: $('inputA'), value: undefined, mode: 'tree', selected: null, expandAll: false };
  function renderReader() {
    const r = parse(A.text.value);
    setStatus($('errA'), r, r.value !== undefined ? (r.envelope ? ' · body extracted from network response' + (r.envelope.status ? ' (HTTP ' + r.envelope.status + ')' : '') : ` · ${new Blob([A.text.value]).size} bytes`) : '');
    if (r.value === undefined) {
      A.value = undefined;
      $('treeOut').textContent = ''; $('insightsOut').innerHTML = '<p class="muted">Paste JSON to see insights.</p>'; return;
    }
    A.value = r.value;
    draw();
    const s = Insights.analyze(r.value, A.text.value);
    $('insightsOut').innerHTML = (r.envelope ? envelopeHtml(r.envelope) : '') + Uniclient.render(Uniclient.analyze(r.value)) + '<h3>General structure</h3>' + Insights.render(s, r.value);
    $('insightsOut').querySelectorAll('.path').forEach(td => td.onclick = () => {
      A.selected = JSON.parse(td.dataset.path); locate(A.selected);
    });
  }
  function draw() {
    if (A.value === undefined) return;
    const o = { query: $('search').value.trim(), expandAll: A.expandAll, selected: A.selected };
    const host = $('treeOut');
    if (A.mode === 'tree') TreeView.renderTree(A.value, host, o);
    else if (A.mode === 'table') TreeView.renderTable(A.value, host, o);
    else if (A.mode === 'dart') {
      host.textContent = '';
      const bar = document.createElement('div'); bar.className = 'dnav';
      bar.innerHTML = '<label>Root class <input id="dartRoot" value="' + (A.rootName || 'Response') + '" size="16"></label><button class="btn small" id="dartCopy">Copy</button>';
      const pre = document.createElement('pre'); pre.className = 'raw';
      const gen = () => { A.rootName = bar.querySelector('#dartRoot').value || 'Response'; pre.textContent = Uniclient.generateDart(A.value, A.rootName); };
      gen(); host.append(bar, pre);
      bar.querySelector('#dartRoot').oninput = gen;
      bar.querySelector('#dartCopy').onclick = () => navigator.clipboard && navigator.clipboard.writeText(pre.textContent);
    }
    else TreeView.renderRaw(A.value, host, o);
    A.expandAll = false;
  }
  // expand ancestors of a path in the tree and highlight the row
  function locate(path) {
    $('pathBar').textContent = Insights.pathStr(path);
    if (A.mode !== 'tree') { document.querySelector('#viewMode [data-mode=tree]').click(); }
    for (let i = 0; i <= path.length; i++) {
      const key = JSON.stringify(path.slice(0, i));
      const row = [...$('treeOut').querySelectorAll('.row')].find(r => r.dataset.path === key);
      if (row && row.parentElement._setOpen) row.parentElement._setOpen(true);
    }
    const key = JSON.stringify(path);
    const row = [...$('treeOut').querySelectorAll('.row')].find(r => r.dataset.path === key);
    if (row) { $('treeOut').querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); row.classList.add('sel'); row.scrollIntoView({ block: 'center' }); }
  }
  $('treeOut').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row || !row.dataset.path) return;
    $('treeOut').querySelectorAll('.sel').forEach(x => x.classList.remove('sel'));
    row.classList.add('sel');
    $('pathBar').textContent = Insights.pathStr(JSON.parse(row.dataset.path));
  });
  // quick-copy type filter chips
  $('insightsOut').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    const f = c.dataset.filter;
    c.parentElement.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === c));
    document.querySelectorAll('#quickTable tbody tr').forEach(tr => tr.hidden = f !== 'all' && tr.dataset.cat !== f);
  });
  // copy buttons in Insights (event delegation; works after re-render)
  $('insightsOut').addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const done = () => { const old = b.textContent; b.textContent = 'copied'; b.classList.add('ok'); setTimeout(() => { b.textContent = old; b.classList.remove('ok'); }, 900); };
    const txt = b.dataset.copy;
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, done);
    else { const t = document.createElement('textarea'); t.value = txt; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); done(); }
  });
  $('pathBar').onclick = () => navigator.clipboard && navigator.clipboard.writeText($('pathBar').textContent);

  let tmr; A.text.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(renderReader, 250); });
  $('search').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(draw, 200); });
  $('unwrapData').onchange = renderReader;
  $('formatBtn').onclick = () => { if (A.value !== undefined) A.text.value = JSON.stringify(A.value, null, 2); };
  $('minifyBtn').onclick = () => { if (A.value !== undefined) A.text.value = JSON.stringify(A.value); };
  $('sampleBtn').onclick = () => { A.text.value = JSON.stringify(SAMPLE, null, 2); renderReader(); };
  $('clearBtn').onclick = () => { A.text.value = ''; A.selected = null; renderReader(); };
  $('expandAll').onclick = () => { A.expandAll = true; draw(); };
  $('collapseAll').onclick = () => { $('search').value = ''; A.expandAll = false; draw(); document.querySelectorAll('#treeOut .root > .node > .row .tog').forEach(t => { const n = t.closest('.node'); if (n._setOpen) { n._setOpen(false); } }); };
  document.querySelectorAll('#viewMode button').forEach(b => b.onclick = () => {
    document.querySelectorAll('#viewMode button').forEach(x => x.classList.toggle('on', x === b));
    A.mode = b.dataset.mode; draw();
  });
  readFile($('fileA'), A.text, renderReader);
  dropTo($('panelInput'), A.text, renderReader);

  // ===== Compare =====
  const L = $('inputL'), R = $('inputR'), state = { blocks: [], cur: -1 };
  function compare() {
    const l = parse(L.value), r = parse(R.value);
    setStatus($('errL'), l); setStatus($('errR'), r);
    if (l.error || r.error || l.empty || r.empty) { $('diffOut').innerHTML = `<p class="muted" style="padding:12px">${l.error || r.error ? 'Fix the JSON error above first.' : 'Both sides are required.'}</p>`; $('diffSummary').textContent = ''; return; }
    let lv = l.value, rv = r.value;
    if ($('optSort').checked) { lv = JsonDiff.sortKeys(lv); rv = JsonDiff.sortKeys(rv); }
    const res = JsonDiff.render(JSON.stringify(lv, null, 2), JSON.stringify(rv, null, 2), $('diffOut'), { changedOnly: $('optChangedOnly').checked });
    const s = res.stats;
    $('diffSummary').innerHTML = (s.add + s.del + s.chg) ? `<span class="a">+${s.add} added</span> · <span class="d">−${s.del} removed</span> · <span class="c">~${s.chg} modified</span> · ${res.blocks.length} change block(s)` : 'identical';
    state.blocks = res.blocks; state.cur = -1;
    // enlarge diff area when not expanded
  }
  function jump(dir) {
    if (!state.blocks.length) return;
    state.blocks.forEach(b => b.classList.remove('cur'));
    state.cur = (state.cur + dir + state.blocks.length) % state.blocks.length;
    const b = state.blocks[state.cur]; b.classList.add('cur'); b.scrollIntoView({ block: 'center' });
  }
  $('diffBtn').onclick = compare;
  $('optSort').onchange = $('optChangedOnly').onchange = () => { if (L.value.trim() && R.value.trim()) compare(); };
  $('prevDiff').onclick = () => jump(-1);
  $('nextDiff').onclick = () => jump(1);
  $('swapBtn').onclick = () => { const t = L.value; L.value = R.value; R.value = t; compare(); };
  readFile($('fileL'), L, compare); readFile($('fileR'), R, compare);
  dropTo(L, L, compare); dropTo(R, R, compare);
  // make the compare tab usable: diff panel takes remaining height
  window.__jr = { parse, compare, renderReader, A, L, R };
})();
