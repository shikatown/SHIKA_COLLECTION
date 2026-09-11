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

/* 画面ごとの縦位置を覚えておく。
   カードを見て戻ったとき、一覧のいちばん上ではなく元の場所に戻すため。
   はじめて開く画面は覚えがないので、いちばん上から始まる。 */
const scrollMemo = new Map();
let lastHash = '';

function rememberScroll() {
  if (lastHash) scrollMemo.set(lastHash, window.scrollY);
}
/** 戻したい位置へ。中身の高さが決まるまで数回やり直す（画像の読み込みで伸びるため） */
function restoreScroll(y) {
  const put = () => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, Math.min(y, max));
  };
  put();
  if (y > 0) { setTimeout(put, 60); setTimeout(put, 220); setTimeout(put, 500); }
}

export function handle() {
  const { segs, params } = parse(location.hash);
  const m = match(segs);
  const view = document.getElementById('view');
  if (!view) return;
  rememberScroll();
  lastHash = location.hash;
  view.scrollTop = 0;
  if (m) {
    current = { path: m.pattern, params: { ...params, ...m.params } };
    m.render(view, current.params);
  } else if (notFound) {
    current = { path: '404', params };
    notFound(view, params);
  }
  restoreScroll(scrollMemo.get(location.hash) || 0);
  if (onChange) onChange(current);
}

export function start() {
  window.addEventListener('hashchange', handle);
  if (!location.hash) history.replaceState(null, '', '#/home');
  handle();
}
