# DATA_SCHEMA — 公開データの形

公開データは `data/` の3ファイル。すべて静的JSONで、書き込みは行われない。

## data/cards.json

```json
{
  "dataVersion": "20260910",
  "generatedAt": "2026-09-10T15:13:37",
  "cards": [ /* カードの配列 */ ]
}
```

### カード1件

| キー | 型 | 必須 | 意味 |
|---|---|---|---|
| `id` | string | ○ | 永続的な内部識別子。ゼロ埋め3桁の文字列（例 `"001"`）。**一度公開したIDは変更・再利用しない。廃止IDは永久欠番** |
| `name` | string | ○ | カード名 |
| `reading` | string | | よみ（未使用。将来の並べ替え用） |
| `category` | `"gourmet"` \| `"spot"` \| `"culture"` \| null | 公開時○ | アプリ上のカテゴリ。null のカードはガチャに出ない |
| `subCategory` | string | | Excel側の細かい分類（例「海の幸」）。表示の補足にのみ使う |
| `published` | boolean | ○ | `true` のみ公開・ガチャ対象 |
| `photo` | string | 公開時推奨 | **カードの写真**。`assets/photos/` の下のファイル名（例 `001.jpeg`）。Excelの「詳細写真１」のセル内画像から書き出す |
| `cardText` | string | | **カードに載せる短い説明**（3行まで）。空なら `description` を使う |
| `cardButton` | string | | カード下部のボタン文言。空なら `config.json` の `cardButtons` のジャンル既定を使う |
| `cardImage` | string | | 完成画像で上書きする場合のみ。通常は空。指定するとそのカードは組み立てを行わず画像をそのまま表示する |
| `description` | string | | 説明文 |
| `season` | string | | 旬・開催時期 |
| `highlight` | string | | 見どころ・楽しみ方 |
| `detailPhotos` | string[] | | 詳細画面の写真（最大3枚） |
| `sakeSnack` | boolean | ○ | 酒のアテ。**Excelの明示フラグのみ。アプリ側で推論しない** |
| `gps.enabled` | boolean | ○ | 現地チェックイン対象か。カテゴリではなくこのフラグで決まる |
| `gps.lat` / `gps.lng` | number \| null | | 緯度・経度 |
| `gps.radius` | number \| null | | 判定半径(m)。既定200 |
| `purchase.enabled` | boolean | ○ | 「買える場所を探す」を出すか |
| `purchase.searchWord` | string | | Google Maps の検索語 |
| `purchase.shops` | `{name,url}[]` | | 販売を確認できた店舗のみ。推測で登録しない |
| `externalLinks` | `{label,url}[]` | | 外部リンク。http/https のみ |

不要な項目は `null` または空配列・空文字で出す（キー自体は残す）。

### カードの組み立て

カードは1枚の完成画像ではなく、次の部品を重ねて作る（`js/card-render.js` と `css/card-art.css`）。
文言や写真を直すのに画像を作り直す必要はない。

| 層 | 中身 | どこから |
|---|---|---|
| ① 写真 | 産品・風景の写真 | `assets/photos/<photo>`（一覧では `assets/photos/thumb/` の縮小版、大きく出すときは `assets/photos/web/` の WebP。無ければ元の写真） |
| ② 台紙 | 外枠・背景・区切り線・所在地ピル・罫線 | `assets/frames/<category>.png`（写真部分は透過。一覧では `thumb/` の縮小版） |
| ③ バッジ | 紺のピル＋アイコン＋カテゴリ名 | `assets/frames/icon-<category>.png` ＋ アプリ側で描画 |
| ④ 番号 | `#01 / 53` | `id` と公開枚数から生成 |
| ⑤ 名前 | カード名 | `name` |
| ⑥ 説明 | 3行まで | `cardText`（空なら `description`） |
| ⑦ ボタン | 白い角丸ボタン | `cardButton`（空なら `config.json` の `cardButtons`） |
| ⑧ ロゴ | SHIKA COLLECTION | `assets/frames/logo.png` |

設計サイズは **1080×1350（縦横比 4:5）**。位置は `css/card-art.css` に割合で書いてある。

カード一覧のように小さく並べるときは、`assets/photos/thumb/` と `assets/frames/thumb/` の
縮小版を使う。原寸を53枚ぶん展開すると描画が重くなるため。
詳細画面・3Dビューア・ガチャ演出では原寸をそのまま使う。
縮小版が無い場合は原寸に切り替わるので、表示が欠けることはない。

### 解決ルール（アプリ側）

- `http(s)://` で始まる → そのまま
- `assets/` で始まる → そのまま相対参照
- `photo` はそれ以外なら `assets/photos/` の下
- `cardImage` はそれ以外なら `assets/cards/` の下
- `detailPhotos` は `assets/details/` の下

### 更新時の扱い

- cards.json 更新時は **IDで突き合わせ（マージ）**。新しいIDは未取得として追加される
- `published` を `false` にしても、利用者の端末にある取得済み情報は削除しない。再公開すると取得済みの状態に戻る
- 公開カードの総数がコンプリートの母数になる

## data/config.json

| キー | 既定 | 意味 |
|---|---|---|
| `townName` | `"志賀町"` | 検索語などに使う町名 |
| `gpsAccuracyLimit` | `120` | 許容する測位誤差(m)。これを超えたら判定しない |
| `defaultRadius` | `200` | GPS判定半径の既定値 |
| `mapCenter` / `mapZoom` | 志賀町中心 / 11 | 地図の初期表示 |
| `coin.*` | 下表 | コイン付与量 |
| `event.*` | 無効 | イベント設定 |

`cardButtons` … カード下部のボタン文言（ジャンル既定）。空文字にするとそのジャンルにはボタンを出さない。
既定は グルメ「取扱店を検索する」/ スポット「Googleマップで経路を見る」/ 文化「」。

`coin` の既定値：`daily:1` / `sakeSnack:1` / `duplicatePer5:1` / `categoryPer5:2` /
`spotFirst:3` / `spotRevisit:1` / `townFirst:5` /
`loginBonus:{"5":5,"10":10,"15":15}`（ログインした日数のごほうび。いちばん大きい日目で1周し、翌日からまた1日目）

`event`：`enabled`（イベントモード）、`name`、`startAt`/`endAt`（ISO日時。期間外は通常モード）、
`sakeSnackBonus`（酒のアテON/OFF）、`venueBonus`（会場GPSボーナスON/OFF）、`lat`/`lng`/`radius`、`message`

## data/version.json

```json
{ "appVersion": "1.0.0", "dataVersion": "20260910", "updatedAt": "2026-09-10" }
```

起動時に毎回取りに行く（キャッシュを避ける）軽量ファイル。
`dataVersion` が変わると cards.json / config.json を取り直す。
