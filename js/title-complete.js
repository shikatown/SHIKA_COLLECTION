/* title-complete.js — 称号を獲得したときの演出（すべての称号）。
   グルメマスター／スポットマスター／文化マスター／志賀町ファンクラブ／志賀町マスター／志賀町コンプリート。
   称号を獲得したら、1つずつ、1回だけ出す。

   流れ
     ① ホームへ移り、画面を暗くする
     ② 真ん中に「？？？」の称号が飛び出す
     ③ くるくる回って表になり、光が広がって「称号獲得！」
     ④ ホームの称号の枠へ飛んでいき、パチーンとはまる

   なめらかにするために（v1.46）
   ・枠へ飛ぶ動きは、その時点の見た目から Web Animations で動かす（途中で大きさが跳ばない）
   ・枠のところだけ照らすのは、別の丸い部品を透明度だけで出し入れする（幕の描き直しをしない）
   ・飛んでいるあいだは、後ろで回る光を止める
   ・はまったときの光の輪は、大きさと透明度だけで広げる

   見せた称号は state.titlesCelebrated に残す（志賀町コンプリートは flags.completeCelebrated も）。
   この仕組みができる前から持っていた称号は、はじめて確かめたときに「見せた」ことにする（急に演出が並ばないように）。
   管理モードからは celebrateComplete({ preview: true }) で、状態を変えずに見られる。 */

import { app, commit } from './state.js';
import { go } from './router.js';
import { el, vibrate, reduceMotion, sleep } from './ui.js';
import { sfx, unlock } from './sound.js';
import { titles, COMPLETE_TITLE } from './rewards.js';
import { titleInfos, titleCelebrated } from './titles.js';

export const COMPLETE_IMG = './assets/icons/title-complete.png';

let running = false;
let retryTimer = 0;

/** 演出を出してよいか（ガチャの演出中・結果の確認中・起動画面・お知らせ・案内のあいだは待つ） */
function busy() {
  const s = app.state;
  if (document.hidden) return true;   // LINE などを開いて離れているあいだは出さない（戻ってきてから）
  if (s.pendingResult) return true;
  if (document.body.classList.contains('is-drawing')) return true;
  const boot = document.getElementById('boot');
  if (boot && !boot.hidden) return true;
  const overlay = document.getElementById('overlay');
  if (overlay && !overlay.hidden) return true;
  if (document.querySelector('.guide, .snapfly, .viewer3d')) return true;   // 案内・枠にはめる演出・3Dで見る画面
  return false;
}

/**
 * 獲得したのにまだ演出を見せていない称号があれば、1つずつ出す。
 * 画面を移ったとき・起動したとき・チェックインのあと・ガチャの結果を閉じたとき・ファンクラブに登録したときに呼ぶ。
 */
export function maybeCelebrateTitles() {
  const s = app.state;
  if (running || !s || !app.cards) return;
  // この仕組みができる前から持っていた称号は、見せたことにする
  if (!Array.isArray(s.titlesCelebrated)) {
    const got = titles().filter((n) => n !== COMPLETE_TITLE || s.flags.completeCelebrated);
    commit((st) => { st.titlesCelebrated = got; });
    return;
  }
  const waiting = titleInfos().filter((t) => t.earned && !titleCelebrated(t.name));
  if (!waiting.length) return;
  if (busy()) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(maybeCelebrateTitles, 1200);   // 落ち着いたらもう一度
    return;
  }
  celebrateTitle(waiting[0]);
}

/** 以前の呼び出し口（志賀町コンプリートだけだったころ） */
export const maybeCelebrateComplete = maybeCelebrateTitles;

/** 管理モードの確認用：志賀町コンプリートの演出を、状態を変えずに見る */
export function celebrateComplete({ preview = false } = {}) {
  const t = titleInfos().find((x) => x.name === COMPLETE_TITLE);
  if (t) celebrateTitle(t, { preview });
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

/** ホームの称号の枠 */
function slotOf(name) {
  return [...document.querySelectorAll('.hometitle')].find((b) => b.dataset.title === name) || null;
}

/** 演出が終わるまで、枠を「まだ獲得していない」見た目にしておく（先に絵が見えてしまわないように） */
function lockSlot(slot, t) {
  if (!slot) return;
  slot.classList.remove('is-on', 'is-snapped');
  const ring = slot.querySelector('.hometitle__ring');
  if (!ring) return;
  if (t.kind === 'complete') ring.replaceChildren(el('span', { class: 'hometitle__q', text: '？' }));
}

/** 枠の見た目を「獲得済み」にする（絵を入れる） */
function markSlot(slot, t) {
  if (!slot) return;
  slot.classList.add('is-on');
  const ring = slot.querySelector('.hometitle__ring');
  if (!ring) return;
  // すでに同じ絵が入っていれば作り直さない（はまる瞬間に絵を読み直すとカクつく）
  const img = ring.querySelector('img');
  if (img && img.getAttribute('src') === t.icon) return;
  ring.replaceChildren(el('img', { attrs: { src: t.icon, alt: '' } }));
}

/** 表の絵が丸い（枠いっぱいに出す）称号 */
const roundArt = (t) => t.kind === 'complete' || t.kind === 'fanclub';

export async function celebrateTitle(t, { preview = false } = {}) {
  if (running) return;
  running = true;
  const quick = reduceMotion();
  const art = t.big[0];
  await loadImage(art, 3000);

  // ① ホームへ（すでに開いていても描き直す）
  go('#/home', true);
  await sleep(380);
  const slot = slotOf(t.name);
  lockSlot(slot, t);
  if (slot) slot.scrollIntoView({ block: 'center' });
  document.body.classList.add('is-drawing');

  const front = el('div', { class: `titlefly__face titlefly__face--front${roundArt(t) ? ' is-round' : ''}` }, [
    el('img', { attrs: { src: art, alt: '' } }),
  ]);
  const badge = el('div', { class: 'titlefly__badge' }, [
    el('div', { class: 'titlefly__face titlefly__face--back' }, [el('span', { text: '？？？' })]),
    front,
  ]);
  const text = el('div', { class: 'titlefly__text' }, [
    el('small', { text: '称号獲得！' }),
    el('b', { text: t.name }),
  ]);
  const spot = el('div', { class: 'titlefly__spot' });
  const fly = el('div', { class: 'titlefly', attrs: { role: 'dialog', 'aria-label': `称号「${t.name}」を獲得しました` } }, [
    el('div', { class: 'titlefly__veil' }),
    spot,
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
    if (r && badge.offsetWidth && !quick) {
      // ④ 枠へ飛ぶ。いまの見た目（回転・脈打ちの途中の大きさ）を起点にして、途中で跳ばないようにする
      const from = getComputedStyle(badge).transform;
      const layout = badge.getBoundingClientRect();
      const cx = layout.left + layout.width / 2;
      const cy = layout.top + layout.height / 2;
      const dx = (r.left + r.width / 2) - cx;
      const dy = (r.top + r.height / 2) - cy;
      const fs = r.width / badge.offsetWidth;
      badge.style.animation = 'none';
      badge.style.transition = 'none';
      badge.style.transform = from === 'none' ? 'none' : from;
      // 枠のところだけ照らす丸い部品を、枠の上に置いて透明度だけで出す
      spot.style.left = `${r.left + r.width / 2}px`;
      spot.style.top = `${r.top + r.height / 2}px`;
      spot.style.width = `${r.width * 1.5}px`;
      spot.style.height = `${r.width * 1.5}px`;
      fly.classList.add('is-fly');
      const anim = badge.animate([
        { transform: from === 'none' ? 'translate(0,0) scale(1)' : from },
        { transform: `translate(${dx}px, ${dy}px) scale(${fs * 1.15})`, offset: 0.82 },
        { transform: `translate(${dx}px, ${dy}px) scale(${fs})` },
      ], { duration: 720, easing: 'cubic-bezier(.55,0,.25,1)', fill: 'forwards' });
      try { await anim.finished; } catch (_) { /* 途中で消えたとき */ }
    }
    markSlot(slot, t);
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
    badge.style.opacity = '0';   // 枠の中の本物の絵に入れ替わる
    await sleep(quick ? 400 : 600);
    // 保存は「パチーン」の動きが終わってから（はまる瞬間に保存の書き込みが重なるとカクつく）
    if (!preview) {
      commit((st) => {
        if (!Array.isArray(st.titlesCelebrated)) st.titlesCelebrated = [];
        if (!st.titlesCelebrated.includes(t.name)) st.titlesCelebrated.push(t.name);
        if (t.kind === 'complete') st.flags.completeCelebrated = true;
      });
    }
    await sleep(quick ? 0 : 400);
    fly.classList.add('is-out');
    await sleep(420);
    fly.remove();
    document.body.classList.remove('is-drawing');
    running = false;
    if (preview) {
      // 確認用なので、少し見せたら本当の状態に戻す
      setTimeout(() => { if (location.hash === '#/home') go('#/home', true); }, 2600);
    } else {
      // ほかにも見せていない称号があれば、続けて出す
      setTimeout(maybeCelebrateTitles, 900);
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
