/* card-render.js — カードを部品から組み立てる。
   1枚の完成画像を貼るのではなく、次の部品を重ねて作る。

     ① 写真      assets/photos/<写真ファイル名>      … カードごと（Excelから）
     ② 台紙      assets/frames/<ジャンル>.png        … ジャンル共通
                 外枠・背景・金の区切り線・所在地ピル・罫線を含む。
                 写真の窓は透過なので、①が下から見える。
     ③ バッジ    紺のピル ＋ assets/frames/icon-<ジャンル>.png ＋ カテゴリ名
     ④ 番号      cards.json の id と公開枚数から生成
     ⑤ 名前      cards.json の name
     ⑥ 説明      cards.json の cardText（無ければ description）
     ⑦ ボタン    cards.json の cardButton（無ければ config.json のジャンル既定）
     ⑧ ロゴ      assets/frames/logo.png

   一覧のように小さく並べるときは、assets/photos/thumb と assets/frames/thumb の
   縮小版を使う（原寸を53枚ぶん展開すると描画が重くなるため）。
   詳細・3Dビューア・ガチャ演出では原寸をそのまま使う。

   位置とサイズは 1080×1350 の設計座標から計算した割合で css/card-art.css に書いてある。
   文言・写真・アイコン・ロゴを差し替えるのに画像を作り直す必要はない。 */

import { el } from './dom.js';
import { app, CATEGORY_LABEL } from './state.js';

export const ART_W = 1080;
export const ART_H = 1350;

const GENRES = new Set(['gourmet', 'spot', 'culture']);

/* カード名の文字の大きさは、すべてのカードで同じ（css/card-art.css の 6.5cqw）。
   その大きさで1行に収まるのは12文字まで（名前の枠は幅 82.87cqw）。
   13文字以上の名前だけ、そのカードの文字を1行に収まる大きさまで縮める（変換ツールが警告を出す）。 */
export const TITLE_MAX_CHARS = 12;
function titleStyle(name) {
  const n = [...(name || '')].length;
  return n > TITLE_MAX_CHARS ? { fontSize: `${(78 / n).toFixed(2)}cqw` } : null;
}

export function photoUrl(file) {
  if (!file) return '';
  if (/^https?:\/\//i.test(file)) return file;
  if (file.startsWith('assets/')) return `./${file}`;
  if (file.startsWith('./')) return file;
  return `./assets/photos/${file}`;
}

/** 一覧用の小さい写真。原寸は詳細・3Dビューア・ガチャ演出で使い続ける。 */
export function thumbUrl(file) {
  if (!file || /^https?:\/\//i.test(file) || file.startsWith('./') || file.startsWith('assets/')) return '';
  return `./assets/photos/thumb/${file.replace(/\.[^.]+$/, '.jpg')}`;
}

/**
 * 表示用の軽い画像（WebP）の場所。assets/<フォルダ>/web/<名前>.webp
 * 元の画像（数百KB〜3MB）を、画面に出る大きさまで縮めて WebP にしたもの。
 * 作り方は assets/photos/README.txt。無いときは呼ぶ側で元の画像に戻す。
 */
export function webUrl(src) {
  const m = /^\.\/assets\/(photos|frames|cards|icons)\/([^/]+)\.(png|jpe?g)$/i.exec(src || '');
  return m ? `./assets/${m[1]}/web/${m[2]}.webp` : '';
}

/** 原寸を上に重ねて、読み終わってからそっと現す層。
    差し替え（src の付け替え）だと一瞬抜けてちらつくので、重ねて不透明度だけ変える。
    まず軽い WebP を読み、無ければ元の画像を読む。 */
function layerHi(src) {
  const light = webUrl(src);
  const hi = el('img', {
    class: 'cardart__layer cardart__layer--hi',
    attrs: { src: light || src, alt: '', decoding: 'async' },
  });
  const show = () => hi.classList.add('is-on');
  if (hi.complete && hi.naturalWidth) show();
  else hi.addEventListener('load', show, { once: true });
  hi.addEventListener('error', () => {
    if (light && hi.getAttribute('src') === light) { hi.src = src; return; }
    hi.remove();
  });
  return hi;
}

/** カード下部のボタン文言。カード個別 → ジャンル既定 → 無し の順で決まる。
    ジャンル既定は「行き先がある」ことが前提の文言なので、行き先が無い行には出さない。
    （例：郷土料理で購入検索が空欄なら「取扱店を検索する」は押しても何も起きない）
    行き先の決め方は js/card-detail.js の cardActionUrl() と合わせてある。 */
function buttonLabel(card, genre) {
  if (card.cardButton) return card.cardButton;
  if (genre === 'gourmet' && !(card.purchase && card.purchase.enabled)) return '';
  if (genre === 'spot' && !(card.gps && card.gps.lat != null)) return '';
  const map = (app.config && app.config.cardButtons) || {};
  return map[genre] || '';
}

/**
 * @param {object} card cards.json のカード
 * @param {{total?:number, locked?:boolean, thumb?:boolean}} opts
 *   total=公開枚数（#01/53 の分母）、thumb=一覧用の小さい写真を使う
 */
export function renderCardArt(card, { total = 0, locked = false, thumb = false } = {}) {
  const genre = GENRES.has(card.category) ? card.category : 'gourmet';
  const root = el('div', { class: `cardart cardart--${genre}${locked ? ' cardart--locked' : ''}` });

  // ① 写真
  const photo = el('div', { class: 'cardart__photo' });
  if (locked) {
    photo.classList.add('is-locked');
    photo.append(el('span', { text: '?' }));
  } else if (card.photo) {
    const full = photoUrl(card.photo);
    const small = thumbUrl(card.photo);
    const img = el('img', {
      class: 'cardart__pic',
      attrs: { src: small || full, alt: '', loading: 'lazy', decoding: 'async' },
    });
    // 読み終わってから現す。すでに手元にある（先読み済み）ときは最初から出す
    const reveal = () => img.classList.add('is-on');
    if (img.complete && img.naturalWidth) reveal();
    else img.addEventListener('load', reveal);
    let triedFull = !small;
    img.addEventListener('error', () => {
      if (!triedFull) { triedFull = true; img.src = full; return; }   // 小さい写真が無ければ原寸で
      img.remove();
      photo.classList.add('is-empty');
      photo.append(el('span', { text: '写真準備中' }));
    });
    photo.append(img);
    // 大きく出すときは、小さい写真の上に原寸を重ねて、そっと現す（差し替えるとちらつく）
    if (!thumb && small) photo.append(layerHi(full));
  } else {
    photo.classList.add('is-empty');
    photo.append(el('span', { text: '写真準備中' }));
  }
  root.append(photo);

  // ② 台紙（写真の上に重ねる。写真の窓が透過になっている）
  /* 部品はまず縮小版を出してから原寸に差し替える。
     原寸は1枚1〜2MBあり、待つあいだ枠が抜けて見えてしまうため。 */
  const framePart = (file, className) => {
    const img = el('img', {
      class: className,
      attrs: { src: `./assets/frames/thumb/${file}`, alt: '', loading: 'lazy', decoding: 'async' },
    });
    img.addEventListener('error', () => { img.src = `./assets/frames/${file}`; }, { once: true });
    return img;
  };
  const plate = el('div', { class: 'cardart__plate' });
  plate.append(framePart(`${genre}.png`, 'cardart__layer'));
  if (!thumb) plate.append(layerHi(`./assets/frames/${genre}.png`));
  root.append(plate);

  // ③ カテゴリバッジ
  const badge = el('div', { class: 'cardart__badge' });
  badge.append(framePart(`icon-${genre}.png`, ''));
  badge.append(el('span', { text: CATEGORY_LABEL[genre] || '' }));
  root.append(badge);

  // ④ 番号
  const no = String(Number(card.id));
  const num = el('div', { class: 'cardart__num' });
  num.append(el('b', { text: `#${no.padStart(2, '0')}` }));
  if (total) num.append(el('span', { text: `/ ${total}` }));
  root.append(num);

  // ⑤ 名前
  const name = locked ? '???' : (card.name || '');
  root.append(el('div', { class: 'cardart__title', style: locked ? null : titleStyle(name), text: name }));

  // ⑥ 説明
  if (!locked) {
    const text = card.cardText || card.description || '';
    if (text) root.append(el('div', { class: 'cardart__desc', text }));
  }

  // ⑦ ボタン（文言が無いジャンルには出さない）
  const label = buttonLabel(card, genre);
  if (label) {
    const btn = el('div', { class: 'cardart__btn' });
    btn.append(el('span', { text: label }));
    btn.append(el('i', { text: '→' }));
    root.append(btn);
  }

  // ⑧ ロゴ
  const logo = el('div', { class: 'cardart__logo' });
  const logoImg = framePart('logo.png', 'cardart__layer');
  logoImg.alt = 'SHIKA COLLECTION';
  logo.append(logoImg);
  if (!thumb) logo.append(layerHi('./assets/frames/logo.png'));
  root.append(logo);

  return root;
}
