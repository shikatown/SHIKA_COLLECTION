/* service-worker.js — オフライン対応。
   ・アプリ本体（HTML/CSS/JS）: キャッシュ優先。更新はユーザー操作で反映
   ・公開データ(JSON)        : 通信優先。取れなければキャッシュ
   ・画像・地図タイル         : キャッシュ優先（容量に上限あり）
   本体を更新したら APP_VERSION を上げること。 */

const APP_VERSION = '1.39.1';
const SHELL_CACHE = `shika-shell-${APP_VERSION}`;
const DATA_CACHE = 'shika-data';
const ASSET_CACHE = 'shika-assets';
const TILE_CACHE = 'shika-tiles';
const TILE_LIMIT = 400;
const ASSET_LIMIT = 400;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/animations.css',
  './css/card-art.css',
  './css/card-3d.css',
  './css/opening.css',
  './js/app.js',
  './js/router.js',
  './js/state.js',
  './js/storage.js',
  './js/dom.js',
  './js/ui.js',
  './js/card-render.js',
  './js/sound.js',
  './js/gacha.js',
  './js/gacha-anim.js',
  './js/rewards.js',
  './js/collection.js',
  './js/card-detail.js',
  './js/card-3d.js',
  './js/geo.js',
  './js/map.js',
  './js/offline.js',
  './js/settings.js',
  './js/admin.js',
  './js/missions.js',
  './js/backup.js',
  './js/update.js',
  './js/share.js',
  './js/opening.js',
  './js/title-complete.js',
  './js/coin-fly.js',
  './js/guide.js',
  './assets/cards/web/_back.webp',
  './assets/photos/thumb/035.jpg',
  './assets/frames/thumb/logo.png',
  './assets/icons/coin-sm.png',
  './assets/icons/coin.png',
  './assets/icons/title-complete.png',
  './assets/icons/tagline-sm.png',
  './assets/icons/web/tagline.webp',
];

/* 公開データ。入った時点で控えておく。
   アプリは起動時に通信優先でこれを読むが、初めて開いたときは Service Worker が
   まだ動いておらず、控えが作られなかった。そのため初回利用のあと通信が切れると起動できなかった。 */
const DATA_FILES = ['./data/version.json', './data/cards.json', './data/config.json'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const existed = await caches.has(SHELL_CACHE);
    const cache = await caches.open(SHELL_CACHE);
    const got = await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    /* 画面・動き・見た目のファイル（HTML/JS/CSS/manifest）は、1つでも取れなければ入れ替えない。
       失敗を無視して入れ替えると、有効化のときに古い版の控えが消え、欠けた新しい版だけが残って、
       通信が切れたときに開けなくなる。ここで失敗させれば、いまの版がそのまま使われ続ける。
       絵（png など）は、見るときに取り直せるので、欠けていても進める。 */
    const missing = SHELL.filter((u, i) => got[i].status === 'rejected' && !/\.(png|jpe?g|webp|svg|gif)$/i.test(u));
    if (missing.length) {
      if (!existed) await caches.delete(SHELL_CACHE);   // 作りかけの控えは残さない
      throw new Error(`アプリ本体の控えを作れませんでした: ${missing.join(', ')}`);
    }
    // 公開データは、通信優先で読むときと同じ名前（? を外した URL）で控える
    const data = await caches.open(DATA_CACHE);
    await Promise.allSettled(DATA_FILES.map(async (u) => {
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (res && res.ok) await data.put(new URL(u, self.location.href).href, res);
    }));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => {
      if (k.startsWith('shika-shell-') && k !== SHELL_CACHE) return caches.delete(k);
      return null;
    }));
    /* 画像もいったん捨てる。
       カード番号を振り直すと、同じファイル名（例 039.jpeg）の中身だけが別の写真に変わる。
       名前が同じなので、控えが残っていると前のカードの写真が出てしまう。
       本体を更新したときは、少し通信しても正しい写真を取り直す方を選ぶ。 */
    await caches.delete(ASSET_CACHE);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (!e.data) return;
  if (e.data.type === 'SKIP_WAITING') self.skipWaiting();
  // データ（cards.json）が新しくなったときも、写真の控えを捨てる
  if (e.data.type === 'CLEAR_IMAGES') e.waitUntil(caches.delete(ASSET_CACHE));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 地図タイル（別オリジン）
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(cacheFirst(req, TILE_CACHE, TILE_LIMIT));
    return;
  }
  if (url.origin !== location.origin) return;   // その他の外部は素通し

  // 公開データ
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
    e.respondWith(networkFirst(req, DATA_CACHE));
    return;
  }

  // 画像類
  if (/\.(webp|png|jpg|jpeg|svg|gif|avif)$/i.test(url.pathname)) {
    e.respondWith(cacheFirst(req, ASSET_CACHE, ASSET_LIMIT));
    return;
  }

  /* 画面遷移。
     アプリ本体（/ か /index.html）だけを控えから返す。
     tools/ の変換ツールなど、ほかのページまで本体に差し替えないこと。 */
  if (req.mode === 'navigate') {
    const root = new URL('./', self.registration.scope || self.location.href).pathname;
    const isApp = url.pathname === root || url.pathname === `${root}index.html`;
    e.respondWith((async () => {
      if (isApp) {
        const cached = await caches.match('./index.html', { ignoreSearch: true });
        if (cached) return cached;
      }
      try { return await fetch(req); }
      catch (_) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // 本体ファイル
  e.respondWith(cacheFirst(req, SHELL_CACHE, 0));
});

async function cacheFirst(req, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: false });
  if (hit) return hit;
  /* 本体の控え（SHELL）に入れてある絵（カードの裏・コイン・ロゴなど）も探す。
     ここを見ないと、通信が切れたときにそれらの絵だけ出なかった。 */
  const shared = await caches.match(req, { ignoreSearch: false });
  if (shared) return shared;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone());
      if (limit) trim(cacheName, limit);
    }
    return res;
  } catch (e) {
    const loose = await cache.match(req, { ignoreSearch: true });
    if (loose) return loose;
    throw e;
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(stripQuery(req), res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(stripQuery(req));
    if (hit) return hit;
    const loose = await cache.match(req, { ignoreSearch: true });
    if (loose) return loose;
    throw e;
  }
}

function stripQuery(req) {
  const u = new URL(req.url);
  u.search = '';
  return new Request(u.toString(), { method: 'GET' });
}

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const k of keys.slice(0, keys.length - limit)) await cache.delete(k);
}
