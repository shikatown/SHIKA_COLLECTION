/* map.js — まち巡り画面と地図。
   地図は OpenStreetMap の標準タイルをそのまま表示する簡易スリッピーマップ。
   利用条件により、画面のすみに出典（© OpenStreetMap contributors）を必ず出す。
   経路・所要時間・ナビは Google Maps へ外部リンクで渡す。 */

import { app, isVisited, isOwned, gpsCards, mapCards, commit } from './state.js';
import { el, clear, toast, dialog, confirm2, externalLink, mapsSearchUrl, mapsRouteUrl, cardFace, vibrate, pinIcon, checkIcon } from './ui.js';
import * as geo from './geo.js';
import { coinCfg } from './rewards.js';
import { sfx, unlock } from './sound.js';
import { go } from './router.js';
import { openViewer } from './card-3d.js';
import { maybeCelebrateComplete } from './title-complete.js';
import { showGuide } from './guide.js';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = 'OpenStreetMap contributors';
const TILE_ATTR_URL = 'https://www.openstreetmap.org/copyright';
const MIN_Z = 8, MAX_Z = 18;

/* ===== 投影 ===== */
function project(lat, lng, z) {
  const s = 256 * Math.pow(2, z);
  const x = ((lng + 180) / 360) * s;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
  return { x, y };
}
function unproject(x, y, z) {
  const s = 256 * Math.pow(2, z);
  const lng = (x / s) * 360 - 180;
  const n = Math.PI - 2 * Math.PI * (y / s);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

/* ===== 地図 ===== */
export function createMap(container, { center, zoom }) {
  let z = Math.min(MAX_Z, Math.max(MIN_Z, zoom));
  let c = project(center.lat, center.lng, z);
  const tilesLayer = el('div', { class: 'map__tiles' });
  const markerLayer = el('div', { class: 'map__tiles' });
  container.append(tilesLayer, markerLayer);
  container.append(el('div', { class: 'map__attr' }, [
    el('span', { text: '地図：© ' }),
    el('a', { text: TILE_ATTR, attrs: { href: TILE_ATTR_URL, target: '_blank', rel: 'noopener noreferrer' } }),
  ]));

  const zoomBox = el('div', { class: 'map__zoom' });
  const zin = el('button', { attrs: { type: 'button', 'aria-label': '拡大' }, text: '+' });
  const zout = el('button', { attrs: { type: 'button', 'aria-label': '縮小' }, text: '−' });
  zoomBox.append(zin, zout);
  container.append(zoomBox);

  let markers = [];
  let me = null;
  let raf = 0;

  function size() { return { w: container.clientWidth, h: container.clientHeight }; }

  function draw() {
    const { w, h } = size();
    const left = c.x - w / 2, top = c.y - h / 2;
    const n = Math.pow(2, z);
    const x0 = Math.floor(left / 256), x1 = Math.floor((left + w) / 256);
    const y0 = Math.floor(top / 256), y1 = Math.floor((top + h) / 256);
    const keep = new Set();

    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n;
        const key = `${z}/${wx}/${ty}`;
        keep.add(key + `@${tx}`);
        let img = tilesLayer.querySelector(`[data-k="${key}@${tx}"]`);
        if (!img) {
          img = el('img', {
            class: 'map__tile',
            attrs: {
              'data-k': `${key}@${tx}`, alt: '', loading: 'eager', decoding: 'async',
              src: TILE_URL.replace('{z}', z).replace('{x}', wx).replace('{y}', ty),
            },
          });
          img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
          tilesLayer.append(img);
        }
        img.style.transform = `translate(${tx * 256 - left}px, ${ty * 256 - top}px)`;
      }
    }
    for (const img of Array.from(tilesLayer.children)) {
      if (!keep.has(img.dataset.k)) img.remove();
    }
    placeMarkers(left, top);
  }

  function placeMarkers(left, top) {
    for (const m of markers) {
      const p = project(m.lat, m.lng, z);
      m.node.style.left = `${p.x - left}px`;
      m.node.style.top = `${p.y - top}px`;
    }
    if (me) {
      const p = project(me.lat, me.lng, z);
      me.node.style.left = `${p.x - left}px`;
      me.node.style.top = `${p.y - top}px`;
    }
  }

  // 描画はフレームにまとめるが、フレームが来ない環境でも必ず描けるよう保険を置く
  let guard = 0;
  function schedule() {
    cancelAnimationFrame(raf);
    clearTimeout(guard);
    raf = requestAnimationFrame(() => { clearTimeout(guard); draw(); });
    guard = setTimeout(() => { cancelAnimationFrame(raf); draw(); }, 120);
  }

  /* 操作：1本指で動かす／2本指でつまんで拡大・縮小。
     タイルは整数のズームでしか無いので、つまんでいるあいだは見た目だけを拡大し、
     指を離したところで近いズームに寄せて描き直す。 */
  const pts = new Map();          // いま触れている指
  let drag = null;
  let pinch = null;

  const local = (e) => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const midOf = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distOf = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const clampZ = (v) => Math.min(MAX_Z, Math.max(MIN_Z, v));

  /** 画面のある点が指している緯度経度 */
  function pointToLatLng(pt) {
    const { w, h } = size();
    return unproject(c.x - w / 2 + pt.x, c.y - h / 2 + pt.y, z);
  }
  /** ある緯度経度を、画面のある点に合わせる */
  function anchorAt(ll, pt, nz) {
    const { w, h } = size();
    z = nz;
    const p = project(ll.lat, ll.lng, nz);
    c = { x: p.x - (pt.x - w / 2), y: p.y - (pt.y - h / 2) };
    tilesLayer.replaceChildren();
    schedule();
  }

  function startPinch() {
    const [a, b] = [...pts.values()];
    const m = midOf(a, b);
    pinch = { d0: distOf(a, b), m0: m, m, s: 1, ll: pointToLatLng(m), z0: z };
    drag = null;
    tilesLayer.style.transformOrigin = `${m.x}px ${m.y}px`;
    markerLayer.style.transformOrigin = `${m.x}px ${m.y}px`;
  }
  function movePinch() {
    const [a, b] = [...pts.values()];
    pinch.m = midOf(a, b);
    pinch.s = distOf(a, b) / pinch.d0;
    const t = `translate(${pinch.m.x - pinch.m0.x}px, ${pinch.m.y - pinch.m0.y}px) scale(${pinch.s})`;
    tilesLayer.style.transform = t;
    markerLayer.style.transform = t;
  }
  function endPinch() {
    const { s, m, ll, z0 } = pinch;
    pinch = null;
    tilesLayer.style.transform = '';
    markerLayer.style.transform = '';
    anchorAt(ll, m, clampZ(Math.round(z0 + Math.log2(s))));
  }

  container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.map__zoom') || e.target.closest('.map__pin')) return;
    try { container.setPointerCapture(e.pointerId); } catch (_) { /* 取れない端末でも指の追跡は続ける */ }
    pts.set(e.pointerId, local(e));
    if (pts.size >= 2) startPinch();
    else drag = local(e);
  });
  container.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, local(e));
    if (pinch) { movePinch(); return; }
    if (!drag) return;
    const p = local(e);
    c = { x: c.x - (p.x - drag.x), y: c.y - (p.y - drag.y) };
    drag = p;
    schedule();
  });
  const endPointer = (e) => {
    pts.delete(e.pointerId);
    if (pinch && pts.size < 2) endPinch();
    // 片方だけ離したら、残った指でそのまま動かせるようにする
    drag = pts.size === 1 ? { ...[...pts.values()][0] } : null;
  };
  container.addEventListener('pointerup', endPointer);
  container.addEventListener('pointercancel', endPointer);

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    // 指やカーソルの下の場所を動かさずに拡大縮小する
    setZoom(z + (e.deltaY < 0 ? 1 : -1), local(e));
  }, { passive: false });

  function setZoom(nz, at) {
    nz = clampZ(nz);
    if (nz === z) return;
    const { w, h } = size();
    const pt = at || { x: w / 2, y: h / 2 };
    anchorAt(pointToLatLng(pt), pt, nz);
  }
  zin.addEventListener('click', () => setZoom(z + 1));
  zout.addEventListener('click', () => setZoom(z - 1));

  const api = {
    setCenter(lat, lng, nz) {
      if (nz) z = Math.min(MAX_Z, Math.max(MIN_Z, nz));
      c = project(lat, lng, z);
      tilesLayer.replaceChildren();
      schedule();
    },
    addMarker(lat, lng, { color = '#2f6f8f', label = '', onClick = null, star = false } = {}) {
      const node = el('div', { class: `map__pin${star ? ' map__pin--star' : ''}`, attrs: { title: label } });
      /* 訪問した場所は、ピンの代わりに金の星を立てる（固定の図形なので innerHTML で差し込む） */
      node.innerHTML = star
        ? '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.6l3.9 8.3 9.1 1.1-6.7 6.2 1.8 9L16 22.7l-8.1 4.5 1.8-9L3 12l9.1-1.1z" fill="#f2b632" stroke="#8a5a00" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 6.8l2.5 5.3 5.4.7" fill="none" stroke="#fff3c4" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/></svg>'
        : `<svg viewBox="0 0 26 32" aria-hidden="true"><path d="M13 31C13 31 24 19.5 24 12A11 11 0 1 0 2 12c0 7.5 11 19 11 19z" fill="${color}" stroke="#fff" stroke-width="1.6"/><circle cx="13" cy="12" r="4" fill="#fff"/></svg>`;
      if (onClick) node.addEventListener('click', onClick);
      markerLayer.append(node);
      markers.push({ lat, lng, node });
      schedule();
      return node;
    },
    setMe(lat, lng) {
      if (!me) { me = { node: el('div', { class: 'map__me' }) }; markerLayer.append(me.node); }
      me.lat = lat; me.lng = lng;
      schedule();
    },
    redraw: schedule,
    destroy() { cancelAnimationFrame(raf); clearTimeout(guard); markers = []; me = null; },
  };
  draw();
  window.addEventListener('resize', schedule);
  return api;
}

/* ===== まち巡り画面 ===== */

let mapApi = null;

export function renderMap(view, params) {
  clear(view);
  if (mapApi) { mapApi.destroy(); mapApi = null; }

  // 見出しはアプリバーに出ているので、ここでは繰り返さない（訪問数のバーは v1.40.1 で外した）
  const head = el('div', { style: { marginBottom: '12px' } });
  head.append(el('p', { class: 'muted', style: { margin: 0 }, text: '石川県志賀町' }));
  view.append(head);

  const box = el('div', { class: 'mapwrap' });
  view.append(box);

  const cfg = app.config || {};
  mapApi = createMap(box, { center: cfg.mapCenter || { lat: 37.1057, lng: 136.7376 }, zoom: cfg.mapZoom || 11 });
  for (const c of mapCards()) {
    const visited = isVisited(c.id);
    const target = c.gps.enabled;
    mapApi.addMarker(c.gps.lat, c.gps.lng, {
      color: target ? '#2f6f8f' : '#a29a8c',
      star: visited,
      label: c.name,
      onClick: () => go(`#/card/${c.id}`),
    });
  }
  const me = geo.myPosition();
  if (me) mapApi.setMe(me.lat, me.lng);

  const status = el('p', { class: 'muted center', style: { marginTop: '10px' } });
  status.textContent = geo.hasFix()
    ? `現在地: ${geo.fixAgeMinutes()}分前に確認`
    : '現在地は取得していません';
  view.append(status);

  const btn = el('button', {
    class: 'btn btn--primary btn--block btn--lg', attrs: { type: 'button' },
    text: '近くのスポットを探す',
    style: { marginTop: '4px' },
    on: { click: () => runCheckIn(view, status, btn) },
  });
  view.append(btn);

  /* スポットの一覧は、あとから作り直せるように囲んでおく。
     チェックインで現在地が分かると、近い順に並べ替えるため。 */
  const lists = el('div', { class: 'spotlists' });
  view.append(lists);
  fillSpotLists(lists);

  if (params && params.checkin) setTimeout(() => runCheckIn(view, status, btn), 60);

  // 初めて開いたときだけの案内（お知らせやチェックインの結果が出ていれば、閉じてから出る）
  showGuide('mapGuideShown', {
    icon: 'pin',
    title: 'まち巡りのあそびかた',
    lines: [
      '地図のピンが、チェックインできるスポットです。',
      'スポットの近くで「近くのスポットを探す」を押すと、チェックインして SHIKA COIN がもらえます。',
      '行った場所は、金の星に変わります。',
    ],
  });
}

/** スポットの一覧を作り直す。現在地が分かっていれば近い順に並ぶ。 */
function fillSpotLists(lists) {
  clear(lists);
  lists.append(listSection('未訪問', gpsCards().filter((c) => !isVisited(c.id))));
  lists.append(listSection('訪問済み', gpsCards().filter((c) => isVisited(c.id))));

  const other = mapCards().filter((c) => !c.gps.enabled);
  if (other.length) {
    lists.append(el('h3', { text: '地図に載っている場所（チェックイン対象外）' }));
    const p = el('div', { class: 'panel' });
    for (const c of other) p.append(spotRow(c, false));
    lists.append(p);
  }
}

/** いま出ているスポットの一覧を作り直す。 */
function refreshSpotLists(view) {
  const lists = view.querySelector('.spotlists');
  if (lists) fillSpotLists(lists);
}

function listSection(title, list) {
  const sec = el('div');
  sec.append(el('h3', { text: `${title}（${list.length}）` }));
  const p = el('div', { class: 'panel' });
  if (!list.length) p.append(el('p', { class: 'muted', style: { margin: 0 }, text: '—' }));
  const withDist = list.map((c) => ({ c, d: geo.distanceFromMe(c.gps.lat, c.gps.lng) }));
  if (geo.hasFix()) withDist.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
  withDist.forEach(({ c, d }, i) => {
    p.append(spotRow(c, isVisited(c.id), d, geo.hasFix() && title === '未訪問' && i < 3));
  });
  sec.append(p);
  return sec;
}

function spotRow(c, visited, dist = null, highlight = false) {
  const row = el('div', { class: 'spotrow' });
  /* 目印は、まだならタブと同じピン、行ったならミッション達成と同じ「✓」。
     近い順の上位は、ピンを少し目立たせる。 */
  const mark = el('div', {
    class: `spotrow__i${visited ? ' spotrow__i--done' : ''}${!visited && highlight ? ' spotrow__i--near' : ''}`,
  });
  mark.append(visited ? checkIcon() : pinIcon());
  row.append(mark);
  const t = el('div', { class: 'spotrow__t' });
  t.append(el('div', { class: 'spotrow__n', text: c.name }));
  const sub = [];
  if (dist != null) sub.push(`${geo.formatDistance(dist)}（直線・目安）`);
  if (!c.gps.enabled) sub.push('チェックイン対象外');
  t.append(el('div', { class: 'spotrow__d', text: sub.join(' / ') }));
  row.append(t);
  if (c.gps.lat != null) {
    const a = externalLink('経路', mapsRouteUrl(c.gps.lat, c.gps.lng), 'spotrow__go');
    if (a) {
      a.title = '経路検索（Googleマップ）';
      a.addEventListener('click', (e) => e.stopPropagation());   // 行のタップに吸われないように
      row.append(a);
    }
  }
  row.addEventListener('click', () => go(`#/card/${c.id}`));
  return row;
}

/* ===== チェックイン ===== */

/**
 * 現在地を確認できなかったときの案内。理由ごとに、利用者がすることを分けて伝える。
 * 以前はどの理由でも「屋外で再度お試しください」だったので、許可していない人は何度試しても直らなかった。
 * @returns {Promise<boolean>} 「もう一度試す」を押したら true
 */
async function geoFailDialog(kind) {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const closeOnly = [{ label: '閉じる', value: false, primary: true }];
  const withRetry = [{ label: '閉じる', value: false }, { label: 'もう一度試す', value: true, primary: true }];
  const steps = (lines) => {
    const ol = el('ol', { class: 'geofail__steps' });
    for (const t of lines) ol.append(el('li', { text: t }));
    return ol;
  };

  let title;
  let body;
  let actions = withRetry;
  if (kind === 'unsupported') {
    title = '現在地を使えません';
    body = ['この端末・ブラウザでは位置情報を取得できません。'];
    actions = closeOnly;
  } else if (kind === 'denied') {
    title = '位置情報が許可されていません';
    if (!window.isSecureContext) {
      body = ['安全な接続（https）で開いていないため、位置情報を使えません。https:// から始まるアドレスで開き直してください。'];
    } else if (isIOS) {
      body = [
        'このサイトに位置情報の利用が許可されていないため、現在地を確認できません。',
        steps([
          '「設定」アプリを開く',
          '「プライバシーとセキュリティ」→「位置情報サービス」をオンにする',
          '同じ画面の「Safari の Web サイト」を「使用中」または「確認」にする',
        ]),
        '変更したら、この画面に戻って「近くのスポットを探す」をもう一度押してください。',
      ];
    } else if (isAndroid) {
      body = [
        'このサイトに位置情報の利用が許可されていないため、現在地を確認できません。',
        steps([
          'アドレスバーの左にあるアイコンをタップ',
          '「権限」または「サイトの設定」→「位置情報」を「許可」にする',
          '端末の位置情報がオフなら、画面上から下へスワイプしてオンにする',
        ]),
        '変更したら、ページを開き直して「近くのスポットを探す」をもう一度押してください。',
      ];
    } else {
      body = [
        'このサイトに位置情報の利用が許可されていないため、現在地を確認できません。',
        'ブラウザのサイト設定で、このサイトの位置情報を「許可」に変更してから、もう一度お試しください。',
      ];
    }
    actions = closeOnly;   // 設定を変えるまでは、何度試しても同じ結果になる
  } else if (kind === 'unavailable') {
    title = '現在地が見つかりませんでした';
    body = [
      '端末の位置情報（GPS）がオフになっていないか確認してください。',
      '建物の中や地下では見つからないことがあります。',
    ];
  } else if (kind === 'inaccurate') {
    const acc = geo.currentAccuracy();
    title = '現在地の精度が足りませんでした';
    body = [
      acc != null
        ? `いまの精度は約 ${acc} m です。チェックインには約 ${geo.accuracyLimit()} m 以内の精度が必要です。`
        : `チェックインには約 ${geo.accuracyLimit()} m 以内の精度が必要です。`,
      '屋外など、空が見える場所へ移動してから、もう一度お試しください。',
    ];
  } else {
    // 時間切れと、理由の分からない失敗
    title = '時間内に現在地を確認できませんでした';
    body = [
      '電波の状況によって、時間がかかることがあります。',
      '少し待ってから、もう一度お試しください。',
    ];
  }
  return !!(await dialog({ title, body, actions }));
}

async function runCheckIn(view, status, btn) {
  unlock();
  if (!geo.supported()) {
    await geoFailDialog('unsupported');
    return;
  }
  if (!app.state.flags.spotHintShown) {
    const ok = await dialog({
      title: '現在地の確認について',
      body: [
        '現地チェックインの判定に現在地を使用します。',
        '位置情報は保存・送信しません。判定した結果（訪問済み）だけを端末内に残します。',
      ],
      actions: [{ label: 'やめる', value: false }, { label: '探す', value: true, primary: true }],
    });
    if (!ok) return;
    commit((s) => { s.flags.spotHintShown = true; });
  }

  btn.disabled = true;
  const orig = btn.textContent;
  try {
    await geo.acquire((msg) => { status.textContent = msg; btn.textContent = '探しています…'; });
  } catch (e) {
    btn.disabled = false; btn.textContent = orig;
    const kind = geo.errorKind(e);
    if (kind === 'busy') return;   // すでに探している最中
    status.textContent = '現在地は取得していません';
    sfx.error();
    const retry = await geoFailDialog(kind);
    if (retry && btn.isConnected) return runCheckIn(view, status, btn);
    return;
  }

  btn.disabled = false;
  btn.textContent = '近くのスポットを探す';

  if (!geo.accuracyOK()) {
    status.textContent = '現在地は取得していません';
    sfx.error();
    const retry = await geoFailDialog('inaccurate');
    if (!btn.isConnected) return;   // 案内を見ているあいだに別の画面へ移った
    refreshSpotLists(view);
    if (retry) return runCheckIn(view, status, btn);
    return;
  }

  const me = geo.myPosition();
  if (mapApi && me) { mapApi.setMe(me.lat, me.lng); mapApi.setCenter(me.lat, me.lng, 14); }
  status.textContent = '現在地: たった今 確認';

  const res = geo.checkIn();
  if (res.saveFailed) return;   // 保存できなかった。チェックインの成功は知らせない
  if (res.out) {
    sfx.error();
    await dialog({
      title: 'チェックイン範囲外です',
      body: ['まだスポットのチェックイン範囲外です。', 'もう少しスポットに近づいてから、再度お試しください。'],
      actions: [{ label: '閉じる', value: null, primary: true }],
    });
    showNearest(view, res.nearest);
    refreshSpotLists(view);   // 現在地が分かったので、近い順に並べ直す
    return;
  }

  sfx.checkin();
  vibrate([20, 50, 30]);
  await showCheckinResult(res);
  renderMap(view, null);
  // 最後のスポットでそろったら、称号「志賀町コンプリート」の獲得演出へ
  maybeCelebrateComplete();
}

function showCheckinResult(res) {
  const body = [];
  for (const ci of res.checkins) {
    if (ci.town) { body.push(makeLine(`志賀町 初訪問 +${ci.coins}`)); continue; }
    if (ci.event) { body.push(makeLine(`${ci.name || 'イベント会場'} +${ci.coins}`)); continue; }
    const wrap = el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', margin: '0 0 10px' } });
    const w = el('div', { style: { width: '58px', flex: 'none' } });
    w.append(cardFace(ci.card, { small: true }));
    wrap.append(w);
    const t = el('div');
    t.append(el('div', {
      style: { fontSize: '11px', letterSpacing: '.14em', color: ci.newCard ? '#b3402f' : '#4a7a4a', fontWeight: '800' },
      text: ci.newCard ? 'SPOT DISCOVERED' : 'VISITED!',
    }));
    t.append(el('div', { style: { fontSize: '14px', fontWeight: '700' }, text: ci.card.name }));
    t.append(el('div', { style: { fontSize: '12px', color: '#8d867c' }, text: ci.first ? '現地訪問' : '再訪' }));
    wrap.append(t);
    body.push(wrap);
  }
  body.push(el('div', {
    style: { textAlign: 'right', fontWeight: '800', color: '#b8862b', borderTop: '1px dashed #e2ceaa', paddingTop: '8px' },
    text: `+${res.coins} SHIKA COIN`,
  }));

  if (res.nearest.length) {
    body.push(el('div', { style: { fontSize: '12px', color: '#8d867c', marginTop: '10px' }, text: 'この近くの未訪問スポット' }));
    for (const n of res.nearest) {
      body.push(el('div', { style: { fontSize: '12.5px' }, text: `・${n.card.name}（${geo.formatDistance(n.distance)}）` }));
    }
  }

  return dialog({
    title: 'チェックインしました',
    body,
    actions: [{ label: '閉じる', value: null, primary: true }],
  });
}

function makeLine(text) {
  return el('div', { style: { fontSize: '13.5px', margin: '0 0 6px' }, text });
}

function showNearest(view, nearest) {
  if (!nearest.length) return;
  toast(`近い未訪問: ${nearest[0].card.name}（${geo.formatDistance(nearest[0].distance)}）`, 3200);
}
