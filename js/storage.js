/* storage.js — 端末内保存だけを扱う。サーバー送信は一切行わない。
   ・遊びのデータ : localStorage（JSON1本、schemaVersion付き）
   ・画像/データ  : Cache Storage（service-worker.js 側）
   localStorage が壊れている / 使えない場合はメモリ上だけで動くフォールバックに落ちる。 */

export const STORAGE_KEY = 'shika-gacha:state';
export const SCHEMA_VERSION = 1;

let memoryFallback = null;   // localStorage が使えないときの受け皿
let warned = false;

function ls() {
  try {
    const k = '__shika_test__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch (e) {
    if (!warned) { warned = true; console.warn('localStorage が使えないため、この端末では進行が保存されません', e); }
    return null;
  }
}

export function isPersistent() { return ls() !== null; }

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    coins: 0,
    ownedCardIds: [],
    obtainedAt: {},          // cardId -> ISO日時（初取得）
    duplicateGauge: 0,
    dailyBonusDate: '',
    favorites: [],
    visits: {},              // cardId -> { firstVisitedAt, lastVisitDate, firstBonusAt }
    townVisited: false,
    lastEventBonusDate: '',
    rewardClaims: {
      sakeSnack: [],         // 初取得ボーナスを渡したカードID
      category: {},          // category -> 付与済み回数（v1.18より前の自動付与の記録）
      missions: [],          // 受け取ったミッションの id
    },
    settings: { sound: false, vibration: true },
    flags: {
      firstFreeTenDone: false,
      tutorial3dShown: false,
      pwaPromptShown: false,
      backupPromptShown: false,
      spotHintShown: false,
      swipeHintShown: false,   // カード詳細で左右に払える案内
      mapGuideShown: false,    // まち巡り画面の初回の案内を見せたか
      missionsGuideShown: false, // ミッション画面の初回の案内を見せたか
      openingPlayed: false,    // 起動演出の長い版を一度見たか（2回目からは短い版）
      completeCelebrated: false, // 「志賀町コンプリート」の獲得演出を見せたか（1回だけ出す）
      admin: false,          // 管理者の確認用モード（公開前の点検だけに使う）
    },
    knownCardIds: [],        // 「新カード追加」通知の判定用
    unseenCardIds: [],       // 取得したが、まだ一覧で枠にはめる演出を見せていないカード
    dataVersion: '',
    pendingResult: null,     // 未確認のガチャ結果（確定済み）
  };
}

/** 保存データを既定形にそろえる。壊れた値は既定値で埋める。 */
export function normalize(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== 'object') return d;
  const out = { ...d };
  const num = (v, f) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : f);
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

  out.schemaVersion = SCHEMA_VERSION;
  out.coins = num(raw.coins, 0);
  out.ownedCardIds = Array.from(new Set(arr(raw.ownedCardIds)));
  out.obtainedAt = obj(raw.obtainedAt);
  out.duplicateGauge = num(raw.duplicateGauge, 0);
  out.dailyBonusDate = typeof raw.dailyBonusDate === 'string' ? raw.dailyBonusDate : '';
  out.favorites = arr(raw.favorites);
  out.townVisited = raw.townVisited === true;
  out.lastEventBonusDate = typeof raw.lastEventBonusDate === 'string' ? raw.lastEventBonusDate : '';
  out.dataVersion = typeof raw.dataVersion === 'string' ? raw.dataVersion : '';
  out.knownCardIds = arr(raw.knownCardIds);
  out.unseenCardIds = Array.from(new Set(arr(raw.unseenCardIds)));

  const visits = obj(raw.visits);
  out.visits = {};
  for (const [k, v] of Object.entries(visits)) {
    if (!v || typeof v !== 'object') continue;
    out.visits[k] = {
      firstVisitedAt: typeof v.firstVisitedAt === 'string' ? v.firstVisitedAt : '',
      lastVisitDate: typeof v.lastVisitDate === 'string' ? v.lastVisitDate : '',
    };
  }

  const rc = obj(raw.rewardClaims);
  out.rewardClaims = { sakeSnack: arr(rc.sakeSnack), category: {}, missions: arr(rc.missions) };
  for (const [k, v] of Object.entries(obj(rc.category))) out.rewardClaims.category[k] = num(v, 0);
  /* v1.18 より前は、ジャンル5種類ごとのコインを自動で渡していた。
     その回数を受け取り済みのミッションとして引き継ぎ、二重に渡さないようにする。 */
  if (!rc.missions) {
    for (const [k, steps] of Object.entries(out.rewardClaims.category)) {
      for (let i = 1; i <= steps; i += 1) out.rewardClaims.missions.push(`cat:${k}:${i * 5}`);
    }
  }
  out.rewardClaims.missions = Array.from(new Set(out.rewardClaims.missions));

  const st = obj(raw.settings);
  out.settings = { sound: st.sound === true, vibration: st.vibration !== false };

  const fl = obj(raw.flags);
  for (const k of Object.keys(d.flags)) out.flags[k] = fl[k] === true;

  out.pendingResult = raw.pendingResult && typeof raw.pendingResult === 'object' ? raw.pendingResult : null;
  return out;
}

export function load() {
  const s = ls();
  if (!s) return memoryFallback ? normalize(memoryFallback) : defaultState();
  try {
    const txt = s.getItem(STORAGE_KEY);
    if (!txt) return defaultState();
    return migrate(normalize(JSON.parse(txt)));
  } catch (e) {
    console.warn('保存データを読めなかったため初期状態で開始します', e);
    try { s.setItem(STORAGE_KEY + ':broken', s.getItem(STORAGE_KEY) || ''); } catch (_) { /* noop */ }
    return defaultState();
  }
}

/** 将来スキーマを上げるときの移行地点。今は v1 のみ。 */
function migrate(state) {
  if (state.schemaVersion < SCHEMA_VERSION) state.schemaVersion = SCHEMA_VERSION;
  return state;
}

export function save(state) {
  const s = ls();
  memoryFallback = state;
  if (!s) return false;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('保存に失敗しました（容量不足の可能性）', e);
    return false;
  }
}

export function clear() {
  const s = ls();
  memoryFallback = null;
  if (s) { try { s.removeItem(STORAGE_KEY); } catch (_) { /* noop */ } }
}
