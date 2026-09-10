/* geo.js — 現在地の扱い。
   ・自動取得はしない。[現在地を確認]を押したときだけ取得する
   ・緯度経度は保存も送信もしない（メモリ上にだけ置き、結果だけ保存する）
   ・保存するのは spotId / 初訪問済み / 最終訪問日 / 初訪ボーナス取得日 */

import { app, commit, gpsCards, todayKey, isOwned, isVisited, eventActive } from './state.js';
import { coinCfg } from './rewards.js';

let fix = null;          // { lat, lng, acc, at }  ← 保存しない
let asking = false;

export function hasFix() { return !!fix; }
export function fixAgeMinutes() {
  if (!fix) return null;
  return Math.max(0, Math.round((Date.now() - fix.at) / 60000));
}
export function forgetFix() { fix = null; }

export function supported() { return 'geolocation' in navigator; }

/**
 * 最大約5秒間、複数回測位して最も精度の良いものを使う。
 * @param {(msg:string)=>void} onProgress 進捗メッセージ
 */
export function acquire(onProgress = () => {}) {
  if (!supported()) return Promise.reject(new Error('unsupported'));
  if (asking) return Promise.reject(new Error('busy'));
  asking = true;

  const messages = ['ピン！ 波紋', '志賀町を探索中…', '現在地を確認しています'];
  let mi = 0;
  onProgress(messages[0]);
  const ticker = setInterval(() => { mi = (mi + 1) % messages.length; onProgress(messages[mi]); }, 1200);

  return new Promise((resolve, reject) => {
    let best = null;
    let done = false;
    const limit = (app.config && app.config.gpsAccuracyLimit) || 120;

    const finish = (err) => {
      if (done) return;
      done = true;
      clearInterval(ticker);
      asking = false;
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(timer);
      if (best) { fix = { ...best, at: Date.now() }; resolve({ ...fix }); }
      else reject(err || new Error('failed'));
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const cand = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
        if (!best || cand.acc < best.acc) best = cand;
        if (best.acc <= Math.min(30, limit)) finish();   // 十分良ければ早期終了
      },
      (err) => { if (!best) finish(err); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
    const timer = setTimeout(() => finish(new Error('timeout')), 5200);
  });
}

export function accuracyOK() {
  if (!fix) return false;
  const limit = (app.config && app.config.gpsAccuracyLimit) || 120;
  return fix.acc <= limit;
}
export function currentAccuracy() { return fix ? Math.round(fix.acc) : null; }

/* ===== 距離 ===== */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function distanceFromMe(lat, lng) {
  if (!fix) return null;
  return distanceMeters(fix.lat, fix.lng, lat, lng);
}

export function formatDistance(m) {
  if (m == null) return '';
  if (m < 1000) return `約 ${Math.round(m / 10) * 10} m`;
  return `約 ${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
export function distanceText(lat, lng) {
  const d = distanceFromMe(lat, lng);
  return d == null ? '' : `${formatDistance(d)}（直線）`;
}

export function myPosition() { return fix ? { lat: fix.lat, lng: fix.lng } : null; }

/* ===== チェックイン ===== */
/**
 * 1回の測位で、範囲内のGPS対象スポットをまとめて処理する。
 * @returns {{ checkins:Array, coins:number, out:boolean, nearest:Array }}
 */
export function checkIn() {
  if (!fix) return { checkins: [], coins: 0, out: true, nearest: [] };
  const cfg = coinCfg();
  const today = todayKey();
  const inRange = [];

  for (const c of gpsCards()) {
    const d = distanceMeters(fix.lat, fix.lng, c.gps.lat, c.gps.lng);
    const r = c.gps.radius || (app.config && app.config.defaultRadius) || 200;
    if (d <= r) inRange.push({ card: c, distance: d });
  }

  const checkins = [];
  let coins = 0;

  commit((s) => {
    for (const { card, distance } of inRange) {
      const v = s.visits[card.id] || { firstVisitedAt: '', lastVisitDate: '' };
      const first = !v.firstVisitedAt;
      let gained = 0;
      let newCard = false;

      if (first) {
        v.firstVisitedAt = new Date().toISOString();
        gained += cfg.spotFirst;
        if (!s.ownedCardIds.includes(card.id)) {
          s.ownedCardIds.push(card.id);
          s.obtainedAt[card.id] = new Date().toISOString();
          newCard = true;
          if (card.sakeSnack && !s.rewardClaims.sakeSnack.includes(card.id)) {
            s.rewardClaims.sakeSnack.push(card.id);
            gained += cfg.sakeSnack;
          }
        }
      } else if (v.lastVisitDate !== today) {
        gained += cfg.spotRevisit;
      }
      v.lastVisitDate = today;
      s.visits[card.id] = v;
      if (gained > 0 || first) checkins.push({ card, first, newCard, coins: gained, distance });
      coins += gained;
    }

    // 志賀町 初訪問（1回限り）
    if (inRange.length && !s.townVisited) {
      s.townVisited = true;
      coins += cfg.townFirst;
      checkins.push({ town: true, coins: cfg.townFirst });
    }

    // イベント会場ボーナス（期間中・設定ONのときだけ）
    if (inRange.length === 0 && eventActive() && app.config.event.venueBonus) {
      const ev = app.config.event;
      if (ev.lat != null && ev.lng != null) {
        const d = distanceMeters(fix.lat, fix.lng, ev.lat, ev.lng);
        if (d <= (ev.radius || 150) && s.lastEventBonusDate !== today) {
          s.lastEventBonusDate = today;
          coins += cfg.spotFirst;
          checkins.push({ event: true, name: ev.name, coins: cfg.spotFirst });
        }
      }
    }

    s.coins += coins;
  });

  return { checkins, coins, out: inRange.length === 0, nearest: nearestUnvisited(3) };
}

/** 現在地から近い未訪問スポット（距離制限なし） */
export function nearestUnvisited(n = 3) {
  if (!fix) return [];
  return gpsCards()
    .filter((c) => !isVisited(c.id))
    .map((c) => ({ card: c, distance: distanceMeters(fix.lat, fix.lng, c.gps.lat, c.gps.lng) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, n);
}

export function visitStats() {
  const all = gpsCards();
  const done = all.filter((c) => isVisited(c.id));
  return { total: all.length, visited: done.length };
}
