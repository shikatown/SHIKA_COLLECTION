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
- カード画像は `assets/cards/` に51枚入っています。008（イカの塩辛　黒づくり）と
  057（まつり寿司（押し寿司））だけ画像が無く、代替表示になります

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
| カードの追加・修正・非公開 | `data/cards.json` | Excel を編集 → `tools/excel-to-json.html` で変換 → 差し替え |
| カード画像の追加 | `assets/cards/` | `card-<番号>.webp` の名前で置く（例 card-08.webp）。変換ツールでフォルダを選ぶと自動で紐づきます |
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
assets/cards/               カード画像 51枚（1080×1350 / WebP。ファイル名の数字がカードID）
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
- カード画像は配布用に PNG から WebP へ変換しています（寸法 1080×1350 のまま。トリミング・構図変更なし）。
  原本の PNG は `Documents/Codex/2026-09-03/kak/outputs/SHIKA_COLLECTION_20260910/cards` に残してあります。
- 掲載している旬・開催時期・営業状況は変わることがあります。
