/* backup.js — バックアップ / 復元。アカウントもサーバーも使わない。
   1ファイルに遊びのデータと設定をまとめる。簡易な改ざん検知（チェックサム）付き。
   静的Webのため強固な改ざん対策は目的にしない。 */

import { app, setState } from './state.js';
import * as storage from './storage.js';
import { el, toast, dialog, confirm2 } from './ui.js';

const FORMAT = 'shika-gacha-backup';
const FORMAT_VERSION = 1;

function checksum(text) {
  // FNV-1a（軽量な取り違え検知用。暗号用途ではない）
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function buildBackup() {
  const payload = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    schemaVersion: storage.SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    dataVersion: app.state.dataVersion || '',
    state: app.state,
  };
  payload.checksum = checksum(JSON.stringify(payload.state));
  return payload;
}

export function download() {
  const payload = buildBackup();
  const text = JSON.stringify(payload, null, 1);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const a = el('a', { attrs: { href: url, download: `shika-gacha-backup-${stamp}.json` } });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('バックアップファイルを保存しました');
}

export function validate(obj) {
  if (!obj || typeof obj !== 'object') return 'ファイルの形式が違います。';
  if (obj.format !== FORMAT) return 'このアプリのバックアップファイルではありません。';
  if (typeof obj.formatVersion !== 'number' || obj.formatVersion > FORMAT_VERSION) {
    return 'より新しい形式のファイルです。アプリを更新してからお試しください。';
  }
  if (!obj.state || typeof obj.state !== 'object') return 'データが入っていません。';
  if (obj.checksum && obj.checksum !== checksum(JSON.stringify(obj.state))) {
    return 'ファイルが壊れている可能性があります。';
  }
  /* 中身の形も確かめる。チェックサムは壊れたことを見つけるだけで、形が正しいことまでは保証しない
     （チェックサムの無いファイルや、手で書き換えたファイルもある）。
     ここで1つでもおかしければ、いまの進行は置き換えない。 */
  const st = obj.state;
  const isCount = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const isIdList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 40);
  if (st.ownedCardIds != null && !isIdList(st.ownedCardIds)) return 'カードの記録が壊れています。';
  if (st.favorites != null && !isIdList(st.favorites)) return '「気になる」の記録が壊れています。';
  if (st.coins != null && !isCount(st.coins)) return 'SHIKA COIN の記録が壊れています。';
  if (st.duplicateGauge != null && !isCount(st.duplicateGauge)) return 'かぶりゲージの記録が壊れています。';
  if (st.visits != null && (typeof st.visits !== 'object' || Array.isArray(st.visits))) return '訪問の記録が壊れています。';
  if (st.flags != null && (typeof st.flags !== 'object' || Array.isArray(st.flags))) return '設定の記録が壊れています。';
  if (st.pendingResult != null && !storage.isValidPendingResult(st.pendingResult)) return 'ガチャの結果の記録が壊れています。';
  return null;
}

export async function restoreFromFile(file) {
  let obj = null;
  try {
    obj = JSON.parse(await file.text());
  } catch (_) {
    await dialog({ title: '復元できません', body: ['ファイルを読み取れませんでした。'], actions: [{ label: '閉じる', value: null, primary: true }] });
    return false;
  }
  const err = validate(obj);
  if (err) {
    await dialog({ title: '復元できません', body: [err], actions: [{ label: '閉じる', value: null, primary: true }] });
    return false;
  }
  const s = storage.normalize(obj.state);
  const when = obj.exportedAt ? obj.exportedAt.slice(0, 10) : '不明';
  const ok = await confirm2(
    '復元しますか',
    [
      `保存日: ${when} ／ カード ${s.ownedCardIds.length} 枚 ／ ${s.coins} SHIKA COIN`,
      'いまの進行データはすべて置き換わります。',
    ],
    '復元する'
  );
  if (!ok) return false;
  // 保存できたときだけ「復元しました」と出す（失敗の案内は app.js が出し、いまの進行はそのまま残る）
  if (!setState(s)) return false;
  toast('復元しました');
  return true;
}

export function pickFile() {
  return new Promise((resolve) => {
    const input = el('input', { attrs: { type: 'file', accept: 'application/json,.json' }, style: { display: 'none' } });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      resolve(f || null);
    });
    document.body.append(input);
    input.click();
  });
}

/** 10種類ほど集まったところで1回だけ案内する */
export async function maybeSuggestBackup() {
  const s = app.state;
  if (s.flags.backupPromptShown) return;
  if (s.ownedCardIds.length < 10) return;
  const ok = await dialog({
    title: 'データを控えておきませんか',
    body: [
      '集めたカードは、この端末の中だけに保存されています。',
      'ブラウザのデータを消すと消えてしまうため、バックアップファイルを保存しておくと安心です。',
    ],
    actions: [{ label: 'あとで', value: false }, { label: '保存する', value: true, primary: true }],
  });
  const { commit } = await import('./state.js');
  commit((st) => { st.flags.backupPromptShown = true; });
  if (ok) download();
}
