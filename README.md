# vi like text editor "six"

# インストール
zipファイルを解凍すると出てくるフォルダがそのままインストールパスになる。
レジストリは使わないしフォルダごと移動したりリネームしてもOK。
install.cmdを実行するとデスクトップに起動用ショートカット"six"が作成される。
フォルダを移したりした場合は再度install.cmdを実行する。
(install.cmdは単にショートカットを作成するだけ)
※管理者権限なし・DLL等なしで実行できます

# Vimとの大きな違い
- バッファと1対1対応のタブを持ち、split/vsplitは実装予定なし。
- 編集モード(NORMAL/INSERT/VISUAL)をタブ毎に維持する
- ウィンドウのクローズボックスなどで終了したときも次回起動時に全バッファの状態を復元する
  - 未保存のバッファの内容も復元されるので、保存しないままWindowsをシャットダウンしても大丈夫
- `$`で行末に飛んだ際、行末文字の下の改行コードにcaretが乗る
- CUIオンリーではないのでvimのサブセットというよりはgvimのサブセットに近いかも
  - タブ毎に異なる表示倍率にも出来る

# 制限事項・断念事項
- Ctrl+Zでウィンドウを最小化 →諦めた
- IMEがONのときだけcaretの色を変更 →諦めた
- NORMAL/VISUALに移行したときに自動的にIMEをoffにする →諦めた

# Known Bugs
- オーバーレイパレットが縦スクロールバーに接するように右余白を調整したが、稀に縦スクロールバーに重なっているときがある。
  - 発生条件はよくわからないけど、再描画タイミングでウインドウ幅の取得に縦スクロールバーが含まれるタイミングと含まれないタイミングがあるとかかな？
- prompt#666あたりの、"XYZ␊a"のaをNORMALの`s`や`cl`でcaretがXに飛んでしまい␊が消失する現象がなかなか修正完了しないので「既知の不具合」としてペンディング中。
- 右に行が伸びていくと横スクロールバーが出てマウス等でスクロール出来るが、1桁分狭い。。
- BOMの判定がうまく行かない(ことの方が多い)。_six.jsなどVS Codeで見るとBOMらしいけどsixではBOMなしと判定される
- 1万行を超えるとガター幅が少し足りない。
- やたら外部削除検出のダイアログが出る(削除してないのに)
  - 特定ファイルだけかも？あるいはwsl側で即時終了してレジュームした後のWindowsファイルか？？
- ↓TAB文字の桁がズレてる？
東京都新宿区、東京都荒川区、	東京特許許可局

## 使い方
```
./six_wrap.ps1
./six_wrap.ps1 sample.txt todo.txt
※実際には起動しっ放しでファイルオープンはsixの独自UIを使う。
```

## テーマ / スタイル

THEME オブジェクト（[`_six-theme.js`](_six-theme.js)）を起動時に [`_applyTheme`](_six.js) が CSS Variables へ反映。  
主変数:  
- `--bodyBGColor`, `--lineBaseFill`  
- `--gutterGradientStart`, `--gutterGradientEnd`  
- `--activeLineBg`, `--gutterNumberColor`, `--activeLineNumberColor`  
- `--eofGutterFillColor`, `--caretColor`, `--tabBarBg`, `--tabBarFg`  

## 既知の制限
- 大容量ファイル最適化（遅延ロード / 差分再描画）未実装

## ライセンス / 出典
ガイド: `migration-prompt-webview2.md`
