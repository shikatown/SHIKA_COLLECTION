/* analytics.js — 利用状況の記録（Google アナリティクス GA4）。
   何人が開いたか、どの画面が見られているか、といった全体の傾向を知るためだけに使う。

   決めごと（ここを外れる実装をしないこと）
   ・送るのは「画面の名前」と「操作の種類」だけ。
     氏名・連絡先はそもそも無い。現在地の緯度経度・持っているカード・コインの残高・
     バックアップの中身は送らない。端末に保存した内容も送らない。
   ・利用者は設定画面でいつでも止められる（settings.analytics）。止めたら以後いっさい送らない。
   ・測定IDは data/config.json の analytics.measurementId。空なら何も読み込まない。
   ・作っている途中（127.0.0.1 や localhost、file:// で開いたとき）は送らない。
     本番の数字に検証の分を混ぜないため。
   ・広告向けの機能（Google シグナル・広告のカスタマイズ）は切る。
   ・オフラインのときは送られない（あとからまとめて送られることもない）。
   ・Service Worker は別オリジンの通信をそのまま通すので、控えには残らない（service-worker.js）。

   プライバシーの説明は docs/PRIVACY.md と、アプリ内の「設定 → プライバシーについて」に同じ内容で書く。 */

import { app } from './state.js';

let measurementId = '';
let started = false;

/** 利用者が「利用状況の記録を送る」を切っていないか */
export function analyticsAllowed() {
  const s = app.state;
  if (!s || !s.settings) return false;
  return s.settings.analytics !== false;
}

/** 作っている途中の環境（本番の数字に混ぜない） */
function isLocal() {
  const h = location.hostname;
  return location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '' || h.endsWith('.local');
}

function gtag() {
  // GA4 の決まりで、引数の並びをそのまま dataLayer に積む
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(arguments);
}

/**
 * 記録を始める。起動が落ち着いてから1回だけ呼ぶ（js/app.js）。
 * 測定IDが無い・利用者が切っている・作っている途中のときは、何も読み込まない。
 */
export function initAnalytics() {
  if (started) return;
  const cfg = (app.config && app.config.analytics) || {};
  measurementId = typeof cfg.measurementId === 'string' ? cfg.measurementId.trim() : '';
  if (!measurementId || cfg.enabled === false) return;
  if (isLocal() || !analyticsAllowed()) return;
  started = true;

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(s);

  gtag('js', new Date());
  gtag('config', measurementId, {
    send_page_view: false,          // 画面の切り替えは自分で送る（#/home のような形のため）
    allow_google_signals: false,    // 広告向けの横断的な計測は使わない
    allow_ad_personalization_signals: false,
    anonymize_ip: true,
  });
  trackScreen(location.hash || '#/home');
}

/** 利用者が設定で切ったとき。以後この画面では送らない */
export function stopAnalytics() {
  if (measurementId) window[`ga-disable-${measurementId}`] = true;
}

/** 設定で入れ直したとき */
export function resumeAnalytics() {
  if (measurementId) window[`ga-disable-${measurementId}`] = false;
  initAnalytics();   // まだ読み込んでいなければ、ここで読み込む
}

const SCREEN_NAMES = {
  '/home': 'ホーム',
  '/gacha': 'ガチャ',
  '/collection': 'カード一覧',
  '/card': 'カード詳細',
  '/map': 'まち巡り',
  '/missions': 'ミッション',
  '/more': 'その他',
  '/settings': '設定',
  '/privacy': 'プライバシー',
  '/guide': 'あそびかた',
  '/records': '集めた記録',
};

/** 画面を開いたとき。カード詳細は、どのカードかまでは送らず「カード詳細」にまとめる */
export function trackScreen(hash) {
  if (!started || !analyticsAllowed()) return;
  const path = `/${String(hash || '').replace(/^#\/?/, '').split('/')[0]}`;
  const base = path === '/' ? '/home' : path;
  gtag('event', 'page_view', {
    page_title: SCREEN_NAMES[base] || base,
    page_path: base,
    page_location: `${location.origin}${location.pathname}#${base}`,
  });
}

/**
 * 操作の記録。数と種類だけを送る。
 * @param {string} name 操作の名前（gacha_draw / checkin / outbound / share）
 * @param {Object} [params] 添える値（個人を特定できるものは入れないこと）
 */
export function trackEvent(name, params = {}) {
  if (!started || !analyticsAllowed()) return;
  gtag('event', name, params);
}
