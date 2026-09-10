/* card-detail.js — カード詳細。カード画像と情報UIは分離して扱う。
   不確かな情報は補わない：Excelに入っている内容だけを表示する。 */

import { app, isOwned, isVisited, commit, CATEGORY_LABEL } from './state.js';
import {
  el, clear, cardFace, lockedCard, toast, externalLink, mapsSearchUrl, safeUrl, resolvePhoto,
} from './ui.js';
import { openViewer } from './card-3d.js';
import { coinCfg } from './rewards.js';
import { distanceText, hasFix } from './geo.js';
import { go } from './router.js';

export function renderCardDetail(view, params) {
  clear(view);
  const c = app.cardsById.get(String(params.id));
  if (!c) { view.append(el('p', { class: 'empty', text: 'カードが見つかりません。' })); return; }

  const owned = isOwned(c.id);
  const openSpot = !owned && c.gps.enabled;   // 未取得でも観光情報は見せるスポット
  if (!owned && !openSpot) return renderLocked(view, c);

  const hero = el('div', { class: 'detail__hero' });
  const wrap = el('div', { class: 'detail__cardwrap' });
  if (owned) {
    const face = cardFace(c);
    face.style.cursor = 'pointer';
    face.addEventListener('click', () => openViewer(c.id));
    wrap.append(face);
  } else {
    wrap.append(lockedCard(c));
    wrap.append(el('p', { class: 'muted', style: { fontSize: '10.5px', marginTop: '6px' }, text: 'カード画像は取得後のお楽しみ' }));
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

  const body = el('div', { class: 'detail', style: { marginTop: '18px' } });

  if (c.description) body.append(el('p', { text: c.description }));

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

  if (c.category === 'spot' || c.gps.lat != null) body.append(spotSection(c));
  if (c.purchase.enabled) body.append(purchaseSection(c));
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
  const w = el('div', { style: { width: '46%', margin: '0 auto 14px' } });
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

function spotSection(c) {
  const sec = el('div');
  sec.append(el('h3', { text: '場所' }));
  const p = el('div', { class: 'panel' });

  if (c.gps.lat != null) {
    const d = distanceText(c.gps.lat, c.gps.lng);
    p.append(el('div', {
      style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '10px' },
    }, [
      el('span', { text: '現在地からの目安' }),
      el('span', { class: 'muted', text: hasFix() ? d : '現在地は未取得' }),
    ]));
  }

  if (c.gps.enabled) {
    const visited = isVisited(c.id);
    p.append(el('div', {
      style: { fontSize: '13px', marginBottom: '10px' },
      text: visited
        ? `✓ 現地訪問済み ／ 再訪 +${coinCfg().spotRevisit} SHIKA COIN（1日1回）`
        : `現地訪問 未達成 ／ 初回訪問 +${coinCfg().spotFirst} SHIKA COIN`,
    }));
    p.append(el('button', {
      class: 'btn btn--primary btn--block', attrs: { type: 'button' }, text: '現在地を確認する',
      on: { click: () => go('#/map?checkin=1') },
    }));
  }

  if (c.gps.lat != null) {
    const url = mapsSearchUrl(`${c.gps.lat},${c.gps.lng}`);
    const a = externalLink('Google Maps で行く', url);
    if (a) { a.style.marginTop = '8px'; p.append(a); }
  }
  sec.append(p);
  return sec;
}

function purchaseSection(c) {
  const sec = el('div');
  sec.append(el('h3', { text: '買える場所' }));
  const p = el('div', { class: 'panel' });

  if (c.purchase.shops.length) {
    const lk = el('div', { class: 'linklist' });
    for (const s of c.purchase.shops) {
      const a = externalLink(s.name || '確認済みの販売店', s.url);
      if (a) lk.append(a);
    }
    p.append(lk);
  } else {
    const word = c.purchase.searchWord || `${(app.config && app.config.townName) || '志賀町'} ${c.name}`;
    const a = externalLink('買える場所を探す', mapsSearchUrl(word), 'btn btn--primary btn--block');
    if (a) p.append(a);
  }
  p.append(el('p', { class: 'note', text: '※季節や入荷状況などにより、取り扱いがない場合があります。' }));
  sec.append(p);
  return sec;
}
