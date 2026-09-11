/* gacha-anim.js — ガチャの演出。
   円舞（傾いた楕円をカード裏面が回る）→ 三分（3つの束に寄る）→ 合一（渦を巻いて중心へ）
   → 抜刀（1枚が抜けて翻り表になる）の4拍。全4800ms。

   演出は「すでに確定した結果」を見せるだけ。抽選・保存は gacha.js 側で先に終わっている。
   毎フレーム transform を書き換える方式（rAF）。軌道計算が要るのでキーフレームでは組めない。 */

import { el, clear } from './dom.js';
import { cardBack, vibrate, reduceMotion } from './ui.js';
import { sfx } from './sound.js';

/* 拍の境界。ここ以外に時間を書かない */
const T = { sink: 400, ring: 1700, split: 2400, merge: 3120, face: 3520, land: 3760, ui: 4000, end: 4800 };
const POP = [2020, 2180, 2340];          // 三分の3拍
const CARDS = 9, PER = 3;                // 3枚 × 3束

/* ジャンルごとの光の色と粒子の性格 */
const FX = {
  gourmet: { color: '#E8873A', mode: 'ember' },   // 火の粉。明滅しながら上がる
  spot:    { color: '#4FB6D8', mode: 'drop' },    // 水滴。まっすぐ落ちる
  culture: { color: '#A97BD8', mode: 'fly' },     // 蛍火。ゆらぎながら漂う
};
const GENRES = ['gourmet', 'spot', 'culture'];

/* ===== 補間 ===== */
const lerp = (a, b, x) => a + (b - a) * x;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const outBack = (x) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);
const outQuint = (x) => 1 - Math.pow(1 - x, 5);
const outCubic = (x) => 1 - Math.pow(1 - x, 3);
const inQuart = (x) => x * x * x * x;
const inOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** [時刻, 値, イージング] の列を1つの関数として評価する */
function track(tt, pts) {
  if (tt <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (tt <= pts[i][0]) {
      const [t0, v0] = pts[i - 1];
      const [t1, v1, ez] = pts[i];
      const x = (tt - t0) / (t1 - t0 || 1);
      return lerp(v0, v1, ez ? ez(x) : x);
    }
  }
  return pts[pts.length - 1][1];
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/**
 * 演出の舞台を1つ作る。10連では作り直さずに play() を繰り返す。
 * @param {HTMLElement} host 舞台を置く要素（.gachastage）
 */
export function createGachaStage(host) {
  const root = el('div', { class: 'gs' });
  const cam = el('div', { class: 'gs__cam' });
  const veil = el('div', { class: 'gs__veil' });
  const sigilA = el('div', { class: 'gs__sigil', html: sigilSvg('dots') });
  const sigilB = el('div', { class: 'gs__sigil gs__sigil--b', html: sigilSvg('ticks') });
  const canvas = el('canvas', { class: 'gs__fx' });
  const rays = el('div', { class: 'gs__rays', html: raysHtml() });
  const waves = [0, 1, 2].map(() => el('div', { class: 'gs__wave' }));
  const deck = el('div', { class: 'gs__deck' });
  const reveal = el('div', { class: 'gs__reveal' });
  const faceBack = el('div', { class: 'gs__face gs__face--back' });
  const faceFront = el('div', { class: 'gs__face gs__face--front' });
  const sheen = el('div', { class: 'gs__sheen' });
  const flash = el('div', { class: 'gs__flash' });

  faceBack.append(cardBack());
  faceFront.append(sheen);
  reveal.append(faceBack, faceFront);
  cam.append(veil, sigilA, sigilB, canvas, rays, ...waves, deck, reveal, flash);
  root.append(cam);
  host.append(root);

  /* 9枚の裏面 */
  const orbs = [];
  for (let i = 0; i < CARDS; i++) {
    const node = el('div', { class: 'gs__orb' });
    const tint = el('i');
    node.append(cardBack(), tint);
    deck.append(node);
    orbs.push({
      node, tint,
      u: i / CARDS,                       // 楕円上の初期位置（等弧長）
      cl: Math.floor(i / PER),            // どの束か
      k: i % PER,
      sp: 0.9 + ((i * 37) % 11) / 11 * 1.5,
      ph: ((i * 53) % 100) / 100 * 6.283,
      px: 0, py: 0, cx: undefined, cy: undefined, sc: 1, al: 0,
    });
  }

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0, H = 0;
  let particles = [];
  let ambient = [];
  let arc = null;

  function resize() {
    const r = host.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildAmbient();
    arc = null;
  }
  function buildAmbient() {
    ambient = [];
    for (let i = 0; i < 26; i++) {
      ambient.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 1.5 + Math.random() * 4.2, ph: Math.random() * 6.283,
        sp: 0.0007 + Math.random() * 0.0016,
        dy: -(0.006 + Math.random() * 0.02),
        col: Math.random() < 0.7 ? '#C6982E' : '#8FC3DE',
      });
    }
  }
  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  /* 楕円を等弧長で分ける（角度等分だと端で詰まって2枚が1組に見える） */
  function buildArc(Rx, Ry) {
    const M = 720, cum = new Float64Array(M + 1), st = 6.283185 / M;
    let acc = 0;
    for (let i = 1; i <= M; i++) {
      const th = (i - 0.5) * st, si = Math.sin(th), co = Math.cos(th);
      acc += Math.sqrt(Rx * Rx * si * si + Ry * Ry * co * co) * st;
      cum[i] = acc;
    }
    arc = { cum, total: acc, M, rx: Rx, ry: Ry };
  }
  function thetaAt(u) {
    u -= Math.floor(u);
    const target = u * arc.total;
    let lo = 0, hi = arc.M;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arc.cum[mid] < target) lo = mid + 1; else hi = mid; }
    return (lo / arc.M) * 6.283185;
  }

  /* 舞台は画面全体。3つの束が上半分に固まらないよう、縦に大きく開く。
     この 0.50 は css/animations.css の `top:50%`（カード・紋・光）と同じ値。
     片方だけ変えると中心がずれる。 */
  const cx = () => W / 2;
  const cy = () => H * 0.50;
  const anchors = () => [
    { x: 0, y: -H * 0.33 },               // 上：グルメ
    { x: -W * 0.255, y: H * 0.225 },      // 左下：スポット
    { x: W * 0.255, y: H * 0.225 },       // 右下：文化
  ];
  const turn = (tt) => track(tt, [[T.sink, 0], [T.ring, 6.283 * 1.2, outCubic], [T.split, 6.283 * 1.55, inOut]]);

  /* ===== 粒子 ===== */
  function spawnBurst(n, mode) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, sp = 1.6 + Math.random() * 7.5;
      particles.push({
        x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        s: 0.9 + Math.random() * 2.3, life: 1,
        decay: 0.006 + Math.random() * 0.012, mode, ph: Math.random() * 6.283, col: null,
      });
    }
  }
  function spawnPop(n, col) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, sp = 0.7 + Math.random() * 2.6;
      particles.push({
        x: 0, y: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        s: 0.7 + Math.random() * 1.5, life: 1,
        decay: 0.014 + Math.random() * 0.014, mode: 'pop', ph: 0, col,
      });
    }
  }
  function spawnDust(n) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: Math.random() * W - W / 2, y: -H * 0.5 - Math.random() * H * 0.3,
        vx: (Math.random() - 0.5) * 0.3, vy: 0.25 + Math.random() * 0.5,
        s: 0.7 + Math.random() * 1.3, life: 1, decay: 0.0016,
        mode: 'dust', ph: Math.random() * 6.283, col: '#C6982E',
      });
    }
  }

  function star(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
  }

  function drawFx(dt, trailAlpha, color, running) {
    ctx.clearRect(0, 0, W, H);
    // 常時ただよう金の粒
    const ax = W / 2, ay = H * 0.50, rad = Math.min(W, H) * 0.42, boost = running ? 1.3 : 1;
    for (const a of ambient) {
      a.ph += a.sp * dt; a.y += a.dy * dt;
      if (a.y < -10) { a.y = H + 10; a.x = Math.random() * W; }
      const tw = 0.5 + 0.5 * Math.sin(a.ph);
      const dd = Math.min(1, Math.hypot(a.x - ax, a.y - ay) / rad);
      ctx.globalAlpha = Math.min(1, (0.08 + 0.4 * tw) * (0.3 + 0.7 * dd) * boost);
      ctx.fillStyle = a.col;
      star(a.x, a.y, a.r * (0.66 + 0.5 * tw));
    }
    ctx.globalAlpha = 1;

    const px = cx(), py = cy();
    if (trailAlpha > 0.01) {
      ctx.lineCap = 'round';
      for (const o of orbs) {
        if (o.cx === undefined || (o.px === 0 && o.py === 0)) continue;
        ctx.strokeStyle = color;
        ctx.globalAlpha = trailAlpha * o.al * 0.5;
        ctx.lineWidth = 2.4 * o.sc;
        ctx.beginPath();
        ctx.moveTo(px + o.px, py + o.py);
        ctx.lineTo(px + o.cx, py + o.cy);
        ctx.stroke();
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.mode === 'dust') {
        p.ph += 0.03 * dt / 16;
        p.x += p.vx * dt / 16 + Math.sin(p.ph) * 0.24;
        p.y += p.vy * dt / 16;
        p.life -= p.decay * dt / 16;
      } else {
        const drag = p.mode === 'ember' ? 0.945 : p.mode === 'drop' ? 0.972 : p.mode === 'pop' ? 0.9 : 0.918;
        p.vx *= Math.pow(drag, dt / 16);
        p.vy *= Math.pow(drag, dt / 16);
        if (p.mode === 'ember') p.vy -= 0.045 * dt / 16;
        if (p.mode === 'drop') p.vy += 0.055 * dt / 16;
        if (p.mode === 'fly') { p.ph += 0.06 * dt / 16; p.vx += Math.cos(p.ph) * 0.05; p.vy += Math.sin(p.ph * 1.3) * 0.05; }
        p.x += p.vx * dt / 16; p.y += p.vy * dt / 16;
        p.life -= p.decay * dt / 16;
      }
      if (p.life <= 0 || p.y > H) { particles.splice(i, 1); continue; }
      let al = p.life;
      if (p.mode === 'fly') al *= 0.55 + 0.45 * Math.sin(p.ph * 2);
      ctx.globalAlpha = clamp01(al);
      ctx.fillStyle = p.col || color;
      ctx.beginPath();
      ctx.arc(px + p.x, py + p.y, p.s, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ===== 1フレーム分の配置 ===== */
  function render(tt, color) {
    const Rx = W * 0.43, Ry = H * 0.30;
    if (!arc || arc.rx !== Rx || arc.ry !== Ry) buildArc(Rx, Ry);
    const AN = anchors();
    const vortex = track(tt, [[T.split, 0], [T.merge, 200 * Math.PI / 180, inQuart]]);
    const mrg = track(tt, [[T.split, 0], [T.merge, 1, inQuart]]);
    const sinkT = track(tt, [[0, 0], [T.sink * 0.6, 1, outCubic], [T.sink, 0.55, outCubic]]);
    const th0 = turn(tt);

    for (let c = 0; c < orbs.length; c++) {
      const o = orbs[c], stag = c * 30;
      const th = thetaAt(o.u + th0 / 6.283185);
      const d = (Math.sin(th) + 1) / 2;                    // 0=奥 1=手前
      const rx = Math.cos(th) * Rx, ry = Math.sin(th) * Ry;
      const rs = 0.66 + 0.36 * d, ra = 0.54 + 0.46 * d;

      const out = track(tt, [[T.sink + stag * 0.4, 0], [T.sink + 400 + stag, 1, outBack]]);
      const k = track(tt, [[T.ring + o.k * 26, 0], [POP[o.cl], 1, outBack]]);
      const an = AN[o.cl];
      const ax2 = an.x * Math.cos(vortex) - an.y * Math.sin(vortex);
      const ay2 = an.x * Math.sin(vortex) + an.y * Math.cos(vortex);
      const gx = lerp(rx * out, ax2, k), gy = lerp(ry * out, ay2, k);
      const gs = lerp(lerp(3.05, rs, out), 1.15, k), ga = lerp(lerp(0.9, ra, out), 1, k);

      const X = lerp(gx, 0, mrg);
      const Y = lerp(gy, 0, mrg) + (1 - out) * sinkT * 12;
      const S = lerp(gs, 1.05, mrg) * (1 - (1 - out) * 0.1 * sinkT);
      const A = ga * (1 - track(tt, [[T.merge - 70, 0], [T.merge, 1]]));

      const spin = (o.ph + tt * 0.0009 * o.sp) * (1 - k * 0.9);
      const ry2 = (1 - k) * out * Math.sin(spin) * 24;
      const rz = lerp(0, -vortex * 30, mrg);

      o.px = o.cx === undefined ? X : o.cx;
      o.py = o.cy === undefined ? Y : o.cy;
      o.cx = X; o.cy = Y; o.sc = S; o.al = A;

      o.node.style.transform =
        `translate(-50%,-50%) translate(${X.toFixed(1)}px,${Y.toFixed(1)}px) rotateZ(${rz.toFixed(1)}deg) rotateY(${ry2.toFixed(1)}deg) scale(${S.toFixed(3)})`;
      o.node.style.opacity = A.toFixed(3);
      o.node.style.zIndex = String(Math.round(d * 100));
      const cc = FX[GENRES[o.cl]].color;
      o.tint.style.background = cc;
      o.tint.style.opacity = (k * 0.5).toFixed(3);
      o.node.style.boxShadow = k > 0.02
        ? `0 0 ${(10 + k * 34).toFixed(0)}px ${(k * 10).toFixed(0)}px ${rgba(cc, k * 0.55)}`
        : 'none';
    }

    // カメラ（寄りと着弾の揺れ）
    const cs = track(tt, [[0, 1], [T.ring, 1.0], [T.split, 1.04, outCubic], [T.merge - 1, 1.09, inQuart],
      [T.merge, 0.96], [T.merge + 45, 0.99], [T.merge + 90, 1.01], [T.merge + 190, 1, outQuint]]);
    const inHit = tt > T.merge && tt < T.merge + 110;
    const shx = inHit ? Math.sin((tt - T.merge) * 0.36) * 7 * (1 - (tt - T.merge) / 110) : 0;
    const shy = inHit ? Math.cos((tt - T.merge) * 0.42) * 6 * (1 - (tt - T.merge) / 110) : 0;
    cam.style.transform = `scale(${cs.toFixed(3)}) translate(${shx.toFixed(1)}px,${shy.toFixed(1)}px)`;

    veil.style.opacity = track(tt, [[0, 0], [T.ring, 0.9, outCubic], [T.merge, 1], [T.land, 1], [T.end, 0.72]]).toFixed(3);
    flash.style.opacity = track(tt, [[T.merge - 6, 0], [T.merge, 0.88], [T.merge + 210, 0, outCubic]]).toFixed(3);
    rays.style.opacity = track(tt, [[T.merge, 0.9], [T.merge + 330, 0, outCubic]]).toFixed(3);
    rays.style.transform = `scale(${track(tt, [[T.merge, 0], [T.merge + 330, 1.55, outQuint]]).toFixed(3)})`;

    for (let w = 0; w < 3; w++) {
      const d0 = T.merge + w * 60, node = waves[w];
      node.style.color = FX[GENRES[w]].color;
      node.style.opacity = track(tt, [[d0, 0.95], [d0 + 520, 0, outCubic]]).toFixed(3);
      node.style.transform = `translate(-50%,-50%) scale(${track(tt, [[d0, 0.1], [d0 + 520, 3.2 + w * 0.35, outQuint]]).toFixed(3)})`;
    }

    // 抜刀
    reveal.style.opacity = track(tt, [[T.merge, 0], [T.merge + 30, 1]]).toFixed(3);
    const rsc = track(tt, [[T.merge, 0.14], [T.merge + 230, 0.8, outQuint], [T.face, 1.03, outCubic], [T.land, 1, outQuint]]);
    const rty = track(tt, [[T.merge, 0], [T.merge + 230, -14, outQuint], [T.land, 0, outQuint]]);
    const flip = track(tt, [[T.merge, 0], [T.merge + 200, 300, outQuint], [T.face, 450, outCubic], [T.land, 540, outQuint]]);
    reveal.style.transform =
      `translate(-50%,-50%) translateY(${rty.toFixed(1)}px) scale(${rsc.toFixed(3)}) rotateY(${flip.toFixed(1)}deg)`;
    // 左から右へ0.7秒。カード一覧・3Dビューアの光と同じ速さにそろえてある
    sheen.style.opacity = track(tt, [[T.land, 0], [T.land + 90, 0.9], [T.land + 640, 0.9], [T.land + 700, 0]]).toFixed(3);
    sheen.style.transform = `translateX(${track(tt, [[T.land, -170], [T.land + 700, 170]]).toFixed(1)}%)`;

    root.style.setProperty('--gs-accent', color);
  }

  /* ===== 再生 ===== */
  let raf = 0, last = 0, running = false;
  let t = 0, speed = 1, endT = T.end, color = FX.gourmet.color, mode = 'ember';
  let fired = {};
  let onBeat = null;
  let resolveDone = null;
  let destroyed = false;

  function loop(now) {
    if (destroyed) return;
    const raw = Math.min(48, now - last);
    last = now;
    let trail = 0;
    if (running) {
      t += raw * speed;
      const tt = Math.min(t, endT);
      render(tt, color);
      trail = track(t, [[T.ring - 300, 0], [T.ring, 0.55], [T.merge - 60, 0.85], [T.merge, 0]]);
      for (let i = 0; i < 3; i++) {
        if (!fired['p' + i] && t >= POP[i]) {
          fired['p' + i] = 1;
          spawnPop(30, FX[GENRES[i]].color);
          vibrate(9);
          sfx.tap();
        }
      }
      if (!fired.hit && t >= T.merge) {
        fired.hit = 1;
        spawnBurst(96, mode);
        vibrate(30);
        if (onBeat) onBeat('impact');
      }
      if (!fired.face && t >= T.face) { fired.face = 1; sfx.flip(); }
      if (!fired.dust && t >= T.land) { fired.dust = 1; spawnDust(40); }
      if (!fired.ui && t >= T.ui) { fired.ui = 1; if (onBeat) onBeat('name'); }
      if (t >= endT) {
        running = false;
        if (resolveDone) { const r = resolveDone; resolveDone = null; r(); }
      }
    }
    drawFx(running ? raw * speed : raw, trail, color, running);
    raf = requestAnimationFrame(loop);
  }

  resize();
  render(0, color);
  last = performance.now();
  raf = requestAnimationFrame(loop);

  return {
    /**
     * 1枚分の演出を再生する。
     * @param {HTMLElement} faceNode 表面に載せるカード（組み立て済み）
     * @param {{category?:string, quick?:boolean, onBeat?:function}} opts
     */
    play(faceNode, { category = 'gourmet', quick = false, hold = true, onBeat: beat = null } = {}) {
      const fx = FX[category] || FX.gourmet;
      color = fx.color; mode = fx.mode; onBeat = beat;
      clear(faceFront);
      faceFront.append(sheen, faceNode);
      particles = [];
      fired = {};
      for (const o of orbs) { o.cx = undefined; o.cy = undefined; o.px = 0; o.py = 0; }
      resize();

      if (reduceMotion()) {           // 動きを減らす設定では最終状態だけ見せる
        t = T.end; speed = 1; endT = T.end; running = false;
        render(T.end, color);
        if (beat) { beat('impact'); beat('name'); }
        return Promise.resolve();
      }
      // 2枚目以降は円舞と三分を省き、合一の直前から始める。余韻も待たない。
      t = quick ? T.split - 200 : 0;
      speed = quick ? 1.2 : 1;   // 2枚目以降も速すぎない程度に
      endT = hold ? T.end : T.ui + 500;   // 光（T.land+700）が途中で切れない長さ
      if (quick) { fired.p0 = fired.p1 = fired.p2 = 1; }
      running = true;
      last = performance.now();
      vibrate(12);
      return new Promise((resolve) => { resolveDone = resolve; });
    },
    /** 残りを飛ばして最終状態へ */
    skip() {
      if (!running) return;
      t = endT = T.end;
      render(T.end, color);
      running = false;
      if (onBeat) { if (!fired.hit) onBeat('impact'); if (!fired.ui) onBeat('name'); }
      fired.hit = fired.ui = 1;
      if (resolveDone) { const r = resolveDone; resolveDone = null; r(); }
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      root.remove();
    },
  };
}

/* ===== 背景の紋（青海波の魔法陣） ===== */
function sigilSvg(kind) {
  if (kind === 'dots') {
    let s = '';
    for (let q = 0; q < 26; q++) {
      const a = (q / 26) * 6.283;
      s += `<circle cx="${(100 + Math.cos(a) * 76).toFixed(1)}" cy="${(100 + Math.sin(a) * 76).toFixed(1)}" r="8"/>`;
    }
    return `<svg viewBox="0 0 200 200" aria-hidden="true">
      <g fill="none" stroke="#C6982E" stroke-width=".7">
        <circle cx="100" cy="100" r="96"/><circle cx="100" cy="100" r="88"/><circle cx="100" cy="100" r="58"/>
      </g><g fill="none" stroke="#C6982E" stroke-width=".5">${s}</g></svg>`;
  }
  let s = '';
  for (let q = 0; q < 48; q++) {
    const a = (q / 48) * 6.283, L = q % 4 === 0 ? 13 : 5;
    s += `<path d="M${(100 + Math.cos(a) * 92).toFixed(1)} ${(100 + Math.sin(a) * 92).toFixed(1)}L${(100 + Math.cos(a) * (92 - L)).toFixed(1)} ${(100 + Math.sin(a) * (92 - L)).toFixed(1)}"/>`;
  }
  return `<svg viewBox="0 0 200 200" aria-hidden="true"><g fill="none" stroke="#C6982E" stroke-width=".7">${s}</g></svg>`;
}

function raysHtml() {
  let s = '';
  for (let i = 0; i < 20; i++) s += `<div class="gs__ray" style="transform:rotate(${i * 18}deg)"></div>`;
  return s;
}
