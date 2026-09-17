/* card-link.js — カードに印刷されたボタン（取扱店を検索する・経路を見る など）を押せるようにする。
   カード詳細と、「カードを見る」で開く3Dビューアの両方で使う。
   行き先（Googleマップの検索・経路、取扱店のページ、公式ページ）は cardActionUrl() の1か所で決める。 */

import { app } from './state.js';
import { el, mapsSearchUrl, mapsRouteUrl, safeUrl } from './ui.js';

/** カードに印刷されたボタンが指す先。地図や販売店の検索はここ1か所で決める。 */
export function cardActionUrl(c) {
  // スポットのボタンは「Googleマップで経路を見る」なので、場所の検索ではなく経路の検索を開く
  if (c.category === 'spot' && c.gps.lat != null) return mapsRouteUrl(c.gps.lat, c.gps.lng);
  if (c.purchase.enabled) {
    const shop = c.purchase.shops.find((s) => safeUrl(s.url));
    if (shop) return safeUrl(shop.url);
    const word = c.purchase.searchWord || `${(app.config && app.config.townName) || '志賀町'} ${c.name}`;
    return mapsSearchUrl(word);
  }
  if (c.gps.lat != null) return mapsSearchUrl(`${c.gps.lat},${c.gps.lng}`);
  const first = c.externalLinks.find((l) => safeUrl(l.url));
  return first ? safeUrl(first.url) : '';
}

/** カードの絵に描かれたボタンの上に、透明なリンクを重ねる。
    絵は作り直さずに、押せる場所だけを足す。 */
export function linkCardButton(face, c) {
  const btn = face.querySelector('.cardart__btn');
  if (!btn) return;                       // 文化カードのようにボタンが無い意匠
  const url = cardActionUrl(c);
  if (!url) return;
  btn.classList.add('is-live');
  btn.append(el('a', {
    class: 'cardart__hit',
    attrs: {
      href: url, target: '_blank', rel: 'noopener noreferrer',
      'aria-label': (btn.textContent || '').replace('→', '').trim(),
    },
  }));
}
