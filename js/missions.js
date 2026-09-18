/* missions.js — ミッション。
   ガチャを引かないと分からなかった「あと何種類で報酬か」を、ここで見えるようにする。

   考え方:
   ・条件はすべて、いまの保存データから数え直して決める（別に進捗を貯めない）。
     数え方が変わっても、受け取り済みの記録さえあれば食い違わない。
   ・達成しても勝手にコインは入らない。この画面で「受け取る」を押して受け取る。
   ・受け取った記録は state.rewardClaims.missions（ミッションの id の並び）。 */

import { app, commit, saveOk, CATEGORIES, categoryStats } from './state.js';
import { el, clear, toast, vibrate, coinIcon, dialog } from './ui.js';
import { coinCfg, loginInfo } from './rewards.js';
import { visitStats } from './geo.js';
import { sfx, unlock } from './sound.js';
import { holdCoins, releaseCoins, flyCoins } from './coin-fly.js';
import { showGuide } from './guide.js';
import { FANCLUB_TITLE, isFanclubMember, fanclubButton } from './fanclub.js';
import { maybeCelebrateTitles } from './title-complete.js';

/** ミッションの賞金。config.json の mission で上書きできる。 */
function cfg() {
  const c = (app.config && app.config.mission) || {};
  return {
    categoryStep: c.categoryStep != null ? c.categoryStep : coinCfg().categoryPer5,
    categoryAll: c.categoryAll != null ? c.categoryAll : 10,
    allCards: c.allCards != null ? c.allCards : 30,
    visit: c.visit || { 1: 3, 5: 5, 10: 8 },
    visitAll: c.visitAll != null ? c.visitAll : 15,
    fanclub: c.fanclub != null ? c.fanclub : 10,
    sake: c.sake != null ? c.sake : 5,
  };
}

/**
 * いまのミッション一覧。
 * @returns {Array<{id,group,label,note,owned,need,done,coins,claimed}>}
 */
export function missions() {
  const k = cfg();
  const stats = categoryStats();
  const list = [];

  // ① ジャンルごとに5種類ずつ
  for (const { key, label } of CATEGORIES) {
    const { owned, total } = stats[key];
    for (let n = 5; n <= total; n += 5) {
      if (n === total) break;          // ぴったり全部のときは「すべて集める」に任せる
      list.push({
        id: `cat:${key}:${n}`, group: 'カード',
        label: `${label}を ${n} 種類あつめる`,
        owned: Math.min(owned, n), need: n, coins: k.categoryStep,
      });
    }
    if (total > 0) {
      list.push({
        id: `catall:${key}`, group: 'カード',
        label: `${label}をすべてあつめる`, note: `${total} 種類`,
        owned, need: total, coins: k.categoryAll,
      });
    }
  }

  // ② ぜんぶのカード
  const allOwned = CATEGORIES.reduce((a, c) => a + stats[c.key].owned, 0);
  const allTotal = CATEGORIES.reduce((a, c) => a + stats[c.key].total, 0);
  if (allTotal > 0) {
    list.push({
      id: 'all', group: 'カード',
      label: 'すべてのカードをあつめる', note: `${allTotal} 種類`,
      owned: allOwned, need: allTotal, coins: k.allCards,
    });
  }

  // ③ まち巡り
  const v = visitStats();
  for (const n of Object.keys(k.visit).map(Number).sort((a, b) => a - b)) {
    if (n >= v.total) continue;
    list.push({
      id: `visit:${n}`, group: 'まち巡り',
      label: n === 1 ? 'はじめてのチェックイン' : `${n} か所チェックインする`,
      owned: Math.min(v.visited, n), need: n, coins: k.visit[n],
    });
  }
  if (v.total > 0) {
    list.push({
      id: 'visitall', group: 'まち巡り',
      label: 'すべての場所をチェックインする', note: `${v.total} か所`,
      owned: v.visited, need: v.total, coins: k.visitAll,
    });
  }

  // ④ 志賀町ファンクラブ（「ファンクラブに登録」ボタンを押したら達成。js/fanclub.js）
  list.push({
    id: 'fanclub', group: 'ファンクラブ',
    label: '志賀町ファンクラブ会員になる',
    owned: isFanclubMember() ? 1 : 0, need: 1, coins: k.fanclub,
  });

  // ⑤ 志賀町と日本酒の歴史（「読む」を押して説明を読んだら達成）
  list.push({
    id: 'sake', group: '志賀町と日本酒の歴史',
    label: '志賀町と日本酒の歴史を読む',
    owned: app.state.flags.sakeHistoryRead ? 1 : 0, need: 1, coins: k.sake,
  });

  const claimed = app.state.rewardClaims.missions || [];
  for (const m of list) {
    m.done = m.owned >= m.need;
    m.claimed = claimed.includes(m.id);
  }
  return list;
}

/** 受け取れるミッションの数（タブの数字） */
export function claimableCount() {
  return missions().filter((m) => m.done && !m.claimed).length;
}

/** 1件だけ受け取る。受け取ったコイン数を返す。 */
export function claim(id) {
  const m = missions().find((x) => x.id === id);
  if (!m || !m.done || m.claimed) return 0;
  commit((s) => {
    s.rewardClaims.missions.push(id);
    s.coins += m.coins;
  });
  return saveOk() ? m.coins : 0;   // 保存できなければ、受け取ったことにしない
}

/** 達成しているものをまとめて受け取る。受け取った合計を返す。 */
export function claimAll() {
  const ready = missions().filter((m) => m.done && !m.claimed);
  if (!ready.length) return { count: 0, coins: 0 };
  const coins = ready.reduce((a, m) => a + m.coins, 0);
  commit((s) => {
    for (const m of ready) s.rewardClaims.missions.push(m.id);
    s.coins += coins;
  });
  if (!saveOk()) return { count: 0, coins: 0, failed: true };
  return { count: ready.length, coins };
}

/* ===== 画面 ===== */

export function renderMissions(view) {
  clear(view);
  const list = missions();
  const ready = list.filter((m) => m.done && !m.claimed);

  const head = el('div', { class: 'panel' });
  head.append(el('p', {
    style: { margin: '0 0 8px', fontSize: '13.5px' },
    text: ready.length
      ? `受け取れるミッションが ${ready.length} 件あります。`
      : 'カードを集めたり、まちを巡ったりすると達成できます。',
  }));
  const total = ready.reduce((a, m) => a + m.coins, 0);
  const all = el('button', {
    class: 'btn btn--primary btn--block', attrs: { type: 'button' },
    text: ready.length ? `まとめて受け取る（+${total} SHIKA COIN）` : 'まとめて受け取る',
    on: {
      click: () => {
        unlock();
        const from = all.getBoundingClientRect();   // ここからコインが飛び立つ
        holdCoins();
        const r = claimAll();
        if (r.failed) { releaseCoins(); return; }   // 保存できなかった（案内は app.js が出す）
        if (!r.count) { releaseCoins(); toast('いま受け取れるものはありません'); return; }
        sfx.coin(); vibrate([12, 30, 18]);
        toast(`${r.count} 件で +${r.coins} SHIKA COIN`);
        flyCoins(from, r.coins);
        renderMissions(view);
      },
    },
  });
  all.disabled = ready.length === 0;
  head.append(all);

  // 並びは ログインボーナス → まとめて受け取る → カード → まち巡り（称号は v1.44 でホームへ移した）
  view.append(el('h3', { class: 'missions__first', text: 'ログインボーナス' }));
  view.append(loginPanel());
  view.append(head);

  for (const group of ['ファンクラブ', '志賀町と日本酒の歴史', 'カード', 'まち巡り']) {
    const rows = list.filter((m) => m.group === group);
    if (!rows.length) continue;
    view.append(el('h3', { text: group }));
    const box = el('div', { class: 'panel missionlist' });
    if (group === 'ファンクラブ') {
      // ミッションの行（押すと説明）と、「ファンクラブに登録」ボタンをひとまとめに
      for (const m of rows) box.append(row(m, view));
      box.append(fanclubPanel(view));
      view.append(box);
      continue;
    }
    if (group === '志賀町と日本酒の歴史') {
      for (const m of rows) box.append(row(m, view));
      box.append(sakePanel(view));
      view.append(box);
      continue;
    }
    // 受け取れるものを先に、次にこれから、最後に受け取り済み
    const rank = (m) => (m.done && !m.claimed ? 0 : (m.claimed ? 2 : 1));
    for (const m of rows.slice().sort((a, b) => rank(a) - rank(b) || a.need - b.need)) {
      box.append(row(m, view));
    }
    view.append(box);
  }


  // 初めて開いたときだけの案内
  showGuide('missionsGuideShown', {
    icon: 'star',
    title: 'ミッションのあそびかた',
    lines: [
      'カードを集めたり、まちを巡ったりすると、ミッションを達成します。',
      '達成したら「受け取る」で SHIKA COIN がもらえます。「まとめて受け取る」で一度にもらうこともできます。',
    ],
  });
}

/* ===== ログインボーナス =====
   SHIKA COLLECTION のロゴは、色の無い状態から始まり、1日目は「S」、2日目は「H」…と
   ログインした日数ぶんの文字に色が付く。15文字（S H I K A C O L L E C T I O N）で15日。翌日からまた1日目。

   ロゴは1枚の絵なので、どの点がどの文字かを書いた「区分け地図」（assets/frames/web/logo-letters.png）を使う。
   区分け地図の赤の値 ÷ 16 が文字の番号（1=S … 15=N、0=文字ではない）。ロゴと同じ 960×640。
   ロゴの絵を差し替えたときは、区分け地図も作り直すこと（作り直すまでは、左から順に色が付く以前の見せ方になる）。 */
const LOGO_LETTERS = 'SHIKACOLLECTION';
let logoPixels = null;

function loadImg(srcs) {
  return new Promise((resolve) => {
    let i = 0;
    const next = () => {
      if (i >= srcs.length) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { i += 1; next(); };
      img.src = srcs[i];
    };
    next();
  });
}

/** ロゴと区分け地図の点を読む（1回だけ）。文字ごとの範囲（演出の中心に使う）も数える。 */
function loadLogoPixels() {
  if (!logoPixels) {
    logoPixels = (async () => {
      const [logo, map] = await Promise.all([
        loadImg(['./assets/frames/web/logo.webp', './assets/frames/logo.png']),
        loadImg(['./assets/frames/web/logo-letters.png']),
      ]);
      if (!logo || !map) throw new Error('ロゴの区分け地図を読めませんでした');
      const W = 960;
      const H = 640;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(logo, 0, 0, W, H);
      const rgba = x.getImageData(0, 0, W, H).data;
      x.clearRect(0, 0, W, H);
      x.drawImage(map, 0, 0, W, H);
      const m = x.getImageData(0, 0, W, H).data;
      const labels = new Uint8Array(W * H);
      const boxes = Array.from({ length: LOGO_LETTERS.length + 1 }, () => [W, H, 0, 0]);
      for (let i = 0; i < W * H; i += 1) {
        if (!rgba[i * 4 + 3]) continue;
        const L = Math.round(m[i * 4] / 16);
        if (L < 1 || L > LOGO_LETTERS.length) continue;
        labels[i] = L;
        const b = boxes[L]; const px = i % W; const py = (i / W) | 0;
        if (px < b[0]) b[0] = px; if (py < b[1]) b[1] = py; if (px > b[2]) b[2] = px; if (py > b[3]) b[3] = py;
      }
      return { W, H, rgba, labels, boxes };
    })();
    logoPixels.catch(() => { logoPixels = null; });
  }
  return logoPixels;
}

/** ロゴを描く。mode(文字の番号) が 'color' なら元の色、'gray' なら色の無い薄い姿、'none' なら描かない */
function paintLogo(canvas, d, mode) {
  canvas.width = d.W; canvas.height = d.H;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(d.W, d.H);
  const o = out.data;
  const src = d.rgba;
  const modes = [];
  for (let L = 0; L <= LOGO_LETTERS.length; L += 1) modes[L] = mode(L);
  for (let i = 0; i < d.W * d.H; i += 1) {
    const a = src[i * 4 + 3];
    if (!a) continue;
    const md = modes[d.labels[i]];
    if (md === 'none') continue;
    const k = i * 4;
    if (md === 'color') {
      o[k] = src[k]; o[k + 1] = src[k + 1]; o[k + 2] = src[k + 2]; o[k + 3] = a;
    } else {
      const g = 0.3 * src[k] + 0.59 * src[k + 1] + 0.11 * src[k + 2];
      o[k] = g; o[k + 1] = g; o[k + 2] = g; o[k + 3] = a * 0.3;
    }
  }
  ctx.putImageData(out, 0, 0);
}

function loginPanel() {
  const { day, cycle, bonus, next, nextCoins, today } = loginInfo();
  const daily = coinCfg().daily;
  const total = LOGO_LETTERS.length;
  // 何文字目まで色を付けるか（1周が15日でない設定のときは、日数の割合で文字数を決める）
  const lettersFor = (d) => (cycle === total ? d : Math.round((d / cycle) * total));
  const shown = Math.min(total, lettersFor(day));
  const before = Math.min(total, lettersFor(Math.max(0, day - 1)));
  const shownToday = app.state.loginShownDate === app.state.dailyBonusDate;
  const animate = today && day > 0 && !shownToday;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const complete = day >= cycle;

  const p = el('div', { class: `panel loginbonus${complete ? ' is-done' : ''}` });
  const logo = el('div', { class: 'loginbonus__logo', attrs: { role: 'img', 'aria-label': `SHIKA COLLECTION のうち ${shown} 文字に色が付いています（ログイン ${day} / ${cycle} 日）` } });
  const stage = el('div', { class: 'loginbonus__stage' });
  logo.append(stage);
  p.append(logo);
  if (animate) commit((s) => { s.loginShownDate = s.dailyBonusDate; });

  // 読み込むまでのあいだは、色の無いロゴを出しておく
  const placeholder = el('img', { class: 'loginbonus__gray', attrs: { src: './assets/frames/web/logo.webp', alt: '', decoding: 'async' } });
  placeholder.addEventListener('error', () => { placeholder.src = './assets/frames/logo.png'; }, { once: true });
  stage.append(placeholder);

  loadLogoPixels().then((d) => {
    const base = el('canvas', { class: 'loginbonus__canvas' });
    const newLetter = animate && shown > before ? shown : 0;
    // 下地：色を付ける文字は元の色、ほかは色の無い姿。今日の文字は演出で現すので、下地では色を付けない
    paintLogo(base, d, (L) => (L === 0 ? 'gray' : (L <= (newLetter ? before : shown) ? 'color' : 'gray')));
    stage.append(base);
    placeholder.remove();
    if (!newLetter) return;

    // 今日の文字：光りながらポンと現れる
    const pop = el('canvas', { class: 'loginbonus__canvas loginbonus__pop' });
    paintLogo(pop, d, (L) => (L === newLetter ? 'color' : 'none'));
    const b = d.boxes[newLetter];
    const cx = ((b[0] + b[2]) / 2 / d.W) * 100;
    const cy = ((b[1] + b[3]) / 2 / d.H) * 100;
    pop.style.transformOrigin = `${cx}% ${cy}%`;
    stage.append(pop);
    const burst = el('div', { class: 'loginbonus__burst', style: { left: `${cx}%`, top: `${cy}%` } });
    for (let i = 0; i < 8; i += 1) {
      const a = (Math.PI * 2 * i) / 8;
      burst.append(el('i', { style: { '--dx': `${Math.cos(a) * 34}px`, '--dy': `${Math.sin(a) * 34}px` } }));
    }
    logo.append(burst);

    const finishLetter = () => {
      paintLogo(base, d, (L) => (L === 0 ? 'gray' : (L <= shown ? 'color' : 'gray')));
      pop.remove();
      burst.remove();
    };
    if (reduce) { finishLetter(); if (complete) celebrateLogin(p, logo, true); return; }
    setTimeout(() => {
      if (!p.isConnected) return;
      pop.classList.add('is-on');
      burst.classList.add('is-on');
      sfx.coin();
      vibrate(12);
    }, 450);
    setTimeout(() => {
      if (!p.isConnected) return;
      finishLetter();
      if (complete) celebrateLogin(p, logo, false);
    }, 450 + 950);
  }).catch(() => {
    // 区分け地図が無いときは、以前の見せ方（左から日数の割合ぶん色を付ける）
    const pct = (dd) => `${Math.max(0, Math.min(100, (dd / cycle) * 100))}%`;
    const color = el('img', { class: 'loginbonus__color', attrs: { src: './assets/frames/web/logo.webp', alt: '', decoding: 'async' } });
    color.addEventListener('error', () => { color.src = './assets/frames/logo.png'; }, { once: true });
    color.style.clipPath = `inset(0 calc(100% - ${pct(animate ? day - 1 : day)}) 0 0)`;
    stage.append(color);
    if (animate) {
      requestAnimationFrame(() => setTimeout(() => {
        color.classList.add('is-grow');
        color.style.clipPath = `inset(0 calc(100% - ${pct(day)}) 0 0)`;
      }, 350));
    }
  });

  p.append(el('div', { class: 'loginbonus__count' }, [
    el('b', { text: String(day) }),
    el('span', { text: ` / ${cycle} 日` }),
  ]));

  // 1〜15日の目盛り。ロゴの文字を並べ、ごほうびの日には +コイン を添える
  const track = el('div', { class: 'loginbonus__track', style: { gridTemplateColumns: `repeat(${cycle}, 1fr)` } });
  for (let d = 1; d <= cycle; d += 1) {
    const reward = bonus[d];
    const on = d < day || (d === day && !(animate && !reduce));
    const letter = cycle === total ? LOGO_LETTERS[d - 1] : '';
    const dot = el('div', {
      class: `loginbonus__dot${on ? ' is-on' : ''}${reward ? ' is-reward' : ''}${d === day && animate && !reduce ? ' is-today' : ''}`,
      text: letter,
    });
    if (reward) dot.append(el('span', { class: 'loginbonus__plus', text: `+${reward}` }));
    track.append(dot);
  }
  p.append(track);
  // 今日の目盛りは、文字が現れるのに合わせて色を付ける
  if (animate && !reduce) {
    setTimeout(() => {
      const t = track.querySelector('.is-today');
      if (t) t.classList.add('is-on');
    }, 450 + 250);
  }

  let note;
  if (complete) note = `${cycle}日達成！ 明日からまた1日目です`;
  else if (next) note = `あと ${next - day} 日で +${nextCoins} SHIKA COIN（${next}日目）`;
  else note = '';
  p.append(el('p', { class: 'loginbonus__note', text: note }));
  p.append(el('p', { class: 'loginbonus__sub', text: `毎日 +${daily}。ログインした日を数えます（続けてでなくてもOK）` }));
  return p;
}

/* 15日目を受け取ったときの演出。
   ロゴがぐっと縮んでから弾んで跳ね、後ろに金色の光が広がり、ロゴの上を光の筋が走り、キラキラが飛び散る。
   最後に「15日コンプリート！」が弾んで出る。動きを減らす設定の端末では、文字だけ出す。 */
function celebrateLogin(panel, logo, still) {
  const { cycle } = loginInfo();
  panel.classList.add('is-celebrate');
  const badge = el('div', { class: 'loginbonus__complete', text: `${cycle}日コンプリート！` });
  panel.insertBefore(badge, logo.nextSibling);
  if (still) return;

  const glow = el('div', { class: 'loginbonus__glow' });
  const shine = el('div', { class: 'loginbonus__shine' });
  logo.prepend(glow);
  logo.append(shine);
  const sparks = el('div', { class: 'loginbonus__sparks' });
  const colors = ['#ffd54a', '#ffb300', '#fff3b0', '#4fc3f7', '#ff8a65'];
  for (let i = 0; i < 22; i += 1) {
    const a = (Math.PI * 2 * i) / 22 + (i % 2 ? 0.12 : -0.08);
    const r = 90 + (i % 3) * 34;
    sparks.append(el('i', {
      style: {
        '--dx': `${Math.cos(a) * r}px`, '--dy': `${Math.sin(a) * r * 0.72}px`,
        '--c': colors[i % colors.length], '--d': `${(i % 5) * 40}ms`, '--s': `${6 + (i % 3) * 3}px`,
      },
    }));
  }
  logo.append(sparks);
  sfx.coin();
  setTimeout(() => sfx.coin(), 380);
  vibrate([20, 40, 20, 40, 60]);
  // 終わったら飾りを片付ける（ロゴとバッジは残す）
  setTimeout(() => {
    glow.classList.add('is-rest');
    sparks.remove();
    shine.remove();
  }, 2600);
}

/* ===== 志賀町ファンクラブ ===== */

/** ファンクラブのミッションを押したときの説明 */
function openFanclubHelp(view) {
  const joined = isFanclubMember();
  const body = el('div', { class: 'fanclubhelp' });
  body.append(el('p', { text: 'LINE の「志賀町ファンクラブ」のページを開き、受信設定フォームから志賀町ファンクラブに登録してください。' }));
  body.append(el('ol', { class: 'fanclubhelp__steps' }, [
    el('li', { text: '下の「ファンクラブに登録」を押す（LINE が開きます）' }),
    el('li', { text: 'LINE で友だち追加をする' }),
    el('li', { text: '受信設定フォームで「志賀町ファンクラブ」を選んで登録する' }),
  ]));
  body.append(el('p', { class: 'fanclubhelp__note', text: `「ファンクラブに登録」を押すと、このミッションの達成になります（+${cfg().fanclub} SHIKA COIN）。称号「${FANCLUB_TITLE}」も獲得できます。` }));
  if (joined) body.append(el('p', { class: 'fanclubhelp__done', text: '登録ボタンは押してあります。ミッションの報酬を受け取れます。' }));
  body.append(fanclubButton({
    label: joined ? 'ファンクラブのページを開く' : 'ファンクラブに登録（LINE が開きます）',
    cls: 'btn btn--primary btn--block fanclub__btn',
    onJoined: (first) => {
      const b = [...document.querySelectorAll('#overlay .dialog__acts .btn')].find((x) => x.textContent === '閉じる');
      if (b) b.click();
      if (first) afterJoin(view);
    },
  }));
  dialog({ title: '志賀町ファンクラブ会員になる', body: [body], actions: [{ label: '閉じる', value: null }] });
}

function afterJoin(view) {
  toast(`ファンクラブに登録しました！ 称号「${FANCLUB_TITLE}」を獲得。ミッションの報酬を受け取れます`, 4200);
  if (view.isConnected) renderMissions(view);
  // LINE から戻ってきたら、称号「志賀町ファンクラブ」の獲得演出を出す
  setTimeout(maybeCelebrateTitles, 600);
}

/* 志賀町と日本酒の歴史（ミッション「志賀町と日本酒の歴史を読む」）。
   「読む」を押すと説明が出て、その時点で達成にする（flags.sakeHistoryRead）。
   文章は町からの提供文をそのまま載せる。 */
const SAKE_HISTORY = [
  '酒の醸造戸数は四戸で、高浜の「新酒屋」岡部弥平（鶴の友・金山・巴正宗・奉天）が四百四十六石、堀松の加茂野八郎（浅）が百九十四石、上棚の辻口政頼（萬歳）が百二十五石、岩田の泉庄助（岩泉）が百四石を造っていた。現存する酒蔵は残念ながらない。',
  '大正から昭和初期ごろの志賀町・外浦地域で酒粕や甘酒、こんかいわしなどを使った発酵・保存食を土鍋で煮て食べる冬の食文化が根付いていたことが、『日本の食生活全集17 聞き書 石川の食事』で記録されている。',
];

/** 「読む」を押したとき。説明を出して、ミッションを達成にする */
function openSakeHistory(view) {
  const first = !app.state.flags.sakeHistoryRead;
  if (first) commit((s) => { s.flags.sakeHistoryRead = true; });
  const body = el('div', { class: 'sakehist' });
  body.append(el('h4', { class: 'sakehist__h', text: '志賀町の歴史' }));
  for (const t of SAKE_HISTORY) body.append(el('p', { class: 'sakehist__p', text: t }));
  if (first && saveOk()) {
    body.append(el('p', { class: 'sakehist__done', text: `読んでいただきありがとうございます。ミッション達成です（+${cfg().sake} SHIKA COIN）。閉じたあと「受け取る」を押してください。` }));
  }
  dialog({ title: '志賀町と日本酒の歴史', body: [body], actions: [{ label: '閉じる', value: null, primary: true }] })
    .then(() => { if (first && view.isConnected) renderMissions(view); });
}

/** ミッションの下に置く、「読む」ボタンのまとまり */
function sakePanel(view) {
  const read = !!app.state.flags.sakeHistoryRead;
  const p = el('div', { class: 'fanclub' });
  // 説明文は置かない（ミッションの行と同じ内容になるため。v1.49.3）
  p.append(el('p', { class: 'fanclub__text', text: read ? '何度でも読めます。' : '読むとミッション達成になります。' }));
  p.append(el('button', {
    class: 'btn btn--primary btn--block', attrs: { type: 'button' },
    text: read ? 'もう一度読む' : '読む',
    on: { click: () => openSakeHistory(view) },
  }));
  return p;
}

/** ミッションの下に置く、登録ボタンのまとまり */
function fanclubPanel(view) {
  const joined = isFanclubMember();
  const p = el('div', { class: 'fanclub' });
  p.append(el('p', {
    class: 'fanclub__text',
    text: joined
      ? '登録ボタンは押してあります。LINE の受信設定フォームから、志賀町ファンクラブへの登録をお忘れなく。'
      : 'LINE の受信設定フォームから志賀町ファンクラブに登録すると、ミッション達成と称号「志賀町ファンクラブ」をもらえます。',
  }));
  p.append(fanclubButton({
    label: joined ? 'ファンクラブのページを開く' : 'ファンクラブに登録',
    onJoined: (first) => { if (first) afterJoin(view); },
  }));
  return p;
}

function row(m, view) {
  const r = el('div', { class: `missionrow${m.claimed ? ' is-claimed' : ''}${m.done && !m.claimed ? ' is-ready' : ''}` });
  if (m.id === 'fanclub' || m.id === 'sake') {
    // 押すと説明が出る（ファンクラブは登録の手順、日本酒の歴史は本文。受け取るボタンはそのまま）
    const open = () => (m.id === 'fanclub' ? openFanclubHelp(view) : openSakeHistory(view));
    r.classList.add('is-tap');
    r.setAttribute('role', 'button');
    r.setAttribute('tabindex', '0');
    r.addEventListener('click', (e) => { if (!e.target.closest('button, a')) open(); });
    r.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === r) { e.preventDefault(); open(); } });
  }

  const body = el('div', { class: 'missionrow__b' });
  body.append(el('div', { class: 'missionrow__n', text: m.label }));
  const pct = m.need ? Math.min(100, (m.owned / m.need) * 100) : 0;
  body.append(el('div', { class: 'bar' }, [el('span', { style: { width: `${pct}%` } })]));
  const d = el('div', { class: 'missionrow__d' });
  if (m.claimed || m.done) {
    d.append(el('span', { text: m.claimed ? '受け取り済み ／ ' : '達成 ／ ' }));
    d.append(coinIcon());
    d.append(el('span', { text: `+${m.coins} SHIKA COIN` }));
  } else if (m.id === 'fanclub') {
    d.append(el('span', { text: '受信設定フォームから登録 ／ タップで説明' }));
  } else {
    d.append(el('span', { text: `${m.owned} / ${m.need} ／ あと ${m.need - m.owned}` }));
  }
  body.append(d);
  r.append(body);

  if (m.claimed) {
    r.append(el('span', { class: 'missionrow__ok', text: '✓' }));
  } else if (m.done) {
    r.append(el('button', {
      class: 'btn btn--primary missionrow__go', attrs: { type: 'button' }, text: '受け取る',
      on: {
        click: (e) => {
          unlock();
          const from = e.currentTarget.getBoundingClientRect();   // ここからコインが飛び立つ
          holdCoins();
          const got = claim(m.id);
          if (!got) { releaseCoins(); return; }
          sfx.coin(); vibrate(12);
          toast(`+${got} SHIKA COIN`);
          flyCoins(from, got);
          renderMissions(view);
        },
      },
    }));
  } else {
    r.append(el('span', { class: 'missionrow__coin' }, [
      coinIcon(), el('b', { text: `+${m.coins}` }),
    ]));
  }
  return r;
}
