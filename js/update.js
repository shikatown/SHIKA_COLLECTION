/* update.js — アプリ本体の更新（Service Worker）と、公開データの更新を分けて扱う。
   ・本体更新：ユーザー操作で反映（勝手に再読み込みしない）
   ・データ更新：起動時に軽量チェック。進行データはそのまま。 */

import { app, commit, publishedCards } from './state.js';
import { dialog, toast } from './ui.js';

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

/** PWA のホーム画面追加案内（ある程度遊んだ後に1回だけ） */
export async function maybeSuggestInstall() {
  const s = app.state;
  if (s.flags.pwaPromptShown) return;
  if (!s.flags.firstFreeTenDone) return;
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
    commit((st) => { st.flags.pwaPromptShown = true; });
    return;
  }
  commit((st) => { st.flags.pwaPromptShown = true; });
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  await dialog({
    title: 'ホーム画面に追加できます',
    body: [
      'ホーム画面に追加すると、次回からすぐ遊べます。',
      isIOS ? '共有ボタン →「ホーム画面に追加」' : 'ブラウザのメニュー →「ホーム画面に追加」',
    ],
    actions: [{ label: '閉じる', value: null, primary: true }],
  });
}
