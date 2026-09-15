/* admin.js — 管理者の確認用モード。
   公開前の点検のためだけのもので、利用者向けの機能ではない。
   個人情報も外部送信も増やさない（この端末の保存データを読み書きするだけ）。

   入り方: 「その他」画面のいちばん下にあるバージョン表示を7回続けてタップ。
   入ると、ガチャがコイン無しで引けるようになり、
   「カード点検」画面ですべてのカードの状態を一覧できる。 */

import { app, commit, isOwned, publishedCards, CATEGORY_LABEL, CATEGORIES } from './state.js';
import { el, clear, toast, dialog, confirm2 } from './ui.js';
import { go } from './router.js';
import { celebrateComplete } from './title-complete.js';
import { TITLE_MAX_CHARS } from './card-render.js';
import { gpsCards } from './state.js';

export function isAdmin() {
  return !!(app.state && app.state.flags && app.state.flags.admin);
}

export async function askTurnOn() {
  const ok = await dialog({
    title: '管理モードに入りますか',
    body: [
      '公開前の点検用です。利用者に配る前に切ってください。',
      'ガチャがコイン無しで引けるようになり、すべてのカードの状態を見られます。',
    ],
    actions: [{ label: 'やめる', value: false }, { label: '入る', value: true, primary: true }],
  });
  if (!ok) return;
  commit((s) => { s.flags.admin = true; });
  toast('管理モードに入りました');
  go('#/admin');
}

export function turnOff() {
  commit((s) => { s.flags.admin = false; });
  toast('管理モードを終了しました');
  go('#/more');
}

/** 「その他」画面のバージョン表示に、7回タップの仕掛けを付ける */
export function attachSecret(node) {
  let n = 0, last = 0;
  node.addEventListener('click', () => {
    const now = Date.now();
    n = now - last < 1200 ? n + 1 : 1;
    last = now;
    if (n >= 7) { n = 0; askTurnOn(); }
  });
}

/* ===== カード点検 ===== */

export function renderAdmin(view) {
  clear(view);
  if (!isAdmin()) {
    view.append(el('p', { class: 'empty', text: '管理モードではありません。' }));
    view.append(el('a', { class: 'btn btn--block', text: 'その他へ', attrs: { href: '#/more' } }));
    return;
  }

  const all = (app.cards || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id), 'ja'));
  const pub = publishedCards();

  view.append(el('p', {
    class: 'muted', style: { margin: '0 0 12px' },
    text: '公開前の確認用の画面です。配布前に管理モードを切ってください。',
  }));

  view.append(summary(all, pub));
  view.append(operations(pub));

  view.append(el('h3', { text: `カード一覧（${all.length}）` }));
  const table = el('div', { class: 'panel adminlist' });
  for (const c of all) table.append(row(c));
  view.append(table);
}

function summary(all, pub) {
  const nums = pub.map((c) => Number(c.id)).filter((n) => n > 0).sort((a, b) => a - b);
  const gaps = nums.length
    ? Array.from({ length: nums[nums.length - 1] }, (_, i) => i + 1).filter((n) => !nums.includes(n))
    : [];
  const longText = pub.filter((c) => [...(c.cardText || c.description || '')].length > 78);
  // 名前が長いと、そのカードだけ名前の文字が小さくなり、ほかのカードとそろわない
  const longName = pub.filter((c) => [...(c.name || '')].length > TITLE_MAX_CHARS);
  const noPhoto = pub.filter((c) => !c.photo);
  const noCat = all.filter((c) => !c.category);
  const unpub = all.filter((c) => !c.published);

  const rows = [
    ['カード数', `${all.length} 件（公開 ${pub.length} 件）`],
    ...CATEGORIES.map((k) => [k.label, `${pub.filter((c) => c.category === k.key).length} 件`]),
    ['番号', nums.length ? `${pad(nums[0])} 〜 ${pad(nums[nums.length - 1])}` : '—'],
    ['番号の欠番', gaps.length ? gaps.map(pad).join(' ') : 'なし'],
    ['写真なし', listOf(noPhoto)],
    ['ジャンル未設定', listOf(noCat)],
    ['非公開', listOf(unpub)],
    ['カードの文が長い', listOf(longText)],
    [`名前が${TITLE_MAX_CHARS}字を超える`, listOf(longName)],
    ['チェックイン対象', `${pub.filter((c) => c.gps.enabled).length} 件`],
    ['座標あり', `${pub.filter((c) => c.gps.lat != null).length} 件`],
    ['購入検索', `${pub.filter((c) => c.purchase.enabled).length} 件`],
    ['外部リンク', `${pub.filter((c) => c.externalLinks.length).length} 件`],
    ['取得済み', `${pub.filter((c) => isOwned(c.id)).length} / ${pub.length} 件`],
  ];

  const p = el('div', { class: 'panel' });
  const dl = el('div', { class: 'deflist deflist--wide' });
  for (const [k, v] of rows) {
    dl.append(el('div', { class: 'deflist__row' }, [
      el('div', { class: 'deflist__k', text: k }),
      el('div', { text: v }),
    ]));
  }
  p.append(dl);
  return p;
}

const pad = (n) => String(n).padStart(3, '0');
function listOf(list) {
  if (!list.length) return 'なし';
  return `${list.length} 件 ／ ${list.map((c) => c.id).join(' ')}`;
}

function operations(pub) {
  const p = el('div', { class: 'panel', style: { marginTop: '12px' } });
  p.append(el('p', {
    style: { margin: '0 0 10px', fontSize: '13px' },
    text: 'ガチャはコイン無しで引けます。この端末の保存データだけが変わります。',
  }));
  const g = el('div', { class: 'adminacts' });

  g.append(el('button', {
    class: 'btn', attrs: { type: 'button' }, text: '全カードを取得済みに',
    on: {
      click: () => {
        commit((s) => { s.ownedCardIds = pub.map((c) => c.id); s.unseenCardIds = []; });
        toast(`${pub.length} 枚を取得済みにしました`);
        go('#/collection');
      },
    },
  }));

  g.append(el('button', {
    class: 'btn', attrs: { type: 'button' }, text: '取得をすべて取り消す',
    on: {
      click: async () => {
        if (!await confirm2('取得したカードを空にしますか', ['この端末の記録だけが消えます。'], '空にする')) return;
        commit((s) => { s.ownedCardIds = []; s.unseenCardIds = []; });
        toast('取得を取り消しました');
        go('#/admin');
      },
    },
  }));

  g.append(el('button', {
    class: 'btn', attrs: { type: 'button' }, text: 'SHIKA COIN を 999 に',
    on: {
      click: () => { commit((s) => { s.coins = 999; }); toast('SHIKA COIN を 999 にしました'); go('#/admin'); },
    },
  }));

  g.append(el('button', {
    class: 'btn', attrs: { type: 'button' }, text: 'はまる演出をもう一度',
    on: {
      click: () => {
        const owned = app.state.ownedCardIds.slice(0, 10);
        if (!owned.length) { toast('先にカードを取得してください'); return; }
        commit((s) => { s.unseenCardIds = owned; });
        go('#/collection');
      },
    },
  }));

  // 称号「志賀町コンプリート」の確認用
  g.append(el('button', {
    class: 'btn', attrs: { type: 'button' }, text: 'コンプリート演出を見る',
    on: {
      // 保存データは変えずに、演出だけを流す（終わると元の表示に戻る）
      click: () => celebrateComplete({ preview: true }),
    },
  }));
  g.append(el('button', {
    class: 'btn', attrs: { type: 'button' }, text: 'コンプリート状態にする',
    on: {
      click: async () => {
        if (!await confirm2('コンプリート状態にしますか', [
          '全カードを取得済みにし、すべてのスポットを訪問済みにします。',
          'このあと「志賀町コンプリート」の獲得演出が本番と同じ流れで出ます。',
        ], 'コンプリートにする')) return;
        const now = new Date().toISOString();
        const today = now.slice(0, 10);
        commit((s) => {
          s.ownedCardIds = pub.map((c) => c.id);
          s.unseenCardIds = [];
          for (const c of gpsCards()) {
            s.visits[c.id] = { firstVisitedAt: (s.visits[c.id] && s.visits[c.id].firstVisitedAt) || now, lastVisitDate: today };
          }
          s.flags.completeCelebrated = false;
        });
        toast('コンプリート状態にしました');
        go('#/home');   // 画面が変わったところで、本番と同じ判定で演出が出る
      },
    },
  }));

  p.append(g);
  p.append(el('button', {
    class: 'btn btn--block', attrs: { type: 'button' }, text: '管理モードを終了する',
    style: { marginTop: '10px' },
    on: { click: turnOff },
  }));
  return p;
}

function row(c) {
  const owned = isOwned(c.id);
  const r = el('div', { class: 'adminrow' });
  r.append(el('b', { class: 'adminrow__no', text: `#${c.id}` }));

  const body = el('div', { class: 'adminrow__b' });
  body.append(el('div', { class: 'adminrow__n', text: c.name || '(名前なし)' }));

  const tags = el('div', { class: 'adminrow__t' });
  const add = (text, kind) => tags.append(el('span', { class: `atag atag--${kind}`, text }));
  add(CATEGORY_LABEL[c.category] || 'ジャンル未設定', c.category ? 'ok' : 'ng');
  add(c.published ? '公開' : '非公開', c.published ? 'ok' : 'ng');
  add(c.photo ? '写真' : '写真なし', c.photo ? 'ok' : 'ng');
  const len = [...(c.cardText || c.description || '')].length;
  add(`文 ${len}字`, len > 78 ? 'warn' : 'ok');
  const nameLen = [...(c.name || '')].length;
  add(`名前 ${nameLen}字`, nameLen > TITLE_MAX_CHARS ? 'warn' : 'ok');
  if (c.gps.lat != null) add('座標', 'ok');
  if (c.gps.enabled) add('チェックイン', 'ok');
  if (c.purchase.enabled) add('購入検索', 'ok');
  if (c.externalLinks.length) add('リンク', 'ok');
  add(owned ? '取得済み' : '未取得', owned ? 'ok' : 'warn');
  body.append(tags);
  r.append(body);

  r.addEventListener('click', () => go(`#/card/${c.id}`));
  return r;
}
