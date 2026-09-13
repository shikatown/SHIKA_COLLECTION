/* rewards.js — SHIKA COIN の付与ルールを1か所にまとめる。
   ・デイリー           1日1回 +1
   ・酒のアテ           初取得時のみ +1（Excelの明示フラグのみ。自動推論しない）
   ・かぶり             全カード共通ゲージ 5枚ごと +1（繰り越しあり）
   ・カテゴリ収集       ミッション画面で受け取る（js/missions.js）
   ・現地訪問           初訪問 +3 / 再訪 1日1回 +1 / 町初訪問 +5（1回限り） */

import { app, commit, todayKey, CATEGORIES, CATEGORY_LABEL, categoryStats, eventActive, publishedCards, isOwned, gpsCards, isVisited } from './state.js';

export function coinCfg() {
  return (app.config && app.config.coin) || {
    daily: 1, sakeSnack: 1, duplicatePer5: 1, categoryPer5: 2,
    spotFirst: 3, spotRevisit: 1, townFirst: 5,
  };
}

/** デイリーボーナス。付与したコイン数を返す（0なら本日分は付与済み）。 */
export function claimDaily() {
  const today = todayKey();
  if (app.state.dailyBonusDate === today) return 0;
  const amount = coinCfg().daily;
  commit((s) => { s.dailyBonusDate = today; s.coins += amount; });
  return amount;
}

export function dailyAvailable() { return app.state.dailyBonusDate !== todayKey(); }

/**
 * 抽選結果を確定保存し、発生したボーナスを返す。
 * @param {Array<{id:string,isNew:boolean}>} results 抽選済み結果（順序も確定済み）
 */
export function applyDraw(results) {
  const cfg = coinCfg();
  const items = [];
  let total = 0;

  commit((s) => {
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
  });

  return { items, total };
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
  if (prog.length && prog.every((p) => p.complete)) list.push('志賀町マスター');
  if (isTownComplete()) list.push(COMPLETE_TITLE);
  return list;
}

export function grantCoins(amount, reasonLabel) {
  if (amount <= 0) return 0;
  commit((s) => { s.coins += amount; });
  return amount;
}

export { CATEGORY_LABEL };
