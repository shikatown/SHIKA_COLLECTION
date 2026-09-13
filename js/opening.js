/* opening.js — 明るい増穂浦からカードコレクションへ移る起動演出。
   中央は既存のカード裏面、周囲は既存の cardFace をそのまま使う。 */

import { app, commit } from './state.js';
import { el, clear } from './dom.js';
import { cardBack, cardFace, reduceMotion, resolveAsset } from './ui.js';
import { photoUrl, thumbUrl } from './card-render.js';
import { isUnlocked as isAudioUnlocked, sfx, unlock } from './sound.js';

const SHORE_IMAGE = './assets/photos/035.jpeg';
const SHORE_THUMB = './assets/photos/thumb/035.jpg';
const LOGO_IMAGE = './assets/frames/logo.png';
const LOGO_THUMB = './assets/frames/thumb/logo.png';
const CARD_BACK_IMAGE = './assets/cards/_back.png';

// 画像パスではなくカードIDだけを持つ。実際の面は常に cards.json と既存描画関数から作る。
// 欠番・非公開化があっても、下の selectFeaturedCards() が公開カードで補う。
const PREFERRED_CARD_IDS = ['001', '003', '024', '035', '036', '038', '049', '053', '050'];

const MODE_TIMES = {
  full: { skip: 2000, sound: 1200, title: 9300 },
  short: { skip: 1800, sound: 1500, title: 4050 },
  reduced: { skip: 900, sound: 900, title: 2700 },
};

/**
 * 起動画面を組み立てる。prepareCritical() とカードデータ読み込みを並行させ、
 * 準備が遅いときは呼び出し側が short を選べるようにしてある。
 */
export function createOpening() {
  const boot = document.getElementById('boot');
  const viewport = document.getElementById('bootStage');
  const skipButton = document.getElementById('bootSkip');
  const soundButton = document.getElementById('bootSound');

  clear(viewport);
  boot.className = 'boot opening opening--loading';
  boot.removeAttribute('aria-hidden');
  skipButton.hidden = true;
  soundButton.hidden = true;

  const nodes = buildOpening(viewport);
  const forcedMode = readForcedMode();
  const lite = isLowPowerDevice();
  const timers = new Set();
  const cleanups = [];
  let rafId = 0;
  let started = false;
  let finished = false;
  let cardsReady = false;
  let titleReady = false;
  let pendingExit = false;
  let mode = 'short';
  let selectedCards = [];
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const critical = Promise.all([
    preloadImage(SHORE_THUMB, 1800),
    preloadImage(LOGO_THUMB, 1800),
    preloadImage(CARD_BACK_IMAGE, 1800),
  ]).then((values) => values.every(Boolean));
  // 原寸は待たずに読み始める。19秒の演出中に自然に高精細へ切り替わる。
  preloadImage(SHORE_IMAGE, 6000);
  preloadImage(LOGO_IMAGE, 6000).then((ready) => {
    if (ready && !finished) nodes.logo.src = LOGO_IMAGE;
  });

  function later(ms, fn) {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (!finished) fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function setCards(cards) {
    selectedCards = selectFeaturedCards(cards);
    if (selectedCards.length) {
      fillFan(nodes.fan, selectedCards.slice(1));
      preloadFeaturedCards(selectedCards);
    }
    cardsReady = true;
    updateStartButton();
    if (pendingExit) finish();
  }

  function start(requestedMode) {
    if (started) return done;
    started = true;
    mode = normalizeMode(forcedMode || requestedMode);
    boot.className = `boot opening opening--${mode}${lite ? ' opening--lite' : ''}`;
    updateSoundButton();

    // 1フレーム置くことで、初期状態からのCSSアニメーションを確実に開始する。
    rafId = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => boot.classList.add('is-running'));
    });

    const timing = MODE_TIMES[mode];
    later(timing.skip, () => { skipButton.hidden = false; });
    later(timing.sound, () => { soundButton.hidden = false; });
    later(timing.title, showTitle);
    scheduleSounds(mode, later);

    if (mode === 'full') {
      later(550, () => { cleanups.push(startParticles(nodes.canvas, lite)); });
    }
    return done;
  }

  function showTitle() {
    if (titleReady) return;
    titleReady = true;
    skipButton.hidden = true;
    boot.classList.add('is-title');
    nodes.title.setAttribute('aria-hidden', 'false');
    updateStartButton();
    markOpeningPlayed();
  }

  function requestExit() {
    if (finished) return;
    // はじめる／スキップはユーザー操作なので、以後の画面の効果音をここで解錠できる。
    unlock();
    markOpeningPlayed();
    if (!cardsReady) {
      pendingExit = true;
      boot.classList.add('is-title', 'is-waiting');
      nodes.title.setAttribute('aria-hidden', 'false');
      nodes.start.textContent = '読み込み中…';
      nodes.start.disabled = true;
      skipButton.hidden = true;
      return;
    }
    finish();
  }

  function finish() {
    if (finished) return;
    finished = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    if (rafId) cancelAnimationFrame(rafId);
    for (const fn of cleanups) fn();
    boot.classList.remove('is-waiting');
    boot.classList.add('is-out');
    window.setTimeout(() => resolveDone(), 430);
  }

  function cancel() {
    if (finished) return;
    finished = true;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    if (rafId) cancelAnimationFrame(rafId);
    for (const fn of cleanups) fn();
    resolveDone();
  }

  function updateStartButton() {
    const enabled = titleReady && cardsReady;
    nodes.start.disabled = !enabled;
    nodes.start.textContent = cardsReady ? 'スタート' : '読み込み中…';
    boot.classList.toggle('is-waiting', titleReady && !cardsReady);
  }

  function updateSoundButton() {
    const on = app.state.settings.sound === true;
    const needsUnlock = on && !isAudioUnlocked();
    soundButton.classList.toggle('is-on', on);
    soundButton.setAttribute('aria-pressed', String(on));
    soundButton.setAttribute('aria-label', needsUnlock ? '起動音を有効にする' : (on ? '起動音を消す' : '起動音をつける'));
    soundButton.querySelector('span').textContent = needsUnlock ? '音を有効にする' : (on ? '音あり' : '音なし');
  }

  function toggleSound(event) {
    event.stopPropagation();
    if (app.state.settings.sound && !isAudioUnlocked()) {
      unlock();
      sfx.openingWake();
      updateSoundButton();
      return;
    }
    const next = !app.state.settings.sound;
    commit((state) => { state.settings.sound = next; });
    if (next) {
      unlock();
      sfx.openingWake();
    }
    updateSoundButton();
  }

  skipButton.addEventListener('click', requestExit);
  soundButton.addEventListener('click', toggleSound);
  nodes.start.addEventListener('click', requestExit);
  cleanups.push(
    () => skipButton.removeEventListener('click', requestExit),
    () => soundButton.removeEventListener('click', toggleSound),
    () => nodes.start.removeEventListener('click', requestExit),
  );

  return {
    critical,
    done,
    forcedMode,
    preferredMode: reduceMotion() ? 'reduced' : (app.state.flags.openingPlayed ? 'short' : 'full'),
    setCards,
    start,
    cancel,
    get cardsReady() { return cardsReady; },
    get selectedCards() { return [...selectedCards]; },
  };
}

function buildOpening(viewport) {
  const shore = el('div', { class: 'opening__shore', attrs: { 'aria-hidden': 'true' } });
  const twilight = el('div', { class: 'opening__twilight', attrs: { 'aria-hidden': 'true' } });
  const vignette = el('div', { class: 'opening__vignette', attrs: { 'aria-hidden': 'true' } });
  const canvas = el('canvas', { class: 'opening__particles', attrs: { 'aria-hidden': 'true' } });

  // v1.29.2: スタート付近の桜貝の飾りは外した（ボタンまわりが見にくくなるため）

  // #001（甘えび）の主役位置には、提供済みのカード裏面を無加工で表示する。
  const featured = el('div', { class: 'opening__side opening__side--featured' }, [cardBack()]);
  const inner = el('div', { class: 'opening__hero-inner' }, [
    featured,
    el('div', { class: 'opening__card-sheen', attrs: { 'aria-hidden': 'true' } }),
  ]);
  const hero = el('div', { class: 'opening__hero-card' }, [inner]);
  const cardZone = el('div', { class: 'opening__card-zone', attrs: { 'aria-hidden': 'true' } }, [hero]);

  const fan = el('div', { class: 'opening__fan', attrs: { 'aria-hidden': 'true' } });
  const flash = el('div', { class: 'opening__flash', attrs: { 'aria-hidden': 'true' } });
  const start = el('button', {
    class: 'opening__start',
    text: '読み込み中…',
    attrs: { type: 'button', disabled: true },
  });
  const logo = el('img', {
    class: 'opening__logo',
    attrs: { src: LOGO_THUMB, alt: 'SHIKA COLLECTION', decoding: 'async' },
  });
  logo.addEventListener('error', () => {
    if (!logo.getAttribute('src').includes('/thumb/')) logo.src = LOGO_THUMB;
  });
  const title = el('div', { class: 'opening__title', attrs: { 'aria-hidden': 'true' } }, [
    logo,
    start,
  ]);

  viewport.append(
    shore, twilight, vignette, canvas, fan, cardZone, flash, title,
  );
  return { canvas, fan, logo, title, start };
}

function fillFan(fan, cards) {
  for (const node of [...fan.querySelectorAll('.opening__fan-card')]) node.remove();
  // 3–2–3の余白ある配置。回転後も周囲8枚同士が重ならず、画面を広く使う。
  const positions = [
    ['max(-170px,-34vw)', '-32dvh', '-4deg', '0deg', '-24px', 5],
    ['0px', '-32dvh', '0deg', '0deg', '-24px', 4],
    ['min(170px,34vw)', '-32dvh', '4deg', '0deg', '-24px', 5],
    ['max(-185px,-37vw)', '1dvh', '-3deg', '0deg', '-24px', 6],
    ['min(185px,37vw)', '1dvh', '3deg', '0deg', '-24px', 6],
    ['max(-170px,-34vw)', '34dvh', '4deg', '0deg', '-24px', 7],
    ['0px', '34dvh', '0deg', '0deg', '-24px', 8],
    ['min(170px,34vw)', '34dvh', '-4deg', '0deg', '-24px', 7],
  ];
  cards.slice(0, positions.length).forEach((card, index) => {
    const [x, y, rz, ry, z, layer] = positions[index];
    fan.append(el('div', {
      class: 'opening__fan-card',
      style: { '--x': x, '--y': y, '--rz': rz, '--ry': ry, '--z': z, '--i': layer },
    }, [cardFace(card, { small: true })]));
  });
}

function selectFeaturedCards(cards) {
  const published = (cards || []).filter((card) => card && card.published && card.category);
  const byId = new Map(published.map((card) => [String(card.id), card]));
  const picked = [];
  const seen = new Set();
  const add = (card) => {
    if (!card || seen.has(card.id)) return;
    seen.add(card.id);
    picked.push(card);
  };

  for (const id of PREFERRED_CARD_IDS) add(byId.get(id));
  // 代表IDが将来変わっても、3カテゴリが最低1枚ずつ残る。
  for (const category of ['gourmet', 'spot', 'culture']) {
    if (!picked.some((card) => card.category === category)) add(published.find((card) => card.category === category));
  }
  for (const card of published) {
    if (picked.length >= 7) break;
    add(card);
  }
  return picked.slice(0, 9);
}

function preloadFeaturedCards(cards) {
  const urls = new Set([LOGO_IMAGE, CARD_BACK_IMAGE]);
  cards.slice(1).forEach((card) => {
    if (card.cardImage) urls.add(resolveAsset(card.cardImage));
    else if (card.photo) urls.add(thumbUrl(card.photo) || photoUrl(card.photo));
    if (!card.cardImage && card.category) {
      const base = './assets/frames/thumb';
      urls.add(`${base}/${card.category}.png`);
      urls.add(`${base}/icon-${card.category}.png`);
    }
  });
  for (const url of urls) preloadImage(url, 7000);
}

function preloadImage(src, timeoutMs) {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(ok);
    };
    img.onload = async () => {
      try { if (img.decode) await img.decode(); } catch (_) { /* 読み込み済みなら表示できる */ }
      finish(true);
    };
    img.onerror = () => finish(false);
    img.src = src;
    if (img.complete && img.naturalWidth) finish(true);
  });
}

function normalizeMode(value) {
  return value === 'full' || value === 'reduced' ? value : 'short';
}

function readForcedMode() {
  const value = new URLSearchParams(location.search).get('opening');
  if (value === 'full' || value === 'short' || value === 'reduced') return value;
  return '';
}

function isLowPowerDevice() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection && connection.saveData) return true;
  if (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4) return true;
  if (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4) return true;
  return false;
}

function markOpeningPlayed() {
  // ?opening=... は確認用。閲覧履歴には影響させない。
  if (readForcedMode() || app.state.flags.openingPlayed) return;
  commit((state) => { state.flags.openingPlayed = true; });
}

function scheduleSounds(mode, later) {
  if (mode === 'full') {
    later(650, () => sfx.openingWave());
    later(1100, () => sfx.openingSparkle());
    later(1350, () => sfx.openingLift());
    later(2450, () => sfx.openingCard());
    later(3100, () => sfx.openingDeal());
    later(6080, () => sfx.openingGather());
    later(6980, () => sfx.openingLogo());
  } else if (mode === 'short') {
    later(350, () => sfx.openingLift());
    later(850, () => sfx.openingDeal());
    later(1740, () => sfx.openingGather());
    later(2200, () => sfx.openingLogo());
  }
}


function startParticles(canvas, lite) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return () => {};
  const count = lite ? 12 : 24;
  const particles = Array.from({ length: count }, (_, index) => ({
    x: (index * 0.618033 + Math.random() * 0.18) % 1,
    y: 0.36 + Math.random() * 0.46,
    r: 0.65 + Math.random() * 1.25,
    drift: (Math.random() - 0.5) * 0.026,
    speed: 0.035 + Math.random() * 0.07,
    phase: Math.random() * Math.PI * 2,
    color: index % 5 === 0 ? '218,177,78' : (index % 3 === 0 ? '114,196,229' : '255,255,255'),
  }));
  const startedAt = performance.now();
  let frame = 0;
  let stopped = false;
  let width = 1;
  let height = 1;

  const resize = () => {
    const box = canvas.getBoundingClientRect();
    width = Math.max(1, box.width);
    height = Math.max(1, box.height);
    const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.5);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const draw = (now) => {
    if (stopped) return;
    const elapsed = (now - startedAt) / 1000;
    ctx.clearRect(0, 0, width, height);
    if (elapsed > 3.8 || !canvas.isConnected) return;
    const envelope = Math.min(1, elapsed * 1.45, (3.8 - elapsed) * 1.05);
    particles.forEach((particle) => {
      const x = (particle.x + particle.drift * elapsed + 1) % 1;
      const y = particle.y - particle.speed * elapsed;
      const flicker = 0.28 + 0.36 * (0.5 + 0.5 * Math.sin(elapsed * 5 + particle.phase));
      ctx.beginPath();
      ctx.fillStyle = `rgba(${particle.color},${Math.max(0, envelope * flicker)})`;
      ctx.arc(x * width, y * height, particle.r, 0, Math.PI * 2);
      ctx.fill();
    });
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  return () => {
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
    ctx.clearRect(0, 0, width, height);
  };
}
