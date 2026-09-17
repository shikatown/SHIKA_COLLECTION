/* share-image.js — SNSでシェアするための画像を、この端末の中で描いて作る。
   ・カード：画面のカードと同じ部品（写真・台紙・バッジ・番号・名前・説明・ボタン・ロゴ）を、
     css/card-art.css と同じ 1080×1350 の設計座標で1枚の絵に描く
   ・称号：メダル（称号の絵）と称号の名前を、1080×1080 の絵に描く
   外部には何も送らない。できた絵は、利用者が共有を選んだときだけ共有先へ渡る。 */

import { app, CATEGORY_LABEL, publishedCards } from './state.js';
import { photoUrl, webUrl, buttonLabel, TITLE_MAX_CHARS } from './card-render.js';

const W = 1080;
const H = 1350;
const CQW = W / 100;   // css の cqw（カード幅の1%）

/** 画面で使っている字体（css の --font）。カードの文字と同じにする */
function fontFamily() {
  const f = getComputedStyle(document.documentElement).getPropertyValue('--font').trim();
  return f || 'sans-serif';
}

/** 絵を読む。先の候補が読めなければ次を試す。全部だめなら null */
function loadImage(srcs) {
  const list = srcs.filter(Boolean);
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (i >= list.length) { resolve(null); return; }
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => { i += 1; next(); };
      img.src = list[i];
    };
    next();
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 枠を覆うように切り取って描く（css の object-fit: cover） */
function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

/** 枠に収まるように描く（css の object-fit: contain） */
function drawContain(ctx, img, x, y, w, h) {
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** 文字を幅に合わせて行に分ける（日本語は1文字ずつ折り返せる） */
function wrapLines(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let cur = '';
  for (const ch of [...text]) {
    if (ctx.measureText(cur + ch).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
      if (lines.length === maxLines) return lines;
    } else {
      cur += ch;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

function setSpacing(ctx, em, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(em * px).toFixed(1)}px`;
}

/* JPEG にする。PNG だと1枚1.4〜2MBあり、LINE などへ送るのに重いため（JPEG ではおよそ数百KB）。 */
function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), 'image/jpeg', 0.9);
  });
}

const INK = { gourmet: '#4a2314', spot: '#0c3336', culture: '#33254a' };

/**
 * カードを1枚の絵にする。
 * @returns {Promise<Blob>} JPEG
 */
export async function cardImage(card) {
  const genre = ['gourmet', 'spot', 'culture'].includes(card.category) ? card.category : 'gourmet';
  const font = fontFamily();
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (_) { /* 読めなくても描く */ } }

  const full = card.photo ? photoUrl(card.photo) : '';
  const [photo, plate, icon, logo] = await Promise.all([
    full ? loadImage([webUrl(full), full]) : Promise.resolve(null),
    loadImage([`./assets/frames/web/${genre}.webp`, `./assets/frames/${genre}.png`]),
    loadImage([`./assets/frames/thumb/icon-${genre}.png`, `./assets/frames/icon-${genre}.png`]),
    loadImage(['./assets/frames/web/logo.webp', './assets/frames/logo.png']),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.textBaseline = 'middle';

  // JPEG は透明を持てないので、台紙の角の外側は白にする
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // ① 写真（写真が無いときは下地の色）
  ctx.fillStyle = '#17151a';
  ctx.fillRect(57, 57, 965, 623);
  if (photo) drawCover(ctx, photo, 57, 57, 965, 623);

  // ② 台紙
  if (plate) ctx.drawImage(plate, 0, 0, W, H);

  // ③ カテゴリバッジ（左上）
  const pillH = 65;
  const pillY = 74;
  const badgeFont = 3.1 * CQW;
  ctx.font = `800 ${badgeFont}px ${font}`;
  setSpacing(ctx, 0.04, badgeFont);
  const label = CATEGORY_LABEL[genre] || '';
  const iconH = pillH * 0.94;
  const iconW = icon ? (icon.naturalWidth / icon.naturalHeight) * iconH : 0;
  const gap = 1 * CQW;
  const inner = iconW + (icon ? gap : 0) + ctx.measureText(label).width;
  const badgeW = Math.max(19.3 * CQW, inner + 1.3 * CQW * 2);
  ctx.fillStyle = '#0b3a6b';
  roundRect(ctx, 82, pillY, badgeW, pillH, pillH / 2);
  ctx.fill();
  let bx = 82 + (badgeW - inner) / 2;
  if (icon) { ctx.drawImage(icon, bx, pillY + (pillH - iconH) / 2, iconW, iconH); bx += iconW + gap; }
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.fillText(label, bx, pillY + pillH / 2 + 1);

  // ④ 番号（右上。右端を x=993 にそろえる）
  const total = publishedCards().length;
  const numFont = 3.1 * CQW;
  const no = `#${String(Number(card.id)).padStart(2, '0')}`;
  const sub = total ? `/ ${total}` : '';
  ctx.font = `800 ${numFont}px ${font}`;
  setSpacing(ctx, 0.01, numFont);
  const noW = ctx.measureText(no).width;
  const subFont = numFont * 0.677;
  ctx.font = `600 ${subFont}px ${font}`;
  const subW = sub ? ctx.measureText(sub).width + numFont * 0.26 * 0.677 : 0;
  const pad = numFont * 0.62;
  const numW = noW + subW + pad * 2;
  const numX = 993 - numW;
  ctx.fillStyle = '#0b3a6b';
  roundRect(ctx, numX, pillY, numW, pillH, pillH / 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${numFont}px ${font}`;
  ctx.fillText(no, numX + pad, pillY + pillH / 2 + 1);
  if (sub) {
    ctx.globalAlpha = 0.82;
    ctx.font = `600 ${subFont}px ${font}`;
    ctx.fillText(sub, numX + pad + noW + numFont * 0.26 * 0.677, pillY + pillH / 2 + 2);
    ctx.globalAlpha = 1;
  }
  setSpacing(ctx, 0, 1);

  // ⑤ 名前（全カード同じ大きさ。13文字以上だけ1行に収まるまで縮める）
  const name = card.name || '';
  const n = [...name].length;
  const titleFont = (n > TITLE_MAX_CHARS ? 78 / n : 6.5) * CQW;
  ctx.font = `800 ${titleFont}px ${font}`;
  ctx.fillStyle = '#fff';
  ctx.fillText(name, 95, 790 + 88 / 2, 895);

  // ⑥ 説明（通常の太さ・3行まで）
  const text = card.cardText || card.description || '';
  if (text) {
    const descFont = 3.6 * CQW;
    const lh = descFont * 1.26;
    ctx.font = `400 ${descFont}px ${font}`;
    ctx.textBaseline = 'top';
    const lines = wrapLines(ctx, text, 895, 3);
    lines.forEach((ln, i) => ctx.fillText(ln, 95, 890 + i * lh + (lh - descFont) / 2));
    ctx.textBaseline = 'middle';
  }

  // ⑦ ボタン
  const btn = buttonLabel(card, genre);
  if (btn) {
    ctx.fillStyle = '#fff';
    roundRect(ctx, 96, 1048, 888, 62, 31);
    ctx.fill();
    ctx.fillStyle = INK[genre];
    ctx.font = `800 ${3.1 * CQW}px ${font}`;
    ctx.fillText(btn, 96 + W * 0.036, 1048 + 31 + 1, 888 - W * 0.036 - W * 0.032 - 60);
    ctx.font = `600 ${3.6 * CQW}px ${font}`;
    ctx.textAlign = 'right';
    ctx.fillText('→', 96 + 888 - W * 0.032, 1048 + 31);
    ctx.textAlign = 'left';
  }

  // ⑧ ロゴ
  if (logo) drawContain(ctx, logo, W / 2 - 259 / 2, 1189.5 - 155 / 2, 259, 155);

  return toBlob(canvas);
}

/**
 * 称号を1枚の絵にする（メダル＋称号の名前）。
 * @param {{name:string, icons:string[]}} title icons は大きい絵の候補（先に読めたものを使う）
 * @returns {Promise<Blob>} JPEG
 */
export async function titleImage({ name, icons }) {
  const S = 1080;
  const font = fontFamily();
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (_) { /* 読めなくても描く */ } }
  const [medal, logo] = await Promise.all([
    loadImage(icons),
    loadImage(['./assets/frames/web/logo.webp', './assets/frames/logo.png']),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  // 背景（金色がかったクリーム色）
  const bg = ctx.createRadialGradient(S / 2, S * 0.42, 60, S / 2, S * 0.5, S * 0.75);
  bg.addColorStop(0, '#fffaf0');
  bg.addColorStop(1, '#f1ddb0');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  // 上：SHIKA COLLECTION のロゴ
  if (logo) drawContain(ctx, logo, S / 2 - 170, 40, 340, 190);

  // メダル（白い円に金のふち）
  const cx = S / 2;
  const cy = 540;
  const r = 250;
  ctx.save();
  ctx.shadowColor = 'rgba(120,84,20,.28)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 18;
  ctx.strokeStyle = '#e3c789';
  ctx.beginPath();
  ctx.arc(cx, cy, r - 9, 0, Math.PI * 2);
  ctx.stroke();
  if (medal) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 20, 0, Math.PI * 2);
    ctx.clip();
    drawContain(ctx, medal, cx - (r - 40), cy - (r - 40), (r - 40) * 2, (r - 40) * 2);
    ctx.restore();
  }

  // 下：「称号を獲得！」と称号の名前、町の名前
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#b8862b';
  ctx.font = `800 46px ${font}`;
  setSpacing(ctx, 0.12, 46);
  ctx.fillText('称号を獲得！', cx, 860);
  setSpacing(ctx, 0.02, 84);
  ctx.fillStyle = '#2b2722';
  ctx.font = `900 84px ${font}`;
  ctx.fillText(name, cx, 950, S - 120);
  setSpacing(ctx, 0.1, 34);
  ctx.fillStyle = '#8d867c';
  ctx.font = `700 34px ${font}`;
  ctx.fillText(`石川県${(app.config && app.config.townName) || '志賀町'}`, cx, 1030);

  return toBlob(canvas);
}
