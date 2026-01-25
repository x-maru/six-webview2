#!/bin/bash

cp TODO.md TODO-bak.md && tar cf - *.ps1 *.js *.html *.css *.cs *.customize *.sh *.cmd help*.md | tar xf - -C /mnt/c/Users/ymaru/WebView2/six/

# git log --oneline -n 10
# git add .
# git commit -m "aaa"
# git reset --hard xxxxxxx
# git commit --amend

