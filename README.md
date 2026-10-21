# EbookForge Web v0.3.0 — X3向け開発版

GitHub Pages上で利用できる、スマホ完結型の電子書籍変換ツールです。
**Macや常駐サーバーは不要**です。書籍ファイルの解析・変換はスマホのブラウザ内で行います。
なろうの検索クエリのみ、ユーザー操作により公式APIに送信します。

## 追加した機能

- **XTEINK X3純正向け / X3 CrossPoint向け**のモード切替。純正向けは固定レイアウトXTC、CrossPoint向けはXTCのほか元EPUBをそのまま保存可能。
- TXT / Markdown / EPUB（暗号化されていないEPUB）の章解析と**選択した章だけのXTC生成**。
- X3実機解像度 **528×792** の縦書き／横書き1-bit XTC生成。
- ルビ（EPUBのruby要素）は共通本文へ保持し、縦書きXTCで簡易描画。禁則処理、縦中横、縦用括弧グリフは**簡易実装で視覚品質未検証**。
- 文字サイズ・余白・行間の調整、画像（JPG / PNG / WEBP）のページ変換。
- **章情報をXTCの96バイト章テーブルに埋め込み**、章選択・目次ジャンプ・ジャンプ前へ戻る・読書位置の記憶が**スマホ上のプレビューで可能**。
- 小説家になろうの**公式小説API（JSONP）による作品情報検索**（本文の自動取得はしません）。
- 青空文庫の公式UTF-8作品一覧ZIP/CSVをスマホで読み込んで、作品名／作者名を検索（著作権フラグが作品・人物とも「なし」の結果に限定）。公式図書カードを開けます。
- 最近の変換履歴（書名・ページ数のみローカル保存）。
- 旧v0.2のEPUB互換性補正機能、従来TXT→XTC変換を継続。

## 公開方法（iPhoneからの操作）

1. このZIPをダウンロードし、iPhoneの「ファイル」アプリで展開。
2. https://github.com/boufuuuuuu/ebookforge-web/upload/main で **ZIP本体ではなく中のファイル** をリポジトリ直下へアップロード。既存ファイルは置き換える。
3. 必須ファイル: `index.html`, `app.js`, `epub.js`, `book.js`, `studio.js`, `catalog.js`, `manifest.webmanifest`。
4. 参考資料: `README.md`, `THIRD_PARTY_NOTICES.md`。`.nojekyll`はGitHub PagesのJekyllを無効化。
5. Commit changes後、 https://boufuuuuuu.github.io/ebookforge-web/ にアクセス。以前の表示ならSafariで更新。

この環境からのGitHub書き込み権限はなく、**リポジトリへのアップロード・公開作業は未実施**です。

## 使い方

1. 純正X3またはCrossPoint向けを選択。
2. 保存したTXT/MD/EPUB/画像を選び「ファイルを読み込む」。
3. 自動検出された章のうち、変換する章を選択。
4. 組版設定を選んでページ生成。目次からジャンプ、ジャンプ前へ戻る操作をプレビューで確認。
5. XTCを保存。CrossPointでは、X3の **File Transfer** を有効化し、その画面のQRコードをiPhoneで読み取って保存済みファイルを手動でアップロード。純正の場合は対応する方法で端末へ転送。

**クロスポイント端末自身の「ジャンプ前に戻る」操作は、このWebアプリから保証できません。** スマホプレビュー内での戻り操作と区別してください。

## 未対応・制限

- PDF読み込み、EPUB挿絵の本文への配置、高度な禁則処理・縦中横、2-bit XTCHは未実装。
- 青空文庫・なろう本文の完全自動取得、差分更新・改稿チェックはWeb版では未実装。
- GitHub PagesのHTTPSからX3のHTTP Webサーバーへ直接アップロードする機能は未実装（混在コンテンツ/CORSの制限あり）。**端末のFile Transfer画面を開いて手動アップロード**してください。
- 青空文庫の索引ZIPは公式サイトから別途ダウンロードします。ブラウザ間のCORSを回避するため無断プロキシは使いません。
- 変換文字数・複雑なEPUB・スマホメモリによっては失敗する場合があります。EPUB ZIP: 入力70MB、合計展開160MB、1内部ファイル35MB。XTC生成は最大900ページ・110MB。
- DRMは解除しません。取得・複製・配布は各サイトの利用条件と権利に従ってください。
- **Safari/iPhoneとXTEINK X3実機での表示・操作は未検証**。ブラウザ操作の自動試験も実行環境側で遮断されたため未実施です。

## 開発者向け検証

```
node --check app.js
node --check epub.js
node --check book.js
node --check catalog.js
node --check studio.js
node tests/smoke.cjs ./sample.xtc
python3 tests/verify_xtc.py ./sample.xtc
```

これは合成的なcanvasによる構造試験です。フォントの実際の見た目、Safariの挙動、X3表示の証明にはなりません。

## 公開仕様・第三者について

XTCレイアウトはCrossPoint firmwareの `XtcTypes.h` と `XtcParser.cpp` の公開仕様に合わせて独立実装しました。
https://github.com/crosspoint-reader/crosspoint-reader/

EPUB補正は https://github.com/daikori/xteink-jp-epub-converter の公開機能を参考に独立実装した機能を継続。
出典・ライセンス表記は `THIRD_PARTY_NOTICES.md` を参照してください。Xteink Studioや日本語XTC GUI Studioの非公開コードは使用していません。
