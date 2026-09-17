/* titles.js — 称号。ホームとミッション画面の両方で使う。
   ・いまの称号の状況（獲得したか・あといくつか）を1か所で数える
   ・称号を押すと、獲得条件・あといくつで獲得か・ガチャ／マップへの案内・SNSでシェアを出す
   称号の種類：グルメマスター／スポットマスター／文化マスター（そのジャンルのカードをすべて）、
             志賀町ファンクラブ（LINE の志賀町ファンクラブに登録。js/fanclub.js）、
             志賀町マスター（すべてのカード）、志賀町コンプリート（すべてのカード＋すべてのスポットでチェックイン） */

import { app, CATEGORIES } from './state.js';
import { el, dialog } from './ui.js';
import { titles, categoryProgress, COMPLETE_TITLE } from './rewards.js';
import { visitStats } from './geo.js';
import { shareImage, shareApp, prepareShareImage, SHARE_ICON } from './share.js';
import { titleImage } from './share-image.js';
import { go } from './router.js';
import { FANCLUB_TITLE, FANCLUB_ICON, FANCLUB_IMAGE, isFanclubMember, fanclubButton } from './fanclub.js';
import { toast } from './ui.js';

/**
 * その称号の獲得演出を見せたか（js/title-complete.js）。
 * 記録を始める前（titlesCelebrated が無い）は、コンプリート以外は見せたことにする（すぐに記録が作られる）。
 */
export function titleCelebrated(name) {
  const s = app.state;
  if (!s) return true;
  if (name === COMPLETE_TITLE && s.flags.completeCelebrated) return true;
  if (!Array.isArray(s.titlesCelebrated)) return name !== COMPLETE_TITLE;
  return s.titlesCelebrated.includes(name);
}

/**
 * 称号の一覧と、それぞれの進み具合。
 * @returns {Array<{key,name,icon,big,earned,shown,kind,label,owned,total,visited,spots}>}
 *   on    = 獲得して、演出も見せた（枠を「獲得済み」の見た目にする。演出の前は未獲得の見た目のまま）
 *   shown = 絵を見せてよいか（志賀町コンプリートは獲得の演出を見るまで「？？？」）
 */
export function titleInfos() {
  const got = titles();
  const prog = categoryProgress();
  const allOwned = prog.reduce((a, p) => a + p.owned, 0);
  const allTotal = prog.reduce((a, p) => a + p.total, 0);
  const v = visitStats();
  const list = prog.map((p) => ({
    key: p.key, kind: 'category', name: p.master, label: p.label,
    icon: `./assets/frames/thumb/icon-${p.key}.png`, big: [`./assets/frames/icon-${p.key}.png`],
    earned: got.includes(p.master), owned: p.owned, total: p.total,
  }));
  // 志賀町ファンクラブは、志賀町マスターの左（ホームでは2段目のいちばん左）
  list.push({
    key: 'fanclub', kind: 'fanclub', name: FANCLUB_TITLE,
    icon: FANCLUB_ICON, big: [FANCLUB_IMAGE],
    earned: isFanclubMember(), owned: 0, total: 0,
  });
  list.push({
    key: 'master', kind: 'all', name: '志賀町マスター',
    icon: './assets/frames/thumb/logo.png', big: ['./assets/frames/web/logo.webp', './assets/frames/logo.png'],
    earned: got.includes('志賀町マスター'), owned: allOwned, total: allTotal,
  });
  const done = got.includes(COMPLETE_TITLE);
  list.push({
    key: 'complete', kind: 'complete', name: COMPLETE_TITLE,
    icon: './assets/icons/title-complete.png', big: ['./assets/icons/title-complete.png'],
    earned: done, owned: allOwned, total: allTotal, visited: v.visited, spots: v.total,
  });
  for (const t of list) {
    t.on = t.earned && titleCelebrated(t.name);
    t.shown = t.kind === 'complete' ? t.on : true;
  }
  return list;
}

/** 獲得条件の文 */
function conditionText(t) {
  if (t.kind === 'category') return `${t.label}のカードを、すべて（${t.total}種類）集める`;
  if (t.kind === 'fanclub') return 'LINE の「志賀町ファンクラブ」のページを開き、受信設定フォームから志賀町ファンクラブに登録する';
  if (t.kind === 'all') return `${CATEGORIES.map((c) => c.label).join('・')}のカードを、すべて（${t.total}種類）集める`;
  return `すべてのカード（${t.total}種類）を集めて、すべてのスポット（${t.spots}か所）でチェックインする`;
}

/** あといくつで獲得か（獲得済みなら null） */
function goalText(t) {
  if (t.earned) return null;
  if (t.kind === 'fanclub') return 'ファンクラブに登録すると称号獲得！';
  const cards = Math.max(0, t.total - t.owned);
  if (t.kind !== 'complete') return `あと ${cards} 種類で称号獲得！`;
  const spots = Math.max(0, t.spots - t.visited);
  const parts = [];
  if (cards) parts.push(`カード ${cards} 種類`);
  if (spots) parts.push(`チェックイン ${spots} か所`);
  return `あと ${parts.join('・')}で称号獲得！`;
}

/** 開いている案内を閉じる（画面を移る前に） */
function closeDialog() {
  const b = [...document.querySelectorAll('#overlay .dialog__acts .btn')].find((x) => x.textContent === '閉じる');
  if (b) b.click();
}

function bar(label, cur, max) {
  const pct = max ? Math.min(100, (cur / max) * 100) : 0;
  return el('div', { class: 'titledlg__prog' }, [
    el('div', { class: 'titledlg__progl' }, [el('span', { text: label }), el('b', { text: `${cur} / ${max}` })]),
    el('div', { class: 'bar' }, [el('span', { style: { width: `${pct}%` } })]),
  ]);
}

/** シェアの準備（獲得済みの称号は絵を先に描いておく。押してから描くと iPhone で共有が開かないことがあるため） */
function shareOptions(t) {
  return {
    key: `title:${t.name}`,
    make: () => titleImage({ name: t.name, icons: t.big }),
    fileName: 'shika-collection-title.jpg',
    title: `SHIKA COLLECTION 称号「${t.name}」`,
    text: `志賀町で称号「${t.name}」を獲得しました！ #SHIKACOLLECTION #志賀町`,
  };
}

/** 称号を押したときの案内 */
export function openTitleDialog(t) {
  const body = el('div', { class: 'titledlg' });
  const medal = el('div', { class: `titledlg__medal${t.earned && t.shown ? ' is-on' : ''}` });
  if (t.shown) medal.append(el('img', { attrs: { src: t.big[0], alt: '', decoding: 'async' } }));
  else medal.append(el('span', { class: 'titledlg__q', text: '？？？' }));
  const img = medal.querySelector('img');
  if (img && t.big[1]) img.addEventListener('error', () => { img.src = t.big[1]; }, { once: true });
  body.append(medal);
  body.append(el('div', { class: `titledlg__state${t.earned ? ' is-on' : ''}`, text: t.earned ? '獲得済み' : '未獲得' }));

  body.append(el('h4', { class: 'titledlg__h', text: '獲得条件' }));
  body.append(el('p', { class: 'titledlg__cond', text: conditionText(t) }));
  if (t.kind !== 'fanclub') body.append(bar('集めたカード', t.owned, t.total));
  if (t.kind === 'complete') body.append(bar('チェックインしたスポット', t.visited, t.spots));

  const goal = goalText(t);
  if (goal) body.append(el('p', { class: 'titledlg__goal', text: goal }));
  else body.append(el('p', { class: 'titledlg__goal is-on', text: 'おめでとうございます！ 称号を獲得しました' }));

  const acts = el('div', { class: 'titledlg__acts' });
  if (!t.earned && t.kind === 'fanclub') {
    // ファンクラブは、LINE のページを開くボタン。押すと登録したことにして、称号を獲得する
    acts.append(fanclubButton({
      label: 'ファンクラブに登録（LINE が開きます）',
      cls: 'btn btn--primary btn--block fanclub__btn',
      onJoined: (first) => {
        closeDialog();
        if (first) toast(`称号「${FANCLUB_TITLE}」を獲得しました！ ミッションでコインも受け取れます`, 4200);
        // 画面を描き直すと、称号の獲得演出が出る（LINE から戻ってきてから）
        go(location.hash || '#/home', true);
      },
    }));
  } else if (!t.earned) {
    acts.append(el('button', {
      class: 'btn btn--primary btn--block', attrs: { type: 'button' }, text: 'ガチャを引いてカードを集める',
      on: { click: () => { closeDialog(); go('#/gacha'); } },
    }));
    // スポットのカードは現地のチェックインでも手に入る。コンプリートはチェックインも条件
    if (t.key === 'spot' || t.kind === 'all' || t.kind === 'complete') {
      acts.append(el('button', {
        class: 'btn btn--block', attrs: { type: 'button' }, text: 'マップでスポットを探す',
        on: { click: () => { closeDialog(); go('#/map'); } },
      }));
    }
  }
  const opts = shareOptions(t);
  if (t.earned && t.shown) prepareShareImage(opts.key, opts.make, opts.fileName).catch(() => {});
  acts.append(el('button', {
    class: 'btn btn--block titledlg__share', attrs: { type: 'button' },
    html: `${SHARE_ICON}<span>SNSでシェア</span>`,
    on: {
      click: () => {
        closeDialog();
        if (t.earned && t.shown) shareImage(opts);
        else shareApp({ text: `志賀町の称号「${t.name}」を目指しています！ ${goal || ''} #SHIKACOLLECTION #志賀町`.replace(/\s+#/, ' #') });
      },
    },
  }));
  body.append(acts);

  dialog({ title: t.name, body: [body], actions: [{ label: '閉じる', value: null }] });
}

/** 称号の並び（ホーム用。1段に3つずつ、2段）。押すと案内が開く */
export function titleRow() {
  const list = titleInfos();
  const wrap = el('div', { class: 'hometitles' });
  const got = list.filter((t) => t.earned).length;
  wrap.append(el('div', { class: 'homehead' }, [
    el('span', { text: '称号' }),
    el('b', { text: `${got} / ${list.length}` }),
  ]));
  const row = el('div', { class: 'hometitles__row' });
  for (const t of list) {
    const b = el('button', {
      class: `hometitle${t.kind === 'complete' ? ' hometitle--complete' : ''}${t.on ? ' is-on' : ''}`,
      attrs: { type: 'button', 'data-title': t.name, 'aria-label': `称号「${t.name}」${t.earned ? '（獲得済み）' : ''}。押すと獲得条件を表示` },
    });
    const ring = el('span', { class: 'hometitle__ring' });
    if (t.shown) ring.append(el('img', { attrs: { src: t.icon, alt: '', decoding: 'async' } }));
    else ring.append(el('span', { class: 'hometitle__q', text: '？' }));
    b.append(ring);
    // 名前は「スポット／マスター」「志賀町／コンプリート」の2行にそろえる（細い画面で「ー」だけが次の行に落ちないように）
    const cut = ['マスター', 'コンプリート', 'ファンクラブ'].find((w) => t.name.endsWith(w) && t.name.length > w.length);
    const lines = cut ? [t.name.slice(0, -cut.length), cut] : [t.name];
    b.append(el('span', { class: 'hometitle__n' }, lines.map((x) => el('span', { text: x }))));
    b.addEventListener('click', () => openTitleDialog(t));
    row.append(b);
  }
  wrap.append(row);
  return wrap;
}

