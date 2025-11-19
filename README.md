# vi like text editor "six"

# インストール
zipファイルの中身をすべて1つのディレクトリ内に置き、install.cmdを実行する
⇒デスクトップにsixという名前のショートカットが作成される
※管理者権限なし・DLL等なしで実行できます

# Vimとの大きな違い
- バッファと1対1対応のタブを持ち、split/vsplitは実装予定なし。
- 編集モード(NORMAL/INSERT/VISUAL)をタブ毎に維持する
- ウィンドウのクローズボックスなどで終了したときも次回起動時に全バッファの状態を復元する
  - 未保存のバッファの内容も復元されるので、保存しないままWindowsをシャットダウンしても大丈夫
- `$`で行末に飛んだ際、行末文字の下の改行コードにcaretが乗る
- CUIオンリーではないのでvimのサブセットというよりはgvimのサブセットに近いかも

# 制限事項・断念事項
- Ctrl+Zでウィンドウを最小化 →諦めた
- IMEがONのときだけcaretの色を変更 →諦めた
- NORMAL/VISUALに移行したときに自動的にIMEをoffにする →諦めた

# Known Bugs
- オーバーレイパレットが縦スクロールバーに接するように右余白を調整したが、稀に縦スクロールバーに重なっているときがある。
  - 発生条件はよくわからないけど、再描画タイミングでウインドウ幅の取得に縦スクロールバーが含まれるタイミングと含まれないタイミングがあるとかかな？
- prompt#666あたりの、"XYZ␊a"のaをNORMALの`s`や`cl`でcaretがXに飛んでしまい␊が消失する現象がなかなか修正完了しないので「既知の不具合」としてペンディング中。

## 使い方
```
./six_wrap.ps1                       # デモテキストを開く
./six_wrap.ps1 sample.txt            # sample.txt を読み込み（_six.html と同じ場所を相対基点に解決）
./six_wrap.ps1 sample.txt _six.html  # HTML を明示しつつ sample.txt を開く（Position=0: Doc, Position=1: Html）
# または名前付き: ./six.ps1 sample.txt -Html _six.html
```

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
- 大容量ファイル最適化（遅延ロード / 差分再描画）未実装

## ライセンス / 出典
ガイド: `migration-prompt-webview2.md`
