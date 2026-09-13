/* service-worker.js — オフライン対応。
   ・アプリ本体（HTML/CSS/JS）: キャッシュ優先。更新はユーザー操作で反映
   ・公開データ(JSON)        : 通信優先。取れなければキャッシュ
   ・画像・地図タイル         : キャッシュ優先（容量に上限あり）
   本体を更新したら APP_VERSION を上げること。 */

const APP_VERSION = '1.34.3';
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
  './assets/cards/_back.png',
  './assets/photos/thumb/035.jpg',
  './assets/frames/thumb/logo.png',
  './assets/icons/coin-sm.png',
  './assets/icons/coin.png',
  './assets/icons/title-complete.png',
  './assets/icons/tagline-sm.png',
  './assets/icons/tagline.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
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
