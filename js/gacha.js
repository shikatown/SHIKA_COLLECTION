/* gacha.js — 抽選と演出。
   演出は「すでに確定した結果」を見せるだけ。押した瞬間に
   コイン消費・抽選・保存・ボーナス確定まで終わらせる。 */

import { app, commit, publishedCards, CATEGORIES, CATEGORY_LABEL } from './state.js';
import { applyDraw, duplicateGaugeInfo, categoryProgress, dailyAvailable, claimDaily, coinCfg } from './rewards.js';
import { el, clear, cardFace, cardBack, toast, vibrate, sleep, reduceMotion, dialog, coinAmount, coinIcon } from './ui.js';
import { sfx, unlock } from './sound.js';
import { go } from './router.js';
import { openViewer } from './card-3d.js';
import { photoUrl, thumbUrl } from './card-render.js';
import { createGachaStage } from './gacha-anim.js';
import { isAdmin } from './admin.js';

export const SINGLE_COST = 1;
export const TEN_COST = 10;
/** 10連のおまけ枚数。10連は 10+1 枚出る。初回無料の10連にはつかない。 */
export const TEN_BONUS = 1;

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

/** 通常抽選：全カード同確率・重複あり（未取得優遇もカテゴリ補正もしない） */
function rollNormal(n) {
  const pool = publishedCards();
  const owned = new Set(app.state.ownedCardIds);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = pick(pool);
    const isNew = !owned.has(c.id);
    if (isNew) owned.add(c.id);
    out.push({ id: c.id, isNew });
  }
  return out;
}

/** 初回無料10連：10枚すべて重複なし、3カテゴリ最低1枚ずつ */
function rollFirstTen() {
  const pool = publishedCards();
  const byCat = {};
  for (const { key } of CATEGORIES) byCat[key] = pool.filter((c) => c.category === key);
  const chosen = [];
  const used = new Set();
  for (const { key } of CATEGORIES) {
    const list = byCat[key].filter((c) => !used.has(c.id));
    if (!list.length) continue;
    const c = pick(list);
    used.add(c.id); chosen.push(c);
  }
  const rest = pool.filter((c) => !used.has(c.id));
  while (chosen.length < 10 && rest.length) {
    const i = Math.floor(Math.random() * rest.length);
    const c = rest.splice(i, 1)[0];
    used.add(c.id); chosen.push(c);
  }
  // 並びをシャッフル（カテゴリ保証枠が先頭に固まらないように）
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
  }
  const owned = new Set(app.state.ownedCardIds);
  return chosen.map((c) => ({ id: c.id, isNew: !owned.has(c.id) }));
}

/** 押した瞬間にすべて確定させる。戻り値は演出用の確定データ。 */
export function commitDraw(kind) {
  const free = kind === 'free10' || isAdmin();   // 管理モードはコインを使わない
  // 10連はおまけつきで 11 枚。初回無料の10連は 10 枚のまま。
  const count = kind === 'single' ? 1 : (kind === 'ten' ? 10 + TEN_BONUS : 10);
  const cost = free ? 0 : (kind === 'single' ? SINGLE_COST : TEN_COST);

  if (!publishedCards().length) { toast('カードデータがありません'); return null; }
  if (!free && app.state.coins < cost) { toast('SHIKA COIN が足りません'); return null; }

  // 引き方は種類で決める（管理モードでも、1回なら1枚）
  const results = kind === 'free10' ? rollFirstTen() : rollNormal(count);
  if (kind === 'ten') {
    for (let i = results.length - TEN_BONUS; i < results.length; i++) results[i].bonus = true;
  }

  commit((s) => {
    if (cost) s.coins -= cost;
    if (kind === 'free10') s.flags.firstFreeTenDone = true;
  });

  const bonus = applyDraw(results);

  const payload = { kind, results, bonus, at: new Date().toISOString() };
  commit((s) => { s.pendingResult = payload; });
  return payload;
}

export function clearPending() { commit((s) => { s.pendingResult = null; }); }

/* ===== 画像の先読み =====
   仕様§9.5: 当落画像を先に読み込み、表示できる状態になってから演出を始める。
   カードは部品から組み立てるので、写真とジャンル共通の部品（台紙・アイコン・ロゴ）を先に読む。 */
function preload(ids) {
  /* 演出を始めるのに要るのは、カードの裏と、小さい写真・台紙だけ。
     原寸（写真は平均640KB・最大3MB、台紙やアイコンは1枚1MB超）まで待つと、
     スマホの回線では8秒近く「準備しています」のままになっていた。
     カードは小さい写真の上に原寸を重ねて、読み終わったらそっと現す作りなので、
     原寸は待たずに裏で読み始めるだけにする。 */
  const need = new Set(['./assets/cards/_back.png']);
  const later = new Set();
  for (const id of ids) {
    const c = app.cardsById.get(id);
    if (!c) continue;
    if (c.cardImage) {
      need.add(c.cardImage.startsWith('http') ? c.cardImage
        : (c.cardImage.startsWith('assets/') ? `./${c.cardImage}` : `./assets/cards/${c.cardImage}`));
      continue;
    }
    if (c.photo) {
      const small = thumbUrl(c.photo);
      if (small) need.add(small);
      later.add(photoUrl(c.photo));
    }
    if (c.category) {
      need.add(`./assets/frames/thumb/${c.category}.png`);
      need.add(`./assets/frames/thumb/icon-${c.category}.png`);
      later.add(`./assets/frames/${c.category}.png`);
    }
  }
  need.add('./assets/frames/thumb/logo.png');

  const load = (src, low) => new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    if (low) { try { img.fetchPriority = 'low'; } catch (_) { /* 未対応は無視 */ } }
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
  // 小さい部品がそろうか、1.5秒たったら始める
  const ready = Promise.race([Promise.all([...need].map((src) => load(src, false))), sleep(1500)]);
  /* 原寸は待たない。ただし小さい部品より先に読み始めると、
     ブラウザが同じサーバーへ同時に張れる接続（6本ほど）を原寸が占めてしまい、
     肝心の小さい写真が後ろで待たされる。そろってから、2本ずつ引いた順に読む。 */
  ready.then(() => {
    const queue = [...later];
    const next = () => { if (queue.length) load(queue.shift(), true).then(next); };
    next(); next();
  });
  return ready;
}

/* ===== ガチャ画面 ===== */

export function renderGacha(view) {
  clear(view);
  const s = app.state;

  /* 前回の結果が残っているときは、聞かずにそのまま結果を出す。
     演出の途中で画面を離れた場合も、次に開けばここで結果が見られる。 */
  if (s.pendingResult) {
    showResults(view, s.pendingResult);
    return;
  }

  if (!s.flags.firstFreeTenDone) {
    view.append(firstTimePanel(view));
    return;
  }

  /* 画面いっぱいに、上からコイン・カードの裏・ボタン2つを積む。
     カードの裏は、残った高さいっぱいまで大きくする（ボタンは必ず入る）。 */
  const home = el('div', { class: 'gachahome' });

  home.append(el('div', { class: 'gachahome__coin' }, [
    coinIcon({ big: true }),
    el('b', { class: 'gachahome__n', text: String(s.coins) }),
  ]));

  // たまごが孵る前のように、カードがゆらゆら揺れる
  const back = cardBack();
  back.classList.add('card--wobble');
  home.append(el('div', { class: 'gachahome__card' }, [back]));

  const freeNow = isAdmin();
  const b1 = gachaButton('シングルガチャ', SINGLE_COST, 'btn btn--lg', freeNow, () => start('single', view));
  const b10 = gachaButton('10連ガチャ', TEN_COST, 'btn btn--lg btn--primary', freeNow, () => start('ten', view));
  if (!freeNow && s.coins < SINGLE_COST) b1.disabled = true;
  if (!freeNow && s.coins < TEN_COST) b10.disabled = true;

  // 10連には「1枚おトク」の吹き出しをつける
  const tenWrap = el('div', { class: 'gachabtn' }, [
    b10,
    el('span', { class: 'gachabtn__pop', attrs: { 'aria-hidden': 'true' } }, [
      el('b', { text: `${TEN_BONUS}枚おトク！` }),
      el('small', { text: `${10 + TEN_BONUS}枚出ます` }),
    ]),
  ]);
  b10.setAttribute('aria-label', `10連ガチャ ${TEN_COST} SHIKA COIN。${TEN_BONUS}枚おまけで${10 + TEN_BONUS}枚出ます`);

  home.append(el('div', { class: 'gachahome__acts' }, [b1, tenWrap]));
  view.append(home);

  if (!freeNow && s.coins < SINGLE_COST) view.append(shortOfCoins());
  else if (!freeNow && s.coins < TEN_COST) view.append(shortOfCoins(true));
}

/** ガチャのボタン。名前の右に、値段を「コインの絵＋数字」で添える。 */
function gachaButton(label, cost, cls, freeNow, onClick) {
  const b = el('button', { class: `${cls} btn--gacha`, attrs: { type: 'button' }, on: { click: onClick } });
  b.append(el('span', { class: 'btn--gacha__label', text: label }));
  const price = el('span', { class: 'btn--gacha__cost' });
  if (freeNow) {
    price.append(el('span', { text: 'コイン不要' }));
  } else {
    price.append(coinIcon());
    price.append(el('b', { text: String(cost) }));
  }
  b.append(price);
  if (!b.hasAttribute('aria-label')) b.setAttribute('aria-label', `${label} ${cost} SHIKA COIN`);
  return b;
}

function firstTimePanel(view) {
  const p = el('div', { class: 'panel', style: { textAlign: 'center' } });
  p.append(el('h2', { class: 'panel__title', text: 'はじめまして', style: { marginBottom: '6px' } }));
  p.append(el('p', {
    class: 'muted',
    style: { margin: '0 0 4px' },
    text: 'グルメ・スポット・文化のカードで志賀町を集めます。',
  }));
  p.append(el('p', { class: 'muted', style: { margin: '0 0 14px' }, text: 'まずは無料の10連からどうぞ。' }));
  p.append(el('button', {
    class: 'btn btn--primary btn--lg btn--block', attrs: { type: 'button' },
    text: '無料で10連を引く',
    on: { click: () => start('free10', view) },
  }));
  return p;
}

function shortOfCoins(only10 = false) {
  const p = el('div', { class: 'panel' });
  p.append(el('h3', {
    class: 'panel__title',
    text: only10 ? '10連まであと少し' : 'SHIKA COIN の増やし方',
    style: { margin: '0 0 8px' },
  }));

  const rows = el('div', { style: { display: 'grid', gap: '10px' } });

  rows.append(line('今日のログイン',
    dailyAvailable() ? `受け取れます（+${coinCfg().daily}）` : '本日分は受け取り済み',
    dailyAvailable() ? 1 : 0, 1));

  const g = duplicateGaugeInfo();
  rows.append(line('かぶりボーナス', `あと ${g.need} 枚のかぶりで +${coinCfg().duplicatePer5}`, g.current, 5));

  for (const c of categoryProgress()) {
    if (c.remain == null) {
      rows.append(line(`${c.label}`, c.complete ? 'コンプリート！' : `${c.owned}/${c.total} 種類`, c.owned, c.total || 1));
    } else {
      rows.append(line(`${c.label}`, `あと ${c.remain} 種類で +${coinCfg().categoryPer5}`, c.owned % 5, 5));
    }
  }

  const town = app.state.townVisited ? '受け取り済み' : `現地で +${coinCfg().townFirst}`;
  rows.append(line('志賀町 初訪問', town, app.state.townVisited ? 1 : 0, 1));

  p.append(rows);
  p.append(el('a', {
    class: 'btn btn--block', text: 'まち巡りへ',
    attrs: { href: '#/map' }, style: { marginTop: '12px' },
  }));
  return p;
}

function line(label, note, cur, max) {
  const wrap = el('div');
  wrap.append(el('div', {
    style: { display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' },
  }, [el('span', { text: label }), el('span', { class: 'muted', text: note })]));
  const bar = el('div', { class: 'bar bar--coin' }, [
    el('span', { style: { width: `${Math.min(100, (cur / (max || 1)) * 100)}%` } }),
  ]);
  wrap.append(el('div', { class: 'progressline', style: { marginTop: '4px' } }, [bar]));
  return wrap;
}

/* ===== 演出 ===== */

async function start(kind, view) {
  unlock();
  const payload = commitDraw(kind);
  if (!payload) return;
  vibrate(12);
  await playSequence(view, payload);
}

export async function playSequence(view, payload) {
  const ids = payload.results.map((r) => r.id);
  clear(view);

  // 演出のあいだは画面全体を使う（画面いっぱいの固定レイヤー）
  const stageBox = el('div', { class: 'gachastage' });
  const counter = el('div', { class: 'gacha__counter' });
  const skipBtn = el('button', { class: 'gacha__skip', attrs: { type: 'button' }, text: 'SKIP' });
  skipBtn.hidden = true;
  const caption = el('div', { class: 'gacha__caption' });   // NEW とカード名の置き場
  stageBox.append(counter, skipBtn, caption);
  view.append(stageBox);
  document.body.classList.add('is-drawing');

  const loading = el('p', { class: 'muted gachastage__loading', text: 'カードを準備しています…' });
  stageBox.append(loading);
  await preload(ids);
  loading.remove();

  const stage = createGachaStage(stageBox);
  let skipped = false;
  let left = false;          // 途中で画面を離れたか
  /* 途中で画面を離れたら、演出はそこでやめる。
     裏で回り続けると、別の画面に結果を書き込んでしまう。 */
  const onLeave = () => {
    left = true;
    document.body.classList.remove('is-drawing');
    stage.skip();
  };
  window.addEventListener('hashchange', onLeave, { once: true });
  const release = () => document.body.classList.remove('is-drawing');
  /* SKIP を1回押したら、すぐ結果まで行く。
     以前は、カードとカードの間の待ち（2.2秒）が途中で切れず、
     しかも最後の1枚は演出を最後まで流していたので、押しても効いていないように見え、
     もう一度押す必要があった。待ちを起こし、最後の1枚も最終状態から始める。 */
  let wake = null;
  const skipAll = () => {
    skipped = true;
    stage.skip();
    if (wake) { const w = wake; wake = null; w(); }
  };
  skipBtn.addEventListener('click', (e) => { e.stopPropagation(); skipAll(); });
  // 舞台をタップすると、その1枚の演出だけ最後まで飛ばす
  stageBox.addEventListener('click', () => stage.skip());

  const total = payload.results.length;
  for (let i = 0; i < total; i++) {
    if (left) break;
    const r = payload.results[i];
    const card = app.cardsById.get(r.id);
    if (!card) continue;
    counter.textContent = total > 1 ? `${i + 1} / ${total}` : '';

    clear(caption);

    if (skipped) {
      // 残りは演出せず、最後の1枚だけ最終状態で見せる
      if (i < total - 1) continue;
    }

    const playing = stage.play(cardFace(card), {
      category: card.category || 'gourmet',
      quick: i > 0,
      hold: i === 0 || i === total - 1,   // 1枚目と最後の1枚は余韻まで見せる
      onBeat: (beat) => {
        if (beat === 'impact') {
          // 音は新しいカードでもそうでなくても同じにする（引いた手ごたえをそろえる）
          sfx.neu();
          vibrate(r.isNew ? [18, 40, 26] : 12);
          if (r.isNew) caption.append(el('div', { class: 'gacha__newtag', text: 'NEW' }));
        }
        if (beat === 'name') {
          caption.append(el('p', { class: 'gacha__name', text: card.name }));
        }
      },
    });
    if (skipped) stage.skip();   // SKIP 済みなら、最後の1枚は演出を流さず最終状態へ
    await playing;

    if (i === 0 && total > 1 && !skipped) skipBtn.hidden = false;
    // 引いたカードをしばらく眺められるように、次へ行くまで間を置く（SKIP で起きる）
    if (!skipped && i < total - 1) {
      await new Promise((resolve) => {
        wake = resolve;
        setTimeout(() => { if (wake === resolve) wake = null; resolve(); }, reduceMotion() ? 60 : 2200);
      });
    }
  }

  stage.destroy();
  window.removeEventListener('hashchange', onLeave);
  release();
  // 離れたあとは、その画面に結果を書き込まない（次にガチャを開いたときに出る）
  if (!left) showResults(view, payload);
}

/* ===== 結果一覧 ===== */

export function showResults(view, payload) {
  clear(view);
  const newCount = payload.results.filter((r) => r.isNew).length;

  // 1枚だけのときは、中央ぞろえで大きく見せる
  const solo = payload.results.length === 1;

  const head = el('div', { class: solo ? 'result__head result__head--solo' : 'result__head' });
  head.append(el('h2', { text: payload.kind === 'single' ? 'ガチャ結果' : '10連の結果' }));
  if (payload.results.some((r) => r.bonus)) {
    head.append(el('p', { class: 'result__bonusnote', text: `おまけ ${payload.results.filter((r) => r.bonus).length} 枚つき` }));
  }
  head.append(el('p', {
    class: 'muted',
    style: { margin: 0 },
    text: newCount ? `新しいカード ${newCount} 枚` : '今回の新カードはありません',
  }));
  view.append(head);

  const grid = el('div', {
    class: solo ? 'result__solo' : (payload.results.length > 4 ? 'result__grid' : 'grid grid--2'),
  });
  payload.results.forEach((r, i) => {
    const c = app.cardsById.get(r.id);
    if (!c) return;
    const cell = el('button', { class: 'cell result__cell', attrs: { type: 'button' }, style: { '--i': i } });
    // 大きく出す1枚だけは原寸を使う（縮小版だとぼやける）
    const face = cardFace(c, { small: !solo });
    if (r.isNew) face.append(el('div', { class: 'card__new', text: 'NEW' }));
    if (r.bonus) face.append(el('div', { class: 'card__bonus', text: 'おまけ' }));
    cell.append(face);
    cell.addEventListener('click', () => openViewer(c.id, payload.results.map((x) => x.id)));
    grid.append(cell);
  });
  view.append(grid);

  if (payload.bonus && payload.bonus.items.length) {
    const box = el('div', { class: 'bonusbox' });
    box.append(el('h3', { text: '今回のボーナス' }));
    for (const it of payload.bonus.items) {
      box.append(el('div', { class: 'bonusbox__row' }, [
        el('span', { text: it.label }),
        el('span', { text: `+${it.coins}` }),
      ]));
    }
    box.append(el('div', { class: 'bonusbox__total' }, [
      el('span', { text: '合計' }),
      coinAmount(payload.bonus.total, { sign: true }),
    ]));
    view.append(box);
    sfx.coin();
  }

  const msg = el('p', { class: 'reveal-msg', text: '気になるカードをタップしてみよう。' });
  if (solo) msg.classList.add('reveal-msg--low');   // 1枚のときは説明文を下げる
  view.append(msg);

  const acts = el('div', { class: 'gacha__acts' });
  acts.append(el('button', {
    class: 'btn', attrs: { type: 'button' }, text: 'カード一覧へ',
    on: { click: () => { clearPending(); go('#/collection'); } },
  }));
  acts.append(el('button', {
    class: 'btn btn--primary', attrs: { type: 'button' }, text: 'もう一度',
    on: { click: () => { clearPending(); go('#/gacha', true); } },
  }));
  view.append(acts);

  // 初回無料10連の直後だけ、まち巡りへ誘導する
  if (payload.kind === 'free10') {
    const p = el('div', { class: 'panel', style: { marginTop: '14px' } });
    p.append(el('p', {
      style: { margin: '0 0 10px', fontSize: '13.5px' },
      text: `スポットカードの場所を実際に訪れると +${coinCfg().spotFirst} SHIKA COIN。`,
    }));
    p.append(el('a', { class: 'btn btn--block', text: 'まち巡りを見る', attrs: { href: '#/map' } }));
    view.append(p);
  }
}

export async function offerDaily() {
  if (!dailyAvailable()) return 0;
  const n = claimDaily();
  if (n > 0) { sfx.coin(); toast(`今日のログインボーナス +${n} SHIKA COIN`); }
  return n;
}
