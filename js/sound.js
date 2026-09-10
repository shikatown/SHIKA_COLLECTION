/* sound.js — 効果音は Web Audio API でその場生成する。外部音源・BGMは持たない。
   初期値OFF。設定でONにしたときだけ鳴る。 */

import { app } from './state.js';

let ctx = null;

function ac() {
  if (!app.state.settings.sound) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) { try { ctx = new AC(); } catch (_) { return null; } }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** ユーザー操作の中で一度呼んでおくと iOS でも鳴るようになる */
export function unlock() { ac(); }

function tone(freq, start, dur, gain = 0.09, type = 'sine', slideTo = null) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(start, dur, gain = 0.05) {
  const c = ac();
  if (!c) return;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  const g = c.createGain();
  const f = c.createBiquadFilter();
  f.type = 'highpass'; f.frequency.value = 1800;
  g.gain.value = gain;
  src.buffer = buf;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + start);
}

export const sfx = {
  tap()      { tone(660, 0, 0.05, 0.05, 'triangle'); },
  flip()     { noise(0, 0.08, 0.035); tone(420, 0.01, 0.09, 0.05, 'triangle'); },
  normal()   { tone(523.25, 0, 0.11, 0.06, 'sine'); tone(659.25, 0.06, 0.12, 0.045, 'sine'); },
  neu()      {
    tone(659.25, 0,    0.13, 0.075, 'triangle');
    tone(783.99, 0.08, 0.14, 0.07,  'triangle');
    tone(1046.5, 0.17, 0.30, 0.08,  'sine');
    noise(0.16, 0.25, 0.03);
  },
  coin()     { tone(987.77, 0, 0.08, 0.06, 'square'); tone(1318.5, 0.07, 0.16, 0.05, 'square'); },
  checkin()  { tone(587.33, 0, 0.12, 0.06); tone(880, 0.1, 0.22, 0.06); },
  error()    { tone(220, 0, 0.16, 0.05, 'sawtooth', 160); },
};
