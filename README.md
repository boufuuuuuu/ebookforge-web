# EbookForge Web — GitHub Pages試験版

スマートフォンのブラウザ内でUTF-8 TXTまたは貼り付けた本文を、XTEINK X3/X4向けの1-bit XTCファイルに変換します。外部ライブラリ・ビルド不要です。

## GitHub Pages公開
1. GitHubアカウント `boufuuuuuu` で公開リポジトリ `ebookforge-web` を新規作成。
2. このフォルダ内の `index.html`, `app.js`, `manifest.webmanifest`, `.nojekyll` をリポジトリのルートにアップロード。
3. Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save。
4. `https://boufuuuuuu.github.io/ebookforge-web/` を開く。

## 実装範囲
- UTF-8 TXTアップロード・貼り付け、タイトル・著者、X3/X4選択、横書き1bit XTC生成とダウンロード
- 青空文庫・なろうへの外部リンク

## 未実装
- 青空文庫・なろうのアプリ内検索と自動取得
- 縦書き・ルビ・禁則処理・XTCH・EPUB・直接Wi-Fi転送
- iPhone/Android/XTEINK実機での動作検証

## 注意
- 変換はスマホのメモリを使用します。長編ではブラウザが停止する可能性があります。
- 生成ファイルは独立したCrossPoint互換仕様に基づく試作であり、実機表示は未確認です。
- 作品の取得・複製・転送に際して、著作権と各サイトの利用条件を確認してください。
