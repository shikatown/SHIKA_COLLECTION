/* missions.js — ミッション。
   ガチャを引かないと分からなかった「あと何種類で報酬か」を、ここで見えるようにする。

   考え方:
   ・条件はすべて、いまの保存データから数え直して決める（別に進捗を貯めない）。
     数え方が変わっても、受け取り済みの記録さえあれば食い違わない。
   ・達成しても勝手にコインは入らない。この画面で「受け取る」を押して受け取る。
   ・受け取った記録は state.rewardClaims.missions（ミッションの id の並び）。 */

import { app, commit, CATEGORIES, categoryStats } from './state.js';
import { el, clear, toast, vibrate } from './ui.js';
import { coinCfg } from './rewards.js';
import { visitStats } from './geo.js';
import { sfx, unlock } from './sound.js';

/** ミッションの賞金。config.json の mission で上書きできる。 */
function cfg() {
  const c = (app.config && app.config.mission) || {};
  return {
    categoryStep: c.categoryStep != null ? c.categoryStep : coinCfg().categoryPer5,
    categoryAll: c.categoryAll != null ? c.categoryAll : 10,
    allCards: c.allCards != null ? c.allCards : 30,
    visit: c.visit || { 1: 3, 5: 5, 10: 8 },
    visitAll: c.visitAll != null ? c.visitAll : 15,
  };
}

/**
 * いまのミッション一覧。
 * @returns {Array<{id,group,label,note,owned,need,done,coins,claimed}>}
 */
export function missions() {
  const k = cfg();
  const stats = categoryStats();
  const list = [];

  // ① ジャンルごとに5種類ずつ
  for (const { key, label } of CATEGORIES) {
    const { owned, total } = stats[key];
    for (let n = 5; n <= total; n += 5) {
      if (n === total) break;          // ぴったり全部のときは「すべて集める」に任せる
      list.push({
        id: `cat:${key}:${n}`, group: 'カード',
        label: `${label}を ${n} 種類あつめる`,
        owned: Math.min(owned, n), need: n, coins: k.categoryStep,
      });
    }
    if (total > 0) {
      list.push({
        id: `catall:${key}`, group: 'カード',
        label: `${label}をすべてあつめる`, note: `${total} 種類`,
        owned, need: total, coins: k.categoryAll,
      });
    }
  }

  // ② ぜんぶのカード
  const allOwned = CATEGORIES.reduce((a, c) => a + stats[c.key].owned, 0);
  const allTotal = CATEGORIES.reduce((a, c) => a + stats[c.key].total, 0);
  if (allTotal > 0) {
    list.push({
      id: 'all', group: 'カード',
      label: 'すべてのカードをあつめる', note: `${allTotal} 種類`,
      owned: allOwned, need: allTotal, coins: k.allCards,
    });
  }

  // ③ まち巡り
  const v = visitStats();
  for (const n of Object.keys(k.visit).map(Number).sort((a, b) => a - b)) {
    if (n >= v.total) continue;
    list.push({
      id: `visit:${n}`, group: 'まち巡り',
      label: n === 1 ? 'はじめてのチェックイン' : `${n} か所チェックインする`,
      owned: Math.min(v.visited, n), need: n, coins: k.visit[n],
    });
  }
  if (v.total > 0) {
    list.push({
      id: 'visitall', group: 'まち巡り',
      label: 'すべての場所をチェックインする', note: `${v.total} か所`,
      owned: v.visited, need: v.total, coins: k.visitAll,
    });
  }

  const claimed = app.state.rewardClaims.missions || [];
  for (const m of list) {
    m.done = m.owned >= m.need;
    m.claimed = claimed.includes(m.id);
  }
  return list;
}

/** 受け取れるミッションの数（タブの数字） */
export function claimableCount() {
  return missions().filter((m) => m.done && !m.claimed).length;
}

/** 1件だけ受け取る。受け取ったコイン数を返す。 */
export function claim(id) {
  const m = missions().find((x) => x.id === id);
  if (!m || !m.done || m.claimed) return 0;
  commit((s) => {
    s.rewardClaims.missions.push(id);
    s.coins += m.coins;
  });
  return m.coins;
}

/** 達成しているものをまとめて受け取る。受け取った合計を返す。 */
export function claimAll() {
  const ready = missions().filter((m) => m.done && !m.claimed);
  if (!ready.length) return { count: 0, coins: 0 };
  const coins = ready.reduce((a, m) => a + m.coins, 0);
  commit((s) => {
    for (const m of ready) s.rewardClaims.missions.push(m.id);
    s.coins += coins;
  });
  return { count: ready.length, coins };
}

/* ===== 画面 ===== */

export function renderMissions(view) {
  clear(view);
  const list = missions();
  const ready = list.filter((m) => m.done && !m.claimed);

  const head = el('div', { class: 'panel' });
  head.append(el('p', {
    style: { margin: '0 0 8px', fontSize: '13.5px' },
    text: ready.length
      ? `受け取れるミッションが ${ready.length} 件あります。`
      : 'カードを集めたり、まちを巡ったりすると達成できます。',
  }));
  const total = ready.reduce((a, m) => a + m.coins, 0);
  const all = el('button', {
    class: 'btn btn--primary btn--block', attrs: { type: 'button' },
    text: ready.length ? `まとめて受け取る（+${total} SHIKA COIN）` : 'まとめて受け取る',
    on: {
      click: () => {
        unlock();
        const r = claimAll();
        if (!r.count) { toast('いま受け取れるものはありません'); return; }
        sfx.coin(); vibrate([12, 30, 18]);
        toast(`${r.count} 件で +${r.coins} SHIKA COIN`);
        renderMissions(view);
      },
    },
  });
  all.disabled = ready.length === 0;
  head.append(all);
  view.append(head);

  for (const group of ['カード', 'まち巡り']) {
    const rows = list.filter((m) => m.group === group);
    if (!rows.length) continue;
    view.append(el('h3', { text: group }));
    const box = el('div', { class: 'panel missionlist' });
    // 受け取れるものを先に、次にこれから、最後に受け取り済み
    const rank = (m) => (m.done && !m.claimed ? 0 : (m.claimed ? 2 : 1));
    for (const m of rows.slice().sort((a, b) => rank(a) - rank(b) || a.need - b.need)) {
      box.append(row(m, view));
    }
    view.append(box);
  }
}

function row(m, view) {
  const r = el('div', { class: `missionrow${m.claimed ? ' is-claimed' : ''}${m.done && !m.claimed ? ' is-ready' : ''}` });

  const body = el('div', { class: 'missionrow__b' });
  body.append(el('div', { class: 'missionrow__n', text: m.label }));
  const pct = m.need ? Math.min(100, (m.owned / m.need) * 100) : 0;
  body.append(el('div', { class: 'bar' }, [el('span', { style: { width: `${pct}%` } })]));
  body.append(el('div', {
    class: 'missionrow__d',
    text: m.claimed
      ? `受け取り済み ／ +${m.coins} SHIKA COIN`
      : (m.done ? `達成 ／ +${m.coins} SHIKA COIN` : `${m.owned} / ${m.need} ／ あと ${m.need - m.owned}`),
  }));
  r.append(body);

  if (m.claimed) {
    r.append(el('span', { class: 'missionrow__ok', text: '✓' }));
  } else if (m.done) {
    r.append(el('button', {
      class: 'btn btn--primary missionrow__go', attrs: { type: 'button' }, text: '受け取る',
      on: {
        click: () => {
          unlock();
          const got = claim(m.id);
          if (!got) return;
          sfx.coin(); vibrate(12);
          toast(`+${got} SHIKA COIN`);
          renderMissions(view);
        },
      },
    }));
  } else {
    r.append(el('span', { class: 'missionrow__coin', text: `+${m.coins}` }));
  }
  return r;
}
