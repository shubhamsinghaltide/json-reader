/* Uniclient-oriented checks and a Dart (freezed + json_serializable) model generator. */
(function (g) {
  const type = Insights.type, pathStr = Insights.pathStr;
  const esc = (x) => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
  const ENUMISH = /(status|type|state|kind|mode|category|market|currency|reason|code|method|provider|scheme)$/i;
  const MONEYISH = /(amount|price|fee|total|balance|cost|charge|tax|vat|gst)/i;
  const EXPIRYISH = /(expir|validuntil|validto|ttl|deadline)/i;
  const SECRETISH = /(token|secret|password|passwd|authorization|apikey|api_key|cvv|pin|otp|jwt)/i;

  const isCamel = (k) => /^[a-z][A-Za-z0-9]*$/.test(k);
  const isSnake = (k) => /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(k);
  const isPascal = (k) => /^[A-Z][A-Za-z0-9]*$/.test(k);
  const luhn = (s) => { let sum = 0, alt = false; for (let i = s.length - 1; i >= 0; i--) { let n = +s[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; };

  function analyze(root) {
    const out = { facts: {}, naming: { camel: 0, snake: 0, pascal: 0, other: [] }, enums: new Map(), nullable: [], optional: [],
      money: [], expiry: [], secrets: [], pii: [], ids: [], emptyStr: [], dupKeysCase: [] };
    const keyStats = new Map(); // key -> {vals:Set, count, types:Set, paths:[]}
    const seenKeyPaths = new Map();

    (function walk(v, path, parentKey) {
      const t = type(v);
      if (t === 'object') {
        const ks = Object.keys(v);
        const lower = new Map();
        ks.forEach(k => {
          if (isCamel(k)) out.naming.camel++; else if (isSnake(k)) out.naming.snake++; else if (isPascal(k)) out.naming.pascal++;
          else if (out.naming.other.length < 5 && !out.naming.other.includes(k)) out.naming.other.push(k);
          const norm = k.replace(/[_-]/g, '').toLowerCase();
          if (lower.has(norm) && lower.get(norm) !== k) out.dupKeysCase.push(pathStr(path) + ': ' + lower.get(norm) + ' / ' + k);
          lower.set(norm, k);
          const c = v[k], ct = type(c), p = path.concat(k);
          let st = keyStats.get(k); if (!st) keyStats.set(k, st = { vals: new Set(), count: 0, types: new Set(), paths: [] });
          st.count++; st.types.add(ct); if (st.paths.length < 3) st.paths.push(p);
          if (ct === 'string') st.vals.add(c);
          if (ct === 'null' && out.nullable.length < 30) out.nullable.push(p);
          if (ct === 'string' && c === '' && out.emptyStr.length < 30) out.emptyStr.push(p);
          if (SECRETISH.test(k) && ct === 'string' && c) out.secrets.push(p);
          if (MONEYISH.test(k)) {
            if (ct === 'string' && /^-?\d+(\.\d+)?$/.test(c)) out.money.push({ p, why: 'amount is a numeric string' });
            else if (ct === 'number' && !Number.isInteger(c)) out.money.push({ p, why: 'floating-point amount (' + c + ')' });
          }
          if (ct === 'string' && ISO.test(c) && EXPIRYISH.test(k)) {
            const d = Date.parse(c); if (!isNaN(d)) out.expiry.push({ p, d, c });
          }
          if (ct === 'number' && EXPIRYISH.test(k) && c > 1e9) out.expiry.push({ p, d: c < 1e11 ? c * 1000 : c, c: String(c) });
          if (/(^id$|Id$|_id$|key$)/.test(k) && ct === 'string' && c && out.ids.length < 8) out.ids.push({ p, v: c });
          walk(c, p, k);
        });
      } else if (t === 'array') {
        v.forEach((c, i) => walk(c, path.concat(i), parentKey));
      } else if (t === 'string') {
        if (v) {
          const key = String(parentKey || '');
          const add = (cat) => { let m = out.facts[cat]; if (!m) m = out.facts[cat] = new Map(); const e = m.get(v) || { paths: [], count: 0 }; e.count++; if (e.paths.length < 3) e.paths.push(path); m.set(v, e); };
          if (/^https?:\/\/\S+$/i.test(v)) add('urls');
          else if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) add('colors');
          else if (ISO.test(v) && !isNaN(Date.parse(v))) add('dates');
          else if (/^\/(api|v\d+)\/\S*$/.test(v)) add('endpoints');
          else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) || /^[0-9a-f]{24}$/i.test(v) || (/(^id$|Id$|_id$|Ids?$)/.test(key) && !/\s/.test(v) && v.length < 80)) add('ids');
          else if (/code$/i.test(key) || /^[A-Z][A-Z0-9]*([_-][A-Z0-9]+)+$/.test(v)) add('codes');
          else if (/icon/i.test(key)) add('icons');
        }
        const digits = v.replace(/[ -]/g, '');
        if (/^\d{13,19}$/.test(digits) && luhn(digits)) out.pii.push({ p: path, what: 'possible card number (Luhn valid)' });
        else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) out.pii.push({ p: path, what: 'email address' });
        else if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) out.pii.push({ p: path, what: 'IBAN-like value' });
        else if (/^\+\d{8,15}$/.test(v)) out.pii.push({ p: path, what: 'phone number' });
        else if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(v) && v.startsWith('eyJ')) out.pii.push({ p: path, what: 'JWT' });
      }
    })(root, [], null);

    // enum candidates: stringy fields with few distinct values
    for (const [k, st] of keyStats) {
      if (st.types.size === 1 && st.types.has('string') && st.vals.size >= 1 && st.vals.size <= 8 && (ENUMISH.test(k) || (st.count >= 4 && st.vals.size <= 4))) {
        out.enums.set(k, [...st.vals]);
      }
    }
    return out;
  }

  const P = (p) => `<span class="path" data-path='${esc(JSON.stringify(p))}'>${esc(pathStr(p))}</span>`;
  const CP = (txt, label) => `<button class="cp" data-copy="${esc(txt)}" title="Copy">${label || 'copy'}</button>`;
  const short = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const ago = (d) => { const m = Math.round((d - Date.now()) / 60000), a = Math.abs(m); const u = a >= 1440 ? Math.round(a / 1440) + 'd' : a >= 60 ? Math.round(a / 60) + 'h' : a + 'm'; return m < 0 ? u + ' ago' : 'in ' + u; };

  const SEV = { high: ['High', 'sev-high'], med: ['Review', 'sev-med'], info: ['Info', 'sev-info'] };
  const sec = (title, count, body, open) => `<details class="sec"${open ? ' open' : ''}><summary>${title}${count != null ? ` <span class="cnt">${count}</span>` : ''}</summary>${body}</details>`;

  function renderQuick(r) {
    const G = [['codes', 'Code'], ['ids', 'ID'], ['urls', 'URL'], ['endpoints', 'Endpoint'], ['colors', 'Colour'], ['dates', 'Date'], ['icons', 'Icon']];
    const rows = [], counts = {};
    G.forEach(([cat, label]) => {
      const m = r.facts[cat]; if (!m || !m.size) return;
      counts[cat] = m.size;
      [...m].slice(0, 60).forEach(([v, e]) => {
        let shown = `<code>${esc(short(v, 70))}</code>`;
        if (cat === 'colors') shown = `<span class="swatch" style="background:${esc(v)}"></span> <code>${esc(v)}</code>`;
        if (cat === 'dates') shown = `<code>${esc(v)}</code><div class="muted">${ago(Date.parse(v))}</div>`;
        if (cat === 'urls') shown = `<a class="url" href="${esc(v)}" target="_blank" rel="noopener">${esc(short(v, 70))}</a>`;
        rows.push(`<tr data-cat="${cat}"><td><span class="tag t-${cat}">${label}</span></td><td class="val">${shown}${e.count > 1 ? ` <span class="muted">×${e.count}</span>` : ''}</td><td class="pth">${P(e.paths[0])}</td><td class="act">${CP(v)}${CP(pathStr(e.paths[0]), '$')}</td></tr>`);
      });
    });
    if (!rows.length) return '';
    const chips = `<div class="chips"><button class="chip on" data-filter="all">All ${rows.length}</button>` +
      G.filter(([c]) => counts[c]).map(([c, l]) => `<button class="chip" data-filter="${c}">${l} ${counts[c]}</button>`).join('') + '</div>';
    const table = `<div class="tw"><table class="ut" id="quickTable"><thead><tr><th>Type</th><th>Value</th><th>Path</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
    return sec('Quick copy', rows.length, chips + table, true);
  }

  function enumName(v) {
    let s = /^[A-Z0-9_\- ]+$/.test(v) ? v.toLowerCase() : v;
    s = camel(s);
    return /^[a-z]/.test(s) && !RESERVED.has(s) ? s : 'v' + (s[0] ? s[0].toUpperCase() + s.slice(1) : 'Empty');
  }
  function renderEnums(r) {
    if (!r.enums.size) return '';
    const rows = [];
    r.enums.forEach((vals, k) => {
      const en = pascal(k);
      const code = `@JsonEnum(alwaysCreate: true)\nenum ${en} {\n${vals.map(v => `  @JsonValue('${v.replace(/'/g, "\\'")}')\n  ${enumName(v)},`).join('\n')}\n  unknown,\n}\n\n// on the field:\n@JsonKey(unknownEnumValue: ${en}.unknown) required ${en} ${camel(k)},`;
      rows.push(`<tr><td class="val"><code>${esc(k)}</code><div class="muted">enum ${esc(en)}</div></td><td>${vals.map(v => `<code class="pill">${esc(v)}</code>`).join(' ')}</td><td class="act">${CP(code, 'copy Dart')}${CP(vals.join('\n'), 'values')}</td></tr>`);
    });
    return sec('Enums (ready to paste)', r.enums.size, `<div class="tw"><table class="ut"><thead><tr><th>Field</th><th>Values</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`, true);
  }

  function render(r) { return renderChecks(r) + renderQuick(r) + renderEnums(r); }

  function renderChecks(r) {
    const rows = [];
    const add = (sev, where, finding, action) => rows.push({ sev, html: `<tr><td><span class="sev ${SEV[sev][1]}">${SEV[sev][0]}</span></td><td class="pth">${where}</td><td>${finding}</td><td class="muted">${action}</td></tr>` });

    r.expiry.forEach(e => {
      const left = e.d - Date.now();
      add(left < 0 ? 'high' : 'med', P(e.p), left < 0 ? `Expired ${ago(e.d)} <span class="muted">(${esc(e.c)})</span>` : `Expires ${ago(e.d)}`, 'Handle expiry / refetch');
    });
    r.secrets.slice(0, 6).forEach(p => add('high', P(p), 'Looks like a secret or token', 'Redact before sharing'));
    r.pii.slice(0, 8).forEach(x => add(/card|JWT/.test(x.what) ? 'high' : 'med', P(x.p), esc(x.what), 'Redact before sharing'));
    r.money.slice(0, 6).forEach(m => add('med', P(m.p), esc(m.why), 'Use minor units or decimal'));
    const n = r.naming, styles = ['camel', 'snake', 'pascal'].filter(s => n[s]);
    if (styles.length > 1) add('med', '<span class="muted">keys</span>', 'Mixed key styles: ' + styles.map(s => s + ' ' + n[s]).join(', '), 'Add <code>@JsonKey(name:)</code>');
    r.dupKeysCase.slice(0, 3).forEach(d => add('med', '<span class="muted">keys</span>', 'Same key, different casing: ' + esc(d), 'Check backend contract'));
    if (n.other.length) add('info', '<span class="muted">keys</span>', 'Unusual key names: ' + esc(n.other.join(', ')), 'Map with <code>@JsonKey</code>');
    if (r.enums.size) add('info', '<span class="muted">' + r.enums.size + ' field(s)</span>', 'Enum candidates: ' + [...r.enums.keys()].map(k => '<code>' + esc(k) + '</code>').join(', '), 'Use <code>unknownEnumValue</code>');
    if (r.nullable.length) add('info', P(r.nullable[0]) + (r.nullable.length > 1 ? ` <span class="muted">+${r.nullable.length - 1}</span>` : ''), 'Explicit null value', 'Model as <code>T?</code>');
    if (r.emptyStr.length) add('info', P(r.emptyStr[0]) + (r.emptyStr.length > 1 ? ` <span class="muted">+${r.emptyStr.length - 1}</span>` : ''), 'Empty string', 'Decide if it means absent');

    const order = { high: 0, med: 1, info: 2 };
    rows.sort((a, b) => order[a.sev] - order[b.sev]);
    const body = rows.length
      ? `<div class="tw"><table class="ut"><thead><tr><th>Level</th><th>Where</th><th>Finding</th><th>Suggested</th></tr></thead><tbody>${rows.map(x => x.html).join('')}</tbody></table></div>`
      : '<p class="muted">No Uniclient-specific issues found.</p>';
    return sec('Uniclient checks', rows.length, body, true);
  }

  /* ---------- Dart generator ---------- */
  const pascal = (s) => s.replace(/(^|[_\-\s]+)([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase()).replace(/[^A-Za-z0-9]/g, '');
  const camel = (s) => { const p = pascal(s); return p ? p[0].toLowerCase() + p.slice(1) : 'field'; };
  const singular = (s) => s.replace(/ies$/, 'y').replace(/(ses|xes)$/, m => m.slice(0, -2)).replace(/s$/, '');
  const RESERVED = new Set(['class', 'default', 'new', 'in', 'is', 'var', 'void', 'with', 'enum', 'switch', 'case', 'final', 'const', 'null', 'true', 'false', 'this', 'super', 'return', 'if', 'else', 'for', 'while', 'do', 'try', 'catch', 'throw', 'static', 'extends', 'implements', 'import', 'part', 'type', 'late', 'required']);

  function generateDart(root, rootName) {
    const classes = new Map(); // name -> {fields: Map(key -> {types:Set, nullable, count, sub})}, total
    const order = [];

    function addObject(name, samples) {
      let c = classes.get(name);
      if (!c) { classes.set(name, c = { fields: new Map(), total: 0 }); order.push(name); }
      samples.forEach(o => {
        c.total++;
        Object.keys(o).forEach(k => {
          let f = c.fields.get(k); if (!f) c.fields.set(k, f = { count: 0, nullable: false, objs: [], arrObjs: [], kinds: new Set(), isoOnly: true, strVals: new Set(), intOnly: true });
          f.count++;
          const v = o[k], t = type(v);
          if (t === 'null') { f.nullable = true; return; }
          if (t === 'object') { f.kinds.add('obj'); f.objs.push(v); }
          else if (t === 'array') {
            f.kinds.add('arr'); if (!f.arr) f.arr = { kinds: new Set(), objs: [] };
            v.forEach(e => { const et = type(e); if (et === 'null') return; if (et === 'object') { f.arr.kinds.add('obj'); f.arr.objs.push(e); } else if (et === 'number') f.arr.kinds.add(Number.isInteger(e) ? 'int' : 'double'); else f.arr.kinds.add(et === 'string' ? 'str' : et); });
          } else if (t === 'number') { f.kinds.add('num'); if (!Number.isInteger(v)) f.intOnly = false; }
          else if (t === 'string') { f.kinds.add('str'); if (!ISO.test(v)) f.isoOnly = false; f.strVals.add(v); }
          else f.kinds.add(t);
        });
      });
    }

    function scalarType(kinds, f) {
      const ks = [...kinds];
      if (ks.length === 0) return 'dynamic';
      if (ks.length > 1) return 'dynamic';
      const k = ks[0];
      if (k === 'str') return f && f.isoOnly && f.strVals.size ? 'DateTime' : 'String';
      if (k === 'num') return f && f.intOnly ? 'int' : 'double';
      if (k === 'int' || k === 'double') return k;
      if (k === 'boolean') return 'bool';
      return 'dynamic';
    }

    const queue = [];
    function typeFor(name, k, f) {
      if (f.kinds.size === 1 && f.kinds.has('obj')) { const cn = pascal(k) || 'Item'; queue.push([cn, f.objs]); return cn; }
      if (f.kinds.size === 1 && f.kinds.has('arr')) {
        const a = f.arr;
        if (a.kinds.size === 1 && a.kinds.has('obj')) { const cn = pascal(singular(k)) || 'Item'; queue.push([cn, a.objs]); return `List<${cn}>`; }
        if (a.kinds.size === 0) return 'List<dynamic>';
        return `List<${a.kinds.size === 1 ? scalarType(a.kinds) === 'dynamic' ? 'dynamic' : scalarType(a.kinds) : 'dynamic'}>`;
      }
      return scalarType(f.kinds, f);
    }

    const rt = type(root);
    const rootObjs = rt === 'object' ? [root] : rt === 'array' ? root.filter(x => type(x) === 'object') : [];
    if (!rootObjs.length) return '// Root is not an object (or array of objects); nothing to generate.';
    queue.push([pascal(rootName) || 'Root', rootObjs]);
    const bodies = [];
    const done = new Set();
    while (queue.length) {
      const [name, samples] = queue.shift();
      if (done.has(name)) { addObject(name, samples); continue; }
      done.add(name);
      addObject(name, samples);
    }
    // second pass: render (types may enqueue more, so loop until stable)
    const rendered = new Set();
    let progress = true;
    while (progress) {
      progress = false;
      for (const name of [...order]) {
        if (rendered.has(name)) continue;
        rendered.add(name); progress = true;
        const c = classes.get(name);
        const lines = [];
        const enumNotes = [];
        c.fields.forEach((f, k) => {
          let t = typeFor(name, k, f);
          while (queue.length) { const [qn, qs] = queue.shift(); addObject(qn, qs); }
          const nullable = f.nullable || f.count < c.total;
          const dn = camel(k), safe = RESERVED.has(dn) ? dn + 'Value' : dn;
          const needsKey = safe !== k;
          let ann = '';
          const isEnumish = t === 'String' && f.strVals.size >= 1 && f.strVals.size <= 8 && ENUMISH.test(k);
          if (isEnumish) enumNotes.push(`${k}: ${[...f.strVals].join(' | ')}`);
          if (needsKey) ann = `@JsonKey(name: '${k}') `;
          const tn = t === 'dynamic' ? 'dynamic' : t + (nullable ? '?' : '');
          const req = nullable || t === 'dynamic' ? '' : 'required ';
          lines.push(`    ${ann}${req}${tn} ${safe},${isEnumish ? `  // enum candidate: ${[...f.strVals].join(' | ')}` : ''}`);
        });
        const file = name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
        bodies.push(`@freezed\nabstract class ${name} with _$${name} {\n  const factory ${name}({\n${lines.join('\n')}\n  }) = _${name};\n\n  factory ${name}.fromJson(Map<String, dynamic> json) =>\n      _$${name}FromJson(json);\n}\n// part '${file}.freezed.dart'; part '${file}.g.dart';`);
      }
    }
    return [`import 'package:freezed_annotation/freezed_annotation.dart';`, '', ...bodies.map(b => b + '\n')].join('\n') +
      '\n// Inferred from the sample only. A field is nullable if it was null or missing in any sample;\n// confirm against the backend contract. Run build_runner to generate the parts.';
  }

  g.Uniclient = { analyze, render, generateDart };
})(window);
