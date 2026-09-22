/* app.js — 起動処理と画面の組み立て。 */

import {
  app, initState, loadPublicData, subscribe, publishedCards, isOwned,
  categoryStats, CATEGORIES, todayKey, onSaveFailed,
} from './state.js';
import * as router from './router.js';
import { el, clear, sleep, cardFace, cardBack, dialog, toast } from './ui.js';
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
import { dailyAvailable } from './rewards.js';
import { createOpening } from './opening.js';
import { thumbUrl } from './card-render.js';
import { maybeCelebrateTitles } from './title-complete.js';
import { titleRow, titleInfos } from './titles.js';
import { initAnalytics, trackScreen } from './analytics.js';

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
  onSaveFailed(showSaveFailed);   // 保存に失敗したら知らせる（変更は state.js が取り消している）
  startOfflineWatch();
  /* オフラインでも開けるように、Service Worker はいちばん最初に登録する。
     入った時点でアプリ本体と公開データ（cards.json など）を控えるので、
     初めて開いたあと通信が切れても、次から起動できる。 */
  registerSW();
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
  /* 起動画面のうしろで前のタブを組み立てると、「スタート」を押した瞬間にそれが一瞬見えてしまう。
     はじめからホームだけを組み立てる（v1.47。「スタート」でホームへ移る仕様と合わせる） */
  if (location.hash && location.hash !== '#/home') history.replaceState(null, '', '#/home');
  router.start();
  updateChrome();

  // 「スタート」か「スキップ」を押すまで待つ
  await opening.done;
  // 「スタート」を押したら、どの画面のアドレスで開いても必ずホームから始める（念のため）
  if (location.hash !== '#/home') router.go('#/home', true);
  document.getElementById('boot').hidden = true;
  setTimeout(maybeCelebrateTitles, 450);
  prefetchTitleArt();
  initAnalytics();   // 利用状況の記録（js/analytics.js）。設定で切っていれば何も読み込まない

  // 起動後のお知らせ類（順番に1つずつ）
  await offerDaily();
  await checkDataUpdate(dataVersion);
  await maybeSuggestInstall();
  await maybeSuggestBackup();
}

/* ===== 保存に失敗したとき ===== */
let saveFailedAt = 0;
function showSaveFailed() {
  const now = Date.now();
  if (now - saveFailedAt < 8000) return;   // 続けて失敗しても、何度も出さない
  saveFailedAt = now;
  const ov = document.getElementById('overlay');
  const bootEl = document.getElementById('boot');
  const busy = (ov && !ov.hidden) || (bootEl && !bootEl.hidden) || document.body.classList.contains('is-drawing');
  const msg = '保存できませんでした。いまの変更は取り消しました。';
  if (busy) {   // ほかのお知らせや演出の最中は、それを消さないよう画面下の知らせにする
    toast(`${msg}設定からバックアップを保存してください`, 6000);
    return;
  }
  dialog({
    title: '保存できませんでした',
    body: [
      '端末の空き容量が足りないなどの理由で、いまの変更を保存できませんでした。',
      'いまの変更は取り消しました（カードやコインは増えていません）。',
      '設定から、バックアップを保存しておくと安心です。',
    ],
    actions: [{ label: '閉じる', value: null }, { label: '設定を開く', value: 'settings', primary: true }],
  }).then((v) => { if (v === 'settings') router.go('#/settings'); });
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
    './assets/cards/web/_back.webp',       // 起動画面のカードの裏
    './assets/frames/thumb/logo.png',      // ホームのロゴ（小）
    './assets/frames/web/logo.webp',       // ホームのロゴ（大）
    './assets/video/home-poster.jpg',      // ホームの動画の最初の場面（動画を読むまで出す）
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
  if (route.path !== '/home') stopHomeVideo();   // ホームを離れたら動画を止める
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
  trackScreen(location.hash);
  // 称号を獲得していたら、画面が落ち着いてから獲得演出を出す（称号ごとに1回だけ）
  setTimeout(maybeCelebrateTitles, 450);
  // 日付が変わっていたら、ログインボーナスを受け取る（開いたまま日をまたいだとき用）
  maybeDailyBonus();
}

/* ログインボーナスは起動時に受け取るが、アプリを開いたまま日付が変わることもある。
   画面を移ったときと、アプリに戻ってきたときにも確かめる。起動画面が出ているあいだは待つ
   （起動の流れの中で boot() が受け取る）。 */
function maybeDailyBonus() {
  if (!app.state) return;
  const boot = document.getElementById('boot');
  if (boot && !boot.hidden) return;
  if (dailyAvailable()) offerDaily();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) maybeDailyBonus(); });

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

  /* 初めての人（初回の10連をまだ引いていない人）には、カードの代わりに「10連ガチャ」のポップを出す。
     引いたあとは、ロゴの代わりに持っているカードを大きく見せる。 */
  const first = !s.flags.firstFreeTenDone;
  const hero = el('div', { class: `hero${first ? ' hero--first' : ''}` });
  hero.append(homeVideo());
  view.append(hero);

  /* 動画の下に、最近手に入れたカードを3枚ならべる（10秒ごとに入れ替え、押すと詳細へ）。
     初めての人はまだカードが無いので、代わりに「10連ガチャ」のポップ。
     その下に称号をならべる（押すと獲得条件とあといくつかを出す）。画面の高さに収めて、スクロールさせない。 */
  const main = el('div', { class: 'home__main' });
  // カードの見出しと、53種類のうちいくつ集めたか
  const pub = publishedCards();
  const have = pub.filter((c) => isOwned(c.id)).length;
  main.append(el('div', { class: 'homehead' }, [
    el('span', { text: first ? 'カードを集めよう' : '最近手に入れたカード' }),
    el('b', { html: `${pub.length}種類中 <em>${have}</em>種類あつめた` }),
  ]));
  main.append(first ? firstGachaPop() : homeTrio());
  main.append(titleRow());

  // SNSでシェアは、カード画面のコレクション欄へ移した（js/collection.js）。ここはカードを大きく見せる

  view.append(main);

  if (s.pendingResult) {
    const p = el('div', { class: 'panel', style: { marginTop: '14px' } });
    p.append(el('p', { style: { margin: '0 0 10px', fontSize: '13.5px' }, text: '前回のガチャの結果がまだ残っています。' }));
    p.append(el('a', { class: 'btn btn--block', text: '結果を見る', attrs: { href: '#/gacha' } }));
    view.append(p);
  }

  // 集まりぐあいは「コレクション」としてカード画面の上に置いた（js/collection.js）

  // ログインボーナスは開いたときに自動で受け取り、通知で知らせる（maybeDailyBonus）。ここに「受け取れます」は出さない

  // 遊び方と設定は、右上の歯車（その他）から行けるのでホームには置かない
}


/* 称号の大きい絵（獲得の演出と、押したときの案内で使う）を、手が空いたときに先に読んでおく。
   押した瞬間に読み込みと展開が重なると、絵が出るまでカクつくため。
   軽い WebP（1枚およそ100KB）で、起動の邪魔をしないよう、起動画面が消えてから1枚ずつ読む。 */
function prefetchTitleArt() {
  const srcs = titleInfos().map((t) => t.big[0]).filter(Boolean);
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400));
  let i = 0;
  const next = () => {
    if (i >= srcs.length) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = img.onerror = () => { i += 1; idle(next); };
    img.src = srcs[i];
  };
  idle(next);
}

/* ===== ホームの見出し・ロゴ・初回ポップ ===== */

/* ===== ホームの動画 =====
   「志賀町を、あつめよう。」のロゴの代わりに、志賀町の風景と SHIKA COLLECTION のロゴの動画を流す。
   音なし・画面の中で・ずっと繰り返す。最後の0.6秒で最初の場面の絵に溶けてから最初に戻るので、つなぎ目が見えない。

   重くしないために：
   ・動画は 1152×486・約5.5MB（assets/video/README.txt）。読み終わるまでは最初の場面の絵（約85KB）を出す
   ・起動画面のあいだは読まない。起動の絵（カードの裏やロゴ）の読み込みと取り合わないよう、起動画面が消えてから読む
   ・ホームを離れたら止めて、読み込みも手放す。戻ってきたら、離れたところの続きから流す（v1.47）
   ・アプリを閉じたら止め、戻ったら続きから
   ・動きを減らす設定の端末と、データセーバーの端末では、絵だけにする
   ・Service Worker では控えない（service-worker.js）。動画は途中から読む要求が多く、控えから返すと iPhone で流れないことがあるため */
const HOME_VIDEO = './assets/video/home.mp4';
const HOME_POSTER = './assets/video/home-poster.jpg';
const HOME_VIDEO_FADE = 0.6;   // 最後の何秒で、最初の場面の絵に溶かすか
let homeVideoEl = null;
let homeVideoTime = 0;   // ほかのタブへ移る前に流していたところ（戻ってきたら、その続きから）

/** いま流しているホームの動画を止めて、読み込みも手放す。どこまで流したかは覚えておく */
function stopHomeVideo() {
  if (!homeVideoEl) return;
  const v = homeVideoEl;
  homeVideoEl = null;
  if (Number.isFinite(v.currentTime) && v.currentTime > 0) homeVideoTime = v.currentTime;
  v.pause();
  v.removeAttribute('src');
  v.load();
}
document.addEventListener('visibilitychange', () => {
  if (!homeVideoEl) return;
  if (document.hidden) homeVideoEl.pause();
  else homeVideoEl.play().catch(() => {});
});

function homeVideo() {
  stopHomeVideo();
  const box = el('div', {
    class: 'homevideo',
    attrs: { role: 'img', 'aria-label': '志賀町の風景と SHIKA COLLECTION のロゴ' },
    style: { backgroundImage: `url("${HOME_POSTER}")` },
  });
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  if (reduce || saveData) return box;   // 絵だけ

  const v = el('video', {
    class: 'homevideo__v',
    attrs: { muted: '', playsinline: '', 'webkit-playsinline': '', preload: 'none', poster: HOME_POSTER, 'aria-hidden': 'true', disableremoteplayback: '' },
  });
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  box.append(v);
  homeVideoEl = v;

  // 終わりが近づいたら、最初の場面の絵（下地）に溶かす
  v.addEventListener('timeupdate', () => {
    if (v.duration && v.currentTime >= v.duration - HOME_VIDEO_FADE) v.classList.add('is-fading');
  });
  // 終わったら、見えていないうちに最初へ戻し、下地と同じ絵のまま一瞬で現す
  v.addEventListener('ended', () => {
    homeVideoTime = 0;
    v.addEventListener('seeked', () => {
      v.classList.add('is-reset');
      v.classList.remove('is-fading');
      v.play().catch(() => {});
      requestAnimationFrame(() => requestAnimationFrame(() => v.classList.remove('is-reset')));
    }, { once: true });
    v.currentTime = 0;
  });

  const begin = () => {
    if (homeVideoEl !== v || !box.isConnected) return;
    v.src = HOME_VIDEO;
    // ほかのタブから戻ってきたら、離れたところの続きから（終わりぎわなら最初から）
    const resume = homeVideoTime;
    if (resume > 0.2) {
      v.addEventListener('loadedmetadata', () => {
        if (homeVideoEl !== v) return;
        if (v.duration && resume < v.duration - HOME_VIDEO_FADE - 0.2) {
          try { v.currentTime = resume; } catch (_) { /* 途中から流せない端末は最初から */ }
        }
      }, { once: true });
    }
    v.play().catch(() => {});   // 自動で流せない端末（省電力モードなど）は、絵のまま
  };
  const bootEl = document.getElementById('boot');
  if (!bootEl || bootEl.hidden) {
    requestAnimationFrame(begin);
  } else {
    const mo = new MutationObserver(() => {
      if (!bootEl.hidden) return;
      mo.disconnect();
      requestAnimationFrame(begin);
    });
    mo.observe(bootEl, { attributes: true, attributeFilter: ['hidden'] });
  }
  return box;
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
/* ===== ホームのカード（3枚） =====
   はじめは新しく手に入れた順に3枚。10秒ごとに、前と違うカードを優先して3枚えらび直す。
   新しく手に入れたカードほど出やすい（いちばん新しい6枚は4倍、次の9枚は2倍）。
   持っているカードが3枚以下のときは入れ替えない。足りない枠はカードの裏（押すとガチャへ）。 */
const TRIO_MS = 10000;
let trioTimer = 0;

function homeTrio() {
  clearInterval(trioTimer);
  const box = el('div', { class: 'trio' });
  const owned = publishedCards().filter((c) => isOwned(c.id));
  const at = app.state.obtainedAt || {};
  const sorted = owned.slice().sort((a, b) => String(at[b.id] || '').localeCompare(String(at[a.id] || '')));
  const slots = [0, 1, 2].map(() => {
    const s = el('div', { class: 'trio__slot' });
    box.append(s);
    return s;
  });

  const put = (slot, card, first, delay) => {
    const btn = el('button', {
      class: `trio__card${first ? ' is-in' : ''}`,
      attrs: { type: 'button', 'aria-label': card ? `${card.name} の詳細を見る` : 'ガチャを引く' },
    }, [card ? cardFace(card, { small: true }) : cardBack({ small: true })]);
    btn.addEventListener('click', () => router.go(card ? `#/card/${card.id}` : '#/gacha'));
    const old = slot.querySelector('.trio__card:not(.is-out)');
    if (first) { slot.append(btn); return; }
    setTimeout(() => {
      if (!box.isConnected) return;
      slot.append(btn);
      requestAnimationFrame(() => requestAnimationFrame(() => btn.classList.add('is-in')));
      if (old) {
        old.classList.add('is-out');
        setTimeout(() => old.remove(), 700);
      }
    }, delay);
  };

  let current = sorted.slice(0, 3);
  slots.forEach((s, i) => put(s, current[i] || null, true, 0));
  if (sorted.length <= 3) return box;

  const weight = (c) => { const i = sorted.indexOf(c); return i < 6 ? 4 : (i < 15 ? 2 : 1); };
  const takeWeighted = (pool) => {
    const total = pool.reduce((a, c) => a + weight(c), 0);
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i += 1) {
      r -= weight(pool[i]);
      if (r <= 0) return pool.splice(i, 1)[0];
    }
    return pool.pop();
  };
  const pickSet = () => {
    const before = new Set(current.map((c) => c.id));
    const chosen = [];
    let pool = sorted.filter((c) => !before.has(c.id));          // まず前回と違うカードから
    while (chosen.length < 3 && pool.length) chosen.push(takeWeighted(pool));
    pool = sorted.filter((c) => !chosen.includes(c));             // 足りなければ前回のカードも
    while (chosen.length < 3 && pool.length) chosen.push(takeWeighted(pool));
    return chosen;
  };

  trioTimer = setInterval(() => {
    if (!box.isConnected) { clearInterval(trioTimer); return; }   // ホームを離れたら止める
    if (document.hidden) return;
    current = pickSet();
    slots.forEach((s, i) => put(s, current[i], false, i * 140));   // 左から少しずつずらして入れ替える
  }, TRIO_MS);
  return box;
}

boot();
