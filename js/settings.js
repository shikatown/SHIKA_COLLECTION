/* settings.js — 設定・遊び方・プライバシー・リセット。 */


import { app, commit, setState, storage, CATEGORIES } from './state.js';
import { el, clear, toast, dialog, confirm2, coinIcon } from './ui.js';
import { sfx, unlock } from './sound.js';
import * as backup from './backup.js';
import { coinCfg, titles, categoryProgress, duplicateGaugeInfo } from './rewards.js';
import { SINGLE_COST, TEN_COST } from './gacha.js';
import { go } from './router.js';
import { isAdmin, attachSecret } from './admin.js';
import { clearImageCache } from './update.js';
import { resumeAnalytics, stopAnalytics } from './analytics.js';

export function renderMore(view) {
  clear(view);

  const list = el('div', { class: 'list' });
  list.append(link('遊び方', '#/help'));
  list.append(link('集めた記録', '#/records'));
  list.append(link('設定', '#/settings'));
  list.append(link('プライバシーについて', '#/privacy'));
  view.append(list);

  if (isAdmin()) view.append(link('カード点検（管理モード）', '#/admin'));

  const v = app.version;
  const ver = el('p', {
    class: 'muted center', style: { marginTop: '18px', fontSize: '11.5px' },
    text: v ? `アプリ ${v.appVersion || '-'} ／ データ ${v.dataVersion || '-'}` : '',
  });
  attachSecret(ver);     // 7回続けてタップすると管理モードに入れる
  view.append(ver);
}

function link(label, href) {
  return el('a', { class: 'list__item', attrs: { href } }, [
    el('span', { text: label }),
    el('span', { html: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', style: { flex: 'none', width: '16px', height: '16px', color: '#b9b2a6' } }),
  ]);
}

/* ===== 設定 ===== */
export function renderSettings(view) {
  clear(view);

  const list = el('div', { class: 'list' });
  list.append(toggleRow('効果音', 'sound'));
  list.append(toggleRow('振動', 'vibration'));
  view.append(list);
  view.append(el('p', { class: 'muted', style: { fontSize: '11.5px', marginTop: '8px' }, text: '効果音はアプリ内で生成しています。BGMはありません。振動に対応していない端末では無視されます。' }));

  // 利用状況の記録（Google アナリティクス。js/analytics.js）
  view.append(el('h3', { text: '利用状況の記録' }));
  const an = el('div', { class: 'list' });
  an.append(toggleRow('利用状況の記録を送る', 'analytics'));
  view.append(an);
  view.append(el('p', {
    class: 'muted', style: { fontSize: '11.5px', marginTop: '8px' },
    text: 'どの画面が見られているか、ガチャやチェックインが何回あったか、という全体の傾向だけを送ります（Google アナリティクス）。'
      + '氏名・連絡先・現在地の緯度経度・持っているカード・コインの残高は送りません。切ると、以後いっさい送りません。',
  }));

  view.append(el('h3', { text: 'データ' }));
  const data = el('div', { class: 'list' });
  data.append(actionRow('バックアップを保存', () => backup.download()));
  data.append(actionRow('バックアップから復元', async () => {
    const f = await backup.pickFile();
    if (f) { const ok = await backup.restoreFromFile(f); if (ok) go('#/home'); }
  }));
  view.append(data);
  view.append(el('p', {
    class: 'muted', style: { fontSize: '11.5px', marginTop: '8px' },
    text: storage.isPersistent()
      ? 'カードとコインはこの端末の中だけに保存されます。ブラウザのデータを消すと失われます。'
      : 'このブラウザでは保存領域を使えないため、進行が残りません（プライベートモードなど）。',
  }));

  view.append(el('h3', { text: '表示がおかしいとき' }));
  const fix = el('div', { class: 'list' });
  fix.append(actionRow('写真を読み込み直す', async () => {
    const ok = await confirm2(
      '写真を読み込み直しますか',
      ['端末に控えてある写真をいったん捨てて、次に見たときに取り直します。',
       '集めたカードやコインは消えません。'],
      '読み込み直す',
    );
    if (!ok) return;
    clearImageCache();
    toast('写真を読み込み直します');
    setTimeout(() => location.reload(), 600);
  }));
  view.append(fix);
  view.append(el('p', {
    class: 'muted', style: { fontSize: '11.5px', marginTop: '8px' },
    text: 'カードの写真が別のカードのものに見えるときに使ってください。通信が少し発生します。',
  }));

  view.append(el('h3', { text: 'このアプリについて' }));
  const about = el('div', { class: 'list' });
  about.append(link('遊び方', '#/help'));
  // 「プライバシーについて」は「その他」の一覧に1つだけ置く（ここにも置くと重なって見える）
  view.append(about);

  const reset = el('div', { style: { marginTop: '26px' } });
  reset.append(el('button', {
    class: 'btn btn--danger btn--block', attrs: { type: 'button' }, text: 'ぜんぶのデータをリセット',
    on: { click: () => doReset() },
  }));
  view.append(reset);
}

function toggleRow(label, key) {
  const row = el('div', { class: 'list__item' });
  row.append(el('span', { text: label }));
  const sw = el('button', {
    class: `switch${app.state.settings[key] ? ' is-on' : ''}`,
    attrs: { type: 'button', role: 'switch', 'aria-checked': String(app.state.settings[key]), 'aria-label': label },
  });
  sw.addEventListener('click', () => {
    commit((s) => { s.settings[key] = !s.settings[key]; });
    const on = app.state.settings[key];
    sw.classList.toggle('is-on', on);
    sw.setAttribute('aria-checked', String(on));
    if (key === 'sound' && on) { unlock(); sfx.tap(); }
    if (key === 'vibration' && on && 'vibrate' in navigator) navigator.vibrate(15);
    if (key === 'analytics') { if (on) resumeAnalytics(); else stopAnalytics(); }
  });
  row.append(sw);
  return row;
}

function actionRow(label, fn) {
  return el('button', { class: 'list__item', attrs: { type: 'button' }, on: { click: fn } }, [
    el('span', { text: label }),
  ]);
}

async function doReset() {
  const first = await confirm2(
    'ぜんぶのデータをリセット',
    ['集めたカード、SHIKA COIN、訪問記録、設定がすべて消えます。', 'この操作は元に戻せません。'],
    '次へ'
  );
  if (!first) return;
  const second = await dialog({
    title: '本当にリセットしますか',
    body: ['リセットすると、初回の10連からやり直しになります。'],
    actions: [{ label: 'やめる', value: false }, { label: 'リセットする', value: true, danger: true }],
  });
  if (!second) return;
  storage.clear();
  setState(storage.defaultState());
  toast('リセットしました');
  /* 初めて開いたときと同じ流れ（起動演出 → ログインボーナス → 初回の10連）に戻すため、開き直す。
     以前は画面だけホームへ移していたので、ログインボーナスは次にアプリを開くまで受け取れなかった。 */
  setTimeout(() => {
    history.replaceState(null, '', `${location.pathname}${location.search}#/home`);
    location.reload();
  }, 700);
}

/* ===== 遊び方 ===== */
export function renderHelp(view) {
  clear(view);
  const cfg = coinCfg();

  view.append(section('ガチャ', [
    `1回 ${SINGLE_COST} SHIKA COIN、10連 ${TEN_COST} SHIKA COIN です。10連は1枚おまけつきで11枚出ます。`,
    'すべてのカードが同じ確率で登場します。レアリティはありません。',
    'はじめての方は、まず10連から。10枚すべて重複なし、グルメ・スポット・文化が最低1枚ずつ入ります。',
  ]));

  view.append(section('SHIKA COIN の集め方', [
    `毎日はじめて開いたとき +${cfg.daily}`,
    `酒のアテカードを初めて手に入れたとき +${cfg.sakeSnack}`,
    `カードが5枚かぶるごとに +${cfg.duplicatePer5}（繰り越されます）`,
    `同じカテゴリを5種類集めるごとに +${cfg.categoryPer5}`,
    `スポットに実際に行くと 初回 +${cfg.spotFirst}、再訪は1日1回 +${cfg.spotRevisit}`,
    `志賀町にはじめて来たとき +${cfg.townFirst}（1回限り）`,
  ]));

  view.append(section('カードを見る', [
    'カード画像をタップすると、3Dでカードをじっくり眺められます。',
    '指でドラッグすると回り、裏面まで見られます。ダブルタップで正面に戻ります。',
  ]));

  view.append(section('まち巡り', [
    '「現在地を確認」を押したときだけ位置情報を使います。自動では取得しません。',
    'スポットの近く（およそ200m以内）にいるとチェックインでき、範囲内のスポットはまとめて判定されます。',
    'まだ持っていないスポットカードは、現地に行くと手に入ります。',
    '経路や所要時間は Google Maps で確認してください。アプリ内の距離は直線距離の目安です。',
  ]));

  view.append(section('データについて', [
    '集めたカードやコインは、この端末の中だけに保存されます。',
    '設定からバックアップを保存しておくと、機種変更や再インストールのときに復元できます。',
  ]));

  // 「プライバシーについて」は「その他」の一覧から開く（ここには置かない）
}

function section(title, lines) {
  const s = el('div', { class: 'panel', style: { marginBottom: '12px' } });
  s.append(el('h3', { class: 'panel__title', text: title, style: { margin: '0 0 8px' } }));
  const ul = el('ul', { style: { margin: 0, paddingLeft: '1.1em', fontSize: '13px' } });
  for (const l of lines) ul.append(el('li', { text: l, style: { marginBottom: '4px' } }));
  s.append(ul);
  return s;
}

/* ===== プライバシー ===== */
export function renderPrivacy(view) {
  clear(view);
  view.append(section('集めない情報', [
    '氏名・住所・電話番号・メールアドレスは入力欄そのものがありません。',
    'ユーザー登録やアカウントはありません。',
    '誰が使っているかを特定する情報は集めていません。',
  ]));
  view.append(section('利用状況の記録', [
    'どの画面が見られているか、ガチャやチェックインが何回あったか、という全体の傾向を知るために Google アナリティクス（GA4）を使っています。',
    '送るのは画面の名前と操作の種類だけです。氏名・連絡先・現在地の緯度経度・持っているカード・コインの残高は送りません。',
    '同じ端末からの再訪をまとめて数えるために、Cookie（_ga）を1つ使います。誰かを特定するものではありません。',
    '広告のための計測（Google シグナル・広告のカスタマイズ）は切っています。',
    '設定の「利用状況の記録を送る」を切ると、以後いっさい送りません。',
  ]));
  view.append(section('位置情報', [
    '現在地は「現在地を確認」を押したときだけ取得します。',
    '取得した緯度経度は保存も送信もしません。判定が終わると端末のメモリから消えます。',
    '残るのは「どのスポットを訪問済みか」「最終訪問日」だけです。',
  ]));
  view.append(section('遊びのデータ', [
    'カード・SHIKA COIN・気になる・設定は、この端末のブラウザ内にだけ保存されます。',
    'サーバーへは送信していません（そもそも保存用のサーバーがありません）。',
  ]));
  view.append(section('外部への通信', [
    'カードデータ・画像・地図タイルの読み込みのために通信します。',
    '利用状況の記録のために、Google（googletagmanager.com・google-analytics.com）へ送ります。設定で止められます。',
    '「Google Maps で行く」などのリンクを押したときだけ、外部サイトへ移動します。',
  ]));
}

/* ===== 集めた記録 ===== */
export function renderRecords(view) {
  clear(view);
  const s = app.state;

  const p = el('div', { class: 'panel' });
  const stat = (k, v) => el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13.5px', padding: '3px 0' } }, [
    el('span', { text: k }), el('b', { text: String(v) }),
  ]);
  // ためたコインは、いちばん上に大きく出す
  view.append(el('div', { class: 'panel coinbox' }, [
    coinIcon({ big: true }),
    el('div', { class: 'coinbox__b' }, [
      el('div', { class: 'coinbox__n', text: String(s.coins) }),
      el('div', { class: 'coinbox__u', text: 'SHIKA COIN' }),
    ]),
  ]));

  p.append(stat('集めたカード', `${s.ownedCardIds.length} 枚`));
  p.append(stat('現地訪問', `${Object.values(s.visits).filter((v) => v.firstVisitedAt).length} か所`));
  p.append(stat('気になる', `${s.favorites.length} 件`));
  const g = duplicateGaugeInfo();
  p.append(stat('かぶりゲージ', `${g.current} / 5`));
  view.append(p);

  view.append(el('h3', { text: 'カテゴリ' }));
  const cp = el('div', { class: 'panel' });
  for (const c of categoryProgress()) {
    cp.append(el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px' } }, [
      el('span', { text: c.label }),
      el('span', { class: 'muted', text: `${c.owned}/${c.total}${c.complete ? ' ・コンプリート' : (c.remain != null ? ` ・次の報酬まであと${c.remain}` : '')}` }),
    ]));
    cp.append(el('div', { class: 'bar', style: { margin: '6px 0 12px' } }, [
      el('span', { style: { width: `${c.total ? (c.owned / c.total) * 100 : 0}%` } }),
    ]));
  }
  view.append(cp);

  const t = titles();
  view.append(el('h3', { text: '称号' }));
  const bg = el('div', { class: 'badgegrid' });
  // 称号ごとの絵。志賀町マスターは SHIKA COLLECTION のロゴを使う。
  const all = [
    ...CATEGORIES.map((c) => ({ name: c.master, icon: `./assets/frames/thumb/icon-${c.key}.png` })),
    { name: '志賀町ファンクラブ', icon: './assets/icons/title-fanclub-sm.png' },
    { name: '志賀町マスター', icon: './assets/frames/thumb/logo.png' },
  ];
  for (const { name, icon } of all) {
    const on = t.includes(name);
    const b = el('span', { class: `badge${on ? ' badge--on' : ''}` });
    b.append(el('img', { class: 'badge__i', attrs: { src: icon, alt: '', decoding: 'async' } }));
    b.append(el('span', { text: on ? name : `${name}（未達成）` }));
    bg.append(b);
  }
  view.append(bg);
}
