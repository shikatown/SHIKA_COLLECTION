/* ui.js — 画面部品の共通処理（仕様書§35の推奨構成に対する追加ファイル）。
   innerHTML への値の直接流し込みは避け、テキストは textContent で入れる。 */

import { CATEGORY_LABEL, app } from './state.js';

export function el(tag, opts = {}, children = []) {
  const n = document.createElement(tag);
  if (opts.class) n.className = opts.class;
  if (opts.text != null) n.textContent = opts.text;
  if (opts.html != null) n.innerHTML = opts.html;   // 固定文字列（SVG等）のみ
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) {
    if (v === true) n.setAttribute(k, '');
    else if (v != null && v !== false) n.setAttribute(k, String(v));
  }
  if (opts.on) for (const [k, v] of Object.entries(opts.on)) n.addEventListener(k, v);
  if (opts.style) Object.assign(n.style, opts.style);
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/* ===== トースト ===== */
let toastTimer = null;
export function toast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ===== ダイアログ ===== */
export function dialog({ title, body, actions = [], dismissible = true }) {
  return new Promise((resolve) => {
    const ov = document.getElementById('overlay');
    clear(ov);
    const close = (v) => { ov.hidden = true; clear(ov); resolve(v); };
    const box = el('div', { class: 'dialog', attrs: { role: 'dialog', 'aria-modal': 'true' } });
    if (title) box.append(el('h3', { text: title }));
    if (body) {
      for (const line of [].concat(body)) {
        box.append(typeof line === 'string' ? el('p', { text: line }) : line);
      }
    }
    const acts = el('div', { class: 'dialog__acts' });
    for (const a of actions) {
      acts.append(el('button', {
        class: `btn ${a.primary ? 'btn--primary' : ''} ${a.danger ? 'btn--danger' : ''}`,
        text: a.label, attrs: { type: 'button' },
        on: { click: () => close(a.value) },
      }));
    }
    box.append(acts);
    ov.append(box);
    ov.hidden = false;
    if (dismissible) ov.onclick = (e) => { if (e.target === ov) close(null); };
    else ov.onclick = null;
  });
}

export function confirm2(title, body, okLabel = 'OK') {
  return dialog({
    title, body,
    actions: [{ label: 'やめる', value: false }, { label: okLabel, value: true, primary: true }],
  });
}

/* ===== カード表示 =====
   カード画像が未設定/読み込めない場合だけ、代替の面を描く。
   完成カード画像がある場合は画像をそのまま（トリミング・加工なしで）表示する。 */

export function cardFace(cardData, { small = false } = {}) {
  const wrap = el('div', { class: `card${small ? ' card--sm' : ''}` });
  const fallback = () => {
    clear(wrap);
    wrap.classList.remove('card--img');
    wrap.append(placeholderFace(cardData));
  };
  if (cardData.cardImage) {
    const img = el('img', {
      attrs: { src: resolveAsset(cardData.cardImage), alt: cardData.name, loading: 'lazy', decoding: 'async' },
    });
    img.addEventListener('error', fallback, { once: true });
    wrap.classList.add('card--img');
    wrap.append(img);
  } else {
    fallback();
  }
  return wrap;
}

function placeholderFace(c) {
  const face = el('div', { class: `card__face card__face--${c.category || 'none'}` });
  face.append(el('div', { class: 'card__seal', text: '志賀' }));
  face.append(el('div', { class: 'card__nm', text: c.name }));
  const cat = CATEGORY_LABEL[c.category] || '';
  const parts = [cat, c.subCategory].filter(Boolean);
  face.append(el('div', {
    class: 'card__sub',
    text: (parts[1] === parts[0] ? [parts[0]] : parts).join(' / '),
  }));
  face.append(el('div', { class: 'card__no', text: `NO.${c.id}` }));
  return face;
}

export function lockedCard(cardData, { small = false } = {}) {
  const wrap = el('div', { class: `card card--locked${small ? ' card--sm' : ''}` });
  // 未取得は「カテゴリ」だけ見せる。名前・細かい分類・画像は伏せる
  wrap.append(placeholderFace({ ...cardData, name: '???', subCategory: '', cardImage: '' }));
  return wrap;
}

// 専用の裏面画像（assets/cards/_back.webp）があるかは、起動後に1回だけ確かめる
let backImagePromise = null;
function backImageSrc() {
  if (!backImagePromise) {
    backImagePromise = new Promise((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve(probe.src);
      probe.onerror = () => resolve(null);
      probe.src = './assets/cards/_back.webp';
    });
  }
  return backImagePromise;
}

export function cardBack({ small = false } = {}) {
  const wrap = el('div', { class: `card${small ? ' card--sm' : ''}` });
  const back = el('div', { class: 'cardback' }, [
    el('div', { class: 'cardback__mark', text: '志賀町\nGACHA' }),
  ]);
  back.firstChild.style.whiteSpace = 'pre-line';
  wrap.append(back);
  backImageSrc().then((src) => {
    if (!src || !wrap.isConnected) return;
    clear(wrap);
    wrap.append(el('img', { attrs: { src, alt: '' } }));
  });
  return wrap;
}

export function resolveAsset(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('./') || p.startsWith('assets/')) return p.startsWith('./') ? p : `./${p}`;
  return `./assets/cards/${p}`;
}
export function resolvePhoto(p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('./') || p.startsWith('assets/')) return p.startsWith('./') ? p : `./${p}`;
  return `./assets/details/${p}`;
}

/* ===== 触覚 ===== */
export function vibrate(pattern) {
  if (!app.state.settings.vibration) return;
  if (!('vibrate' in navigator)) return;
  try { navigator.vibrate(pattern); } catch (_) { /* 非対応端末は無視 */ }
}

/* ===== 外部リンク ===== */
const SAFE_SCHEME = /^https?:$/i;
export function safeUrl(raw) {
  try {
    const u = new URL(raw, location.href);
    return SAFE_SCHEME.test(u.protocol) ? u.href : '';
  } catch (_) { return ''; }
}
export function mapsSearchUrl(word) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(word)}`;
}
export function mapsDirUrl(lat, lng, label) {
  const q = `${lat},${lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}${label ? `&query_place_id=` : ''}`;
}
export function externalLink(label, url, cls = 'btn btn--block') {
  const safe = safeUrl(url);
  if (!safe) return null;
  return el('a', {
    class: cls, text: label,
    attrs: { href: safe, target: '_blank', rel: 'noopener noreferrer' },
  });
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
export const reduceMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
