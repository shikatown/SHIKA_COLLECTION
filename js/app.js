/* app.js — 起動処理と画面の組み立て。 */

import {
  app, initState, loadPublicData, subscribe, publishedCards, isOwned,
  categoryStats, CATEGORIES, todayKey,
} from './state.js';
import * as router from './router.js';
import { el, clear, cardBack, toast, sleep, reduceMotion } from './ui.js';
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
import { categoryProgress, dailyAvailable, coinCfg } from './rewards.js';
import * as geo from './geo.js';
import { shareApp } from './share.js';

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

  const intro = playIntro();

  let dataVersion = '';
  try {
    const r = await loadPublicData();
    dataVersion = r.dataVersion;
  } catch (e) {
    console.error(e);
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

  await intro;
  document.getElementById('boot').hidden = true;

  // 起動後のお知らせ類（順番に1つずつ）
  await offerDaily();
  await checkDataUpdate(dataVersion);
  registerSW();
  await maybeSuggestInstall();
  await maybeSuggestBackup();
}

/* ===== 起動演出 ===== */
/** 起動画面のあいだに読んでおく絵。読み終わりは待たない。 */
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

function playIntro() {
  const stage = document.getElementById('bootStage');
  const bootEl = document.getElementById('boot');
  const skip = document.getElementById('bootSkip');
  const spread = [
    { tx: '-64%', ty: '-8%', rot: '-16deg', d: '0s' },
    { tx: '52%', ty: '-14%', rot: '14deg', d: '.06s' },
    { tx: '-22%', ty: '16%', rot: '-6deg', d: '.12s' },
    { tx: '26%', ty: '10%', rot: '7deg', d: '.18s' },
    { tx: '0%', ty: '0%', rot: '0deg', d: '.24s' },
  ];
  for (const s of spread) {
    const c = el('div', { class: 'bootcard' });
    c.style.setProperty('--tx', s.tx);
    c.style.setProperty('--ty', s.ty);
    c.style.setProperty('--rot', s.rot);
    c.style.setProperty('--d', s.d);
    c.append(cardBack());
    stage.append(c);
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      bootEl.classList.add('is-out');
      setTimeout(resolve, 380);
    };
    skip.addEventListener('click', finish);
    setTimeout(finish, reduceMotion() ? 400 : 2100);
  });
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

function onRouteChange(route) {
  document.getElementById('appTitle').textContent = TITLES[route.path] != null ? TITLES[route.path] : '';
  document.getElementById('btnBack').hidden = route.path === '/home';
  // 左右に払って前後のカードへ移れるのは、カード詳細のときだけ
  document.getElementById('view').classList.toggle('detail--swipe', route.path === '/card/:id');
  const tab = TAB_OF[route.path];
  for (const a of document.querySelectorAll('.tab')) {
    a.classList.toggle('is-active', a.dataset.tab === tab);
  }
  // 画面が出そろってから戻すと、持ち上がりが最後まで見える
  requestAnimationFrame(() => requestAnimationFrame(unpopTabs));
  updateChrome();
}

function updateChrome() {
  document.getElementById('statCoins').querySelector('b').textContent = String(app.state.coins);

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

  const hero = el('div', { class: 'hero' });
  /* ロゴは原寸が1.8MBある。ここは幅230pxほどなので、まず小さい方を出し、
     原寸は上に重ねて読み終わってから現す（差し替えるとちらつく）。 */
  const logo = el('div', { class: 'hero__logo' });
  logo.append(el('img', {
    class: 'hero__logoimg',
    attrs: { src: './assets/frames/thumb/logo.png', alt: 'SHIKA COLLECTION', decoding: 'async' },
  }));
  const logoHi = el('img', {
    class: 'hero__logoimg hero__logoimg--hi',
    attrs: { src: './assets/frames/logo.png', alt: '', decoding: 'async' },
  });
  const showHi = () => logoHi.classList.add('is-on');
  if (logoHi.complete && logoHi.naturalWidth) showHi();
  else logoHi.addEventListener('load', showHi, { once: true });
  logoHi.addEventListener('error', () => logoHi.remove(), { once: true });
  logo.append(logoHi);
  hero.append(logo);
  hero.append(el('h2', { class: 'hero__title', text: '志賀町を、あつめよう。' }));
  view.append(hero);

  const main = el('div', { class: 'home__main' });

  const gachaLabel = s.flags.firstFreeTenDone
    ? `${s.coins} SHIKA COIN で引けます`
    : 'はじめての方は無料10連から';
  main.append(bigBtn('#/gacha', 'ガチャを引く', gachaLabel, true,
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="17" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 6v12" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>'));

  const total = publishedCards().length;
  const owned = publishedCards().filter((c) => isOwned(c.id)).length;
  main.append(bigBtn('#/collection', 'カードを見る', `${owned} / ${total} 種類`, false,
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="4.5" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="3.5" y="14.5" width="7" height="5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13.5" y="14.5" width="7" height="5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>'));

  const vs = geo.visitStats();
  main.append(bigBtn('#/map', 'まちを巡る', `現地訪問 ${vs.visited} / ${vs.total} か所`, false,
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6.5-6.2 6.5-10.5A6.5 6.5 0 0 0 5.5 10.5C5.5 14.8 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10.3" r="2.3" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>'));

  // SNSでシェア。3つのボタンの下に、少し控えめに置く
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

function bigBtn(href, title, sub, accent, iconSvg) {
  const a = el('a', { class: `bigbtn${accent ? ' bigbtn--accent' : ''}`, attrs: { href } });
  a.append(el('span', { class: 'bigbtn__ico', html: iconSvg }));
  const t = el('span');
  t.append(el('span', { class: 'bigbtn__t', text: title }));
  t.append(el('span', { class: 'bigbtn__sub', text: sub }));
  a.append(t);
  return a;
}

boot();
