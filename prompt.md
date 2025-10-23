#100
- 起動時の問題は再現率が低いので未確認だが、やり直せば問題ないケースがほとんどなので、頑張ってリカバリーせずに「起動に失敗しました。再度お試しください。」とconsoleに出力して終了でいい。
- `:e //` → カレント配下(先頭に"../") → NG
  - 「変化せず直前の一覧のまま」はやめよう。パスとして不正な文字列になっている瞬間は"********"と表示しよう('*'8個)。
    - 現状ではたとえば`:e /::::/`などとしてもCドライブルート直下の一覧が出るのも防ぎたいし、このような場合も"********"で。

#101
- 「bare “:e” は何もしない。":e " でポップアップが開く。」 →OK
- 「":e //" または ":e //host" の途中は一覧の代わりに “********” 表示のまま。」 →NG
  - ":e //"カレント配下の一覧が出てしまう
  - ":e //ws"までは"(no entries)"
  - ":e //wsl"でカレント配下の一覧が出てしまう
  - 以降WSLパスの入力を続けてもずっとNG。
- 「":e /::::/" など無効文字列は “********”。無効が解消されると列挙へ遷移。」 →一部OK
  - "::"などと入力している最中こそ"********"で表示したいのに"/"を入力したところで初めて"********"になる。
  - "..."とか"///*"とか、NTFSでパス名に使えない文字列はすべて無効扱いしたい。
- 「":e!": 現バッファの再読込。」→OK

#102
- “:e //” と “:e //ws” はずっと '********'（一覧は出さない）
  - OK
- “:e //wsl” でもホスト未確定のうちは '********' で止まり、末尾に “/” を付けて “//wsl/” になって初めて列挙に移行
  - ほぼOK。"//wsl.localhost/"と入力したときに"C:/"の直下が列挙されてしまう。
    - 以降WSLパスの入力を続けてもずっとNG。
    - "//wsl.localhost/Ubuntu/"で初めてホスト名と同等の「ツリーのルートが存在する状態」になるのであって"//wsl.localhost/"だけでは何も表示できないはず。ここで"Ubuntu/"を候補に出せるなら理想的だが、無理なら「ホスト未確定」と同じ状態として扱いたい。
- “:e /::::/”, “:e ...”, “:e ///*”, “:e <name>” などのNTFS的に不正な瞬間も '********' を即時表示
  - OK

#103
- `:e //wsl.localhost/` →この段階で"********"になるのはよいが、内部で"C:/"として扱っているようで
  - 続けて'w'と入れると"Windows/"がヒットするし'pr'だと"Program Files/","Program Files (x86)/","ProgramData/"がヒットする。
    - 以降WSLパスの入力を続けてもずっとNG。("//wsl.localhost/Ubuntu/"と入力してもだめ)

#104
- `:e //wsl.localhost/Ubuntu/`で正しくUbuntu側ルート配下の一覧が現れ、"home/" "ymaru/"とポップアップで選択したあと、
  1.ポップアップで"work/"を選択した場合
    - ポップアップ一覧が変化しない(=workの中に入らない)のにコマンド入力欄に"work/"が足される。選択する度に"work/work/work/..."と足されていく。
  2.手入力で'w'と入力すると"work/"が一覧に現れ、"work/"まで手入力すると".../home/ymaru/"配下の一覧が表示される。

#105
- `:e //wsl.localhost/Ubuntu/`で正しくUbuntu側ルート配下の一覧が現れ、"home/" "ymaru/"とポップアップで選択したあと、
  1.ポップアップで"work/"を選択した場合
    - ポップアップ一覧が"../"だけになる(サブフォルダやファイルがあるはずなのに)
    - コマンド入力欄に"../"が足される。
  2.手入力で'w'と入力すると"work/"が一覧に現れ、"work/"まで手入力すると".../home/ymaru/"配下の一覧が表示される。
- 「“//wsl.localhost/” 段階で Ubuntu 等の共有名候補を出すには、API 側に “host の共有列挙” エンドポイントが必要になります。現仕様の“無効＝'********'”方針のままでも良いですが、将来的に共有列挙を入れる場合はその設計も可能です（必要なら提案します）。」 →ぜひ。

#106
ポップアップの一覧から選択するのみなら、wsl側のファイルも正しく選択して開けるようになった。
- "//wsl.localhost/home/"の続きをコマンド入力欄で手入力するとおかしくなる。
  - "home/"の下には"ymaru"というフォルダが1つあるだけだが、これを手入力すると再度"ymaru/"が候補に現れ、選択しても"ymaru/ymaru/"となって候補は"../"だけになり、そのあとパスを編集してもおかしくなる。
- 「共有名候補の設計提案」でお願い。

#107
- "//wsl.localhost/"配下の候補として3つ出た。"/"2つは不要。。
  - Ubuntu/
  - /
  - /
- "Ubuntu/"←これはsix画面からTerminalのVimにコピペしてきた文字列でASCII文字に見えるが、Six上では"U b u n t u /"のように見える。そのためだと思うが、以降のwslパスを続けて入力してもマッチしない。
- UNC共有フォルダはTODOとして将来検討でよい。(Windows環境ではネットワークドライブを割り当ててあるので困らない)

#108
- :e //wsl.localhost/ → ディストリ候補（Ubuntu/ など）が1つずつ表示されるか。
  - OK
- :e //wsl.localhost/Ubuntu/ → ルート配下一覧 → “home/” → “ymaru/” とドリルダウン。ポップアップ選択でも手入力でも一覧が正しく更新されるか。
  - ポップアップ選択はOK
  - ":e //wsl.localhost/"で"Ubuntu/"が候補に表示されているときに'U'とタイプしても"********"になる。
    - 構わず"Ubuntu/"まで入力するとUbuntu側ルート直下の一覧に復帰できる
  - ":e //wsl.localhost/Ubuntu/home/"から手で"ymaru/"と入力すると、以降正しくマッチしなくなる。
  - ":e //wsl.localhost/Ubuntu/"以降をすべて手で入力した場合はwslパス上のファイルを選択して開ける。
- WSLに限らず、同じパスの同じファイルを何度も別バッファとして開けてしまう。
  - 例）引数なしで起動して`:e six.ps1` `:e six.ps1`で"six.ps1"のバッファが2つ出来る
- “Ubuntu/” をターミナルの Vim からコピーして貼り付け → 入力欄では “U b u n t u /” に見えず、フィルタが効くか。
  - OK

#109
- :e //wsl.localhost/
Ubuntu/ など1件ずつ表示。余計な “/” は出ない。
  - OK
- “U” とタイプしても “********” にならず、Ubuntu が絞り込み表示のまま。
  - OK
- :e //wsl.localhost/Ubuntu/
ルート配下 → home/ → ymaru/ へ進み、ポップアップ選択・手入力どちらでも一覧更新が正しく継続。
  - ポップアップで"../"を選択したときコマンド入力に"../"がappendされてしまう
  - 手入力で"h"と入力すると"(no entries)"になってしまう。構わず"home/"まで入力すると先に進められる。
  - 手入力だと"home/ymaru/"まではOKだが"work/"で候補が"../"だけになる。構わず's'とタイプすると"sample.md"が候補に現れる
- 同じファイルを二度開く
:e six.ps1 を連続で実行しても新規バッファが増えず、既存へ切り替わる。
  - OK

#110
:e //wsl.localhost/Ubuntu/
- ルート配下 → home/ → ymaru/ とポップアップ選択、手入力どちらでも一覧が更新。
  - ポップアップ選択 →OK
  - 手入力 →75%くらいの確率でOKだが、何度かに1度マッチするはずなのに"../"のみになったり"(no entries)"になることがある
    - 一度そうなるとbackspaceで"e: /"まで戻らないとおかしなまま。
- ポップアップで「..」を選ぶと、入力欄に「../」が追記されずに1階層上へ戻る（末尾を1段削る）。
  - OK
- ":e "以降の入力中、TabキーもEnterと同じ選択動作にしたい。

#111
"//wsl.localhost/Ubuntu/home/"の次のディレクトリ名(ユーザ名)のところを手入力する際におかしくなる確率が相対的に高い。
  - いくつもサブフォルダやファイルがあるはずなのに"../"だけになったり"(no entries)"になったり。
  - しばらく触りつつ、発生条件が絞れたら対処しよう(一旦放置)。
- ポップアップのUIをtextarea内の上寄せから下寄せに変更したい。
- ":e //"の直下に疑似的に"wsl.localhost/"という候補を常に表示したい("w Tab"で補完入力したい)。

#112
- 手入力で":e //wsl.localhost/"まで入力したときは"Ubuntu/"が候補として出てくるが、":e //"だけで出てくるポップアップ候補の"wsl.localhost/"をTabやEnterで選ぶと"../"しか候補が出てこない。
- ":e //"の候補から"../"を除きたい。(UNC対応を実装するまでは)"wsl.localhost/"のみが候補。
- "../"で親ディレクトリに戻ったとき、戻る前にいたフォルダの位置にカーソルが来るようにしたい。
  - コマンド入力欄で言えば"foo/bar/" → "../" → "foo/bar"になるということ。

#113
- `:e //`の候補から"../"が除外された。 →OK
- `:e //`の候補に"wsl.localhost/"(だけ)が表示されているとき、
  - Enter/クリック → "../"だけが候補として表示される (正しくは"Ubuntu/")
  - Tab → "(no entries)"になる (正しくは"Ubuntu/")
- 「もし「foo/|bar」のようにキャレット位置まで厳密に再現したい場合は、typedDirRaw の末尾セグメント位置を保持してカーソル移動を制御する拡張が必要です。必要なら追従します。」 →caret位置まで再現したい。

#114
- `:e //`でポップアップ内候補の"wsl.localhost/"を、
  - クリックした場合 → "../"しか出ない
  - Enter/Tabで選択した場合 → "../"と"Ubuntu/"が出る。("../"は出てほしくない)
- "../"をクリックした場合、候補が「今いたフォルダ」のみになってしまう。(NG)
- "../"にカーソルを持って行ってEnter/Tabで選択した場合、「今いたフォルダ」にカーソルが移動していない (NG)
- ポップアップの下寄せUIはOK。いい感じ。

#115
NORMALモードなのに:の入力までTextareaに挿入されてしまって何も出来ないのでパッチ前に戻した。改めて慎重に#114への対応を。

#116
- `:e //`でポップアップ内候補の"wsl.localhost/"を選択すると"Ubuntu/"が唯一の候補として表示されるが、"Ubuntu/"を選択すると候補が"../"だけになってしまう。
- 「"wsl.localhost/Ubuntu/"まで選択→"../"のみ→Escでキャンセル」を2回実行すると、3回目はクリック/Enter/Tabの手段に依らず"wsl.localhost/"を選択するとコマンド入力欄にappendされるが"wsl.localhost/"のまま変わらず、クリックする度に何度でもappendされ続ける。
  - "wsl.localhost/wsl.localhost/wsl.localhost/" ...のようになる

#117
"wsl.localhost/"がappendされる代わりに"(loading...)"が消えずに残るようになった。
- おそらく選択手段 (クリック,Enter,Tab)は関係なく、「選択→Escでキャンセル」の3回目が必ずおかしくなっている。3回とも同じ選択手段でも。
- 1回目,2回目でも"(loading...)"が一瞬だけ見えて直後に"Ubuntu/"に置き換わっている (問題ない)
- 1回目,2回目で"Ubuntu/"を選択したら次の候補が"../"だけになる。

#118
「期待される改善 Esc でキャンセルしても “(loading…)” が残らない」←正しく現象が伝わっていないようだ。
下記の3パターンがある。:qで終わらずに続けると"********"の症状が出続ける。
1.`:e //` → "wsl.localhost/" →  Tab → "Ubuntu/" → Tab → "../" → Esc
  - `:e //` → "wsl.localhost/" →  Tab → "Ubuntu/" → Tab → "../" → Esc
    - `:e //` → "wsl.localhost/" →  Tab → "********" → Esc → :q
2.`:e //` → "wsl.localhost/" →  Enter → "Ubuntu/" → Enter → "../" → Esc
  - `:e //` → "wsl.localhost/" →  Enter → "Ubuntu/" → Enter → "../" → Esc
    - `:e //` → "wsl.localhost/" →  Enter → "********" → Esc → :q
3.`:e //` → "wsl.localhost/" →  クリック → "Ubuntu/" → クリック → "../" → Esc
  - `:e //` → "wsl.localhost/" →  クリック → "Ubuntu/" → クリック → "../" → Esc
    - `:e //` → "wsl.localhost/" →  クリック → "********" → Esc → :q

#119
何も変わっていない。
2つ症状があるが、まずは"Ubuntu/"直下の一覧が出ない方に絞って直そう。
- `:e //` → "wsl.localhost/" →選択→ "Ubuntu/" →選択→ "../"
  - いくつか前の版では"home"や"tmp"などwsl(ubuntu)側ルートディレクトリの一覧が表示出来ていた。

#120
3手段いずれでも同じ。
- “:e //” → “wsl.localhost/” → “Ubuntu/” → NG ("../"のみが候補)
  - その瞬間の入力欄表示：「:e //wsl.localhost/Ubuntu/」
    - "../"を選んだ際の入力欄表示：「:e //wsl.localhost/」

#121
操作手段はいずれもTab
- “:e //” → “wsl.localhost/” → “Ubuntu/” → NG ("../"のみが候補)
  - その瞬間の入力欄表示：「:e //wsl.localhost/Ubuntu/」, ポップアップ：「../」他は無し
    - "../"を選んだ際の入力欄表示：「:e //wsl.localhost/」, ポップアップ：「******」

#122
- “:e //” → popup:“wsl.localhost/” →Tab→ popup:“Ubuntu/” →Tab→ popup:"../"
  - NGの瞬間の入力欄表示：「:e //wsl.localhost/Ubuntu/」, ポップアップ：「../」他は無し
- クリック/Enter/Tabを一切使わず手入力を続けた場合は":e //wsl.localhost/Ubuntu/"で正しく一覧がポップアップに表示される。

#123
- “:e //” → popup:“wsl.localhost/” →Tab→ popup:“Ubuntu/” →Tab→ popup:"../"
  - ここで'h'と入力するとポップアップの候補が"home/"になる。その後backspaceで'h'を消すとルート直下の一覧が正常に表示される
  - "Ubuntu/"でのポップアップ候補に"../"が含まれない方が望み。

#124
- “:e //” → popup:“wsl.localhost/” →Tab→ popup:“Ubuntu/” →Tab→ popup:"(no entries)"
  - ここで'h'と入力するとポップアップの候補が"home/"になる。その後backspaceで'h'を消すとルート直下の一覧が正常に表示される

#125
- “:e //” → popup:“wsl.localhost/” →Tab→ popup:“Ubuntu/” →Tab→ popup:"(loading...)" →1秒程度→ popup:"(no entries)"
  - ここでbackspaceで末尾の'/'を削除するとpopup:"Ubuntu/"になる(正常)。
    - 続けてTabを押すと再び"(loading...)"→1秒程度→"(no entries)"
    - Tabを押さずに'/'を入力すると正常にドリルダウンして一覧が表示される。
      - そこから再度backspaceで末尾の'/'を消してTabを押しても同じでloading→no entries。
なので、wslのリスト取得の処理がおかしいとかではなく、ポップアップのディレクトリ移動処理だけがおかしいのではないか？

#126
- “:e //” → popup:“wsl.localhost/” →Tab→ popup:“Ubuntu/” →Tab→ 正常に一覧が表示される。
  - ここで例えば"home/"をクリックすると"(no entries)"になる。Tab/Enterでも同じ。
    - "Ubuntu/"直下のときと同様に、手入力では正常にフォルダ移動して一覧も表示される。

#127
変わらず。手入力だとパスの奥まで行けるがTab/Enter/クリックでは"(no entries)"になる。
一度そうなると動作が怪しくなり、"...Ubuntu/hom"などでTabを押すと"C:/wsl.localhost/Ubuntu/hom"という名前の空バッファとして開いてしまったりする。

#128
変わらず。手入力だとパスの奥まで行けるがTab/Enter/クリックでは"(no entries)"になる。
一度そうなると動作が怪しくなり、"...Ubuntu/hom"などでTabを押すと"C:/wsl.localhost/Ubuntu/hom"という名前の空バッファとして開いてしまったりする。

#129
症状が変わっただけで改善なし。
- “:e //wsl.localhost/” →Tab→ 正常に一覧が表示される。
  - ここで例えば"home/"をクリックすると"../"だけがポップアップに表示される。Tab/Enterでも同じ。
    - 一度そうなってしまうとBackspaceで"home/"→"hom"などとしてEnterを押すと"C:/wsl.localhost/Ubuntu/hom"というバッファが作られたり動作が変になるので、毎回:qで抜けてから起動直後の状態で試すようにしている。
- Tab/Enter/クリックを使わず手入力だけの場合は問題なくWSLフォルダを辿れる。手入力で'/'をタイプした瞬間の処理に一本化してほしい。

#130
まったく改善なし。
ポップアップは「フォルダツリーを移動したりファイル選択を確定するもの」ではなく、「コマンド入力欄を埋めていく補完処理」に徹してほしい。カーソル下の文字列をコマンド入力欄にpasteするだけ。そのうえで「最後の文字は/または\だったか？」を見て、Yesならキー入力された場合と同じ処理をすればいい。

#131
悪化した。ポップアップに"wsl.localhost/"が表示されているとき、マウスクリックだと大丈夫だがTab/Enterで選択すると"(no entries)"になる。
ポップアップは「フォルダツリーを移動したりファイル選択を確定するもの」ではなく、「コマンド入力欄を埋めていく補完処理」に徹してほしい。カーソル下の文字列をコマンド入力欄にpasteするだけ。そのうえで「最後の文字は/または\だったか？」を見て、Yesならキー入力された場合と同じ処理をすればいい。Noならファイル選択確定。
- UNCは今は実装せず将来的なTODOだと宣言したはず。一向にバグを潰せない状況なのに機能追加などしたら収拾がつかなくなる。

#132
- ":e //"時の候補一覧から"wsl.localhost/"を選択すると":e /wsl.localhost/"になってしまう。'/'が欠落しているし、入力欄外に':'が表示されているのと併せると"::e"になってしまう。
- 手入力onlyのときでも":e //wsl.localhost/"時に"Ubuntu/"が現れずに"********"となってしまう頻度が高くなった。

#133
1.Tab/Enter:OK, クリック:NG ("wsl.localhost/"をクリックすると"(no entries)")
2.Tab/Enter:OK
3.NG home/を選択すると"(no entries)"
手入力onlyでwslパスの奥まで行き来できるが、"../"がpopup候補に一切出てこなくなった。wsl以外でも。

#134
テスト観点があるときは番号を振ってほしい。回答をシンプルにしたいので。
- :e // → wsl.localhost/ をクリック
  - NG ("../"のみになる)
- :e // → wsl.localhost/ をEnter
  - OK ("Ubuntu/"が候補に出る、"../"は出ない)
- :e // → wsl.localhost/ をTab
  - OK ("Ubuntu/"が候補に出る、"../"は出ない)
- :e //wsl.localhost/Ubuntu/ → home/ → ymaru/ → work/
  - Enterの場合
    - NG ("home/"の配下が"../"だけになる)
  - Tabの場合
    - NG ("home/"の配下が"../"だけになる)
- 手入力onlyで「..」の表示
  - OK

#135
1.OK
2.OK
3.OK
4.NG
- Enter
  - "Ubuntu/"を選択するとコマンド入力欄にはappendされるがポップアップが"Ubuntu/"のまま変化しない
- Tab
  - "Ubuntu/"を選択するとコマンド入力欄にはappendされるがポップアップが"Ubuntu/"のまま変化しない
5.NG
  - "Ubuntu/"より先を入力してもpopupが付いてこず、ファイル名まで入力してもEnterをpopupに奪われるので確定ができない

- 通常フォルダの「子要素の一覧」を得るAPIでは、子要素に「..」は含まれていないのか？もし含まれているなら、ホスト名直下など通常フォルダ以外のパスも含めて「含まれているときだけ表示」というシンプルな仕様でよいはず。
- UNC対応を実装するようにpromptで指示を出すまでUNC対応は実装するな。=UNCの存在を意識するな。

#136
- “:e //” → “wsl.localhost/” を クリックで補完
  - NG ("../")
- “:e //” → “wsl.localhost/” を Enter/Tabで補完 → “Ubuntu/”
  - OK
- “Ubuntu/” を Enter/Tab → 直ちに Ubuntu 直下の一覧（home/ など）へ更新
  - OK
- 以降は Enter/Tabいずれでも、補完→入力ハンドラ→即列挙の一本化でスムーズにドリルダウン
  - NG
    - "home/"にカーソルを合わせてEnter
      - NG ("../")
    - "home/"にカーソルを合わせてTab
      - NG ("../")
- 手入力onlyでwslのファイル名まで入れてEnterで確定 → OK

#137
- “:e //” → “wsl.localhost/” を クリック
  - NG クリック直後は"Ubuntu/"が表示されるが、約1秒後に"(no entries)"に置き換わる
- “Ubuntu/” を素早くクリック → 直ちに Ubuntu 直下の一覧（home/ など）へ更新
  - OK
-- “Ubuntu/” を Enter/Tab → 直ちに Ubuntu 直下の一覧（home/ など）へ更新
  - OK
- "home/"にカーソルを合わせてクリック
  - NG ("../")
- "home/"にカーソルを合わせてEnter
  - NG ("../")
- "home/"にカーソルを合わせてTab
  - NG ("../")
- 手入力onlyでwslのファイル名まで入れてEnterで確定 → OK

#138
クリックで約1秒後に"(no entries)"になる現象は起きなくなった。
- "home/"にカーソルを合わせてクリック/Enter/Tab
  - NG
    - コマンド入力欄に"home/"がappendされたあとpopupはリドローされてカーソル位置がtopに移るのみ。(home/ の中に移動していない)
- 手入力onlyでwslのファイル名まで入れてEnterで確定 → OK

#139
症状変わらず。
- "home/"にカーソルを合わせてクリック/Enter/Tab
  - NG
    - コマンド入力欄に"home/"がappendされたあとpopupはリドローされてカーソル位置がtopに移るのみ。(home/ の中に移動していない)
    - 再度"home/"を選ぶとコマンド入力欄は"Ubuntu/home/home/"となる。
- 手入力onlyでwslのファイル名まで入れてEnterで確定 → OK

#140
- “:e //” → “wsl.localhost/” を クリック
  - NG。入力欄に"wsl.localhost/"がappendされるがpopupは"wsl.localhost/"のまま変わらず、再度クリックすると入力欄が"wsl.localhost/wsl.localhost/"となってしまう。
- "home/"にカーソルを合わせてEnter/Tab
  - NG
    - 入力欄に"home/"がappendされたあとpopupはリドローされてカーソル位置がtopに移るのみ。(home/ の中に移動していない)
    - 再度"home/"を選ぶと入力欄は"Ubuntu/home/home/"となる。
- 手入力onlyでwslのファイル名まで入れてEnterで確定 → OK

#141
クリック/Enter/Tabでの挙動は一致している(NG含め)。
- "home/"にカーソルを合わせてEnter/Tab/クリック
  - NG
    - 入力欄に"home/"がappendされたあとpopupは"../"のみになってしまう。
      - 入力欄：:e //wsl.localhost/Ubuntu/home/
- 手入力onlyでwslのファイル名まで入れてEnterで確定 → OK
  - "//wsl.localhost/Ubuntu/"までEnter等で選んでいても"home/"以降が手入力ならOK

#142
- ":e //wsl.localhost/Ubuntu/"まではいずれの方式で選択してもOK
- "home/"にカーソルを合わせてEnter/Tab/クリック
  - NG
    - 入力欄に"home/"がappendされたあとpopupはリドローされてカーソル位置がtopに移るのみ。(home/ の中に移動していない)
    - 再度"home/"を選ぶと入力欄は"Ubuntu/home/home/"となる。
- 手入力onlyでwslのファイル名まで入れてEnterで確定 → OK
  - "//wsl.localhost/Ubuntu/"までEnter等で選んでいても"home/"以降が手入力ならOK
  - "//wsl.localhost/Ubuntu/home/ymaru/w"まで手入力で進めるとpopupは"work/"のみになるが、ここでTab/Enter/クリックで選択するとhomeと同様にymaru直下の一覧がpopupに表示されてしまう。

#143
- ":e //wsl.localhost/Ubuntu/"まではいずれの方式で選択してもOK
- "home/"にカーソルを合わせてEnter/Tab/クリック
  - NG
    - 入力欄に"home/"がappendされたあとpopupは"(loading...)"のままになる
- 手入力onlyでwslのファイル名まで入れてEnterで確定 → OK

#144
- "home/"にカーソルを合わせてEnter/Tab/クリック
  - NG
    - 入力欄に"home/"がappendされたあとpopupは"(no entries)"になる

#145
- "home/"にカーソルを合わせてEnter/Tab/クリック
  - NG
    - 入力欄に"home/"がappendされたあとpopupは"(no entries)"になる

#146
- "home/"にカーソルを合わせてEnter/Tab/クリック
  - NG
    - 入力欄：":e //wsl.localhost/Ubuntu/home/"
    - popup："(no entries)" ※一瞬"(loading...)"が見えた気もするが0.1秒未満くらいで切り替わる

#147
「ポップアップは子要素の一覧を見せて入力欄に渡すだけ」に徹していないのでは？
case 1.手入力onlyで":e //wsl.localhost/Ubuntu/home"まで入力したあと'/'を入力
- → "../"と"ymaru/"がpopup候補に表示される (OK)
case 2.手入力onlyで":e //wsl.localhost/Ubuntu/home"まで入力したあとpopupに表示されている候補"home/"をクリック
- → 一瞬"(loading...)"が表示されたあと"(no entries)"と表示される (NG)
  - 入力欄で"wsl.localhost/Ubuntu/"までを確定分として把握しておき、未確定部分である"home"をpopupの"home/"で置き換えればよいはず。

#148
1.OK
2.click → 一瞬"(loading...)"が見えた直後(体感0.01秒後)に"(no entries)" → NG
2.Enter → 一瞬"(loading...)"が見えた直後(体感0.01秒後)に"(no entries)" → NG
2.Tab → 一瞬"(loading...)"が見えた直後(体感0.01秒後)に"(no entries)" → NG

#149
再トライ
1.OK
2.click → 一瞬"(loading...)"が見えた直後(体感0.01秒後)に"(no entries)" → NG
2.Enter → 一瞬"(loading...)"が見えた直後(体感0.01秒後)に"(no entries)" → NG
2.Tab → 一瞬"(loading...)"が見えた直後(体感0.01秒後)に"(no entries)" → NG

#150
- popupの"home/"をクリック
  - "(loading...)"のまま1分待っても変わらず
- popupの"home/"をEnter
  - "(loading...)"のまま1分待っても変わらず
- popupの"home/"をTab
  - "(loading...)"のまま1分待っても変わらず
- '/'をキー入力
  - "(loading...)"が体感0.01秒表示されたあと"../"と"ymaru/"が候補として表示される (OK)
クリック/Enter/Tabを受けて子要素を取得する処理が残っているなら完全に廃止して'/'入力時の処理に一本化してくれ。

#151
まったく変わっていない。
- popupの"home/"をクリック
  - "(loading...)"のまま1分待っても変わらず
- popupの"home/"をEnter
  - "(loading...)"のまま1分待っても変わらず
- popupの"home/"をTab
  - "(loading...)"のまま1分待っても変わらず
- '/'をキー入力
  - "(loading...)"が体感0.01秒表示されたあと"../"と"ymaru/"が候補として表示される (OK)

#152
まったく変わっていない。
- popupの"home/"をクリック
  - "(loading...)"のまま1分待っても変わらず
- popupの"home/"をEnter
  - "(loading...)"のまま1分待っても変わらず
- popupの"home/"をTab
  - "(loading...)"のまま1分待っても変わらず
- '/'をキー入力
  - "(loading...)"が体感0.01秒表示されたあと"../"と"ymaru/"が候補として表示される (OK)
- クリック/Enter/Tabした瞬間に入力欄が": :e /wsl.localhost/Ubuntu/home/"に変わっている。
手入力している最中は": e //wsl.localhost/home"だった。

#153
OK。クリック/Enter/Tabによる選択時の挙動が手入力時と同じになりWSLパスのファイルを開けた。
大筋は修正されたが、他、細かいところを。
- "wsl.localhost/Ubuntu/home/"の一覧から"../"をTabで選択すると入力欄が".../Ubuntu/Ubuntu"になり、popupは"(loading...)"になる。Enter/クリックでは問題ない。
- "[CMD] :"と表示されているところを"[CMD] "だけにして、手入力の':'もそのまま入力欄に表示されるようにしたい。
- wslでもCドライブでも、:eでファイルオープンした直後にタブバーでアクティブバーにならない。(textareaの内容とタブとの対応がずれた状態)

#154
- "home/"の下の"../"をTabで選択したときだけ"Ubuntu/Ubuntu/", "(loading...)"になる現象は解消していない。
- "::e"などコロン重複は許容せず、不正コマンド扱いの方がよい。
- 入力した":"も入力欄に編集中文字列として挿入されるようになったが、コマンド入力欄が"[CMD] :"や[NORMAL] :"のままになっている。':'の表示が不要。
- wslパスでも例えば'h'とタイプして絞り込まれた結果に"HTA"が含まれているが、ファイルシステムのルールに従って大文字小文字を別扱いする/しないを切り替えることは可能？
(NTFSなどはread時には大文字小文字を区別しないがext4は区別するはず)

#155
- "home/"の下の"../"をTabで選択したときの挙動は修正されたが、Tab/Enter/clickいずれでもカーソルが候補一覧の先頭になっている。正しくは「今いたディレクトリにカーソルを表示」。少し前の版までそうなっていたような。
- "::e"などの不正コマンドはinvalid commandトーストの方がいい。
- ':'の表示はOK
- 大文字小文字の判定を"wsl.localhost"かどうかの決め打ちにしている件は、それでよい。おそらくUNCに正式対応するときに再考する。
- wslパスのファイルに限り、非アクティブタブになった際の表示が"file://wsl.localhost/..."になっている。非wslファイルと同様にファイル名だけにしたい。アクティブタブの表示はこのままでいい。

#156
- Enter/Tabで"../"を選択して戻った際のカーソル位置復元はできていない。常に先頭になってしまっている。clickで選択した場合は期待通り。
- 非アクティブタブのwslファイルがフルパスになってしまっている。
  - 具体的には"file://wsl.localhost/Ubuntu/home/ymaru/work/sample.md"。期待値は"sample.md"。
- "::e"でのトーストはOK

#157
- Enterで"../"を選択して戻った際のカーソル位置復元はできていない。常に先頭になってしまっている。click/Tabで選択した場合は期待通り。
- 非アクティブタブのwslファイルがフルパスになる件は変化なし。
- :bで表示されるバッファ一覧でwslファイルが"file://wsl.local..."となっているが、アクティブタブでの表示に合わせて"wsl.local..."にしてほしい。"file:"が不要。

#158
- Tab/clickはOKなのにEnterだけ"../"でカーソル位置を復元できていない件は解消せず。
- 非アクティブタブのwslファイルがフルパスになる件は解消せず。
- :bで表示されるバッファ一覧でのwslファイルの表示はOK

#159
2点とも変化なし。
- Tab/clickはOKなのにEnterだけ"../"でカーソル位置を復元できていない件は解消せず。
  - ":e //wsl.localhost/Ubuntu/home/ymaru/"まで手入力し、多数ある候補の一番上の"../"にカーソルがある状態でEnter → "../"と"ymaru/"の2候補だが"../"にカーソルが表示される。
    - 入力欄は".../home/ymaru"。Tab/clickでは正しく"ymaru/"にカーソルが表示される。
- 非アクティブタブのwslファイルがフルパスになる件は解消せず。

#160
2点ともOK。期待動作になった。
:eでファイル選択中の動作について、仕様変更を4つ入れたい。
1.入力欄の文字に合わせてpopup候補を絞り込むのをやめる
2.入力欄の文字入力はpopup候補群からインクリメンタルサーチでカーソルを動かす挙動にする
3.逆に↑や↓でカーソルを動かした場合は、即座に入力欄に反映する。ただし末尾の'/'は除く。カーソルが"../"に来たときは例外で、反映しない。
- 入力欄への反映はカーソルを動かしたときだけなので、反映後に入力欄でbackspaceで編集することも可能。
4.パス選択中のTabの仕様を一部変更したい。(Enter/clickは変更なし)
  - 入力欄が'/'で終わっているときは、カーソルが"../"にあるときはEnterと同じ、それ以外では何もしない。
  - 入力欄で'/'のあとに文字入力されている状態でTabを押すと、先頭一致で共通に該当するところまで補完を実行する。
    - 例) popup候補に"foo/","foobar/","foo1.txt"があるときに".../f" →Tab→ ".../foo"としたい。
- 仕様変更で曖昧な点や矛盾があれば指摘して。

#161
- "Ubuntu/ho" Tab と入力しても補完されない。("home"だけがマッチする状況なのに)
- カーソル移動→入力欄への反映 → OK
- サブディレクトリに移ると一番上の"../"にカーソルがあるが、一度カーソルを動かすと"../"に戻れなくなる
- 1つ仕様変更。入力欄で'/'のあとに文字入力されているときだけTabが効く仕様にしてたけど、例外としてpopupの候補が"../"以外の1つだけ、もしくは"../"と他に1つだけのときは"../"以外の方の候補を対象に'/'の前まで補完が効くようにしたい。

#162
- Tabの補完動作はOK。
- "../"をEnter/Tab/clickで選んで親に戻ったときに「今いたフォルダ」にカーソルが行かなくなる現象が再発している。(Tabは"../"以外に2つ以上候補があるとき)
- "../"にカーソルを戻せなくなっていた現象は解消した。

#163
- ":e //"でpopupの候補が"wsl.localhost/"だけのときTabで入力欄に正しく"wsl.localhost"が補完されるんだけど、このときpopupの候補が"********"になるのはなぜ？
  - 特殊な疑似ホスト名だから、他と合わせる処理が複雑になりそうならこのままでよいが。
- 親に戻ってカーソル位置が「今いたフォルダ」になる動作はOK。
- また1つ仕様変更。「入力欄が'/'で終わっているときは、カーソルが"../"にあるときはEnterと同じ」としていた仕様を廃止する。
  - "../"以外に1つだけ候補がある場合は"../"以外の候補をTab補完の対象にする
  - "../"しかないときは何もしない
  - "../"以外に2つ以上候補があるときは何もしない("../"にカーソルがあっても)

#164
- "wsl.localhost"が"********"になる件は了解。仕様でよい。
- TabはEnterのように"../"選択の挙動にならない件もOK。期待動作。

- 手入力によってpopup候補のいずれにもマッチしなくなったとき、Enterで新規バッファとして開きたいが現状はpopupにカーソルが残っているので、手入力の内容を無視してカーソル位置での確定動作になってしまう("../"も含め)。これを避けるため、:e popupでのEnterの仕様を変更する。
  - Enterが入力されたら、
    1.入力欄の末尾が'/'ならこれまでのEnterの挙動(popupカーソル位置の候補の確定処理)
    2.入力欄の末尾が'/'でないなら、入力欄の文字列がディレクトリ名として存在しているなら(=移動可能なら)移動処理。ディレクトリではなくファイルとして存在しているなら確定でオープン。存在していないなら新規バッファとしてオープン。
- 手入力によってpopup候補のいずれにもマッチしなくなったときはpopupのカーソル行を「塗り潰しなし」など違うstyleにしたい。この状態でも↑↓でのカーソル移動は有効で、移動すると元のカーソル描画に戻る。

#165
壊れた。':'を入力してもtextarea末尾に文字入力としてappendされるのみ。

#166
壊れたままなので#163後まで戻した。#164をプロンプトとしてもう一度。

#167
- 存在しないパスでも無理やり'/'を付けて実在フォルダのようにあつかって"(no entries)"になる。
  - 例) ".../Ubuntu/homeee" Enter → ".../Ubuntu/homeee/"
    - popupは"(loading...)" →数秒→ "(no entries)"
  - popupのカーソルが消える(ように見える)挙動は正しい。
    - わかりにくいので存在しないときのカーソルをrgba(255,0,0,0.2)くらいの塗り潰しにして。

#168
OK。Enterの仕様変更は完了。popupカーソルの色変化もOK。

- 存在するしないに関わらずwslパス上のファイルのバッファがカレントタブになっているとき、":e /"でCドライブ直下が候補にならない。"C:/Users/"とか選択したいのに。起動時の(untitled)バッファをカレントにすると":e /"でCドライブ直下が候補に現れる。

#169
"e: /"の挙動はOK。

- wslパスのファイルがカレントバッファのとき、":e "で開くpopupの候補から"../"を選んだときの挙動がおかしい。"../"の下の候補が入力欄に入ったうえでpopupは"(loading...)"で止まる？？

#170
改善されず。
具体例）":e //wsl.localhost/Ubuntu/home/ymaru/work/sample.md"を開いたあと":e "で出てくる候補は「"../", "HTA.dummy/", "HTA/", "OLD.tedit/", "WebView2", sample.md, HTA.win」で、ここで
- "../"をclickしても何も起きない
- "../"にカーソルを合わせてEnterを押すと入力欄が":e HTA.dummy/"になり、popupは"(loading...)"が2,3秒表示されたあと"(no entries)"になる。※HTA.dummyの中は空

#171
prompt#170の状態から、
- "../"をclickするとpopupの一覧はそのままで"OLD.tedit/"に赤カーソルが表示される。入力欄は":e ymaru"になる。
- "../"をEnterで選択したときの挙動は変わらない。"(loading...)"からの"(no entries)"。

#172
起動時に「six: JavaScript の初期化に失敗しました。F12でコンソールを開き、Ctrl+F5 で再読込してください。」と表示される。
```
_six.js:12  Uncaught ReferenceError: Cannot access '_fileTypedDirRaw' before initialization
    at _six.js:12:34
    at _six.js:2397:3
```

#173
wslパスの実在ファイルを開こうとしたらトーストが表示され、タブバーが消えた。
「open failed: file://wsl.localhost/Ubuntu/home/ymaru/work/sample.md」
textareaにはsample.mdの中身が表示されている。

#174
- 引き続きopen failedでタブバーが消える現象は変わらず。
- 引数無しで起動した直後、":e "でpopupには"C:/Users/ymaru/WebView2/six/"の一覧が表示されているが、続けて"../"とタイプしたあと確定せずにEscでキャンセルし、再び":e "と入力するとpopupには"C:/Users/ymaru/WebView2/"の一覧が表示される。

#175
- open failedのトーストは出なくなったが、タブバーが表示されない。
- “:e ” → “../” 入力 → Esc → 再度 “:e ” → 親ディレクトリの一覧が出る (NG)
  - よりシンプルな例だと、":e /"でCドライブ直下が表示されている状態でbackspaceで'/'を削ってもpopupが変化しないが、バッファのカレントに戻ってほしい。

#176
- タブバーが正常に表示されるようになった。OK
- wslパスのファイルを開いたあと最初からある"(untitled)"タブを表示して":e "とした場合にpopupにはwslファイルのある場所が一覧表示されてしまう。
- wslも非wslも、例えば入力欄で"s"と入力した段階でpopup中"sample.md"のみがヒットしている状態でEnter押下で"s"という名前の新規バッファになってしまう。
- “:e ” → “../” 入力 → Esc → 再度 “:e ” → 親ディレクトリの一覧が出る (NG)

#177
2) "/s"Enterで"sample.md"をオープンできた。OK
3) NG。変わらず。":e /" EscのあとはCドライブルートになるし":e //" Escのあとは"wsl.localhost/"になる。
1) 3)と同根のような気がするが、wslパスのファイルを開いたあと"(untitled)"タブで":e "とするとwsl側のカレントが一覧される。
- 今回からではないかもしれないが、".../work/sa"でpopupの"sample.md"をclickするとファイルは開けるが入力欄がそのまま残る(".../work/sa")。
- clickでサブフォルダに移らない現象が再発している。".../Ubuntu/"の候補から"home/"をclickしてもpopup候補がそのままで入力欄に"home/"がappendされる。Enter/Tabは問題ない。

#178
- wslのバッファからの":e /"でCドライブルートが開く → OK
  - ただしEscでキャンセルしたあと":e "でもCドライブルートが開いてしまう。
    - 相対パスの基点は常にカレントバッファのパスであるべき
- popupからclickしたときは入力欄やpopup内カーソル位置の候補に関わらずclickした候補で確定する → OK。入力欄もクリアされる。

#179
1) NG。wslバッファでも":e /"をEscでキャンセルしたあとは":e "でも"C:\"を開いてしまう。
2) NGというか、":e /"に行く前が既に変。"C:/Users/ymaru/WebView2/six/six.ps1"を引数無しで起動した直後に":e "としたら"(no entries)"になってしまう。
「相対パスの基点は常にカレントバッファのパス」が徹底されていないと思われる。

#180
- "C:/Users/ymaru/WebView2/six/six.ps1"を引数無しで起動した直後に":e "としたら"(loading...)"になったまま変化しない。
  - そのまま'/'をタイプしたらCドライブルートの一覧が表示され、Esc後の":e "でもCドライブルートの一覧が表示された。NG。

#181
1) OK
2) OK
次は:wを実装したい。

#182
起動時エラー。
```
six.ps1 starting in: C:\Users\ymaru\WebView2\six
Add-Type : c:\Users\ymaru\AppData\Local\Temp\wczv33wd.0.cs(103) : 'else' は無効です
。
c:\Users\ymaru\AppData\Local\Temp\wczv33wd.0.cs(102) :         try{ client.Close();
 } catch{}
c:\Users\ymaru\AppData\Local\Temp\wczv33wd.0.cs(103) : >>>           } else if (pat
h.StartsWith("/write")){
c:\Users\ymaru\AppData\Local\Temp\wczv33wd.0.cs(104) :             // POST /write?f
s=\\\\host\\path  body=utf-8 text
発生場所 C:\Users\ymaru\WebView2\six\six.ps1:99 文字:5
+     Add-Type -TypeDefinition $code -Language CSharp -IgnoreWarnings - ...
+     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : InvalidData: (Microsoft.Power...peCompilerError:AddT
   ypeCompilerError) [Add-Type]、Exception
    + FullyQualifiedErrorId : SOURCE_CODE_ERROR,Microsoft.PowerShell.Commands.AddT
   ypeCommand
```

#183
起動時エラー。
```
six.ps1 starting in: C:\Users\ymaru\WebView2\six
Add-Type : c:\Users\ymaru\AppData\Local\Temp\qocde31f.0.cs(138) : } が必要です。
c:\Users\ymaru\AppData\Local\Temp\qocde31f.0.cs(137) :   }
c:\Users\ymaru\AppData\Local\Temp\qocde31f.0.cs(138) : >>> }
c:\Users\ymaru\AppData\Local\Temp\qocde31f.0.cs(139) :
発生場所 C:\Users\ymaru\WebView2\six\six.ps1:99 文字:5
+     Add-Type -TypeDefinition $code -Language CSharp -IgnoreWarnings - ...
+     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : InvalidData: (Microsoft.Power...peCompilerError:AddT
   ypeCompilerError) [Add-Type]、Exception
    + FullyQualifiedErrorId : SOURCE_CODE_ERROR,Microsoft.PowerShell.Commands.AddT
   ypeCommand
```

#184
```
six.ps1 starting in: C:\Users\ymaru\WebView2\six
Add-Type : c:\Users\ymaru\AppData\Local\Temp\vlhrggfv.0.cs(88) : ) が必要です。
c:\Users\ymaru\AppData\Local\Temp\vlhrggfv.0.cs(87) :             var bufBody = new
 byte[8192];
c:\Users\ymaru\AppData\Local\Temp\vlhrggfv.0.cs(88) : >>>             while(remaini
ng > 0){ int n; try{ n = sock.Receive(bufBody); } catch { break; } if (n<=0) break;
 receivedBody.Write(bufBody,0,n); remaining -= n; if (receivedBody.Length > 50_000_
000) break; }
c:\Users\ymaru\AppData\Local\Temp\vlhrggfv.0.cs(89) :             string textToWrit
e = "";
発生場所 C:\Users\ymaru\WebView2\six\six.ps1:99 文字:5
+     Add-Type -TypeDefinition $code -Language CSharp -IgnoreWarnings - ...
+     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : InvalidData: (Microsoft.Power...peCompilerError:AddT
   ypeCompilerError) [Add-Type]、Exception
    + FullyQualifiedErrorId : SOURCE_CODE_ERROR,Microsoft.PowerShell.Commands.AddT
   ypeCommand
```

#185
- (untitled)で:w → toast表示 → OK
- ":e newfile.txt"で新バッファを開き、数文字入力して:w → "write failed"
  - "save unavailable (no API)"になるときもある
- 既存ファイルを開き、何も編集せず:w → "write failed" ※何もしないのが正解

#186
1) ":e newfile.txt" → 新バッファ → 編集 → :w → `write failed: {"entries":[]}`
2) ":e exist.txt" → :w → 何も起きない
  - 仕様どおりだが、やっぱりtoastは出そう。"Nothing has been changed."かな。

#187
- ":e newfile.txt" → 新バッファ → 編集 → :w → "written: (フルパス)newfile.txt" → OK
- ":e exist.txt" → 何も編集せず:w → "Nothing has been changed." → OK
- ":w :" → "write failed: 指定されたパスのフォーマットはサポートされていません。" → まあOK
- ":w no-exist.txt" → "written:..." → OK
- ":w otherfile.txt" → "written:..." → 仕様通りだが、":w name"でnameが既存だった場合は確認を求めるようにしたい。
- :w! / :wqも必要だが、その前に:q時にmodifiedなバッファが残っていたら確認を出すようにしたい。


