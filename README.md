# EbookForge Web v0.5.0 — iPhoneローカルPDF・RAR/CBR対応（開発版）

GitHub Pages上で動作するXTEINK X3向け電子書籍変換ツールです。Macを起動せず、iPhoneの「ファイル」アプリから本・漫画を選んで、ブラウザ内でXTC（白黒）/ XTCH（4階調）を生成します。

## v0.5.0の追加

- **PDF**：iPhoneに保存したPDFの各ページをブラウザ内で画像化してX3用XTC/XTCHへ変換します。文字抽出・OCRはしないため、ページの見た目を保つ画像変換です。
- **RAR / CBR**：RAR4・RAR5形式の漫画書庫からPNG/JPEG/WebP画像を抽出し、画像のファイル名順に変換します。実際のRARファイルでのSafari検証はまだ済んでいません。
- **従来の漫画加工に統合**：余白除去、右開き/左開き、見開き分割、縦長分割、コントラスト、ディザ、章・目次、プレビュー、XTC/XTCH。
- **X3純正／CrossPoint切替とX3初期設定**を維持しました。直接Wi-Fi送信は未対応です。
- **入力保護**：PDFページ数上限、RARの展開サイズ制限、暗号化書庫の拒否、変換後の文書資源解放。
- 以前のTXT/Markdown/EPUB/ZIP/CBZ/画像、なろう作品情報・青空文庫索引検索、EPUB補正機能を維持しました。

## GitHub Pagesを更新する（iPhone）

1. 配布ZIPをiPhoneの「ファイル」に保存し、タップして展開します。
2. https://github.com/boufuuuuuu/ebookforge-web/upload/main を開きます。
3. リポジトリ直下にZIP **の中のファイル**をアップロードし、既存ファイルを更新します。
   - 必須：`index.html`、`app.js`、`epub.js`、`book.js`、`studio.js`、`catalog.js`、`manga.js`、`manga-ui.js`、**`document-input.js`**、`manifest.webmanifest`
   - 推奨：`README.md`、`THIRD_PARTY_NOTICES.md`
   - `.nojekyll` は任意。`tests/` は公開する必要がありません。
4. **Commit changes** を押します。
5. https://boufuuuuuu.github.io/ebookforge-web/ を開き、見出しに `v0.5.0` が表示されることを確認します。旧画面の場合は再読み込みしてください。

この成果物はGitHubへ自動アップロードされません。

## PDF・RAR変換手順

1. `⑤ 漫画・写真・PDF・RAR/CBR` までスクロール。
2. iPhoneの「ファイル」から `.pdf` / `.rar` / `.cbr` を選択。複数ファイルの指定もできます。
3. 出力をXTCまたはXTCHにし、必要な画質設定を変更。
4. 「漫画画像を変換してプレビュー」で確認。「X3用ファイルを保存」でダウンロード。
5. 保存したファイルをX3へ手動転送。CrossPointを導入している場合は端末のFile Transfer機能からアップロード。

### 初回のネット接続について

**PDF.jsとRAR展開エンジンは該当形式を初めて開く時にCDNから読み込みます。** GitHub PagesのJavaScriptと書籍内容を独自のサーバーに送信する処理はありません。ただし、外部配信のライブラリを実行するため、CDNの信頼・可用性に依存します。オフラインでPDF/RARを変換することは保証できません。CDNがブロックされると変換は失敗します。

- PDF.js 3.11.174 (`pdf.min.js` と `pdf.worker.min.js`, Apache-2.0): https://cdnjs.com/libraries/pdf.js/3.11.174
- node-unrar-js 2.0.2 (`esm/index.esm.js`、`unrar.wasm`, MIT + underlying UnRAR terms): https://github.com/YuJianrong/node-unrar.js
- CDN依存ライブラリ本体をZIPへ同梱してはいません。

## 制限と注意

- PDF **最大35MB、120ページ**。パスワード付き/DRM付きPDFには対応しません。PDF内の文字はOCRせず画像化します。スキャンPDFは画像として変換可能。
- RAR/CBR **最大40MB、展開後画像125MB、180画像**。35MBを超える単独画像は拒否。暗号化・分割RAR（マルチボリューム）には未対応。RAR5含む実アーカイブのSafari試験は未完了です。
- 従来のZIP/CBZ最大70MB、合計ファイル90MB、出力400ページ。HEIC/HEIFは未対応。
- 画像の自動加工は縦横比・画素判定に基づく簡易処理。吹き出し・コマ・文字の認識、OCRはしません。
- iPhoneのRAM不足で長編変換が失敗する可能性があります。まず小規模ファイルから試してください。
- XTEINK X3実機への転送、XTC/XTCH実機表示、端末本体の戻る操作は未検証です。
- 漫画サイトからの自動ダウンロード・DRM回避は行いません。保存・変換が認められたファイルのみを利用してください。

## 検証結果と実行方法

- `node --check`：すべてのJavaScriptの構文が正常
- `node tests/smoke.cjs`：旧版の本文→XTC、青空文庫索引、章情報
- `node tests/manga.cjs`：画像処理、XTC/XTCHパッキング
- `node tests/documents.cjs`：**PDF/RARの入力アダプターを模擬依存エンジンで検証**
- Chromiumの画面上で、PDF模擬レンダラ→2ページXTC、RAR模擬展開器→2ページXTCHを生成し、独立したCrossPoint XTC構造バリデータでMD5、章情報、解像度を確認

**検証の限界：** この実行環境では外部CDNに接続できず、実際のPDF.js／RAR WebAssemblyを呼んだエンドツーエンド検証は実施していません。iPhone SafariとX3実機も未検証です。したがってPDF/RARは「実装済み・統合動作未確認」の段階です。

## 第三者ソフトウェア

`THIRD_PARTY_NOTICES.md` を参照してください。MITの公開参考実装・CrossPoint仕様の著作権表示を保持し、PDF.jsとRARエンジンのライセンス情報を追記しています。
