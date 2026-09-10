/* rewards.js — SHIKA COIN の付与ルールを1か所にまとめる。
   ・デイリー           1日1回 +1
   ・酒のアテ           初取得時のみ +1（Excelの明示フラグのみ。自動推論しない）
   ・かぶり             全カード共通ゲージ 5枚ごと +1（繰り越しあり）
   ・カテゴリ収集       同カテゴリ5種類ごと +2（自動付与・受取ボタンなし）
   ・現地訪問           初訪問 +3 / 再訪 1日1回 +1 / 町初訪問 +5（1回限り） */

import { app, commit, todayKey, CATEGORIES, CATEGORY_LABEL, categoryStats, eventActive } from './state.js';

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

    // カテゴリ収集（5種類ごと）
    for (const { key, label } of CATEGORIES) {
      const ownedCount = app.cards.filter(
        (c) => c.published && c.category === key && s.ownedCardIds.includes(c.id)
      ).length;
      const steps = Math.floor(ownedCount / 5);
      const done = s.rewardClaims.category[key] || 0;
      if (steps > done) {
        const coins = (steps - done) * cfg.categoryPer5;
        s.rewardClaims.category[key] = steps;
        s.coins += coins; total += coins;
        items.push({ label: `${label} ${steps * 5}種類達成`, coins });
      }
    }
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
export function titles() {
  const prog = categoryProgress();
  const list = prog.filter((p) => p.complete).map((p) => p.master);
  if (prog.length && prog.every((p) => p.complete)) list.push('志賀町マスター');
  return list;
}

export function grantCoins(amount, reasonLabel) {
  if (amount <= 0) return 0;
  commit((s) => { s.coins += amount; });
  return amount;
}

export { CATEGORY_LABEL };
