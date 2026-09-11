# 志賀町をあつめよう

志賀町の特産品・観光スポット・文化をカードで集める Web ガチャアプリです。
ビルド作業は不要で、この中身をそのまま GitHub にアップロードすれば公開できます。

- 無料で運用（GitHub Pages のみ。サーバー・GAS・Firebase・有料APIなし）
- 個人情報を集めない（アカウントなし、アクセス解析なし、GPS座標は保存も送信もしない）
- PWA 対応（ホーム画面に追加／読み込み済みの範囲はオフラインでも遊べる）

---

## 公開のしかた（3ステップ）

1. **GitHub でリポジトリを作る**（Public。名前は例：`shika-gacha`）
2. **このフォルダの中身をすべてアップロードする**
   - Web でアップロードする場合：リポジトリの `Add file` → `Upload files` に
     **フォルダの中身**（`index.html` が一番上に来るように）をドラッグ＆ドロップ → `Commit changes`
   - `index.html` がリポジトリの直下にある状態にしてください（`shika-gacha/index.html` ではなく `index.html`）
3. **Pages を有効にする**
   - `Settings` → `Pages` → Source: **Deploy from a branch**
   - Branch: `main` / フォルダ: `/ (root)` → `Save`
   - 1〜2分後、`https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます

> `.nojekyll` を同梱しています（GitHub Pages が `_` で始まる名前を無視しないようにするため）。
> サブパス配信でも動くよう、すべてのリンクを相対パスにしてあります。

### 公開前に確認したいこと

- `data/cards.json` の内容（説明文・旬・座標）が最新か
- 公開したくないカードの「公開」列が空欄になっているか
- 写真は `assets/photos/` に52枚入っています。051（西海祭り）だけ写真が無く「写真準備中」と出ます
- カードに載る説明が長いものは3行で切れます。Excel に「カード説明文」列を作って
  短い文を入れると整います（該当10件は変換ツールが名前を挙げて教えてくれます）

---

## ローカルで確認する

`index.html` をダブルクリックしても動きません（ブラウザの制限で `data/cards.json` を読めないため）。
フォルダの中で簡易サーバーを立ち上げてください。

```
python -m http.server 8000
```

→ ブラウザで `http://localhost:8000/` を開く

---

## 運用（更新のしかた）

| やりたいこと | 触るファイル | 手順 |
|---|---|---|
| 文言・リンク・カードの追加 | `data/cards.json` | Excel を編集 → `tools/excel-to-json.html` にドロップ → 「cards.json を保存」 |
| 写真の差し替え | `assets/photos/` | Excel の「詳細写真１」に画像を貼る → 同ツールの「写真を書き出す」→ photos.zip を展開して上書き（中の `thumb/` も一緒に） |
| カードの枠・アイコン・ロゴ | `assets/frames/` | ジャンル共通の部品。差し替えるとカード全体の見た目が変わります |
| カード裏面 | `assets/cards/_back.png` | 置き換えるだけでガチャ演出と3Dビューアの裏面が変わります |
| ボタンの文言 | `data/config.json` | `cardButtons` でジャンルごとに設定。カード個別はExcelの「カードボタン文言」列 |
| イベント設定 | `data/config.json` | `tools/event-config-editor.html` で作成 → 差し替え |
| データ更新の通知 | `data/version.json` | `dataVersion` を新しい値に |
| アプリ本体の更新 | `service-worker.js` | `APP_VERSION` の数字を上げてからアップロード |

**アプリ本体を書き換えたら、必ず `service-worker.js` の `APP_VERSION` を上げてください。**
上げないと、利用者の端末で古いファイルが使われ続けます。

カードデータを更新しても、利用者が集めたカードやコインは消えません（IDで突き合わせます）。
カードIDは永続です。**一度公開したIDは変更せず、別のカードに再利用しないでください。**

---

## フォルダ構成

```
index.html                  アプリ本体
manifest.webmanifest        PWA設定
service-worker.js           オフライン対応（更新時は APP_VERSION を上げる）
.nojekyll                   GitHub Pages 用
css/                        画面のスタイル
js/                         アプリのプログラム
data/cards.json             カードデータ（Excelから生成）
data/config.json            イベント・コイン・地図の設定
data/version.json           バージョン情報
assets/photos/              カードの写真 52枚（Excelから書き出したもの）
assets/photos/thumb/        一覧表示用の小さい写真（無くても動くが一覧が重くなる）
assets/frames/              ジャンル別の台紙・カテゴリアイコン・SHIKAロゴ
assets/frames/thumb/        一覧表示用の小さい台紙・アイコン・ロゴ
assets/cards/               カード裏面（_back.png）と、完成画像で上書きする場合
assets/details/             詳細画面の写真
assets/pwa/                 ホーム画面用アイコン
tools/excel-to-json.html    Excel → cards.json 変換（ローカルで開く）
tools/event-config-editor.html  config.json 作成（ローカルで開く）
docs/                       仕様・スキーマ・テスト項目
```

---

## 使っている外部のもの

| 用途 | 提供元 | 備考 |
|---|---|---|
| 地図タイル | 国土地理院（淡色地図） | 出典表示を地図右下に入れています |
| 経路・ナビ | Google Maps | 外部リンクで開くだけ。有料APIは使いません |

JavaScript ライブラリ・Webフォント・アイコンCDN・BGM素材は**一切使っていません**。
効果音は Web Audio API でその場で生成しています（初期状態はOFF）。

---

## 権利・注意

- カードの写真と説明文は志賀町の資料（アイテム.xlsx）と、支給されたカード画像に基づいています。公開前に内容をご確認ください。
- カードは1枚絵ではなく、写真と文字を組み立てて表示しています。
  Excel を直すだけで文言・写真・リンクを更新でき、画像を作り直す必要はありません。
- 写真は Excel に貼られていた原本をそのまま使っています（変換・圧縮なし）。
- 掲載している旬・開催時期・営業状況は変わることがあります。
