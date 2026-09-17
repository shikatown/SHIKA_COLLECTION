/* fanclub.js — 志賀町ファンクラブ。
   LINE の志賀町ファンクラブのページを開き、受信設定フォームから登録してもらう。
   登録したかどうかはアプリから確かめられない（LINE と連携していない）ので、
   「ファンクラブに登録」ボタンを押したことで登録とみなす（flags.fanclubJoined）。
   押すと、ミッション「志賀町ファンクラブ会員になる」の達成と、称号「志賀町ファンクラブ」の獲得になる。
   アプリから LINE へ送る情報は無い（リンクを開くだけ）。 */

import { app, commit } from './state.js';
import { el } from './dom.js';

export const FANCLUB_TITLE = '志賀町ファンクラブ';
export const FANCLUB_URL = 'https://liff.line.me/2006352925-134gxgYw/landing?follow=%40299bzzpg&lp=VODReE&liff_id=2006352925-134gxgYw';
export const FANCLUB_ICON = './assets/icons/title-fanclub-sm.png';
export const FANCLUB_IMAGE = './assets/icons/title-fanclub.png';

/** ファンクラブに登録したか（登録ボタンを押したか） */
export function isFanclubMember() {
  return !!(app.state && app.state.flags && app.state.flags.fanclubJoined);
}

/**
 * 「ファンクラブに登録」ボタン。LINE のページを新しい画面で開き、登録したことにする。
 * リンク（a 要素）にしているのは、押した瞬間に確実に開けるようにするため（あとから開くと止められる端末がある）。
 * @param {{label?:string, cls?:string, onJoined?:(first:boolean)=>void}} o
 */
export function fanclubButton({ label = 'ファンクラブに登録', cls = 'btn btn--block fanclub__btn', onJoined } = {}) {
  const a = el('a', {
    class: cls,
    attrs: { href: FANCLUB_URL, target: '_blank', rel: 'noopener noreferrer' },
    html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2c-5.1 0-9.3 3.3-9.3 7.4 0 3.7 3.3 6.8 7.8 7.3.3.1.7.2.8.5.1.2.1.6 0 .9l-.1.8c0 .2-.2.9.8.5 1-.4 5.4-3.2 7.4-5.5 1.4-1.5 2-3 2-4.5 0-4.1-4.2-7.4-9.4-7.4z" fill="currentColor"/></svg>',
  });
  a.append(el('span', { text: label }));
  a.addEventListener('click', () => {
    const first = !isFanclubMember();
    if (first) commit((s) => { s.flags.fanclubJoined = true; });
    if (onJoined) setTimeout(() => onJoined(first), 0);
  });
  return a;
}
