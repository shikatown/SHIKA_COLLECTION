/* app.js — 起動処理と画面の組み立て。 */

import {
  app, initState, loadPublicData, subscribe, publishedCards, isOwned,
  categoryStats, CATEGORIES, todayKey,
} from './state.js';
import * as router from './router.js';
import { el, clear, sleep, cardFace, cardBack } from './ui.js';
import { renderGacha, showResults, offerDaily } from './gacha.js';
import { renderCollection } from './collection.js';
import { renderCardDetail } from './card-detail.js';
import { renderMap } from './map.js';
import { renderSettings, renderHelp, renderPrivacy, renderMore, renderRecords } from './settings.js';
import { renderAdmin, isAdmin } from './admin.js';
import { renderMissions, claimableCount } from './missions.js';
import { startOfflineWatch } from './offline.js';
import { registerSW, checkDataUpdate, maybeSuggestInstall } from './update.js';
import { maybeSuggestBackup } from './backup.js';
import { dailyAvailable, coinCfg } from './rewards.js';
import { createOpening } from './opening.js';
import { thumbUrl } from './card-render.js';
import { shareApp } from './share.js';
import { maybeCelebrateComplete } from './title-complete.js';

/* ===== 動作環境の確認 ===== */
function unsupportedReason() {
  if (!window.fetch) return 'このブラウザは fetch に対応していません。';
  if (!window.Promise) return 'このブラウザは Promise に対応していません。';
  if (!('replaceChildren' in Element.prototype)) return 'このブラウザは対応していない機能があります。';
  if (!CSS || !CSS.supports || !CSS.supports('color', 'var(--x)')) return 'このブラウザはCSS変数に対応していません。';
  return null;
}

async function boot() {
  const reason = unsupportedReason();
  if (reason) {
    document.getElementById('boot').hidden = true;
    document.getElementById('unsupportedReason').textContent = reason;
    document.getElementById('unsupported').hidden = false;
    return;
  }
  if (location.protocol === 'file:') {
    document.getElementById('boot').hidden = true;
    document.getElementById('filenote').hidden = false;
    return;
  }

  initState();
  startOfflineWatch();
  warmHomeImages();       // ホームで使う絵を、起動画面のうちに読んでおく

  /* 起動演出（js/opening.js）。
     必須の絵とカードデータを並行して読み、2.2秒以内にそろわない初回は短い版にする。 */
  const opening = createOpening();
  const dataLoad = loadPublicData();
  const readyInTime = await Promise.race([
    Promise.all([opening.critical, dataLoad.then(() => true, () => false)]).then(([a, b]) => a && b),
    sleep(2200).then(() => false),
  ]);

  let dataVersion = '';
  try {
    const r = await dataLoad;
    dataVersion = r.dataVersion;
  } catch (e) {
    console.error(e);
    opening.cancel();
    document.getElementById('boot').hidden = true;
    const note = document.getElementById('filenote');
    note.querySelector('h1').textContent = 'データを読み込めませんでした';
    clear(note);
    note.append(
      el('h1', { text: 'データを読み込めませんでした' }),
      el('p', { text: 'data/cards.json を読み込めませんでした。通信状況を確認して、もう一度開いてください。' }),
      el('p', { class: 'muted', text: String(e && e.message ? e.message : e) })
    );
    note.hidden = false;
    return;
  }

  // 周りの8枚は、公開カードから既存の描画機能で作る
  opening.setCards(publishedCards());
  // カード一覧で写真が黒く抜けないよう、小さい写真と台紙を先に読んでおく（待たない）
  warmCardThumbs();
  let mode = opening.preferredMode;
  if (mode === 'full' && !readyInTime) mode = 'short';
  opening.start(mode);

  setupRoutes();
  bindTabPop();
  document.getElementById('btnBack').addEventListener('click', () => router.back());
  subscribe(updateChrome);
  router.setOnChange(onRouteChange);

  /* 起動画面がまだ出ているうちに、ホーム画面を組み立てておく。
     先に起動画面を消すと、そのあとで画像を読むことになり一瞬ちらつく。 */
  document.getElementById('app').hidden = false;
  router.start();
  updateChrome();

  // 「スタート」か「スキップ」を押すまで待つ
  await opening.done;
  document.getElementById('boot').hidden = true;
  setTimeout(maybeCelebrateComplete, 450);

  // 起動後のお知らせ類（順番に1つずつ）
  await offerDaily();
  await checkDataUpdate(dataVersion);
  registerSW();
  await maybeSuggestInstall();
  await maybeSuggestBackup();
}

/* ===== 起動演出 ===== */
/** 起動画面のあいだに読んでおく絵。読み終わりは待たない。 */
/**
 * カード一覧で使う小さい写真と台紙を、裏で読んでおく。
 * 一覧を開いた瞬間に写真がまだ無く、黒く抜けて見えるのを防ぐ。
 * 53枚ぶんで合計およそ1.3MB。起動演出の絵を先に読ませたいので、少し遅らせて始め、
 * 同時に読む数も2本に絞る（すぐガチャを引いたときに、ガチャ側の読み込みの邪魔をしない）。
 * 読み終わりは待たない。
 */
function warmCardThumbs() {
  const urls = [];
  for (const g of ['gourmet', 'spot', 'culture']) {
    urls.push(`./assets/frames/thumb/${g}.png`, `./assets/frames/thumb/icon-${g}.png`);
  }
  for (const c of publishedCards()) {
    const u = c.photo ? thumbUrl(c.photo) : '';
    if (u) urls.push(u);
  }
  let next = 0;
  const one = () => {
    if (next >= urls.length) return;
    const img = new Image();
    img.decoding = 'async';
    try { img.fetchPriority = 'low'; } catch (_) { /* 未対応の端末は無視 */ }
    img.onload = img.onerror = one;
    img.src = urls[next++];
  };
  setTimeout(() => { one(); one(); }, 600);
}

function warmHomeImages() {
  for (const src of [
    './assets/cards/_back.png',            // 起動画面のカードの裏
    './assets/frames/thumb/logo.png',      // ホームのロゴ（小）
    './assets/frames/logo.png',            // ホームのロゴ（原寸）
  ]) {
    const i = new Image();
    i.decoding = 'async';
    i.src = src;
  }
}


/* ===== ルート ===== */
function setupRoutes() {
  router.define('/home', renderHome);
  router.define('/gacha', (view) => {
    const pending = app.state.pendingResult;
    if (pending && pending.autoOpen) { showResults(view, pending); return; }
    renderGacha(view);
  });
  router.define('/collection', renderCollection);
  router.define('/card/:id', renderCardDetail);
  router.define('/map', renderMap);
  router.define('/more', renderMore);
  router.define('/settings', renderSettings);
  router.define('/help', renderHelp);
  router.define('/privacy', renderPrivacy);
  router.define('/records', renderRecords);
  router.define('/admin', renderAdmin);
  router.define('/missions', renderMissions);
  router.setNotFound((view) => {
    clear(view);
    view.append(el('p', { class: 'empty', text: 'ページが見つかりません。' }));
    view.append(el('a', { class: 'btn btn--block', text: 'ホームへ', attrs: { href: '#/home' } }));
  });
}

const TITLES = {
  '/home': '',            // ホームはロゴが大きく出るので、上の見出しは置かない
  '/gacha': 'ガチャ',
  '/collection': 'カード',
  '/card/:id': 'カード詳細',
  '/map': 'まち巡り',
  '/more': 'その他',
  '/settings': '設定',
  '/help': '遊び方',
  '/privacy': 'プライバシー',
  '/records': '集めた記録',
  '/admin': 'カード点検',
  '/missions': 'ミッション',
};
const TAB_OF = {
  '/home': 'home', '/gacha': 'gacha', '/collection': 'collection',
  '/card/:id': 'collection', '/map': 'map',
  '/missions': 'missions',
  // 設定まわりはタブに出さない（アプリバーの歯車から行く）
  '/more': '', '/settings': '', '/help': '', '/privacy': '', '/records': '', '/admin': '',
};

/* タブを押した瞬間に、そのタブだけぴょんと持ち上げる。
   画面が開いたら（onRouteChange の最後で）もとの位置に戻す。
   押しただけで画面が変わらなかったときのために、少し待って自分でも戻す。 */
let popTimer = null;
function popTab(a) {
  clearTimeout(popTimer);
  for (const t of document.querySelectorAll('.tab.is-popped')) t.classList.remove('is-popped');
  a.classList.add('is-popped');
  popTimer = setTimeout(unpopTabs, 420);
}
function unpopTabs() {
  clearTimeout(popTimer);
  for (const t of document.querySelectorAll('.tab.is-popped')) t.classList.remove('is-popped');
}
function bindTabPop() {
  for (const a of document.querySelectorAll('.tab')) {
    a.addEventListener('pointerdown', () => popTab(a));
    a.addEventListener('pointercancel', unpopTabs);
  }
}

const TAB_ROOTS = new Set(['/home', '/map', '/collection', '/missions', '/gacha']);

function onRouteChange(route) {
  /* 下のタブで開く画面（ホーム・まち巡り・カード・ミッション・ガチャ）では、
     左上の「＜ 画面名」は出さない。タブが今いる場所を示しているので重複する。
     カード詳細や歯車の奥の画面など、戻る先がある画面だけに出す。 */
  const tabRoot = TAB_ROOTS.has(route.path);
  document.getElementById('appTitle').textContent = tabRoot ? '' : (TITLES[route.path] != null ? TITLES[route.path] : '');
  document.getElementById('btnBack').hidden = tabRoot;
  // 左右に払って前後のカードへ移れるのは、カード詳細のときだけ
  document.getElementById('view').classList.toggle('detail--swipe', route.path === '/card/:id');
  const tab = TAB_OF[route.path];
  for (const a of document.querySelectorAll('.tab')) {
    a.classList.toggle('is-active', a.dataset.tab === tab);
  }
  // 画面が出そろってから戻すと、持ち上がりが最後まで見える
  requestAnimationFrame(() => requestAnimationFrame(unpopTabs));
  updateChrome();
  // 「志賀町コンプリート」を達成していたら、画面が落ち着いてから獲得演出を出す（1回だけ）
  setTimeout(maybeCelebrateComplete, 450);
}

function updateChrome() {
  /* コインが右上へ飛んでいるあいだ（js/coin-fly.js）は、数字をメーターのように増やしているので、
     ここでは書き換えない。演出が終わると coin-fly.js が最新の枚数にそろえる。 */
  const coinStat = document.getElementById('statCoins');
  if (coinStat.dataset.hold == null) coinStat.querySelector('b').textContent = String(app.state.coins);

  // ミッションの「受け取れる件数」をタブに出す
  const badge = document.getElementById('missionBadge');
  if (badge) {
    const n = claimableCount();
    badge.textContent = String(n);
    badge.hidden = n === 0;
  }

  // 管理モードのあいだは、どの画面でも分かるように帯を出す
  const bar = document.getElementById('adminBar');
  if (bar) bar.hidden = !isAdmin();
}

/* ===== ホーム ===== */
function renderHome(view) {
  clear(view);
  const s = app.state;

  /* 遊び方と設定を歯車へ移してボタンが3つになったので、
     画面の高さいっぱいを使い、残った場所の真ん中にボタンを置く。 */
  const page = el('div', { class: 'home' });
  view.append(page);
  view = page;

  /* 初めての人（初回の10連をまだ引いていない人）には、ロゴと「10連ガチャ」のポップを出す。
     引いたあとは、ロゴの代わりに持っているカードを大きく見せる。 */
  const first = !s.flags.firstFreeTenDone;
  const hero = el('div', { class: `hero${first ? ' hero--first' : ''}` });
  if (first) hero.append(homeLogo());
  hero.append(taglineLogo());
  view.append(hero);

  /* 持っているカードを1枚ずつ大きく見せる。5秒ごとに入れ替え、
     最近手に入れたカードほど出やすくする。押すとそのカードの詳細へ。
     大きさはガチャ画面のカードと同じ（画面の高さの46%まで）。 */
  const main = el('div', { class: 'home__main' });
  main.append(first ? firstGachaPop() : homeShowcase());

  // SNSでシェア
  main.append(el('button', {
    class: 'btn btn--block home__share', attrs: { type: 'button' },
    html: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="18.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>SNSでシェア</span>',
    on: { click: () => shareApp() },
  }));

  view.append(main);

  if (s.pendingResult) {
    const p = el('div', { class: 'panel', style: { marginTop: '14px' } });
    p.append(el('p', { style: { margin: '0 0 10px', fontSize: '13.5px' }, text: '前回のガチャの結果がまだ残っています。' }));
    p.append(el('a', { class: 'btn btn--block', text: '結果を見る', attrs: { href: '#/gacha' } }));
    view.append(p);
  }

  // 集まりぐあいは「コレクション」としてカード画面の上に置いた（js/collection.js）

  if (dailyAvailable()) {
    view.append(el('p', {
      class: 'muted center', style: { marginTop: '12px' },
      text: `今日のログインボーナス +${coinCfg().daily} SHIKA COIN を受け取れます`,
    }));
  }

  // 遊び方と設定は、右上の歯車（その他）から行けるのでホームには置かない
}


/* ===== ホームの見出し・ロゴ・初回ポップ ===== */

/** SHIKA COLLECTION のロゴ（初回のホームだけ）。小さい方を先に出し、原寸は読み終わってから重ねて現す */
function homeLogo() {
  const logo = el('div', { class: 'hero__logo' });
  logo.append(el('img', {
    class: 'hero__logoimg',
    attrs: { src: './assets/frames/thumb/logo.png', alt: 'SHIKA COLLECTION', decoding: 'async' },
  }));
  const hi = el('img', {
    class: 'hero__logoimg hero__logoimg--hi',
    attrs: { src: './assets/frames/logo.png', alt: '', decoding: 'async' },
  });
  const show = () => hi.classList.add('is-on');
  if (hi.complete && hi.naturalWidth) show();
  else hi.addEventListener('load', show, { once: true });
  hi.addEventListener('error', () => hi.remove(), { once: true });
  logo.append(hi);
  return logo;
}

/** 「志賀町を、あつめよう。」をロゴ風に。
    ゆるい弧に沿って並べた白い文字に青いふちを付け、両脇に金の星を置く。
    裏面のロゴの COLLECTION と同じ配色。文字は画像ではなく本物の文字（固定の図形なので html で差し込む）。 */
const TAGLINE_SVG = '<svg class="tagline__svg" viewBox="0 0 340 96" aria-hidden="true" focusable="false">'
  + '<defs><path id="taglineArc" d="M24 86 Q170 20 316 86"/></defs>'
  + '<text text-anchor="middle"><textPath href="#taglineArc" startOffset="50%">志賀町を、あつめよう。</textPath></text>'
  + '<path class="tagline__star" d="M20 40l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L11 47l6-1z"/>'
  + '<path class="tagline__star" d="M320 40l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L311 47l6-1z"/>'
  + '</svg>';

function taglineLogo() {
  return el('h2', { class: 'tagline', attrs: { 'aria-label': '志賀町を、あつめよう。' }, html: TAGLINE_SVG });
}

/** 初回だけの「10連ガチャ」ポップ。押すとガチャ画面（10連ガチャを引くボタンがある）へ */
function firstGachaPop() {
  const pop = el('a', {
    class: 'firstpop',
    attrs: { href: '#/gacha', 'aria-label': '初回限定 10連ガチャを引く' },
  });
  pop.append(el('span', { class: 'firstpop__ribbon', attrs: { 'aria-hidden': 'true' }, text: '初回限定' }));
  pop.append(el('span', { class: 'firstpop__cards', attrs: { 'aria-hidden': 'true' } }, [
    cardBack({ small: true }), cardBack({ small: true }), cardBack({ small: true }),
  ]));
  pop.append(el('span', { class: 'firstpop__body', attrs: { 'aria-hidden': 'true' } }, [
    el('span', { class: 'firstpop__ten', text: '10連ガチャ' }),
    el('span', { class: 'firstpop__cta', text: 'タップして引く ▶' }),
  ]));
  pop.append(el('span', { class: 'firstpop__shine', attrs: { 'aria-hidden': 'true' } }));
  return pop;
}

/* ===== ホームのカード ===== */
const SHOWCASE_MS = 5000;   // 次のカードに入れ替えるまで
let showcaseTimer = 0;

/** ホームに大きく出すカードの置き場。持っていなければカードの裏（押すとガチャへ）。 */
function homeShowcase() {
  clearInterval(showcaseTimer);
  const box = el('div', { class: 'showcase' });
  const owned = publishedCards().filter((c) => isOwned(c.id));
  if (!owned.length) {
    const back = el('button', { class: 'showcase__card', attrs: { type: 'button', 'aria-label': 'ガチャを引く' } }, [cardBack()]);
    back.addEventListener('click', () => router.go('#/gacha'));
    box.append(back);
    return box;
  }

  // 新しく手に入れた順。上位ほど出やすい重みを付ける（いちばん新しい5枚は4倍、次の10枚は2倍）
  const at = app.state.obtainedAt || {};
  const sorted = owned.slice().sort((a, b) => String(at[b.id] || '').localeCompare(String(at[a.id] || '')));
  const weight = (i) => (i < 5 ? 4 : (i < 15 ? 2 : 1));
  let current = null;
  const pickNext = () => {
    const pool = sorted.length > 1 ? sorted.filter((c) => c !== current) : sorted;
    const total = pool.reduce((a, c) => a + weight(sorted.indexOf(c)), 0);
    let r = Math.random() * total;
    for (const c of pool) { r -= weight(sorted.indexOf(c)); if (r <= 0) return c; }
    return pool[pool.length - 1];
  };

  const show = (card, first) => {
    const btn = el('button', {
      class: `showcase__card${first ? ' is-in' : ''}`,
      attrs: { type: 'button', 'aria-label': `${card.name} の詳細を見る` },
    }, [cardFace(card)]);
    btn.addEventListener('click', () => router.go(`#/card/${card.id}`));
    const old = box.querySelector('.showcase__card:not(.is-out)');
    box.append(btn);
    if (!first) requestAnimationFrame(() => requestAnimationFrame(() => btn.classList.add('is-in')));
    if (old) {
      old.classList.add('is-out');
      setTimeout(() => old.remove(), 700);
    }
    current = card;
  };

  // 最初はいちばん新しいカードから
  show(sorted[0], true);
  showcaseTimer = setInterval(() => {
    // ホームを離れたら止める
    if (!box.isConnected) { clearInterval(showcaseTimer); return; }
    if (document.hidden) return;
    show(pickNext(), false);
  }, SHOWCASE_MS);
  return box;
}

boot();
