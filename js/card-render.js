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

   位置とサイズは 1080×1350 の設計座標から計算した割合で css/card-art.css に書いてある。
   文言・写真・アイコン・ロゴを差し替えるのに画像を作り直す必要はない。 */

import { el } from './dom.js';
import { app, CATEGORY_LABEL } from './state.js';

export const ART_W = 1080;
export const ART_H = 1350;

const GENRES = new Set(['gourmet', 'spot', 'culture']);

/** カード名の長さに応じてタイトルの詰め方を変える（長い名前でも枠から出さない） */
function titleClass(name) {
  const n = [...(name || '')].length;
  if (n <= 9) return '';
  if (n <= 13) return ' cardart__title--mid';
  return ' cardart__title--long';
}

export function photoUrl(file) {
  if (!file) return '';
  if (/^https?:\/\//i.test(file)) return file;
  if (file.startsWith('assets/')) return `./${file}`;
  if (file.startsWith('./')) return file;
  return `./assets/photos/${file}`;
}

/** カード下部のボタン文言。カード個別 → ジャンル既定 → 無し の順で決まる */
function buttonLabel(card, genre) {
  if (card.cardButton) return card.cardButton;
  const map = (app.config && app.config.cardButtons) || {};
  return map[genre] || '';
}

/**
 * @param {object} card cards.json のカード
 * @param {{total?:number, locked?:boolean}} opts total=公開枚数（#01/53 の分母）
 */
export function renderCardArt(card, { total = 0, locked = false } = {}) {
  const genre = GENRES.has(card.category) ? card.category : 'gourmet';
  const root = el('div', { class: `cardart cardart--${genre}${locked ? ' cardart--locked' : ''}` });

  // ① 写真
  const photo = el('div', { class: 'cardart__photo' });
  if (locked) {
    photo.classList.add('is-locked');
    photo.append(el('span', { text: '?' }));
  } else if (card.photo) {
    const img = el('img', {
      attrs: { src: photoUrl(card.photo), alt: '', loading: 'lazy', decoding: 'async' },
    });
    img.addEventListener('error', () => {
      img.remove();
      photo.classList.add('is-empty');
      photo.append(el('span', { text: '写真準備中' }));
    }, { once: true });
    photo.append(img);
  } else {
    photo.classList.add('is-empty');
    photo.append(el('span', { text: '写真準備中' }));
  }
  root.append(photo);

  // ② 台紙（写真の上に重ねる。写真の窓が透過になっている）
  root.append(el('img', {
    class: 'cardart__plate',
    attrs: { src: `./assets/frames/${genre}.png`, alt: '', decoding: 'async' },
  }));

  // ③ カテゴリバッジ
  const badge = el('div', { class: 'cardart__badge' });
  badge.append(el('img', {
    attrs: { src: `./assets/frames/icon-${genre}.png`, alt: '', decoding: 'async' },
  }));
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
  root.append(el('div', { class: `cardart__title${locked ? '' : titleClass(name)}`, text: name }));

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
  root.append(el('img', {
    class: 'cardart__logo',
    attrs: { src: './assets/frames/logo.png', alt: 'SHIKA COLLECTION', decoding: 'async' },
  }));

  return root;
}
