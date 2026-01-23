# INSERT

INSERT中は textarea の標準編集機能（WebView2/Chromium 準拠）も利用できます。挙動はOS/環境に依存します。

## 基本編集
- `TAB` 通常は 'shiftwidth' 設定に従いインデント（空白またはTAB文字）を挿入
  - markdownモードの(un)ordered list行では `>>` と同等（現在項目のサブツリーを同時にインデント増）
- `Shift+TAB` markdownモードの(un)ordered list行では `<<` と同等（現在項目のサブツリーを同時にインデント減）
  - ただし階層1（ルート項目）での outdent は「ルート行が左に寄せられる余地がない（indent=0）」場合のみ no-op（下位階層だけが動くのを防ぐ）
- `Backspace`左の1文字を削除
- `Delete`右の1文字を削除
- `Enter`改行を挿入（Sixの最終改行ポリシー: 視覚のみのダミー最終行あり、保存で自動追加/削除しない）
  - markdownモードでは(un)ordered listの次行を発生させる

## カーソル移動（標準挙動）
- `←`,`→`,`↑`,`↓`1文字/1行 単位で移動
- `Home`行頭へ移動
- `End`行末へ移動
- `Ctrl+←`単語の前へ移動
- `Ctrl+→`単語の次へ移動
- `PageUp`,`PageDown`複数行を一気に移動（表示環境依存）
- `Alt+j`,`Alt+k`スムーズスクロール（上/下）

## 範囲選択（標準挙動）
- `Shift+矢印`文字/行単位で選択を拡張/縮小
- `Shift+Home/End`行頭/行末まで選択
- `Ctrl+Shift+←/→`単語単位で選択
- `Ctrl+A`全選択

## 文字削除（標準挙動）
- `Ctrl+Backspace`左側の単語を削除
- `Ctrl+Delete`右側の単語を削除

## クリップボード（Windows/Chromium 標準）
- `Ctrl+C`選択範囲をコピー（空選択時は行の既定動作は環境依存）
- `Ctrl+X`選択範囲を切り取り
- `Ctrl+V`貼り付け（改行やTABもそのまま挿入）

## Undo/Redo
- `Ctrl+Z`元に戻す（Undo）
- `Ctrl+Y / Ctrl+Shift+Z`やり直し（Redo、環境によりどちらか）
