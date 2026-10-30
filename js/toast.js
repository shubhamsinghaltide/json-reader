// Persistent toasts: they stay until closed (no auto-dismiss). Markup lives in the #toastTpl template in index.html.
// One toast per key, so a panel's toast is replaced in place.
const Toast = (function () {
  const host = () => document.getElementById('toasts');
  const find = (key) => host().querySelector(`[data-key="${key}"]`);

  // Shows or replaces the toast for key. details is an array of strings listed under the title.
  function show(key, title, details = []) {
    const box = host();
    let el = find(key);
    if (!el) {
      el = document.getElementById('toastTpl').content.firstElementChild.cloneNode(true);
      el.dataset.key = key;
      el.querySelector('.toast-close').onclick = () => hide(key);
      box.append(el);
    }
    el.querySelector('.toast-title').textContent = title;
    const list = el.querySelector('.toast-list');
    list.textContent = '';
    details.forEach(d => { const li = document.createElement('li'); li.textContent = d; list.append(li); });
  }

  function hide(key) {
    const el = find(key);
    if (el) el.remove();
  }

  return { show, hide };
})();
