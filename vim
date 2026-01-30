vim -u NONE \
  +"setlocal foldmethod=expr" \
  +"setlocal foldlevel=0" \
  +"setlocal foldenable" \
  +"set number" \
  -c "let &l:foldexpr = 'getline(v:lnum)=~\"^\\s*$\" ? 0 : 1'" \
prompt.md
