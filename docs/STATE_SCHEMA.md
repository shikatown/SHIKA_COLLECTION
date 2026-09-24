# STATE_SCHEMA — 端末内に保存するデータ

保存先は `localStorage` のキー `shika-gacha:state`。JSON 1本。
**サーバーへは一切送信しない。** 画像と地図タイルは Service Worker の Cache Storage に入る（別管理）。

```json
{
  "schemaVersion": 1,
  "coins": 5,
  "ownedCardIds": ["001", "003"],
  "obtainedAt": { "001": "2026-09-10T10:00:00.000Z" },
  "duplicateGauge": 2,
  "dailyBonusDate": "2026-09-10",
  "favorites": ["003"],
  "visits": {
    "033": { "firstVisitedAt": "2026-09-10T02:11:00.000Z", "lastVisitDate": "2026-09-10" }
  },
  "townVisited": true,
  "lastEventBonusDate": "",
  "rewardClaims": {
    "sakeSnack": ["001"],
    "category": { "gourmet": 2, "spot": 1, "culture": 0 }
  },
  "settings": { "sound": false, "vibration": true, "analytics": true },
  "flags": {
    "firstFreeTenDone": true,
    "tutorial3dShown": true,
    "pwaPromptShown": false,
    "backupPromptShown": false,
    "spotHintShown": true
  },
  "knownCardIds": ["001", "002"],
  "dataVersion": "20260910",
  "pendingResult": null,
  "titlesCelebrated": null
}
```

| キー | 意味 |
|---|---|
| `schemaVersion` | 保存形式のバージョン。読み込み時に移行処理を通す |
| `coins` | SHIKA COIN 残高 |
| `ownedCardIds` | 所持カードID（重複なし） |
| `obtainedAt` | 初取得日時 |
| `duplicateGauge` | かぶりゲージ。5たまるごとに +1して5引く（繰り越し） |
| `dailyBonusDate` | デイリーを受け取った日（YYYY-MM-DD） |
| `loginDays` | ログインボーナスの日数。1周（既定15日）のなかで何日目まで受け取ったか。1周を終えた翌日に1へ戻る |
| `loginShownDate` | ミッション画面でロゴに色が付く演出を見せた日（1日1回だけ動かす） |
| `favorites` | 「気になる」。配列の後ろが新しい（一覧は新しい順） |
| `visits` | スポットID → 初訪問日時・最終訪問日。**緯度経度は保存しない** |
| `townVisited` | 志賀町 初訪問ボーナスを受け取ったか（1回限り） |
| `lastEventBonusDate` | イベント会場ボーナスを受けた日 |
| `rewardClaims.sakeSnack` | 酒のアテ初取得ボーナスを渡したカードID |
| `rewardClaims.category` | カテゴリごとの「5種類段階」を何段階まで払ったか |
| `settings` | 効果音（既定OFF）。`analytics` は利用状況の記録を送るか（v1.50。js/analytics.js）。振動は v1.51 で削除 |
| `flags` | 一度きりの案内を出したかどうか（`sakeHistoryRead` は、ミッション「志賀町と日本酒の歴史を読む」で本文を開いたか。v1.49） |
| `knownCardIds` | 前回起動時に見えていた公開カードID。差分が新カード通知になる |
| `dataVersion` | 最後に読んだ公開データのバージョン |
| `pendingResult` | 未確認のガチャ結果（**すでに確定・保存済み**）。結果画面を閉じると null |
| `titlesCelebrated` | 獲得の演出を見せた称号の名前（v1.46）。null は記録を始める前で、はじめて確かめたときに、その時点で持っている称号（見せていないコンプリートを除く）を入れる |

## 壊れたデータへの備え

- JSON が壊れていた場合は初期状態で開始し、壊れた値は `shika-gacha:state:broken` に退避する
- 型が違う値は既定値で埋める（`storage.js` の `normalize()`）
- `localStorage` が使えない環境（プライベートモード等）ではメモリ上だけで動作し、設定画面にその旨を表示する

## バックアップファイル

```json
{
  "format": "shika-gacha-backup",
  "formatVersion": 1,
  "schemaVersion": 1,
  "exportedAt": "2026-09-10T12:00:00.000Z",
  "dataVersion": "20260910",
  "state": { /* 上記の保存データそのまま */ },
  "checksum": "1a2b3c4d"
}
```

`checksum` は FNV-1a による取り違え・破損の検知用。暗号的な保護は目的にしない（静的Webのため）。
復元時は形式・バージョン・チェックサムを確認し、内容（保存日・カード枚数・コイン）を見せてから置き換える。
