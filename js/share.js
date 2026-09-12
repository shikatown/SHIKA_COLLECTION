/* share.js — アプリをSNSでシェアする。
   ・スマホなど共有機能があれば、それを開く（LINE・X・Instagram など端末に入っているアプリを選べる）
   ・なければ、X／LINE／Facebook の投稿画面へのリンクと「リンクをコピー」を出す
   外部の読み込み（SDK・タグ）は使わない。押したサービスへ移動するときだけ通信する。
   送るのはアプリのURLと、集めた枚数の一文だけ。位置情報などは含めない。 */

import { publishedCards, isOwned } from './state.js';
import { el, dialog, toast, externalLink } from './ui.js';

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

export async function shareApp() {
  const url = appUrl();
  const text = shareText();

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

async function copy(str) {
  try {
    await navigator.clipboard.writeText(str);
    toast('リンクをコピーしました');
  } catch (_) {
    toast(appUrl(), 5000);   // コピーできない端末では、URLを見せる
  }
}
