/* router.js — ハッシュルーター。
   GitHub Pages のサブパス配信でも壊れないよう、相対パス＋ハッシュだけで完結させる。 */

const routes = new Map();
let notFound = null;
let onChange = null;
let current = { path: '', params: {} };

export function define(path, render) { routes.set(path, render); }
export function setNotFound(fn) { notFound = fn; }
export function setOnChange(fn) { onChange = fn; }
export function currentRoute() { return current; }

export function parse(hash) {
  const raw = (hash || location.hash || '#/home').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean);
  const params = {};
  if (queryPart) {
    for (const kv of queryPart.split('&')) {
      const [k, v] = kv.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }
  return { segs, params };
}

/** #/card/001 のような可変部分は :id で受ける */
function match(segs) {
  for (const [pattern, render] of routes) {
    const p = pattern.replace(/^#?\//, '').split('/').filter(Boolean);
    if (p.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < p.length; i++) {
      if (p[i].startsWith(':')) params[p[i].slice(1)] = segs[i];
      else if (p[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { render, params, pattern };
  }
  return null;
}

export function go(hash, replace = false) {
  const target = hash.startsWith('#') ? hash : `#${hash}`;
  if (replace) {
    history.replaceState(null, '', target);
    handle();
  } else if (location.hash === target) {
    handle();
  } else {
    location.hash = target;
  }
}

export function back() {
  if (history.length > 1) history.back();
  else go('#/home');
}

export function handle() {
  const { segs, params } = parse(location.hash);
  const m = match(segs);
  const view = document.getElementById('view');
  if (!view) return;
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  if (m) {
    current = { path: m.pattern, params: { ...params, ...m.params } };
    m.render(view, current.params);
  } else if (notFound) {
    current = { path: '404', params };
    notFound(view, params);
  }
  if (onChange) onChange(current);
}

export function start() {
  window.addEventListener('hashchange', handle);
  if (!location.hash) history.replaceState(null, '', '#/home');
  handle();
}
