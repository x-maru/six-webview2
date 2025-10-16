#01
- migration-prompt-webview2.mdに沿ってテキストエディタsixを完成させたい。

#02
- README.txtを識別子や簡単な単語を除いて日本語化して上書き保存して。
- 引数で渡された文字列をファイル名と解釈して開くように修正して。
- HTA版sixのstyleを踏襲するように修正して。
- このファイル(prompt.md)は書き換えないように。
- 変更はパッチではなく直接ファイルを書き替えて反映して。

#03
- 引数で渡された文字列をファイル名と解釈して開くようにして。
- 必要ならREADME.mdを更新して。

#04
"six.ps1 _six.html"で起動しても「The quick brown fox jumps over the lazy dog.」の行が延々と表示されるだけだ

#05
"six.ps1 _six.html"で起動時にエラー。
```
PS C:\Users\ymaru\WebView2\six> .\six.ps1 .\_six.html
発生場所 C:\Users\ymaru\WebView2\six\six.ps1:15 文字:1
+ }
+ ~
式またはステートメントのトークン '}' を使用できません。
    + CategoryInfo          : ParserError: (:) [], ParseException
    + FullyQualifiedErrorId : UnexpectedToken
```

#06
jsファイルなどをBOMなしUTF-8で保存していたのでBOM付きで保存し直したところ、起動時エラーはなくなった。
- "six.ps1 _six.css"で起動するとEdge Browser内で「ファイルが見つかりません ERR_FILE_NOT_FOUND」となってしまう。
- "six.ps1 _six.html"で起動するとエラーはなく、引数を指定しなかった場合と同じに見える。これはPowerShellの仕様で引数にhtmlを指定した場合に「WebView2で表示すべきレイアウトファイル」とみなされてしまうからか？ だとしたらその挙動を抑止して普通にオープン対象として扱いたい。

#07
- _six.cssを指定しても変わらずERR_FILE_NOT_FOUNDになる。
  - ウインドウのタイトルバーには"file:///C:/Users/ymaru/WebView2/six/_six.html%3Fdoc=_six.css"と出ている
- _six.htmlを指定した場合もERR_FILE_NOT_FOUNDが出るようになった。

#08
- "six.ps1 .\six.css"でも"six.ps1 .\_six.html"でもERR_FILE_NOT_FOUNDにはならなくなったが、引数が無視されているようだ。
  - どちらもウインドウのタイトルバーには"six-webview2(skeleton)"と出ている。

#09
引数指定したファイルをオープンできるようになった。
- cmdbarが見えず、:を入力するとダイアログがオープンするが、そこでqなど入力してOKしても何も起きない。cmdbarが見えて機能するようにしよう。

#10
cmdbarは見えないまま。:を入力しても何も起きずただキーボードフォーカスが消えるのみ。

#11
- 1,2,3,4) OK
- このあとの実装順のおすすめを提案してほしい。

#12
下記の順に実装したい。
  5.コマンドレイヤ拡張（小さく速く）
  3.ガター描画の仕上げ
  2.キャレットオーバーレイの本実装
  ?.qの実装
  6.THEME→CSS変数の拡充
  ?.caret点滅
  8.ファイルロード/保存の方針固め
  1.スクロール挙動の完成度を上げる
  4.ビューポート行ロック/HSB 予備領域の確定
  7.大きめファイルの快適化
  8.ファイルロード/保存の方針固め
なお「10.WebView2 ネイティブホスト化」は実装しない。

#13
- :qは動作している。
- 「6.THEME→CSS 変数の拡充」→グラデーション描画された箇所がないので確認できず
- caret点滅 →点滅しているが、デフォルトのIビームは抑止して赤グラデーションの自前caretを描画したい。HTAのときは表示されず、htmlをChromeで表示したら赤caretも表示されていた
- 次はキーボードフォーカスの修正を。
  - 起動直後、どこにもフォーカスがなく、マウスクリックするまでキー操作が出来ない
  - マウスクリックするとIビームが現れるが、:以外に何も受け付けられない
- caret行の描画もされなくなった。描画がなくなったというよりcaret行が画面外なのかも。

#14
- 起動後に赤いcaretが点滅しているが、j/kでは何も反応しない。:も効かない。
- 既定のIビームが消えて赤caretが点滅しているが、細くてグラデーションが効いているのかよくわからない。HTA版ではcaret幅をTHEME.caretShrinkRemで定義し、font-sizeの90%ほどにしていた。
- アクティブ行帯は一度も見えていない
- マウスでクリックすると:に反応するようになる(j/kには無反応)。ここからEscで抜けるとj/kが効いてcaretが付いてくる。
- :10などは効いていない。
- [INSERT][NORMAL]といった表示もなく、ちゃんとモードが分かれていないようだ(j/kで移動できる状態でh/lはそのままinsertされる)

#15
- 起動直後はNORMALモードで jkhli: が効くようになった。
- :5 Enterとすると行5にcaretが移動するが、フォーカスがコマンド入力欄に残ったままになる(":5"もそのまま残っている)
- [NORMAL][INSERT][CMD]の移行(i, Esc, :, Esc)はOK
- NORMALでj/kなどが効く状態でggと入力するとEOFあたりにggと入力されて移動にはならない。Gも同様(:gg, :Gなどというコマンドは実装不要)
- アクティブ行帯は一度も見えていない
- scrolloffの実装・動作確認はあとまわし。

#16
- NORMALモードで、数字キーやEnterの他、コマンドとして対応していないキーがEOF行に挿入されてしまう。
- :20などで飛んだあとEOF行に改行が挿入されてしまう。

#17
- :gg, :Gは不要なので削除して。(NORMALモードでのgg, Gは必要)
- 未対応キーや余計な改行がEOFに挿入される現象は解消した
- 次は:eを実装したい。同時にバッファーの概念も。

#18
- NORMAL gg/G → OK
- :e フルパス → OK
- :e ファイル名のみ → open failed
  - フルパスでない場合は現バッファのパスを相対パスの基点にしたい。空のバッファの場合はsix.ps1の場所。
- :e のみ →open failed
- 未対応キーがEOFに挿入される現象が再発 (タイトルに"*"が付くと同時にEOFに文字挿入される)

#19
フルパスまで開けなくなってしまった。
- :e フルパス → NG ('//wsl.localhost/...', '\\wsl.localhost\...', 'C:\Users\ymaru\HTA\six\six.hta' いずれもopen failed)
- :e ファイル名のみ → open failed
- :e 相対パス → open failed
- :e のみ → open failed
- 未対応キーがEOFに挿入される現象は発生せず

#20
- :e フルパス → NG ('//wsl.localhost/...', '\\wsl.localhost\...', 'C:\Users\ymaru\HTA\six\six.hta' いずれもopen failed)
- :e ファイル名のみ → open failed
- :e 相対パス → open failed
- :e のみ → open failed

#21
- ':e c:\Users\ymaru\HTA\six\six.hta' → open failed → ダイアログ(直前のパス。C:\Users\ymaru\Downloadsなど)
- ':e _six.css', ':e .\six.css', ':e ./six.css' → open failed → ダイアログ
- :e のみ → open failed → ダイアログ
- いずれも存在するはずのパスなのでopen failedになってしまうのを解決したい。

#22
- いずれのケースもopen failedダイアログをskipしてピッカーが出るようになっただけ。普通のCドライブフルパスでも駄目。
- open failedが出ていたタイミングで代わりにカレントバッファのEOFに飛んですぐ元のcaret位置に戻ってからピッカー、という動き。
- 引数なしで起動してすぐ:e のみで実行してもピッカーが出る。

#23
- :e のみ → OK。open failedもピッカーも出ず。(*1)
- 引数なしで起動したのち':e _six.css' → OK。open failedもピッカーも出ずバッファ化成功
- 引数なしで起動したのち':e .\_six.css' → OK。open failedもピッカーも出ずバッファ化成功
- 引数なしで起動したのち':e ./_six.css' → OK。open failedもピッカーも出ずバッファ化成功
- 引数なしで起動したのち':e ../six/_six.css' → OK。open failedもピッカーも出ずバッファ化成功
- (*1)最初に:e のみを試したとき、ウインドウ上部に警告が出「サポートされていないコマンドラインフラグ: --disable-web-securityを使用しています。これにより、安全性およびセキュリティに関するリスクが生じます。」
  - そのまま:qで閉じてもウインドウは消えるがsix.ps1の処理が5分待っても終わらず、Ctrl-Cで止めた。
  - 初回だけだとしても、このような警告・症状が出るものを配布して使わせるのはまずい。回避策はあるか？
  - また、開発中の試験用に警告をリセットして再度同じ警告が出る状態にする方法はあるか？

#24
"six.ps1 -ResetProfile" → ```
C:\Users\ymaru\WebView2\six\six.ps1 : パラメーター名 'ResetProfile' に一致するパラメーターが見つかりません。
発生場所 行:1 文字:11
+ .\six.ps1 -ResetProfile
+           ~~~~~~~~~~~~~
    + CategoryInfo          : InvalidArgument: (:) [six.ps1]、ParameterBindingException
    + FullyQualifiedErrorId : NamedParameterNotFound,six.ps1
```

#25
ただの操作ミス(更新反映忘れ)だった。"six.ps1 -ResetProfile"で再び警告が出た。が、2度目が出ない。-ResetProfileが効くのは1度きり？

#26
今のsix.ps1は--disable-web-securityを付けていないから警告が出ない旨、了解。
- 存在しないファイルを指定するとピッカーが出るが、ピッカーが開く初期ディレクトリを「相対パスの基点」としたパスにすることはできる？

#27
- ブラウザピッカーは使わずネイティブダイアログ(/pick追加)がいい。
- 他機能の実装が済んだあとの予定だけど、HTA版と同じようなファイル名補完候補の自前ウインドウを出しつつインクリメンタルに絞っていく方式を実装し、そのウインドウ下部のボタンを押すとネイティブダイアログを開くこともできる、という仕様を考えている。

#28
- ':e foo.txt'(存在しないファイル)としても何も起こらない。
- ':e ./' とすると何かのファイルがバッファに入ったが、何のファイルかわからない。タイトルバーには「 ./ 」と出ている
  - ':e ./' や':e ../foo/' とした場合にはそのパスをネイティブダイアログで開いてほしい。

#29
':e ./'などパス指定した場合に何も起きなくなった。存在しないファイルを指定しても何も起きない。まだネイティブダイアログを見たことがない。

#30
変わらずネイティブダイアログが開かない。引数無しの"six.ps1"だけで起動して、同じパスにある_six.cssを開こうとしても何も起きない(読み込まない)。
:pickでも何も起きない。

#31
- 'six.ps1 -ResetProfile'で起動して':e ./'としたらカレントディレクトリではない場所のピッカー(？)が開いた。ネイティブなのかブラウザなのかの見分け方がわからない。
- ':e foo'(存在しないファイル)でも同じ。':e 'でも同じ。':pick'でも同じ。
- ':e _six.css'でも同じ。six.ps1と_six.cssは同じ場所に存在するのに。
- :qで抜けたあとsix.ps1から戻ってこない。
  - 最大12時間待つと書いてたが、長く待つ意味は？ 1分も待てば十分なのでは？
- 'six.ps1 -ResetProfile'で起動する前に一度--disable-web-securityの警告が出たのだが、再現しなくなった。
- 「Edge アプリモードの URL に #api=http://127.0.0.1:PORT/ が含まれていますか？」← 確認方法を教えて。

#32
- 『Edge アプリウィンドウ上で右クリック → 「URL をコピー」（またはウィンドウのコンテキストメニューから URL 関連）』←わからない。six.ps1を実行して開くウインドウと「Edgeアプリウインドウ」は別物？six.ps1実行で開くウインドウの内側やタイトルバーで右クリックしてもURL関連のメニュー項目が見当たらない。
- ':e カレントに実在するファイル'としたときピッカー等出ずに正しく読み込まれるようになった。
- :e にファイル引数、フォルダ引数、引数なしなど、いずれの場合もワンテンポ遅れてピッカーが出る。「モバイルからアップロード」ボタン等が付いているし、ブラウザピッカーだと思われる。
- :pick Enterで即[NORMAL]に戻り、ワンテンポ置いてからブラウザピッカーが開く。

#33
- ':api?' → 'api = http://127.0.0.1:57340/'
- ':pick!' → 'native picker canceled or failed'

#34
- ':api?' → 'api = http://127.0.0.1:57454/'
- ':pick!' → 下記の小ダイアログが出た状態のままF12を押してもConsoleに何も出ていないがOK後のF12では出ていた。
```
このページの内容:
native picker canceled or failed
```
  - F12後のConsole:
```
_six.js:162  AbortError: signal is aborted without reason
    at _six.js:155:47
(anonymous) @ _six.js:162
```
- STAって何？
- 相対基点は今の設計でよい。PowerShellのCWDにしたいケースはない。

#35
- ':api?' → 'api = http://127.0.0.1:53598/'
- :pick! → F12 Console:
```
127.0.0.1:62172/pick?cwd=file%3A%2F%2F%2FC%3A%2FUsers%2Fymaru%2FWebView2%2Fsix%2F:1   Failed to load resource: net::ERR_CONNECTION_REFUSED
_six.js:159  TypeError: Failed to fetch
    at _pickNative (_six.js:155:12)
    at runCommand (_six.js:572:7)
    at HTMLInputElement.<anonymous> (_six.js:658:21)
(anonymous) @ _six.js:159
```

#36
- ':api?' → 'api = http://127.0.0.1:55452/'
- :pick!
```
127.0.0.1:55452/pick?cwd=file%3A%2F%2F%2FC%3A%2FUsers%2Fymaru%2FWebView2%2Fsix%2F:1   Failed to load resource: net::ERR_CONNECTION_REFUSED
_six.js:159  TypeError: Failed to fetch
    at _pickNative (_six.js:155:12)
    at runCommand (_six.js:572:7)
    at HTMLInputElement.<anonymous> (_six.js:658:21)
(anonymous) @ _six.js:159
```

#37
- ':api?' → ```api = (none)```
- ':pick!' → ```native API not available (no #api)``` → F12 Console: 何も出ず
- 少し前の版からだが、:qで抜けるとsix.ps1を実行していたPowerShellプロセスまで終了してしまう。

#38
- six.ps1を実行していたPowerShellプロセスが終了するのは:qで抜けたときではなかった(少なくともこの版では)。
```
PS C:\Users\ymaru\WebView2\six> .\six.ps1
Health check failed for http://127.0.0.1:58823/. Disabling local API.
TcpListener start failed

[プロセスはコード 2 (0x00000002) で終了しました]
このターミナルを Ctrl+D で閉じるか、Enter キーを押して再起動できます。
```
- :api? と :pick! の結果は前回と同じ。

#39
起動しなくなった。
```
PS C:\Users\ymaru\WebView2\six> .\six.ps1

[プロセスはコード 2 (0x00000002) で終了しました]
このターミナルを Ctrl+D で閉じるか、Enter キーを押して再起動できます。
```
- いま気づいたが、裏でファイル選択ダイアログが大量に出ていた。「モバイルからアップロード」のボタンが無いので、これがネイティブピッカー？
- 完全にWindows専用でいい。Linux/Macで動作する必要なし。

#40
起動しない。1,2秒後にプロセスが終了した。他のウインドウの下にもいない。
```
PS C:\Users\ymaru\WebView2\six> .\six.ps1 -ShowUrl

[プロセスはコード 2 (0x00000002) で終了しました]
このターミナルを Ctrl+D で閉じるか、Enter キーを押して再起動できます。
```
「裏で大量に出ていたダイアログ」は一度のsix.ps1プロセスで出たわけではないと思う。#22あたりから出ていないと思っていたネイティブピッカーが実は他のウインドウに隠れて出ていたのかもしれない。(six.ps1プロセス終了時に同時に閉じてほしいが)

#41
- 下記メッセージが出るが起動した。
```
PS C:\Users\ymaru\WebView2\six> .\six.ps1 -ShowUrl
six.ps1 starting in: C:\Users\ymaru\WebView2\six
Skipping HttpListener (not elevated). Using TcpListener fallback.
HTTP API: TcpListener on http://127.0.0.1:63196/
TcpListener start failed: "Thread" に複数のあいまいなオーバーロードがあります。引数の数は "1" です。
Launching URL: file:///C:/Users/ymaru/WebView2/six/_six.html
```
- `:api?` → `api = (none)`
- `:pick!` → `native API not available (no #api)` 裏にもピッカーは出ていない。

#42
起動しない。1,2秒後にプロセスが終了した。他のウインドウの下にもいない。
```
PS C:\Users\ymaru\WebView2\six> .\six.ps1 -ShowUrl
six.ps1 starting in: C:\Users\ymaru\WebView2\six
Skipping HttpListener (not elevated). Using TcpListener fallback.
HTTP API: TcpListener on http://127.0.0.1:55802/

[プロセスはコード 2 (0x00000002) で終了しました]
このターミナルを Ctrl+D で閉じるか、Enter キーを押して再起動できます。
```

#43
最終的に管理者権限のない環境で動作させるのが目的なので、一度だけでも管理者で実行することは不可。
なのでパッチ適用前に戻した。解決方法がない場合はネイティブピッカーの使用は諦める。

#44
起動しない。1,2秒後にプロセスが終了した。他のウインドウの下にもいない。
```
PS C:\Users\ymaru\WebView2\six> .\six.ps1
six.ps1 starting in: C:\Users\ymaru\WebView2\six
Skipping HttpListener (not elevated). Using TcpListener fallback.
HTTP API: TcpListener on http://127.0.0.1:61290/

[プロセスはコード 2 (0x00000002) で終了しました]
このターミナルを Ctrl+D で閉じるか、Enter キーを押して再起動できます。
```

#45
:e →OK, :e . →OK, :e _six.css →OK, :pick →OK, :e ../HTA/six.hta →OK
`six.ps1 _six.html` →OK (編集対象として開かれる)
:api? →`api = (none)`
- :e //wsl.localhost/Ubuntu/home/ymaru/work/WebView2/six/promptmd →NG(ピッカー)
- :q →six.ps1のプロセスが終了しない (NG)

#46
- :qでsix.ps1が終了しない件は変わっていない。
- `six.ps1 \\wsl.localhost\Ubuntu\home\ymaru\work\HTA\six\six.hta`のように引数で渡せば問題なく開けるが、そこから`:e _six.css`などと同パスにあるファイルを指定してもピッカーが開いてしまう。

#47
- :qでsix.ps1のプロセスが終了するようになった。(OK)
- `six.ps1 \\wsl.localhost\Ubuntu\home\ymaru\work\HTA\six\six.hta`で開いた状態から`:e _six.css`などと同パスにあるファイルを指定してもピッカーが開いてしまう。(許容)
- `six.ps1 C:\Users\ymaru\WebView2/six/_six.css`で開いた状態から`:e _six.html`などと同パスにあるファイルを指定するとピッカーなしで正常に開くことができた。(OK)
- `six.ps1 new-file.txt`などと存在しないファイルを引数で渡して起動しても引数なしで起動したのと同じ挙動になる。(NG)

#48
OK。次はバッファ関係のコマンドを実装していきたいが、先にUIから。HTA版と同じように、画面上部(今"six-webview2"とだけ表示されている領域)にタブバーを表示したい。
- カレントバッファだけ(あれば)フルパスや相対パスで、他のタブはファイル名のみで表示
- modifiedの印(赤で * )もタブ内に表示
- HTA版のタブバーではバッファ番号を埋め込んでいたが、それはあとから追加するのでペンディング

#49
- Windows標準パーツのタイトルバー部分にもバッファ名と*が表示されているが、要らない。あれがタスクバーなどでウインドウ名(？)として扱われるなら、100%透過色として表示するのがいい。
- 次は複数バッファ対応を。viの:lsの代わりに実装したHTA版sixのバッファ名補完ポップアップを移植したい。「:b」とタイプしたところで出現する。(image-1760603900044.png)

#50
- バッファ切替ポップアップ内で振られる番号(1,2,...)に対応する(①～⑳,21,...)をタブ内のファイル名先頭に付与する、というのは次のステップと思っていたが、同時に進めるでもよい。

#51
「次の一歩（ご提案）」を進めて行こう。

#52
`:b`でポップアップが出ない。

#53
OK。次に進もう。

#54
OK。次は:bのインクリメンタル絞り込みを。
あと、タブの上にマウスホバーしたときのカーソルをクリッカブルなものに変更できるなら。

#55
- `:b1`とした瞬間にポップアップが消えているが、「①  foo.txt」などが選択された選択された状態で残ってほしい(Enterで確定)。
- `①  foo.txt` `② bar.txt`があるとき、`:b b`なら②にヒットしてほしい。つまり「番号込みのファイル名」と「ファイル名そのもの」のどちらでもマッチするように。
- タブバーもポップアップも、①～⑳だけフォントサイズをはみ出さない程度に上げてほしい。

#56
- HTA版にあわせて仕様変更。
  - バッファが3つあるとき`:b2`などとすると②が即確定(:bの後ろに空白なし)
  - 入力に応じてインクリメンタルにマッチする候補だけを表示する 
  - バッファ数が10～19のときは`:b2`は即確定だが`:b1`は候補絞り込みだけ
  - `:b 2`では選択にとどめる。(:bの後ろに空白あり)

#57
バッファ3個の場合に
- `:b2`で即確定 → OK
- `:b 2`で選択のみ → OKだが、"2*"にマッチする候補だけの表示にしたい
- `:b foo` → NG
  - 先頭一致で見ず「含まれていたら一致」としているような動き。"_aX, _bX, _cX, XYZ"の4候補のとき`:b _`では3候補だけの表示になるが`:b X`では4候補とも表示されている
- 10個以上のケースは後ほど確認（一旦OKとして進める）

#58
- 概ねOK。`:b xxx`でマッチするものがない状態でEnterを押したら"No such buffer: xxx"とか表示するようにしよう。
- 他、下記の不具合を見つけた。
  - 起動時に引数で2ファイルまでしか渡せない (引数3つ付けるとエラー)
  - 起動時に引数で2ファイル指定したらコマンドバーも表示されずcaretも出ず何もできない。アプリタイトルバーには長い文字列

#59
- ファイル引数2つでエラー。
```
PS C:\Users\ymaru\WebView2\six> .\six.ps1 .\_six.css .\_six.js
C:\Users\ymaru\WebView2\six\six.ps1 : 引数 '.\_six.js' を受け入れる位置指定パラメーターが見つかりません。
発生場所 行:1 文字:1
+ .\six.ps1 .\_six.css .\_six.js
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : InvalidArgument: (:) [six.ps1]、ParameterBindingException
    + FullyQualifiedErrorId : PositionalParameterNotFound,six.ps1
```
- `No such buffer: xxx`のダイアログは正常に表示されたが、ダイアログ内の「このページの内容:」という文言を無くしたい(空文字列でいい)。

#60
- ファイル引数2つで下記のエラーを出しつつ起動するが「①untitled」バッファ(引数無し起動時のバッファ)のみ。
```
PS C:\Users\ymaru\WebView2\six> .\six.ps1 .\_six.css .\_six.js
six.ps1 starting in: C:\Users\ymaru\WebView2\six
"1" 個の引数を指定して "EscapeDataString" を呼び出し中に例外が発生しました: "無効な URI: Uri の文字列が長すぎま
す。"
発生場所 C:\Users\ymaru\WebView2\six\six.ps1:98 文字:3
+   $qsBundle = [System.Uri]::EscapeDataString($b64)
+   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:) [], MethodInvocationException
    + FullyQualifiedErrorId : UriFormatException
```
- トーストは正しく表示されるが、短すぎるので5秒にして。
- ` -Html _six.html`はOK

