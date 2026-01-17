# コマンド

`:` から始まるコマンド入力

## 読み込み
- `:e `半角スペースまで入力で）ファイル選択ポップアップ
- `:e!`現バッファを再読込（変更破棄）。ファイル名は不要・無視

## 保存・終了
- `:w` 保存 / `:wa`すべて保存 / `:wq`保存して終了 / `:wqa`すべて保存して終了
- `:w!`強制保存（許可されている場合）
- `:q` 終了 / `:q!`変更破棄して終了 / `:qa`すべて終了

## ジャンプ
- `:N` N行目にジャンプ
- `:gg`1行目にジャンプ
- `:G` 最終行にジャンプ

## 置換

  ### 　書式
```
  :s/pat/repl/flags
  :%s/pat/repl/flags
  :'<,'> s/pat/repl/flags
```
  ### 　フラグ
    - `g`行内の全一致を置換（無指定時は各行内で最初の1箇所のみ）
    - `i`大文字小文字を無視する（case-insensitive）
    - `c`各候補ごとに確認モーダルを表示（y/n/a/q/u）
    - `n`件数のみを表示し、テキストは変更しない（非破壊）※replは無視

  ### 　範囲指定
    - `%`バッファ全体
    - `'<,'>`VISUAL 範囲（VISUAL 中に `:` を押すと自動付与）

  ### 　確認モーダル操作
    - `y`置換 / `n`スキップ / `a`以降すべて置換 / `q`中止 / `u`1手戻す（モーダル内）

  ### 　メッセージ
    - `replaced: N`置換数（0 の場合も `replaced: 0` を表示）
    - `X matches on Y lines` `n`フラグ時の件数表示（非破壊）

  ### 　エラー
    - 不正なフラグ（大文字など）が含まれる場合、エラーを表示し置換は実行しない
    - 正規表現コンパイルに失敗した場合も実行しない

  ### 　例
    - `:%s/foo/bar/g`　全行で `foo` を `bar` に全置換
    - `:'<,'> s/\bdog\b/cat/g`　選択範囲で単語 `dog` を `cat` に
    - `:s/^\s\+//`　先頭の空白を1箇所削除（現在行）

## grep
- `:grep /pat/flags %`カレントバッファを正規表現検索し、結果を別バッファに出力（リンクジャンプ可）
- `:grep [-r [-maxdepth N]] /pat/flags -basedir DIR[/] [FILEGLOB]`DIR を基点に検索（FILEGLOB 省略時は *。FILEGLOB に / や \ は不可）
- `:grep [-r [-maxdepth N]] /pat/flags PATH[/]`直接パス/グロブ指定（末尾 / は * を補完）
  - 注意: `-maxdepth` は `-r` が必須。オプション重複指定はエラー
- フラグ
  - `i`同一視 / `I`常に区別 / `s`混在時区別（smartcase）

## 検索ハイライト
- `:set hlsearch`有効 / `:set nohlsearch`無効 / `:set hlsearch!`トグル

## ビジュアルベル
- `:set visualbell`有効 / `:set novisualbell`無効 / `:set visualbell!`トグル / `:set visualbell?`状態表示
- 失敗時などにエディタ全体を一瞬黒くフラッシュ表示
- 既定値: 起動時 visualbell=on（SIX_OPTIONS.visualbell===false なら off）

## 制御文字表示
- `:set list`有効 / `:set nolist`無効 / `:set list!`トグル / `:set list?`状態表示
- 表示内容: タブ → '▸' / 行末 → '↲' / 末尾の空白 → '·'
- 行末記号色: 'LF(unix)' 緑 / 'CRLF(dos)' 青 / 'CR(mac)' 赤
- 既定値: 起動時 list=on（SIX_OPTIONS.list===false なら off）

## 表示
- `:set scrolloff=N`スクロールオフ（上下余白行数） / `:set scrolloff?`現在値表示 / `:set so=N`省略形
- `:set wrap`表示折り返し（改行は挿入しない） / `:set nowrap`折り返し無効 / `:set wrap!`トグル / `:set wrap?`状態表示
- ※markdownモードではwrapの値に関わらず常に折り返し表示になる
- 既定値: セッション未保存時 scrolloff=3（変更はセッションへ保存し次回復元）

## インデント
- `:set shiftwidth=N`/`:set sw=N` インデント幅（半角スペース数）を設定（バッファ毎・セッション保存・既定値4）
- `:set shiftwidth?`現在の`shiftwidth`を表示

## 検索時の文字種扱い指定
- `:set ignorecase`/`:set noignorecase` 検索で大文字小文字を無視 / 区別（バッファ毎）
- `:set ignorecase!`トグル / `:set ignorecase?`状態表示
- `:set smartcase`/`:set nosmartcase` 英大文字含むパターンのときだけ大文字小文字を区別
- `:set smartcase!`トグル / `:set smartcase?`状態表示

## その他
- `:pick`ピッカー起動 / `:pick!`強制起動
- `:help`このヘルプを開く
- 右下オーバーレイ: `ヘルプ`(F9 と同等) / `検索ハイライト`ON/OFFトグル
- タブ切替: `F1`〜`F8`で直接切替（`:b`ポップアップでも F キー確定可）
