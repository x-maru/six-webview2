# prompt1883.md — indented code block 最小サンプル (#1883)

markdown on + md-rich で以下を貼り付け。

## 1) 通常のインデントコード (4 spaces)

A
    code: 4spaces line-1
    code: 4spaces line-2

    code: blank line continues block

B (ここでブロック終了)

## 2) 0–3 spaces + TAB でもコード

C
	code: tab at bol
 	code: 1space + tab
  	code: 2spaces + tab
   	code: 3spaces + tab
D (ここでブロック終了)

## 3) 空行継続の確認

E
    code: before blank

    code: after blank (still in block)
F (ここでブロック終了)

## 4) #1883: list depth>=2 が優先 (4 spacesでもコードにならない)

- L1
  - L2
    ok: this is a normal continuation line (4 spaces)
    still list, NOT code

1. O1
   1. O2
      ok: continuation (4 spaces) should be list, NOT code
      still list, NOT code

## 5) 見た目: 先頭/末尾行の2倍行高に収まること

G
    visually check first/last row padding
    the background should NOT protrude outside
H
