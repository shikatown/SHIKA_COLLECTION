/* update.js — アプリ本体の更新（Service Worker）と、公開データの更新を分けて扱う。
   ・本体更新：ユーザー操作で反映（勝手に再読み込みしない）
   ・データ更新：起動時に軽量チェック。進行データはそのまま。 */

import { app, commit, publishedCards } from './state.js';
import { dialog, toast, el } from './ui.js';

let refreshing = false;
/* 「更新する」を押したときだけ開き直す。
   初めて開いたときは、Service Worker が入った瞬間にも controllerchange が起きる。
   そこで開き直すと、起動演出がもう一度流れたり、ガチャの途中で画面が戻ったりしていた。 */
let userAskedUpdate = false;

export function canUseSW() {
  return 'serviceWorker' in navigator &&
    (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname));
}

export async function registerSW() {
  if (!canUseSW()) return null;
  try {
    const reg = await navigator.serviceWorker.register('./service-worker.js');

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || !userAskedUpdate) return;
      refreshing = true;
      location.reload();
    });

    if (reg.waiting) promptUpdate(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(sw);
      });
    });

    // 起動のたびに更新を確認する
    reg.update().catch(() => {});
    return reg;
  } catch (e) {
    console.warn('Service Worker を登録できませんでした', e);
    return null;
  }
}

async function promptUpdate(worker) {
  /* Service Worker は起動のいちばん最初に登録するので、起動画面やほかのお知らせの最中に
     ここへ来ることがある。同じ場所に重ねると先のお知らせが消えるので、空くまで待つ。 */
  for (let i = 0; i < 1200; i += 1) {
    const boot = document.getElementById('boot');
    const ov = document.getElementById('overlay');
    if ((!boot || boot.hidden) && (!ov || ov.hidden)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const ok = await dialog({
    title: '新しいバージョンがあります',
    body: ['更新すると最新の内容で開き直します。'],
    actions: [{ label: 'あとで', value: false }, { label: '更新する', value: true, primary: true }],
  });
  if (ok) {
    userAskedUpdate = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
  }
}

/** 写真の控えを捨てるよう Service Worker に頼む。次に見たときに取り直す。 */
export function clearImageCache() {
  const sw = navigator.serviceWorker;
  if (sw && sw.controller) sw.controller.postMessage({ type: 'CLEAR_IMAGES' });
  // Service Worker が動いていない場合は、こちらから直接消す
  else if (self.caches) caches.delete('shika-assets').catch(() => {});
}

/** 公開データの更新確認。新しく増えたカードがあれば起動時に1回だけ知らせる。 */
export async function checkDataUpdate(dataVersion) {
  const ids = publishedCards().map((c) => c.id);
  const known = app.state.knownCardIds;
  const isFirst = known.length === 0;
  const added = ids.filter((id) => !known.includes(id));

  /* データが新しくなったら、写真の控えを捨てる。
     カード番号を振り直すと、同じファイル名のまま中身だけが別の写真に変わるため、
     控えが残っていると前のカードの写真が出てしまう。 */
  const wasVersion = app.state.dataVersion;
  if (dataVersion && wasVersion && dataVersion !== wasVersion) clearImageCache();

  commit((s) => {
    s.knownCardIds = ids;
    s.dataVersion = dataVersion || s.dataVersion;
  });

  if (isFirst || added.length === 0) return 0;
  await dialog({
    title: '新しいカードが追加されました',
    body: [`新しいカードが ${added.length} 種類追加されました！`, 'ガチャで引き当ててみてください。'],
    actions: [{ label: '閉じる', value: null, primary: true }],
  });
  return added.length;
}

/* ブラウザが用意する「ホーム画面に追加」の画面（Android の Chrome など）。
   起動のすぐあとに届くので、読み込んだ時点で受け取っておき、おすすめのボタンから開く。 */
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
});
window.addEventListener('appinstalled', () => { installEvent = null; });

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

/** ホーム画面に追加（PWA）のおすすめ。初めて開いたとき、起動演出を閉じたあとに1回だけ出す。 */
export async function maybeSuggestInstall() {
  const s = app.state;
  if (s.flags.pwaPromptShown) return;
  commit((st) => { st.flags.pwaPromptShown = true; });
  if (isStandalone()) return;   // すでにホーム画面から開いている

  // ブラウザの追加の画面は、少し遅れて届くことがあるので、ほんの少しだけ待つ
  for (let i = 0; i < 6 && !installEvent; i += 1) await new Promise((r) => setTimeout(r, 250));

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const box = el('div', { class: 'pwapop' });
  box.append(el('div', { class: 'pwapop__head' }, [
    el('img', { class: 'pwapop__icon', attrs: { src: './assets/pwa/icon-192.png', alt: '', width: '56', height: '56' } }),
    el('div', {}, [
      el('div', { class: 'pwapop__name', text: 'SHIKA COLLECTION' }),
      el('div', { class: 'pwapop__sub', text: 'ホーム画面に追加して、アプリのように使えます' }),
    ]),
  ]));
  const merits = el('ul', { class: 'pwapop__merits' });
  for (const t of ['ホーム画面からすぐに開ける', '画面いっぱいに広く表示できる', '電波の弱い場所でも遊べる']) {
    merits.append(el('li', { text: t }));
  }
  box.append(merits);

  const canPrompt = !!installEvent;
  if (!canPrompt) {
    const steps = el('ol', { class: 'pwapop__steps' });
    const lines = isIOS
      ? ['画面の共有ボタン（□に↑）をタップ', '「ホーム画面に追加」を選ぶ', '右上の「追加」をタップ']
      : ['ブラウザのメニュー（︙）をタップ', '「ホーム画面に追加」または「アプリをインストール」を選ぶ'];
    for (const t of lines) steps.append(el('li', { text: t }));
    box.append(steps);
  }

  const ok = await dialog({
    title: 'ホーム画面に追加しませんか？',
    body: [box],
    actions: canPrompt
      ? [{ label: 'あとで', value: false }, { label: 'ホーム画面に追加', value: true, primary: true }]
      : [{ label: '閉じる', value: false, primary: true }],
  });
  if (ok && installEvent) {
    const ev = installEvent;
    installEvent = null;   // 同じ画面は1回しか開けない
    try {
      await ev.prompt();
      const choice = await ev.userChoice;
      if (choice && choice.outcome === 'accepted') toast('ホーム画面に追加しました');
    } catch (_) { /* 開けなかったときは何もしない */ }
  }
}
