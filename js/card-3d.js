/* card-3d.js — カード鑑賞専用の3Dビューア。
   ・説明文は出さない（情報は詳細画面の役割）
   ・画像そのものは加工せず、光沢・影は独立レイヤーで重ねる
   ・振動なし／ジャイロ不使用 */

import { app, isOwned } from './state.js';
import { el, clear, cardFace, cardBack, vibrate } from './ui.js';
import { commit } from './state.js';

const MAX_X = 26;          // 上下の傾き上限（度）
const SPIN_LIMIT = 900;    // 回転速度の上限（度/秒相当）

let root = null;
let session = null;

export function openViewer(cardId, listIds = null) {
  close();
  const ids = (listIds && listIds.length ? listIds : app.state.ownedCardIds)
    .filter((id) => app.cardsById.has(id) && isOwned(id));
  const list = ids.length ? Array.from(new Set(ids)) : [cardId];
  const index = Math.max(0, list.indexOf(cardId));
  session = { list, index };
  build();
  document.body.style.overflow = 'hidden';
}

export function close() {
  if (root) { root.remove(); root = null; }
  session = null;
  document.body.style.overflow = '';
}

function build() {
  root = el('div', { class: 'viewer3d' });

  root.append(el('button', {
    class: 'viewer3d__close', attrs: { type: 'button', 'aria-label': '閉じる' },
    html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    on: { click: close },
  }));

  const caption = el('div', { class: 'viewer3d__caption' });
  const stage = el('div', { class: 'stage3d' });
  const shadow = el('div', { class: 'stage3d__shadow' });
  const card = el('div', { class: 'card3d' });
  stage.append(shadow, card);

  root.append(caption, stage);
  root.append(el('div', { class: 'viewer3d__hint', text: '指でドラッグして回す・ダブルタップで正面へ' }));

  const nav = el('div', { class: 'viewer3d__nav' });
  const prev = el('button', { attrs: { type: 'button' }, text: '前のカード' });
  const next = el('button', { attrs: { type: 'button' }, text: '次のカード' });
  nav.append(prev, next);
  root.append(nav);

  // 背景タップで閉じる
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });

  document.body.append(root);

  const view = { card, shadow, caption, prev, next };
  render(view);
  prev.addEventListener('click', () => { session.index = (session.index - 1 + session.list.length) % session.list.length; render(view); });
  next.addEventListener('click', () => { session.index = (session.index + 1) % session.list.length; render(view); });
  if (session.list.length < 2) { prev.disabled = true; next.disabled = true; }

  attachInteraction(card, shadow);
  maybeShowTutorial();
  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  if (!root) return;
  if (e.key === 'Escape') close();
}

function render(view) {
  const id = session.list[session.index];
  const c = app.cardsById.get(id);
  if (!c) return;
  view.caption.textContent = c.name;
  clear(view.card);

  const front = el('div', { class: 'card3d__side card3d__side--front' });
  front.append(cardFace(c));
  front.append(el('div', { class: 'card3d__sheen' }));
  front.append(el('div', { class: 'card3d__glint' }));   // 左から右へ走る光（CSSで繰り返す）

  const back = el('div', { class: 'card3d__side card3d__side--back' });
  back.append(cardBack());
  back.append(el('div', { class: 'card3d__sheen' }));

  view.card.append(el('div', { class: 'card3d__edge' }), back, front);

  // 開いた直後だけ軽く傾けてから正面へ、光沢を1往復
  view.card.classList.add('is-easing');
  apply(view.card, view.shadow, { x: -8, y: -16 });
  requestAnimationFrame(() => {
    setTimeout(() => apply(view.card, view.shadow, { x: 0, y: 0 }), 30);
  });
}

/* ===== 操作 ===== */
function attachInteraction(card, shadow) {
  let rot = { x: 0, y: 0 };
  let drag = null;
  let vel = 0;
  let raf = 0;
  let lastTap = 0;

  const set = (r) => { rot = r; apply(card, shadow, rot); };

  card.addEventListener('pointerdown', (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {                 // ダブルタップで正面へ
      lastTap = 0;
      card.classList.add('is-easing');
      set({ x: 0, y: 0 });
      return;
    }
    lastTap = now;
    card.setPointerCapture(e.pointerId);
    card.classList.remove('is-easing');
    cancelAnimationFrame(raf);
    drag = { px: e.clientX, py: e.clientY, t: now, vel: 0 };
  });

  card.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;
    const dt = Math.max(16, Date.now() - drag.t);
    drag.vel = (dx / dt) * 1000 * 0.35;
    drag.px = e.clientX; drag.py = e.clientY; drag.t = Date.now();
    const nx = clamp(rot.x - dy * 0.35, -MAX_X, MAX_X);
    set({ x: nx, y: rot.y + dx * 0.55 });
  });

  const end = () => {
    if (!drag) return;
    vel = clamp(drag.vel, -SPIN_LIMIT, SPIN_LIMIT);
    drag = null;
    spin();
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
  card.addEventListener('lostpointercapture', end);

  function spin() {
    const step = () => {
      vel *= 0.94;                              // 減衰（回し続けない）
      const y = rot.y + vel * 0.016;
      const x = rot.x * 0.90;                   // 上下は少しずつ水平へ戻る
      set({ x, y });
      if (Math.abs(vel) > 6) raf = requestAnimationFrame(step);
      else {
        vel = 0;
        // 表裏どちらかの面へ静かに寄せる
        card.classList.add('is-easing');
        const snapped = Math.round(rot.y / 180) * 180;
        set({ x: 0, y: snapped });
      }
    };
    raf = requestAnimationFrame(step);
  }
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function apply(card, shadow, rot) {
  card.style.transform = `rotateX(${rot.x.toFixed(2)}deg) rotateY(${rot.y.toFixed(2)}deg)`;
  const yr = ((rot.y % 360) + 360) % 360;
  const facing = yr < 90 || yr > 270;
  // 光沢の位置を角度に追従させる
  const layer = card.querySelector(facing ? '.card3d__side--front .card3d__sheen' : '.card3d__side--back .card3d__sheen');
  if (layer) layer.style.setProperty('--sheen', `${clamp(50 + rot.y * 0.6 + rot.x * 0.4, 0, 100)}%`);
  // 影は傾きに応じて伸び縮み
  const t = Math.abs(Math.sin((rot.y * Math.PI) / 180));
  shadow.style.opacity = String(0.75 - t * 0.35);
  shadow.style.transform =
    `translate(calc(-50% + ${(rot.y % 180) * 0.12}px), calc(var(--c3w) * 0.66)) scaleX(${(1 - t * 0.3).toFixed(3)})`;
}

/* ===== 初回だけの操作案内 ===== */
function maybeShowTutorial() {
  if (app.state.flags.tutorial3dShown) return;
  const tut = el('div', { class: 'tut3d' });
  const inner = el('div');
  inner.append(el('div', { class: 'tut3d__demo' }));
  inner.append(el('div', { text: 'カードを動かしてみよう' }));
  inner.append(el('div', { text: '指で回すと、裏側まで見ることができます', style: { fontSize: '12.5px', opacity: '.8' } }));
  tut.append(inner);
  tut.addEventListener('click', () => tut.remove());
  root.append(tut);
  commit((s) => { s.flags.tutorial3dShown = true; });
  setTimeout(() => tut.remove(), 3800);
}
