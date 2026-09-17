/* title-complete.js — 称号「志賀町コンプリート」を獲得する演出。
   すべてのカードを集め、すべてのスポットでチェックインした瞬間に1回だけ出す。

   流れ（カードが枠にはまる演出と同じ考え方）
     ① ホームへ移り、画面を暗くする（称号は v1.44 でミッション画面からホームへ移した）
     ② 真ん中に「？？？」の称号が飛び出す
     ③ くるくる回って表になり、光が広がって「称号獲得！」
     ④ ホームの称号の枠へ飛んでいき、パチーンとはまる

   管理モードからは celebrateComplete({ preview: true }) で、状態を変えずに見られる。 */

import { app, commit } from './state.js';
import { go } from './router.js';
import { el } from './dom.js';
import { vibrate, reduceMotion, sleep } from './ui.js';
import { sfx, unlock } from './sound.js';
import { isTownComplete, COMPLETE_TITLE } from './rewards.js';

export const COMPLETE_IMG = './assets/icons/title-complete.png';

let running = false;

/**
 * 条件を満たしていて、まだ演出を見せていなければ出す。
 * ガチャの演出中・結果の確認中・起動画面やお知らせが出ているあいだは出さない。
 */
export function maybeCelebrateComplete() {
  const s = app.state;
  if (running || !s || s.flags.completeCelebrated) return;
  if (!isTownComplete()) return;
  if (s.pendingResult) return;
  if (document.body.classList.contains('is-drawing')) return;
  const boot = document.getElementById('boot');
  if (boot && !boot.hidden) return;
  const overlay = document.getElementById('overlay');
  if (overlay && !overlay.hidden) return;
  /* 「見せた」の記録は、称号が枠にはまった瞬間に付ける（land の中）。
     ミッション画面は、記録が付くまで枠を「？？？」で描くので、演出の前に絵が見えてしまわない。
     演出中にもう一度呼ばれても、running で弾く。 */
  celebrateComplete();
}

function loadImage(src, ms) {
  return Promise.race([
    new Promise((resolve) => {
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = src;
    }),
    sleep(ms),
  ]);
}

/** 演出が終わるまで、ホームの称号の枠を「？」の見た目にしておく（先に絵が見えてしまわないように） */
function lockSlot(slot) {
  if (!slot) return;
  slot.classList.remove('is-on');
  const ring = slot.querySelector('.hometitle__ring');
  if (ring) ring.replaceChildren(el('span', { class: 'hometitle__q', text: '？' }));
}

/** 称号の枠の見た目を「獲得済み」にする（絵を入れる） */
function markSlot(slot) {
  if (!slot) return;
  slot.classList.add('is-on');
  const ring = slot.querySelector('.hometitle__ring');
  if (ring) ring.replaceChildren(el('img', { attrs: { src: COMPLETE_IMG, alt: '' } }));
}

export async function celebrateComplete({ preview = false } = {}) {
  if (running) return;
  running = true;
  const quick = reduceMotion();
  await loadImage(COMPLETE_IMG, 3000);

  // ① ホームへ（すでに開いていても描き直す）
  go('#/home');
  await sleep(380);
  const slot = document.querySelector('.hometitle--complete');
  lockSlot(slot);
  if (slot) slot.scrollIntoView({ block: 'center' });
  document.body.classList.add('is-drawing');

  const badge = el('div', { class: 'titlefly__badge' }, [
    el('div', { class: 'titlefly__face titlefly__face--back' }, [el('span', { text: '？？？' })]),
    el('div', { class: 'titlefly__face titlefly__face--front' }, [
      el('img', { attrs: { src: COMPLETE_IMG, alt: '' } }),
    ]),
  ]);
  const text = el('div', { class: 'titlefly__text' }, [
    el('small', { text: '称号獲得！' }),
    el('b', { text: COMPLETE_TITLE }),
  ]);
  const fly = el('div', { class: 'titlefly', attrs: { role: 'dialog', 'aria-label': `称号「${COMPLETE_TITLE}」を獲得しました` } }, [
    el('div', { class: 'titlefly__veil' }),
    el('div', { class: 'titlefly__rays' }),
    el('div', { class: 'titlefly__sparks' }, Array.from({ length: 14 }, (_, i) =>
      el('i', { style: { '--a': `${(360 / 14) * i}deg`, '--d': `${(i % 3) * 40}ms` } }))),
    badge,
    text,
  ]);
  document.body.append(fly);

  let landed = false;
  let skipTo = null;
  const wait = (ms) => new Promise((resolve) => { skipTo = resolve; setTimeout(resolve, ms); });
  fly.addEventListener('click', () => { if (skipTo) skipTo(); });

  const land = async () => {
    if (landed) return;
    landed = true;
    const box = slot && slot.querySelector('.hometitle__ring');
    const r = box ? box.getBoundingClientRect() : null;
    const b = badge.getBoundingClientRect();
    if (r && b.width && !quick) {
      // ④ 枠へ飛んでいく
      const dx = (r.left + r.width / 2) - (b.left + b.width / 2);
      const dy = (r.top + r.height / 2) - (b.top + b.height / 2);
      badge.style.setProperty('--fx', `${dx}px`);
      badge.style.setProperty('--fy', `${dy}px`);
      badge.style.setProperty('--fs', String(r.width / b.width));
      // 暗い幕は残したまま、称号の枠のところだけ丸く照らす（はまるまで目を離させない）
      fly.style.setProperty('--hx', `${r.left + r.width / 2}px`);
      fly.style.setProperty('--hy', `${r.top + r.height / 2}px`);
      fly.style.setProperty('--hr', `${r.width * 0.62}px`);
      fly.classList.add('is-fly');
      await sleep(640);
    }
    if (!preview) commit((st) => { st.flags.completeCelebrated = true; });
    markSlot(slot);
    if (slot) {
      slot.classList.remove('is-snapped');
      void slot.offsetWidth;
      slot.classList.add('is-snapped');
    }
    unlock();
    sfx.snap();
    vibrate([24, 50, 36]);
    // はまったあとも少しのあいだ照らしたままにして、枠に収まった姿を見せてから幕を上げる
    fly.classList.add('is-landed');
    await sleep(quick ? 400 : 1100);
    fly.classList.add('is-out');
    await sleep(420);
    fly.remove();
    document.body.classList.remove('is-drawing');
    running = false;
    if (preview) {
      // 確認用なので、少し見せたら本当の状態に戻す
      setTimeout(() => { if (location.hash === '#/home') go('#/home', true); }, 2600);
    }
  };

  // ② 飛び出す
  requestAnimationFrame(() => requestAnimationFrame(() => fly.classList.add('is-in')));
  unlock();
  sfx.openingLift();
  if (!quick) {
    await wait(700);
    // ③ 回って表に
    if (!landed) { fly.classList.add('is-spin'); sfx.openingDeal(); }
    await wait(1500);
  }
  if (!landed) {
    fly.classList.add('is-reveal');
    sfx.neu();
    sfx.openingLogo();
    vibrate([18, 40, 26]);
    await wait(quick ? 1400 : 1900);
  }
  await land();
}
