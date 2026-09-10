/* state.js — アプリ全体の状態。公開データ(cards/config)と端末内データ(state)をまとめる。 */

import * as storage from './storage.js';

export const CATEGORIES = [
  { key: 'gourmet', label: 'グルメ', master: 'グルメマスター' },
  { key: 'spot',    label: 'スポット', master: 'スポットマスター' },
  { key: 'culture', label: '文化',   master: '文化マスター' },
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

const listeners = new Set();

export const app = {
  cards: [],          // 公開データ全件（非公開も含む）
  cardsById: new Map(),
  config: null,
  version: null,
  state: storage.defaultState(),
  dataLoaded: false,
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(app.state); }

export function commit(mutator) {
  const r = mutator(app.state);
  storage.save(app.state);
  emit();
  return r;
}

export function setState(next) {
  app.state = next;
  storage.save(app.state);
  emit();
}

/* ===== データ読み込み ===== */

async function getJSON(path, bust) {
  const url = bust ? `${path}?v=${bust}` : path;
  const res = await fetch(url, { cache: bust ? 'no-cache' : 'default' });
  if (!res.ok) throw new Error(`${path} を読み込めませんでした (${res.status})`);
  return res.json();
}

export async function loadPublicData() {
  // version.json は軽いので毎回最新を見に行く（失敗してもキャッシュで続行）
  let version = null;
  try { version = await getJSON('./data/version.json', Date.now()); } catch (_) { /* オフライン時 */ }
  app.version = version;
  const bust = version ? version.dataVersion : '';

  const [cardsDoc, config] = await Promise.all([
    getJSON('./data/cards.json', bust),
    getJSON('./data/config.json', bust).catch(() => ({})),
  ]);

  app.cards = (cardsDoc.cards || []).map(normalizeCard);
  app.cardsById = new Map(app.cards.map((c) => [c.id, c]));
  app.config = withConfigDefaults(config);
  app.dataLoaded = true;
  return { dataVersion: cardsDoc.dataVersion || bust || '' };
}

function normalizeCard(c) {
  const gps = c.gps || {};
  const purchase = c.purchase || {};
  return {
    id: String(c.id),
    name: c.name || '',
    reading: c.reading || '',
    category: c.category || null,
    subCategory: c.subCategory || '',
    published: c.published === true,
    photo: c.photo || '',            // カードの写真（assets/photos/）
    cardText: c.cardText || '',      // カード表示用の短い説明（空なら description）
    cardButton: c.cardButton || '',   // カード下部のボタン文言（空ならジャンル既定）
    cardImage: c.cardImage || '',    // 完成画像で上書きする場合のみ
    description: c.description || '',
    season: c.season || '',
    highlight: c.highlight || '',
    detailPhotos: Array.isArray(c.detailPhotos) ? c.detailPhotos : [],
    sakeSnack: c.sakeSnack === true,
    gps: {
      enabled: gps.enabled === true && typeof gps.lat === 'number' && typeof gps.lng === 'number',
      lat: typeof gps.lat === 'number' ? gps.lat : null,
      lng: typeof gps.lng === 'number' ? gps.lng : null,
      radius: typeof gps.radius === 'number' ? gps.radius : 200,
    },
    purchase: {
      enabled: purchase.enabled === true,
      searchWord: purchase.searchWord || '',
      shops: Array.isArray(purchase.shops) ? purchase.shops.filter((s) => s && s.url) : [],
    },
    externalLinks: Array.isArray(c.externalLinks) ? c.externalLinks.filter((l) => l && l.url) : [],
  };
}

function withConfigDefaults(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const ev = c.event && typeof c.event === 'object' ? c.event : {};
  return {
    townName: c.townName || '志賀町',
    gpsAccuracyLimit: typeof c.gpsAccuracyLimit === 'number' ? c.gpsAccuracyLimit : 120,
    defaultRadius: typeof c.defaultRadius === 'number' ? c.defaultRadius : 200,
    mapCenter: c.mapCenter || { lat: 37.1057, lng: 136.7376 },
    mapZoom: typeof c.mapZoom === 'number' ? c.mapZoom : 11,
    // カード下部のボタン文言（ジャンル既定）。空にするとそのジャンルにはボタンを出さない
    cardButtons: {
      gourmet: '取扱店を検索する',
      spot: 'Googleマップで経路を見る',
      culture: '',
      ...(c.cardButtons || {}),
    },
    coin: {
      daily: 1, sakeSnack: 1, duplicatePer5: 1, categoryPer5: 2,
      spotFirst: 3, spotRevisit: 1, townFirst: 5,
      ...(c.coin || {}),
    },
    event: {
      enabled: ev.enabled === true,
      name: ev.name || '',
      startAt: ev.startAt || '',
      endAt: ev.endAt || '',
      sakeSnackBonus: ev.sakeSnackBonus !== false,
      venueBonus: ev.venueBonus === true,
      lat: typeof ev.lat === 'number' ? ev.lat : null,
      lng: typeof ev.lng === 'number' ? ev.lng : null,
      radius: typeof ev.radius === 'number' ? ev.radius : 150,
      message: ev.message || '',
    },
  };
}

/* ===== 参照系ヘルパー ===== */

export function publishedCards() {
  return app.cards.filter((c) => c.published && c.category);
}
export function ownedSet() { return new Set(app.state.ownedCardIds); }
export function isOwned(id) { return app.state.ownedCardIds.includes(id); }
export function card(id) { return app.cardsById.get(String(id)) || null; }

export function totalPublished() { return publishedCards().length; }
export function ownedPublishedCount() {
  const pub = new Set(publishedCards().map((c) => c.id));
  return app.state.ownedCardIds.filter((id) => pub.has(id)).length;
}
export function categoryStats() {
  const out = {};
  for (const { key } of CATEGORIES) out[key] = { total: 0, owned: 0 };
  for (const c of publishedCards()) {
    out[c.category].total += 1;
    if (isOwned(c.id)) out[c.category].owned += 1;
  }
  return out;
}

/** まち巡り対象（GPS対象フラグ + 座標あり）。地図には座標を持つカードも参考表示する。 */
export function gpsCards() { return app.cards.filter((c) => c.published && c.gps.enabled); }
export function mapCards() {
  return app.cards.filter((c) => c.published && typeof c.gps.lat === 'number' && typeof c.gps.lng === 'number');
}
export function isVisited(id) { return !!(app.state.visits[id] && app.state.visits[id].firstVisitedAt); }

/** イベント期間中かどうか。期間外は通常モード。 */
export function eventActive(now = new Date()) {
  const ev = app.config && app.config.event;
  if (!ev || !ev.enabled) return false;
  const s = ev.startAt ? new Date(ev.startAt) : null;
  const e = ev.endAt ? new Date(ev.endAt) : null;
  if (s && isFinite(s) && now < s) return false;
  if (e && isFinite(e) && now > e) return false;
  return true;
}

export function todayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function initState() { app.state = storage.load(); }
export { storage };
