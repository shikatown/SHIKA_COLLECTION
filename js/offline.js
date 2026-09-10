/* offline.js — 通信状態の表示だけを担当する。
   遊びのデータは端末内で完結しているため、オフラインでもそのまま保存される。 */

const bar = () => document.getElementById('offlineBar');

export function startOfflineWatch() {
  const update = () => {
    const b = bar();
    if (!b) return;
    b.hidden = navigator.onLine;
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

export function isOffline() { return !navigator.onLine; }
