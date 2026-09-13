/* collection.js — コレクション。カテゴリ別・カード番号順。
   未取得はシルエット＋???。ただし「まち巡り」対象スポットは観光情報を公開し、
   カード画像だけ伏せる（現地へ行くきっかけを残すため）。 */

import { app, isOwned, CATEGORIES, CATEGORY_LABEL, publishedCards, categoryStats, commit } from './state.js';
import { el, clear, cardFace, cardBack, lockedCard, vibrate, reduceMotion, sleep } from './ui.js';
import { categoryProgress, coinCfg } from './rewards.js';
import { shareApp } from './share.js';
import { go } from './router.js';
import { sfx } from './sound.js';

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

  /* コレクション。全体の枚数と、ジャンルごとの集まりぐあいをひとつにまとめる。
     （以前はホーム画面に「集まりぐあい」として置いていた） */
  const head = el('div', { class: 'panel', style: { marginBottom: '12px' } });
  head.append(el('div', { class: 'panel__head' }, [
    el('h3', { class: 'panel__title', text: 'コレクション' }),
    el('span', { class: 'collection__all', text: `${owned} / ${total} 種類` }),
  ]));
  head.append(el('div', { class: 'bar bar--lg' }, [
    el('span', { style: { width: `${total ? (owned / total) * 100 : 0}%` } }),
  ]));
  for (const c of categoryProgress()) {
    head.append(el('div', { class: 'progressline', style: { marginTop: '9px' } }, [
      el('img', { class: 'progressline__i', attrs: { src: `./assets/frames/thumb/icon-${c.key}.png`, alt: '', decoding: 'async' } }),
      el('span', { style: { width: '4.4em', flex: 'none' }, text: c.label }),
      el('div', { class: 'bar' }, [el('span', { style: { width: `${c.total ? (c.owned / c.total) * 100 : 0}%` } })]),
      el('span', { class: 'progressline__n', text: `${c.owned}/${c.total}` }),
    ]));
  }
  // 称号はミッションの画面にまとめた（達成したことが分かるものを1か所に集めるため）

  /* SNSでシェア。集めた枚数を一緒に送るので、コレクション欄の下にまとめて置く */
  const share = el('div', { class: 'collection__share' });
  share.append(el('span', { class: 'collection__sharetext', text: `${owned} 種類あつめたことを、みんなに知らせよう` }));
  share.append(el('button', {
    class: 'btn collection__sharebtn', attrs: { type: 'button' },
    html: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="18.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>SNSでシェア</span>',
    on: { click: () => shareApp() },
  }));
  head.append(share);
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

  if (fresh.length) snapIn(grid, [...grid.querySelectorAll('.cell--snap')]);
}

/** 枠にはまる演出。見せ終わったら控えを消して、次に開いたときは静かにする。 */
/** 枠にはまる演出。
    1枚ずつ「画面のまん中に大きく出す → くるっと回る → 枠にパチーンとはまる」。
    はまったカードには NEW を付けて、何が手に入ったか画面を離れるまで分かるようにする。
    見せ終わったら控えを消して、次に開いたときは静かにする。 */
async function snapIn(grid, cells) {
  /* 「見た」にするのは、実際に枠にはまったカードだけ。
     以前は途中でやめても未確認の記録を全部消していたので、見ていないカードの演出が二度と出なかった。 */
  const shown = new Set();
  const done = () => commit((s) => { s.unseenCardIds = s.unseenCardIds.filter((id) => !shown.has(id)); });
  const finish = (cellEl) => {
    shown.add(cellEl.dataset.id);
    cellEl.classList.add('is-snapped');
    const card = cellEl.querySelector('.cell__drop > .card') || cellEl.querySelector('.card');
    if (card && !card.querySelector('.card__new')) card.append(el('div', { class: 'card__new', text: 'NEW' }));
  };

  if (reduceMotion()) { for (const c of cells) finish(c); done(); return; }

  /* 演出のあいだは画面外を省く描画（content-visibility）を止める。
     省いたままだと高さが仮置きのままで、寄せた先が後からずれる。 */
  grid.classList.add('grid--snapping');
  const many = cells.length > 6;
  // ゆっくり3回ひるがえるので、回転にはそれなりの時間を取る
  const T = many
    ? { glide: 300, spin: 1150, hold: 80, fly: 360, rest: 120 }
    : { glide: 340, spin: 1500, hold: 180, fly: 440, rest: 260 };

  // 画面のどこかを触られたら、残りはまとめて終わらせる（長く待たせない）
  let skip = false;
  const askSkip = () => { skip = true; };
  // 手で動かされたら、追いかけるのはやめる（勝手に戻されると操作できない）
  let follow = true;
  const stopFollow = () => { follow = false; };
  for (const ev of ['wheel', 'touchstart', 'keydown']) {
    window.addEventListener(ev, stopFollow, { passive: true });
  }
  const release = () => {
    for (const ev of ['wheel', 'touchstart', 'keydown']) window.removeEventListener(ev, stopFollow);
  };

  /* 画面を離れたら（別のタブへ移る・カードを開く・絞り込みで一覧を描き直す）、演出はそこでやめて片付ける。
     以前は画面が変わっても暗い幕と飛ぶカードが残り、次のカードの演出まで続いていた。 */
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    for (const n of document.querySelectorAll('.snapfly, .snapdim')) n.remove();
  };
  window.addEventListener('hashchange', cancel);
  const gone = () => cancelled || !grid.isConnected;

  const targetY = (node) => {
    const r = node.getBoundingClientRect();
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return Math.max(0, Math.min(max, window.scrollY + r.top + r.height / 2 - window.innerHeight / 2));
  };
  /* その枠を画面のまん中へ寄せる。
     `scrollIntoView({behavior:'smooth'})` は効かない環境があり、
     requestAnimationFrame も止まることがあるので、時間で進めるタイマーで動かす。 */
  const glideTo = (node) => new Promise((resolve) => {
    const from = window.scrollY;
    const to = targetY(node);
    if (!follow || Math.abs(to - from) < 2) { resolve(); return; }
    const t0 = performance.now();
    const step = () => {
      if (!follow || gone()) { resolve(); return; }   // 離れた画面を勝手に動かさない
      const k = Math.min(1, (performance.now() - t0) / T.glide);
      window.scrollTo(0, from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) setTimeout(step, 16);
      else resolve();
    };
    step();
  });
  // 画面外の枠は高さが仮置きなので、飛ばす直前にもう一度だけ合わせ直す
  const settleOn = (node) => {
    if (!follow) return;
    const to = targetY(node);
    if (Math.abs(to - window.scrollY) > 24) window.scrollTo(0, to);
  };

  /** 1枚ぶん。中央で回してから、その枠へ飛ばす。 */
  const flyInto = async (cellEl, card, last) => {
    const box = cellEl.querySelector('.cell__box');
    const dim = el('div', { class: 'snapdim' });
    const fly = el('div', { class: 'snapfly' });
    const core = el('div', { class: 'snapfly__c' });
    core.append(el('div', { class: 'snapfly__s snapfly__s--back' }, [cardBack()]));
    core.append(el('div', { class: 'snapfly__s snapfly__s--front' }, [cardFace(card)]));
    fly.append(core);
    fly.style.setProperty('--tspin', `${T.spin}ms`);
    fly.style.setProperty('--tfly', `${T.fly}ms`);
    dim.addEventListener('pointerdown', askSkip);
    document.body.append(dim, fly);

    // 中央に大きく出して、くるっと回す
    fly.classList.add('is-in');
    await sleep(T.spin + T.hold);
    if (gone()) { fly.remove(); dim.remove(); return; }

    // 枠の位置へ飛ばす
    settleOn(cellEl);
    const to = box.getBoundingClientRect();
    const from = fly.getBoundingClientRect();
    fly.style.setProperty('--dx', `${Math.round(to.left + to.width / 2 - (from.left + from.width / 2))}px`);
    fly.style.setProperty('--dy', `${Math.round(to.top + to.height / 2 - (from.top + from.height / 2))}px`);
    fly.style.setProperty('--k', (to.width / from.width).toFixed(4));
    dim.classList.add('is-out');
    fly.classList.add('is-fly');
    await sleep(T.fly);
    if (gone()) { fly.remove(); dim.remove(); return; }

    // 着地。「パチーン」と鳴らす
    finish(cellEl);
    sfx.snap();
    vibrate(last ? [16, 34, 24] : 12);
    fly.remove();
    dim.remove();
  };

  /* 起動直後にこの画面から始まったときは、起動画面がまだ前に出ている。
     その裏で演出しても見えないので、消えるまで待つ。 */
  const bootEl = document.getElementById('boot');
  for (let i = 0; i < 60 && bootEl && !bootEl.hidden; i += 1) await sleep(120);

  await sleep(620);   // 画面の位置を戻す処理（router.js）が落ち着くまで待つ
  for (const [i, cellEl] of cells.entries()) {
    if (skip || gone()) break;
    const card = app.cardsById.get(cellEl.dataset.id);
    if (!card) { finish(cellEl); continue; }
    await glideTo(cellEl);
    if (gone()) break;
    await flyInto(cellEl, card, i === cells.length - 1);
    if (gone()) break;
    await sleep(T.rest);
  }
  window.removeEventListener('hashchange', cancel);
  for (const n of document.querySelectorAll('.snapfly, .snapdim')) n.remove();
  grid.classList.remove('grid--snapping');
  release();
  // 触って飛ばしたぶんは、そのまま枠に収める。画面を離れたときは収めない（次に開いたときに演出する）
  if (!gone()) for (const c of cells) finish(c);
  done();
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
    class: `cell${snap ? ' cell--snap' : ''}`,
    attrs: { type: 'button', 'data-id': c.id },
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

  /* 番号は名前の行の先頭に置く。カードの上に重ねると、
     カードに印刷された絵や番号と重なって読みにくいため。 */
  const no = String(Number(c.id) || 0).padStart(2, '0');
  const label = el('div', { class: `cell__name${owned ? '' : ' cell__name--locked'}` });
  label.append(el('b', { class: 'cell__no', text: `#${no}` }));
  label.append(el('span', {
    text: owned || openSpot ? c.name : (CATEGORY_LABEL[c.category] || '???'),
  }));
  btn.append(label);

  btn.addEventListener('click', () => go(`#/card/${c.id}`));
  return btn;
}
