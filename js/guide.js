/* guide.js — 画面を初めて開いたときに1回だけ出す案内。
   カードを見るとき（js/card-3d.js の tut3d）と同じ考え方で、動く絵・見出し・説明を重ねて出す。
   こちらは説明が長めなので、自動では消さず、画面をタップすると閉じる。

   使い方: showGuide('mapGuideShown', { title, lines, icon: 'pin' | 'star' | 'coin', action: { label, onClick } })
   action を渡すと、閉じる代わりにそのボタンで別の画面へ案内できる（ガチャ画面 → ミッション画面など）。
   flags に同じ名前の記録を持ち、見せたら true にする。

   ほかの演出（起動画面・ガチャ・称号の獲得・お知らせ）と重ならないよう、
   それらが出ているあいだは待つ。待っているうちに別の画面へ移ったら出さない（記録もしない）。 */

import { app, commit } from './state.js';
import { el } from './dom.js';

const ICONS = {
  // 地図のピン（タブの「まち巡り」と同じ形）
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.4S19 14.3 19 9.9A7 7 0 0 0 5 9.9c0 4.4 7 11.5 7 11.5z" fill="#2f6f8f" stroke="#2b2722" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke"/><circle cx="12" cy="9.8" r="2.7" fill="#fff8ec" stroke="#2b2722" stroke-width="1.5"/></svg>',
  // 星とチェック（タブの「ミッション」と同じ形）
  // SHIKA COIN（ガチャ画面の案内）
  coin: '<img src="./assets/icons/coin.png" alt="" width="48" height="48">',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.1 2.65 5.4 5.95.87-4.3 4.2 1.01 5.93L12 16.7l-5.31 2.8 1.01-5.93-4.3-4.2 5.95-.87z" fill="#e0a93a" stroke="#2b2722" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke"/><path d="m9.9 11.9 1.6 1.7 3.1-3.4" fill="none" stroke="#fff8ec" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function busy() {
  const boot = document.getElementById('boot');
  if (boot && !boot.hidden) return true;                        // 起動画面
  if (document.body.classList.contains('is-drawing')) return true;   // ガチャ・称号の獲得
  if (document.querySelector('.titlefly')) return true;
  const overlay = document.getElementById('overlay');
  if (overlay && !overlay.hidden) return true;                  // お知らせ・ダイアログ
  return false;
}

/**
 * @param {string} flag  app.state.flags の記録の名前
 * @param {{title:string, lines:string[], icon?:string}} opts
 */
export function showGuide(flag, { title, lines = [], icon = 'pin', action = null } = {}) {
  if (!app.state || app.state.flags[flag]) return;
  const hash = location.hash;
  let tries = 0;

  const attempt = () => {
    if (location.hash !== hash) return;           // 別の画面へ移った
    if (app.state.flags[flag]) return;
    if (document.querySelector('.guide')) return; // すでに出ている
    if (busy()) {
      if (++tries < 60) setTimeout(attempt, 500); // 最大30秒ほど待つ
      return;
    }

    let guide = null;
    const close = () => {
      if (!guide) return;
      guide.classList.add('is-out');
      const g = guide;
      setTimeout(() => g.remove(), 260);
      window.removeEventListener('hashchange', close);
    };
    const card = el('div', { class: 'guide__card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': title } });
    card.append(el('div', { class: 'guide__demo', html: ICONS[icon] || ICONS.pin }));
    card.append(el('div', { class: 'guide__title', text: title }));
    for (const line of lines) card.append(el('p', { class: 'guide__line', text: line }));
    if (action) {
      const btn = el('button', { class: 'btn btn--primary btn--block guide__btn', attrs: { type: 'button' }, text: action.label });
      btn.addEventListener('click', (e) => { e.stopPropagation(); close(); action.onClick(); });
      card.append(btn);
    }
    card.append(el('div', { class: 'guide__tap', text: action ? 'ほかの場所をタップして閉じる' : 'タップして閉じる' }));

    guide = el('div', { class: 'guide' }, [card]);
    guide.addEventListener('click', close);
    window.addEventListener('hashchange', close, { once: true });
    document.body.append(guide);
    commit((s) => { s.flags[flag] = true; });
  };

  // 画面が描き終わって落ち着いてから出す（称号の獲得演出が始まるかどうかも、この間に分かる）
  setTimeout(attempt, 600);
}
