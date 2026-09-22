/* share.js — アプリをSNSでシェアする。
   ・スマホなど共有機能があれば、それを開く（LINE・X・Instagram など端末に入っているアプリを選べる）
   ・なければ、X／LINE／Facebook の投稿画面へのリンクと「リンクをコピー」を出す
   外部の読み込み（SDK・タグ）は使わない。押したサービスへ移動するときだけ通信する。
   送るのはアプリのURLと、集めた枚数の一文だけ。位置情報などは含めない。
   カードと称号は、この端末で描いた絵（js/share-image.js）も一緒に渡す。 */

import { publishedCards, isOwned } from './state.js';
import { el, dialog, toast, externalLink } from './ui.js';
import { trackEvent } from './analytics.js';

/** シェアするアプリのURL。画面の位置（#以降）や付け足しの ? は外す。 */
function appUrl() {
  return `${location.origin}${location.pathname}`;
}

/** シェアの文面 */
function shareText() {
  const total = publishedCards().length;
  const owned = publishedCards().filter((c) => isOwned(c.id)).length;
  return owned > 0
    ? `志賀町のカードを ${owned} / ${total} 種類あつめました！ #SHIKACOLLECTION #志賀町`
    : `志賀町をカードであつめよう！ #SHIKACOLLECTION #志賀町`;
}

/** アプリをシェアする。text を渡すと、その文でシェアする（称号の「あと○種類！」など） */
export async function shareApp(opts = {}) {
  trackEvent('share', { kind: 'app' });
  const url = appUrl();
  const text = opts.text || shareText();

  if (navigator.share) {
    try {
      await navigator.share({ title: 'SHIKA COLLECTION', text, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // 自分で閉じただけ
      // それ以外は下の選択肢に切り替える
    }
  }

  const q = encodeURIComponent;
  const links = el('div', { class: 'sharelist' });
  for (const [label, href, cls] of [
    ['X（旧Twitter）', `https://twitter.com/intent/tweet?text=${q(text)}&url=${q(url)}`, 'share--x'],
    ['LINE', `https://social-plugins.line.me/lineit/share?url=${q(url)}&text=${q(text)}`, 'share--line'],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${q(url)}`, 'share--fb'],
  ]) {
    const a = externalLink(label, href, `btn btn--block ${cls}`);
    if (a) links.append(a);
  }
  links.append(el('button', {
    class: 'btn btn--block', attrs: { type: 'button' }, text: 'リンクをコピー',
    on: { click: () => copy(`${text}\n${url}`) },
  }));

  await dialog({
    title: 'SNSでシェア',
    body: [links],
    actions: [{ label: '閉じる', value: null }],
  });
}

/** 共有ボタンの絵（コレクション欄と同じ） */
export const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="18.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.3 10.8l7.4-4M8.3 13.2l7.4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/* 作った絵は覚えておく（同じカードを何度シェアしても描き直さない） */
const images = new Map();

/** シェアする絵を先に作り始める。押した瞬間に共有画面を開けるようにするため。 */
export function prepareShareImage(key, make, fileName) {
  if (!images.has(key)) {
    const p = make()
      .then((blob) => new File([blob], fileName, { type: blob.type || 'image/jpeg' }))
      .catch((e) => { images.delete(key); throw e; });
    images.set(key, p);
  }
  return images.get(key);
}

/**
 * 絵とアプリのURLをシェアする（カード・称号）。
 * ・共有機能で絵を渡せる端末（スマホなど）は、絵と文とURLをそのまま共有画面へ
 * ・絵を作っているあいだに共有の許可が切れた端末（iPhone など）は、絵を見せて「共有する」をもう一度押してもらう
 * ・共有機能が無い端末は、絵の保存と、X／LINE／Facebook（文とURL）を出す
 * @param {{key:string, make:()=>Promise<Blob>, fileName:string, text:string, title:string}} o
 */
export async function shareImage({ key, make, fileName, text, title }) {
  trackEvent('share', { kind: String(key || '').split(':')[0] || 'image' });
  const url = appUrl();
  const withUrl = `${text}\n${url}`;
  let file = null;
  try { file = await prepareShareImage(key, make, fileName); } catch (_) { file = null; }
  const canFiles = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  const payload = () => (canFiles ? { files: [file], title, text: withUrl } : { title, text, url });

  if (navigator.share) {
    try {
      await navigator.share(payload());
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // 自分で閉じただけ
      // NotAllowedError（許可が切れた）などは、下の画面からもう一度押してもらう
    }
  }

  const body = el('div', { class: 'shareimg' });
  let objectUrl = '';
  if (file) {
    objectUrl = URL.createObjectURL(file);
    body.append(el('img', { class: 'shareimg__pic', attrs: { src: objectUrl, alt: title } }));
  }
  const links = el('div', { class: 'sharelist' });
  const closeDialog = () => {
    const b = [...document.querySelectorAll('#overlay .dialog__acts .btn')].find((x) => x.textContent === '閉じる');
    if (b) b.click();
  };
  if (navigator.share) {
    links.append(el('button', {
      class: 'btn btn--primary btn--block', attrs: { type: 'button' },
      html: `${SHARE_ICON}<span>${canFiles ? '画像つきで共有する' : '共有する'}</span>`,
      on: {
        click: async () => {
          try { await navigator.share(payload()); closeDialog(); } catch (e) { if (!e || e.name !== 'AbortError') toast('共有できませんでした'); }
        },
      },
    }));
  }
  if (file) {
    links.append(el('a', {
      class: 'btn btn--block', text: '画像を保存する',
      attrs: { href: objectUrl, download: fileName },
    }));
  }
  const q = encodeURIComponent;
  for (const [label, href, cls] of [
    ['X（旧Twitter）', `https://twitter.com/intent/tweet?text=${q(text)}&url=${q(url)}`, 'share--x'],
    ['LINE', `https://social-plugins.line.me/lineit/share?url=${q(url)}&text=${q(text)}`, 'share--line'],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${q(url)}`, 'share--fb'],
  ]) {
    const a = externalLink(label, href, `btn btn--block ${cls}`);
    if (a) links.append(a);
  }
  links.append(el('button', {
    class: 'btn btn--block', attrs: { type: 'button' }, text: 'リンクをコピー',
    on: { click: () => copy(withUrl) },
  }));
  body.append(links);
  if (file) body.append(el('p', { class: 'shareimg__note', text: 'X・LINE・Facebook に画像を載せるときは、保存した画像を投稿に添えてください。' }));

  await dialog({ title: 'SNSでシェア', body: [body], actions: [{ label: '閉じる', value: null }] });
  if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

async function copy(str) {
  try {
    await navigator.clipboard.writeText(str);
    toast('リンクをコピーしました');
  } catch (_) {
    toast(appUrl(), 5000);   // コピーできない端末では、URLを見せる
  }
}
