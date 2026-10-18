/* trivia.js — ミッション「読んで知ろう！志賀町」。志賀町の豆知識30話を、本をめくって読む。

   決めごと
   ・文章は data/trivia.json（提供された Excel から起こしたもの）。順番・見出し・本文は変えない
   ・1話をはじめて読み終えるたびに +1 SHIKA COIN。30話で合計30枚。受け取りボタンは無く、その場で入る
   ・「読んだ」とみなすのは、そのページが出そろった（開く／めくる動きが終わった）とき。
     先に用意しただけの裏のページや、出し終える前に閉じたページは数えない
   ・同じ話で二度はもらえない（state.triviaRead に話のID）。読み直しは何度でもできる
   ・最後に見たページを覚えておき、次に開いたらそこから（state.triviaPage）
   ・コインの入り方・音・飛んでいく演出は、ほかのミッションと同じ仕組みを使う（coin-fly.js）

   画面
   ・入口はもらった本の絵をそのままボタンにする（絵の上に文字は重ねない）。進み具合は絵の下に文字で出す
   ・ポップアップは ui.js の dialog（閉じるボタンの見た目・位置・操作はほかと同じ）。
     中は表紙・背・小口を描いた本の形にする（css/app.css の .book__cover）
   ・めくる動きは、紙が回って裏返る形。裏返った字が見えないよう、表と裏を別の面にする
   ・動きを減らす設定の端末では、めくらずに切り替える */

import { app, commit, saveOk } from './state.js';
import { el, clear, toast, dialog, reduceMotion, sleep } from './ui.js';
import { sfx, unlock } from './sound.js';
import { holdCoins, releaseCoins, flyCoins } from './coin-fly.js';
import { trackEvent } from './analytics.js';

export const TRIVIA_TITLE = '読んで知ろう！志賀町';
const BOOK_IMAGE = './assets/icons/web/trivia-book.webp';
const BOOK_IMAGE_FALLBACK = './assets/icons/trivia-book.png';
const FLIP_MS = 460;          // めくるのにかける時間
let items = null;             // 読み込んだ豆知識
let loading = null;
let open = false;             // 本を開いている最中か（続けて押しても二重に開かない）

/** 1話あたりのコイン（config.json の mission.trivia で変えられる） */
function coinsPer() {
  const m = (app.config && app.config.mission) || {};
  return m.trivia != null ? m.trivia : 1;
}

/** 豆知識を読み込む（1回だけ。通信が切れていても Service Worker の控えから返る） */
export async function loadTrivia() {
  if (items) return items;
  if (!loading) {
    loading = fetch('./data/trivia.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        items = (d.items || []).filter((t) => t && t.id && t.title && t.body);
        return items;
      })
      .catch(() => { loading = null; return null; });
  }
  return loading;
}

/** 読んだ話のID（保存データ） */
function readIds() {
  const s = app.state;
  return Array.isArray(s.triviaRead) ? s.triviaRead : [];
}

/** 進み具合。total は読み込めていなければ 30 として見せる */
export function triviaStats() {
  const total = items ? items.length : 30;
  const read = readIds().length;
  return { read: Math.min(read, total), total, coins: Math.min(read, total) * coinsPer(), maxCoins: total * coinsPer() };
}

/**
 * ミッション画面に置く入口（本の絵のボタンと、進み具合の文字）。
 * @param {HTMLElement} view ミッション画面
 * @param {() => void} [onClose] 本を閉じたときに呼ぶ（進み具合を描き直すため）
 */
export function triviaPanel(view, onClose) {
  const p = el('div', { class: 'trivia' });
  const btn = el('button', {
    class: 'trivia__btn', attrs: { type: 'button', 'aria-label': `${TRIVIA_TITLE}（全30話）を開く` },
  });
  const img = el('img', {
    class: 'trivia__img',
    attrs: { src: BOOK_IMAGE, alt: '知ってる？ 志賀町のこと 全30話', decoding: 'async' },
  });
  img.addEventListener('error', () => { if (img.getAttribute('src') !== BOOK_IMAGE_FALLBACK) img.src = BOOK_IMAGE_FALLBACK; }, { once: true });
  btn.append(img);
  btn.addEventListener('click', () => openTriviaBook(view, { onClose }));
  p.append(btn);

  const st = triviaStats();
  const lines = el('div', { class: 'trivia__state' });
  lines.append(el('span', { class: 'trivia__line' }, [
    el('span', { text: '読んだ数' }),
    el('b', { text: `${st.read} / ${st.total}` }),
  ]));
  lines.append(el('span', { class: 'trivia__line' }, [
    el('span', { text: '獲得済み' }),
    el('b', { text: `${st.coins} / ${st.maxCoins} コイン` }),
  ]));
  p.append(lines);
  return p;
}

/** ページの中身（見出し・本文・番号）を作る */
function pageFace(t, idx, total) {
  const face = el('div', { class: 'book__face' });
  face.append(el('div', { class: 'book__no', text: `${idx + 1} / ${total}` }));
  face.append(el('h4', { class: 'book__t', text: t.title }));
  face.append(el('div', { class: 'book__b' }, [el('p', { text: t.body })]));
  return face;
}

/**
 * 本を開く。閉じるまでこの中でページを進める。
 * @param {HTMLElement} view ミッション画面（閉じたら進み具合を描き直す）
 * @param {{start?:number}} [opts] start=開くページ（無ければ前回の続き）
 */
export async function openTriviaBook(view, opts = {}) {
  if (open) return;
  const list = await loadTrivia();
  if (!list || !list.length) {
    await dialog({
      title: TRIVIA_TITLE,
      body: ['豆知識を読み込めませんでした。通信できるところで、もう一度お試しください。'],
      actions: [{ label: '閉じる', value: null, primary: true }],
    });
    return;
  }
  if (open) return;
  open = true;
  unlock();
  const total = list.length;
  const saved = Number(app.state.triviaPage);
  let idx = Number.isInteger(opts.start) ? opts.start : (Number.isFinite(saved) ? saved : 0);
  idx = Math.min(Math.max(0, Math.floor(idx)), total - 1);

  let closed = false;
  let flipping = false;

  /* 本の見た目：表紙（濃い緑）の中に紙を1枚置き、左に背（綴じ）、右に小口（紙の重なり）を描く。
     めくる紙は表紙の中で回るので、綴じのところへ吸い込まれるように見える。 */
  const book = el('div', { class: 'book' });
  const cover = el('div', { class: 'book__cover' });
  cover.append(el('span', { class: 'book__ribbon', attrs: { 'aria-hidden': 'true' } }));
  const stage = el('div', { class: 'book__stage' });
  const page = el('div', { class: 'book__page' }, [pageFace(list[idx], idx, total)]);
  stage.append(page);
  cover.append(stage);
  book.append(cover);

  const nav = el('div', { class: 'book__nav' });
  const prev = el('button', { class: 'book__arrow', attrs: { type: 'button', 'aria-label': '前の豆知識' }, text: '＜' });
  const count = el('span', { class: 'book__count', text: `${idx + 1} / ${total}` });
  const next = el('button', { class: 'book__arrow', attrs: { type: 'button', 'aria-label': '次の豆知識' }, text: '＞' });
  nav.append(prev, count, next);
  book.append(nav);

  const updateNav = () => {
    prev.disabled = flipping || idx === 0;
    next.disabled = flipping || idx === total - 1;
    count.textContent = `${idx + 1} / ${total}`;
  };
  updateNav();

  /** 表示し終えたページを「読んだ」ことにして、はじめてならコインを渡す */
  const finishPage = (at) => {
    if (closed) return;                       // 出し終える前に閉じたページは数えない
    commit((s) => { s.triviaPage = at; });    // 続きから開けるように覚えておく
    const t = list[at];
    if (!t || readIds().includes(t.id)) return;   // 2度目からはコインを渡さない
    const add = coinsPer();
    const box = page.getBoundingClientRect();
    holdCoins();
    commit((s) => {
      if (!Array.isArray(s.triviaRead)) s.triviaRead = [];
      if (s.triviaRead.includes(t.id)) return;
      s.triviaRead.push(t.id);
      s.coins += add;
    });
    if (!saveOk()) { releaseCoins(); return; }    // 保存できなければ、もらっていないことにする
    sfx.coin();
    toast(`+${add} SHIKA COIN`);
    flyCoins(box, add);
    trackEvent('trivia_read', { read: readIds().length });
  };

  /**
   * ページをめくる。dir=1 で次、dir=-1 で前。
   * めくっているあいだは押せない（連打しても飛ばない・番号がずれない）。
   */
  const turn = async (dir) => {
    if (flipping || closed) return;
    const to = idx + dir;
    if (to < 0 || to >= total) return;
    flipping = true;
    updateNav();

    const fromFace = page.firstElementChild;
    const toFace = pageFace(list[to], to, total);

    if (reduceMotion()) {
      page.replaceChildren(toFace);
      idx = to;
      flipping = false;
      updateNav();
      finishPage(idx);
      return;
    }

    // めくる紙。表＝いまのページ、裏＝次のページ。裏返った字は見えない（backface-visibility）
    const flip = el('div', { class: `book__flip book__flip--${dir > 0 ? 'next' : 'prev'}` });
    const front = el('div', { class: 'book__side book__side--front' }, [fromFace.cloneNode(true)]);
    const back = el('div', { class: 'book__side book__side--back' }, [toFace.cloneNode(true)]);
    flip.append(front, back);
    page.replaceChildren(toFace);     // 下には新しいページを置いておく（めくり終わるとぴったり重なる）
    stage.append(flip);
    // 影の濃さも動かして、紙が立ち上がって見えるようにする
    requestAnimationFrame(() => requestAnimationFrame(() => flip.classList.add('is-turning')));
    /* めくり終わりは、時間ではなく動きの終わりで判じる（端末が遅いときも、紙が倒れきってから数える）。
       動きが始まらなかったときのために、少し長めの保険も置く。 */
    await new Promise((resolve) => {
      let done = false;
      const fin = () => { if (done) return; done = true; resolve(); };
      flip.addEventListener('animationend', fin, { once: true });
      setTimeout(fin, FLIP_MS + 600);
    });
    flip.remove();

    idx = to;
    flipping = false;
    updateNav();
    finishPage(idx);
  };

  prev.addEventListener('click', () => turn(-1));
  next.addEventListener('click', () => turn(1));

  // 開いたときの1ページ目も「読んだ」に数える（開く動きが終わってから）
  const openDone = sleep(reduceMotion() ? 0 : 320).then(() => { if (!closed) finishPage(idx); });

  await dialog({
    title: TRIVIA_TITLE,
    body: [book],
    actions: [{ label: '閉じる', value: null, primary: true }],
  });
  closed = true;
  open = false;
  await openDone;
  if (typeof opts.onClose === 'function') opts.onClose();
}
