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

  // 1枚ずつ、その枠まで画面を寄せてからはめる。10連でも全部を見てもらう。
  /* 演出のあいだは画面外を省く描画（content-visibility）を止める。
     省いたままだと高さが仮置きのままで、寄せた先が後からずれる。 */
  grid.classList.add('grid--snapping');
  const many = cells.length > 6;
  if (many) grid.classList.add('grid--quicksnap');
  const START = 480;
  const STEP = many ? 800 : 1150;   // 1枚あたりの持ち時間
  const GLIDE = 340;                // 寄せるのにかける時間
  const SNAP = 400;                 // 寄せ終わってから、はまり始めるまで
  const LAND = many ? 660 : 920;    // 落ちて止まるまで（css の snapIn と同じ長さ）

  // 手で動かされたら、追いかけるのはやめる（勝手に戻されると操作できない）
  let follow = true;
  const stopFollow = () => { follow = false; };
  for (const ev of ['wheel', 'touchstart', 'keydown']) {
    window.addEventListener(ev, stopFollow, { once: true, passive: true });
  }

  /* その枠を画面のまん中へ寄せる。
     `scrollIntoView({behavior:'smooth'})` は効かない環境があり、
     requestAnimationFrame も止まることがあるので、時間で進めるタイマーで動かす。 */
  const targetY = (node) => {
    const r = node.getBoundingClientRect();
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(max, window.scrollY + r.top + r.height / 2 - window.innerHeight / 2));
  };
  /* 端末が遅いとタイマーがまとめて遅れて届く。
     そのとき古い順番の寄せが動くと、次のカードを見ているのに引き戻されてしまう。
     いま見せている順番（turn）と違う指示は捨てる。 */
  let turn = -1;
  const glideTo = (node, i) => {
    const from = window.scrollY;
    const to = targetY(node);
    if (Math.abs(to - from) < 2) return;
    const t0 = performance.now();
    const step = () => {
      if (!follow || turn !== i) return;
      const k = Math.min(1, (performance.now() - t0) / GLIDE);
      window.scrollTo(0, from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) setTimeout(step, 16);
    };
    step();
  };
  /* 画面外のカードは高さが仮置き（content-visibility）なので、
     近づいて実際に描かれた瞬間に前後がずれる。1回合わせただけでは足りないので、
     はめる前後に数回だけ合わせ直して落ち着かせる。 */
  const settleOn = (node, i) => {
    const fix = () => {
      if (!follow || turn !== i) return;
      const to = targetY(node);
      if (Math.abs(to - window.scrollY) > 24) window.scrollTo(0, to);
    };
    fix();
    setTimeout(fix, 90);
    setTimeout(fix, 220);
  };

  for (const [i, cellEl] of cells.entries()) {
    const at = START + i * STEP;
    setTimeout(() => { turn = i; if (follow) glideTo(cellEl, i); }, at);
    setTimeout(() => {
      if (follow) settleOn(cellEl, i);
      cellEl.classList.add('is-snapped');
      // 手ごたえは「はまった瞬間」に返す
      setTimeout(() => vibrate(i === cells.length - 1 ? [16, 34, 24] : 12), LAND);
    }, at + SNAP);
  }
  setTimeout(() => {
    grid.classList.remove('grid--quicksnap', 'grid--snapping');
    for (const ev of ['wheel', 'touchstart', 'keydown']) window.removeEventListener(ev, stopFollow);
    done();
  }, START + cells.length * STEP + SNAP + LAND + 600);
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
