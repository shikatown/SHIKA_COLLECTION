/* coin-fly.js — SHIKA COIN を受け取ったときの演出。
   受け取りボタンの所から、コインが少しずつ間をあけて右上の枚数表示のコインへ飛んでいく。
   同じ道すじを続けて飛ぶので、飛んでいるあいだに一直線の列になる。
   1枚届くたびに、右上の枚数がメーターのように少しずつ増える。
   10枚受け取れば10枚、1枚なら1枚が飛ぶ（多いときは20枚までにまとめる）。

   使い方（受け取る処理の前後で呼ぶ）
     const from = ボタン.getBoundingClientRect();
     holdCoins();                 // 右上の数字をいまの値で止める（受け取りで先に変わらないように）
     const got = 受け取る();
     if (!got) { releaseCoins(); return; }
     flyCoins(from, got);         // 飛ばして、数字を増やしていく

   続けて押しても、前の演出が終わってから次が始まる（数字が行ったり来たりしない）。 */

import { app } from './state.js';
import { reduceMotion } from './ui.js';
import { sfx } from './sound.js';

const COIN_SRC = './assets/icons/coin-sm.png';
const MAX_COINS = 20;
const SIZE = 22;          // 飛ぶコインの大きさ(px)

let queue = Promise.resolve();
let pendingRuns = 0;

const stat = () => document.getElementById('statCoins');
const number = () => { const s = stat(); return s ? s.querySelector('b') : null; };

/** 右上の数字を、いま見えている値で止めておく。止めているあいだは app.js の表示更新が数字を書き換えない。 */
export function holdCoins() {
  const s = stat();
  const b = number();
  if (!s || !b) return;
  if (s.dataset.hold == null) s.dataset.hold = b.textContent;
}

/** 飛ばすものが無かったとき（受け取れなかった等）に、止めていた数字を戻す */
export function releaseCoins() {
  if (pendingRuns > 0) return;
  const s = stat();
  const b = number();
  if (!s || !b) return;
  delete s.dataset.hold;
  b.textContent = String(app.state.coins);
}

/**
 * @param {DOMRect} from 飛び始める場所（押したボタンの位置）
 * @param {number} amount 受け取った枚数
 */
export function flyCoins(from, amount) {
  pendingRuns += 1;
  const run = () => fly(from, amount).finally(() => {
    pendingRuns -= 1;
    if (pendingRuns === 0) releaseCoins();
  });
  queue = queue.then(run, run);
  return queue;
}

function bump() {
  const s = stat();
  if (!s) return;
  s.classList.remove('is-bump');
  void s.offsetWidth;
  s.classList.add('is-bump');
}

async function fly(from, amount) {
  const s = stat();
  const b = number();
  if (!s || !b || !amount) return;
  const icon = s.querySelector('.coinico') || s;
  const base = Number(s.dataset.hold != null ? s.dataset.hold : b.textContent) || 0;
  const show = (v) => { s.dataset.hold = String(v); b.textContent = String(v); };

  const n = Math.max(1, Math.min(MAX_COINS, Math.round(amount)));
  // 1枚ずつの増え方。端数は最後の1枚で合わせる
  const step = Math.floor(amount / n);

  const to = icon.getBoundingClientRect();
  const tx = to.left + to.width / 2;
  const ty = to.top + to.height / 2;
  const sx = from.left + from.width / 2;
  const sy = from.top + from.height / 2;

  if (reduceMotion()) {
    // 動きを減らす設定では飛ばさず、数字だけを手早く増やす
    for (let k = 1; k <= n; k++) {
      show(k === n ? base + amount : base + step * k);
      await new Promise((r) => setTimeout(r, 30));
    }
    bump();
    return;
  }

  /* ボタンの所から、少しずつ間をあけて同じ道すじを飛ばす。飛んでいるあいだに一直線の列になる。
     （以前は目的地と反対向きに並べてから飛ばしていたが、ボタンが画面の下にあると
     列が画面の外やタブの裏まで伸びてしまった） */

  const layer = document.createElement('div');
  layer.className = 'coinfly';
  document.body.append(layer);

  const GAP = n > 10 ? 55 : 75;   // 1枚ずつ飛び立つ間隔(ms)
  const APPEAR = GAP;             // 現れるのも同じ間隔で（ボタンの所でぽんと出てから飛ぶ）
  const FORMED = 170;             // 現れてから飛び立つまで(ms)
  const TRAVEL = 480;             // 目的地までの時間(ms)

  const jobs = [];
  for (let k = 0; k < n; k++) {
    const x0 = sx - SIZE / 2;
    const y0 = sy - SIZE / 2;
    const x1 = tx - SIZE / 2;
    const y1 = ty - SIZE / 2;
    const appear = k * APPEAR;
    const depart = appear + FORMED;
    const dur = depart + TRAVEL - appear;

    const img = document.createElement('img');
    img.className = 'coinfly__coin';
    img.src = COIN_SRC;
    img.alt = '';
    layer.append(img);

    const at = (x, y, sc, op) => ({ transform: `translate(${x}px,${y}px) scale(${sc})`, opacity: op });
    const anim = img.animate([
      { ...at(x0, y0, 0, 0), offset: 0 },
      { ...at(x0, y0 - 6, 1.15, 1), offset: Math.min(0.99, 110 / dur), easing: 'ease-out' },
      { ...at(x0, y0, 1, 1), offset: Math.min(0.995, 170 / dur) },
      { ...at(x0, y0, 1, 1), offset: (depart - appear) / dur, easing: 'cubic-bezier(.5,0,.85,.45)' },
      { ...at(x1, y1, 0.55, 1), offset: 1 },
    ], { duration: dur, delay: appear, fill: 'forwards' });

    jobs.push(anim.finished.then(() => {
      img.remove();
      // 届くたびに数字を増やす（メーターのように）
      show(k === n - 1 ? base + amount : base + step * (k + 1));
      bump();
      if (k % 2 === 0 || k === n - 1) sfx.coinTick();
    }).catch(() => { img.remove(); }));
  }
  await Promise.all(jobs);
  layer.remove();
}
