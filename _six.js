// six migration oriented bootstrap (spec-aligned skeleton with file load)
(function(){
  'use strict';

  /*********************************************************
   * Constants / Config
   *********************************************************/
  const LINE_HEIGHT = 20;                 // px (must match CSS --lh)
  const ROUND_THRESH = 0.985;
  const HSCROLL_RESERVE = 18;
  let scrolloff = 2;

  /*********************************************************
   * DOM References
   *********************************************************/
  const editor   = document.getElementById('editor');
  const viewport = document.getElementById('editorViewport');
  const gutter   = document.getElementById('gutter');
  const caretLayer = document.getElementById('caretLayer');
  const edstripe = document.getElementById('edstripe');
  const cmdinput = document.getElementById('cmdinput');
  const modestatus = document.getElementById('modestatus');
  const tabbarTabs = document.querySelector('#tabbar .tabs');
  // caret measure helper
  const _measureSpan = document.createElement('span');
  _measureSpan.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;line-height:var(--lh);';
  document.body.appendChild(_measureSpan);

  /*********************************************************
   * State
   *********************************************************/
  let caretRow = 0, caretCol = 0;
  let _centerScrolloffOnce = false;
  let _lineLockActive = false;
  let _cachedVisibleCount = 0;
  let _mode = 'NORMAL';
  let _pendingNormal = null; // for multi-key sequences like 'gg'
  let _pendingTimer = null;
  // multi-buffer model
  const buffers = [];
  let currentIdx = -1;

  function currentBuffer(){ return (currentIdx>=0 && currentIdx<buffers.length) ? buffers[currentIdx] : null; }
  function _addBuffer(buf){ buffers.push(buf); currentIdx = buffers.length-1; return currentBuffer(); }
  function _switchToBuffer(i){
    if (i<0 || i>=buffers.length) return false;
    currentIdx = i;
    const b = buffers[i];
    // 反映
    editor.value = b.text || '';
    caretRow = 0; caretCol = 0; editor.scrollTop = 0;
    _centerScrolloffOnce = true; ensureScrolloff({centerOnce:true});
    _repositionCaret(); updateGutter();
    _setTitle(); _renderTabbar();
    return true;
  }

  /*********************************************************
   * Utility
   *********************************************************/
  function _splitLines(){ return editor.value.split('\n'); }
  function _totalLines(){ return _splitLines().length; }
  function _topLine(){ return Math.floor(editor.scrollTop / LINE_HEIGHT) + 1; } // 1-based
  function _visibleLinesExact(){
    const h = viewport.clientHeight;
    const raw = h / LINE_HEIGHT;
    const v = (raw - Math.floor(raw) >= ROUND_THRESH ? Math.ceil(raw) : Math.floor(raw));
    return Math.max(1, v);
  }
  function _needsHScrollReserve(){
    return editor.scrollWidth > editor.clientWidth;
  }
  function _applyTheme(){
    const r = document.documentElement;
    const t = window.THEME || {};
    const map = {
      '--bodyBGColor': t.bodyBGColor,
      '--lineBaseFill': t.lineBaseFill,
      '--gutterGradientStart': t.gutterGradientStart,
      '--gutterGradientEnd': t.gutterGradientEnd,
      '--activeLineBg': t.activeLineBg,
      '--gutterNumberColor': t.gutterNumberColor,
      '--activeLineNumberColor': t.activeLineNumberColor,
      '--eofGutterFillColor': t.eofGutterFillColor,
      '--caretColor': t.caretColor,
      '--caretGradStart': t.caretGradientStart,
      '--caretGradEnd': t.caretGradientEnd,
      '--caretWidth': t.caretWidthPx != null ? (t.caretWidthPx+'px') : undefined,
      '--tabBarBg': t.tabBarBg,
      '--tabBarFg': t.tabBarFg
    };
    Object.entries(map).forEach(([k,v])=>{ if(v) r.style.setProperty(k,v); });
  }

  function _setTitle(){
  // Windows タイトルバー（タスクバー名）にはバッファ名を出さない
  // 透明色は使えないため不可視文字で擬似的に空表示にする
  document.title = '\u2063';
    _renderTabbar();
  }

  function _basename(p){
    if (!p) return '';
    const parts = p.replace(/\\/g,'/').split('/');
    return parts[parts.length-1] || p;
  }

  function _htmlBaseURL(){
    try { return new URL('.', location.href); } catch { return null; }
  }

  function _isLikelyURL(s){ return /^([a-z][a-z0-9+.-]*:)/i.test(s); }

  function _toFileURLFromWinPath(p){
    // C:\foo\bar.txt -> file:///C:/foo/bar.txt
    const norm = p.replace(/\\/g,'/');
    const raw = 'file:///' + norm.replace(/^([a-zA-Z]):\//, '$1:/');
    try { return new URL(raw).toString(); } catch { return raw; }
  }

  function _normalizeToURLString(pathLike, baseURL){
    if (!pathLike) return null;
    // Windows 絶対パス
    if (/^[a-zA-Z]:[\\/]/.test(pathLike)){
      return _toFileURLFromWinPath(pathLike);
    }
    // UNC パス（例: \\server\share\path または \\wsl.localhost\...）
    if (/^\\\\/.test(pathLike)){
      const noPrefix = pathLike.replace(/^\\\\/, '');
      const asPosix = noPrefix.replace(/\\/g,'/');
      // Edge/XHR 互換のため 'file:////server/share/..' 形式を用いる
      const raw = 'file:////' + asPosix;
      try { return new URL(raw).toString(); } catch { return raw; }
    }
    // WSL/UNC 風（例: //wsl.localhost/Ubuntu/home/...）
    if (/^\/\//.test(pathLike)){
      const noPrefix = pathLike.replace(/^\/\//, '');
      // 同様に 'file:////wsl.localhost/Ubuntu/..' 形式へ
      const raw = 'file:////' + noPrefix;
      try { return new URL(raw).toString(); } catch { return raw; }
    }
    // POSIX 絶対パス
    if (pathLike.startsWith('/')){
      const raw = 'file://' + pathLike;
      try { return new URL(raw).toString(); } catch { return raw; }
    }
    // 既に URL
    if (_isLikelyURL(pathLike)){
      try { return new URL(pathLike).toString(); } catch { /* fallthrough */ }
    }
    // 相対: baseURL に対して解決
    try { return new URL(pathLike, baseURL || _htmlBaseURL()).toString(); } catch { return pathLike; }
  }

  function _dirnameURL(urlStr){
    try {
      const u = new URL(urlStr);
      u.pathname = u.pathname.replace(/\/[^\/]*$/, '/');
      return u;
    } catch { return _htmlBaseURL(); }
  }

  function _bufferNumberLabel(n){
    // 1..20 => ①..⑳ (U+2460..U+2473), それ以外は素の数字
    if (!Number.isFinite(n) || n <= 0) return ''+n;
    if (n >= 1 && n <= 20) {
      const code = 0x2460 + (n - 1);
      return String.fromCharCode(code);
    }
    return String(n);
  }

  

  function _relativeDisplayPath(full){
    if (!full) return '';
    try {
      const base = new URL('.', location.href).toString();
      const u = new URL(full, base).toString();
      if (u.startsWith(base)) return decodeURIComponent(u.substring(base.length));
      return full;
    } catch { return full; }
  }

  function _renderTabbar(){
    if (!tabbarTabs) return;
    tabbarTabs.innerHTML = '';
    if (buffers.length === 0){
      const div = document.createElement('div');
      div.className = 'tab active';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = 'six-webview2';
      div.appendChild(nameSpan);
      tabbarTabs.appendChild(div);
      return;
    }
    buffers.forEach((b, i)=>{
      const div = document.createElement('div');
      div.className = 'tab' + (i===currentIdx ? ' active' : '');
      let label = '';
      if (b.path && /^file:\/\//i.test(b.path)){
        label = (i===currentIdx ? (_relativeDisplayPath(b.path) || (b.name||'')) : (b.name||''));
      } else {
        label = b.name || '';
      }
      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      const numLabel = _bufferNumberLabel(i+1);
      const baseText = label || 'untitled';
      nameSpan.textContent = (numLabel ? (numLabel + ' ') : '') + baseText;
      div.appendChild(nameSpan);
      if (b.modified){ const mod = document.createElement('span'); mod.className='mod'; mod.textContent='*'; div.appendChild(mod); }
      div.addEventListener('click', ()=>{ _switchToBuffer(i); });
      tabbarTabs.appendChild(div);
    });
  }

  function _isDirHint(s){
    if (!s) return false;
    if (s === '.' || s === '..') return true;
    if (/[\\\/]+$/.test(s)) return true; // ends with / or \
    return false;
  }

  function _pickNative(cwdURL, name){
    // ネイティブピッカーは使用しない（常に null を返す）
    return Promise.resolve(null);
  }

  function _fetchTextSmart(urlStr){
    // file:// は XHR のほうが成功しやすい（status 0 でも responseText が取れる場合がある）
    const isFile = /^file:\/\//i.test(urlStr);
    if (isFile){
      return new Promise((resolve, reject)=>{
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', urlStr, true);
          xhr.responseType = 'text';
          xhr.onload = ()=>{
            // file:// では status 0 が正常扱いの場合がある
            if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)){
              resolve(xhr.responseText || '');
            } else {
              reject(new Error('XHR status '+xhr.status));
            }
          };
          xhr.onerror = ()=>reject(new Error('XHR error'));
          xhr.send();
        } catch (e){ reject(e); }
      }).catch(()=>{
        // フォールバックで fetch を試す
        return fetch(urlStr).then(r=>{ if(!r.ok) throw new Error('fetch fail'); return r.text(); });
      });
    }
    return fetch(urlStr).then(r=>{ if(!r.ok) throw new Error('fetch fail'); return r.text(); });
  }

  function _fetchTextWithTimeout(url, timeoutMs=1500){
    const ac = (window.AbortController ? new AbortController() : null);
    const to = setTimeout(()=>{ try{ ac && ac.abort(); } catch{} }, timeoutMs);
    const opts = ac ? { signal: ac.signal } : {};
    return fetch(url, opts).then(r=>{ if(!r.ok) throw new Error('fetch fail'); return r.text(); })
      .finally(()=>{ try{ clearTimeout(to); }catch{} });
  }

  async function _loadFromPath(path, baseForRelative, opts={}){
    try {
      const base = baseForRelative || _htmlBaseURL();
      const urlStr = _normalizeToURLString(path, base);
      const txt = await _fetchTextSmart(urlStr);
      const t = txt.replace(/\r\n?/g,'\n');
    editor.value = t;
      caretRow = 0; caretCol = 0; editor.scrollTop = 0;
      _centerScrolloffOnce = true; ensureScrolloff({centerOnce:true});
      _repositionCaret(); updateGutter();
      const mode = opts.mode || (buffers.length===0 ? 'new' : 'replace');
      if (mode === 'new'){
        _addBuffer({ name: _basename(path), path: urlStr, text: t, modified:false });
      } else {
        const b=currentBuffer(); if (b){ b.path = urlStr; b.name = _basename(path); b.text=t; b.modified=false; }
      }
    _setTitle(); _renderTabbar();
      return true;
    } catch (e){
      console.error('open failed', e);
      if (!opts.silentOnFail) alert('open failed: '+path);
      return false;
    }
  }

  function _pickAndLoadFile(opts={}){
    return new Promise((resolve)=>{
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.addEventListener('change', ()=>{
        const f = inp.files && inp.files[0];
        if (!f){ document.body.removeChild(inp); return resolve(false); }
        const r = new FileReader();
        r.onload = ()=>{
          const txt = String(r.result || '').replace(/\r\n?/g,'\n');
          editor.value = txt;
          caretRow = 0; caretCol = 0; editor.scrollTop = 0;
          _centerScrolloffOnce = true; ensureScrolloff({centerOnce:true});
          _repositionCaret(); updateGutter();
          const mode = opts.mode || (buffers.length===0 ? 'new' : 'replace');
          if (mode === 'new'){
            _addBuffer({ name: f.name, path: null, text: txt, modified:false });
          } else {
            const b=currentBuffer(); if (b){ b.path = null; b.name = f.name; b.text = txt; b.modified=false; }
          }
          _setTitle(); _renderTabbar();
          document.body.removeChild(inp);
          resolve(true);
        };
        r.onerror = ()=>{ document.body.removeChild(inp); resolve(false); };
        r.readAsText(f, 'utf-8');
      }, { once:true });
      inp.click();
    });
  }

  /*********************************************************
   * File load (?doc=) - returns Promise<boolean>
   *********************************************************/
  function _loadDocFromQuery(){
    // search (?doc=) と hash (#doc=) の両対応 + data(base64) 直接受信
    let doc = null, name = null, dataB64 = null, api = null, bundleB64 = null;
    if (location.search) {
      const q = new URLSearchParams(location.search);
      doc = q.get('doc');
      name = q.get('name');
      dataB64 = q.get('data');
      api = q.get('api');
    }
    if (location.hash) {
      const h = location.hash.replace(/^#/, '');
      const qh = new URLSearchParams(h);
      doc = doc || qh.get('doc');
      name = name || qh.get('name');
      dataB64 = dataB64 || qh.get('data');
      api = api || qh.get('api');
      bundleB64 = qh.get('bundle');
    }
  // ネイティブ API は非対応とする
    // bundle (複数ドキュメント) 優先
    if (bundleB64){
      try {
        const json = atob(bundleB64);
        const arr = JSON.parse(json);
        if (Array.isArray(arr) && arr.length){
          buffers.length = 0; currentIdx = -1;
          // data が無い場合は後段で file:// 読み込み
          const promises = arr.map(async (it)=>{
            const nameIt = it && it.name || null;
            const docIt  = it && it.doc  || null;
            let t = '';
            if (it && typeof it.data === 'string' && it.data.length){
              try { t = new TextDecoder('utf-8').decode(Uint8Array.from(atob(it.data), c=>c.charCodeAt(0))); } catch{}
            } else if (docIt) {
              try { t = await _fetchTextSmart(docIt); } catch { t = ''; }
            }
            t = String(t||'').replace(/\r\n?/g,'\n');
            _addBuffer({ name: nameIt, path: docIt, text: t, modified:false });
          });
          return Promise.all(promises).then(()=>{
            _switchToBuffer(0);
            _setTitle(); _renderTabbar();
            return true;
          });
        }
      } catch { /* ignore and fallthrough */ }
    }
    if (dataB64 !== null && dataB64 !== undefined) {
      try {
        const bin = dataB64.length ? Uint8Array.from(atob(dataB64), c=>c.charCodeAt(0)) : new Uint8Array();
        const txt = new TextDecoder('utf-8').decode(bin);
  const t = txt.replace(/\r\n?/g,'\n');
  editor.value = t;
  if (buffers.length===0){ _addBuffer({ name: name||null, path: doc||null, text: t, modified:false }); }
  else { const b=currentBuffer(); b.name = name||b.name; b.path = doc||b.path; b.text=t; b.modified=false; }
  _setTitle(); _renderTabbar();
        return Promise.resolve(true);
      } catch { /* fallthrough */ }
    }
    if (!doc) return Promise.resolve(false);
    return _fetchTextSmart(doc).then(txt=>{
  const t = txt.replace(/\r\n?/g,'\n');
  editor.value = t;
  if (buffers.length===0){ _addBuffer({ name: name||null, path: doc||null, text: t, modified:false }); }
  else { const b=currentBuffer(); if(name) b.name = name; b.path = doc; b.text=t; b.modified=false; }
  _setTitle(); _renderTabbar();
      return true;
    }).catch(()=>{
      return false;
    });
  }

  /*********************************************************
   * 1. initialQuickViewportPaint
   *********************************************************/
  function initialQuickViewportPaint(){
    gutter.innerHTML = '';
  }

  /*********************************************************
   * 2. clampViewportExactLines
   *********************************************************/
  function clampViewportExactLines(){
    let h = viewport.clientHeight;
    if (_needsHScrollReserve()) h -= HSCROLL_RESERVE;
    const raw = h / LINE_HEIGHT;
    const lines = (raw - Math.floor(raw) >= ROUND_THRESH ? Math.ceil(raw) : Math.floor(raw));
    const target = lines * LINE_HEIGHT;
    const diff = viewport.clientHeight - target;
    if (Math.abs(diff - parseInt(viewport.style.paddingBottom||'0',10)) > 0.1) {
      viewport.style.paddingBottom = diff + 'px';
    }
    _cachedVisibleCount = lines;
  }

  /*********************************************************
   * 3. _initLineLock / adjust
   *********************************************************/
  function _initLineLock(){ _lineLockActive = true; }
  function _exactLineLockAdjust(){ if(!_lineLockActive) return; /* future */ }

  /*********************************************************
   * Caret / Stripe
   *********************************************************/
  function _repositionCaret(){
    const row1 = caretRow + 1;
    const topLine = _topLine();
    const offsetLines = row1 - topLine;
    if (offsetLines < 0) { edstripe.style.display='none'; return; }
    const topPx = offsetLines * LINE_HEIGHT;
    if (topPx >= 0 && topPx < viewport.clientHeight) {
      edstripe.style.display='';
      edstripe.style.top = topPx + 'px';
      edstripe.style.height = LINE_HEIGHT + 'px';
    } else {
      edstripe.style.display='none';
    }

    // caret rectangle (column) using text measurement for monospace
    let caret = caretLayer.querySelector('.caret');
    if (!caret){
      caret = document.createElement('div');
      caret.className = 'caret';
      caretLayer.appendChild(caret);
    }
    const lines = _splitLines();
    const line = lines[caretRow] || '';
    // use measurement: set content to substring up to caretCol
    _measureSpan.textContent = line.slice(0, caretCol);
    const x = _measureSpan.getBoundingClientRect().width; // px
    caret.style.left = x + 'px';
    caret.style.top = topPx + 'px';
    caret.style.height = LINE_HEIGHT + 'px';
  }

  /*********************************************************
   * ensureScrolloff
   *********************************************************/
  function ensureScrolloff(opts={}){
    const linesTotal = _totalLines();
    const vis = _visibleLinesExact();
    let topLine = _topLine();
    const caretLine1 = caretRow + 1;
    const centerOnce = opts.centerOnce || _centerScrolloffOnce;
    const big = scrolloff >= 99999;

    if (big || centerOnce || scrolloff >= Math.floor(vis/2)){
      const targetTop = Math.max(1, caretLine1 - Math.floor(vis/2));
      editor.scrollTop = (targetTop-1) * LINE_HEIGHT;
      _centerScrolloffOnce = false;
    } else {
      if (caretLine1 < topLine + scrolloff){
        const newTop = Math.max(1, caretLine1 - scrolloff);
        if (newTop !== topLine) editor.scrollTop = (newTop-1)*LINE_HEIGHT;
      } else if (caretLine1 > topLine + vis - scrolloff - 1){
        const newTop = Math.max(1, caretLine1 - (vis - scrolloff - 1));
        if (newTop !== topLine) editor.scrollTop = (newTop-1)*LINE_HEIGHT;
      }
    }
    topLine = _topLine();
    const maxTop = Math.max(1, linesTotal - vis + 1 + 1); // +1 行余白
    if (topLine > maxTop){
      editor.scrollTop = (maxTop-1)*LINE_HEIGHT;
    }
  }

  /*********************************************************
   * updateGutter
   *********************************************************/
  function updateGutter(){
    const T = (window.THEME || {});
    const vis = _visibleLinesExact();
    const top = _topLine();
    const total = _totalLines();
    const active1 = caretRow + 1;
    const end = Math.min(total, top + vis - 1);
    const rows = [];
    for (let ln=top; ln<=end; ln++){
      const active = ln === active1;
      rows.push({ ln, active });
    }
    const drawn = end - top + 1;
    for (let i=0;i<Math.max(0, vis-drawn); i++) rows.push({ ln:null, eof:true });

    // minimal diff update
    const children = Array.from(gutter.children);
    for (let i=0;i<rows.length; i++){
      const r = rows[i];
      let el = children[i];
      if (!el){
        el = document.createElement('div');
        el.style.height = LINE_HEIGHT+'px';
        gutter.appendChild(el);
      }
      if (r.eof){
        el.textContent = '';
        el.style.background = (T.eofGutterFillColor||'#0f1117');
        el.style.color = (T.gutterNumberColor||'#57607a');
      } else {
        el.textContent = r.ln;
        el.style.background = r.active ? (T.activeLineBg||'#1b2231') : 'transparent';
        el.style.color = r.active ? (T.activeLineNumberColor||'#a6accd') : (T.gutterNumberColor||'#57607a');
      }
    }
    // remove extra children
    for (let i=rows.length; i<children.length; i++){
      gutter.removeChild(children[i]);
    }
  }

  /*********************************************************
   * Movement
   *********************************************************/
  function _moveCaretLines(delta){
    const lines = _splitLines();
    caretRow = Math.max(0, Math.min(lines.length-1, caretRow + delta));
    const line = lines[caretRow] || '';
    caretCol = Math.max(0, Math.min(line.length, caretCol));
    ensureScrolloff();
  }
  function _moveCaretCols(delta){
    const line = (_splitLines()[caretRow] || '');
    caretCol = Math.max(0, Math.min(line.length, caretCol + delta));
  }

  /*********************************************************
   * runCommand (:N)
   *********************************************************/
  function runCommand(cmd){
    // :b [N|query] — Enter で確定（数字のみは優先）
    if (/^:b/i.test(cmd)){
      const mNum = cmd.match(/^:b\s*(\d+)\s*$/i);
      if (mNum){
        const nArg = parseInt(mNum[1],10);
        if (Number.isFinite(nArg) && nArg>=1 && nArg<=buffers.length){
          _switchToBuffer(nArg-1);
          _bufPopupHide();
          _setMode('NORMAL');
          return;
        }
      }
      if (_bufPopupVisible()){
        // 現在の可視リストから選択アイテムの絶対インデックスへマップ
        const list = _bufPopupComputeList ? _bufPopupComputeList() : buffers.map((b,i)=>({b,i}));
        if (list.length === 0){
          // 無該当
          const q = (_bufFilter||'').trim();
          if (q) toast('No such buffer: ' + q);
          _bufPopupHide();
          _setMode('NORMAL');
          return;
        }
        const visIdx = Math.max(0, Math.min(list.length-1, _bufSel));
        const absIdx = (list[visIdx] ? list[visIdx].i : currentIdx);
        if (Number.isFinite(absIdx)) _switchToBuffer(absIdx);
        _bufPopupHide();
        _setMode('NORMAL');
        return;
      } else {
        _bufPopupShow();
        return; // ここで待機し、Enter で確定
      }
    }
    // :N jump
    const numOnly = cmd.match(/^:?(\d+)$/);
    if (numOnly){
      const n = parseInt(numOnly[1],10);
      const last = _totalLines();
      caretRow = Math.max(0, Math.min(last-1, n-1));
      _centerScrolloffOnce = true;
      ensureScrolloff({centerOnce:true});
      _repositionCaret();
      updateGutter();
      _setMode('NORMAL');
      return;
    }
    // q -> close
    if (cmd === ':q' || cmd === ':quit'){
      window.close();
      return;
    }
    // :set so=N
    const m = cmd.match(/^:set\s+so\s*=\s*(\d+)$/i);
    if (m){
      const n = parseInt(m[1],10);
      if (!Number.isNaN(n)) window.six.setScrolloff(n);
      return;
    }
    // :e [path]  / :e で現バッファ再読込
    const em = cmd.match(/^:e!?\s*(.*)$/);
    if (em){
      const arg = (em[1]||'').trim();
      if (!arg){
        // no-arg: 現バッファの再読込（pathがない場合はファイルピッカー）
        const b = currentBuffer();
        if (b && b.path){
          _loadFromPath(b.path, null, {silentOnFail:true, mode:'replace'}).then(ok=>{
            if(!ok){
              const cwd = _dirnameURL(b.path);
              _pickNative(cwd, b.name).then(chosen=>{
                if (chosen){ _loadFromPath(chosen, null, {mode:'replace'}); }
                else { _pickAndLoadFile({mode:'replace'}); }
              });
            }
          });
        } else {
          const base = _htmlBaseURL();
          _pickNative(base, '').then(chosen=>{
            if (chosen){ _loadFromPath(chosen, null, {mode:'new'}); }
            else { _pickAndLoadFile({mode:'new'}); }
          });
        }
      } else {
        // 相対は現バッファのディレクトリ、なければ _six.html の場所を基点
        let base = null;
        const cur = currentBuffer();
        if (cur && cur.path){
          const dir = _dirnameURL(cur.path);
          base = dir;
        } else {
          base = _htmlBaseURL();
        }

        // ディレクトリ指定ヒントの場合は、読み込みを試さずにピッカーを開く
        if (_isDirHint(arg)){
          // ディレクトリ指定時は即ブラウザピッカー（初期ディレクトリ指定は不可）
          _pickAndLoadFile();
          return;
        }

        // まずは直接 file:// 読み込みを試す（XHR + fetch フォールバック）
        // 引数ありは新規バッファとして追加
        _loadFromPath(arg, base, {silentOnFail:true, mode:'new'}).then(ok=>{
          if (ok) return;
          // 失敗時は直ちにブラウザピッカー
          _pickAndLoadFile({mode:'new'});
        });
      }
      return;
    }
    // :reload -> location.reload (hash保持)
    if (cmd === ':reload'){
      location.reload(); return;
    }

    // :pick -> ネイティブ/ブラウザピッカーを即時起動
    if (cmd === ':pick'){
      _pickAndLoadFile();
      return;
    }

    // :pick! -> ネイティブのみ試行（フォールバックしない）
    if (cmd === ':pick!'){
      // ネイティブは使わないため :pick と同等
      _pickAndLoadFile();
      return;
    }

    // :api? -> 現在の #api を表示
    if (cmd === ':api?' || cmd === ':echo api'){
      alert('api = (none)');
      return;
    }
  }

  function _setMode(m){
    _mode = m;
    if (modestatus) modestatus.textContent = '['+_mode+']';
  }

  // toast
  const _toastEl = document.getElementById('toast');
  const _toastMsg = _toastEl ? _toastEl.querySelector('.msg') : null;
  let _toastTimer = null;
  function toast(msg, ms=5000){
    if (!_toastEl || !_toastMsg) { try{ alert(msg); }catch{} return; }
    _toastMsg.textContent = String(msg||'');
    _toastEl.style.display = '';
    if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
    _toastTimer = setTimeout(()=>{ _toastEl.style.display='none'; }, Math.max(300, ms));
  }

  function _clearPending(){
    _pendingNormal = null;
    if (_pendingTimer){ clearTimeout(_pendingTimer); _pendingTimer = null; }
  }

  /*********************************************************
   * Events
   *********************************************************/
  function bindEvents(){
    viewport.addEventListener('scroll', ()=>{ _repositionCaret(); updateGutter(); });
    editor.addEventListener('scroll', ()=>{ _repositionCaret(); updateGutter(); });
    editor.addEventListener('beforeinput', (e)=>{
      if (_mode !== 'INSERT'){
        // NORMAL/CMD ではテキスト変更を禁止
        e.preventDefault();
      }
    });
    editor.addEventListener('input', ()=>{
      if (_mode === 'INSERT'){
        const b = currentBuffer(); if (b){ b.modified = true; b.text = editor.value; }
        _setTitle(); _renderTabbar();
      }
      _exactLineLockAdjust(); _repositionCaret(); updateGutter();
    });
    editor.addEventListener('keyup', (e)=>{ if(e.key==='Enter') ensureScrolloff(); _repositionCaret(); updateGutter(); });
    editor.addEventListener('click', ()=>{ _repositionCaret(); updateGutter(); });
    window.addEventListener('resize', ()=>{ clampViewportExactLines(); _exactLineLockAdjust(); ensureScrolloff(); _repositionCaret(); updateGutter(); });
    editor.addEventListener('keydown', (e)=>{
      if (_mode === 'CMD') return;
      if (_mode === 'INSERT'){
        if (e.key==='Escape'){ e.preventDefault(); _setMode('NORMAL'); return; }
        return; // テキスト入力はデフォルトに委ねる
      }
      // NORMAL
      if (e.key===':' && !e.ctrlKey){ e.preventDefault(); _setMode('CMD'); _clearPending(); if (cmdinput){ cmdinput.value=''; Promise.resolve().then(()=>cmdinput.focus()); } return; }
      if (e.key==='j'){ e.preventDefault(); _moveCaretLines(1); _repositionCaret(); updateGutter(); return; }
      if (e.key==='k'){ e.preventDefault(); _moveCaretLines(-1); _repositionCaret(); updateGutter(); return; }
      if (e.key==='h'){ e.preventDefault(); _moveCaretCols(-1); _repositionCaret(); return; }
      if (e.key==='l'){ e.preventDefault(); _moveCaretCols(1); _repositionCaret(); return; }
      if (e.key==='i'){ e.preventDefault(); _setMode('INSERT'); return; }
      // 'gg' (go to first line) / 'G' (go to last line)
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey){
        e.preventDefault();
        if (_pendingNormal === 'g'){
          // gg detected
          _clearPending();
          caretRow = 0; _centerScrolloffOnce = true; ensureScrolloff({centerOnce:true}); _repositionCaret(); updateGutter();
        } else {
          _pendingNormal = 'g';
          if (_pendingTimer) clearTimeout(_pendingTimer);
          _pendingTimer = setTimeout(()=>{ _pendingNormal = null; _pendingTimer = null; }, 800);
        }
        return;
      }
      if (e.key === 'G' && !e.ctrlKey && !e.metaKey){
        e.preventDefault(); _clearPending();
        caretRow = Math.max(0, _totalLines()-1); _centerScrolloffOnce = true; ensureScrolloff({centerOnce:true}); _repositionCaret(); updateGutter();
        return;
      }
      // other keys cancel pending sequences
      _clearPending();
      // NORMALモードでは、未対応キーでのテキスト挿入を抑止
      const isPrintable = (e.key.length === 1) && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isEditKey = ['Enter','Tab','Backspace','Delete','Insert'].includes(e.key);
      if (isPrintable || isEditKey){ e.preventDefault(); return; }
    });
    if (cmdinput){
      cmdinput.addEventListener('keydown',(e)=>{
        if (e.key==='Enter'){
          e.preventDefault(); e.stopPropagation();
          const raw = cmdinput.value.trim();
          if (raw){ runCommand(raw.startsWith(':')?raw:(':'+raw)); }
          cmdinput.value = '';
          _setMode('NORMAL');
          _bufPopupHide();
          // Enter の keyup が editor に落ちないよう、フォーカス復帰を遅延
          setTimeout(()=>editor.focus(), 0);
        } else if (e.key==='Escape'){
          e.preventDefault(); e.stopPropagation();
          cmdinput.value = '';
          _setMode('NORMAL');
          _bufPopupHide();
          setTimeout(()=>editor.focus(), 0);
        } else if (e.key==='ArrowDown' || e.key==='ArrowUp'){
          // buf popup navigation
          if (_bufPopupVisible()){
            e.preventDefault(); e.stopPropagation();
            _bufPopupMove(e.key==='ArrowDown'?1:-1);
          }
        }
      });
      cmdinput.addEventListener('input', ()=>{
        const vRaw = cmdinput.value;
        const v = vRaw; // keep spaces for parsing
        // 1) 完全一致 ":bN"（空白なし、末尾に他文字なし）を検出し、即確定ルール適用
        let m;
        if ((m = v.match(/^\s*:?[\s]*b([0-9]+)$/i))){
          const n = parseInt(m[1],10);
          const total = buffers.length;
          const ambiguousOne = (total>=10 && total<=19 && n===1);
          if (!Number.isNaN(n)){
            if (!ambiguousOne && n>=1 && n<=total){
              // 即確定
              _switchToBuffer(n-1);
              _bufPopupHide();
              _setMode('NORMAL');
              cmdinput.value = '';
              setTimeout(()=>editor.focus(), 0);
              return;
            }
            // あいまい（10〜19 で :b1）や範囲外はフィルタとして扱う
            _bufFilterKind = 'text';
            _bufFilter = String(n);
            _bufSelAbs = null;
            if (!_bufPopupVisible()) _bufPopupShow(); else _bufPopupRender();
            return;
          }
        }

        // 2) ":b N"（bの後に空白あり+数字）→ 選択のみ変更（確定はしない）
        if ((m = v.match(/^\s*:?[\s]*b\s+([0-9]+)\s*$/i))){
          const n = parseInt(m[1],10);
          if (!Number.isNaN(n)){
            _bufFilterKind = 'numPrefix';
            _bufFilter = String(n);
            _bufSelAbs = Math.max(0, Math.min(buffers.length-1, n-1));
            if (!_bufPopupVisible()) _bufPopupShow(); else _bufPopupRender();
            return;
          }
        }

        // 3) ":b <query>"（テキスト）→ インクリメンタル絞り込み
        if ((m = v.match(/^\s*:?[\s]*b\s+(.*)$/i))){
          _bufFilterKind = 'text';
          _bufFilter = (m[1]||'');
          _bufSelAbs = null;
          if (!_bufPopupVisible()) _bufPopupShow(); else _bufPopupRender();
          return;
        }

        // 4) まだ ":b" 入力途中 → ポップアップを出して待機
        if (/^\s*:?[\s]*b\s*$/i.test(v)){
          _bufFilterKind = 'text';
          _bufFilter = '';
          _bufSelAbs = null;
          if (!_bufPopupVisible()) _bufPopupShow(); else _bufPopupRender();
          return;
        }

        // 5) それ以外は非表示
        _bufPopupHide();
      });
    }
  }

  /*********************************************************
   * Buffer popup (:b ...)
   *********************************************************/
  const bufpopup = document.getElementById('bufpopup');
  const bufpopupInner = bufpopup ? bufpopup.querySelector('.inner') : null;
  let _bufSel = 0;              // 可視リスト内の選択インデックス
  let _bufSelAbs = null;        // 絶対バッファインデックス（必要時）
  let _bufFilter = '';
  let _bufFilterKind = 'text';  // 'text' | 'numPrefix'
  function _bufPopupVisible(){ return bufpopup && bufpopup.style.display !== 'none'; }
  function _bufPopupComputeList(){
    const q = (_bufFilter||'').trim().toLowerCase();
    const kind = _bufFilterKind;
    return buffers
      .map((b,i)=>({b,i}))
      .filter(({b,i})=>{
        if (!q) return true;
        if (kind === 'numPrefix'){
          // 番号プレフィックス一致（"2" → 2,20,21...）
          const idxStr = String(i+1);
          return idxStr.startsWith(q);
        }
        // text: 先頭一致（ファイル名/パス/装飾ラベル）
        const name = (b.name||'').toLowerCase();
        const path = (b.path||'').toLowerCase();
        const decorated = (_bufferNumberLabel(i+1) + ' ' + (b.name||'')).toLowerCase();
        return name.startsWith(q) || path.startsWith(q) || decorated.startsWith(q);
      });
  }
  function _bufPopupRender(){
    if (!bufpopup || !bufpopupInner) return;
    bufpopupInner.innerHTML = '';
    const list = _bufPopupComputeList();
    // 絶対指定があれば可視インデックスへ変換
    if (_bufSelAbs != null){
      const visIdx = list.findIndex(({i})=> i === _bufSelAbs);
      _bufSel = (visIdx >= 0 ? visIdx : 0);
    }
    // _bufSel は可視リストの範囲に収める
    if (list.length===0) { _bufSel = 0; }
    else { _bufSel = Math.max(0, Math.min(list.length-1, _bufSel)); }
    const items = list.map(({b,i},visIdx)=>{
      const div = document.createElement('div');
      div.className = 'item'+(visIdx===_bufSel?' active':'');
      const num = document.createElement('span'); num.className='num'; num.textContent = _bufferNumberLabel(i+1);
      const name = document.createElement('span'); name.className='name'; name.textContent = b.name || '(untitled)';
      div.appendChild(num); div.appendChild(name);
      div.addEventListener('click', ()=>{ _switchToBuffer(i); _bufPopupHide(); _setMode('NORMAL'); setTimeout(()=>editor.focus(),0); });
      return div;
    });
    items.forEach(el=>bufpopupInner.appendChild(el));
  }
  function _bufPopupShow(){ if (!bufpopup) return; bufpopup.style.display=''; if (!(_bufSel>=0)) _bufSel=Math.max(0,Math.min(buffers.length-1,currentIdx)); _bufPopupRender(); }
  function _bufPopupHide(){ if (!bufpopup) return; bufpopup.style.display='none'; }
  function _bufPopupMove(d){ if (!bufpopup) return; _bufSel=_bufSel+d; if (_bufSel<0) _bufSel=0; _bufPopupRender(); }

  function _extractBufQuery(){
    if (!cmdinput) return '';
    const v = cmdinput.value.trim();
    const m = v.match(/^:?[\s]*b\s+(.*)$/i);
    return m ? m[1] : '';
  }

  // runCommand へのフック（Enter確定）

  /*********************************************************
   * Seed demo
   *********************************************************/
  function _seedDemo(){
    if (editor.value) return;
    const arr=[]; for(let i=1;i<=400;i++) arr.push(String(i).padStart(4,' ')+'  The quick brown fox jumps over the lazy dog.');
    const t = arr.join('\n');
    editor.value = t;
    if (buffers.length===0){ _addBuffer({ name: null, path: null, text: t, modified:false }); }
  }

  /*********************************************************
   * Bootstrap
   *********************************************************/
  document.addEventListener('DOMContentLoaded', ()=>{
    _applyTheme();
    _loadDocFromQuery().then(loaded=>{
      if(!loaded) _seedDemo();
      initialQuickViewportPaint();
      clampViewportExactLines();
      _initLineLock();
      bindEvents();
      if (cmdinput){ cmdinput.placeholder = 'command (e.g. 100, q)'; }
      // 起動直後に caret を 0,0 に固定し、可視化とスクロール確保
      caretRow = Math.max(0, Math.min(_totalLines()-1, caretRow));
      caretCol = Math.max(0, caretCol);
      ensureScrolloff({centerOnce:false});
      _repositionCaret();
      updateGutter();
      _renderTabbar();
      // フォーカス強制（タイミング競合を避ける）
      setTimeout(()=>editor.focus(), 0);
    });
  });

  window.six = {
    runCommand,
    setScrolloff:(n)=>{ scrolloff = n; ensureScrolloff(); _repositionCaret(); updateGutter(); }
  };
})();
