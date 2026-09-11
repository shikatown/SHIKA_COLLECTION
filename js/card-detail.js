/* card-detail.js — カード詳細。カード画像と情報UIは分離して扱う。
   不確かな情報は補わない：Excelに入っている内容だけを表示する。 */

import { app, isOwned, isVisited, commit, CATEGORY_LABEL, CATEGORIES, publishedCards } from './state.js';
import {
  el, clear, cardFace, lockedCard, toast, externalLink, mapsSearchUrl, safeUrl, resolvePhoto, vibrate,
} from './ui.js';
import { openViewer } from './card-3d.js';
import { coinCfg } from './rewards.js';
import { distanceText, hasFix } from './geo.js';
import { go } from './router.js';

export function renderCardDetail(view, params) {
  clear(view);
  const c = app.cardsById.get(String(params.id));
  if (!c) { view.append(el('p', { class: 'empty', text: 'カードが見つかりません。' })); return; }

  attachSwipe(view);         // 左右に払うと前後のカードへ（受け付けは1回だけ付ける）
  maybeHintSwipe();

  const owned = isOwned(c.id);
  const openSpot = !owned && c.gps.enabled;   // 未取得でも観光情報は見せるスポット
  if (!owned && !openSpot) return renderLocked(view, c);

  // 現地訪問の欄が付くカードは、その高さぶんカードを控えめにして1画面に収める
  const hero = el('div', { class: `detail__hero${c.gps.enabled ? ' detail__hero--compact' : ''}` });
  // 取得済みは画面の端まで大きく。未取得は空き枠なので、控えめな大きさにとどめる。
  const wrap = el('div', { class: `detail__cardwrap${owned ? '' : ' detail__cardwrap--slot'}` });
  if (owned) {
    const face = cardFace(c);   // 大きく出すので原寸を使う
    face.style.cursor = 'pointer';
    // カードに印刷されたボタンは本物のリンクにする。それ以外を押すとカードを大きく見る。
    linkCardButton(face, c);
    face.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;   // ボタンのリンクはそのまま開かせる
      if (justSwiped()) return;            // 左右に払っただけのときは開かない
      openViewer(c.id);
    });
    wrap.append(track(c, face));
  } else {
    wrap.append(lockedCard(c));
    wrap.append(el('p', { class: 'muted', style: { fontSize: '11px', textAlign: 'center', marginTop: '8px' }, text: 'カード画像は取得後のお楽しみ' }));
  }
  hero.append(wrap);

  const meta = el('div', { class: 'detail__meta' });
  meta.append(el('span', { class: 'detail__cat', text: CATEGORY_LABEL[c.category] || '' }));
  meta.append(el('h2', { class: 'detail__name', text: c.name }));
  if (c.subCategory) meta.append(el('p', { class: 'detail__sub', text: c.subCategory }));

  const acts = el('div', { class: 'detail__acts' });
  if (owned) {
    acts.append(el('button', {
      class: 'btn', attrs: { type: 'button' }, text: 'カードを見る',
      on: { click: () => openViewer(c.id) },
    }));
  }
  acts.append(favButton(c));
  meta.append(acts);
  hero.append(meta);
  view.append(hero);

  const body = el('div', { class: 'detail', style: { marginTop: '12px' } });

  // 説明文はカードの中に印刷されている。大きく出しているので、ここでは繰り返さない。

  const rows = [];
  if (c.season) rows.push(['旬・時期', c.season]);
  if (c.highlight) rows.push(['見どころ', c.highlight]);
  if (rows.length) {
    const dl = el('div', { class: 'deflist' });
    for (const [k, v] of rows) {
      dl.append(el('div', { class: 'deflist__row' }, [
        el('div', { class: 'deflist__k', text: k }),
        el('div', { text: v }),
      ]));
    }
    body.append(dl);
  }

  if (c.detailPhotos.length) {
    body.append(el('h3', { text: '写真' }));
    const ph = el('div', { class: 'photos' });
    for (const p of c.detailPhotos) {
      ph.append(el('img', { attrs: { src: resolvePhoto(p), alt: c.name, loading: 'lazy', decoding: 'async' } }));
    }
    body.append(ph);
  }

  if (c.purchase.enabled) {
    body.append(el('p', { class: 'note', style: { marginTop: '0' }, text: '※季節や入荷状況などにより、取り扱いがない場合があります。' }));
  }
  if (c.gps.enabled) body.append(spotSection(c));
  if (c.externalLinks.length) {
    body.append(el('h3', { text: 'もっと知る' }));
    const lk = el('div', { class: 'linklist' });
    for (const l of c.externalLinks) {
      const a = externalLink(l.label || '公式ページ', l.url);
      if (a) lk.append(a);
    }
    body.append(lk);
  }

  view.append(body);
}

function renderLocked(view, c) {
  const box = el('div', { class: 'panel', style: { textAlign: 'center' } });
  const w = el('div', { style: { width: '62%', margin: '0 auto 14px' } });
  w.append(lockedCard(c));
  box.append(w);
  box.append(el('h2', { style: { fontSize: '16px', margin: '0 0 4px' }, text: '???' }));
  box.append(el('p', { class: 'muted', style: { margin: '0 0 14px' }, text: `${CATEGORY_LABEL[c.category] || ''}のカード` }));
  box.append(el('a', { class: 'btn btn--primary btn--block', text: 'ガチャを引く', attrs: { href: '#/gacha' } }));
  view.append(box);
}

function favButton(c) {
  const on = app.state.favorites.includes(c.id);
  const btn = el('button', {
    class: `fav${on ? ' is-on' : ''}`, attrs: { type: 'button' },
    text: on ? '♥ 気になる' : '♡ 気になる',
  });
  btn.addEventListener('click', () => {
    commit((s) => {
      const i = s.favorites.indexOf(c.id);
      if (i >= 0) s.favorites.splice(i, 1);
      else s.favorites.push(c.id);
    });
    const nowOn = app.state.favorites.includes(c.id);
    btn.classList.toggle('is-on', nowOn);
    btn.textContent = nowOn ? '♥ 気になる' : '♡ 気になる';
    toast(nowOn ? '「気になる」に入れました' : '「気になる」から外しました');
  });
  return btn;
}

/* ===== 前後のカードへ（左右に払う） ===== */

/** カードの左右に、前後のカードを控えさせる。
    払っているあいだ、指について動いて隣が見える。 */
function track(c, face) {
  const t = el('div', { class: 'cardtrack' });
  const list = ordered();
  const at = list.findIndex((x) => x.id === c.id);
  const side = (card, where) => {
    const w = el('div', { class: `cardtrack__side cardtrack__side--${where}` });
    // 隣はちらりと見えるだけなので、小さい写真で十分
    w.append(isOwned(card.id) ? cardFace(card, { small: true }) : lockedCard(card, { small: true }));
    return w;
  };
  if (at >= 0 && list.length > 1) {
    const prev = list[(at - 1 + list.length) % list.length];
    const next = list[(at + 1) % list.length];
    t.append(side(prev, 'prev'), side(next, 'next'));
  }
  t.append(el('div', { class: 'cardtrack__now' }, [face]));
  return t;
}

/** カード一覧と同じ並び（ジャンル順 → 番号順） */
function ordered() {
  const rank = Object.fromEntries(CATEGORIES.map((x, i) => [x.key, i]));
  return publishedCards().slice()
    .sort((a, b) => (rank[a.category] - rank[b.category]) || a.id.localeCompare(b.id, 'ja'));
}

/** 直前に払ったかどうか。払ったときの指離しでカードを開いてしまわないようにする。 */
let swipedAt = 0;
export function justSwiped() { return Date.now() - swipedAt < 400; }

/* 受け付けは #view に1回だけ付ける。
   カード詳細を開くたびに付けると、開いた回数ぶん重なって何枚も飛んでしまう。
   いま見ているカードは、そのつどアドレスから読む。 */
let swipeReady = false;
function attachSwipe(view) {
  if (swipeReady) return;
  swipeReady = true;
  let start = null;
  /* 画面の左右の端は受け付けない。
     端からの横払いは、スマホ本来の「戻る」操作に使われているため。 */
  const EDGE = 32;

  const nowId = () => {
    const m = /^#\/card\/([^?]+)/.exec(location.hash || '');
    return m ? decodeURIComponent(m[1]) : '';
  };
  const nowTrack = () => view.querySelector('.cardtrack');

  const settle = (t, x, ms) => {
    if (!t) return;
    t.classList.add('is-easing');
    t.style.transform = x ? `translateX(${x}px)` : '';
    setTimeout(() => {
      if (!t.isConnected) return;
      t.classList.remove('is-easing', 'is-sliding');
      if (!x) t.style.transform = '';
    }, ms);
  };

  view.addEventListener('pointerdown', (e) => {
    start = null;
    if (!nowId()) return;                                 // カード詳細のときだけ
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.clientX < EDGE || e.clientX > window.innerWidth - EDGE) return;
    start = { x: e.clientX, y: e.clientY, on: false };
  });
  view.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!start.on) {
      if (Math.abs(dx) < 12) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.2) { start = null; return; }   // 縦に動かしている
      start.on = true;
      const t = nowTrack();
      if (t) t.classList.add('is-sliding');
    }
    const t = nowTrack();
    if (t) t.style.transform = `translateX(${dx}px)`;
  });
  view.addEventListener('pointerup', (e) => {
    const s0 = start;
    start = null;
    const id = nowId();
    const t = nowTrack();
    if (!s0 || !id) return;
    const dx = e.clientX - s0.x;
    const dy = e.clientY - s0.y;
    /* 横に大きく、縦にはあまり動いていないときだけ「払った」とみなす。
       速さは見ない。ゆっくり横へ動かしても、意図した操作として受け付ける。 */
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) { settle(t, 0, 260); return; }
    const list = ordered();
    const at = list.findIndex((x) => x.id === id);
    if (at < 0 || list.length < 2) { settle(t, 0, 260); return; }
    swipedAt = Date.now();
    const n = (at + (dx < 0 ? 1 : -1) + list.length) % list.length;   // 端まで来たら反対側へ
    vibrate(8);
    // 隣が中央に来るところまで送ってから、その画面に切り替える
    const span = (t ? t.getBoundingClientRect().width : window.innerWidth) + 14;
    settle(t, dx < 0 ? -span : span, 220);
    setTimeout(() => go(`#/card/${list[n].id}`), 190);
  });
  view.addEventListener('pointercancel', () => {
    if (start && start.on) settle(nowTrack(), 0, 200);
    start = null;
  });
}

/** はじめてカード詳細を開いたときだけ、左右に払えることを知らせる */
function maybeHintSwipe() {
  if (app.state.flags.swipeHintShown) return;
  commit((s) => { s.flags.swipeHintShown = true; });
  setTimeout(() => toast('左右に払うと、前後のカードに移ります'), 800);
}

/** カードに印刷されたボタンが指す先。地図や販売店の検索はここ1か所で決める。 */
export function cardActionUrl(c) {
  if (c.category === 'spot' && c.gps.lat != null) return mapsSearchUrl(`${c.gps.lat},${c.gps.lng}`);
  if (c.purchase.enabled) {
    const shop = c.purchase.shops.find((s) => safeUrl(s.url));
    if (shop) return safeUrl(shop.url);
    const word = c.purchase.searchWord || `${(app.config && app.config.townName) || '志賀町'} ${c.name}`;
    return mapsSearchUrl(word);
  }
  if (c.gps.lat != null) return mapsSearchUrl(`${c.gps.lat},${c.gps.lng}`);
  const first = c.externalLinks.find((l) => safeUrl(l.url));
  return first ? safeUrl(first.url) : '';
}

/** カードの絵に描かれたボタンの上に、透明なリンクを重ねる。
    絵は作り直さずに、押せる場所だけを足す。 */
function linkCardButton(face, c) {
  const btn = face.querySelector('.cardart__btn');
  if (!btn) return;                       // 文化カードのようにボタンが無い意匠
  const url = cardActionUrl(c);
  if (!url) return;
  btn.classList.add('is-live');
  btn.append(el('a', {
    class: 'cardart__hit',
    attrs: {
      href: url, target: '_blank', rel: 'noopener noreferrer',
      'aria-label': (btn.textContent || '').replace('→', '').trim(),
    },
  }));
}

/** 現地訪問（SHIKA COIN がもらえる行動）だけを残した欄。地図へ飛ぶのはカードのボタンが担う。
    1画面に収めたいので、見出しは付けず、状況と距離は1行にまとめる。 */
function spotSection(c) {
  const p = el('div', { class: 'panel panel--tight' });
  const visited = isVisited(c.id);

  p.append(el('div', { class: 'spotline' }, [
    el('span', {
      text: visited
        ? `✓ 訪問済み ／ 再訪 +${coinCfg().spotRevisit} COIN`
        : `未訪問 ／ 初回訪問 +${coinCfg().spotFirst} SHIKA COIN`,
    }),
    el('span', {
      class: 'muted',
      text: c.gps.lat == null ? '' : (hasFix() ? distanceText(c.gps.lat, c.gps.lng) : '現在地は未取得'),
    }),
  ]));
  /* 経路検索はカードに印刷されたボタンが受け持つので、ここには置かない。
     （まち巡りのスポット一覧には行ごとの「経路」がある） */
  p.append(el('button', {
    class: 'btn btn--primary btn--block', attrs: { type: 'button' }, text: 'チェックイン',
    on: { click: () => go('#/map?checkin=1') },
  }));
  return p;
}
