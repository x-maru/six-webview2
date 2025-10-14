# six-webview2

six エディタを WebView (Edge app mode 代替) 上で最小構成で再現するための最小ランチャとクライアント実装です。  
HTA 版 six のレイアウト / THEME キーを踏襲しつつ、管理者権限不要・ローカル API なし（ブラウザピッカーのみ）で動作します。

## 構成

- `_six.html` : シェル (tabbar / editorViewport / gutter / textarea / caretLayer / cmdbar)
- `_six.css` : レイアウト + THEME 反映用 CSS Variables
- `_six.js` : 基本ロジック（`ensureScrolloff`, `updateGutter`, 行ロック骨子, :N ジャンプ）
- `_six-theme.js` : THEME 定義 (HTA 版キー近似)
- `six.ps1` : Edge app mode ランチャ（引数でファイル指定可、管理者権限不要）

## 使い方

PowerShell を本フォルダで開き:

```
./six.ps1                       # デモテキストを開く
./six.ps1 sample.txt            # sample.txt を読み込み（_six.html と同じ場所を相対基点に解決）
./six.ps1 sample.txt _six.html  # HTML を明示しつつ sample.txt を開く（Position=0: Doc, Position=1: Html）
# または名前付き: ./six.ps1 sample.txt -Html _six.html
```

起動後エディタをクリックしフォーカス。`j` / `k` で行移動。`:` を押して `100` 入力で `:100` ジャンプ。

## 外部ファイル読み込み

ランチャが `#doc=<相対パス>&name=<ファイル名>[&data=<base64>]` を付与。  
[`_six.js`](_six.js) 内の `_loadDocFromQuery()` が fetch → 成功時テキストを LF 正規化して表示。失敗または未指定ならデモシード。  
ブラウザ file:// 制約上、同ディレクトリ相対が安定。絶対パスは直接 fetch できない場合があるため、失敗時はピッカーをご利用ください。

### ファイルピッカー（ブラウザのみ）

ローカル API やネイティブファイルダイアログは使用しません。読み込み失敗時や明示的ピック時は、ブラウザの `<input type="file">` を用います。

- `:pick` … 即ブラウザピッカーを開く
- `:pick!` … `:pick` と同等（ネイティブ専用モードは無し）
- `:e ./`, `:e ../foo/` などのディレクトリ指定ヒントも、即ブラウザピッカーを開きます（初期ディレクトリ指定は不可）。

起動後の外部ファイル読み込みは `file://`（XHR → fetch フォールバック）により行われ、失敗した場合はブラウザピッカーを案内します。

## テーマ / スタイル

THEME オブジェクト（[`_six-theme.js`](_six-theme.js)）を起動時に [`_applyTheme`](_six.js) が CSS Variables へ反映。  
主変数:  
- `--bodyBGColor`, `--lineBaseFill`  
- `--gutterGradientStart`, `--gutterGradientEnd`  
- `--activeLineBg`, `--gutterNumberColor`, `--activeLineNumberColor`  
- `--eofGutterFillColor`, `--caretColor`, `--tabBarBg`, `--tabBarFg`  

## 実装メモ

- 行高/ガター幅: `--lh`, `--gw`（JS 側 LINE_HEIGHT と一致必須）
- ビューポート整数行クランプ: [`clampViewportExactLines`](_six.js) が水平スクロール必要時のみ予約領域差し引き
- スクロールオフ: [`ensureScrolloff`](_six.js) が方向別 / 中央寄せ条件 / EOF 下部余白 (+1行) を処理
- ガター: [`updateGutter`](_six.js) が可視行だけ仮想描画 + EOF 埋め
- キャレット帯: [`_repositionCaret`](_six.js) がアクティブ行 stripe を配置
- :N ジャンプ: [`runCommand`](_six.js) で `:N` → 一度だけ中央寄せ

## 既知の制限

- WebView2 ネイティブホスト未実装（Edge app mode 仮）
- caret 本体、選択描画、保存/再読み込み、エンコード切替未対応
- 大容量ファイル最適化（遅延ロード / 差分再描画）未実装
- ensureScrolloff 仕様は HTA 版完全再現の一部のみ（微調整余地）

## 今後の改善候補

- WebView2 (WPF / WinForms) ホスト化
- caret / selection overlay 実装
- ファイル保存 / 外部変更検知
- 高度な scrolloff 中央固定モード (scrolloff=99999)
- 行ロック安定化 (`_exactLineLockAdjust` 具体化)
- テーマ拡張 (caret gradient / shrink / active line gradient)

## ライセンス / 出典

移植元: HTA 版 six (/home/ymaru/work/HTA/six/six.hta, https://github.com/x-maru/six.git)  
ガイド: `migration-prompt-webview2.md`

