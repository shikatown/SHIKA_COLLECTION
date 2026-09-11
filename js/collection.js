/* collection.js — コレクション。カテゴリ別・カード番号順。
   未取得はシルエット＋???。ただし「まち巡り」対象スポットは観光情報を公開し、
   カード画像だけ伏せる（現地へ行くきっかけを残すため）。 */

import { app, isOwned, CATEGORIES, CATEGORY_LABEL, publishedCards, categoryStats, commit } from './state.js';
import { el, clear, cardFace, lockedCard, vibrate, reduceMotion } from './ui.js';
import { categoryProgress, coinCfg } from './rewards.js';
import { go } from './router.js';

const TABS = [
  { key: 'all', label: 'すべて' },
  ...CATEGORIES.map((c) => ({ key: c.key, label: c.label })),
  { key: 'fav', label: '♡ 気になる' },
];

let currentTab = 'all';

export function renderCollection(view, params) {
  clear(view);
  if (params && params.tab) currentTab = params.tab;

  const stats = categoryStats();
  const total = publishedCards().length;
  const owned = publishedCards().filter((c) => isOwned(c.id)).length;

  const head = el('div', { style: { marginBottom: '6px' } });
  head.append(el('h2', { text: 'カード', style: { marginBottom: '2px' } }));
  head.append(el('p', { class: 'muted', style: { margin: 0 }, text: `${owned} / ${total} 種類` }));
  view.append(head);

  const tabs = el('div', { class: 'tabs' });
  for (const t of TABS) {
    tabs.append(el('button', {
      class: `chip${currentTab === t.key ? ' is-active' : ''}`,
      attrs: { type: 'button' }, text: t.label,
      on: { click: () => { currentTab = t.key; renderCollection(view); } },
    }));
  }
  view.append(tabs);

  if (currentTab !== 'all' && currentTab !== 'fav') {
    const p = categoryProgress().find((x) => x.key === currentTab);
    if (p) {
      const line = el('div', { class: 'panel', style: { marginBottom: '12px' } });
      line.append(el('div', {
        style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' },
      }, [
        el('span', { text: `${p.label} ${p.owned}/${p.total}` }),
        el('span', {
          class: 'muted',
          text: p.complete ? `${p.master} 獲得` : (p.remain != null ? `次の報酬まであと ${p.remain} 種類` : ''),
        }),
      ]));
      line.append(el('div', { class: 'bar', style: { marginTop: '8px' } }, [
        el('span', { style: { width: `${p.total ? (p.owned / p.total) * 100 : 0}%` } }),
      ]));
      view.append(line);
    }
  }

  const list = filtered();
  if (!list.length) {
    view.append(el('p', {
      class: 'empty',
      text: currentTab === 'fav' ? '「気になる」に入れたカードがここに並びます。' : '該当するカードがありません。',
    }));
    return;
  }

  // 取得したばかりのカードは、この一覧で枠にはめて見せる
  const fresh = app.state.unseenCardIds.filter((id) => list.some((c) => c.id === id));

  const grid = el('div', { class: 'grid' });
  let n = 0;
  for (const c of list) grid.append(cell(c, fresh.includes(c.id) ? n++ : -1));
  view.append(grid);

  if (fresh.length) snapIn(grid, fresh.length);
}

/** 枠にはまる演出。見せ終わったら控えを消して、次に開いたときは静かにする。 */
function snapIn(grid, count) {
  const cells = [...grid.querySelectorAll('.cell--snap')];
  const done = () => commit((s) => { s.unseenCardIds = []; });
  if (reduceMotion() || !cells.length) { done(); return; }

  // いちばん上のカードが見えていないと、演出に気づけない
  cells[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  for (const [i, cellEl] of cells.entries()) {
    setTimeout(() => {
      cellEl.classList.add('is-snapped');
      vibrate(i === cells.length - 1 ? [14, 30, 20] : 9);
    }, 260 + i * 150);
  }
  setTimeout(done, 600 + count * 150);
}

function filtered() {
  const all = publishedCards().slice().sort((a, b) => a.id.localeCompare(b.id, 'ja'));
  if (currentTab === 'all') {
    // カテゴリ順 → カード番号順
    const order = Object.fromEntries(CATEGORIES.map((c, i) => [c.key, i]));
    return all.sort((a, b) => (order[a.category] - order[b.category]) || a.id.localeCompare(b.id, 'ja'));
  }
  if (currentTab === 'fav') {
    const fav = app.state.favorites;
    return all.filter((c) => fav.includes(c.id))
      .sort((a, b) => fav.indexOf(b.id) - fav.indexOf(a.id));   // 最近入れたものが先頭
  }
  return all.filter((c) => c.category === currentTab);
}

/**
 * 一覧の1マス。
 * @param {object} c カード
 * @param {number} order 枠にはめる演出の順番。-1 なら演出しない
 */
function cell(c, order = -1) {
  const owned = isOwned(c.id);
  const openSpot = !owned && c.gps.enabled;      // 観光情報だけ公開するスポット
  const snap = owned && order >= 0;
  const btn = el('button', {
    class: `cell${snap ? ' cell--snap' : ''}`, attrs: { type: 'button' },
    style: snap ? { '--i': order } : null,
  });

  if (snap) {
    // 空の枠を下に敷いておき、その上にカードがはまる
    const box = el('div', { class: 'cell__box' });
    box.append(lockedCard(c, { small: true }));
    box.append(el('div', { class: 'cell__drop' }, [cardFace(c, { small: true })]));
    btn.append(box);
  } else {
    btn.append(owned ? cardFace(c, { small: true }) : lockedCard(c, { small: true }));
  }

  const label = el('div', { class: `cell__name${owned ? '' : ' cell__name--locked'}` });
  label.append(el('b', { class: 'cell__no', text: `#${String(Number(c.id) || 0).padStart(2, '0')}` }));
  label.append(el('span', {
    text: owned || openSpot ? c.name : (CATEGORY_LABEL[c.category] || '???'),
  }));
  btn.append(label);

  btn.addEventListener('click', () => go(`#/card/${c.id}`));
  return btn;
}
