/* ui.js — 画面部品の共通処理（仕様書§35の推奨構成に対する追加ファイル）。
   innerHTML への値の直接流し込みは避け、テキストは textContent で入れる。 */

import { CATEGORY_LABEL, app, publishedCards } from './state.js';
import { el, clear } from './dom.js';
import { renderCardArt } from './card-render.js';

export { el, clear };

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

/**
 * カード表示。原則は部品から組み立てる（card-render.js）。
 * cards.json の cardImage に完成画像が指定されている場合だけ、それをそのまま貼る。
 * どちらも使えないときは、色と名前だけの簡易表示に落とす。
 */
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
  } else if (cardData.category) {
    wrap.classList.add('card--img');
    wrap.append(renderCardArt(cardData, { total: publishedCards().length, thumb: small }));
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

/** 未取得カードの置き場。あとからカードがはまる枠にする。
    番号と名前は枠の下（名前の行）に出すので、枠の中は「？？？」だけ。 */
export function lockedCard(cardData, { small = false } = {}) {
  const cat = cardData.category || '';
  const wrap = el('div', {
    class: `card card--slot${cat ? ` card--slot-${cat}` : ''}${small ? ' card--sm' : ''}`,
  });
  // 番号は名前の行に出しているので、枠の中は「？？？」だけにする
  wrap.append(el('span', { class: 'slot__no', text: '???' }));
  wrap.append(el('span', { class: 'slot__cat', text: CATEGORY_LABEL[cat] || '???' }));
  return wrap;
}

/* カードの裏面。用意した画像をそのまま出す。
   以前は先に「描いた裏面」を出してから画像に差し替えていたので、
   起動直後に青緑色の仮の絵がちらついていた。
   画像が読めなかったときだけ、描いた裏面に切り替える。 */
// まず軽い WebP（web/）、無ければ元の画像
const BACK_SRCS = ['./assets/cards/web/_back.webp', './assets/cards/_back.png', './assets/cards/_back.webp'];

export function cardBack({ small = false } = {}) {
  const wrap = el('div', { class: `card${small ? ' card--sm' : ''}` });
  let i = 0;
  const img = el('img', { attrs: { src: BACK_SRCS[0], alt: '', decoding: 'async' } });
  img.addEventListener('error', () => {
    i += 1;
    if (i < BACK_SRCS.length) { img.src = BACK_SRCS[i]; return; }
    clear(wrap);
    const back = el('div', { class: 'cardback' }, [
      el('div', { class: 'cardback__mark', text: '志賀町\nGACHA' }),
    ]);
    back.firstChild.style.whiteSpace = 'pre-line';
    wrap.append(back);
  });
  wrap.append(img);
  return wrap;
}

/* ===== SHIKA COIN =====
   コインの絵は用意した画像を使う。小さく出すところは軽い方（48px）を、
   記録画面など大きく出すところは 192px の方を読む。 */
const COIN_SM = './assets/icons/coin-sm.png';
const COIN_LG = './assets/icons/coin.png';

/** コインの絵だけ。 */
export function coinIcon({ big = false } = {}) {
  return el('img', {
    class: `coinico${big ? ' coinico--lg' : ''}`,
    attrs: { src: big ? COIN_LG : COIN_SM, alt: '', decoding: 'async' },
  });
}

/**
 * 「（コインの絵）123 SHIKA COIN」のひとまとまり。
 * @param {number} n 枚数
 * @param {{big?:boolean, sign?:boolean, label?:boolean}} opt
 */
export function coinAmount(n, { big = false, sign = false, label = true } = {}) {
  const wrap = el('span', { class: `coin${big ? ' coin--lg' : ''}` });
  wrap.append(coinIcon({ big }));
  wrap.append(el('b', { class: 'coin__n', text: `${sign && n > 0 ? '+' : ''}${n}` }));
  if (label) wrap.append(el('span', { class: 'coin__u', text: 'SHIKA COIN' }));
  return wrap;
}

/* ===== まち巡りの目印 =====
   ピンはタブの「まち巡り」と同じ形。訪問済みはミッションの達成と同じ「✓」。 */
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgIcon(cls, viewBox, parts) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  for (const [tag, attrs] of parts) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]);
    svg.append(n);
  }
  return svg;
}

/** 地図のピン。タブの「まち巡り」と同じ絵。 */
export function pinIcon() {
  return svgIcon('pinico', '0 0 24 24', [
    ['path', {
      d: 'M12 21.4S19 14.3 19 9.9A7 7 0 0 0 5 9.9c0 4.4 7 11.5 7 11.5z',
      fill: '#2f6f8f', stroke: '#2b2722', 'stroke-width': '1.5',
      'stroke-linejoin': 'round', 'paint-order': 'stroke',
    }],
    ['circle', {
      cx: '12', cy: '9.8', r: '2.7',
      fill: '#fff8ec', stroke: '#2b2722', 'stroke-width': '1.5',
      'stroke-linejoin': 'round', 'paint-order': 'stroke',
    }],
  ]);
}

/** 済みの印。ミッションを達成したときの「✓」と同じ見え方。 */
export function checkIcon() {
  return svgIcon('checkico', '0 0 24 24', [
    ['path', {
      d: 'M5 12.6 L10 17.4 L19 7',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '3.2',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }],
  ]);
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
/** Googleマップの経路検索。出発地は渡さない（端末の現在地が使われる）。
    座標をアプリ側に保存も送信もしない方針なので、行き先だけをURLに載せる。 */
export function mapsRouteUrl(lat, lng) {
  const q = `${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}&travelmode=driving`;
}
/** Googleマップの経路検索（複数のスポットを、渡した順に回る）。
    1つ目が出発地、最後が目的地、あいだは経由地になる（地図には全部のピンが出る）。
    ここでも現在地は渡さない（アプリは端末の位置を保存も送信もしない）。 */
export function mapsCourseUrl(points) {
  const pt = (p) => `${p.lat},${p.lng}`;
  if (!points || !points.length) return '';
  if (points.length === 1) return mapsRouteUrl(points[0].lat, points[0].lng);
  const mid = points.slice(1, -1).map(pt).join('|');
  return 'https://www.google.com/maps/dir/?api=1'
    + `&origin=${encodeURIComponent(pt(points[0]))}`
    + `&destination=${encodeURIComponent(pt(points[points.length - 1]))}`
    + (mid ? `&waypoints=${encodeURIComponent(mid)}` : '')
    + '&travelmode=driving';
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
