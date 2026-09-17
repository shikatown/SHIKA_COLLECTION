/* rewards.js — SHIKA COIN の付与ルールを1か所にまとめる。
   ・デイリー           1日1回 +1。ログインした日数が 5日目 +5 ／ 10日目 +10 ／ 15日目 +15、15日目の翌日にまた1日目
   ・酒のアテ           初取得時のみ +1（Excelの明示フラグのみ。自動推論しない）
   ・かぶり             全カード共通ゲージ 5枚ごと +1（繰り越しあり）
   ・カテゴリ収集       ミッション画面で受け取る（js/missions.js）
   ・現地訪問           初訪問 +3 / 再訪 1日1回 +1 / 町初訪問 +5（1回限り） */

import { FANCLUB_TITLE, isFanclubMember } from './fanclub.js';
import { app, commit, saveOk, todayKey, CATEGORIES, CATEGORY_LABEL, categoryStats, eventActive, publishedCards, isOwned, gpsCards, isVisited } from './state.js';

export function coinCfg() {
  return (app.config && app.config.coin) || {
    daily: 1, sakeSnack: 1, duplicatePer5: 1, categoryPer5: 2,
    spotFirst: 3, spotRevisit: 1, townFirst: 5,
    loginBonus: { 5: 5, 10: 10, 15: 15 },
  };
}

/** ログインボーナス1周の日数（ごほうびのいちばん大きい日目。既定 15日） */
export function loginCycle() {
  const days = Object.keys(coinCfg().loginBonus || {}).map(Number).filter((n) => n > 0);
  return days.length ? Math.max(...days) : 15;
}

/**
 * ログインボーナスのいまの状況。
 * @returns {{day:number, cycle:number, bonus:Object, next:number|null, nextCoins:number, today:boolean}}
 *   day = この周で何日目まで受け取ったか、today = 今日の分を受け取ったか
 */
export function loginInfo() {
  const cycle = loginCycle();
  const bonus = coinCfg().loginBonus || {};
  const day = Math.min(app.state.loginDays || 0, cycle);
  const next = Object.keys(bonus).map(Number).sort((a, b) => a - b).find((d) => d > day) || null;
  return { day, cycle, bonus, next, nextCoins: next ? bonus[next] : 0, today: !dailyAvailable() };
}

/** デイリーボーナス。付与したコイン数を返す（0なら本日分は付与済み）。
    毎日の分に、ログインした日数のごほうび（5日目・10日目・15日目）を足す。
    日数は「受け取った日」を数える（続けてでなくてよい）。1周（15日）を終えた翌日は、また1日目。 */
export function claimDaily() {
  const today = todayKey();
  if (app.state.dailyBonusDate === today) return 0;
  const cfg = coinCfg();
  const cycle = loginCycle();
  const prev = app.state.loginDays || 0;
  const day = prev >= cycle ? 1 : prev + 1;
  const amount = cfg.daily + ((cfg.loginBonus || {})[day] || 0);
  commit((s) => { s.dailyBonusDate = today; s.loginDays = day; s.coins += amount; });
  return saveOk() ? amount : 0;   // 保存できなければ、受け取ったことにしない
}

export function dailyAvailable() { return app.state.dailyBonusDate !== todayKey(); }

/**
 * 抽選結果を確定保存し、発生したボーナスを返す。
 * @param {Array<{id:string,isNew:boolean}>} results 抽選済み結果（順序も確定済み）
 */
/**
 * 抽選結果を、渡された状態の写しに書き込み、発生したボーナスを返す（保存はしない）。
 * ガチャはコインの消費・獲得・ボーナス・結果を1回の保存にまとめるので、ここは書き込むだけ。
 */
export function applyDrawTo(s, results) {
  const cfg = coinCfg();
  const items = [];
  let total = 0;

  {
    const owned = new Set(s.ownedCardIds);
    let dup = 0;
    const newSake = [];

    for (const r of results) {
      if (owned.has(r.id)) { dup += 1; continue; }
      owned.add(r.id);
      s.ownedCardIds.push(r.id);
      s.obtainedAt[r.id] = new Date().toISOString();
      if (!s.unseenCardIds.includes(r.id)) s.unseenCardIds.push(r.id);   // 一覧で枠にはめて見せる
      const c = app.cardsById.get(r.id);
      if (c && c.sakeSnack && !s.rewardClaims.sakeSnack.includes(r.id)) {
        if (!eventSakeDisabled()) { s.rewardClaims.sakeSnack.push(r.id); newSake.push(c); }
      }
    }

    // 酒のアテ
    if (newSake.length) {
      const coins = newSake.length * cfg.sakeSnack;
      s.coins += coins; total += coins;
      items.push({ label: newSake.length > 1 ? `酒のアテ発見 ×${newSake.length}` : '酒のアテ発見', coins });
    }

    // かぶりゲージ
    if (dup > 0) {
      s.duplicateGauge += dup;
      let n = 0;
      while (s.duplicateGauge >= 5) { s.duplicateGauge -= 5; n += 1; }
      if (n > 0) {
        const coins = n * cfg.duplicatePer5;
        s.coins += coins; total += coins;
        items.push({ label: 'かぶりボーナス', coins });
      }
    }

    /* ジャンル収集のコインは、ここでは渡さない。
       ミッション画面で「受け取る」を押して受け取る（js/missions.js）。 */
  }

  return { items, total };
}

/** 抽選結果を確定保存し、発生したボーナスを返す。保存できなければ何も無かったことにする。 */
export function applyDraw(results) {
  let out = { items: [], total: 0 };
  commit((s) => { out = applyDrawTo(s, results); });
  return saveOk() ? out : { items: [], total: 0 };
}

function eventSakeDisabled() {
  // イベント設定で「酒のアテ」をOFFにしている期間中は付与しない
  return eventActive() && app.config.event.sakeSnackBonus === false;
}

/** かぶりゲージの残り（次の+1まであと何枚か） */
export function duplicateGaugeInfo() {
  const g = app.state.duplicateGauge % 5;
  return { current: g, need: 5 - g };
}

/** カテゴリごとの次の報酬までの残り種類数 */
export function categoryProgress() {
  const stats = categoryStats();
  return CATEGORIES.map(({ key, label, master }) => {
    const { owned, total } = stats[key];
    const next = (Math.floor(owned / 5) + 1) * 5;
    const complete = total > 0 && owned >= total;
    return {
      key, label, master, owned, total, complete,
      nextAt: next <= total ? next : null,
      remain: next <= total ? next - owned : null,
    };
  });
}

/** 獲得済みの称号 */
/** いちばん上の称号。すべてのカードを集め、すべてのスポットでチェックインしたらもらえる */
export const COMPLETE_TITLE = '志賀町コンプリート';

/** すべてのカードとすべてのチェックイン対象を達成したか
    （geo.js は rewards.js を読み込んでいるので、ここでは state.js の関数で数える） */
export function isTownComplete() {
  const cards = publishedCards();
  const spots = gpsCards();
  if (!cards.length) return false;
  return cards.every((c) => isOwned(c.id)) && spots.every((c) => isVisited(c.id));
}

export function titles() {
  const prog = categoryProgress();
  const list = prog.filter((p) => p.complete).map((p) => p.master);
  if (isFanclubMember()) list.push(FANCLUB_TITLE);
  if (prog.length && prog.every((p) => p.complete)) list.push('志賀町マスター');
  if (isTownComplete()) list.push(COMPLETE_TITLE);
  return list;
}

export function grantCoins(amount, reasonLabel) {
  if (amount <= 0) return 0;
  commit((s) => { s.coins += amount; });
  return saveOk() ? amount : 0;
}

export { CATEGORY_LABEL };
