const VERSION = 0.9;
const VERSION_STR = 'vi like TextEditor "six" v' + VERSION;
// six migration oriented bootstrap (spec-aligned skeleton with file load)
(function(){
  // Multi-instance lock (#643): prevent opening a second active instance.
  // Best-effort: use localStorage key with timestamp + heartbeat; if active lock recent, abort early.
  try{
    const LOCK_KEY = 'six.instance.lock.v1';
    const now = Date.now();
    const raw = localStorage.getItem(LOCK_KEY);
    let prev = null; try{ prev = raw?JSON.parse(raw):null; }catch{ prev=null; }
    const STALE_MS = 5*60*1000; // consider stale after 5 minutes (session likely dead)
    const isRecent = !!(prev && typeof prev.t==='number' && (now - prev.t) < STALE_MS);
    if (isRecent){
      // Already running: show minimal banner then close.
      try{
        const msg = document.createElement('div');
        msg.textContent = 'six: already running (multi-instance blocked)';
        msg.style.position='fixed'; msg.style.top='40%'; msg.style.left='50%'; msg.style.transform='translate(-50%,-50%)';
        msg.style.background='rgba(0,0,0,0.8)'; msg.style.color='yellow'; msg.style.padding='16px 24px'; msg.style.font='16px monospace'; msg.style.zIndex='99999'; msg.style.border='1px solid #666';
                  // raw (WSL host prefix補正後表示) を再取得
                  let disp2 = String(_fileTypedDirRaw||'');
                  try{ const b=_ensureSlash(_fileBaseURL); if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost'){ disp2='//'+b.host+'/'+disp2.replace(/^\/+/,''); } }catch{}
                  cmdinput.value = ':e ' + _collapseDotDotPath(disp2 + '..');
      }catch{}
      try{ setTimeout(()=>{ try{ window.close(); }catch{} }, 900); }catch{}
      return; // stop bootstrap; do not restore session
    }
    // Acquire lock
    try{ localStorage.setItem(LOCK_KEY, JSON.stringify({ t: now })); }catch{}
    // Heartbeat: refresh timestamp periodically to keep lock fresh
    try{ setInterval(()=>{ try{ localStorage.setItem(LOCK_KEY, JSON.stringify({ t: Date.now() })); }catch{} }, 60*1000); }catch{}
    // On unload: mark lock stale sooner (optional) — just clear timestamp so another instance can start immediately
    try{ window.addEventListener('beforeunload', ()=>{ try{ localStorage.removeItem(LOCK_KEY); }catch{} }); }catch{}
  }catch{}
  const caretLayer = document.getElementById('caretLayer');
  const edstripe   = document.getElementById('edstripe');
  // Core editor elements
  const viewport   = document.getElementById('editorViewport');
  const editor     = document.getElementById('editor');
  const gutter     = document.getElementById('gutter');
  const tabbarEl   = document.getElementById('tabbar');
  const tabbarTabs = tabbarEl ? tabbarEl.querySelector('.tabs') : null;
  const tabbarTools = tabbarEl ? tabbarEl.querySelector('#tabtools') : null;
  const tabScrollLeftBtn = tabbarEl ? document.getElementById('tabScrollLeft') : null;
  const tabScrollRightBtn = tabbarEl ? document.getElementById('tabScrollRight') : null;
  const posinfoEl = document.getElementById('posinfo');
  // ユーザー水平ホイール直後の自動水平再センタリング抑止ガード (#868)
  let _userHScrollGuardUntil = 0;
  // NORMAL/VISUAL モードで ctrl なしの横方向 wheel (チルト) により明示的に scrollLeft を加算しガードセット
  try{
    viewport && viewport.addEventListener('wheel', (e)=>{
      try{
        if (!e.ctrlKey && Math.abs(e.deltaX) > 0){
          // deltaX 正負で自然方向に移動。ブラウザは右スクロールで正値になるケースが多い。
          const cur = (editor && typeof editor.scrollLeft==='number')? (editor.scrollLeft|0) : 0;
          const step = e.deltaX; // そのまま使用（OS 依存で適度なピクセル値）
          const next = Math.max(0, cur + step);
          if (editor && next !== cur){ editor.scrollLeft = next; }
          _userHScrollGuardUntil = Date.now() + 600; // 600ms 自動再センタリング抑止
          e.preventDefault(); e.stopPropagation();
        }
      }catch{}
    }, { passive:false });
  }catch{}
  function _updateTabScrollButtons(){
    try{
      if (!tabbarTabs || !tabScrollLeftBtn || !tabScrollRightBtn) return;
      const max = Math.max(0, (tabbarTabs.scrollWidth|0) - (tabbarTabs.clientWidth|0));
      const x = (tabbarTabs.scrollLeft|0);
      const canL = x > 0;
      const canR = x < max - 1;
      tabScrollLeftBtn.classList.toggle('disabled', !canL);
      tabScrollRightBtn.classList.toggle('disabled', !canR);
    }catch{}
  }
  // タブバー水平スクロール: delta は方向単位。幅に応じて適度なピクセルへ変換。
  function _scrollTabsBy(delta){
    try{
      if (!tabbarTabs) return;
      // 1 単位 = 可視幅の 0.6 程度 (最低 80px)
      const step = Math.max(80, Math.round(tabbarTabs.clientWidth * 0.6));
      const target = tabbarTabs.scrollLeft + step * delta;
      tabbarTabs.scrollTo({ left: target, behavior: 'smooth' });
      // 即時のボタン状態更新 (smooth 終了後の再更新も予約)
      _updateTabScrollButtons();
      setTimeout(_updateTabScrollButtons, 220);
    }catch{}
  }
  // Position info: visual column using tab stops & full-width=2 (#508). TAB advances to next tab stop.
  function _updatePosInfo(){
    try{
      if (!posinfoEl) return;
      const lines = _splitLines();
      const r = Math.max(0, Math.min(lines.length-1, caretRow|0));
      _fileParentLog({ phase:'enter', baseURL:String(_fileBaseURL), baseDir:String(baseDir), fullPath, typedRaw:_fileTypedDirRaw, isDriveRoot, isUncHostRoot });
        const line = lines[r] || '';
        // 可視幅計測は後段の _visualWidthUpToLine を利用
      const visCol = _visualWidthUpToLine(line, caretCol|0);
      const visTotal = _visualWidthUpToLine(line, (line||'').length);
      // 表示形式: 「行Y, 列X/W」 (#633)
      posinfoEl.textContent = '行' + (r+1) + ', ' + '列' + (visCol+1) + '/' + (visTotal+1);
      // THEME反映 (#634): window.THEME.posInfoText or fallback 'yellow'
      try{ let col='yellow'; if (window && window.THEME && window.THEME.posInfoText){ col=String(window.THEME.posInfoText); } posinfoEl.style.color=col; }catch{}
      setTimeout(_updateTabScrollButtons, 120);
    }catch{}
  }
  try{ tabScrollLeftBtn && tabScrollLeftBtn.addEventListener('click', ()=>{ try{ if (!tabScrollLeftBtn.classList.contains('disabled')) _scrollTabsBy(-1); }catch{} }); }catch{}
  try{ tabScrollRightBtn && tabScrollRightBtn.addEventListener('click', ()=>{ try{ if (!tabScrollRightBtn.classList.contains('disabled')) _scrollTabsBy(+1); }catch{} }); }catch{}
  try{ tabbarTabs && tabbarTabs.addEventListener('scroll', _updateTabScrollButtons); }catch{}
  // Update tab scroll buttons and track normal window bounds on resize
  try{ window.addEventListener('resize', ()=>{ try{ _updateTabScrollButtons(); }catch{} try{ _updateNormalBoundsFromWindow(); }catch{} }); }catch{}
  const encBtn    = document.getElementById('encBtn');
  const cmdinput   = document.getElementById('cmdinput');
  const cmdfloat   = document.getElementById('cmdfloat');
  const modestatus = document.getElementById('modestatus');


  // layout constants (should match CSS)
  let LINE_HEIGHT = 20;        // px (will sync with computed CSS)
  let FONT_SIZE   = 18;        // px (will sync with computed CSS)
  const HSCROLL_RESERVE = 0;     // px
  const ROUND_THRESH = 0.5;      // fraction

  // editor state
  let buffers = [];
  let currentIdx = -1;
  let caretRow = 0;
  let caretCol = 0;
  // IME / caret visuals state
  // IME heuristics removed (#426 request) – no mode-based caret color overrides now
  // (Previously: _imeActive, _imeFullwidth flags for composition & full-width detection)
  // We retain baseline caret variables only for theme restoration.
  let _caretGradStartBase = null, _caretGradMidBase = null; // theme baseline to restore
  // session/quit control flags
  let _skipPersistOnUnloadOnce = false; // suppress one-time session persist at unload
  let _suppressPersistOnQuit = false;   // do not rewrite session on this quit path
  // Track last known total lines to detect shrink/expand for post-edit scroll snapping (#436)
  let _lastLinesForSnap = 0;
  // session persistence
  const _SESSION_KEY = 'six.session.v1';
  let _persistTimer = null;
  // Update normal (restored) bounds cache on demand
  function _updateNormalBoundsFromWindow(){
    try{
      const w = window;
      const iw = (w.innerWidth||0)|0, ih=(w.innerHeight||0)|0;
      const ow = (w.outerWidth||iw)|0, oh=(w.outerHeight||ih)|0;
      const sx = (w.screenX||0)|0, sy = (w.screenY||0)|0;
      let isMax = false; let snap = null;
      try{
        const availW = (screen && screen.availWidth) ? (screen.availWidth|0) : 0;
        const availH = (screen && screen.availHeight) ? (screen.availHeight|0) : 0;
        const tol = 6;
        if (availW>0 && availH>0){ if (Math.abs(availW-ow)<=tol && Math.abs(availH-oh)<=tol) isMax = true; }
        const edgeTol = 10; if (!isMax && availW>0){ if (sx<=edgeTol) snap='left'; else if (Math.abs((sx+ow)-availW)<=edgeTol) snap='right'; }
      }catch{}
      if (!isMax && !snap){
        if (!window.__sixNormalBounds) window.__sixNormalBounds = { innerW: iw, innerH: ih, outerW: ow, outerH: oh, x: sx, y: sy };
        window.__sixNormalBounds.innerW = iw; window.__sixNormalBounds.innerH = ih;
        window.__sixNormalBounds.outerW = ow; window.__sixNormalBounds.outerH = oh;
        window.__sixNormalBounds.x = sx; window.__sixNormalBounds.y = sy;
      }
    }catch{}
  }
  function _captureWindowStateForSession(){
    try{
      const w = window;
      const iw = (w.innerWidth||0)|0, ih=(w.innerHeight||0)|0;
      const ow = (w.outerWidth||iw)|0, oh=(w.outerHeight||ih)|0;
      const sx = (w.screenX||0)|0, sy=(w.screenY||0)|0;
      let isMax = false; let snap = null; let availW=0, availH=0;
      try{
        availW = (screen && screen.availWidth) ? (screen.availWidth|0) : 0;
        availH = (screen && screen.availHeight) ? (screen.availHeight|0) : 0;
        const tol = 6;
        if (availW>0 && availH>0){ if (Math.abs(availW-ow)<=tol && Math.abs(availH-oh)<=tol) isMax = true; }
        const edgeTol = 10; if (!isMax && availW>0){ if (sx<=edgeTol) snap='left'; else if (Math.abs((sx+ow)-availW)<=edgeTol) snap='right'; }
      }catch{}
      if (!window.__sixNormalBounds) window.__sixNormalBounds = { innerW: iw, innerH: ih, outerW: ow, outerH: oh };
      try{ if (!isMax && !snap){ window.__sixNormalBounds.innerW = iw; window.__sixNormalBounds.innerH = ih; window.__sixNormalBounds.outerW = ow; window.__sixNormalBounds.outerH = oh; window.__sixNormalBounds.x = sx; window.__sixNormalBounds.y = sy; } }catch{}
      const ws = {
        innerW: iw, innerH: ih,
        outerW: ow, outerH: oh,
        screenX: sx, screenY: sy,
        isMaximized: !!isMax,
        snapEdge: snap,
        normalInnerW: window.__sixNormalBounds ? window.__sixNormalBounds.innerW : null,
        normalInnerH: window.__sixNormalBounds ? window.__sixNormalBounds.innerH : null,
        normalOuterW: window.__sixNormalBounds ? window.__sixNormalBounds.outerW : null,
        normalOuterH: window.__sixNormalBounds ? window.__sixNormalBounds.outerH : null,
        normalX: window.__sixNormalBounds ? window.__sixNormalBounds.x : null,
        normalY: window.__sixNormalBounds ? window.__sixNormalBounds.y : null,
        emulateMaxOuterW: isMax ? (availW||null) : null,
        emulateMaxOuterH: isMax ? (availH||null) : null
      };
      return ws;
    }catch{ return null; }
  }
  function _restoreWindowFromSession(ws){
    try{
      if (!ws || typeof ws!=='object') return;
      // WebView2 host restore via postMessage
      try{
        if (window && window.chrome && window.chrome.webview && typeof window.chrome.webview.postMessage==='function'){
          window.chrome.webview.postMessage({ type:'six-window-restore', state: ws, requestMaximize: !!ws.isMaximized });
          return;
        }
      }catch{}
      // Browser fallback (best-effort): 最大化は行わず、通常サイズへ復帰（位置は normalX/Y を優先）
      if (Number.isFinite(ws.normalOuterW) && Number.isFinite(ws.normalOuterH)){
        try{ window.resizeTo(Math.max(200, ws.normalOuterW|0), Math.max(150, ws.normalOuterH|0)); }catch{}
        try{
          if (Number.isFinite(ws.normalX) && Number.isFinite(ws.normalY)) window.moveTo(ws.normalX|0, ws.normalY|0);
          else if (Number.isFinite(ws.screenX) && Number.isFinite(ws.screenY)) window.moveTo(ws.screenX|0, ws.screenY|0);
        }catch{}
      }
    }catch{}
  }
  function _syncActiveViewStateIntoBuffer(){
    try{
      const b = currentBuffer();
      if (!b) return; // Ensure buffer exists
        b.viewRow = caretRow | 0; b.viewCol = caretCol | 0;
      // snap to line grid for stability
      const st = (editor && typeof editor.scrollTop==='number') ? (editor.scrollTop|0) : 0;
    try{ b.viewScrollTop = Math.round(Math.max(0, st)/LINE_HEIGHT)*LINE_HEIGHT; }catch{ b.viewScrollTop = Math.max(0, st); }
    }catch{}
  }
  function _collectSessionPayload(opts={}){
    // opts.lite: if true, omit text for unmodified file-backed buffers to reduce footprint
  const lite = !!opts.lite;
      try{ // Attempt to sync active view state
        _syncActiveViewStateIntoBuffer();
      // Capture window state (best-effort) for session restore (#513)
      let winState = null; try{ winState = _captureWindowStateForSession(); }catch{}
      const bufs = buffers.map((b)=>{
        const isFileBacked = !!(b && b.path && /^file:\/\//i.test(b.path));
        const omitText = !!(lite && isFileBacked && !b.modified);
        // Persist limited undo history to improve post-restart UX
        let undoArr = [];
        try{
          const u = Array.isArray(b._undo) ? b._undo : [];
          const k = Math.max(0, UNDO_STEPS_IN_SESSION|0);
          const slice = (k>0 ? u.slice(-k) : []);
          undoArr = slice.map(s=>({
            text: String(s.text||''),
            caretRow: s.caretRow|0,
            caretCol: s.caretCol|0,
            scrollTop: s.scrollTop|0,
            changeTick: s.changeTick|0,
            enc: s.enc||'utf-8',
            ff: s.ff||'unix',
            bom: !!s.bom,
            kind: s.kind||null
          }));
        }catch{ undoArr = []; }
        return {
          name: b.name||null,
          path: b.path||null,
          text: omitText ? null : String(b.text||''),
          needReload: !!omitText,
          // savedText は復元時に modified=false の場合のみ意味を持つので、lite では省略可
          savedText: omitText ? null : (typeof b.savedText==='string' ? String(b.savedText) : null),
          modified: !!b.modified,
          enc: b.enc||'utf-8',
          ff: b.ff||'unix',
          bom: !!b.bom,
          viewRow: Number.isFinite(b.viewRow)?(b.viewRow|0):0,
          viewCol: Number.isFinite(b.viewCol)?(b.viewCol|0):0,
          viewScrollTop: Number.isFinite(b.viewScrollTop)?(b.viewScrollTop|0):0,
          edScale: (Number.isFinite(b.edScale) ? b.edScale : 1),
          savedMode: b.savedMode||'NORMAL',
          savedVisual: (b.savedVisual ? { linewise: !!b.savedVisual.linewise, anchorR: b.savedVisual.anchorR|0, anchorC: b.savedVisual.anchorC|0, caretR: b.savedVisual.caretR|0, caretC: b.savedVisual.caretC|0 } : null),
              shiftwidth: Number.isFinite(b.shiftwidth)? (b.shiftwidth|0) : 4,
        ignorecase: !!b.ignorecase,
        smartcase:  !!b.smartcase,
    undo: undoArr,
    extMtime: (typeof b._extMtime === 'number') ? b._extMtime : null,
    extSize: (typeof b._extSize === 'number') ? b._extSize : null,
    externalIgnored: !!b._externalChangeIgnored
        };
      });
      const payload = {
        version: 1,
        when: Date.now(),
        active: Math.max(0, Math.min((buffers.length?buffers.length-1:0), currentIdx|0)),
        buffers: bufs,
        scrolloff: Number.isFinite(scrolloff) ? (scrolloff|0) : 3,
        windowState: winState
      };
      return payload;
    }catch{ return { version:1, when:Date.now(), active:0, buffers:[] }; }
  }
  function _persistClearedSession(){
    try{
      const payload = { version:1, when:Date.now(), active:0, buffers:[], scrolloff:3 };
      try{ localStorage.setItem(_SESSION_KEY, JSON.stringify(payload)); }catch{}
    }catch{}
  }
  function _persistSessionNow(){
    try{
      const p = _collectSessionPayload({ lite:false });
          try {
              localStorage.setItem(_SESSION_KEY, JSON.stringify(p));
            return true;
        } catch (e) {
            // quota fallback: retry with lite payload
            try {
                const p2 = _collectSessionPayload({ lite: true });
                localStorage.setItem(_SESSION_KEY, JSON.stringify(p2));
                return true;
            } catch {
                return false;
            }
        }
    }catch{ return false; }
  }
  function _schedulePersist(reason){
    try{
      if (_persistTimer){ clearTimeout(_persistTimer); _persistTimer=null; }
      _persistTimer = setTimeout(()=>{ try{ _persistSessionNow(); }catch{} }, 120);
    }catch{}
  }
  function _loadSessionFromStorage(){
    try{
      const s = localStorage.getItem(_SESSION_KEY);
      if (!s) return false;
      // Corruption quick check: concatenated JSON objects or trailing junk
      try{
        const trimmed = s.trim();
        // Heuristic: if more than one opening brace at start without matching closing at end
        if (/}\s*{/.test(trimmed)){
          // Try naive split and keep first valid object only; otherwise clear
          const firstPart = trimmed.replace(/}\s*{[\s\S]*$/, '}');
          try{ JSON.parse(firstPart); localStorage.setItem(_SESSION_KEY, firstPart); }catch{ localStorage.removeItem(_SESSION_KEY); return false; }
        }
      }catch{}
      let j; try{ j = JSON.parse(localStorage.getItem(_SESSION_KEY)); }catch(e){ try{ localStorage.removeItem(_SESSION_KEY); }catch{} return false; }
      if (!j || !Array.isArray(j.buffers)) return false; 
      // Attempt window restore (best-effort). Requires host support in WebView2.
      try{ _restoreWindowFromSession(j.windowState); }catch{}
      // Restore scrolloff if present; otherwise fall back to default 3 (#473)
      try{
        if (Number.isFinite(j.scrolloff)){
          scrolloff = (j.scrolloff|0);
        } else {
          scrolloff = 3;
        }
      }catch{ scrolloff = 3; }
      // Clear current
      buffers.length = 0; currentIdx = -1;
      // Rehydrate buffers
      for (const it of j.buffers){
        const name = it && (typeof it.name==='string' ? it.name : null);
        const path = it && (typeof it.path==='string' ? it.path : null);
        const text = it && (typeof it.text==='string' ? it.text : '');
        const modified = !!(it && it.modified);
        const enc = (it && it.enc) || 'utf-8';
        const ff  = (it && it.ff)  || 'unix';
        const bom = !!(it && it.bom);
        const shiftwidth = Number.isFinite(it && it.shiftwidth) ? Math.max(1, (it.shiftwidth|0)) : 4;
        const ignorecase = !!(it && it.ignorecase);
        const smartcase  = !!(it && it.smartcase);
        const edScale = Number.isFinite(it && it.edScale) ? _nearestScale(it.edScale) : 1;
        _addBuffer({ name, path, text, modified, enc, ff, bom, shiftwidth, ignorecase, smartcase, edScale });
        try{
          const b = buffers[buffers.length-1];
          // If savedText is provided, trust it; otherwise, if not modified, set savedText=text
          if (it && typeof it.savedText==='string'){ b.savedText = it.savedText; }
          else if (!modified){ b.savedText = String(text||''); }
          // restore view
          b.viewRow = Number.isFinite(it&&it.viewRow)?(it.viewRow|0):0;
          b.viewCol = Number.isFinite(it&&it.viewCol)?(it.viewCol|0):0;
          b.viewScrollTop = Number.isFinite(it&&it.viewScrollTop)?(it.viewScrollTop|0):0;
          // restore saved mode/visual
          b.savedMode = (it && it.savedMode) || 'NORMAL';
          const sv = it && it.savedVisual;
          b.savedVisual = (sv && Number.isFinite(sv.anchorR) && Number.isFinite(sv.anchorC) && Number.isFinite(sv.caretR) && Number.isFinite(sv.caretC))
            ? { linewise: !!sv.linewise, anchorR: sv.anchorR|0, anchorC: sv.anchorC|0, caretR: sv.caretR|0, caretC: sv.caretC|0 }
            : null;
          // restore shiftwidth (default 4)
          try{ b.shiftwidth = Number.isFinite(it && it.shiftwidth) ? Math.max(1, (it.shiftwidth|0)) : (Number.isFinite(b.shiftwidth)?b.shiftwidth:4); }catch{ b.shiftwidth = (Number.isFinite(b.shiftwidth)?b.shiftwidth:4); }
          // restore case flags (default false)
          try{ b.ignorecase = !!(it && it.ignorecase); }catch{ b.ignorecase = !!b.ignorecase; }
          try{ b.smartcase  = !!(it && it.smartcase);  }catch{ b.smartcase  = !!b.smartcase;  }
          // recompute ticks from modified flag
          b._changeTick = modified ? 1 : 0; b._savedTick = 0; b.modified = !!modified;
          // Restore undo snapshots (limited) if present
          try{
            const u = (it && Array.isArray(it.undo)) ? it.undo : [];
            b._undo = u.map(s=>({
              text: String(s.text||''),
              caretRow: s.caretRow|0,
              caretCol: s.caretCol|0,
              scrollTop: s.scrollTop|0,
              changeTick: s.changeTick|0,
              enc: s.enc||'utf-8',
              ff: s.ff||'unix',
              bom: !!s.bom,
              kind: s.kind||null
            }));
            b._redo = [];
          }catch{ b._undo = b._undo||[]; b._redo = []; }
          // External modification tracking restoration
          try{ if (it && typeof it.extMtime === 'number') b._extMtime = it.extMtime; }catch{}
          try{ if (it && typeof it.extSize === 'number') b._extSize = it.extSize; }catch{}
          try{ b._externalChangeIgnored = !!(it && it.externalIgnored); }catch{}
          // Seed baseline undo only if none persisted and buffer is modified with savedText available
          try{
            if ((!(Array.isArray(b._undo) && b._undo.length)) && modified && typeof b.savedText === 'string' && b.savedText !== b.text){
              const snap = {
                text: String(b.savedText||''),
                caretRow: Number.isFinite(b.viewRow)?(b.viewRow|0):0,
                caretCol: Number.isFinite(b.viewCol)?(b.viewCol|0):0,
                scrollTop: Number.isFinite(b.viewScrollTop)?(b.viewScrollTop|0):0,
                changeTick: 0,
                enc: b.enc||'utf-8',
                ff: b.ff||'unix',
                bom: !!b.bom,
                kind: 'restore-baseline'
              };
              // Avoid duplicating if identical snapshot somehow exists
              b._undo.push(snap);
            }
          }catch{}
          // If text was omitted and file-backed, try background reload
          const needReload = !!(it && it.needReload && path && /^file:\/\//i.test(path) && !modified);
          if (needReload){
            (async()=>{
              try{
                const t2 = await _fetchTextSmart(path);
                const ff2 = (t2.indexOf('\r')>=0) ? 'dos' : 'unix';
                const hasBomChar = (t2.length>0 && t2.charCodeAt(0)===0xFEFF);
                const norm = (hasBomChar ? t2.slice(1) : t2).replace(/\r\n?/g,'\n');
                b.text = norm; b.savedText = norm; b._changeTick=0; b._savedTick=0; b.modified=false; b.enc='utf-8'; b.ff=ff2; b.bom=hasBomChar;
                // If current, reflect into editor without disturbing view state
                if ((buffers.indexOf(b)|0) === (currentIdx|0)){
                  const stKeep = (editor && typeof editor.scrollTop==='number') ? (editor.scrollTop|0) : 0;
                  editor.value = norm; _syncModifiedFromTick(); _repositionCaret(); updateGutter();
                  try{ editor.scrollTop = stKeep; }catch{}
                }
                _schedulePersist('reload');
              }catch{}
            })();
          }
        }catch{}
      }
      const act = Math.max(0, Math.min(buffers.length?buffers.length-1:0, (j.active|0)));
      if (buffers.length>0){
        // Force a real activate even when act===0. During session restore the first
        // added buffer temporarily sets currentIdx=0 in _addBuffer; if we switch
        // without resetting, _switchToBuffer would (1) early-return when act===0 or
        // (2) save the "previous" (index 0) view state using default caret/scroll (0),
        // wiping the restored viewRow/viewScrollTop for F1 (#715/#717). Avoid both by
        // clearing currentIdx so _switchToBuffer performs a full restore without
        // persisting a bogus pre-switch state.
        currentIdx = -1;
        _switchToBuffer(act);
        _setTitle(); _renderTabbar();
      }
      return buffers.length>0;
    }catch{ return false; }
  }
  // track last caret position to detect movement (for cursor hide policy)
  let _lastCaretRow = -1;
  let _lastCaretCol = -1;
  // track last time caret moved (for distinguishing caret-induced scroll vs manual scroll)
  let _lastCaretMovedAt = 0;
  // caret movement repeat state (for disabling blink while auto-repeating)
  let _caretMoving = false;
  let _caretMovePulseTimer = 0; // clears moving state after idle
  const _caretMoveIdleMs = 140; // threshold after last motion to resume blink
  // Desired visual column across vertical motions (j/k). Units: half-width columns with tabstop expansion.
  let _desiredVisualCol = null; // null until first set
  let _suppressDesiredOnce = false; // one-shot suppression flag for _setCaret
  function _tabstopVal(){ try{ const v = Number(window && window.SIX_OPTIONS && window.SIX_OPTIONS.tabstop); if (!Number.isFinite(v) || v<1) return 8; return Math.min(64, Math.max(1, v|0)); }catch{ return 8; } }
  const _FULLW_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\u3000-\u303F\uFF01-\uFF60\uFFE0-\uFFE6]/;
  function _isFullW(ch){ try{ return _FULLW_RE.test(ch||''); }catch{ return false; } }
  function _visualWidthUpToLine(line, endCol){
    try{
      let w=0; const ts=_tabstopVal(); const n=Math.max(0, Math.min((line||'').length, endCol|0));
      for (let i=0;i<n;i++){
        const ch=line[i];
        if (ch==='\t'){
          const next = ((Math.floor(w/ts)+1)*ts);
          w = next;
        } else if (_isFullW(ch)) w+=2; else w+=1;
      }
      return w;
    }catch{ return 0; }
  }
  function _colForVisual(line, desired){
    try{
      const s=String(line||''); const ts=_tabstopVal(); let w=0;
      const target = Math.max(0, desired|0);
      const len=s.length;
      for (let i=0;i<=len;i++){
        if (w>=target) return i; // caret before char i
        if (i>=len) return len;
        const ch=s[i];
        if (ch==='\t'){
          const next=((Math.floor(w/ts)+1)*ts); w=next;
        } else if (_isFullW(ch)) w+=2; else w+=1;
      }
      return len;
    }catch{ return 0; }
  }
  function _currentVisualCol(){ try{ const line=(_splitLines()[caretRow]||''); return _visualWidthUpToLine(line, caretCol|0); }catch{ return 0; } }
  function _ensureDesired(){ if (_desiredVisualCol==null) _desiredVisualCol = _currentVisualCol(); }
  // global mouse cursor visibility state
  let _cursorHidden = false;
  // scrolloff pause control: temporarily suppress ensureScrolloff after search confirm
  let _scrolloffPaused = false;
  let _scrolloffPauseAnchorR = -1;
  let _scrolloffPauseAnchorC = -1;
  // global mouse cursor visibility state and helpers (used across modules)
  const _hideCursor = ()=>{ try{ if (!_cursorHidden){ document.body.classList.add('hide-cursor'); _cursorHidden=true; } }catch{} };
  const _showCursor = ()=>{ try{ if (_cursorHidden){ document.body.classList.remove('hide-cursor'); _cursorHidden=false; } }catch{} };
  function _flagCaretMotion(){
    _lastCaretMovedAt = Date.now();
    if (!_caretMoving){ _caretMoving = true; try{ document.body.classList.add('moving-caret'); }catch{} }
    if (_caretMovePulseTimer){ try{ clearTimeout(_caretMovePulseTimer); }catch{} }
    _caretMovePulseTimer = setTimeout(()=>{
      // if no new motion in idle window, clear moving state
      if (Date.now() - _lastCaretMovedAt >= _caretMoveIdleMs){
        _caretMoving = false; try{ document.body.classList.remove('moving-caret'); }catch{}
      } else {
        // still moving; reschedule to check again
        _caretMovePulseTimer = setTimeout(arguments.callee, _caretMoveIdleMs);
      }
    }, _caretMoveIdleMs);
  }
  // Unified Escape detection (#446): treat Ctrl+[ as Esc everywhere
  function _isEsc(e){
    try{
      if (!e) return false;
      if (e.key === 'Escape') return true;
      // Ctrl+[ (Vim style) maps to ESC semantics; ignore Meta/Alt to avoid false positives
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key === '[') return true;
      // keyCode (legacy) fallback
      if (e.keyCode === 27) return true;
      return false;
    }catch{ return false; }
  }
  // editor zoom state (scale only editor/gutter, not global UI)
  let _edScale = 1;
  // short guard to ignore stray key events immediately after modal close
  let _kbdGuardUntil = 0;
  // guard window to avoid scroll snapping while zooming via wheel
  let _zoomGuardUntil = 0;
  // fixed zoom steps (percent): 50,75,90,100,110,133,180,250,300
  const _scaleSteps = [0.5, 0.75, 0.9, 1.0, 1.10, 1.33, 1.80, 2.50, 3.00];
  function _nearestScale(x){
    let best = _scaleSteps[0], diff = Math.abs(x - best);
    for (const s of _scaleSteps){ const d = Math.abs(x - s); if (d < diff){ diff = d; best = s; } }
    return best;
  }
  function _currentScaleIndex(){
    // assume _edScale is close to a step; find nearest index
    let bestIdx = 0, diff = Math.abs(_edScale - _scaleSteps[0]);
    for (let i=1;i<_scaleSteps.length;i++){ const d = Math.abs(_edScale - _scaleSteps[i]); if (d < diff){ diff=d; bestIdx=i; } }
    return bestIdx;
  }
  function _stepEditorScale(dir){
    try{
      const idx = _currentScaleIndex();
      let nextIdx = idx + (dir>0 ? 1 : -1);
      nextIdx = Math.max(0, Math.min(_scaleSteps.length-1, nextIdx));
      _setEditorScale(_scaleSteps[nextIdx]);
    }catch{}
  }
  // quit/unload control
  let _quittingAll = false;     // allow window to close without interception
  let _quitInProgress = false;  // prevent re-entrancy of quit flow
  let _allowUnloadOnce = false; // allow one reload/navigation without interception
  // environment detection
  const _isWebView2 = !!(window.chrome && window.chrome.webview);
  // numeric count prefix for NORMAL motions (e.g., 5l)
  let _countAcc = null;
  // pending operator state for NORMAL/VISUAL (e.g., d/y/c sequences)
  let _pendingOp = null;        // current operator key (e.g., 'd','y','c') or null
  let _pendingOpCount = 1;      // numeric count prefix captured before motion
  let _pendingOpSeq = null;     // sequence helper for multi-key ops (e.g., 'g')
  let _pendingOpTimer = null;   // reserved for timeouts (currently unused but cleared)
  // pending normal sequence (e.g., waiting for second 'g' in 'gg') and its timer
  let _pendingNormal = null;
  let _pendingNormalCount = null; // count captured before first '>'/'<' for >>/<<
  let _optIndentDebug = false; // debug logs disabled (removed instrumentation)
  let _pendingTimer = null;
  // unnamed register (yank/delete/paste). Initialize to avoid ReferenceError on read.
  let _regUnnamed = null;
  // --- VISUAL mode state (ensure declared before any reads) ---
  let _visualActive = false;      // currently in VISUAL mode
  let _visualLinewise = false;    // VISUAL linewise flag
  let _visualAnchorR = 0;         // VISUAL anchor row
  let _visualAnchorC = 0;         // VISUAL anchor col
  // --- VISUAL snapshot during CMD (:"…" entered from VISUAL) ---
  let _visCmdActive = false;      // whether VISUAL snapshot is active during CMD
  let _cmdFromVisual = false;     // entered CMD via ':' while in VISUAL
  // The mode to restore when leaving CMD with Escape (e.g., return to INSERT if we came from INSERT)
  let _preCmdMode = 'NORMAL';
  let _visCmdLinewise = false;    // VISUAL linewise flag at CMD entry
  let _visCmdAnchorR = 0, _visCmdAnchorC = 0; // anchor at CMD entry
  let _visCmdCaretR = 0,  _visCmdCaretC  = 0; // caret at CMD entry
  // --- Incremental search anchor (used by '/', '?', and :s preview) ---
  let _incSearchAnchorOff = null; // absolute offset anchor for incremental search
  let _incSearchDir = 'fwd';      // last incremental search direction
  // scrolloff (上下の余白行数): セッション復元があればそれを使い、無ければ既定値 3 にする。
  // SIX_OPTIONS.scrolloff は廃止（#473）。
  let scrolloff = 3;
  // How many undo steps to persist into session storage (payload size vs utility)
  const UNDO_STEPS_IN_SESSION = (function(){
    try{
      const o=(window&&window.SIX_OPTIONS)||{};
      const n=parseInt(o.UNDO_STEPS_IN_SESSION,10);
      if (Number.isFinite(n)) return Math.max(0, n|0);
    }catch{}
    // Default to 1 snapshot in session (minimal footprint); recommend overriding to 5 via SIX_OPTIONS
    return 1;
  })();
  let _cachedVisibleCount = 0;
  let _lineLockActive = false;
  let _centerScrolloffOnce = false;
  let _mode = 'NORMAL';
  // 親ディレクトリ移動関数の早期スタブ
  // 本体定義前に F1/Alt+U が来るレースを吸収し、ready になったら自動で一度 flush
  let _fileNavParentPending = false;
  let _fileNavParentWaitTimer = null;
  let _fileNavParent = function _fileNavParentStub(){
    try{
      const nowTs = Date.now();
      // 1キー押下内の多重呼び出し抑止 (グローバル + stub 二重経路)
      if (typeof window._fileParentNavLastTs === 'number'){
        if (nowTs - window._fileParentNavLastTs < 120){
          try{ console.debug('[parentNav stub skip multi-fire]'); }catch{}
          return;
        }
      }
      window._fileParentNavLastTs = nowTs;
      if (window._fileNavParentReady){
        // 既に本体へ差し替わっているはずなので再呼び出し委譲
        try{ return _fileNavParent(); }catch{}
      }
      _fileNavParentPending = true;
      console.debug('[parentNav stub pending init]');
      if (!_fileNavParentWaitTimer){
        _fileNavParentWaitTimer = setInterval(()=>{
          try{
            if (window._fileNavParentReady && typeof _fileNavParent === 'function' && _fileNavParent !== _fileNavParentStub){
              console.debug('[parentNav stub flush via timer]');
              clearInterval(_fileNavParentWaitTimer); _fileNavParentWaitTimer=null;
              _fileNavParent(); // 呼び出し時点では本体へ差し替わっている
            }
          }catch(e){ try{ console.warn('[parentNav stub flush error]', e); }catch{} }
        }, 45);
      }
      // 早期フォールバック: 本体未定義でも popup が表示 & CMD モードなら最低限の親移動を行う
      let domVisible=false; let dataKind=null; let inCmd=(_mode==='CMD');
      try{ domVisible = !!(bufpopup && bufpopup.style && bufpopup.style.display!=='none'); dataKind = bufpopup && bufpopup.dataset ? bufpopup.dataset.kind : null; }catch{}
      if (inCmd && domVisible){
        try{
          console.debug('[parentNav stub fallback attempt]', { inCmd, domVisible, dataKind });
          // #816: 直近 <140ms のみ二重発火抑止し、それ以外は再度親へ上がれるようにする
          const nowFb = Date.now();
          const lastFb = (typeof window._fileNavParentDidFallbackTs==='number') ? window._fileNavParentDidFallbackTs : 0;
          if (lastFb && (nowFb - lastFb) < 140){
            console.debug('[parentNav stub fallback skip recent]', { sinceLast: nowFb - lastFb });
            return;
          }
          window._fileNavParentDidFallbackTs = nowFb;
          if (typeof window._fileNavParentFallbackCount!=='number') window._fileNavParentFallbackCount = 0;
          window._fileNavParentFallbackCount++;
          // _fileBaseURL が未設定なら currentBuffer から
          if (!_fileBaseURL){ try{ const cur=currentBuffer&&currentBuffer(); if (cur && cur.path){ _fileBaseURL=_dirnameURL(cur.path); } }catch{} }
          let baseDir = null;
          try{ baseDir = _fileBaseURL ? _ensureSlash(_fileBaseURL) : null; }catch{}
          if (baseDir){
            try{ if (!/\/$/.test(baseDir.pathname||'')) baseDir = _ensureSlash(_dirnameURL(baseDir.toString())); }catch{}
            const fullPath = String(baseDir.pathname||'').replace(/\\/g,'/');
            // WSL distribution root判定: file://wsl.localhost/<dist>/ を最上位として扱い、そこでは停止 (#821)
            let isWSLDistRoot=false; try{ const h=(baseDir&&baseDir.host||'').toLowerCase(); if (h==='wsl.localhost' && /^\/[^\/]+\/$/.test(fullPath)) isWSLDistRoot=true; }catch{}
            const trimmed = fullPath.replace(/\/+$/, '');
            const cutIdx = trimmed.lastIndexOf('/');
            if (isWSLDistRoot){
              try{ toast && toast('WSL ディストリビューションの最上位です',1200); }catch{}
              console.debug('[parentNav stub WSL-dist-root]', { fullPath });
              return;
            }
            // ルート '/' へ上がれるよう cutIdx>=0 を許容（trimmed 空は停止） (#820)
            if (cutIdx>=0 && trimmed){
              const parentPath = trimmed.slice(0, cutIdx+1);
              _fileTypedDirRaw = parentPath.replace(/^\//,'');
              let parent=baseDir; try{ parent=_ensureSlash(new URL('../', baseDir)); }catch{}
              if (parent){
                // 現在ディレクトリ名（直前ディレクトリ）を prevSeg として取得し、初回親移動直後でも選択復元できるようにする (#819)
                let prevSeg='';
                try{ prevSeg = trimmed.slice(cutIdx+1) || ''; }catch{}
                _fileBaseURL = parent;
                // 選択復元ターゲットを設定（一覧取得後に _filePostSelectName 優先適用）
                _filePostSelectName = prevSeg || null;
                // WSL パス表示を補強: //wsl.localhost/ 前置 (#821)
                const _augmentWSL=(raw=>{ try{ const b=_ensureSlash(_fileBaseURL); if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost'){ const body=String(raw||'').replace(/^\/+/, ''); return '//'+b.host+'/' + body; } }catch{} return raw; });
                try{ if (cmdinput){ const disp=_augmentWSL(String(_fileTypedDirRaw||'')); cmdinput.value=':e ' + disp; const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); } }catch{}
                // #817/#819: 親移動直後に直前ディレクトリ名を desiredName として補完（末尾 '/' なし）
                try{ const dispPref = (function(){ try{ const b=_ensureSlash(_fileBaseURL); if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost'){ const body=String(_fileTypedDirRaw||'').replace(/^\/+/, ''); return '//'+b.host+'/' + body; } }catch{} return String(_fileTypedDirRaw||''); })(); _fileAutoPrefillOnNextRender = { base: String(_fileBaseURL), typed: dispPref, desiredName: prevSeg }; }catch{}
                // 可能ならディレクトリ一覧を遅延取得
                try{
                  const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
                  if (typeof _listDirEntriesWithQuickRetry==='function'){
                    // 計測開始（スタブフォールバック経路での永続 "(loading...)" ハング対策 #825）
                    try{ window._fileLastListStartTs = Date.now(); }catch{}
                    _fileLoading = true;
                    _listDirEntriesWithQuickRetry(_fileBaseURL).then(list=>{
                      try{ const curKey=_ensureSlash(_fileBaseURL)?.toString()||null; if (!reqKey || curKey===reqKey){ _fileEntries=Array.isArray(list)? list: []; if (_filePopupVisible && _filePopupVisible()) _filePopupRender&&_filePopupRender(); console.debug('[parentNav stub fallback done]', { entries:_fileEntries.length }); } }catch{}
                    }).finally(()=>{ _fileLoading=false; try{ if (_filePopupVisible && _filePopupVisible()) _filePopupRender&&_filePopupRender(); }catch{} });
                  } else {
                    console.debug('[parentNav stub fallback pending listFn]');
                  }
                }catch{}
                try{ console.debug('[parentNav stub fallback done]', { entries:_fileEntries.length, fbCount: window._fileNavParentFallbackCount, base: String(_fileBaseURL||'') }); }catch{}
              }
            }
          }
        }catch(e){ try{ console.warn('[parentNav stub fallback error]', e); }catch{} }
      }
    }catch{}
  };
  try{ window._fileNavParentRef = _fileNavParent; }catch{}
  // グローバル親ナビキー捕捉 (初回popup前でも必ず raw ログ出力) (#F1-init)
  try{
    const _parentNavGlobalKey = (e)=>{
      try{
        if (!(e && typeof e.key==='string')) return;
        const isParentKey = (e.key==='F1') || (e.altKey && (e.key==='u' || e.key==='U' || e.code==='KeyU'));
        if (!isParentKey) return;
        // 常に raw を Console 出力（他リスナー奪取判定用）
        try{ console.debug('[parentNav global-raw]', { key:e.key, alt:e.altKey, ctrl:e.ctrlKey, shift:e.shiftKey, meta:e.metaKey, mode:_mode }); }catch{}
        // 可視判定: 初回 popup の dataset.kind ズレを許容 (bufpopup が表示されていれば進む)
        let domVisible=false; let isFilePopup=false; let dataKind=null;
        try{ domVisible = !!(bufpopup && bufpopup.style && bufpopup.style.display!=='none'); dataKind = bufpopup && bufpopup.dataset ? bufpopup.dataset.kind : null; isFilePopup = (dataKind==='file'); }catch{}
        const allow = (_mode==='CMD') && domVisible; // dataset.kind が 'file' でなくても DOM が表示なら許可
        if (!allow){ try{ console.debug('[parentNav global-skip]', { mode:_mode, domVisible, dataKind }); }catch{} return; }
        // 既存の earlyParentKey とは別経路。ガードは共有 (window._fileParentNavGuardUntil)。
        const now = Date.now();
        if (typeof window._fileParentNavGuardUntil!=='number') window._fileParentNavGuardUntil = 0;
        const guarded = (now < window._fileParentNavGuardUntil);
        if (guarded){ try{ console.debug('[parentNav global-guarded]', { key:e.key }); }catch{} return; }
        window._fileParentNavGuardUntil = now + 160;
        e.preventDefault(); e.stopPropagation();
        try{ console.debug('[parentNav global-trigger]', { key:e.key }); }catch{}
        // 呼び出しパスを詳細ログ (direct/ref/defer/absent)
        try{
          const haveDirect = (typeof _fileNavParent === 'function');
          const haveRef = (typeof window._fileNavParentRef === 'function');
          console.debug('[parentNav global-call-path]', { haveDirect, haveRef });
          if (haveDirect){ console.debug('[parentNav global-call direct]'); _fileNavParent(); }
          else if (haveRef){ console.debug('[parentNav global-call ref]'); window._fileNavParentRef(); }
          else {
            console.debug('[parentNav global-call defer]');
            setTimeout(()=>{ try{ const h1=(typeof _fileNavParent==='function'); const h2=(typeof window._fileNavParentRef==='function'); console.debug('[parentNav global-deferred-check]', { h1, h2 }); if (h1){ _fileNavParent(); } else if (h2){ window._fileNavParentRef(); } else { console.debug('[parentNav global-deferred-absent]'); } }catch{} }, 40);
          }
        }catch(e2){ try{ console.warn('[parentNav global-trigger error]', e2); }catch{} }
      }catch{ try{ console.warn('[parentNav global-exc]'); }catch{} }
    };
    // capture で最優先、bubble でも予備
    // 二重発火再発 (#810) を防ぐため旧グローバルハンドラは登録を無効化
    if(false){
      window.addEventListener('keydown', _parentNavGlobalKey, true);
      window.addEventListener('keydown', _parentNavGlobalKey, false);
    }
  }catch{}
  // suppress pushing an extra undo snapshot on the next INSERT mode entry
  let _suppressInsertSnapshotOnce = false;
  // global key routing guard (to avoid recursion when synthesizing events)
  let _globalKeyRouting = false;
  // encoding options (limited set)
  const _allowedEncodeSets = [
    { enc:'utf-8', ff:'unix', bom:false },
    { enc:'utf-8', ff:'unix', bom:true  },
    { enc:'utf-8', ff:'dos',  bom:false },
    { enc:'utf-8', ff:'dos',  bom:true  },
    { enc:'shift_jis', ff:'dos',  bom:false },
    { enc:'shift_jis', ff:'unix', bom:false }
  ];
  function _encDisplayLines(meta){
    const eRaw = (meta&&meta.enc)||'utf-8';
    const ffRaw = (meta&&meta.ff)||'unix';
    const bom = !!(meta&&meta.bom);
    const enc = (String(eRaw).toLowerCase()==='utf-8') ? 'UTF-8'
               : (String(eRaw).toLowerCase()==='shift_jis') ? 'SJIS'
               : String(eRaw);
    const ff = (ffRaw==='dos' ? 'CRLF' : ffRaw==='unix' ? 'LF' : String(ffRaw||''));
    const line1 = enc + ' ' + ff;
    const line2 = bom ? 'B' : '';
    return { line1, line2 };
  }
  function _updateEncBtnLabel(){
    try{
      if (!encBtn || !encBtn.isConnected) return;
      const b=currentBuffer();
      const meta = b ? { enc:b.enc||'utf-8', ff:b.ff||'unix', bom:!!b.bom } : { enc:'utf-8', ff:'unix', bom:false };
      const d = _encDisplayLines(meta);
      const text = d.line2 ? (d.line1 + '\n' + d.line2) : d.line1;
      encBtn.textContent = text;
    }catch{}
  }
  // ---- Encoding popup helpers ----
  let _encSel = 0;
  function _encMetaEquals(a, b){
    return !!a && !!b && (String(a.enc||'utf-8')===String(b.enc||'utf-8')) && (String(a.ff||'unix')===String(b.ff||'unix')) && (!!a.bom === !!b.bom);
  }
  function _encCurrentMeta(){
    try{ const b=currentBuffer(); return b? { enc:b.enc||'utf-8', ff:b.ff||'unix', bom:!!b.bom } : { enc:'utf-8', ff:'unix', bom:false }; }catch{ return { enc:'utf-8', ff:'unix', bom:false }; }
  }
  function _encFindIndex(meta){
    try{
      const m = meta||_encCurrentMeta();
      const idx = _allowedEncodeSets.findIndex(x=>_encMetaEquals(x, m));
      return (idx>=0?idx:0)|0;
    }catch{ return 0; }
  }
  function _encPopupVisible(){
    try{ const pop = document.getElementById('encpopup'); return !!(pop && pop.style.display !== 'none'); }catch{ return false; }
  }
  function _encPopupHide(){ try{ const pop=document.getElementById('encpopup'); if (pop) pop.style.display='none'; }catch{} }
  function _encPopupRender(){
    try{
      const pop = document.getElementById('encpopup'); if (!pop) return;
      pop.innerHTML='';
      const inner = document.createElement('div'); inner.className='inner'; inner.style.maxHeight='45vh'; inner.style.overflow='auto'; pop.appendChild(inner);
      const cur=_encCurrentMeta();
      if (!Number.isFinite(_encSel)){ _encSel=_encFindIndex(cur); } else { const n=_allowedEncodeSets.length|0; _encSel=Math.max(0, Math.min(n>0?n-1:0, _encSel|0)); }
      _allowedEncodeSets.forEach((meta,i)=>{
        const item=document.createElement('div'); item.className='item'; if (i===_encSel) item.classList.add('active');
        item.style.display='flex'; item.style.gap='8px'; item.style.alignItems='center'; item.style.padding='6px 10px'; item.style.cursor='default';
        const mark=document.createElement('span'); mark.textContent=(i===_encSel)?'●':'○'; mark.style.width='1.2em'; mark.style.textAlign='center'; mark.style.opacity='0.7';
        const name=document.createElement('span'); name.className='name'; name.textContent=_encDisplayLines(meta).line1||''; name.style.whiteSpace='pre';
        item.appendChild(mark); item.appendChild(name);
        item.addEventListener('mousedown', ev=>{ try{ ev.preventDefault(); }catch{} });
        item.addEventListener('mouseenter', ()=>{ try{ _encSel=i; _encPopupRender(); }catch{} });
        item.addEventListener('click', ()=>{ try{ _encSel=i; _applyEncodeMeta(meta); _encPopupHide(); setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} },0); }catch{} });
        inner.appendChild(item);
      });
    }catch{}
  }
  function _encPopupShow(anchor){
    try{
      let pop=document.getElementById('encpopup');
      if (!pop){
        pop=document.createElement('div');
        pop.id='encpopup';
        pop.style.position='fixed';
        pop.style.maxHeight='45vh';
        pop.style.background='#0f1117';
        pop.style.color='#e6e6e6';
        pop.style.border='1px solid #2a3244';
        pop.style.boxShadow='0 10px 24px rgba(0,0,0,0.4)';
        pop.style.zIndex='50';
        pop.style.fontSize='13px';
        pop.style.lineHeight='1.35';
        pop.style.display='none';
        document.body.appendChild(pop);
      }
      pop.style.display='';
      if (!Number.isFinite(_encSel)){ try{ _encSel=_encFindIndex(_encCurrentMeta()); }catch{ _encSel=0; } }
      _encPopupRender();
      const anchorEl=(anchor && anchor.getBoundingClientRect)? anchor : null;
      if (anchorEl){
        const r=anchorEl.getBoundingClientRect();
        const vw=window.innerWidth||0, vh=window.innerHeight||0;
        const pw=pop.offsetWidth||240, ph=pop.offsetHeight||200;
        let left=Math.max(8, Math.min(vw-pw-8, Math.round(r.right - pw)));
        let top=Math.max(8, Math.min(vh-ph-8, Math.round(r.bottom + 6)));
        pop.style.left=left+'px';
        pop.style.top=top+'px';
      }
    }catch{}
  }
  function _encPopupMoveSel(dir){
    try{ const n=_allowedEncodeSets.length|0; if (!n) return; _encSel = ( (_encSel|0) + (dir>0?1:-1) + n ) % n; _encPopupRender(); }catch{}
  }
  function _applyEncodeMeta(meta){
    try{
      if (!meta) return;
      const b = currentBuffer(); if (!b) return;
      const before = { enc:b.enc||'utf-8', ff:b.ff||'unix', bom:!!b.bom };
      if (_encMetaEquals(before, meta)) return;
      // one undo unit (metadata only)
      _pushUndoSnapshot('enc-change');
      b.enc = String(meta.enc||'utf-8');
      b.ff  = String(meta.ff||'unix');
      b.bom = !!meta.bom;
      // mark modified due to metadata change (without touching text)
      try{ b._changeTick = ((b._changeTick|0) + 1)|0; b.modified = ((b._changeTick|0) !== (b._savedTick|0)); }catch{}
      _updateEncBtnLabel();
      try{ _updateOverlayEncodeVisual(); }catch{}
      try{ _setTitle && _setTitle(); _renderTabbar && _renderTabbar(); }catch{}
      try{ _renderListChars && _renderListChars(); }catch{}
      try{ toast('encode set: ' + ((_encDisplayLines(meta).line2)? (_encDisplayLines(meta).line1+' bomb') : _encDisplayLines(meta).line1), 900); }catch{}
    }catch{}
  }

  // ---- Case (ignorecase/smartcase) popup helpers ----
  let _caseSel = 0; // 0: always(noignorecase), 1: smart(ignorecase+smartcase), 2: insens(ignorecase+nosmartcase)
  function _casePopupVisible(){ try{ const pop=document.getElementById('casepopup'); return !!(pop && pop.style.display!=='none'); }catch{ return false; } }
  function _casePopupHide(){ try{ const pop=document.getElementById('casepopup'); if (pop) pop.style.display='none'; }catch{} }
  function _caseCurrentIndex(){
    try{
      const b=currentBuffer(); const ic=!!(b&&b.ignorecase); const sc=!!(b&&b.smartcase);
      if (!ic) return 0; // always distinguish
      return sc ? 1 : 2;
    }catch{ return 0; }
  }
  function _applyCaseIndex(idx){
    try{
      const b=currentBuffer(); if (!b) return;
      if (idx===0){ b.ignorecase=false; _schedulePersist('ignorecase'); }
      else if (idx===1){ b.ignorecase=true; b.smartcase=true; _schedulePersist('ignorecase'); _schedulePersist('smartcase'); }
      else { b.ignorecase=true; b.smartcase=false; _schedulePersist('ignorecase'); _schedulePersist('smartcase'); }
      _updateHlsearchFull();
      _updateOverlayCaseVisual();
      toast('検索時 大/小: ' + (idx===0?'常に区別':idx===1?'混在時区別':'同一視'), 900);
    }catch{}
  }
  function _casePopupRender(){
    try{
      const pop = document.getElementById('casepopup'); if (!pop) return;
      pop.innerHTML='';
      const inner = document.createElement('div'); inner.className='inner';
      // match encpopup defaults inline
      inner.style.maxHeight = '45vh';
      inner.style.overflow = 'auto';
      pop.appendChild(inner);
      const items = [ '常に区別', '混在時区別', '同一視' ];
      if (!Number.isFinite(_caseSel)) _caseSel = _caseCurrentIndex();
      _caseSel = Math.max(0, Math.min(items.length-1, _caseSel|0));
      items.forEach((label,i)=>{
        const item = document.createElement('div'); item.className='item'; if (i===_caseSel) item.classList.add('active');
        // inline styles to mirror #encpopup .item
        item.style.display = 'flex';
        item.style.gap = '8px';
        item.style.alignItems = 'center';
        item.style.padding = '6px 10px';
        item.style.cursor = 'default';
        item.style.background = (i===_caseSel) ? 'var(--popupActiveLine, #1a2030)' : 'transparent';
        const mark = document.createElement('span'); mark.textContent=(i===_caseSel)?'●':'○'; mark.style.width='1.2em'; mark.style.textAlign='center'; mark.style.opacity='0.8';
        const name = document.createElement('div'); name.className='name'; name.textContent = label; name.style.whiteSpace='pre';
        item.appendChild(mark); item.appendChild(name);
        item.addEventListener('mousedown', (ev)=>{ try{ ev.preventDefault(); ev.stopPropagation(); }catch{}; _caseSel=i; _applyCaseIndex(i); _casePopupHide(); setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} },0); });
        item.addEventListener('mouseenter', ()=>{ try{ _caseSel=i; _casePopupRender(); }catch{} });
        item.addEventListener('click', (ev)=>{ try{ ev.preventDefault(); ev.stopPropagation(); }catch{}; _caseSel=i; _applyCaseIndex(i); _casePopupHide(); setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} },0); });
        inner.appendChild(item);
      });
    }catch{}
  }
  function _casePopupShow(anchor){
    try{
      let pop = document.getElementById('casepopup');
      if (!pop){
        pop = document.createElement('div');
        pop.id = 'casepopup';
        pop.style.position='fixed';
        pop.style.maxHeight='45vh';
        pop.style.background='#0f1117';
        pop.style.color='#e6e6e6';
        pop.style.border='1px solid #2a3244';
        pop.style.boxShadow='0 10px 24px rgba(0,0,0,0.4)';
        pop.style.zIndex='10000';
        pop.style.borderRadius='6px';
        pop.style.overflow='hidden';
        pop.style.minWidth='240px';
        document.body.appendChild(pop);
      }
      pop.style.display='';
      try{ _caseSel = _caseCurrentIndex(); }catch{ _caseSel = 0; }
      _casePopupRender();
      // Position near anchor (overlay button)
      const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { right:(window.innerWidth||0)-8, bottom:8 };
      const vw = (window.innerWidth||0), vh=(window.innerHeight||0);
      const pw = (pop.offsetWidth||240), ph=(pop.offsetHeight||120);
      let left = Math.max(8, Math.min(vw - pw - 8, Math.round(r.right - pw)));
      let top  = Math.max(8, Math.min(vh - ph - 8, Math.round(r.bottom + 6)));
      pop.style.left = left + 'px';
      pop.style.top  = top + 'px';
    }catch{}
  }
  function _casePopupMoveSel(dir){ try{ const n=3; _caseSel = (((_caseSel|0)+(dir>0?1:-1)) + n) % n; _casePopupRender(); }catch{} }
  // Sticky preview for :s — keep previous match position while pattern grows if it still matches
  let _incPrevEl = null;        // DOM element for incremental preview highlight
  let _incPrevLastStart = null; // last preview start offset
  let _incPrevLastLen = 0;      // last preview length
  let _incPrevStickyOff = null; // number|null
  let _incPrevStickySrc = '';
  let _incPrevExtra = [];       // additional DOM elements for multi-line preview
  function _incPrevHide(){
    try{
      if (_incPrevEl && _incPrevEl.parentNode){ _incPrevEl.parentNode.removeChild(_incPrevEl); }
    }catch{}
    _incPrevEl=null;
    try{ _incPrevExtra.forEach(el=>{ try{ if (el && el.parentNode){ el.parentNode.removeChild(el); } }catch{} }); }catch{}
    _incPrevExtra=[];
    _incPrevLastStart=null; _incPrevLastLen=0;
  }
  function _incPrevRefresh(){
    if (_incPrevEl && _incPrevLastStart!=null){
      _incPrevShowAt(_incPrevLastStart, _incPrevLastLen);
    }
  }
  function _incPrevShowAt(startOff, len){
    try{
      if (!(Number.isFinite(startOff) && startOff>=0)) { _incPrevHide(); return; }
      const nlen = Math.max(0, len|0);
      _incPrevLastStart = (startOff|0);
      _incPrevLastLen = nlen;
      // compute row/col from absolute offset
      const rc = _rcFromOffset(startOff|0);
      const r = rc.r|0, c = rc.c|0;
      const lines = _splitLines();
      const line = String(lines[r]||'');
      const fullText = String(editor.value||'');
      const seg = fullText.slice(startOff, startOff + nlen);
      const hasNL = /\n/.test(seg);
      if (hasNL){
        // Multi-line highlight: clear existing single-line element
        try{ if (_incPrevEl && _incPrevEl.parentNode){ _incPrevEl.parentNode.removeChild(_incPrevEl); } }catch{}
        _incPrevEl=null;
        // Remove extras first
        try{ _incPrevExtra.forEach(el=>{ try{ if (el && el.parentNode){ el.parentNode.removeChild(el); } }catch{} }); }catch{}
        _incPrevExtra=[];
        const parts = seg.split('\n');
        const topLine = _topLine();
        let curRow = r;
        // First line offset/col: c
        for (let i=0;i<parts.length;i++){
          const part = parts[i];
          const row = r + i;
          const isFirst = (i===0);
          const startCol = isFirst ? c : 0;
          // measure x positions within this row
          const rowLine = String(lines[row]||'');
          _measureSpan.textContent = rowLine.slice(0, startCol);
          const x1 = _measureSpan.getBoundingClientRect().width;
          _measureSpan.textContent = rowLine.slice(0, startCol + part.length);
          const x2 = _measureSpan.getBoundingClientRect().width;
          const row1 = row + 1;
          const offsetLines = row1 - topLine;
          const topPx = offsetLines * LINE_HEIGHT;
          // create element
          const el = document.createElement('div');
          el.className = 'incprev';
          let _hs = 0; try{ _hs = (editor.scrollLeft||0); }catch{}
          el.style.left = (x1 - _hs) + 'px';
          el.style.top = topPx + 'px';
          el.style.width = Math.max(1, Math.round(x2 - x1)) + 'px';
          el.style.height = Math.max(1, Math.round(LINE_HEIGHT)) + 'px';
          try{ caretLayer.appendChild(el); }catch{}
          _incPrevExtra.push(el);
        }
        return;
      }
      // limit to single line box for preview; clamp highlight width within this line
      const endCol = Math.min(line.length, c + nlen);
      // measure x positions
      _measureSpan.textContent = line.slice(0, c);
      const x1 = _measureSpan.getBoundingClientRect().width;
      _measureSpan.textContent = line.slice(0, endCol);
      let x2 = _measureSpan.getBoundingClientRect().width;
      if (!(x2 > x1)){
        // zero-length or unmeasurable width → hide preview (caret移動のみ)
        _incPrevHide();
        return;
      }
      // compute top (relative to current viewport top line)
      const row1 = r + 1;
      const topLine = _topLine();
      const offsetLines = row1 - topLine;
      const topPx = offsetLines * LINE_HEIGHT;
      if (topPx < -LINE_HEIGHT || topPx > (viewport.clientHeight + LINE_HEIGHT)){
        // offscreen; still show after ensureScrolloff/_repositionCaret re-runs
      }
      // ensure element
      if (!_incPrevEl){ _incPrevEl = document.createElement('div'); _incPrevEl.className = 'incprev'; }
      // attach to caretLayer (follows transform remainder compensation)
      if (_incPrevEl.parentNode !== caretLayer){ try{ caretLayer.appendChild(_incPrevEl); }catch{} }
  // position and size (adjust by horizontal scroll)
  let _hs = 0; try{ _hs = (editor.scrollLeft||0); }catch{}
  _incPrevEl.style.left = (x1 - _hs) + 'px';
      _incPrevEl.style.top = topPx + 'px';
      _incPrevEl.style.width = Math.max(1, Math.round(x2 - x1)) + 'px';
      _incPrevEl.style.height = Math.max(1, Math.round(LINE_HEIGHT)) + 'px';
    }catch{ _incPrevHide(); }
  }
  function _incPrevUpdateForCmdValue(v){
    try{
      const s = String(v||'');
      // Accept "/pat" or "?pat" with optional trailing "/i" or "?i" for flags during typing
      // Examples: "/foo", "/foo/i", "?bar", "?bar?i" (case-insensitive)
      const mF = s.match(/^\s*:?\s*\/(.*?)(?:\/(?:([A-Za-z]*))?)?\s*$/);
      const mB = (!mF) ? s.match(/^\s*:?\s*\?(.*?)(?:\?(?:([A-Za-z]*))?)?\s*$/) : null;
  // Also accept :s, %:s, and :'<'','>'s incremental preview on the search part (before replacement)
  const mS = (!mF && !mB) ? s.match(/^\s*:?(?:('<,'>))?(%?)\s*s\/(.*?)(?:\/|$)/i) : null;
      if (!mF && !mB && !mS){ _incPrevHide(); return false; }
      const dir = mF ? 'fwd' : (mB ? 'bwd' : 'fwd');
      const forward = !!mF;
      // Determine pattern text from /, ?, or :s
      let pat = '';
      if (forward){ pat = String(mF[1]||''); }
      else if (mB){ pat = String(mB[1]||''); }
      else if (mS){ pat = String(mS[3]||''); }
        // ユーザ入力の \n / \t を実際の改行・TABへ展開（直前がさらにバックスラッシュの場合はリテラル保持） (#692)
        try{
          pat = pat.replace(/(?<!\\)\\n/g,'\n').replace(/(?<!\\)\\t/g,'\t');
        }catch{ /* lookbehind 非対応環境では単純置換（副作用で \\n が展開される場合あり） */ try{ pat = pat.replace(/\\n/g,'\n').replace(/\\t/g,'\t'); }catch{} }
      const flagsGiven = String((mF?mF[2]:(mB?mB[2]:''))||'');
      // Case sensitivity (preview): honor /i or /I; else buffer ignorecase(+smartcase)
      let needI = false;
      if (/i/.test(flagsGiven)){ needI = true; }
      else if (/I/.test(flagsGiven)){ needI = false; }
      else {
        try{
          const b=currentBuffer();
          const ic=!!(b&&b.ignorecase); const sc=!!(b&&b.smartcase);
          if (ic){ if (sc && /[A-Z]/.test(pat)){ needI=false; } else { needI=true; } }
        }catch{}
      }
      const flags = needI ? 'i' : '';
  // Always enable multiline so ^/$ match per-line by default
  const flagsRe = ('m' + (flags.includes('i')?'i':''));
      // For :s incremental preview: capture a stable anchor once at first pattern detection
      if (mS && !(_incSearchAnchorOff>=0)){
        try{ _incSearchAnchorOff = _offsetFromRC(caretRow, caretCol)|0; }catch{ _incSearchAnchorOff=null; }
      }
      // Do nothing on empty pattern
      if (!pat){ _incPrevHide(); return true; }
      // Try compile regex quickly; invalid → hide
  let reOk = true; try{ new RegExp(pat, flagsRe); }catch{ reOk=false; }
      if (!reOk){ _incPrevHide(); return true; }
      // Determine search scope and anchor
      let selStart=null, selEnd=null, limitToVisual=false;
      const hasVisToken = !!(mS && mS[1]==="'<,'>");
      if (hasVisToken && _visCmdActive){
        limitToVisual = true;
        try{
          if (_visCmdLinewise){
            const rs = Math.min(_visCmdAnchorR|0, _visCmdCaretR|0);
            const re = Math.max(_visCmdAnchorR|0, _visCmdCaretR|0);
            selStart = _offsetFromRC(rs, 0)|0;
            const linesAll = _splitLines();
            const lastLen = String(linesAll[re]||'').length;
            selEnd = _offsetFromRC(re, lastLen)|0;
          } else {
            const sOff = _offsetFromRC(_visCmdAnchorR|0, _visCmdAnchorC|0)|0;
            const eOff = _offsetFromRC(_visCmdCaretR|0, _visCmdCaretC|0)|0;
            selStart = Math.min(sOff, eOff)|0;
            selEnd = Math.max(sOff, eOff)|0;
          }
        }catch{ selStart=null; selEnd=null; limitToVisual=false; }
      }
      // Use stable anchor captured when entering CMD; clamp to selection when needed
      const fromOff = (function(){
        try{
          let base = (typeof _incSearchAnchorOff === 'number' && _incSearchAnchorOff>=0) ? _incSearchAnchorOff : (_offsetFromRC(caretRow, caretCol)|0);
          if (limitToVisual && selStart!=null && selEnd!=null){ base = Math.max(selStart, Math.min(base, selEnd)); }
          return base|0;
        }catch{ return 0; }
      })();
      // Prefer sticky position for :s (and :%s) if the previous match still
      // satisfies the refined pattern. Use an anchored check at the exact
      // previous start offset to avoid hopping to later candidates while typing.
      let res = null;
      if (mS && _incPrevStickyOff!=null){
        try{
          const text = String(editor.value||'');
          const off = (_incPrevStickyOff|0);
          if (off >= 0 && off <= text.length){
            const tail = text.slice(off);
            // Anchor the pattern at beginning of the tail to ensure we only
            // accept a match that starts at the same offset as before.
            const reStick = new RegExp('^(?:' + pat + ')', flagsRe);
            const mm = reStick.exec(tail);
            if (mm){
              const l = ((mm[0]||'').length|0);
              if (l > 0){
                // Respect visual selection limits
                if (!limitToVisual || (off>=selStart && (off+l)<=selEnd)){
                  res = { start: off, len: l };
                }
              }
            }
          }
        }catch{}
      }
      if (!res){
        if (!limitToVisual){
          // Incremental previewは現在位置も含めて判定する（/# で行頭を即ヒットさせる）(#691)
          // fromOff-1（fwd）/ fromOff+1（bwd）をそのまま渡し、検索側で適切に扱う
          const incFrom = (dir==='fwd') ? (fromOff-1) : (fromOff+1);
          res = _searchFindNext(pat, flags, dir, incFrom, true);
        } else {
          // Manual scan within [selStart, selEnd)
          try{
            const text = String(editor.value||'');
            const sub = text.slice(selStart, selEnd);
            const re = new RegExp(pat, flagsRe);
            const m = re.exec(sub);
            if (m && m[0]){ res = { start: selStart + (m.index|0), len: (m[0]||'').length|0 }; }
          }catch{}
        }
      }
      if (res && Number.isFinite(res.start)){
        // move caret to match start (live preview behavior)
        try{ const rc = _rcFromOffset(res.start); caretRow = rc.r; caretCol = rc.c; ensureScrolloff(); _repositionCaret(); updateGutter(); }catch{}
        // show preview highlight at current line (single-line only)
        _incPrevShowAt(res.start, res.len);
        // update sticky state for :s
        if (mS){ _incPrevStickyOff = res.start|0; _incPrevStickySrc = String(pat||''); }
      } else {
        _incPrevHide();
        if (mS){ _incPrevStickyOff = null; _incPrevStickySrc=''; }
      }
      return true;
    }catch{ _incPrevHide(); return false; }
  }

  // --- hlsearch (highlight all matches) ---
  let _optHlsearch = (function(){ try{ const o=(window&&window.SIX_OPTIONS)||{}; return !!o.hlsearch; }catch{} return false; })();          // :set hlsearch / :set nohlsearch
  let _optList = (function(){ try{ const o=(window&&window.SIX_OPTIONS)||{}; return (o.list!==false); }catch{} return true; })(); // :set list (default ON)
  let _hlLayer = null;               // container for match rectangles
  // #624 直前テキスト保持 (INSERT beforeinput/delete 用)
  let _prevTextBeforeInput = '';
  // --- Visual Bell ---
  let _optVisualBell = (function(){ try{ const o=(window&&window.SIX_OPTIONS)||{}; return (o.visualbell!==false); }catch{} return true; })(); // :set visualbell (default ON)
  // --- Debug key logging (ring buffer) ---
  // :set debugkeys / :set nodebugkeys / :set debugkeys! / :set debugkeys?
  let _optDebugKeys = false;
  const _debugKeyRing = [];
  const _DEBUG_KEY_MAX = 300;
  function _debugPush(ev){ try{ if(!_optDebugKeys) return; _debugKeyRing.push(ev); if(_debugKeyRing.length>_DEBUG_KEY_MAX){ _debugKeyRing.splice(0,_debugKeyRing.length-_DEBUG_KEY_MAX); } }catch{} }
  function _debugDumpString(){
    try{
      return _debugKeyRing.map((e,i)=>{
        return i.toString().padStart(3,'0')+' '+new Date(e.t).toISOString()+` ${e.type}`+
          ` m=${e.mode}`+
          (e.key!==undefined?` key=${JSON.stringify(e.key)}`:'')+
          (e.code?` code=${e.code}`:'')+
          (e.inputType?` inputType=${e.inputType}`:'')+
          (e.data!==undefined?` data=${JSON.stringify(e.data)}`:'')+
          (e.compData!==undefined?` comp=${JSON.stringify(e.compData)}`:'')+
          ` ctrl=${e.ctrl?'1':'0'} alt=${e.alt?'1':'0'} meta=${e.meta?'1':'0'} isComp=${e.isComp?'1':'0'}`;
      }).join('\n');
    }catch{ return ''; }
  }
  let _vbLayer = null;               // full-viewport black flash overlay
  // --- Anomaly heuristics (diagnose NORMAL+IME ON acting like constant 'l') ---
  let _anomActive = false;           // between start/end markers
  let _anomColsMismatchRun = 0;      // consecutive times j/k led to cols motion
  function _anomalyMaybeStart(reason){
    try{
      if (_anomActive) return;
      _anomActive = true;
      _anomColsMismatchRun = 0;
      _debugPush({ t:Date.now(), type:'anomaly-start', mode:_mode, reason, lastKey:_lastKeydownForAnom });
    }catch{}
  }
  function _anomalyMaybeEnd(reason){
    try{
      if (!_anomActive) return;
      _anomActive = false;
      _debugPush({ t:Date.now(), type:'anomaly-end', mode:_mode, reason });
    }catch{}
  }
  function _anomalyMaybeCols(delta){
    try{
      // Heuristic: if last keydown looked like vertical (j/k/ArrowUp/Down) but we executed cols move, count it.
      const k = (_lastKeydownForAnom||{}).key;
      const c = (_lastKeydownForAnom||{}).code;
      const isVertIntent = (k==='j' || k==='k' || k==='ArrowUp' || k==='ArrowDown' || (k==='Process' && (c==='KeyJ' || c==='KeyK')));
      const isCols = (delta!==0);
      if (isVertIntent && isCols){
        _anomColsMismatchRun++;
        _debugPush({ t:Date.now(), type:'anomaly-note', mode:_mode, note:'vert-intent->cols', count:_anomColsMismatchRun, lastKey:_lastKeydownForAnom });
        if (_anomColsMismatchRun>=2){ _anomalyMaybeStart('vert->cols'); }
        return;
      }
      // If we had a mismatch run but got a horizontal intent, end it when we see a legit lines move elsewhere.
      if (_anomColsMismatchRun>0 && (k==='h' || k==='l' || k==='ArrowLeft' || k==='ArrowRight' || (k==='Process' && (c==='KeyH'||c==='KeyL')))){
        _anomColsMismatchRun = 0;
        _anomalyMaybeEnd('horizontal-intent');
        return;
      }
      // default: no-op
    }catch{}
  }
  // --- Raw key logging (capture phase, pre-routing) ---
  // :set rawkeys / :set norawkeys / :set rawkeys! / :set rawkeys? / :dumprawkeys / :clearrawkeys
  let _optRawKeys = false;
  const _rawKeyRing = [];
  const _RAW_KEY_MAX = 400;
  function _rawPush(ev){ try{ if(!_optRawKeys) return; _rawKeyRing.push(ev); if(_rawKeyRing.length>_RAW_KEY_MAX){ _rawKeyRing.splice(0,_rawKeyRing.length-_RAW_KEY_MAX); } }catch{} }
  function _rawDump(arr){
    try{
      return arr.map((e,i)=>{
        return i.toString().padStart(3,'0')+' '+new Date(e.t).toISOString()+` ${e.type}`+
          ` key=${JSON.stringify(e.key)}`+
          (e.code?` code=${e.code}`:'')+
          (e.repeat?` repeat=${e.repeat?'1':'0'}`:'')+
          (e.trusted?` trusted=${e.trusted?'1':'0'}`:'')+
          ` ctrl=${e.ctrl?'1':'0'} alt=${e.alt?'1':'0'} meta=${e.meta?'1':'0'}`;
      }).join('\n');
    }catch{ return ''; }
  }
  // Capture raw keydown/keyup before any other listeners (once only)
  // Also retain last keydown for anomaly heuristics.
  let _lastKeydownForAnom = null; // {key, code, t}
  try{
    window.addEventListener('keydown', (e)=>{
      const now = Date.now();
      _rawPush({ t:now, type:'raw-keydown', key:e.key, code:e.code, repeat:!!e.repeat, trusted:!!e.isTrusted, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey });
      try{ _lastKeydownForAnom = { key:e.key, code:e.code, t:now }; }catch{}
    }, true);
    window.addEventListener('keyup', (e)=>{
      _rawPush({ t:Date.now(), type:'raw-keyup', key:e.key, code:e.code, repeat:!!e.repeat, trusted:!!e.isTrusted, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey });
    }, true);
  }catch{}
  function _vbEnsureLayer(){
    try{
      if (!_vbLayer){
        const d = document.createElement('div');
        d.id = 'vbflash';
        d.style.display = 'none';
        _vbLayer = d;
      }
      if (_vbLayer.parentNode !== editorViewport){ try{ editorViewport.appendChild(_vbLayer); }catch{} }
    }catch{}
  }
  function _triggerVisualBell(){
    try{
      if (!_optVisualBell) return;
      // popup専用ベル (#573): :e ファイルポップアップ表示中はポップアップ内だけフラッシュ
      if (typeof _filePopupVisible==='function' && _filePopupVisible() && bufpopup){
        try{
          let flash = bufpopup.querySelector('.popup-flash');
          if (!flash){
            flash = document.createElement('div');
            flash.className = 'popup-flash';
            flash.style.position='absolute';
            flash.style.inset='0 0 0 0';
            flash.style.pointerEvents='none';
            flash.style.background='rgba(255,80,80,0.35)';
            flash.style.border='2px solid rgba(255,120,120,0.8)';
            flash.style.boxSizing='border-box';
            flash.style.transition='opacity 120ms ease';
            flash.style.opacity='0';
            bufpopup.appendChild(flash);
          }
          // restart animation
          flash.style.opacity='1';
          setTimeout(()=>{ try{ flash.style.opacity='0'; }catch{} }, 60);
          // 自動消去（念のため）
          setTimeout(()=>{ try{ if (flash && flash.style.opacity==='0'){ /* keep node for reuse */ } }catch{} }, 400);
          return; // グローバルベルは使わない
        }catch{}
      }
      // 通常の全体ベル
      _vbEnsureLayer();
      _vbLayer.style.display = 'block';
      _vbLayer.style.opacity = '1';
      setTimeout(()=>{
        try{ _vbLayer.style.opacity = '0'; }catch{}
        setTimeout(()=>{ try{ _vbLayer.style.display = 'none'; }catch{} }, 60);
      }, 40);
    }catch{}
  }
  // STRICT NORMAL IME option: when enabled, ignore letter-based motions while IME composition is active
  // Users hit an anomaly where NORMAL+IME ON sometimes behaves like constant 'l'; this provides a safe mode.
  let _optStrictNormalIME = false; // :set strictnormalime / :set nostrictnormalime
  let _hlMatches = null;             // cached [{start,len}] for _lastSearch over current text
  let _lastSearch = null;            // { src, flags, dir, origDir } last confirmed search; dir may record last movement, origDir is immutable base

  // --- VISUAL selection overlay during CMD (keep highlight visible) ---
  let _visSelLayer = null;           // container for visual selection rectangles when _visCmdActive
  function _visSelEnsureLayer(){
    if (!_visSelLayer){
      const d = document.createElement('div');
      d.style.position = 'absolute';
      d.style.inset = '0 0 0 0';
      d.style.pointerEvents = 'none';
      _visSelLayer = d;
    }
    if (_visSelLayer.parentNode !== caretLayer){ try{ caretLayer.appendChild(_visSelLayer); }catch{} }
  }
  function _visSelClear(){
    try{
      if (_visSelLayer){ while (_visSelLayer.firstChild){ _visSelLayer.removeChild(_visSelLayer.firstChild); } }
    }catch{}
  }
  function _renderVisSelOverlay(){
    try{
      if (!_visCmdActive){ _visSelClear(); return; }
      _visSelEnsureLayer();
      _visSelClear();
      // Compute absolute selection offsets from the snapshot
      const linewise = !!_visCmdLinewise;
      const aR = _visCmdAnchorR|0, aC = _visCmdAnchorC|0;
      const bR = _visCmdCaretR|0,  bC = _visCmdCaretC|0;
      const rs = Math.min(aR, bR), re = Math.max(aR, bR);
      let selStart = 0, selEnd = 0;
      if (linewise){
        selStart = _offsetFromRC(rs, 0)|0;
        const linesAll = _splitLines();
        const lastLen = String(linesAll[re]||'').length;
        selEnd = _offsetFromRC(re, lastLen)|0;
      } else {
        const sOff = _offsetFromRC(aR, aC)|0;
        const eOff = _offsetFromRC(bR, bC)|0;
        selStart = Math.min(sOff, eOff)|0;
        selEnd = Math.max(sOff, eOff)|0;
      }
      if (!(selEnd>selStart)) return;
      const lines = _splitLines();
      // Iterate rows within selection and draw segments
      for (let r=rs; r<=re; r++){
        const line = String(lines[r]||'');
        let c1 = 0, c2 = line.length;
        if (!linewise){
          if (r === rs){ c1 = (aR<=bR ? (aR===rs ? aC : 0) : (bR===rs ? bC : 0)); }
          if (r === re){ c2 = (aR>=bR ? (aR===re ? aC : line.length) : (bR===re ? bC : line.length)); }
          c1 = Math.max(0, Math.min(line.length, c1|0));
          c2 = Math.max(c1, Math.min(line.length, c2|0));
        }
        // Measure x positions
        _measureSpan.textContent = line.slice(0, c1);
        const x1 = _measureSpan.getBoundingClientRect().width;
        _measureSpan.textContent = line.slice(0, c2);
        const x2 = _measureSpan.getBoundingClientRect().width;
        if (!(x2 > x1)) continue;
        const topLine = _topLine();
        const row1 = r + 1;
        const topPx = (row1 - topLine) * LINE_HEIGHT;
  const el = document.createElement('div');
  // dedicated style for CMD-time visual selection
  el.className = 'viscmdsel';
  // Adjust by horizontal scroll
  let _hs = 0; try{ _hs = (editor.scrollLeft||0); }catch{}
  el.style.left = (x1 - _hs) + 'px';
        el.style.top = topPx + 'px';
        el.style.width = Math.max(1, Math.round(x2 - x1)) + 'px';
        el.style.height = Math.max(1, Math.round(LINE_HEIGHT)) + 'px';
        _visSelLayer.appendChild(el);
      }
    }catch{}
  }

  function _hlEnsureLayer(){
    if (!_hlLayer){
      const d = document.createElement('div');
      d.style.position = 'absolute';
      d.style.inset = '0 0 0 0';
      d.style.pointerEvents = 'none';
      _hlLayer = d;
    }
    if (_hlLayer.parentNode !== caretLayer){ try{ caretLayer.appendChild(_hlLayer); }catch{} }
  }
  function _hlClear(){
    try{
      if (_hlLayer){ while (_hlLayer.firstChild){ _hlLayer.removeChild(_hlLayer.firstChild); } }
      // keep layer; removing/adding causes more layout churn than clearing children
    }catch{}
  }
  function _recomputeHlMatches(){
    try{
      _hlMatches = null;
      if (!_optHlsearch) return;
      if (!(_lastSearch && _lastSearch.src)) return;
  const src = String(_lastSearch.src||'');
  // Determine effective case flag: explicit i/I overrides; else derive from buffer ignorecase+smartcase
  let useI = false;
  if (_lastSearch && _lastSearch.explicitCase === 'i'){ useI = true; }
  else if (_lastSearch && _lastSearch.explicitCase === 'I'){ useI = false; }
  else {
    try{
      const b=currentBuffer(); const ic=!!(b&&b.ignorecase); const sc=!!(b&&b.smartcase);
      if (ic){ if (sc && /[A-Z]/.test(src)){ useI=false; } else { useI=true; } }
    }catch{}
  }
  let flags = useI ? 'i' : '';
  const text = String(editor.value||'');
  // Ensure multiline + global for hlsearch regardless of stored flags
  if (!flags.includes('m')) flags += 'm';
  if (!flags.includes('g')) flags += 'g';
  let re = null; try{ re = new RegExp(src, flags); }catch{ re=null; }
      if (!re) return;
      const out = [];
      let m; re.lastIndex = 0;
      while ((m = re.exec(text))){
        _extLastCheckAt: 0
        const s = (m.index|0);
        const l = ((m[0]||'').length|0);
        if (l > 0) out.push({ start:s, len:l });
        else { re.lastIndex++; }
        // bail-out guard for extreme cases
        if (out.length > 20000) break;
      }
      _hlMatches = out;
    }catch{ _hlMatches = null; }
  }
  function _renderHlMatchesVisible(){
    try{
      if (!_optHlsearch){ _hlClear(); return; }
      if (!(_lastSearch && _lastSearch.src)){ _hlClear(); return; }
      if (!_hlMatches) return; // no matches or not computed yet
      _hlEnsureLayer();
      // visible row range
      const topLine = _topLine();
      const vis = _visibleLinesExact();
      const endLine = topLine + vis - 1;
      // clear previous children
      _hlClear();
      const lines = _splitLines();
      for (const m of _hlMatches){
        const rc = _rcFromOffset(m.start|0);
        const r = rc.r|0, c = rc.c|0;
        const row1 = r + 1;
        if (row1 < topLine || row1 > endLine) continue;
        const line = String(lines[r]||'');
        const endCol = Math.min(line.length, c + (m.len|0));
        // measure x positions
        _measureSpan.textContent = line.slice(0, c);
        const x1 = _measureSpan.getBoundingClientRect().width;
        _measureSpan.textContent = line.slice(0, endCol);
        const x2 = _measureSpan.getBoundingClientRect().width;
        if (!(x2 > x1)) continue;
        const topPx = (row1 - topLine) * LINE_HEIGHT;
        const el = document.createElement('div');
  el.className = 'hlmatch';
  // Adjust by horizontal scroll
  let _hs = 0; try{ _hs = (editor.scrollLeft||0); }catch{}
  el.style.left = (x1 - _hs) + 'px';
        el.style.top = topPx + 'px';
        el.style.width = Math.max(1, Math.round(x2 - x1)) + 'px';
        el.style.height = Math.max(1, Math.round(LINE_HEIGHT)) + 'px';
        _hlLayer.appendChild(el);
      }
    }catch{}
  }
  // ---- Yank flash (ephemeral highlight for yanked text) ----
  let _yankFlashLayer = null;
  let _yankFlashSegs = []; // {r,c1,c2,exp}
  function _yankFlashEnsureLayer(){
    try{
      if (!_yankFlashLayer){
        _yankFlashLayer = document.createElement('div');
        _yankFlashLayer.className = 'yank-flash-layer';
        _yankFlashLayer.style.position='absolute';
        _yankFlashLayer.style.left='0'; _yankFlashLayer.style.top='0'; _yankFlashLayer.style.right='0'; _yankFlashLayer.style.bottom='0';
        _yankFlashLayer.style.pointerEvents='none';
        _yankFlashLayer.style.zIndex='1'; // below caret
      }
      if (_yankFlashLayer.parentNode !== caretLayer){ caretLayer.appendChild(_yankFlashLayer); }
    }catch{}
  }
  function _yankFlashClear(){ try{ if(_yankFlashLayer){ while(_yankFlashLayer.firstChild){ _yankFlashLayer.removeChild(_yankFlashLayer.firstChild); } } }catch{} }
  function _renderYankFlash(){
    try{
      if (!_yankFlashSegs || _yankFlashSegs.length===0){ _yankFlashClear(); return; }
      const now = Date.now();
      // filter expired
      _yankFlashSegs = _yankFlashSegs.filter(s=> s && s.exp>now);
      if (_yankFlashSegs.length===0){ _yankFlashClear(); return; }
      _yankFlashEnsureLayer(); _yankFlashClear();
      const topLine = _topLine();
      const vis = _visibleLinesExact();
      const endLine = topLine + vis - 1;
      const lines = _splitLines();
      let _hs = 0; try{ _hs = (editor.scrollLeft||0); }catch{}
      let col = 'yellow'; try{ if (window && window.THEME && window.THEME.yankFlashColor){ col = String(window.THEME.yankFlashColor||'yellow'); } }catch{}
      for (const seg of _yankFlashSegs){
        const row1 = (seg.r|0) + 1;
        if (row1 < topLine || row1 > endLine) continue;
        const line = String(lines[seg.r]||'');
        const c1 = Math.max(0, Math.min(line.length, seg.c1|0));
        const c2 = Math.max(c1, Math.min(line.length, seg.c2|0));
        if (c2<=c1) continue;
        _measureSpan.textContent = line.slice(0, c1);
        const x1 = _measureSpan.getBoundingClientRect().width;
        _measureSpan.textContent = line.slice(0, c2);
        const x2 = _measureSpan.getBoundingClientRect().width;
        if (!(x2>x1)) continue;
        const topPx = (row1 - topLine) * LINE_HEIGHT;
        const el = document.createElement('div');
        el.className='yank-flash';
        el.style.left=(x1 - _hs) + 'px';
        el.style.top= topPx + 'px';
        el.style.width= Math.max(1, Math.round(x2 - x1)) + 'px';
        el.style.height= Math.max(1, Math.round(LINE_HEIGHT)) + 'px';
        try{ el.style.background = col; el.style.opacity = '0.35'; el.style.outline = '1px solid ' + col; el.style.outlineOffset='-1px'; }catch{}
        _yankFlashLayer.appendChild(el);
      }
    }catch{}
  }
  function _flashYanked(pStart, pEnd){
    try{
      if (!pStart || !pEnd) return;
      const a=_clampPos(pStart), b=_clampPos(pEnd);
      let s=a, e=b; if (_cmpPos(s,e)>0){ const t=s; s=e; e=t; }
      const lines=_splitLines();
      const exp = Date.now() + 800; // 0.8s
      // Build segments line-wise
      if (s.r===e.r){
        _yankFlashSegs.push({ r:s.r, c1:s.c, c2:e.c, exp });
      } else {
        // first line
        _yankFlashSegs.push({ r:s.r, c1:s.c, c2:(lines[s.r]||'').length, exp });
        // middle lines
        for (let r=s.r+1; r<e.r; r++){ _yankFlashSegs.push({ r, c1:0, c2:(lines[r]||'').length, exp }); }
        // last line
        _yankFlashSegs.push({ r:e.r, c1:0, c2:e.c, exp });
      }
      _renderYankFlash();
      // schedule cleanup (lazy: render will drop expired segs)
      setTimeout(()=>{ _renderYankFlash(); }, 850);
    }catch{}
  }
  function _updateHlsearchFull(){
    if (!_optHlsearch || !(_lastSearch && _lastSearch.src)){
      _hlClear();
      return;
    }
    _recomputeHlMatches();
    _renderHlMatchesVisible();
    _renderListChars();
  }

  // ---- listchars rendering (minimal overlay layer) ----
  let _listLayer = null;
  function _listEnsureLayer(){
    try{
      if (!_listLayer){ _listLayer = document.createElement('div'); _listLayer.className='listchars-layer'; _listLayer.style.position='absolute'; _listLayer.style.left='0'; _listLayer.style.top='0'; _listLayer.style.right='0'; _listLayer.style.bottom='0'; _listLayer.style.pointerEvents='none'; _listLayer.style.zIndex='1'; }
      if (_listLayer.parentNode !== caretLayer){ caretLayer.appendChild(_listLayer); }
    }catch{}
  }
  function _listClear(){ try{ if(_listLayer){ while(_listLayer.firstChild){ _listLayer.removeChild(_listLayer.firstChild); } } }catch{} }
  function _renderListChars(){
    try{
      if (!_optList){ _listClear(); return; }
      _listEnsureLayer(); _listClear();
      // Keep native textarea tab-size in sync with SIX_OPTIONS.tabstop
      try{
        const root = document.documentElement;
        let ts = 8; if (window && window.SIX_OPTIONS && window.SIX_OPTIONS.tabstop){
          const raw = parseInt(window.SIX_OPTIONS.tabstop,10); if (raw && raw>0) ts = raw;
        }
        root.style.setProperty('--tabstop', String(ts));
      }catch{}
      const lines = _splitLines();
      const realTotal = lines.length; // real EOF (exclude virtual pad lines)
      const topLine = _topLine();
      const vis = _visibleLinesExact();
      const endLine = topLine + vis - 1;
      // For performance do one measurement span reuse
      for (let row = topLine; row <= endLine; row++){
        const idx = row - 1;
        const isReal = idx >= 0 && idx < realTotal;
        const line = isReal ? String(lines[idx]||'') : '';
        const yTop = (row - topLine) * LINE_HEIGHT;
        // Render trailing spaces, tabs, eol marker. We overlay individual inline boxes.
        // Trailing run: treat ASCII space, TAB, and IDEOGRAPHIC SPACE as trailing (#461)
        let trailStart = line.length;
        while (trailStart>0){
          const cht = line.charAt(trailStart-1);
          if (cht===' ' || cht==='\t' || cht==='\u3000') trailStart--; else break;
        }
        // Iterate characters for tabs and trail markers
        // local tab expander using pixel-based columns (space width) for correct alignment after full-width chars (#507)
        const _exp = (s)=>{
          if (!s || s.indexOf('\t')===-1) return s;
          let _ts = 8; try{ const tsRaw = (window && window.SIX_OPTIONS && window.SIX_OPTIONS.tabstop); const ts = parseInt(tsRaw,10); if (ts && ts>0) _ts = ts; }catch{}
          // baseline space advance
          _measureSpan.textContent = ' ';
          const spaceW = _measureSpan.getBoundingClientRect().width || 1;
          const _charW = (ch)=>{ _measureSpan.textContent = ch; const w=_measureSpan.getBoundingClientRect().width; return (w && w>0)?w:spaceW; };
          let out=''; let x=0;
          for (let i=0;i<s.length;i++){
            const ch=s[i];
            if (ch==='\t'){
              const col = Math.floor((x/spaceW)+1e-6);
              const spaces = _ts - (col % _ts);
              out += ' '.repeat(spaces);
              x += spaces * spaceW;
            } else {
              out += ch;
              x += _charW(ch);
            }
          }
          return out;
        };
        for (let c=0;c<line.length;c++){
          const ch = line.charAt(c);
          if (ch==='\t' || ch==='\u3000' || (c>=trailStart && ch===' ')){
            _measureSpan.textContent = _exp(line.slice(0,c));
            const x1 = _measureSpan.getBoundingClientRect().width;
            _measureSpan.textContent = _exp(line.slice(0,c+1));
            const x2 = _measureSpan.getBoundingClientRect().width;
            const el = document.createElement('div');
            el.className='listchar';
            let sym = '';
            if (ch==='\t') sym='▸';
            else if (ch==='\u3000'){ sym='□'; el.className+=' listchar-ideospc'; } // render ideographic space visibly (#462)
            else sym='·';
            el.textContent = sym;
            let _hs=0; try{ _hs=(editor.scrollLeft||0); }catch{}
            el.style.position='absolute'; el.style.left=(x1-_hs)+'px'; el.style.top=yTop+'px'; el.style.height=LINE_HEIGHT+'px'; el.style.lineHeight=LINE_HEIGHT+'px'; el.style.fontSize='inherit'; el.style.fontFamily='var(--controlCharFont, "Segoe UI Symbol","Noto Sans Symbols 2","Cascadia Mono","Consolas",monospace)'; /* weight via CSS var on class */ el.style.padding='0'; el.style.margin='0'; el.style.color='var(--controlCharColor, yellow)';
            _listLayer.appendChild(el);
          }
        }
        // EOL marker (after line width) only for real lines (exclude virtual padding beyond EOF)
        if (isReal){
          _measureSpan.textContent = _exp(line);
          const xEnd = _measureSpan.getBoundingClientRect().width;
          let _hs=0; try{ _hs=(editor.scrollLeft||0); }catch{}
          const elE = document.createElement('div');
          elE.className='listchar-eol';
          // ff-based coloring: THEME via CSS vars for LF/CRLF; legacy CR (mac) stays red-ish as hidden feature
          let ffColor = 'var(--controlCharColorLF, yellow)';
          let ffKind = 'unix';
          try{ const b=currentBuffer(); ffKind=(b&&b.ff)||'unix'; if(ffKind==='dos') ffColor='var(--controlCharColorCRLF, yellow)'; else if(ffKind==='mac') ffColor='rgba(200,80,80,0.65)'; }catch{}
          // Dummy final newline highlighting (#599): original file lacked final LF and current text still lacks final LF.
          // We treat the displayed end-of-line marker for the last real line as synthetic and recolor it.
          // UI記号は常に'↲'で統一（ダミーも同一記号で色のみ差別化）
          let eolSym = '↲';
          try{
            const b = currentBuffer();
            const isLastReal = (idx === realTotal-1);
            const bufText = String(b && b.text || '');
            const stillNoFinalLF = b ? !bufText.endsWith('\n') : false;
            // シンプルルール: 「現在のテキストが末尾LFを欠く」時のみダミーを表示
            const dummyActive = !!(b && isLastReal && stillNoFinalLF);
            if (dummyActive){
              // Prefer explicit theme colors if provided; fall back to a distinct orange/yellow.
              // Fallback colors: fixed yellow (#601 request) if theme not provided
              let dLF = 'yellow'; let dCRLF = 'yellow';
              try{ if (window && window.THEME){ if (window.THEME.dummyLFColor) dLF = String(window.THEME.dummyLFColor); if (window.THEME.dummyCRLFColor) dCRLF = String(window.THEME.dummyCRLFColor); } }catch{}
              ffColor = (ffKind === 'dos') ? dCRLF : dLF;
              elE.dataset.dummyFinal = '1';
            }
          }catch{}
          elE.textContent=eolSym;
          elE.style.position='absolute'; elE.style.left=(xEnd-_hs)+'px'; elE.style.top=yTop+'px'; elE.style.height=LINE_HEIGHT+'px'; elE.style.lineHeight=LINE_HEIGHT+'px'; elE.style.fontSize='inherit'; elE.style.fontFamily='var(--controlCharFont, "Segoe UI Symbol","Noto Sans Symbols 2","Cascadia Mono","Consolas",monospace)'; /* weight via CSS var on class */ elE.style.color=ffColor; elE.style.margin='0'; elE.style.padding='0';
          _listLayer.appendChild(elE);
        }
      }
    }catch{}
  }

  // When true, ensureScrolloff will skip making automatic adjustments.
  // Used to suppress viewport jumps while a modal (confirm) is shown.
  let _suppressScrollDuringModal = false;

  // command history (HTA-like)
  const _cmdHistory = [];
  let _cmdHistIndex = 0;        // 0.._cmdHistory.length (length means draft)
  let _cmdHistBrowsing = false; // true when navigating history in cmdinput
  let _cmdHistTemp = '';        // current draft while browsing

  // search history for '/' and '?' (separate from command history)
  const _searchHistory = [];
  let _searchHistIndex = 0;         // 0.._searchHistory.length (length means draft)
  let _searchHistBrowsing = false;  // true when navigating search history in cmdinput
  let _searchHistTemp = '';         // current draft while browsing

  function _searchHistoryMaybePush(s){
    try{
      // Normalize: trim and ensure starts with '/' or '?'
      let v = String(s||'').trim();
      if (!v) return;
      // Allow optional leading ':'
      v = v.replace(/^:\s*/, '');
    // Require '/pat' or '?pat' with non-empty pattern (flags optional)
    if (!/^[\/?].+/.test(v)) return;
      const last = _searchHistory.length ? _searchHistory[_searchHistory.length-1] : null;
      if (last === v) return; // skip identical consecutive
      _searchHistory.push(v);
    }catch{}
    // reset browsing state after submit
    _searchHistIndex = _searchHistory.length;
    _searchHistBrowsing = false;
    _searchHistTemp = '';
  }

  function _cmdHistoryMaybePush(s){
    try{
      const v = String(s||'').trim();
      if (!v || v === ':') return;
      const last = _cmdHistory.length ? _cmdHistory[_cmdHistory.length-1] : null;
      if (last === v) return; // skip identical consecutive
      _cmdHistory.push(v);
    }catch{}
    // reset browsing state after submit
    _cmdHistIndex = _cmdHistory.length;
    _cmdHistBrowsing = false;
    _cmdHistTemp = '';
  }

  // file popup selection auto-follow control
  // true: input filter auto-selects first match. false: keep user's arrow selection.
  let _fileSelAuto = true;
  // 一回限りの自動補完要求フラグ (#810): サブディレクトリに降りた直後、まだカーソルを動かしていない段階で
  // 現在選択されているエントリ名を入力欄へ補完したい場合にセットされる。
  // { base: <descend後の基点URL文字列>, typed: <_fileTypedDirRaw snapshot> }
  let _fileAutoPrefillOnNextRender = null;

  // measurement span (for caret x position)
  const _measureSpan = (function(){
    const s = document.createElement('span');
    s.style.position = 'fixed';
    s.style.left = '-99999px';
    s.style.top = '-99999px';
    s.style.whiteSpace = 'pre';
    // Set a default; will be synced to editor computed styles at bootstrap/resize
  s.style.font = '200 20px/20px "Cascadia Code", "Cascadia Mono", "JetBrains Mono", "Fira Code", "Consolas", "游ゴシック Light", "Yu Gothic", "Meiryo", "MS Gothic", monospace';
  s.style.fontWeight = '200';
    // Disable kerning/ligatures and enforce full-width East Asian variants for stable measurement
    try{
      s.style.fontKerning = 'none';
      s.style.fontVariantLigatures = 'none';
      // Keep East Asian variants normal to match editor rendering; we'll measure full-width via specific characters
      // Some browsers require camelCase property
      s.style.fontVariantEastAsian = 'normal';
    }catch{}
    document.body.appendChild(s);
    return s;
  })();

  // caret vertical offset (leading top) derived from line-height and font-size
  let _caretYOffset = 0; // px

  function _syncEditorMetrics(){
    try{
      const cs = window.getComputedStyle(editor);
      const root = document.documentElement;
      // Compute raw line-height from CSS variables rather than current computed line-height,
      // because the editor's line-height uses --lhEff which we are about to override.
      const rcs = window.getComputedStyle(root);
      const _measureCssValueToPx = (val)=>{
        try{
          const el = document.createElement('div');
          el.style.position='absolute'; el.style.visibility='hidden'; el.style.height = String(val||'0'); el.style.width='1px';
          document.body.appendChild(el);
          const h = el.getBoundingClientRect().height; document.body.removeChild(el);
          return (Number.isFinite(h) && h>0) ? h : 0;
        }catch{ return 0; }
      };
      // Read base vars as-is (they may be in px/rem). Fallback to sane defaults.
      const vBase = (rcs.getPropertyValue('--lhBase')||'20px').trim();
      const vExtra = (rcs.getPropertyValue('--lhExtraBase')||'0.4rem').trim();
      const basePx = _measureCssValueToPx(vBase);
      const extraPx = _measureCssValueToPx(vExtra);
      const raw = (_edScale>0 ? (basePx + extraPx) * _edScale : (parseFloat(cs && cs.lineHeight)||20));
      if (Number.isFinite(raw) && raw>0){
        const snapped = Math.max(1, Math.round(raw));
        try{ root.style.setProperty('--lhEff', snapped + 'px'); }catch{}
        LINE_HEIGHT = snapped;
      }
      const fs = parseFloat(cs && cs.fontSize);
      if (Number.isFinite(fs) && fs > 0) FONT_SIZE = fs;
      // Guard: 実際の line box と算出 LINE_HEIGHT が乖離している場合再スナップ (#425 EOFジャンプ後余白対策)
      try{
        // 単純に caretRow=0 行幅測定用ダミー span を挿入して高さ測るより、editor 内の 2 行サンプルから平均を取る方が安定
        const probe = document.createElement('div');
        probe.textContent = 'W\nW';
        probe.style.position='absolute'; probe.style.left='-99999px'; probe.style.whiteSpace='pre';
        probe.style.fontFamily = cs.fontFamily; probe.style.fontSize = FONT_SIZE + 'px'; probe.style.lineHeight = LINE_HEIGHT + 'px';
        document.body.appendChild(probe);
        const hProbe = probe.getBoundingClientRect().height; document.body.removeChild(probe);
        const perLine = hProbe/2;
        if (Number.isFinite(perLine) && Math.abs(perLine - LINE_HEIGHT) > 0.6){
          const alt = Math.round(perLine);
          if (alt>0){ LINE_HEIGHT = alt; root.style.setProperty('--lhEff', alt + 'px'); }
        }
      }catch{}
      // Sync measurement span font to editor
      try{
        if (cs && cs.fontFamily) _measureSpan.style.fontFamily = cs.fontFamily;
        if (cs && cs.fontWeight) _measureSpan.style.fontWeight = cs.fontWeight;
        if (Number.isFinite(FONT_SIZE)) _measureSpan.style.fontSize = FONT_SIZE + 'px';
        if (Number.isFinite(LINE_HEIGHT)) _measureSpan.style.lineHeight = LINE_HEIGHT + 'px';
        // Keep measurement behavior consistent with editor rendering
        _measureSpan.style.fontKerning = 'none';
        _measureSpan.style.fontVariantLigatures = 'none';
        _measureSpan.style.fontVariantEastAsian = 'normal';
      }catch{}
      // Compute caret vertical offset: center font box within line box
      const off = (LINE_HEIGHT - FONT_SIZE) / 2;
      _caretYOffset = Number.isFinite(off) ? Math.max(0, off) : 0;
    }catch{}
  }

  // buffers helpers expected by later code
  function currentBuffer(){
    return (currentIdx>=0 && currentIdx<buffers.length) ? buffers[currentIdx] : null;
  }
  function _findBufferByURL(u){
    try{
      const s = String(u||'');
      if (!s) return -1;
      for (let i=0;i<buffers.length;i++){
        const b = buffers[i];
        if (b && String(b.path||'') === s) return i;
      }
      return -1;
    }catch{ return -1; }
  }

  function _toFileURLFromWinPath(p){
    try{
      let s = String(p).replace(/\\/g,'/');
      if (!/^[A-Za-z]:\//.test(s)) return s; // not a drive root style, return as-is
      // Ensure leading slash for URL path: C:/... -> /C:/...
      if (!s.startsWith('/')) s = '/' + s;
      const u = new URL('file://' + s);
      return u.toString();
    }catch{ return String(p); }
  }

  function _isLikelyURL(s){
    try{ const t = String(s||''); return /^([a-z][a-z0-9+.-]*:)/i.test(t); }catch{ return false; }
  }

  function _basename(pathLike){
    try{
      if (_isLikelyURL(pathLike)){
        const u = new URL(pathLike, _htmlBaseURL());
        const pathname = u.pathname || '';
        const trimmed = pathname.endsWith('/') ? pathname.slice(0,-1) : pathname;
        const parts = trimmed.split('/');
        return decodeURIComponent(parts.pop() || '') || pathLike;
      }
      const s = String(pathLike).replace(/\\/g,'/');
      const t = s.endsWith('/') ? s.slice(0,-1) : s;
      return t.substring(t.lastIndexOf('/')+1) || t;
    }catch{ return String(pathLike||''); }
  }

  function _setTitle(){
    try{
      // Note: The native window title bar (document.title) is rendered by the host (WebView2/OS),
      // and its font size/margins cannot be controlled from page CSS/JS.
      // To visually enlarge or add margins, we'd need to draw a custom in-app title area
      // (separate from the OS title bar) or modify the host application window chrome.
      const b = currentBuffer();
      const mod = (b && b.modified) ? ' *' : '';
      // タイトルバー表示: "ファイル名 - フルパス"（タスクバーで先頭に名前が見えるように）
      if (b){
        const hasPath = !!(b.path);
        if (hasPath){
          let full = '';
          try{ full = _prettyFileUrlLabel(b.path); }catch{ full = String(b.path||''); }
          const fname = (function(){ try{ return _basename(b.path); }catch{ return (b.name||'untitled'); } })();
          document.title = (fname || 'untitled') + ' - ' + full + mod;
        } else {
          document.title = (b.name || 'untitled') + mod;
        }
      } else {
        const title = 'six-webview2';
        document.title = title;
      }
    }catch{}
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
    try{
      const base = _htmlBaseURL().toString();
      const u = new URL(full, _htmlBaseURL()).toString();
      if (u.startsWith(base)) return decodeURIComponent(u.substring(base.length));
      return full;
    } catch { return full; }
  }

  function _prettyFileUrlLabel(full){
    if (!full) return '';
    try{
      const u = new URL(full);
      if (u.protocol !== 'file:') return full;
      let p = decodeURIComponent(u.pathname || '');
      const host = u.host || '';
      // Windows ドライブ表記の先頭スラッシュを落とす: /C:/foo → C:/foo
      p = p.replace(/^\/([A-Za-z]:\/)/, '$1');
      // UNC/WSL: host があれば //host を付ける
      try{
        // host が空（ローカル Windows ドライブなど）の場合は先頭 "//" を付けない（UNC誤認回避 #488）
        // host ありの場合のみ //host/ を形成。先頭重複スラッシュは調整。
        if (host){
          if (p.startsWith('/')) p = p.substring(1);
          p = '//' + host + '/' + p;
        }
      }catch{}
      // ディレクトリ末尾のスラッシュは維持
      if ((u.pathname||'').endsWith('/') && !p.endsWith('/')) p += '/';
      return p || full;
    }catch{ return full; }
  }

  // --- file stat helpers for external modification detection (mtime/size) ---
  async function _statFileMeta(urlStr){
    try{
      const u = new URL(urlStr);
      if (u.protocol !== 'file:') return null;
      const parent = _dirnameURL(u.toString());
      const baseName = _basename(u.toString());
      if (!baseName) return null;
      // Bust directory cache once to avoid stale size/mtime right after save/load
      try{
        const key = (function(){ try{ return _ensureSlash(parent)?.toString()||null; }catch{ return null; } })();
        if (key && _dirCache && _dirCache.delete){ _dirCache.delete(key); }
      }catch{}
      const list = await _listDirEntriesWithQuickRetry(parent);
      if (!Array.isArray(list)) return null;
      let caseSensitive = false; try{ if (u.host && u.host.toLowerCase()==='wsl.localhost') caseSensitive = true; }catch{}
      const match = list.find(e=> e && !e.isDir && (
        caseSensitive ? (e.name===baseName) : (String(e.name||'').toLowerCase()===String(baseName||'').toLowerCase())
      ));
      if (match){
        const hasM = (typeof match.mtime === 'number');
        const hasS = (typeof match.size  === 'number');
        // 両方とも欠落している場合はメタ無しとして扱い、nullを返す（baselineをnullで汚さない）
        if (!hasM && !hasS) return null;
        const mtime = hasM ? match.mtime : null;
        const size  = hasS ? match.size  : null;
        /* [stat] meta log removed */
        return { mtime, size };
      }
      /* [stat] no entry log removed */
      return null;
    }catch{ return null; }
  }

  // URL を :e の入力欄にそのまま貼れるディレクトリ表記へ（//host/... または C:/... など）
  function _inputDirRawFromURL(urlObj){
    try{
      const u = (urlObj instanceof URL) ? urlObj : new URL(String(urlObj||''), _htmlBaseURL());
      let s = _prettyFileUrlLabel(u.toString());
      if (s && !s.endsWith('/')) s += '/';
      return s;
    }catch{ return ''; }
  }

  // ---- Missing foundational helpers (restored) ----
  function _htmlBaseURL(){
    try{
      // _six.html の場所を基点とする（new URL('.', href) は末尾スラッシュ付きのディレクトリを返す）
      const u = new URL('.', (document.baseURI || location.href));
      if (!u.pathname.endsWith('/')){ try{ u.pathname = u.pathname + '/'; }catch{} }
      return u;
    } catch {
      try { return new URL(location.href); } catch { return new URL('about:blank'); }
    }
  }

  function _dirnameURL(pathLike){
    try{
      const u = new URL(pathLike, _htmlBaseURL());
      // ディレクトリに正規化
      const p = u.pathname;
      if (/\/$/.test(p)) return u.toString();
      const x = new URL(u.toString());
      x.pathname = x.pathname.replace(/\/[^\/]*$/, '/');
      return x.toString();
    }catch{ return _htmlBaseURL(); }
  }

  function _normalizeToURLString(path, base){
    try{
      if (!path) return new URL('.', base||_htmlBaseURL()).toString();
      // Windows 風 C:\ を file:/// へ
      if (/^[A-Za-z]:[\\\/]/.test(path)){ return _toFileURLFromWinPath(path); }
      // すでにスキームあり
      if (/^([a-z][a-z0-9+.-]*:)/i.test(path)) return new URL(path).toString();
      return new URL(path, base||_htmlBaseURL()).toString();
    }catch{ try{ return new URL(String(path||''), base||_htmlBaseURL()).toString(); }catch{ return String(path||''); } }
  }

  function _splitLines(){
    try{
      const t = String(editor.value||'');
      // 基本は \n で分割。ただし「存在しない便宜上の最終空行」は描画・行数に含めない (#495)
      // 具体的には末尾が\nで終わっている場合でも、分割結果の末尾の空要素は1つだけ捨てる。
      // これにより「末尾に改行あり（1つ）」のときに余分な空行を表示しない。
      const parts = t.split(/\n/);
      if (t.endsWith('\n') && parts.length>0){
        // #636: 末尾 phantom 行は caret が改行直後 (offset===t.length) にある場合のみ表示。
        // 改行文字上 (offset===t.length-1) にいるだけでは表示しない。
        let keepFinalBlank = false;
        try{
          if (_mode === 'INSERT'){
            const caretOff = editor.selectionStart|0;
            if (caretOff === t.length){
              keepFinalBlank = true; // caret が改行を越えて仮想行に入っている
            }
          }
        }catch{}
        if (!keepFinalBlank){ parts.pop(); }
      }
      return parts;
    }catch{ return String(editor.value||'').split(/\n/); }
  }
  // (#607) 編集操作向け: 末尾空要素も含めて忠実に分割した配列を返す
  function _splitLinesRaw(){
    try{ return String(editor.value||'').split(/\n/); }catch{ return [String(editor.value||'')]; }
  }
  function _totalLines(){ return _splitLines().length; }
  // (#607) 編集用に末尾の空要素も含めて分割した配列を返す
  function _splitLinesRaw(){
    try{ return String(editor.value||'').split(/\n/); }catch{ return [String(editor.value||'')]; }
  }
  // (#607) 生配列を使ったクランプ/前進（削除など編集ロジック専用）
  function _clampPosRaw(p){ const lines=_splitLinesRaw(); let r=Math.max(0, Math.min(lines.length-1, p.r|0)); let c=Math.max(0, Math.min((lines[r]||'').length, p.c|0)); return {r,c}; }
  function _advancePosByCpRaw(r,c,n){
    const lines=_splitLinesRaw();
    let rr=r|0, cc=c|0, left=n|0;
    const last=lines.length-1;
    while(left>0){
      const line=lines[rr]||''; const len=line.length;
      if (cc < len){ cc = _nextIndex(line, cc); left--; }
      else { if (rr>=last) break; rr++; cc=0; left--; }
    }
    return { r: Math.max(0, Math.min(last, rr)), c: Math.max(0, Math.min((lines[Math.max(0, Math.min(last, rr))]||'').length, cc)) };
  }
  // Advance by code points on raw lines, but never consume the final EOF newline
  // i.e., when text ends with '\n', do not cross from last-1 to last empty raw line (#660)
  function _advancePosByCpRawStopBeforeFinalLF(r,c,n){
    const s = String(editor.value||'');
    const endsWithLF = s.endsWith('\n');
    const endsWithSymbol = !endsWithLF && s.endsWith('\u2424'); // U+2424 SYMBOL FOR NEWLINE (paste残留) (#661)
    const lines=_splitLinesRaw();
    let rr=r|0, cc=c|0, left=n|0;
    const last=lines.length-1;
    while(left>0){
      const line=lines[rr]||''; const len=line.length;
      if (cc < len){
        // 保護対象: 行末が U+2424 かつそれがファイル末尾文字
        if (endsWithSymbol && rr===last && cc===len-1 && line.charCodeAt(len-1)===0x2424){ break; }
        cc = _nextIndex(line, cc); left--;
      } else {
        if (rr>=last) break;
        // If next step would cross the final newline (rr+1 === last) and file ends with LF, stop before consuming it
        if (endsWithLF && (rr+1===last)) break;
        rr++; cc=0; left--;
      }
    }
    return { r: Math.max(0, Math.min(last, rr)), c: Math.max(0, Math.min((lines[Math.max(0, Math.min(last, rr))]||'').length, cc)) };
  }
  function _topLine(){
    const st = (editor.scrollTop||0);
    // 端数によるズレを抑えるため下方向に丸め（常に現在の表示先頭行を指す）
    // 行境界スナップと整合し、EOF 付近での off-by-one を防止
    return Math.floor(st / LINE_HEIGHT) + 1;
  }
  function _visibleLinesExact(){
    if (_cachedVisibleCount) return _cachedVisibleCount;
    try{ const h = editor.clientHeight || viewport.clientHeight; return Math.max(1, Math.round(h/LINE_HEIGHT)); }catch{ return Math.max(1, Math.floor(viewport.clientHeight/LINE_HEIGHT)); }
  }
  function _needsHScrollReserve(){ return false; }

  // Escape regex metacharacters for VISUAL search seeds while preserving \n and \t
  function _escapeRegexLiteralForSeed(s){
    try{
      if (s==null) return '';
      // Normalize CRLF/CR to LF first
      let src = String(s).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
      let out = '';
      for (let i=0;i<src.length;i++){
        const ch = src[i];
        if (ch === '\n'){ out += '\\n'; }
        else if (ch === '\t'){ out += '\\t'; }
        else if (ch === '\\'){ out += '\\\\'; }
        else if (/[\.^$|?*+(){}\[\]]/.test(ch)){ out += '\\' + ch; }
        else { out += ch; }
      }
      return out;
    }catch{ return String(s||''); }
  }

  // ---- Search helpers (for '/', '?' and n/N) ----
  function _searchFindNext(src, flags, dir, fromOff, wrap){
    try{
      const text = String(editor.value||'');
      const n = text.length|0;
  // Always include 'm' so ^/$ anchor to line start/end across the whole buffer.
  let reFlags = 'm';
  if (flags && /i/.test(flags)) reFlags += 'i';
      let startIdx = -1; let matchLen = 0;
      if (dir === 'fwd'){
        // Allow callers to pass fromOff-1 to include current. If fromOff is -1, start becomes 0.
        const start = Math.min(n, Math.max(0, ((fromOff|0) + 1))); // caller may pass fromOff-1 to include current
        let re = null;
  try{ re = new RegExp(src, reFlags); }catch{ re=null; }
        if (!re) return null;
        const slice1 = text.slice(start);
        const m1 = re.exec(slice1);
        if (m1){ startIdx = start + (m1.index|0); matchLen = (m1[0]||'').length; }
        else if (wrap !== false){
          const m2 = re.exec(text.slice(0, start));
          if (m2){ startIdx = (m2.index|0); matchLen = (m2[0]||'').length; }
        }
      } else { // 'bwd'
        const off = Math.max(0, Math.min(n, (fromOff|0)));
        const upto = Math.max(0, off - 1);
  const reAll = (function(){ try{ return new RegExp(src, (reFlags+'g')); }catch{ return null; } })();
        if (!reAll) return null;
        let last = null; let m;
        reAll.lastIndex = 0;
        const s = text.slice(0, upto);
        while ((m = reAll.exec(s))){ last = { i:m.index|0, l:(m[0]||'').length|0 }; if ((m[0]||'').length===0) reAll.lastIndex++; }
        if (last){ startIdx = last.i; matchLen = last.l; }
        else if (wrap !== false){
          reAll.lastIndex = 0; last = null;
          const s2 = text;
          while ((m = reAll.exec(s2))){ last = { i:m.index|0, l:(m[0]||'').length|0 }; if ((m[0]||'').length===0) reAll.lastIndex++; }
          if (last){ startIdx = last.i; matchLen = last.l; }
        }
      }
      if (startIdx>=0){ return { start:startIdx, len: Math.max(0, matchLen|0) }; }
      return null;
    }catch{ return null; }
  }

  function _applyTheme(){
    try{
      const t = (window && window.THEME) ? window.THEME : {};
      const root = document.documentElement;
      const setVar = (k, v)=>{ try{ if (v!=null) root.style.setProperty('--'+k, String(v)); }catch{} };
      // Theme getter with uniform fallback 'yellow' when key missing (#437)
      const themeGet = (key, fallback)=>{
        try{
          if (t && Object.prototype.hasOwnProperty.call(t, key)){
            const v = t[key];
            if (v != null && v !== '') return v;
          }
        }catch{}
        return (fallback!=null ? fallback : 'yellow');
      };
      // Core colors
      setVar('bodyBGColor', themeGet('bodyBGColor', t.bodyBGColor));
      setVar('lineBaseFill', themeGet('lineBaseFill', t.lineBaseFill));
      // Per-line gradient colors (top -> bottom)
      setVar('lineGradStart', themeGet('lineGradientStart', t.lineGradientStart));
      setVar('lineGradEnd', themeGet('lineGradientEnd', t.lineGradientEnd));
  // Editor text color
  setVar('editorTextColor', themeGet('editorTextColor', t.editorTextColor));
  // Active line stripe gradient (top -> bottom)
  setVar('activeLineGradStart', themeGet('activeLineGradientStart', t.activeLineGradientStart));
  setVar('activeLineGradEnd', themeGet('activeLineGradientEnd', t.activeLineGradientEnd));
  // Gutter gradients (active row default) and INSERT用ガター
  setVar('activeGutterGradStart', themeGet('activeGutterGradientStart', t.activeGutterGradientStart));
  setVar('activeGutterGradEnd', themeGet('activeGutterGradientEnd', t.activeGutterGradientEnd));
  setVar('activeEditGutterGradStart', themeGet('activeEditGutterGradStart', t.activeEditGutterGradStart));
  setVar('activeEditGutterGradEnd', themeGet('activeEditGutterGradEnd', t.activeEditGutterGradEnd));
  // INSERT mode specific stripe/caret gradients (exposed as CSS vars too)
  setVar('activeEditLineGradStart', themeGet('activeEditLineGradStart', t.activeEditLineGradStart));
  setVar('activeEditLineGradEnd', themeGet('activeEditLineGradEnd', t.activeEditLineGradEnd));
  setVar('editCaretGradStart', themeGet('editCaretGradStart', t.editCaretGradStart));
  setVar('editCaretGradMid', themeGet('editCaretGradMid', t.editCaretGradMid));
      setVar('activeLineBg', themeGet('activeLineBg', t.activeLineBg));
  setVar('tabBarBg', t.tabBarBg);
  setVar('tabBarFg', t.tabBarFg);
  // Tab colors (#455) with yellow fallback if missing
  setVar('tabBg', themeGet('tabBg', t.tabBg));
  setVar('tabText', themeGet('tabText', t.tabText));
  setVar('activeTabBg', themeGet('activeTabBg', t.activeTabBg));
  // Active tab text color (no legacy fallback; missing key => yellow to surface omission) (#457)
  setVar('activeTabText', themeGet('activeTabText', t.activeTabText));
  // Tab scroll button colors (always present; disabled/enabled styled via CSS vars)
  setVar('tabScrollBtnEnableBG', themeGet('tabScrollBtnEnableBG', t.tabScrollBtnEnableBG));
  setVar('tabScrollBtnEnableText', themeGet('tabScrollBtnEnableText', t.tabScrollBtnEnableText));
  setVar('tabScrollBtnDisableBG', themeGet('tabScrollBtnDisableBG', t.tabScrollBtnDisableBG));
  setVar('tabScrollBtnDisableText', themeGet('tabScrollBtnDisableText', t.tabScrollBtnDisableText));
  // Control chars colors for listchars (#458)
  setVar('controlCharColor', themeGet('controlCharColor', t.controlCharColor));
  setVar('controlCharColorLF', themeGet('controlCharColorLF', t.controlCharColorLF));
  setVar('controlCharColorCRLF', themeGet('controlCharColorCRLF', t.controlCharColorCRLF));
  // Tabstop CSS var (used by textarea native tab-size). Fallback to 8 when SIX_OPTIONS.tabstop is missing. (#465)
  try{
    let ts = 8;
    if (window && window.SIX_OPTIONS && window.SIX_OPTIONS.tabstop){
      const raw = parseInt(window.SIX_OPTIONS.tabstop, 10);
      if (raw && raw > 0) ts = raw;
    }
    setVar('tabstop', ts);
  }catch{ setVar('tabstop', 8); }
  // Command input colors
  setVar('cmdInputFg', themeGet('cmdInputFg', t.cmdInputFg));
  setVar('cmdInputBg', themeGet('cmdInputBg', t.cmdInputBg));
      setVar('gutterGradientStart', themeGet('gutterGradientStart', t.gutterGradientStart));
      setVar('gutterGradientEnd', themeGet('gutterGradientEnd', t.gutterGradientEnd));
      setVar('gutterNumberColor', themeGet('gutterNumberColor', t.gutterNumberColor));
      setVar('activeLineNumberColor', themeGet('activeLineNumberColor', t.activeLineNumberColor));
  // Caret gradient colors (start/mid). End is fixed to rgba(255,0,0,0.0) in CSS
      setVar('caretGradStart', themeGet('caretGradientStart', t.caretGradientStart));
      setVar('caretGradMid', themeGet('caretGradientMid', t.caretGradientMid));
  // Visual selection colors
  setVar('selBg', themeGet('selectionBg', t.selectionBg));
  setVar('selFg', themeGet('selectionFg', t.selectionFg));
  // Incremental search preview highlight
  setVar('incPreviewBg', themeGet('incPreviewBg', t.incPreviewBg));
  setVar('incPreviewOutline', themeGet('incPreviewOutline', t.incPreviewOutline));
  // hlsearch (all matches) highlight
  setVar('hlsearchBg', themeGet('hlsearchBg', t.hlsearchBg));
  setVar('hlsearchOutline', themeGet('hlsearchOutline', t.hlsearchOutline));
  // VISUAL after ':' selection overlay
  setVar('visCmdSelBg', themeGet('visCmdSelBg', t.visCmdSelBg));
  setVar('visCmdSelOutline', themeGet('visCmdSelOutline', t.visCmdSelOutline));
  // Help modal (tabs/colors)
  setVar('six-help-tab-active-bg', themeGet('helpTabActiveBg', t.helpTabActiveBg));
  setVar('six-help-tab-active-fg', themeGet('helpTabActiveFg', t.helpTabActiveFg));
  setVar('six-help-tab-bg', themeGet('helpTabBg', t.helpTabBg));
  setVar('six-help-tab-fg', themeGet('helpTabFg', t.helpTabFg));
  setVar('six-modal-bg', themeGet('helpModalBg', t.helpModalBg));
  setVar('six-help-kbd-bg', themeGet('helpKbdBg', t.helpKbdBg));
  setVar('six-help-kbd-fg', themeGet('helpKbdFg', t.helpKbdFg));
  // Global kbd colors for tabs and popups
  // No cross-key fallback: if missing, turn yellow to reveal omission (#438)
  setVar('six-kbd-bg', themeGet('KbdBgColor', t.KbdBgColor));
  setVar('six-kbd-fg', themeGet('KbdFgColor', t.KbdFgColor));
  // Help close button colors
  setVar('six-help-close-bg', themeGet('helpCloseBg', t.helpCloseBg));
  setVar('six-help-close-fg', themeGet('helpCloseFg', t.helpCloseFg));
  setVar('six-help-close-border', themeGet('helpCloseBorder', t.helpCloseBorder));
  // Popup active line color (encodeSet popup etc.)
  setVar('popupActiveLine', themeGet('popupActiveLine', t.popupActiveLine));
      // apply persisted scale if any (fallback only). If a buffer becomes active later,
      // that buffer's edScale will override this. Keep metrics in sync to avoid
      // mismatched font-size vs line-height on first paint (#714).
      try{
        // Skip overriding when a buffer is already active (session restore in progress)
        const hasActiveBuffer = (Array.isArray(buffers) && buffers.length>0 && (currentIdx|0) >= 0);
        if (!hasActiveBuffer){
          const s = localStorage.getItem('six.edScale');
          const n = s ? parseFloat(s) : NaN;
          if (Number.isFinite(n) && n > 0.3 && n < 5){ _edScale = _nearestScale(n); }
        }
      }catch{}
      try{ root.style.setProperty('--edScale', String(_edScale)); }catch{}
      try{ _syncEditorMetrics(); }catch{}
  // Cache baseline caret colors (IME override removed, kept for potential future theming)
      try{
        const cs = getComputedStyle(root);
        const cg0 = cs.getPropertyValue('--caretGradStart');
        const cg1 = cs.getPropertyValue('--caretGradMid');
        _caretGradStartBase = (cg0 && cg0.trim()) || '#ff5b5b';
        _caretGradMidBase   = (cg1 && cg1.trim()) || 'rgba(255,0,0,0.2)';
      }catch{}
    }catch{}
  }

  // Reload _six.customize with a cache-busting query and evaluate it to refresh window.THEME/SIX_OPTIONS.
  // This allows theme edits to take effect on next startup without requiring Ctrl+F5 (#440).
  function _reloadCustomizeFresh(){
    try{
      const url = '_six.customize?cb=' + Date.now();
      return fetch(url, { cache: 'no-store' })
        .then(res=>{ if (!res.ok) throw new Error('http ' + res.status); return res.text(); })
        .then(src=>{ try{ (new Function(src))(); }catch(e){ /* swallow */ } });
    }catch(e){ return Promise.reject(e); }
  }

  function _setEditorScale(next){
    const root = document.documentElement;
    const min = _scaleSteps[0], max = _scaleSteps[_scaleSteps.length-1];
    // snap to nearest allowed step while clamping
    const clamped = Math.min(max, Math.max(min, next));
    _edScale = _nearestScale(clamped);
    try{ root.style.setProperty('--edScale', String(_edScale)); }catch{}
    try{ localStorage.setItem('six.edScale', String(_edScale)); }catch{}
    // re-sync metrics and overlays
    _syncEditorMetrics();
    clampViewportExactLines();
    ensureScrolloff();
    _repositionCaret();
    updateGutter();
    _renderHlMatchesVisible();
    // persist per-buffer scale
    try{ const b=currentBuffer(); if (b){ b.edScale = _edScale; _schedulePersist('edScale'); } }catch{}
    _showZoomHUD();
  }

  // Apply editor scale without HUD/localStorage writes (buffer switch)
  function _applyEditorScaleSilent(next){
    try{
      const root = document.documentElement;
      const min = _scaleSteps[0], max = _scaleSteps[_scaleSteps.length-1];
      const clamped = Math.min(max, Math.max(min, next));
      _edScale = _nearestScale(clamped);
      try{ root.style.setProperty('--edScale', String(_edScale)); }catch{}
      _syncEditorMetrics();
      // Refresh Zoom HUD value on silent apply (tab switch)
      _showZoomHUD();
    }catch{}
  }

  // --- Zoom HUD ---
  let _zoomHudTimer = null;
  function _formatZoom(){ return Math.round(_edScale*100) + '%'; }
  function _wireZoomHUD(){
    try{
      const el = document.getElementById('zoomhud'); if (!el) return;
      // Make HUD non-focusable and prevent it from stealing focus on interaction
      try{ el.setAttribute('tabindex','-1'); }catch{}
      try{ el.addEventListener('mousedown', (e)=>{ e.preventDefault(); }, true); }catch{}
      // Always visible HUD: ensure it is shown and initialized
      try{ el.style.display = 'block'; }catch{}
      const v = document.getElementById('zoomVal'); if (v) v.textContent = _formatZoom();
      const minus = document.getElementById('zoomMinus');
      const plus = document.getElementById('zoomPlus');
      const reset = document.getElementById('zoomReset');
      if (minus){
        try{ minus.setAttribute('tabindex','-1'); }catch{}
        minus.onclick = ()=>{ _stepEditorScale(-1); try{ setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0); }catch{} };
      }
      if (plus){
        try{ plus.setAttribute('tabindex','-1'); }catch{}
        plus.onclick = ()=>{ _stepEditorScale(+1); try{ setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0); }catch{} };
      }
      if (reset){
        try{ reset.setAttribute('tabindex','-1'); }catch{}
        reset.onclick = ()=>{ _setEditorScale(1); try{ setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0); }catch{} };
      }
    }catch{}
  }
  function _showZoomHUD(){
    try{
      const el = document.getElementById('zoomhud');
      const v = document.getElementById('zoomVal');
      if (!el) return;
      if (v) v.textContent = _formatZoom();
      // Always visible: keep displayed and do not auto-hide
      try{ el.style.display = 'block'; }catch{}
      if (_zoomHudTimer){ clearTimeout(_zoomHudTimer); _zoomHudTimer=null; }
    }catch{}
  }

  // Host root detection (file:////host/ with no share path)
  function _isHostRoot(u){
    try{ const x = (u instanceof URL) ? u : new URL(u); return x.protocol==='file:' && !!x.host && (x.pathname==='' || x.pathname==='/'); }catch{ return false; }
  }

  // Load shares for a host (e.g., wsl.localhost) into popup entries
  async function _loadSharesForHost(host, selectName){
    if (!_apiIsEnabled()){
      // APIが使えない場合は shares を列挙できない → '********' で停止
      _fileInvalid = true; _fileLoading = false; _fileEntries = []; if (_filePopupVisible()) _filePopupRender();
      return false;
    }
    try{
      _fileInvalid = false; _fileLoading = true; _fileEntries = []; _fileSel = 0;
      if (_filePopupVisible()) _filePopupRender();
      const apiUrl = _apiBase + 'shares?host=' + encodeURIComponent(host);
      const j = await _fetchJSONWithTimeout(apiUrl, 4000);
      try{ _apiNoteSuccess(); }catch{}
      const raw = (j && Array.isArray(j.shares)) ? j.shares : [];
      const seen = new Set();
      const clean = (s)=>{ try{ let t=String(s||''); t=t.replace(/[\u200B-\u200D\u2060\u00A0]/g,''); t=t.replace(/[\u0000-\u001F]/g,''); try{ t=t.normalize('NFKC'); }catch{} return t.trim(); }catch{ return String(s||''); } };
      const entries = [];
      for (const e of raw){ const n0=e&&e.name; const n1=clean(n0); if(!n1) continue; if(n1==='.'||n1==='..'||n1.includes('/')) continue; const key=n1.toLowerCase(); if(seen.has(key)) continue; seen.add(key); const url=(e&&e.url)?String(e.url):('file:////'+host+'/'+encodeURIComponent(n1)+'/'); entries.push({ name:n1, isDir:true, url }); }
      entries.sort((a,b)=> a.name.localeCompare(b.name));
      _fileEntries = entries;
      try{
        if (selectName){ const idx = entries.findIndex(e=>e && e.name===selectName); if (idx>=0) _fileSel = idx; }
      }catch{}
      try{ const curKey = _ensureSlash(_fileBaseURL)?.toString()||null; _fileStableEntries = entries.slice(); _fileStableBaseKey = curKey; }catch{}
      _fileInvalid = false; _fileLoading = false; if (_filePopupVisible()) _filePopupRender();
      return true;
    }catch{
      _fileLoading = false; return false;
    }
  }

  function _addBuffer(b){
    try{
      const text0 = String(b.text||'');
      buffers.push({
        name: b.name||'(untitled)',
        path: b.path||null,
        text: text0,          // current working text (unsaved edits reflected)
        savedText: text0,     // last-saved snapshot (content reference only)
        modified: !!b.modified,
        _changeTick: 0,
        _savedTick: 0,
        _undo: [],
        _redo: [],
        // per-buffer zoom scale (editor-only zoom)
        edScale: (Number.isFinite(b.edScale) ? _nearestScale(b.edScale) : 1),
        // per-buffer shiftwidth (indent width in spaces)
        shiftwidth: Number.isFinite(b.shiftwidth)? Math.max(1, (b.shiftwidth|0)) : 4,
        // per-buffer case sensitivity options (#696)
        ignorecase: !!b.ignorecase,
        smartcase:  !!b.smartcase,
        // original final newline presence (established on initial load/create) — #598
        _origHadFinalLF: text0.endsWith('\n'),
        // encoding/newline metadata
        enc: (b.enc||'utf-8'),      // 'utf-8' | 'shift_jis'
        ff:  (b.ff||'unix'),        // 'unix' | 'dos'
        bom: !!b.bom,               // true only meaningful for utf-8
        // per-buffer mode (NORMAL/INSERT/VISUAL). Do not persist CMD.
        savedMode: (b.savedMode||'NORMAL'),
        // per-buffer view/caret state (restored on tab switch)
        viewRow: 0,
        viewCol: 0,
        viewScrollTop: 0,
        // persist VISUAL selection across tabs
        savedVisual: null,
        // external modification tracking (mtime/size established when buffer becomes unmodified after save/load)
        _externalDeleteIgnored: false, // 外部削除通知のキャンセル後、再起動まで抑止するためのフラグ
        _extMtime: null,
        _extSize: null,
        _externalChangeIgnored: false,
        _checkingExternal: false,
        _extLastCheckAt: 0
      });
      if (currentIdx<0) currentIdx=0;
    }catch{}
  }
  function _switchToBuffer(i){
    try{
      if (!(i>=0 && i<buffers.length)) return;
      // If selecting the same buffer, do nothing to avoid any visual flicker.
      if (i === currentIdx){
        try{ editor && editor.focus && editor.focus(); }catch{}
        return;
      }
      /* [switch] begin log removed */
      _lastBufferSwitchAt = Date.now();
      // Temporarily hide editor viewport to avoid a brief flicker to EOF when
      // the new buffer has fewer lines and the previous scrollTop is clamped.
      // We'll restore visibility immediately after we apply the saved scroll.
      let vp=null, prevVis='';
      try{
        vp = document.getElementById('editorViewport');
        if (vp){ prevVis = vp.style.visibility || ''; vp.style.visibility = 'hidden'; }
      }catch{}
      // 1) Save current buffer's view state before switching away
      if (currentIdx>=0 && currentIdx<buffers.length){
        try{
          const prev = buffers[currentIdx];
          prev.viewRow = caretRow|0;
          prev.viewCol = caretCol|0;
          try{
            const st = (editor.scrollTop||0)|0;
            prev.viewScrollTop = Math.round(Math.max(0, st)/LINE_HEIGHT)*LINE_HEIGHT;
          }catch{ prev.viewScrollTop = (editor.scrollTop||0)|0; }
          // Save VISUAL selection snapshot, if active
          if (_visualActive){
            prev.savedMode = 'VISUAL';
            prev.savedVisual = {
              linewise: !!_visualLinewise,
              anchorR: _visualAnchorR|0,
              anchorC: _visualAnchorC|0,
              caretR: caretRow|0,
              caretC: caretCol|0
            };
          } else {
            // clear stale snapshot when not in VISUAL
            prev.savedVisual = null;
          }
        }catch{}
      }
      // 2) Switch current index
      currentIdx = i;
      const b = buffers[i];
      // 3) Load text into editor
      editor.value = String(b.text||'');
        // 3.5) Apply this buffer's zoom scale silently (no HUD/LS) and refresh visible-lines cache
        try{ const s = Number.isFinite(b && b.edScale) ? b.edScale : 1; _applyEditorScaleSilent(s); }catch{}
        try{ clampViewportExactLines(); }catch{}
      // 4) Restore caret and scroll position for this buffer
      const vr = Number.isFinite(b.viewRow) ? (b.viewRow|0) : 0;
      const vc = Number.isFinite(b.viewCol) ? (b.viewCol|0) : 0;
  let vs = Number.isFinite(b.viewScrollTop) ? (b.viewScrollTop|0) : 0;
      _setCaret(vr, vc);
      // Validate viewport: if saved scrollTop does not include the caret (e.g., corrupted to EOF),
      // compute a safe fallback that centers the caret within the viewport to avoid "G-like" jumps (#359/#360)
      try{
        const vis = Math.max(1, _visibleLinesExact());
        const caretLine1 = (vr|0) + 1;
        const savedTop1 = Math.floor(Math.max(0, vs)/LINE_HEIGHT) + 1;
        const savedBottom1 = savedTop1 + vis - 1;
        // If caret would be off-screen with saved vs, recalc vs from caret
        if (caretLine1 < savedTop1 || caretLine1 > savedBottom1){
          let top1 = Math.max(1, caretLine1 - Math.floor(vis/2));
          const linesTotal = _totalLines();
          const baseMaxTop = Math.max(1, linesTotal - vis + 1);
          const maxTopWithPad = Math.min(linesTotal, baseMaxTop + 1);
          top1 = Math.min(top1, maxTopWithPad);
          vs = (top1-1) * LINE_HEIGHT;
        }
      }catch{}
      // Snap scrollTop to exact line boundary to keep background gradient/gutter aligned
      const vsSnap = (function(){ try{ const n=Math.max(0, vs); return Math.round(n/LINE_HEIGHT)*LINE_HEIGHT; }catch{ return Math.max(0, vs|0); } })();
  // Restore viewport scroll top (validated)
  try{ editor.scrollTop = Math.max(0, vsSnap); }catch{}
      // Do NOT recentre on switch; keep exact previous viewport
      _centerScrolloffOnce = false;
  _repositionCaret(); updateGutter();
  // Sync native selection to overlay caret to prevent browser auto-scroll on next key/focus
  try{ const stKeep0 = (editor && typeof editor.scrollTop==='number') ? editor.scrollTop : 0; _syncNativeSelectionToCaret(); if (editor) editor.scrollTop = stKeep0; }catch{}
  _updateEncBtnLabel();
      // Some browsers/layouts may adjust scrollTop after content/overlays settle.
      // Re-apply saved scroll position on the next frame and shortly after to ensure it sticks.
      try{
        const applyScroll = ()=>{
          try{ clampViewportExactLines(); }catch{}
          // Re-assert saved caret/viewport to defeat any early-frame overrides (#715)
          try{ _setCaret(vr, vc); }catch{}
          try{ editor.scrollTop = Math.max(0, vsSnap); }catch{}
          try{ _repositionCaret(); updateGutter(); }catch{}
          // Keep native selection aligned with caret; do not let this change scroll position
          try{ const stKeep = (editor && typeof editor.scrollTop==='number') ? editor.scrollTop : 0; _syncNativeSelectionToCaret(); if (editor) editor.scrollTop = stKeep; }catch{}
          // Persist the restored viewport to the buffer as the new baseline
          try{
            const st = (editor.scrollTop||0)|0;
            const stSnap = Math.round(Math.max(0, st)/LINE_HEIGHT)*LINE_HEIGHT;
            b.viewScrollTop = stSnap; b.viewRow = caretRow|0; b.viewCol = caretCol|0;
          }catch{}
        };
        if (window.requestAnimationFrame){
          requestAnimationFrame(()=>{
            applyScroll();
            // Reveal viewport after one more frame to avoid exposing any transient EOF clamp
            requestAnimationFrame(()=>{ try{ if (vp) vp.style.visibility = prevVis; }catch{} });
          });
        }
        setTimeout(applyScroll, 0);
        setTimeout(applyScroll, 80);
        // Add one more delayed reinforcement to defeat late layout/scroll listeners
        setTimeout(applyScroll, 180);
        // Fallback: ensure viewport visibility is restored even if rAF doesn't fire (#715)
        setTimeout(()=>{ try{ if (vp) vp.style.visibility = prevVis; }catch{} }, 120);
        // Suppress any automatic scroll adjustments briefly after switching buffers
        // to prevent ensureScrolloff or other flows from recentering the viewport (#357)
        try{ _scrollGuardUntil = Date.now() + 1400; }catch{}
        // Additionally, skip the very next ensureScrolloff once to avoid an immediate EOF snap on first key (#410)
        try{ _skipEnsureOnceAfterSwitch = true; }catch{}
    // Prefer not to scroll on the very first motion if caret is already visible (#415)
    try{ _preferNoScrollOnceAfterSwitch = true; }catch{}
      }catch{}
      // Also record immediately (in case no scroll events fire)
      try{
        const st = (editor.scrollTop||0)|0; const stSnap = Math.round(Math.max(0, st)/LINE_HEIGHT)*LINE_HEIGHT;
        b.viewScrollTop = stSnap; b.viewRow = caretRow|0; b.viewCol = caretCol|0;
      }catch{}
      _setTitle(); _renderTabbar();
      try{ _updateOverlayShiftwidthVisual(); }catch{}
      _updateHlsearchFull();
      // Ensure editor regains focus after switch (covers INSERT restore as well)
      try{ setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0); }catch{}
      // Persist last-active index as part of session (debounced)
      try{ _schedulePersist('switch'); }catch{}
      // Restore per-buffer mode (NORMAL/INSERT/VISUAL). Exclude transient CMD.
      try{
        const want = (b && (b.savedMode||'NORMAL')) || 'NORMAL';
        if (want === 'VISUAL'){
          // Restore VISUAL with saved anchor/caret if available
          // Ensure we leave any previous visual state cleanly
          if (_visualActive){ try{ _exitVisual(); }catch{} }
          const sv = b && b.savedVisual;
          if (sv && Number.isFinite(sv.anchorR) && Number.isFinite(sv.anchorC) && Number.isFinite(sv.caretR) && Number.isFinite(sv.caretC)){
            _visualActive = true;
            _visualLinewise = !!sv.linewise;
            _visualAnchorR = sv.anchorR|0; _visualAnchorC = sv.anchorC|0;
            _setCaret(sv.caretR|0, sv.caretC|0);
            _setMode('VISUAL');
            _updateVisualSelection();
          } else {
            // Fallback: enter VISUAL at current caret
            _enterVisual(false);
          }
        } else if (want === 'INSERT'){
          // Avoid starting a new insert undo snapshot on tab switch
          _suppressInsertSnapshotOnce = true;
          // Clear any lingering VISUAL state when entering INSERT
          try{ _visualActive=false; _visualLinewise=false; _visCmdActive=false; _cmdFromVisual=false; _visSelClear && _visSelClear(); }catch{}
          _setMode('INSERT');
        } else {
          // NORMAL: ensure VISUAL/CMD artifacts are cleared
          try{ _visualActive=false; _visualLinewise=false; _visCmdActive=false; _cmdFromVisual=false; _visSelClear && _visSelClear(); }catch{}
          _setMode('NORMAL');
        }
      }catch{}
      // On activation, detect external modification for file-backed buffers
      try{
        if (b && b.path && /^file:\/\//i.test(b.path)){
          /* [switch] external-check trigger log removed */
          _maybeCheckExternalChangeOnActivate(i);
          // タブ復帰時の削除検出信頼性向上: 初回で見逃した削除を短期再試行（キャッシュ・FS伝播遅延対策）
          try{
            setTimeout(()=>{
              // (旧) Enter直接入力禁止名チェック削除 (#862 で統合処理へ移行)
              (async()=>{
                try{
                  const bb = (i>=0 && i<buffers.length)? buffers[i] : null;
                  if (!bb || bb!==currentBuffer()) return; // still active
                  if (!bb.path || !/^file:\/\//i.test(bb.path)) return;
                  if (bb._externalDeleteIgnored) return;
                  if (bb._externalDeleteRecoveredAt && (Date.now() - bb._externalDeleteRecoveredAt < 2000)) return;
                  // 直近でチェック中なら待つ
                  if (bb._checkingExternal) return;
                  // 本体処理では削除を判定できなかったケースのみ対象: baseline 有り & mtime/size 未更新 & 直後再statで null
                  // baseline 条件 (どちらか設定済)
                  const hasBaseline = (typeof bb._extMtime==='number') || (typeof bb._extSize==='number');
                  // 初回後まもなくなので throttle とは独立に stat 実行
                  const meta1 = await _statFileMeta(bb.path);
                  if (meta1){ return; } // まだ存在 → 削除なし
                  // 再度キャッシュ破棄後にもう一度（_statFileMeta 内部で破棄済だが念のため二重防御）
                  try{ const parent = _dirnameURL(bb.path); const key = (function(){ try{ return _ensureSlash(parent)?.toString()||null; }catch{ return null; } })(); if (key && _dirCache && _dirCache.delete){ _dirCache.delete(key); } }catch{}
                  const meta2 = await _statFileMeta(bb.path);
                  if (!meta2 && hasBaseline){
                    const label = bb.path ? _prettyFileUrlLabel(bb.path) : (bb.name||'(untitled)');
                    const id = await choiceModal({ title:'外部削除検出(再試行)', detail:`このファイルはsixの外部で削除された可能性があります。保存しますか？\n${label}`,
                      buttons:[{id:'save',label:'保存',primary:true},{id:'cancel',label:'キャンセル'}] });
                    if (id==='save'){
                      const textData = _normalizeTextForSaveInternal((bb===currentBuffer() && editor)? (editor.value||'') : (bb.text||''));
                      const r = await _saveToURLWithExternalCheck(bb, bb.path, textData);
                      if (r && r.status==='saved'){ try{ bb._externalDeleteIgnored=false; bb._externalDeleteRecoveredAt=Date.now();
                        const txt = (bb===currentBuffer() && editor)? (editor.value||'') : (bb.text||'');
                        bb.text = txt; bb.savedText = txt; bb._savedTick = (bb._changeTick|0); bb.modified = false;
                        toast('保存しました');
                        // タブ表示即時反映
                        _setTitle && _setTitle(); _renderTabbar && _renderTabbar();
                      }catch{} }
                    } else {
                      bb._externalDeleteIgnored = true;
                      toast('外部削除を検出(再試行): キャンセルしました', 2000);
                    }
                  }
                }catch{}
              })();
            }, 360); // 360ms 後 (FS反映 + キャッシュ破棄後)
          }catch{}
        } else {
          try{ b._externalChangeIgnored = false; }catch{}
        }
      }catch{}
    }catch{}
  }

  // External change detection (activation)
  async function _maybeCheckExternalChangeOnActivate(idx){
    try{
      const b = buffers[idx]; if (!b) return;
      if (!b.path || !/^file:\/\//i.test(b.path)){ /* [ext-check] skip log removed */ return; }
      const now = Date.now();
      if (b._extLastCheckAt && (now - b._extLastCheckAt < 1500)) {
        // スロットル期間中でも軽量な外部削除のみ再確認（変更検出遅延を避ける）
        try{
          if (!b._checkingExternal){
            if (b._externalDeleteRecoveredAt && (Date.now() - b._externalDeleteRecoveredAt < 2000)) return;
            const metaQuick = await _statFileMeta(b.path);
            if (!metaQuick && !b._externalDeleteIgnored){
              try{
                const label = b.path ? _prettyFileUrlLabel(b.path) : (b.name||'(untitled)');
                const id = await choiceModal({ title:'外部削除検出', detail:`このファイルはsixの外部で削除されました。保存しますか？\n${label}`,
                  buttons:[{id:'save',label:'保存',primary:true},{id:'cancel',label:'キャンセル'}] });
                if (id==='save'){
                  const textData = _normalizeTextForSaveInternal((idx===currentIdx && editor)? (editor.value||'') : (b.text||''));
                  const r = await _saveToURLWithExternalCheck(b, b.path, textData);
                  if (r && r.status==='saved'){ try{ b._externalDeleteIgnored=false; b._externalDeleteRecoveredAt=Date.now();
                    const txt2 = (idx===currentIdx && editor)? (editor.value||'') : (b.text||'');
                    b.text = txt2; b.savedText = txt2; b._savedTick = (b._changeTick|0); b.modified = false;
                    toast('保存しました');
                    _setTitle && _setTitle(); _renderTabbar && _renderTabbar();
                  }catch{} }
                } else {
                  b._externalDeleteIgnored = true;
                  toast('外部削除を検出: キャンセルしました', 2000);
                }
              }catch{}
            }
          }
        }catch{}
        return; /* throttle branch exit */
      }
      b._extLastCheckAt = now;
      if (b._checkingExternal){ /* [ext-check] already-checking log removed */ return; }
      /* [ext-check] invoke log removed */
      b._checkingExternal = true;
      (async()=>{
  let meta = await _statFileMeta(b.path);
  /* [ext-check] start log removed */
        try{ b._checkingExternal=false; }catch{}
        // メタが取れない場合でも、キャッシュを捨てて1回だけ即再試行（短期エラーの吸収）
        if (!meta){
          /* [ext-check] miss meta log removed */
          try{
            const parent = _dirnameURL(b.path);
            const key = (function(){ try{ return _ensureSlash(parent)?.toString()||null; }catch{ return null; } })();
            if (key && _dirCache && _dirCache.delete){ _dirCache.delete(key); }
          }catch{}
          try{ meta = await _statFileMeta(b.path); }catch{}
          if (!meta) return;
        }
        const { mtime, size } = meta;
        if (!(typeof b._extMtime === 'number') || !(typeof b._extSize === 'number')){
          // baseline 未設定時: modified=falseなら取得できた数値のみ反映
          if (!b.modified){
            if (typeof mtime === 'number') b._extMtime = mtime;
            if (typeof size  === 'number') b._extSize  = size;
            /* [ext-check] baseline init log removed */
          }
          return;
        }
        // いずれかの差分で変更と判断（どちらか一方のみ取得できるFSも想定）
        const changed = (typeof mtime==='number' && mtime !== b._extMtime) || (typeof size==='number' && size !== b._extSize);
  /* [ext-check] compare log removed */
        if (!changed) return;
        const label = b.path ? _prettyFileUrlLabel(b.path) : (b.name||'(untitled)');
        const detail = b.modified
          ? `このファイルは外部で編集されたようです。未保存の編集を破棄して読み込みますか？\n${label}`
          : `このファイルは外部で編集されたようです。読み込みますか？\n${label}`;
        const id = await choiceModal({ title:'外部変更検出', detail, buttons:[{id:'reload',label:'読み込み直す',primary:true},{id:'ignore',label:'無視'}] });
        if (id==='reload'){
          await _loadFromPath(b.path, null, { mode:'replace' });
          try{
            const after = currentBuffer();
            if (after===b && !after.modified){
              // リロード直後はキャッシュを捨ててメタを再取得
              try{ const parent = _dirnameURL(b.path); const k = (function(){ try{ return _ensureSlash(parent)?.toString()||null; }catch{ return null; } })(); if (k && _dirCache && _dirCache.delete){ _dirCache.delete(k); } }catch{}
              const meta2 = await _statFileMeta(b.path);
              if (meta2){
                if (typeof meta2.mtime === 'number') b._extMtime = meta2.mtime;
                if (typeof meta2.size  === 'number') b._extSize  = meta2.size;
              }
              b._externalChangeIgnored=false;
              /* [ext-check] baseline after reload log removed */
            }
          }catch{}
          toast('reloaded');
        } else if (id==='ignore') {
          b._externalChangeIgnored = true;
          /* [ext-check] ignored log removed */
          toast('外部変更を検出: 保存時に警告します', 2000);
        }
      })();
    }catch{}
  }

  // Close current buffer (tab). If no buffers remain, exit app.
  function _closeCurrentBuffer(){
    try{
      if (!(currentIdx>=0 && currentIdx<buffers.length)) return;
      const removedIndex = currentIdx;
      buffers.splice(removedIndex, 1);
      // Persist removal so closed buffers do not resurrect on next launch
      try{ _schedulePersist('close-buffer'); }catch{}
      if (buffers.length === 0){
        // No buffers left → exit immediately (persist cleared session)
        try{ _persistSessionNow(); }catch{}
        _quittingAll = true; window.close();
        return;
      }
      const nextIndex = Math.min(removedIndex, buffers.length - 1);
      // Force switch even when nextIndex equals previous currentIdx (tab array shifted by splice)
      // Avoid early-return path in _switchToBuffer that skips when i===currentIdx.
      currentIdx = -1;
      _switchToBuffer(nextIndex);
    }catch{}
  }

  // Close buffer at specific index without forcing switch unless necessary
  function _closeBufferAt(index){
    try{
      if (!(index>=0 && index<buffers.length)) return;
      const removedIndex = index;
      const removingCurrent = (removedIndex === currentIdx);
      buffers.splice(removedIndex, 1);
      try{ _schedulePersist('close-buffer'); }catch{}
      if (buffers.length === 0){
        try{ _persistSessionNow(); }catch{}
        _quittingAll = true; window.close();
        return;
      }
      if (removingCurrent){
        const nextIndex = Math.min(removedIndex, buffers.length - 1);
        currentIdx = -1; // force switch
        _switchToBuffer(nextIndex);
      } else {
        // If current index was after removed, shift left by one
        if (currentIdx > removedIndex){ currentIdx = currentIdx - 1; }
        // reflect tabbar update for non-current removal
        try{ _renderTabbar && _renderTabbar(); }catch{}
      }
    }catch{}
  }

  // Enter/Tab 確定統合（:e ファイルポップアップ用）
  function _confirmFilePopupSelection(){
    try{
      if (!_filePopupVisible()) return false;
      const list = _filePopupComputeList();
      if (list.length === 0){
        const q = (_fileFilter||'').trim();
        if (!q) return true;
        // UNC配下での部分入力時（例: //wsl.localhost/Ubuntu/ + "hom"）は、新規バッファを開かずフィルタ継続
        try{
          const uBase = _ensureSlash(_fileBaseURL);
          const underUnc = !!(uBase && uBase.protocol==='file:' && uBase.host);
          const looksPartialSeg = /^[^\\/:*?"<>|]+$/.test(q);
          if (underUnc && looksPartialSeg){
          // Additional processing can be added here if needed
            return true;
          }
        }catch{}
        if (q === '..'){
          // 親へ移動（フィルタは使わず、入力欄は末尾セグメントを残した表示に）
          try{
            _fileReflectGuardUntil = Date.now() + 700;
            const parent = _ensureSlash(new URL('../', _fileBaseURL));
            // 末尾セグメント（元いたフォルダ名）を抽出
            let s = (_fileTypedDirRaw||'').replace(/\\/g,'/').replace(/\/+$/,'');
            const idx = s.lastIndexOf('/');
            const prevSeg = (idx>=0 ? s.slice(idx+1) : s);
            // 親一覧で直前セグメントをハイライトするため保持
            _filePostSelectName = prevSeg || null;
            // 入力側の新しいディレクトリ表記（空の場合はURLから絶対表記を生成）
            let newTypedRaw = (idx>=0? s.slice(0,idx+1) : '');
            if (!newTypedRaw){ try{ newTypedRaw = _inputDirRawFromURL(parent); }catch{ newTypedRaw=''; } }
            _fileBaseURL = parent; _fileTypedDirRaw = newTypedRaw; _fileFilter='';
            // 仕様 #349: 親ディレクトリへ移動したタイミングで、入力欄の ".../foo/.." を ".../foo" に正規化して表示更新
            try{
              if (cmdinput){
                cmdinput.value = ':e ' + _collapseDotDotPath(String(newTypedRaw||'') + String(prevSeg||''));
                const pos=(cmdinput.value||'').length; try{ cmdinput.setSelectionRange(pos,pos); }catch{}
                try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
              }
            }catch{}
            const parentNow = _ensureSlash(_fileBaseURL);
            if (parentNow && _isHostRoot(parentNow)){
              // 親がホスト直下: 入力は //host/ に置換し、shares を再読込（".." は非表示）。選択は直前セグメント名に。
              _fileTypedDirRaw = '//' + parentNow.host + '/'; _fileFilter=''; _filePopupNoUp = true;
              _fileEntries = []; _fileSel = 0; _fileLoading = true; if (_filePopupVisible()) _filePopupRender();
              _loadSharesForHost(parentNow.host, prevSeg).finally(()=>{
                // 仕様 #348: 一覧走査の完了タイミングでは入力欄へ反映しない
              });
            } else {
              const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
              _listDirEntriesWithQuickRetry(_fileBaseURL).then(list2=>{
                try{
                  const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                  if (!reqKey || curKey===reqKey){
                    _fileEntries = Array.isArray(list2) ? list2 : [];
                    if (Array.isArray(list2) && list2.length>0){ _fileStableEntries = list2.slice(); _fileStableBaseKey = curKey; }
                    // Prefer selecting the previous folder (directory) in the parent listing
                    let sel = 0; const idx2 = _fileEntries.findIndex(e=> e && e.isDir && e.name===prevSeg); if (idx2>=0) sel = idx2 + (_filePopupNoUp?0:1); _fileSel = sel;
                  }
                }catch{}
                _filePopupRender();
              }).finally(()=>{ /* #348: listing completion should not reflect to input */ });
            }
            return true;
          }catch{}
        }
        // 入力をそのまま開く
        (async()=>{
          const ok = await _loadFromPath(q, _fileBaseURL, { silentOnFail:true, mode:'new' });
          if (!ok){ let finalURL = null; try{ finalURL = new URL(q, _fileBaseURL).toString(); }catch{} _addBuffer({ name: q, path: finalURL, text: '', modified:false }); _switchToBuffer(buffers.length-1); }
          _filePopupHide(); _bufPopupHide(); _setMode('NORMAL'); cmdinput.value=''; setTimeout(()=>editor.focus(),0);
        })();
        return true;
      }
      const sel = Math.max(0, Math.min(list.length-1, _fileSel));
      const it = list[sel];
      // まず無効名は確定させずトーストを出す（ポップアップは維持）
      if (it && it._disabled){ try{ toast('Windows(NTFS)では無効な名前のため開けません', 1800); }catch{} try{ _triggerVisualBell && _triggerVisualBell(); }catch{} return true; }
      if (it.isDir){
        // ポップアップは補完専用: 入力欄を更新し、あとは input ハンドラに任せる
        try{
          const nextBase = _ensureSlash(new URL(it.url, _fileBaseURL));
          _fileJustNavAt = Date.now(); _fileReflectGuardUntil = Date.now() + 700;
          _fileNavRetryCount = 0; // 遷移直後の短期リトライを毎回リセット
          _fileTypedDirRaw = it._up
            ? (function(){
                // 表示上は 1 段戻す
                    let s = (_fileTypedDirRaw||'').replace(/\\/g,'/').replace(/\/+$/,'');
                    const idx = s.lastIndexOf('/');
                    if (!s){
                      // 入力欄に基底パスが無い場合、URL から親ディレクトリの絶対表記を生成
                      return _inputDirRawFromURL(nextBase);
                    }
                    const parent = (idx>=0? s.slice(0,idx+1) : '');
                    return parent;
              })()
            : (function(){
                // ホスト直下（file:////host/）が次ベースの場合は //host/ にする
                try{ if (nextBase && _isHostRoot(nextBase)) return '//' + nextBase.host + '/'; }catch{}
                // 表示名ベース（URL復元優先）で補完
                try{ const u=new URL(String(it&&it.url||'')); const parts=String(u.pathname||'').split('/').filter(Boolean); const nm=decodeURIComponent(parts[parts.length-1]||''); if(nm) return (_fileTypedDirRaw||'') + nm + '/'; }catch{}
                return (_fileTypedDirRaw||'') + (it.name||'') + '/';
              })();
          _fileFilter = '';
          if (cmdinput){
            // 「..」選択時は直前セグメントを表示位置に残しつつ caret を合わせる仕様を維持
            if (it._up){
              // 直前セグメントは baseURL から頑健に取得（子の名前 = 今の base の末尾）
              let prevSeg = '';
              try{
                const b = _ensureSlash(_fileBaseURL);
                let p = decodeURIComponent((b && b.pathname) || '');
                p = p.replace(/\/+$/,'');
                const i2 = p.lastIndexOf('/');
                prevSeg = (i2>=0 ? p.slice(i2+1) : p);
              }catch{}
              // 親へ戻った後、親一覧でこのフォルダをハイライトする
              _filePostSelectName = prevSeg || null;
              cmdinput.value = ':e ' + _collapseDotDotPath(_fileTypedDirRaw + prevSeg);
            } else {
              cmdinput.value = ':e ' + _collapseDotDotPath(_fileTypedDirRaw);
            }
            // 補完は入力欄への貼り付けのみ。即時列挙バイパスキーは設定しない（手入力と同一経路に統一）
            _fileNavPendingKey = null;
            try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
            // サブディレクトリ降下直後の自動補完を次回レンダで実行するためフラグセット（親移動時は除外） (#810)
            try{
              if (!it._up){
                const baseStr = (function(){ try{ return _ensureSlash(nextBase)?.toString()||null; }catch{ return null; } })();
                _fileAutoPrefillOnNextRender = { base: baseStr, typed: String(_fileTypedDirRaw||'') };
              }
            }catch{}
          }
          return true;
        }catch{}
      } else {
        _loadFromPath(it.url, null, {mode:'new'});
      }
      try{
        // 履歴表示も URL 復元名を優先
        let nm = String(it.name||'');
        try{ const u=new URL(String(it&&it.url||'')); const parts=String(u.pathname||'').split('/').filter(Boolean); const dec=decodeURIComponent(parts[parts.length-1]||''); if(dec) nm=dec; }catch{}
        const hist=':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + nm);
        _cmdHistoryMaybePush(hist);
      }catch{}
      _filePopupHide(); _bufPopupHide(); _setMode('NORMAL'); cmdinput.value=''; setTimeout(()=>editor.focus(),0);
      return true;
      }catch{ return false; }
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
    let activeEl = null;
    buffers.forEach((b, i)=>{
      const div = document.createElement('div');
      div.className = 'tab' + (i===currentIdx ? ' active' : '');
      let label = '';
      if (b.path && /^file:\/\//i.test(b.path)){
        // すべてのタブで同一体裁（ファイル名のみ）
        try{ label = _basename(b.path); }catch{ label = (b.name||''); }
      } else {
        label = b.name || '';
      }
      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      const baseText = label || 'untitled';
      // Prefix: 1–8 as <kbd>F{n}</kbd>, 9+ keep circled numerals from _bufferNumberLabel
      try{
        const n = i+1;
        if (n>=1 && n<=8){
          const k = document.createElement('kbd');
          k.textContent = 'F' + String(n);
          // style to match help <kbd> via theme vars
          try{ k.style.background = 'var(--six-kbd-bg, var(--six-help-kbd-bg, rgb(95,143,223)))'; }catch{}
          try{ k.style.color = 'var(--six-kbd-fg, var(--six-help-kbd-fg, #000))'; }catch{}
          try{ k.style.borderRadius = '0.18rem'; k.style.padding = '0 0.22rem'; }catch{}
          nameSpan.appendChild(k);
          nameSpan.appendChild(document.createTextNode(' '));
        } else {
          const numLabel = _bufferNumberLabel(n);
          if (numLabel){ nameSpan.appendChild(document.createTextNode(numLabel + ' ')); }
        }
      }catch{}
      nameSpan.appendChild(document.createTextNode(baseText));
      div.appendChild(nameSpan);
      if (b.modified){ const mod = document.createElement('span'); mod.className='mod'; mod.textContent='*'; div.appendChild(mod); }
  // クリックでフォーカスを奪わない（mousedown 既定動作を抑止）
  div.addEventListener('mousedown', (ev)=>{ ev.preventDefault(); });
  div.addEventListener('click', ()=>{ _switchToBuffer(i); setTimeout(()=>editor.focus(),0); });
      tabbarTabs.appendChild(div);
      if (i===currentIdx) activeEl = div;
    });
    // アクティブタブが隠れていたら手動で可視領域に入るようスクロール
    try{
      if (activeEl){
        const tabsRect = tabbarTabs.getBoundingClientRect();
        const elRect = activeEl.getBoundingClientRect();
        // 可視領域はスクロールボタンを除外した内側領域として計算
        let leftGuard = tabsRect.left;
        let rightGuard = tabsRect.right;
        try{
          if (tabScrollLeftBtn){ const r = tabScrollLeftBtn.getBoundingClientRect(); leftGuard = Math.max(leftGuard, r.right + 2); }
          if (tabScrollRightBtn){ const r = tabScrollRightBtn.getBoundingClientRect(); rightGuard = Math.min(rightGuard, r.left - 2); }
        }catch{}
        const hiddenLeft = elRect.left < leftGuard;
        const hiddenRight = elRect.right > rightGuard;
        if (hiddenLeft){
          const delta = elRect.left - leftGuard - 8;
          tabbarTabs.scrollLeft = Math.max(0, (tabbarTabs.scrollLeft|0) + delta);
        } else if (hiddenRight){
          const delta = elRect.right - rightGuard + 8;
          tabbarTabs.scrollLeft = Math.max(0, (tabbarTabs.scrollLeft|0) + delta);
        }
      }
    }catch{}
    try{ _updateTabScrollButtons(); }catch{}
    try{ _updateEncBtnLabel(); }catch{}
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

  function _fetchTextWithTimeout(url, timeoutMs=2500){
    const ac = (window.AbortController ? new AbortController() : null);
    const to = setTimeout(()=>{ try{ ac && ac.abort(); } catch{} }, timeoutMs);
    const opts = ac ? { signal: ac.signal } : {};
    return fetch(url, opts).then(r=>{ if(!r.ok) throw new Error('fetch fail'); return r.text(); })
      .finally(()=>{ try{ clearTimeout(to); }catch{} });
  }

  function _fetchJSONWithTimeout(url, timeoutMs=5000){
    const ac = (window.AbortController ? new AbortController() : null);
    const to = setTimeout(()=>{ try{ ac && ac.abort(); } catch{} }, timeoutMs);
    const opts = ac ? { signal: ac.signal } : {};
    return fetch(url, opts).then(r=>{ if(!r.ok) throw new Error('fetch fail'); return r.json(); })
      .finally(()=>{ try{ clearTimeout(to); }catch{} });
  }

  // API base injected by launcher via #api=...
  let _apiBase = null;
  // ローカルAPIのサーキットブレーカー（大量の接続拒否スパム回避）
  let _apiDisabledUntil = 0;
  let _apiFailCount = 0;
  function _apiIsEnabled(){ return !!_apiBase && Date.now() > _apiDisabledUntil; }
  function _apiNoteFailure(){ try{ _apiFailCount++; if (_apiFailCount >= 2){ _apiDisabledUntil = Date.now() + 60*1000; try{ console.warn && console.warn('Disabling local API temporarily'); }catch{} } }catch{} }
  function _apiNoteSuccess(){ _apiFailCount = 0; _apiDisabledUntil = 0; }
  function _readApiFromHash(){
    try{
      if (location.hash){
        const h = location.hash.replace(/^#/, '');
        const q = new URLSearchParams(h);
        const a = q.get('api');
        if (a) _apiBase = a.endsWith('/') ? a : (a + '/');
        _apiDisabledUntil = 0; _apiFailCount = 0;
      }
    }catch{}
  }

  // Lightweight reconnect: refresh #api and clear circuit breaker for next attempt
  function _apiQuickReconnect(){
    try{ _readApiFromHash(); }catch{}
    try{ _apiDisabledUntil = 0; _apiFailCount = 0; }catch{}
  }

  async function _loadFromPath(path, baseForRelative, opts={}){
    // 例外が途中で発生しても、本文が読み込めているなら確実にバッファを作成/切替するためのフェイルセーフ
    let urlStr = null;
    let txt; let t;
    let loadedIntoEditor = false;
    try {
      const base = baseForRelative || _htmlBaseURL();
      urlStr = _normalizeToURLString(path, base); // Normalize the URL string
      // file:// は常にローカルAPI /read を優先（文字コード自動判定のため）
      try {
        const uProbe = new URL(urlStr);
        if (_apiIsEnabled() && uProbe.protocol==='file:'){
          const fsPath0 = _fsPathFromFileURL(uProbe);
          if (fsPath0){
            const apiRead0 = _apiBase + 'read?fs=' + encodeURIComponent(fsPath0);
            try{ txt = await _fetchTextWithTimeout(apiRead0, 8000); _apiNoteSuccess(); } catch(e){
              _apiNoteFailure();
              // ネットワーク失敗時は簡易再接続を一度だけ試す
              try{
                const emsg = (e && (e.message||'')) + '';
                if (/Failed to fetch|NetworkError|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH/i.test(emsg)){
                  _apiQuickReconnect();
                  try{ txt = await _fetchTextWithTimeout(apiRead0, 3500); _apiNoteSuccess(); }catch{ /* fall through to other paths */ }
                }
              }catch{}
            }
          }
        }
      } catch { /* no API or URL parse error */ }
      // それでも未取得なら通常経路（XHR/fetch）
      if (txt === undefined){
        // silentOnFail + mode:new のとき、存在しないファイルは正常ケースとみなし空新規バッファ生成へ進む（追加ログ/フォールバック抑止）
        if (opts && opts.silentOnFail && String(opts.mode||'new')==='new'){
          txt = '';
        } else {
          try { txt = await _fetchTextSmart(urlStr); }
          catch(eFetch){
            // 最後の手段として API /read（再試行）
            try{
              const u2 = new URL(urlStr);
              if (_apiIsEnabled() && u2.protocol==='file:' && u2.host){
                const fsPath2 = ('\\\\' + u2.host + decodeURIComponent(u2.pathname).replace(/\//g,'\\'));
                const apiRead2 = _apiBase + 'read?fs=' + encodeURIComponent(fsPath2);
                try{ txt = await _fetchTextWithTimeout(apiRead2, 8000); _apiNoteSuccess(); }catch(e2){ _apiNoteFailure(); throw eFetch; }
              } else {
                throw eFetch;
              }
            } catch(eApi){ throw eFetch; }
          }
        }
      }
      // detect ff + BOM (utf-8 BOM appears as U+FEFF at string start) 既定
      let ff = (txt.indexOf('\r')>=0) ? 'dos' : 'unix';
      let hasBomChar = (txt.length>0 && txt.charCodeAt(0)===0xFEFF);
      t = (hasBomChar ? txt.slice(1) : txt).replace(/\r\n?/g,'\n');
      // Record original final LF before any edits (only on first creation) — #598
      try{ if (opts && opts.mode==='new'){ b && (b._origHadFinalLF = /\n$/.test(String(t||''))); } }catch{}
      // 可能なら /probe で原本の enc/ff/bom を取得
      let encDetected = 'utf-8';
      try{
        const u3 = new URL(urlStr);
        if (_apiIsEnabled() && u3.protocol==='file:'){
          const fs3 = _fsPathFromFileURL(u3);
          if (fs3){
            const info = await _fetchJSONWithTimeout(_apiBase + 'probe?fs=' + encodeURIComponent(fs3), 5000);
            if (info){
              // map encoding
              const encStr = (info.encoding||'').toLowerCase();
              if (encStr.includes('cp932') || encStr.includes('shift') || encStr.includes('sjis')) encDetected = 'shift_jis';
              else encDetected = 'utf-8';
              // eol
              if (info.eol === 'dos' || info.eol === 'unix' || info.eol === 'mac') ff = info.eol;
              // bom (UTF-8のみ考慮)
              if (encDetected==='utf-8' && info.bom===true) hasBomChar = true;
            }
          }
        }
      }catch{}
      const mode = opts.mode || (buffers.length===0 ? 'new' : 'replace');
      if (mode === 'new'){
        const exist = _findBufferByURL(urlStr);
        let targetIdx = -1;
        if (exist >= 0){
          // Switch to existing buffer without disturbing current editor state before switch
          _switchToBuffer(exist);
          targetIdx = exist|0;
        } else {
          // Create buffer first; _switchToBuffer will load its text and keep previous buffer's view saved correctly
          _addBuffer({ name: _basename(path), path: urlStr, text: t, modified:false, enc: encDetected, ff, bom: hasBomChar });
          _switchToBuffer(buffers.length-1);
          targetIdx = (buffers.length-1)|0;
        }
        // Establish external meta baseline on load (new buffer)
        try{
          const bb = buffers[targetIdx];
          if (bb && bb.path && /^file:\/\//i.test(bb.path)){
            bb._externalChangeIgnored = false;
            const meta = await _statFileMeta(bb.path);
            if (meta){
              if (typeof meta.mtime === 'number') bb._extMtime = meta.mtime;
              if (typeof meta.size  === 'number') bb._extSize  = meta.size;
              /* baseline log removed: after new-load */
            } else {
              // Retry once after a short delay; some sources update metadata after read
              try{ setTimeout(async()=>{ try{ const m2=await _statFileMeta(bb.path); if(m2){ if(typeof m2.mtime==='number') bb._extMtime=m2.mtime; if(typeof m2.size==='number') bb._extSize=m2.size; /* baseline log removed: after new-load (delayed) */ try{ _schedulePersist('load-retry'); }catch{} } }catch{} }, 600); }catch{}
            }
            try{ _schedulePersist('load'); }catch{}
          }
        }catch{}
      } else {
        // Replace current buffer content in-place
        const b=currentBuffer();
        if (b){
          b.path = urlStr; b.name = _basename(path); b.text = t; b.savedText = t; b._changeTick=0; b._savedTick=0; b.modified=false; try{ b._undo=[]; b._redo=[]; }catch{}
          try{ b.enc=encDetected; b.ff=ff; b.bom=hasBomChar; }catch{}
          try{ b._origHadFinalLF = /\n$/.test(String(t||'')); }catch{}
          try{
            b._externalChangeIgnored=false;
            const meta = await _statFileMeta(b.path);
              if (meta){
              // 数値が得られた項目のみ更新（nullは書かない）
              if (typeof meta.mtime === 'number') b._extMtime = meta.mtime;
              if (typeof meta.size  === 'number') b._extSize  = meta.size;
              /* baseline log removed: after replace-load */
            } else {
              try{ setTimeout(async()=>{ try{ const m2=await _statFileMeta(b.path); if(m2){ if(typeof m2.mtime==='number') b._extMtime=m2.mtime; if(typeof m2.size==='number') b._extSize=b._extSize||m2.size; /* baseline log removed: after replace-load (delayed) */ try{ _schedulePersist('load-retry'); }catch{} } }catch{} }, 600); }catch{}
            }
            try{ _schedulePersist('load'); }catch{}
          }catch{}
        }
        // Reflect into editor now since we stay on the same buffer
        editor.value = t; loadedIntoEditor = true;
        caretRow = 0; caretCol = 0; editor.scrollTop = 0;
        _centerScrolloffOnce = true; ensureScrolloff({centerOnce:true});
        try{ _repositionCaret(); updateGutter(); }catch{}
      }
      try{ _setTitle(); _renderTabbar(); }catch{}
      return true;
    } catch (e){
      // silentOnFail のときはコンソール出力を抑止（存在しないファイルの新規作成など正常ケース）
      try{ if (!(opts && opts.silentOnFail)) console.error('open failed', e); }catch{}
      // 本文は読み込めている → バッファだけ確実に作り、致命的扱いにしない
      if (loadedIntoEditor){
        try{
          const mode = opts.mode || (buffers.length===0 ? 'new' : 'replace');
          if (mode === 'new'){
            const exist = _findBufferByURL(urlStr||path);
            if (exist >= 0){ _switchToBuffer(exist); }
            else { _addBuffer({ name: _basename(path), path: urlStr||path, text: t||editor.value||'', modified:false }); _switchToBuffer(buffers.length-1); }
          } else {
            const b=currentBuffer(); if (b){ b.path = urlStr||b.path; b.name = _basename(path); b.text = t||editor.value||b.text; b.savedText = b.text; b._changeTick=0; b._savedTick=0; b.modified=false; try{ b._undo=[]; b._redo=[]; }catch{} }
          }
          try{ _setTitle(); _renderTabbar(); }catch{}
          // ユーザーに不要なトーストは出さない
          return true;
        }catch(e2){ /* fallthrough */ }
      }
      if (!opts.silentOnFail) toast('open failed: '+path);
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
          const raw = String(r.result || '');
          const hasBomChar = (raw.length>0 && raw.charCodeAt(0)===0xFEFF);
          const ff = (raw.indexOf('\r')>=0) ? 'dos' : 'unix';
          const txt = (hasBomChar ? raw.slice(1) : raw).replace(/\r\n?/g,'\n');
          editor.value = txt;
          caretRow = 0; caretCol = 0; editor.scrollTop = 0;
          _centerScrolloffOnce = true; ensureScrolloff({centerOnce:true});
          _repositionCaret(); updateGutter();
          const mode = opts.mode || (buffers.length===0 ? 'new' : 'replace');
          if (mode === 'new'){
            _addBuffer({ name: f.name, path: null, text: txt, modified:false, enc:'utf-8', ff, bom: hasBomChar });
          } else {
            const b=currentBuffer(); if (b){ b.path = null; b.name = f.name; b.text = txt; b.savedText = txt; b._changeTick=0; b._savedTick=0; b.modified=false; b.enc='utf-8'; b.ff=ff; b.bom=hasBomChar; }
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
    if (api) { try{ _apiBase = api.endsWith('/') ? api : (api + '/'); }catch{} }
    // Guard: If doc is actually a launcher switch (e.g. -Diag) treat as absent so we fall back to session restore.
    try{
      const knownSwitches = ['-Diag','-AllowMulti','-DevInsecure','-ResetProfile','-KeepOpen','-ShowUrl','-WaitMinutes','-Html','-InstanceTag'];
      if (doc && knownSwitches.indexOf(doc) >= 0){ doc = null; name = null; dataB64 = null; }
    }catch{}
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
            let docIt  = it && it.doc  || null;
            // six.ps1 は相対のまま渡すことがあるので _six.html の場所に対して解決
            try { if (docIt && !/^([a-z][a-z0-9+.-]*:)/i.test(docIt)) { docIt = new URL(docIt, _htmlBaseURL()).toString(); } } catch {}
            let t = '';
            if (it && typeof it.data === 'string' && it.data.length){
              try { t = new TextDecoder('utf-8').decode(Uint8Array.from(atob(it.data), c=>c.charCodeAt(0))); } catch{}
            } else if (docIt) {
              try { t = await _fetchTextSmart(docIt); } catch { t = ''; }
            }
            const raw = String(t||'');
            const ff = (raw.indexOf('\r')>=0) ? 'dos' : 'unix';
            const hasBomChar = (raw.length>0 && raw.charCodeAt(0)===0xFEFF);
            const norm = (hasBomChar ? raw.slice(1) : raw).replace(/\r\n?/g,'\n');
            _addBuffer({ name: nameIt, path: docIt, text: norm, modified:false, enc:'utf-8', ff, bom: hasBomChar });
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
    const ff = (txt.indexOf('\r')>=0) ? 'dos' : 'unix';
    const hasBomChar = (bin.length>=3 && bin[0]===0xEF && bin[1]===0xBB && bin[2]===0xBF);
    const t = (hasBomChar ? txt.slice(1) : txt).replace(/\r\n?/g,'\n');
    editor.value = t;
    if (buffers.length===0){ _addBuffer({ name: name||null, path: doc||null, text: t, modified:false, enc:'utf-8', ff, bom: hasBomChar }); }
  else { const b=currentBuffer(); b.name = name||b.name; b.path = doc||b.path; b.text = t; b.savedText = t; b._changeTick=0; b._savedTick=0; b.modified=false; b.enc='utf-8'; b.ff=ff; b.bom=hasBomChar; }
    _setTitle(); _renderTabbar();
    // Ensure initial view is at top (avoid unintended 'G'-like position)
    try{
      caretRow=0; caretCol=0; editor.scrollTop=0; _centerScrolloffOnce=false;
      _scrollGuardUntil = Date.now() + 800; // 初期描画直後の再配置を抑止
      _repositionCaret(); updateGutter();
      setTimeout(()=>{ try{ caretRow=0; caretCol=0; editor.scrollTop=0; _repositionCaret(); updateGutter(); }catch{} }, 0);
    }catch{}
        return Promise.resolve(true);
      } catch { /* fallthrough */ }
    }
  if (!doc) return Promise.resolve(false);
  // Resolve doc relative to _six.html base when not absolute
  try { if (doc && !/^([a-z][a-z0-9+.-]*:)/i.test(doc)) { doc = new URL(doc, _htmlBaseURL()).toString(); } } catch {}
  return _fetchTextSmart(doc).then(txt=>{
    const ff = (txt.indexOf('\r')>=0) ? 'dos' : 'unix';
    const hasBomChar = (txt.length>0 && txt.charCodeAt(0)===0xFEFF);
    const t = (hasBomChar ? txt.slice(1) : txt).replace(/\r\n?/g,'\n');
    editor.value = t;
    if (buffers.length===0){ _addBuffer({ name: name||null, path: doc||null, text: t, modified:false, enc:'utf-8', ff, bom: hasBomChar }); }
  else { const b=currentBuffer(); if(name) b.name = name; b.path = doc; b.text = t; b.savedText = t; b._changeTick=0; b._savedTick=0; b.modified=false; b.enc='utf-8'; b.ff=ff; b.bom=hasBomChar; }
    _setTitle(); _renderTabbar();
      try{
        caretRow=0; caretCol=0; editor.scrollTop=0; _centerScrolloffOnce=false; _scrollGuardUntil = Date.now() + 800;
        _repositionCaret(); updateGutter();
        setTimeout(()=>{ try{ caretRow=0; caretCol=0; editor.scrollTop=0; _repositionCaret(); updateGutter(); }catch{} }, 0);
      }catch{}
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
    // Measure the actual text area height (textarea), not the wrapper,
    // to keep visible-lines count consistent with what the user sees.
    let h = editor.clientHeight || viewport.clientHeight;
    if (_needsHScrollReserve()) h -= HSCROLL_RESERVE;
    const raw = h / LINE_HEIGHT;
    // Prefer rounding to nearest line to avoid off-by-one jitter
    const lines = Math.max(1, Math.round(raw));
    // Wrapper padding adjustment is unnecessary since scrolling is on the textarea
    try{ if (viewport && viewport.style) viewport.style.paddingBottom = '0px'; }catch{}
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
    // Subpixel remainder between scrollTop and line-height (e.g., due to DPI/zoom)
    // Align overlays (stripe/caret) with the text by canceling the remainder via translateY.
    // IMPORTANT: Use floor, not round. We define the logical top line with Math.floor(scrollTop/LINE_HEIGHT)+1
    // so using round here could introduce a negative half-line remainder after gg/G/k causing a visual gap (#470).
    // By flooring consistently we always translate relative to the same grid origin used by _topLine()/ensureScrolloff.
    let rem = 0;
    try{
      const st = (editor.scrollTop||0);
      rem = st - Math.floor(st/LINE_HEIGHT)*LINE_HEIGHT;
      // Guard against tiny negative floating residues (e.g., -0.5px at certain zoom ratios)
      if (Math.abs(rem) < 0.01) rem = 0;
    }catch{}
    if (topPx >= 0 && topPx < viewport.clientHeight) {
      edstripe.style.display='';
      edstripe.style.top = topPx + 'px';
      edstripe.style.height = LINE_HEIGHT + 'px';
      // INSERT時はアクティブ行のグラデ色を切り替える (#437)
      try{
        if (_mode === 'INSERT'){
          // Use CSS vars so values are centralized and fallback is consistently yellow
          edstripe.style.background = 'linear-gradient(to bottom, var(--activeEditLineGradStart, yellow), var(--activeEditLineGradEnd, yellow))';
        } else {
          edstripe.style.background = '';
        }
      }catch{}
      // apply remainder compensation to stripe
      try{ edstripe.style.transform = (Math.abs(rem) > 0.01) ? `translateY(${-rem}px)` : ''; }catch{}
    } else {
      edstripe.style.display='none';
      try{ edstripe.style.transform = ''; }catch{}
    }

    // caret rectangle (column) using text measurement for monospace
    let caret = caretLayer.querySelector('.caret');
    if (!caret){
      caret = document.createElement('div');
      caret.className = 'caret';
      caretLayer.appendChild(caret);
    }
    // INSERT時はcaretグラデ色を置き換え（なければ黄色） (#437)
    try{
      if (_mode === 'INSERT'){
        // Use CSS vars so theme changes reflect immediately and fallback stays yellow
        caret.style.setProperty('--caretGradStart', 'var(--editCaretGradStart, yellow)');
        caret.style.setProperty('--caretGradMid',   'var(--editCaretGradMid, yellow)');
      } else {
        // non-INSERT: restore baseline (no yellow fallback here; baseline must exist)
        if (_caretGradStartBase) caret.style.setProperty('--caretGradStart', _caretGradStartBase);
        if (_caretGradMidBase)   caret.style.setProperty('--caretGradMid', _caretGradMidBase);
      }
    }catch{}
    const lines = _splitLines();
    const line = lines[caretRow] || '';
    // Expand tabs using pixel-based tab stops (columns measured in space-width units) (#507)
    // This keeps overlay caret aligned with the textarea's native rendering even after full-width chars.
    const _expandTabs = (s)=>{
      if (!s || s.indexOf('\t')===-1) return s;
      // tabstop from SIX_OPTIONS (default 8, min 1)
      let _ts = 8; try{ const tsRaw = (window && window.SIX_OPTIONS && window.SIX_OPTIONS.tabstop); const ts = parseInt(tsRaw,10); if (ts && ts>0) _ts = ts; }catch{}
      // measure a single space advance (column width baseline)
      _measureSpan.textContent = ' ';
      const spaceW = _measureSpan.getBoundingClientRect().width || 1;
      let out = '';
      let x = 0; // accumulated pixel width so far
      for (let i=0;i<s.length;i++){
        const ch = s[i];
        if (ch==='\t'){
          // current column in space widths
          const col = Math.floor((x / spaceW) + 1e-6);
          const spaces = _ts - (col % _ts);
          out += ' '.repeat(spaces);
          x += spaces * spaceW;
        } else {
          out += ch;
          x += _charWidth(ch);
        }
      }
      return out;
    };
    // Helper: read half/full-width reference widths
    const _measureRefWidths = ()=>{
      _measureSpan.textContent = 'W';
      const halfW = _measureSpan.getBoundingClientRect().width || 1;
      _measureSpan.textContent = '\u3000'; // IDEOGRAPHIC SPACE
      const fullW = _measureSpan.getBoundingClientRect().width || (halfW*2);
      return { halfW, fullW };
    };
    const { halfW: _halfRefW, fullW: _fullRefW } = _measureRefWidths();
    const _charWidth = (ch)=>{
      try{
        if (!ch) return _halfRefW;
        _measureSpan.textContent = ch;
        const w = _measureSpan.getBoundingClientRect().width;
        return (w && w>0) ? w : (_isFullwidth(ch) ? _fullRefW : _halfRefW);
      }catch{ return _halfRefW; }
    };
    const _isHangablePunct = (ch)=> /[\u3001\u3002\uFF0C\uFF0E]/.test(ch||'');
    const _isFullwidth = (ch)=> /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\u3000-\u303F\uFF01-\uFF60\uFFE0-\uFFE6]/.test(ch||'');
    // Primary width measurement up to caretCol
  // Expand tabs before measurement to avoid mid-tab caret mis-centering
  _measureSpan.textContent = _expandTabs(line.slice(0, Math.max(0, caretCol)));
    let x = _measureSpan.getBoundingClientRect().width; // px
    // If the tail just before caret consists of hangable CJK punctuation (e.g., '、、' '。'),
    // some fonts may apply hanging/kerning so substr width does not grow. Recompute locally.
    try{
      let k = Math.max(0, caretCol-1);
      while (k>=0 && _isHangablePunct(line[k])) k--;
      const clusterStart = k+1;
      if (clusterStart < caretCol){
        // width before the cluster via direct measure
        _measureSpan.textContent = line.slice(0, clusterStart);
        const baseX = _measureSpan.getBoundingClientRect().width || 0;
        let sum = 0;
        for (let i=clusterStart; i<caretCol; i++){
          sum += _charWidth(line[i]);
        }
        x = baseX + sum;
      }
    }catch{}
  // Make caret height match the full line box
  caret.style.top = topPx + 'px';
  caret.style.height = Math.max(1, Math.round(LINE_HEIGHT)) + 'px';
    // Determine character box width at caret (full-width aware), then shrink to 90%
    let chW = 0;
    if (caretCol < line.length){
      // width of the next character box
  _measureSpan.textContent = _expandTabs(line.slice(0, caretCol+1));
      const x2 = _measureSpan.getBoundingClientRect().width;
      chW = Math.max(0, x2 - x);
      if (!(chW>0)){
        // fallback to per-char width (e.g., hanging punctuation cluster)
        chW = _charWidth(line[caretCol]||'');
      }
    } else {
      // at EOL: use half-width box width (measure with 'W')
  _measureSpan.textContent = 'W';
      chW = _measureSpan.getBoundingClientRect().width;
    }
    // Guard: if measurement collapsed (e.g., hanging punctuation), fallback by character class
    if (!(chW > 0)){
      const ch = line[caretCol] || '';
      chW = _charWidth(ch);
    }
    // Additional guard: tiny width due to kerning → treat as full-width for CJK punctuation
    try{
      const ch = line[caretCol] || '';
      if (_isHangablePunct(ch) && chW < _halfRefW*0.6){ chW = Math.max(_charWidth(ch), _halfRefW); }
    }catch{}
    const cw = Math.max(1, Math.round(chW * 0.9));
    try{ caret.style.setProperty('--caretWidth', cw + 'px'); }catch{}
    // Auto horizontal scroll to keep caret visible in NORMAL/VISUAL (水平ホイール直後ガード中は抑止) (#868)
    try{
      if ((_mode === 'NORMAL' || _mode === 'VISUAL') && (Date.now() > _userHScrollGuardUntil)){
        const gw = (gutter && gutter.clientWidth) ? gutter.clientWidth : 0;
        const visW = Math.max(0, (viewport && viewport.clientWidth ? viewport.clientWidth : 0) - gw);
        let hscroll = (editor && typeof editor.scrollLeft === 'number') ? (editor.scrollLeft|0) : 0;
        const margin = Math.max(4, Math.round(FONT_SIZE * 0.6));
        const caretXInView = x - hscroll;
        const rightLimit = visW - Math.max(4, cw) - margin;
        let nextScroll = hscroll;
        if (caretXInView < margin){
          nextScroll = Math.max(0, Math.round(x - margin));
        } else if (caretXInView > rightLimit){
          nextScroll = Math.max(0, Math.round(x - rightLimit));
        }
        if (nextScroll !== hscroll){
          try{ editor.scrollLeft = nextScroll; }catch{}
        }
      }
    }catch{}
    // Position caret X adjusted by current horizontal scroll
    try{ let _hs = 0; try{ _hs = (editor.scrollLeft||0); }catch{} caret.style.left = (x - _hs) + 'px'; }catch{}
    // Apply the same remainder compensation to caret overlay container
  // NOTE: caretLayer transform remainder must use the same floor-based remainder as edstripe (rem computed above)
  try{ caretLayer.style.transform = (Math.abs(rem) > 0.01) ? `translateY(${-rem}px)` : ''; }catch{}
    // Detect caret movement (row/col change) and hide mouse cursor accordingly
    try{
      const moved = (caretRow !== _lastCaretRow) || (caretCol !== _lastCaretCol);
      if (moved){
        // Skip initial bootstrap comparison to avoid hiding once at startup
        if (!(_lastCaretRow === -1 && _lastCaretCol === -1)){
          // caret moved; any auto-completion handled in file popup render logic
        }
      }
    }catch{}
    // keep hlsearch overlay in sync with caret/scroll
    _renderHlMatchesVisible();
    // Persist caret (and current viewport) to the active buffer so its view state
    // survives a tab switch even if no scroll event occurs yet (#358)
    try{
      const b = currentBuffer();
      if (b){
        b.viewRow = caretRow|0; b.viewCol = caretCol|0;
        // Use current scrollTop (snapped by scheduleScrollRender soon after)
        b.viewScrollTop = (editor.scrollTop||0)|0;
      }
    }catch{}
    // Keep position indicator up-to-date for all caret moves
    try{ _updatePosInfo(); }catch{}
    // Floating command bar reposition if visible
    try{ if (cmdfloat && _mode==='CMD' && cmdfloat.style.display!=='none'){ _positionCmdFloat(); } }catch{}
  }

  // ---- Buffer/text helpers for editing ----
  // mark current buffer as edited (bump change tick and recompute modified flag)
  function _touchBufferModified(){
    try{
      const b=currentBuffer();
      if (b){
        const now = String(editor.value||'');
        b.text = now;
        b._changeTick = ((b._changeTick|0) + 1)|0;
        b.modified = ((b._changeTick|0) !== (b._savedTick|0));
      }
      // Any text edit (including programmatic via commands) hides mouse cursor
      _hideCursor();
      _setTitle(); _renderTabbar();
      // Persist session after modifications (debounced)
      _schedulePersist('modify');

      // After line deletions near EOF, browser layout timing can leave scrollTop at a half-line
      // value momentarily, showing a "leading half-row" at the top (#436). Detect line count
      // reductions and, when near EOF, floor-snap scrollTop now and on next frame.
      try{
        const prevLines = (_lastLinesForSnap|0);
        const curLines = Math.max(1, _totalLines()|0);
        _lastLinesForSnap = curLines;
        if (curLines < prevLines){
          // Only act when viewport is at/near the tail page or caret is at EOF
          const vis = Math.max(1, _visibleLinesExact()|0);
          const topLine1 = Math.max(1, _topLine()|0);
          const baseMaxTop = Math.max(1, curLines - vis + 1);
          const nearBottom = (topLine1 >= (baseMaxTop - 1));
          const atEOF = ((caretRow+1) >= curLines);
          if (nearBottom || atEOF){
            const floorSnap = ()=>{
              try{
                const st = (editor && typeof editor.scrollTop==='number') ? (editor.scrollTop|0) : 0;
                const lh = (typeof LINE_HEIGHT==='number' && LINE_HEIGHT>0) ? LINE_HEIGHT : 20;
                const flo = Math.floor(st / lh) * lh;
                if (Math.abs(flo - st) > 0.1){ editor.scrollTop = flo; }
                _repositionCaret(); updateGutter();
              }catch{}
            };
            floorSnap();
            if (window.requestAnimationFrame){ requestAnimationFrame(()=>{ floorSnap(); }); }
          }
        }
      }catch{}
    }catch{}
  }
  function _syncModifiedFromTick(){
    try{
      const b=currentBuffer();
      if (b){
        b.text = String(editor.value||'');
        b.modified = ((b._changeTick|0) !== (b._savedTick|0));
      }
      _setTitle(); _renderTabbar();
    }catch{}
  }
  // Convert between (row,col) and absolute offset in editor.value
  function _offsetFromRC(r,c){
    try{
      const lines = _splitLinesRaw(); // (#607) 改行列を忠実に扱う
      let rr = Math.max(0, Math.min(lines.length-1, r|0));
      let cc = Math.max(0, Math.min((lines[rr]||'').length, c|0));
      let off = 0;
      for (let i=0;i<rr;i++){ off += (lines[i]||'').length + 1; }
      off += cc;
      return off;
    }catch{ return 0; }
  }
  function _rcFromOffset(off){
    try{
      let o = Math.max(0, off|0);
      const lines = _splitLinesRaw(); // (#607)
      for (let r=0;r<lines.length;r++){
        const len = (lines[r]||'').length;
        if (o <= len){ return { r, c: o }; }
        o -= (len + 1);
      }
      // clamp to EOF
      const last = Math.max(0, lines.length-1);
      return { r: last, c: (lines[last]||'').length };
    }catch{ return { r:0, c:0 }; }
  }
  function _getShiftWidth(){
    try{ const b=currentBuffer(); const sw = Number.isFinite(b&&b.shiftwidth)? (b.shiftwidth|0) : 4; return Math.max(1, sw); }catch{ return 4; }
  }
  function _applyIndentRange(rs, re, units){
    // units>0: indent by units*shiftwidth spaces; units<0: outdent by removing up to units*shiftwidth leading spaces
    const s = String(editor.value||'');
    const raw = _splitLinesRaw();
    const last = raw.length - 1;
    const hasFinalLF = s.endsWith('\n');
    const maxIdx = hasFinalLF && raw[last]==='' ? Math.max(0, last-1) : last;
    if (maxIdx < 0) return;
    let r1 = Math.max(0, Math.min(maxIdx, rs|0));
    let r2 = Math.max(0, Math.min(maxIdx, re|0));
    if (r2 < r1){ const t=r1; r1=r2; r2=t; }
    const sw = _getShiftWidth();
    const add = Math.max(0, (units>0? units:0)|0) * sw;
    const del = Math.max(0, (units<0? -units:0)|0) * sw;
    const buf = raw.slice();
    let changed = false;
    for (let r=r1; r<=r2; r++){
      const line0 = String(buf[r]||'');
      // 空行は対象に含むが変更は行わない
      if (line0.length === 0) continue;
      // 行頭の連続TABは保持し、その直後からインデント増減を適用
      const m = line0.match(/^\t+/);
      const tabs = m ? m[0] : '';
      const rest0 = line0.slice(tabs.length);
      let lineNew = line0;
      if (add>0){
        // TAB直後にスペースを挿入
        lineNew = tabs + ' '.repeat(add) + rest0;
      } else if (del>0){
        // TAB直後のスペースを最大 del まで削除（TABは削らない）
        let k=0; const n=Math.min(del, rest0.length);
        while (k<n && rest0.charCodeAt(k)===0x20) k++;
        lineNew = tabs + rest0.slice(k);
      }
      if (lineNew !== line0){ buf[r] = lineNew; changed = true; }
    }
    if (changed){
      // 1回のインデント操作を単一のUndoに
      _pushUndoSnapshot('indent');
      const out = buf.join('\n');
      if (out !== s){ editor.value = out; _touchBufferModified(); }
    }
    _afterTextMutation();
  }
  function _syncNativeSelectionToCaret(){
    try{
      const off = _offsetFromRC(caretRow, caretCol);
      editor.setSelectionRange(off, off);
    }catch{}
  }
  function _updateVisualSelection(){
    if (!_visualActive){ _syncNativeSelectionToCaret(); return; }
    try{
      if (_visualLinewise){
        const rs = Math.min(_visualAnchorR, caretRow);
        const re = Math.max(_visualAnchorR, caretRow);
        const sOff = _offsetFromRC(rs, 0);
        const eOff = _offsetFromRC(re, (_splitLines()[re]||'').length);
        editor.setSelectionRange(sOff, eOff);
      } else {
        const sOff = _offsetFromRC(_visualAnchorR, _visualAnchorC);
        const eOff = _offsetFromRC(caretRow, caretCol);
        if (sOff <= eOff) editor.setSelectionRange(sOff, eOff); else editor.setSelectionRange(eOff, sOff);
      }
    }catch{}
  }
  function _enterVisual(linewise){
    _visualActive = true; _visualLinewise = !!linewise;
    _visualAnchorR = caretRow; _visualAnchorC = caretCol;
    _setMode('VISUAL');
    _updateVisualSelection();
  }
  function _exitVisual(){
    _visualActive = false; _visualLinewise = false;
    _setMode('NORMAL');
    _syncNativeSelectionToCaret();
    // Ensure any CMD-time visual overlay is cleared when leaving VISUAL
    try{ _visCmdActive = false; _cmdFromVisual = false; _visSelClear(); }catch{}
  }
  function _hasAnyModifiedBuffers(){
    try{
      for (let i=0;i<buffers.length;i++){ const b=buffers[i]; if (b && b.modified) return true; }
      return false;
    }catch{ return false; }
  }
  // ---- Undo/Redo ----
  const UNDO_LIMIT = 200;
  function _currentStacks(){ const b=currentBuffer(); return b ? b : null; }
  function _clampCaret(){
    try{
      const raw=_splitLinesRaw();
      if (raw.length===0){ caretRow=0; caretCol=0; return; }
      if (caretRow<0) caretRow=0; if (caretRow>raw.length-1) caretRow=raw.length-1;
      const maxCol=(raw[caretRow]||'').length;
      if (caretCol<0) caretCol=0; if (caretCol>maxCol) caretCol=maxCol;
    }catch{}
  }
  function _afterTextMutation(){
    // 強制同期順序: CaseA/B の EOF 削除/undo 直後に表示が旧状態で残る問題 (#614)
    // 1) caret を raw でクランプ
    try{ _clampCaret(); }catch{}
    // 2) ネイティブ selection を先に caret に合わせる (末尾 phantom 空行判定に利用されるため)
    try{ _syncNativeSelectionToCaret(); }catch{}
    // 3) スクロール補正と caret overlay 再配置
    try{ ensureScrolloff(); }catch{}
    try{ _repositionCaret(); }catch{}
    // 4) ガター更新前に listchars を一度クリアし再描画 (旧末尾行残留対策)
    try{ _renderListChars(); }catch{}
    // 5) ガター更新と二度目の listchars 再描画（caret オーバーレイ位置確定後の最終状態）
    try{ updateGutter(); }catch{}
    try{ _renderListChars(); }catch{}
  }
  function _makeSnapshot(){
    const b=currentBuffer();
    const txt = String(editor.value||'');
    return { text: txt, caretRow, caretCol, scrollTop: (editor.scrollTop||0), changeTick: (b? (b._changeTick|0) : 0), enc: (b? b.enc : 'utf-8'), ff: (b? b.ff : 'unix'), bom: (b? !!b.bom : false) };
  }
  function _pushUndoSnapshotObj(kind, snap){
    try{
      const st=_currentStacks(); if (!st) return;
      const u = st._undo || (st._undo=[]);
      u.push({ ...(snap||{}), kind: kind||null });
      if (u.length>UNDO_LIMIT) u.splice(0, u.length-UNDO_LIMIT);
      st._redo = [];
    }catch{}
  }
  function _applySnapshot(s){
    if (!s) return;
    editor.value = String(s.text||'');
    caretRow = Math.max(0, s.caretRow|0);
    caretCol = Math.max(0, s.caretCol|0);
    _clampCaret();
    try{ editor.scrollTop = Math.max(0, s.scrollTop|0); }catch{}
    // restore change tick from snapshot and recompute modified
    try{ const b=currentBuffer(); if (b){ b._changeTick = (s.changeTick|0); } }catch{}
    _syncModifiedFromTick();
    ensureScrolloff(); _repositionCaret(); updateGutter();
    // Undo/redo 後に listchars の再描画を明示的に行い、EOF付近の可視状態を即時反映 (CaseB)
    try{ _renderListChars(); }catch{}
    // restore encoding meta if present
    try{ const b=currentBuffer(); if (b && s && typeof s.enc !== 'undefined'){ b.enc = s.enc||'utf-8'; b.ff = s.ff||'unix'; b.bom = !!s.bom; _updateEncBtnLabel(); } }catch{}
  }
  function _pushUndoSnapshot(kind){ try{ const st=_currentStacks(); if (!st) return; const snap=_makeSnapshot(); // push current state as undo checkpoint
    const u = st._undo || (st._undo=[]); u.push({ ...snap, kind: kind||null }); if (u.length>UNDO_LIMIT) u.splice(0, u.length-UNDO_LIMIT); // clear redo on new branch
    st._redo = []; try{ _schedulePersist('undo-snap'); }catch{} }catch{} }
  function _undo(){ const st=_currentStacks(); if (!st) return; const u=st._undo||[]; if (u.length===0) return; const cur=_makeSnapshot(); const prev=u.pop(); const r=st._redo||(st._redo=[]); r.push(cur); _applySnapshot(prev); }
  function _redo(){ const st=_currentStacks(); if (!st) return; const r=st._redo||[]; if (r.length===0) return; const cur=_makeSnapshot(); const next=r.pop(); const u=st._undo||(st._undo=[]); u.push(cur); _applySnapshot(next); }
  function _cmpPos(a,b){ if (a.r!==b.r) return a.r-b.r; return a.c-b.c; }
  function _clampPos(p){ const lines=_splitLines(); let r=Math.max(0, Math.min(lines.length-1, p.r|0)); let c=Math.max(0, Math.min((lines[r]||'').length, p.c|0)); return {r,c}; }
  function _advancePosByCp(r,c,n){
    const lines=_splitLines();
    let rr=r, cc=c, left=n|0;
    const last=lines.length-1;
    while(left>0){
      const line=lines[rr]||''; const len=line.length;
      if (cc < len){ cc = _nextIndex(line, cc); left--; }
      else {
        if (rr>=last) break; // at final EOF
        // consume newline as 1 step and move to next line head
        rr++; cc=0; left--;
      }
    }
    return {r:rr, c:cc};
  }
  function _deleteRangePos(p1,p2, opts){
    // record undo before mutation
    _pushUndoSnapshot('delete-range');
    // Clamp order
    let a=_clampPosRaw(p1), b=_clampPosRaw(p2); // (#607) raw ベースで厳密に
    if (_cmpPos(a,b)>0){ const t=a; a=b; b=t; }
    if (a.r===b.r && a.c===b.c) return; // nothing
    // Absolute offsets over raw text to preserve exact newlines at EOF (#604)
    const s = String(editor.value||'');
    const off1 = _offsetFromRC(a.r, a.c);
    const off2 = _offsetFromRC(b.r, b.c);
    const startOff = Math.max(0, Math.min(s.length, off1|0));
    const endOff   = Math.max(startOff, Math.min(s.length, off2|0));
    const deletedText = s.slice(startOff, endOff);
    const out = s.slice(0, startOff) + s.slice(endOff);
    editor.value = out;
    // set caret at start of deletion using offset
    try{ const rc = _rcFromOffset(startOff); _setCaret(rc.r, rc.c); }catch{ _setCaret(a.r, a.c); }
    // Keep native selection in sync to avoid later browser-driven scroll/selection surprises (e.g., on save)
    try{ const stHold=editor.scrollTop|0, slHold=editor.scrollLeft|0; _syncNativeSelectionToCaret(); editor.scrollTop=stHold; editor.scrollLeft=slHold; }catch{}
    // Update unnamed register (charwise)
    // #539: allow caller to suppress register update (e.g., 'x' without count)
    const _updReg = !(opts && opts.updateRegister === false);
    if (_updReg){
      try{ _regUnnamed = { text: String(deletedText||''), linewise: false }; }catch{}
    }
    _touchBufferModified();
    _afterTextMutation();
  }
  function _deleteWholeLines(rStart, count){
    // 変更開始前に必ず undo を積む（CaseA: 最終空行削除も履歴対象）
    _pushUndoSnapshot('delete-lines');
    const s = String(editor.value||'');
    const lines=_splitLinesRaw(); // 編集用: 末尾空要素も含め正確に削除
    const total=lines.length;
    if (total===0) return;
    let rs=Math.max(0, Math.min(total-1, rStart|0));
    let n=Math.max(1, count|0);
    const rEnd = Math.min(total-1, rs + n - 1);
    // Capture deleted text (linewise)
    const deletedBlock = lines.slice(rs, rEnd+1).join('\n');
    if (total===1 && rs===0 && rEnd===0){
      // keep single empty line
      editor.value='';
      _setCaret(0,0);
      try{ _regUnnamed = { text: String(deletedBlock||''), linewise: true }; }catch{}
      _touchBufferModified();
      return;
    }
    const before = lines.slice(0, rs);
    const after  = lines.slice(rEnd+1);
    const nextLines = before.concat(after);
    // #616: 末尾行（最終要素）を削除し、元テキストが \n で終わっていない場合、
    // 削除対象直前の改行が「ファイル末尾の改行」として残るため、
    // 末尾に空要素を追加して join('\n') で末尾改行を保持する。
    try{
      const endsWithLF = s.endsWith('\n');
      if (rEnd === total-1 && !endsWithLF){ nextLines.push(''); }
    }catch{}
    if (nextLines.length===0) nextLines.push('');
    const newRow = Math.max(0, Math.min(nextLines.length-1, rs));
    let out = nextLines.join('\n');
    editor.value = out;
    // CaseA: 末尾の空行を削除した場合は前行の末尾へ caret を置く
    let newCol = 0;
    if (rEnd === total-1 && (lines[total-1]||'') === ''){
      newCol = (nextLines[newRow]||'').length;
    }
    _setCaret(newRow, newCol);
    // Sync native selection immediately after programmatic mutation
    try{ const stHold=editor.scrollTop|0, slHold=editor.scrollLeft|0; _syncNativeSelectionToCaret(); editor.scrollTop=stHold; editor.scrollLeft=slHold; }catch{}
    try{ _regUnnamed = { text: String(deletedBlock||''), linewise: true }; }catch{}
    _touchBufferModified();
    _afterTextMutation();
  }

  // --- VISUAL case transform helpers (#649) ---
  function _visualTransformCase(toUpper){
    if (!_visualActive) return;
    // Record undo snapshot
    _pushUndoSnapshot(toUpper? 'visual-upper' : 'visual-lower');
    const s = String(editor.value||'');
    if (_visualLinewise){
      const rs = Math.min(_visualAnchorR, caretRow);
      const re = Math.max(_visualAnchorR, caretRow);
      const raw = _splitLinesRaw();
      // Transform each targeted raw line (keep EOF blank line semantics)
      for (let r=rs; r<=re && r<raw.length; r++){
        raw[r] = toUpper? raw[r].toUpperCase() : raw[r].toLowerCase();
      }
      const out = raw.join('\n');
      if (out !== s){ editor.value = out; _touchBufferModified(); }
      // Preserve caret & anchor; keep selection
      _afterTextMutation();
      _updateVisualSelection();
      _repositionCaret(); updateGutter();
    } else {
      // Charwise: derive raw offsets and replace substring
      let a = _clampPosRaw({r:_visualAnchorR, c:_visualAnchorC});
      let b = _clampPosRaw({r:caretRow, c:caretCol});
      if (_cmpPos(a,b)>0){ const t=a; a=b; b=t; }
      if (a.r===b.r && a.c===b.c) return; // empty
      const off1 = _offsetFromRC(a.r, a.c);
      const off2 = _offsetFromRC(b.r, b.c);
      const startOff = Math.max(0, Math.min(s.length, off1|0));
      const endOff   = Math.max(startOff, Math.min(s.length, off2|0));
      const mid = s.slice(startOff, endOff);
      const transformed = toUpper? mid.toUpperCase() : mid.toLowerCase();
      const out = s.slice(0, startOff) + transformed + s.slice(endOff);
      if (out !== s){ editor.value = out; _touchBufferModified(); }
      // Keep caret at original end (approx) by recomputing offset of prior endOff
      try{ const rc = _rcFromOffset(endOff - (mid.length - transformed.length)); _setCaret(rc.r, rc.c); }catch{}
      _afterTextMutation();
      _updateVisualSelection();
      _repositionCaret(); updateGutter();
    }
  }

  // --- VISUAL simple brace text object (i{, a{, i}, a}) (#649) ---
  function _visualSelectBraces(includeBraces){
    const s = String(editor.value||'');
    // Use caret position as reference; prefer existing selection span mid-point if active
    let off = _offsetFromRC(caretRow, caretCol);
    try{
      if (_visualActive){
        // Midpoint of selection for better locality
        const aOff = _offsetFromRC(_visualAnchorR, _visualAnchorC);
        const bOff = _offsetFromRC(caretRow, caretCol);
        off = Math.floor((aOff + bOff)/2);
      }
    }catch{}
    // Find nearest '{' before and matching '}' after (simple, non-nested). If nested, pick outermost covering caret.
    let openPos = -1;
    for (let i=off; i>=0; i--){ if (s[i]==='{'){ openPos=i; break; } }
    // Accept also '}' search backwards if open not found and user pressed i} / a}
    if (openPos<0){ for (let i=off; i>=0; i--){ if (s[i]==='}'){ // attempt to find matching '{' backwards before this
          // search preceding '{'
          for (let j=i; j>=0; j--){ if (s[j]==='{'){ openPos=j; break; } }
          break; } }
    }
    if (openPos<0){ try{ toast('brace not found'); _triggerVisualBell(); }catch{} return; }
    // Find forward '}' from openPos
    let closePos = -1;
    for (let i=openPos+1; i<s.length; i++){ if (s[i]==='}'){ closePos=i; break; } }
    if (closePos<0){ try{ toast('matching } not found'); _triggerVisualBell(); }catch{} return; }
    // Compute selection offsets
    const selStart = includeBraces? openPos : openPos+1;
    const selEnd   = includeBraces? (closePos+1) : closePos; // end is exclusive
    // Map offsets to RC
    try{
      const rcStart = _rcFromOffset(selStart);
      const rcEndEx = _rcFromOffset(Math.max(selStart, selEnd));
      // Enter VISUAL charwise if not yet
      if (!_visualActive){ _enterVisual(false); }
      // Anchor at start, caret at end (exclusive end -> treat as preceding char if needed)
      _visualAnchorR = rcStart.r; _visualAnchorC = rcStart.c;
      // Adjust caret col: for exclusive end offset, ensure caret RC corresponds exactly
      caretRow = rcEndEx.r; caretCol = rcEndEx.c;
      _setCaret(caretRow, caretCol);
      _updateVisualSelection(); _repositionCaret(); updateGutter();
    }catch{}
  }
  function _insertTextAt(r,c,text){
    const beforeAll = String(editor.value||'');
    const s = String(text||'');
    if (!s) return { r, c };
    const lines = _splitLines();
    const rr = Math.max(0, Math.min(lines.length-1, r|0));
    const line = lines[rr] || '';
    const cc = Math.max(0, Math.min(line.length, c|0));
    const parts = s.split('\n');
    if (parts.length === 1){
      // single-line insert
      const nextLine = line.slice(0, cc) + parts[0] + line.slice(cc);
      lines[rr] = nextLine;
      let out = lines.join('\n');
      if (beforeAll.endsWith('\n') && !out.endsWith('\n')) out += '\n';
      editor.value = out;
      const newC = cc + parts[0].length;
      return { r: rr, c: newC };
    } else {
      // multi-line insert
      const head = line.slice(0, cc);
      const tail = line.slice(cc);
      const first = head + parts[0];
      const last  = parts[parts.length-1] + tail;
      const mid = parts.slice(1, parts.length-1);
      // replace current line with expanded block
      const newLines = [];
      for (let i=0;i<rr;i++) newLines.push(lines[i]);
      newLines.push(first);
      for (const m of mid) newLines.push(m);
      newLines.push(last);
      for (let i=rr+1;i<lines.length;i++) newLines.push(lines[i]);
      let out = newLines.join('\n');
      if (beforeAll.endsWith('\n') && !out.endsWith('\n')) out += '\n';
      editor.value = out;
      const newR = rr + parts.length - 1;
      const newC = (parts[parts.length-1]||'').length;
      return { r: newR, c: newC };
    }
  }
  // Normalize any accidental visual newline symbol in register text back to real LF (#656)
  function _normalizeRegText(s){
    try{ return String(s||'').replace(/\u2424/g, '\n'); }catch{ return String(s||''); }
  }
  function _pasteCharwise(after, count){
    const n = Math.max(1, count|0);
    const clip = _regUnnamed && !_regUnnamed.linewise ? _normalizeRegText(_regUnnamed.text) : '';
    if (!clip) return;
    _pushUndoSnapshot('paste');
    let pos;
    const line = (_splitLines()[caretRow]||'');
    if (after){
      // advance within line by one code point if possible; do not cross to next line here
      let nextC = caretCol;
      if (caretCol < line.length){ nextC = _nextIndex(line, caretCol); }
      pos = { r: caretRow, c: nextC };
    } else {
      pos = { r: caretRow, c: caretCol };
    }
    let final = pos;
    for (let i=0;i<n;i++){
      final = _insertTextAt(final.r, final.c, clip);
    }
    _setCaret(final.r, final.c);
    _touchBufferModified(); ensureScrolloff(); _repositionCaret(); updateGutter();
  }
  function _pasteLinewise(below, count){
    const n = Math.max(1, count|0);
    const clip = _regUnnamed && _regUnnamed.linewise ? _normalizeRegText(_regUnnamed.text) : '';
    if (!clip) return;
    _pushUndoSnapshot('paste');
    const beforeAll = String(editor.value||'');
    const lines = _splitLines();
    const insertAt = Math.max(0, Math.min(lines.length, (below ? (caretRow+1) : caretRow)));
    const block = clip.split('\n');
    const toInsert = [];
    for (let i=0;i<n;i++) toInsert.push(...block);
    const newLines = lines.slice(0, insertAt).concat(toInsert).concat(lines.slice(insertAt));
    let out = newLines.join('\n');
    if (beforeAll.endsWith('\n') && !out.endsWith('\n')) out += '\n';
    editor.value = out;
    const newR = insertAt; // first inserted line
    const col = _firstNonBlankColOf(newLines[newR]||'');
    _setCaret(newR, col);
    _touchBufferModified(); ensureScrolloff(); _repositionCaret(); updateGutter();
  }
  function _paragraphNextPos(startRow, count){
    const lines=_splitLines(); let r=startRow; const times=Math.max(1,count|0);
    for (let i=0;i<times;i++){
      let j=r+1; while (j<lines.length && !/^\s*$/.test(lines[j]||'')) j++;
      while (j<lines.length && /^\s*$/.test(lines[j]||'')) j++;
      if (j>=lines.length){ r=lines.length-1; break; }
      r=j;
    }
    const col=_firstNonBlankColOf(lines[r]||'');
    return { r, c: col };
  }
  function _paragraphPrevPos(startRow, count){
    const lines=_splitLines(); let r=startRow; const times=Math.max(1,count|0);
    for (let i=0;i<times;i++){
      let j=r-1; while (j>=0 && !/^\s*$/.test(lines[j]||'')) j--; while (j>=0 && /^\s*$/.test(lines[j]||'')) j--; if (j<0){ r=0; break; } let k=j; while (k>0 && !/^\s*$/.test(lines[k-1]||'')) k--; r=k;
    }
    const col=_firstNonBlankColOf(lines[r]||'');
    return { r, c: col };
  }
  function _computeMotionTarget(r,c,key,count){
    const lines=_splitLines();
    const times=Math.max(1, count|0);
    let rr=r, cc=c;
    const last=lines.length-1;
    const moveCols=(delta)=>{ const line=lines[rr]||''; const len=line.length; cc=Math.max(0, Math.min(len, cc+delta)); };
    const moveLines=(delta)=>{
      // Preserve desired visual column for vertical motion
      const line0 = lines[rr]||'';
      const curVis = _visualWidthUpToLine(line0, cc|0);
      const desired = (_desiredVisualCol==null? curVis : _desiredVisualCol|0);
      rr=Math.max(0, Math.min(last, rr+delta));
      const line1 = lines[rr]||'';
      cc = _colForVisual(line1, desired);
    };
    switch(key){
      case 'h': moveCols(-times); break;
      case 'l': moveCols(+times); break;
      case 'j': moveLines(+times); break;
      case 'k': moveLines(-times); break;
      case 'w': { let r0=rr,c0=cc; for(let i=0;i<times;i++){ const p=_nextWordStart(r0,c0); r0=p.r; c0=p.c; } rr=r0; cc=c0; break; }
      case 'b': { let r0=rr,c0=cc; for(let i=0;i<times;i++){ const p=_prevWordStart(r0,c0); r0=p.r; c0=p.c; } rr=r0; cc=c0; break; }
      case 'W': { let r0=rr,c0=cc; for(let i=0;i<times;i++){ const p=_nextWORDStart(r0,c0); r0=p.r; c0=p.c; } rr=r0; cc=c0; break; }
      case 'B': { let r0=rr,c0=cc; for(let i=0;i<times;i++){ const p=_prevWORDStart(r0,c0); r0=p.r; c0=p.c; } rr=r0; cc=c0; break; }
      case '^': { rr=rr; cc=_firstNonBlankColOf(lines[rr]||''); break; }
      case '0': { cc=0; break; }
      case '$': {
        let r0=rr; if (times>1){ r0=Math.max(0, Math.min(last, rr + (times-1))); }
        rr=r0; cc=(lines[rr]||'').length; break; }
      case '}': { const p=_paragraphNextPos(rr, times); rr=p.r; cc=p.c; break; }
      case '{': { const p=_paragraphPrevPos(rr, times); rr=p.r; cc=p.c; break; }
      default: return null;
    }
    return { r: rr, c: cc };
  }
  function _clearPendingOp(){ _pendingOp=null; _pendingOpCount=1; _pendingOpSeq=null; if (_pendingOpTimer){ clearTimeout(_pendingOpTimer); _pendingOpTimer=null; } }
  function _armPendingOpTimeout(){
    // Abolish operator wait timeout for 'd': never auto-cancel
    if (_pendingOpTimer){ try{ clearTimeout(_pendingOpTimer); }catch{} }
    _pendingOpTimer = null;
  }
  function _doDeleteX(count){
    const n=Math.max(1, count|0);
    // #617: 末尾の空行(改行のみ行)で 'x' 実行時の caret 行頭移動を防ぎ、前行末へ移動させるため事前状態を記録
    const preLines=_splitLinesRaw();
    const preDisp=_splitLines();
    const preLast = preLines.length - 1;
    const preCaretRow = caretRow|0;
    const preCaretCol = caretCol|0;
    const preLineEmpty = (preCaretRow>=0 && preCaretRow<=preLast) ? (preLines[preCaretRow]==='') : false;
    const preDispLast = preDisp.length - 1;
    // 旧: 単一末尾空行のみを検出していた条件 (display + 1 の raw)
    const preAtFinalVisibleBlankLegacy = (
      preDispLast>=0 &&
      preCaretRow === preDispLast &&
      ((preDisp[preDispLast]||'')==='') &&
      (preLines.length === preDisp.length + 1) &&
      ((preLines[preLines.length-1]||'')==='')
    );
    // #622: "abc\n\n" など末尾に複数の空行がある場合でも、最終 raw 空行上での 'x' 後に caret を前行末へ移動させたい。
    // trailingBlankCount: raw末尾連続空要素数 ("abc\n\n\n" -> 2空行なら 2, 行配列は ["abc", "", "", ""])
    let trailingBlankCount=0;{
      for(let i=preLines.length-1;i>=0;i--){ if(preLines[i]===''){ trailingBlankCount++; } else break; }
    }
    // caret が raw の最終空行上に居るか
    const preAtLastRawBlank = (trailingBlankCount>0 && preCaretRow === preLines.length-1 && preLineEmpty);
    // 既存 display 差分ロジックで検出できない (複数空行) ケースを追加吸収
    const preAtFinalVisibleBlank = preAtFinalVisibleBlankLegacy || preAtLastRawBlank;
    const start={ r: caretRow, c: caretCol };
    const end=_advancePosByCpRaw(start.r, start.c, n); // (#607) raw ベースで1cp前進
    if (start.r===end.r && start.c===end.c){ return; }
    // #539: 'x' should not update yank register unless count >= 2
    _deleteRangePos(start, end, { updateRegister: (n>=2) });
    // #603: 削除結果の末尾行状態に応じた特殊処理
    try{
      const v=String(editor.value||'');
      const lines=_splitLinesRaw(); // (#607) 改行数の正確な判定
      const last=lines.length-1;
      if (caretRow>last){ caretRow=last; caretCol=(lines[last]||'').length; }
      if (last>=0){
        const line=lines[caretRow]||'';
        const noFinalLF = !v.endsWith('\n');
        // 「caret行が改行も含めて空」: 最終行が空文字列 かつ 末尾LF欠落
        if (caretRow===last && line==='' && noFinalLF){
          if (caretRow>0){
            caretRow = caretRow - 1;
            caretCol = (lines[caretRow]||'').length;
            _setCaret(caretRow, caretCol);
            try{ _syncNativeSelectionToCaret(); }catch{}
          } else {
            // 先頭唯一行が空で末尾LF欠落ならそのまま(行は残す)
            caretCol=0; _setCaret(caretRow, caretCol);
          }
        } else if (caretRow===last && line!=='' && noFinalLF){
          // 最終行が非空で末尾LF欠落 -> ダミー行末記号表示対象。描画更新のみ。
          try{ _renderListChars(); }catch{}
        }
        // #617: 末尾空行(改行のみ)を 'x' で削除したケース
        // 条件: 削除前 caret が最終行かつその行が空文字列, 削除後行数が1減, caret が前行の行頭(=0) に居る
        // 対応: caret を前行末尾へ再設定
        try{
          if (preAtFinalVisibleBlank){
            // 前行末へ移動: 複数末尾空行があった場合は「末尾空行群の直前行」を基準にする
            // raw基準で trailingBlankCount 個の空行があり caret が最終空行だったケースでは
            // 前行 = preLines.length - trailingBlankCount - 1
            let targetRow;
            if (preAtLastRawBlank){
              targetRow = preLines.length - trailingBlankCount - 1;
            } else {
              // 従来単一空行ケース: display最終行
              const disp=_splitLines();
              targetRow = Math.max(0, disp.length - 1);
            }
            if (targetRow>=0){
              const afterRaw=_splitLinesRaw();
              const tCol=(afterRaw[targetRow]||'').length;
              caretRow=targetRow; caretCol=tCol;
              _setCaret(caretRow, caretCol);
              _syncNativeSelectionToCaret();
            }
          }
        }catch{}
      }
    }catch{}
    _afterTextMutation();
  }

  // Yank helpers (copy to unnamed register without modifying text)
  function _yankRangePos(p1, p2){
    const lines=_splitLines();
    let a=_clampPos(p1), b=_clampPos(p2);
    if (_cmpPos(a,b)>0){ const t=a; a=b; b=t; }
    if (a.r===b.r && a.c===b.c) return; // nothing
    let yanked = '';
    if (a.r===b.r){
      const r=a.r; const s=lines[r]||'';
      yanked = s.slice(a.c, b.c);
    } else {
      const head=(lines[a.r]||'').slice(a.c);
      const middle = (b.r - a.r > 1) ? (lines.slice(a.r+1, b.r).join('\n') + '\n') : '';
      const tail=(lines[b.r]||'').slice(0,b.c);
      yanked = head + '\n' + middle + tail;
    }
    // #539: Do not update yank register when yanked content is empty (length 0)
    if ((String(yanked||'').length) > 0){
      try{ _regUnnamed = { text: String(yanked||''), linewise: false }; }catch{}
      _flashYanked(a,b);
    }
  }
  function _yankWholeLines(rStart, count){
    const lines=_splitLines();
    const total=lines.length;
    if (total===0) return;
    let rs=Math.max(0, Math.min(total-1, rStart|0));
    let n=Math.max(1, count|0);
    const rEnd = Math.min(total-1, rs + n - 1);
    const yankedBlock = lines.slice(rs, rEnd+1).join('\n');
    // #539: Skip updating yank register on empty block (length 0)
    if ((String(yankedBlock||'').length) > 0){
      try{ _regUnnamed = { text: String(yankedBlock||''), linewise: true }; }catch{}
      const rs=Math.max(0, Math.min(total-1, rStart|0));
      const n=Math.max(1, count|0);
      const rEnd = Math.min(total-1, rs + n - 1);
      const lastLen = (lines[rEnd]||'').length;
      _flashYanked({r:rs,c:0},{r:rEnd,c:lastLen});
    }
  }

  // Clipboard helpers and non-register extractors for Y (Windows clipboard copy)
  function _extractRangeText(p1, p2){
    const lines=_splitLines();
    let a=_clampPos(p1), b=_clampPos(p2);
    if (_cmpPos(a,b)>0){ const t=a; a=b; b=t; }
    if (a.r===b.r && a.c===b.c) return '';
    if (a.r===b.r){
      const r=a.r; const s=lines[r]||'';
      return s.slice(a.c, b.c);
    } else {
      const head=(lines[a.r]||'').slice(a.c);
      const middle = (b.r - a.r > 1) ? (lines.slice(a.r+1, b.r).join('\n') + '\n') : '';
      const tail=(lines[b.r]||'').slice(0,b.c);
      return head + '\n' + middle + tail;
    }
  }
  function _extractWholeLinesText(rStart, count){
    const lines=_splitLines();
    const total=lines.length;
    if (total===0) return '';
    let rs=Math.max(0, Math.min(total-1, rStart|0));
    let n=Math.max(1, count|0);
    const rEnd = Math.min(total-1, rs + n - 1);
    return lines.slice(rs, rEnd+1).join('\n');
  }
  async function _copyToClipboard(text){
    const s = String(text||'');
    try{
      if (navigator && navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(s);
        return true;
      }
    }catch{}
    // Fallback via hidden textarea + execCommand('copy')
    try{
      const restoreEl = document.activeElement;
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.setAttribute('readonly','');
      ta.style.position='fixed';
      ta.style.opacity='0';
      ta.style.left='-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok=false; try{ ok = document.execCommand('copy'); }catch{}
      try{ document.body.removeChild(ta); }catch{}
      try{ if (restoreEl && restoreEl.focus){ restoreEl.focus(); } }catch{}
      return !!ok;
    }catch{}
    return false;
  }

  /*********************************************************
   * ensureScrolloff
   *********************************************************/
  let _scrollGuardUntil = 0; // temporary guard to suppress auto scroll adjustments
  let _selGuardUntil = 0;    // temporary guard to suppress selection-driven caret sync (e.g., right after save)
  let _skipEnsureOnceAfterSwitch = false; // skip the next ensureScrolloff once right after buffer switch
  let _lastBufferSwitchAt = 0; // timestamp of last successful buffer switch
  // Prefer not to scroll on the very first motion after a buffer switch when caret is already visible (#415 case1)
  let _preferNoScrollOnceAfterSwitch = false;

  function _isCaretVisible(){
    try{
      const top = _topLine();
      const vis = _visibleLinesExact();
      const bot = top + vis - 1;
      const caret1 = caretRow + 1;
      return (caret1 >= top && caret1 <= bot);
    }catch{ return true; }
  }

  function _ensureAfterMotion(){
    // If immediately after a buffer switch and caret is visible, skip the first automatic adjustment
    if (_preferNoScrollOnceAfterSwitch){
      _preferNoScrollOnceAfterSwitch = false;
      if (_isCaretVisible()) return;
    }
    ensureScrolloff({ force:true });
  }
  function ensureScrolloff(opts={}){
    // If paused (e.g., right after '/word' confirm) or a modal is open and
    // we're suppressing scroll adjustments, skip any automatic re-centering/adjustment.
    // This resumes on next explicit caret move or when suppression is cleared.
    if (_scrolloffPaused) return;
    if (_suppressScrollDuringModal) return;
    const force = !!(opts && opts.force);
    // Skip-once guard right after buffer switch: allow bypass when forced (caret move) or explicit centerOnce
    if (_skipEnsureOnceAfterSwitch){
      // clear the flag regardless so it doesn't keep skipping
      _skipEnsureOnceAfterSwitch = false;
      if (!force && !(opts && opts.centerOnce)) return;
      // else fall through (forced or centerOnce request)
    }
    // Right after a buffer switch, suppress automatic ensure for a short window to avoid EOF jumps (#411),
    // but allow when explicitly requested (centerOnce) or forced by a caret-moving command
    try{ if (!force && !(opts && opts.centerOnce) && ((Date.now() - _lastBufferSwitchAt) < 800)) return; }catch{}
    try{ if (!force && (Date.now() < _scrollGuardUntil)) return; }catch{}
    const linesTotal = _totalLines();
    const vis = _visibleLinesExact();
    let topLine = _topLine();
    const caretLine1 = caretRow + 1;
    const centerOnce = opts.centerOnce || _centerScrolloffOnce;
    const big = scrolloff >= 99999;
    // Allow extra "virtual" page steps so EOF の下に N 行分の余白が見える
    const baseMaxTop = Math.max(1, linesTotal - vis + 1);
    // 固定余白行数 (#865): カスタマイズ不要のため常に 6 行を許容
    const _readEofPadLines = ()=>6;
    const _eofPad = _readEofPadLines();
    const maxTopWithPad = Math.min(linesTotal, baseMaxTop + _eofPad);

    if (big || centerOnce || scrolloff >= Math.floor(vis/2)){
      let targetTop = Math.max(1, caretLine1 - Math.floor(vis/2));
      // When explicitly requested (e.g., 'G'), prefer showing EOF pad
      if (opts.preferEOFPad && caretLine1 === linesTotal){
        targetTop = Math.min(maxTopWithPad, Math.max(1, targetTop));
      }
      // clamp within pad range
      targetTop = Math.min(targetTop, maxTopWithPad);
      const prevTopLine = _topLine();
      editor.scrollTop = (targetTop-1) * LINE_HEIGHT;
      // If caret was already visible and we only scrolled due to centerOnce/preferEOFPad for EOF, avoid introducing visual gap by snapping back when delta is small (#424)
      try{
        const caretVisibleBefore = (caretLine1 >= prevTopLine && caretLine1 <= (prevTopLine + vis - 1));
        if (caretVisibleBefore && !opts.force && opts.preferEOFPad){
          const newTopLine = _topLine();
          // If we over-scrolled into showing extra pad while caret comfortably inside upper half, revert
          if (newTopLine > prevTopLine && (caretLine1 < prevTopLine + Math.floor(vis*0.65))){
            editor.scrollTop = (prevTopLine-1) * LINE_HEIGHT;
          }
        }
      }catch{}
      _centerScrolloffOnce = false;
    } else {
      if (caretLine1 < topLine + scrolloff){
        const newTop = Math.max(1, caretLine1 - scrolloff);
        if (newTop !== topLine) editor.scrollTop = (newTop-1)*LINE_HEIGHT;
      } else if (caretLine1 > topLine + vis - scrolloff - 1){
        let newTop = Math.max(1, caretLine1 - (vis - scrolloff - 1));
        // If caret is at EOF, prefer letting one-line pad show at the bottom
        if (caretLine1 === linesTotal){ newTop = Math.min(newTop, maxTopWithPad); }
        if (newTop !== topLine) editor.scrollTop = (newTop-1)*LINE_HEIGHT;
      }
    }
    topLine = _topLine();
  // 末尾ページの先頭行（maxTop）は「全行数 - 可視行数 + 1」だが、EOF の下に 1 行分の余白を許容
    const maxTop = maxTopWithPad;
    if (topLine > maxTop){
      editor.scrollTop = (maxTop-1)*LINE_HEIGHT;
    }
    // スクロール位置を行境界にスナップして、丸め誤差での1行ズレを防止。
    // EOFジャンプ（preferEOFPad）直後は切り上げよりも切り捨て優先で半行余白を排除 (#424/#429)
    try{
      const stCur = (editor.scrollTop||0);
      const atEOFJump = !!(opts && opts.preferEOFPad && caretLine1 === linesTotal);
      // #472 scrolloff=99999（常時センタリング）環境で Math.round により 0.5 行上方へズレ、背景グラデとの不一致が発生。
      // text/gutter/caret は floor ベース remainder へ統一済みなので、ここでも常に floor へ統一して余剰を排除。
      // （EOF ジャンプ特別扱いは不要になったが、将来の拡張のためフラグは保持）
      const snapped = Math.floor(stCur/LINE_HEIGHT)*LINE_HEIGHT;
      if (Math.abs(snapped - stCur) > 0.01){ editor.scrollTop = snapped; }
      // 念のため rAF で再度 floor スナップ（レイアウト遅延対策）。EOF だけでなく常時行うが、差分が出なければ軽微。
      if (window.requestAnimationFrame){
        requestAnimationFrame(()=>{
          try{
            const st1 = (editor.scrollTop||0);
            const flo1 = Math.floor(st1/LINE_HEIGHT)*LINE_HEIGHT;
            if (Math.abs(flo1 - st1) > 0.01){ editor.scrollTop = flo1; }
            _repositionCaret(); updateGutter();
          }catch{}
        });
      }
    }catch{}
  }

  // Snap editor.scrollTop to the line grid conservatively (don't force bottom clamp if caret is visible),
  // and clamp only when the viewport would exceed EOF. Persist view state afterwards.
  function _snapScrollGridPersist(){
    try{
      let st = (editor && typeof editor.scrollTop === 'number') ? (editor.scrollTop|0) : 0;
      const vis = Math.max(1, (function(){ try{ return _visibleLinesExact(); }catch{ return 1; } })());
      const total = (function(){ try{ return _totalLines(); }catch{ return 1; } })();

      // 現在の可視範囲（変更前）
      let curTopLine = Math.floor(st/LINE_HEIGHT) + 1;
      if (curTopLine < 1) curTopLine = 1;
      let curBotLine = curTopLine + vis - 1;
      if (curBotLine > total) curBotLine = total;
      const caretR = (function(){ try{ return caretRow|0; }catch{ return 1; } })();
      const caretVisible = (caretR >= curTopLine && caretR <= curBotLine);

      // 半行ズレだけ直す。キャレットが見えているなら「切り上げ」しない（視界を下げない）。
      const frac = st % LINE_HEIGHT;
      let snappedY = st;
      if (frac !== 0){
        if (caretVisible){
          // 切り捨てスナップ：視界を維持しつつ半行ズレを解消
          snappedY = Math.floor(st/LINE_HEIGHT) * LINE_HEIGHT;
        } else {
          // 最近傍へスナップ（キャレットが既に見えていない場合に限り許容）
          snappedY = Math.round(st/LINE_HEIGHT) * LINE_HEIGHT;
        }
      }

      // EOF を越える場合のみ下限クランプを行う。キャレットが見えている限り、不要な下方向スクロールは行わない。
      const snapTopLine = Math.floor(snappedY/LINE_HEIGHT) + 1;
      const baseMaxTop = Math.max(1, total - vis + 1);
      if (snapTopLine > baseMaxTop){
        // ビューポート底が EOF を越える → 許容最大トップに引き上げ
        snappedY = (baseMaxTop - 1) * LINE_HEIGHT;
        if (snappedY < 0) snappedY = 0;
      }

      try{ if (snappedY !== st) editor.scrollTop = snappedY; }catch{}
      // Persist and render
      try{ const b = currentBuffer(); if (b){ b.viewScrollTop = (editor.scrollTop||0)|0; b.viewRow = caretRow|0; b.viewCol = caretCol|0; } }catch{}
      _repositionCaret(); updateGutter();
      // Briefly guard against automatic recentering
      try{ _scrollGuardUntil = Date.now() + 400; }catch{}
    }catch{}
  }

  // Exit CMD as if Escape was pressed: close popups, restore pre-CMD view, return to prior mode,
  // and schedule a few reinforced viewport restores to suppress transient jumps.
  function _cmdExitAndRestoreView(opts){
    try{
      // hide incsearch preview if any
      try{ _incPrevHide && _incPrevHide(); }catch{}
      // reset history browsing state on cancel
      try{ _cmdHistBrowsing=false; _cmdHistIndex=_cmdHistory.length; _cmdHistTemp=''; }catch{}
      try{ _searchHistBrowsing=false; _searchHistIndex=_searchHistory.length; _searchHistTemp=''; }catch{}
      // capture current view and selection
      let st = 0, cr = 0, cc = 0; try{ st = (editor.scrollTop||0); cr = (caretRow|0); cc = (caretCol|0); }catch{}
      let selS = 0, selE = 0; try{ selS = editor.selectionStart|0; selE = editor.selectionEnd|0; }catch{}
      const fromVis = !!_cmdFromVisual;
      let restoredVisual = false;
      if (fromVis && !(opts && opts.forImmediateSwitch)){
        try{
          if (Number.isFinite(_visCmdCaretR) && Number.isFinite(_visCmdCaretC)){
            caretRow = _visCmdCaretR|0; caretCol = _visCmdCaretC|0;
          }
          _visualActive = true; _visualLinewise = !!_visCmdLinewise;
          _visualAnchorR = (_visCmdAnchorR|0); _visualAnchorC = (_visCmdAnchorC|0);
          _setMode('VISUAL'); _updateVisualSelection(); try{ _renderVisSelOverlay(); }catch{}
          restoredVisual = true;
        }catch{}
        // clear markers regardless
        _cmdFromVisual = false; _visCmdActive = false; try{ _visSelClear && _visSelClear(); }catch{}
      }
      _scrollGuardUntil = Date.now() + (opts && opts.forImmediateSwitch ? 1200 : 900); // suppress recentering briefly
      const restoreView = ()=>{
        try{
          if (!(opts && opts.forImmediateSwitch)){
            if (!fromVis){ try{ editor.setSelectionRange(selS, selE); }catch{} }
            caretRow = cr; caretCol = cc; editor.scrollTop = st;
            _repositionCaret(); updateGutter();
          }
        }catch{}
      };
      // Close any popups
      try{ _bufPopupHide && _bufPopupHide(); }catch{}
      try{ _filePopupHide && _filePopupHide(); }catch{}
      // Clear command input field
      try{ if (cmdinput){ cmdinput.value=''; try{ cmdinput.dispatchEvent(new Event('input', { bubbles:true })); }catch{} } }catch{}
      // Return to prior mode (INSERT/VISUAL/NORMAL); default NORMAL
      // Even forImmediateSwitch, restore mode immediately to keep keyboard routing correct (#410)
      if (!restoredVisual){
        const target = (_preCmdMode==='INSERT' || _preCmdMode==='VISUAL' || _preCmdMode==='NORMAL') ? _preCmdMode : 'NORMAL';
        if (target === 'INSERT'){ _suppressInsertSnapshotOnce = true; }
        _setMode(target);
      }
      try{ _hideCursor && _hideCursor(); }catch{}
      setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); restoreView(); if (!(opts && opts.forImmediateSwitch)) { if (window.requestAnimationFrame){ requestAnimationFrame(()=>restoreView()); } setTimeout(restoreView, 120); } }catch{} }, 0);
    }catch{}
  }

  // Keep current viewport exactly as-is across transient layout changes (e.g., closing :b popup).
  // Re-apply the pre-exit scrollTop over a few frames without snapping/clamping to avoid unwanted jumps (#407/#408).
  function _keepViewportNoop(preSt){
    try{
      const st = Number.isFinite(preSt) ? (preSt|0) : ((editor && editor.scrollTop)|0);
      const apply = ()=>{ try{ editor.scrollTop = st; _repositionCaret(); updateGutter(); }catch{} };
      apply();
      if (window.requestAnimationFrame){
        requestAnimationFrame(()=>{ apply(); requestAnimationFrame(()=>apply()); });
      }
      setTimeout(apply, 0);
      setTimeout(apply, 80);
      setTimeout(apply, 180);
      try{ _scrollGuardUntil = Date.now() + 900; }catch{}
    }catch{}
  }

  /*********************************************************
   * updateGutter
   *********************************************************/
  function updateGutter(){
    const T = (window.THEME || {});
    // Ensure scrollTop is on an exact line boundary before computing gutter rows
    try{
      const st = (editor.scrollTop||0);
      const snapped = Math.round(st/LINE_HEIGHT)*LINE_HEIGHT;
      let _changed = false;
      if (Math.abs(snapped - st) > 0.25){ editor.scrollTop = snapped; _changed = true; }
      // If snapping just adjusted scrollTop AFTER a prior _repositionCaret, recompute overlays now to avoid stripe/caret remainder mismatch (#423)
      if (_changed){ try{ _repositionCaret(); }catch{} }
    }catch{}
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
        gutter.appendChild(el);
      }
      // Ensure both height and line-height reflect current zoom, every render
      try{
        el.style.display = 'block';
        el.style.height = LINE_HEIGHT+'px';
        el.style.lineHeight = LINE_HEIGHT+'px';
      }catch{}
      if (r.eof){
        el.textContent = '';
        el.style.background = (T.eofGutterFillColor||'#0f1117');
        el.style.color = (T.gutterNumberColor||'#57607a');
      } else {
        el.textContent = r.ln;
        if (r.active){
          // INSERTモード用のガターグラデ (未定義キーは yellow sentinel) (#441/#442)
          // CSS変数に委譲し、JS は単一の linear-gradient 定義のみ。テーマキーは _applyTheme() で --activeEditGutterGrad* としてセット済み。
          if (_mode === 'INSERT'){
            el.style.background = 'linear-gradient(to bottom, var(--activeEditGutterGradStart, yellow), var(--activeEditGutterGradEnd, yellow))';
          } else {
            el.style.background = 'linear-gradient(to bottom, var(--activeGutterGradStart, yellow), var(--activeGutterGradEnd, yellow))';
          }
        } else {
          // Inactive rows: transparent to let container's tiled background show (prevents flicker)
          el.style.background = '';
        }
        el.style.color = r.active ? (T.activeLineNumberColor||'#a6accd') : (T.gutterNumberColor||'#57607a');
      }
    }
    // remove extra children
    for (let i=rows.length; i<children.length; i++){
      gutter.removeChild(children[i]);
    }
    // Subpixel alignment guard without moving the container background:
    // shift only the first row slightly so the tiled background stays locked.
    try{
      gutter.style.transform = '';
      const st = (editor.scrollTop||0);
      // Use floor-based remainder consistent with _topLine()/caret stripe to prevent half-line leading gap (#470)
      const rem = st - Math.floor(st/LINE_HEIGHT)*LINE_HEIGHT;
      const first = gutter.firstElementChild;
      if (first){ first.style.marginTop = Math.abs(rem) > 0.01 ? (-rem)+'px' : '0px'; }
    }catch{}
    // Keep listchars overlay refreshed with any gutter/text update
    try{ _renderListChars(); }catch{}
  }

  /*********************************************************
   * Movement
   *********************************************************/
  function _moveCaretLines(delta){
    const lines = _splitLines();
    const newRow = Math.max(0, Math.min(lines.length-1, caretRow + delta));
    _ensureDesired();
    const line = lines[newRow] || '';
    const newCol = _colForVisual(line, _desiredVisualCol|0);
    // commit without updating desired (keep it across j/k)
    const prevRow = caretRow|0;
    caretRow = newRow;
    _suppressDesiredOnce = true;
    _setCaret(newRow, newCol, { suppressDesired: true });
    // EOF パッドスクロール試行 (NORMAL) #864/#867 共通ヘルパー利用
    if (delta>0 && newRow===prevRow && newRow===lines.length-1){
      if (_maybeScrollEofPadStep('normal-eof-pad-scroll')) return;
    }
    // 通常処理: Prefer no scroll on first motion after switch if caret is visible; otherwise force ensure
    _ensureAfterMotion();
    // motion log
    try{ _debugPush({ t:Date.now(), type:'motion', mode:_mode, kind:'lines', delta:delta|0, toR:caretRow|0, toC:caretCol|0 }); }catch{}
    try{ _anomalyMaybeEnd('lines-motion'); }catch{}
  }
  // 共通 EOF パッド 1 行スクロール (#864/#865/#867)
  function _maybeScrollEofPadStep(kind){
    try{
      const lines=_splitLines();
      if (caretRow !== lines.length-1) return false;
      const vis=_visibleLinesExact();
      const linesTotal=_totalLines();
      const baseMaxTop=Math.max(1, linesTotal - vis + 1);
      const eofPad=6; // 固定 (#865)
      const maxTopWithPad=Math.min(linesTotal, baseMaxTop + eofPad);
      const curTop=_topLine();
      if (curTop >= maxTopWithPad) return false;
      const nextTop=Math.min(maxTopWithPad, curTop + 1);
      editor.scrollTop=(nextTop-1)*LINE_HEIGHT;
      // 行グリッドへスナップ
      try{ const st=editor.scrollTop||0; const snap=Math.floor(st/LINE_HEIGHT)*LINE_HEIGHT; if (Math.abs(snap-st)>0.01){ editor.scrollTop=snap; } }catch{}
      _repositionCaret(); updateGutter();
      try{ _debugPush({ t:Date.now(), type:'motion', mode:_mode, kind:kind||'eof-pad-scroll', top:nextTop, maxTopWithPad }); }catch{}
      return true;
    }catch{ return false; }
  }
  function _moveCaretCols(delta){
    const line = (_splitLines()[caretRow] || '');
    const fromR = caretRow|0, fromC = caretCol|0;
    const nc = Math.max(0, Math.min(line.length, caretCol + delta));
    _setCaret(caretRow, nc);
    // Detect unexpected row change (should not happen here); if it does, tag anomaly
    const wrap = (caretRow!==fromR);
    try{ _debugPush({ t:Date.now(), type:'motion', mode:_mode, kind:'cols', delta:delta|0, fromR, fromC, toR:caretRow|0, toC:caretCol|0, wrap }); }catch{}
    try{ _anomalyMaybeCols(delta); }catch{}
  }
  // ---- Motion helpers ----
  function _lineLen(r){ const lines=_splitLines(); return (r>=0 && r<lines.length) ? (lines[r]||'').length : 0; }
  function _firstNonBlankColOf(line){ const m = String(line||'').match(/^\s*/); return m ? (m[0]||'').length : 0; }
  function _setCaret(r,c,opt){
    const lines=_splitLines(); r=Math.max(0, Math.min(lines.length-1, r|0)); const len=(lines[r]||'').length; caretRow=r; caretCol=Math.max(0, Math.min(len, c|0));
    try{
      const suppress = !!(opt && (opt===true || opt.suppressDesired));
      if (_suppressDesiredOnce){ _suppressDesiredOnce = false; return; }
      if (!suppress){ _desiredVisualCol = _visualWidthUpToLine((lines[caretRow]||''), caretCol|0); }
    }catch{}
  }
  function _consumeCount(){ const n=(_countAcc==null?1:_countAcc); _countAcc=null; return Math.max(1,n); }
  // --- Word movement helpers (HTA parity, surrogate-aware) ---
  // code point at index (or -1 if invalid/middle of surrogate)
  function _cpAt(s, i){
    if (!s || i<0 || i>=s.length) return -1;
    const c1 = s.charCodeAt(i);
    if (c1 >= 0xD800 && c1 <= 0xDBFF){
      const c2 = s.charCodeAt(i+1);
      if (c2 >= 0xDC00 && c2 <= 0xDFFF){
        return ((c1-0xD800) << 10) + (c2-0xDC00) + 0x10000;
      }
      return -1; // dangling high surrogate
    }
    if (c1 >= 0xDC00 && c1 <= 0xDFFF) return -1; // low-surrogate start
    return c1;
  }
  function _nextIndex(s, i){
    if (!s || i<0) return 0;
    if (i >= s.length) return s.length;
    const c1 = s.charCodeAt(i);
    if (c1 >= 0xD800 && c1 <= 0xDBFF){
      const c2 = s.charCodeAt(i+1);
      if (c2 >= 0xDC00 && c2 <= 0xDFFF) return i+2;
    }
    return i+1;
  }
  function _prevIndex(s, i){
    if (!s || i<=0) return 0;
    let j = i-1;
    const c2 = s.charCodeAt(j);
    if (c2 >= 0xDC00 && c2 <= 0xDFFF){
      if (j-1 >= 0){
        const c1 = s.charCodeAt(j-1);
        if (c1 >= 0xD800 && c1 <= 0xDBFF) return j-1;
      }
    }
    return j;
  }
  // Word types
  const _WT_SPACE = 0, _WT_NL = 1, _WT_ALNUM = 2, _WT_KANA = 3, _WT_HAN = 4, _WT_SYMBOL = 5;
  function _isSpaceCp(cp){ return cp===0x20 || cp===0x09 || cp===0x3000; }
  function _isAsciiWordCp(cp){
    return (cp>=0x30 && cp<=0x39) || (cp>=0x41 && cp<=0x5A) || (cp>=0x61 && cp<=0x7A) || cp===0x5F;
  }
  function _isFullwidthAlnumCp(cp){
    // FF10–FF19 (0-9), FF21–FF3A (A-Z), FF41–FF5A (a-z), FF3F (underscore)
    return (cp>=0xFF10 && cp<=0xFF19) || (cp>=0xFF21 && cp<=0xFF3A) || (cp>=0xFF41 && cp<=0xFF5A) || cp===0xFF3F;
  }
  function _isKanaCp(cp){
    // Hiragana, Katakana, Halfwidth Katakana, plus middle dot/prolong mark within range
    return (cp>=0x3040 && cp<=0x309F) || (cp>=0x30A0 && cp<=0x30FF) || (cp>=0xFF66 && cp<=0xFF9D) || cp===0x30FC || cp===0x30FB;
  }
  function _isHanCp(cp){
    // CJK Unified Ideographs + Extension A + Compatibility
    return (cp>=0x4E00 && cp<=0x9FFF) || (cp>=0x3400 && cp<=0x4DBF) || (cp>=0xF900 && cp<=0xFAFF);
  }
  function _wordTypeAtInLine(line, idx){
    const cp = _cpAt(line, idx);
    if (cp < 0) return _WT_SPACE; // treat invalid as space boundary
    if (_isSpaceCp(cp)) return _WT_SPACE;
    if (_isAsciiWordCp(cp) || _isFullwidthAlnumCp(cp)) return _WT_ALNUM;
    if (_isKanaCp(cp)) return _WT_KANA;
    if (_isHanCp(cp)) return _WT_HAN;
    return _WT_SYMBOL;
  }
  function _nextWordStart(row, col){
    const lines = _splitLines();
    let r = row, c = col;
    for(;;){
      if (r >= lines.length) return { r: Math.max(0, lines.length-1), c: _lineLen(Math.max(0, lines.length-1)) };
      const line = lines[r] || '';
      const n = line.length;
      if (c < 0) c = 0;
      if (c > n) c = n;
      // At end-of-line: treat stepping to start of next line as one 'w' unit (counts each newline) (#701)
      if (c >= n){
        // #702: Group consecutive newlines as one whitespace run. Skip all empty lines,
        // then land on the first non-space column of the next non-empty line.
        let r2 = r + 1;
        while (r2 < lines.length && (lines[r2]||'') === ''){ r2++; }
        if (r2 >= lines.length){ return { r, c: n }; }
        const line2 = lines[r2] || '';
        let c2 = 0;
        while (c2 < line2.length && _wordTypeAtInLine(line2, c2) === _WT_SPACE){ c2 = _nextIndex(line2, c2); }
        return { r: r2, c: c2 };
      }
      // If on spaces within the line, jump to the next non-space within this line (spaces as one unit)
      let t = _wordTypeAtInLine(line, c);
      if (t === _WT_SPACE){
        while (c < n && _wordTypeAtInLine(line, c) === _WT_SPACE){ c = _nextIndex(line, c); }
        if (c < n) return { r, c };
        // fell off end; next loop iteration will treat newline as its own step
        continue;
      }
      // In a non-space run: leave the current run and stop right after it (do not skip following spaces) (#701)
      const tRun = t;
      while (c < n && _wordTypeAtInLine(line, c) === tRun){ c = _nextIndex(line, c); }
      return { r, c };
    }
  }
  function _prevWordStart(row, col){
    const lines = _splitLines();
    let r = row, c = col;
    for(;;){
      if (r < 0) return { r:0, c:0 };
      const line = (r>=0 && r<lines.length) ? (lines[r]||'') : '';
      const n = line.length;
      if (c > n) c = n;
      // At start-of-line: jump across consecutive empty lines to the previous non-empty line end (grouped) (#702)
      if (c === 0){
        let r2 = r - 1;
        while (r2 >= 0 && (lines[r2]||'') === ''){ r2--; }
        if (r2 >= 0){ return { r: r2, c: (lines[r2]||'').length }; }
        return { r:0, c:0 };
      }
      // Move left one code point, then if on spaces skip leftward spaces; otherwise, move to start of the current run
      c = _prevIndex(line, c);
      // If landed within spaces, skip spaces (but stay on the same line)
      while (c >= 0 && _wordTypeAtInLine(line, c) === _WT_SPACE){
        if (c === 0) break;
        c = _prevIndex(line, c);
      }
      if (c < 0){ return { r: Math.max(0, r-1), c: _lineLen(Math.max(0, r-1)) }; }
      const tRun = _wordTypeAtInLine(line, c);
      while (c > 0){
        const prev = _prevIndex(line, c);
        if (prev < 0) break;
        if (_wordTypeAtInLine(line, prev) !== tRun) break;
        c = prev;
      }
      return { r, c };
    }
  }
  function _moveWordW(count){ let r=caretRow, c=caretCol; const times=Math.max(1,count|0); for(let i=0;i<times;i++){ const p=_nextWordStart(r,c); r=p.r; c=p.c; } _setCaret(r,c); }
  function _moveWordB(count){ let r=caretRow, c=caretCol; const times=Math.max(1,count|0); for(let i=0;i<times;i++){ const p=_prevWordStart(r,c); r=p.r; c=p.c; } _setCaret(r,c); }
  // WORD (capital W/B) motions: treat any non-space run as one WORD
  function _nextWORDStart(row, col){
    const lines = _splitLines();
    let r = row, c = col;
    for(;;){
      if (r >= lines.length) return { r: lines.length-1, c: _lineLen(lines.length-1) };
      const line = lines[r] || '';
      const n = line.length;
      if (c > n) c = n;
      if (c >= n){ r++; c = 0; continue; }
      // skip spaces first
      while (c < n && _wordTypeAtInLine(line, c) === _WT_SPACE){ c = _nextIndex(line, c); }
      if (c < n){
        // in a non-space run: leave this run, then skip spaces to the next start
        while (c < n && _wordTypeAtInLine(line, c) !== _WT_SPACE){ c = _nextIndex(line, c); }
        while (c < n && _wordTypeAtInLine(line, c) === _WT_SPACE){ c = _nextIndex(line, c); }
        if (c < n) return { r, c };
      }
      r++; c = 0;
    }
  }
  function _prevWORDStart(row, col){
    const lines = _splitLines();
    let r = row, c = col;
    for(;;){
      if (r < 0) return { r:0, c:0 };
      const line = (r>=0 && r<lines.length) ? (lines[r]||'') : '';
      const n = line.length;
      if (c > n) c = n;
      if (c > 0){
        // step left one code point first
        c = _prevIndex(line, c);
        // skip spaces to the left
        while (c >= 0 && _wordTypeAtInLine(line, c) === _WT_SPACE){
          if (c === 0){ c = -1; break; }
          c = _prevIndex(line, c);
        }
        if (c < 0){ r--; c = (r>=0 ? (lines[r]||'').length : 0); continue; }
        // move to start of this non-space run
        while (c > 0){
          const prev = _prevIndex(line, c);
          if (prev < 0) break;
          if (_wordTypeAtInLine(line, prev) === _WT_SPACE) break;
          c = prev;
        }
        return { r, c };
      } else {
        r--; c = (r>=0 ? (lines[r]||'').length : 0);
      }
    }
  }
  function _moveWORDW(count){ let r=caretRow, c=caretCol; const times=Math.max(1,count|0); for(let i=0;i<times;i++){ const p=_nextWORDStart(r,c); r=p.r; c=p.c; } _setCaret(r,c); }
  function _moveWORDB(count){ let r=caretRow, c=caretCol; const times=Math.max(1,count|0); for(let i=0;i<times;i++){ const p=_prevWORDStart(r,c); r=p.r; c=p.c; } _setCaret(r,c); }
  function _moveParagraphNext(count){ const lines=_splitLines(); let r=caretRow; const times=Math.max(1,count|0); for(let i=0;i<times;i++){ let j=r+1; while (j<lines.length && !/^\s*$/.test(lines[j]||'')) j++; while (j<lines.length && /^\s*$/.test(lines[j]||'')) j++; if (j>=lines.length){ r=lines.length-1; break; } r=j; } const col=_firstNonBlankColOf(lines[r]||''); _setCaret(r,col); }
  function _moveParagraphPrev(count){ const lines=_splitLines(); let r=caretRow; const times=Math.max(1,count|0); for(let i=0;i<times;i++){ let j=r-1; while (j>=0 && !/^\s*$/.test(lines[j]||'')) j--; while (j>=0 && /^\s*$/.test(lines[j]||'')) j--; if (j<0){ r=0; break; } let k=j; while (k>0 && !/^\s*$/.test(lines[k-1]||'')) k--; r=k; } const col=_firstNonBlankColOf(lines[r]||''); _setCaret(r,col); }

  /*********************************************************
   * runCommand (:N)
   *********************************************************/
  async function runCommand(cmd){
    // '/' and '?' — regex search with optional trailing flags (e.g., /foo/i)
    // Accept both '/...' and ':/...' (cmdinput may prefix ':')
    try{
      const mF = cmd && cmd.match(/^:?\s*\/(.*?)(?:\/([A-Za-z]*))?\s*$/);
      const mB = (!mF && cmd) ? cmd.match(/^:?\s*\?(.*?)(?:\?([A-Za-z]*))?\s*$/) : null;
      if (mF || mB){
        const forward = !!mF;
        let pat = String((forward?mF[1]:mB[1])||'');
        const flagsGiven = String((forward?mF[2]:mB[2])||'');
        // ユーザ入力の \n / \t を実際の改行・TABへ展開（直前がさらにバックスラッシュの場合はリテラル保持） (#692)
        try{
          pat = pat.replace(/(?<!\\)\\n/g,'\n').replace(/(?<!\\)\\t/g,'\t');
        }catch{ try{ pat = pat.replace(/\\n/g,'\n').replace(/\\t/g,'\t'); }catch{} }
        if (!pat && _lastSearch){ pat = _lastSearch.src; }
        if (pat){
          const dir = forward? 'fwd':'bwd';
          // Case sensitivity: explicit /i or /I override; otherwise buffer ignorecase(+smartcase) (#696)
          let explicitInsensitive = /i/.test(flagsGiven);
          let explicitSensitive   = /I/.test(flagsGiven);
          let needI = false;
          if (explicitInsensitive){ needI = true; }
          else if (explicitSensitive){ needI = false; }
          else {
            try{
              const b=currentBuffer();
              const ic = !!(b&&b.ignorecase);
              const sc = !!(b&&b.smartcase);
              if (ic){
                if (sc && /[A-Z]/.test(pat)){ needI = false; }
                else { needI = true; }
              }
            }catch{}
          }
          const flags = needI ? 'i' : '';
          // Use the stable anchor captured when entering the search prompt so
          // confirmation jumps to the nearest match from the original caret.
          const fromOff = (function(){
            try{
              if (typeof _incSearchAnchorOff === 'number' && _incSearchAnchorOff >= 0){ return (_incSearchAnchorOff|0); }
              return _offsetFromRC(caretRow, caretCol)|0;
            }catch{ return 0; }
          })();
          // Include current position for initial forward search by subtracting 1 (search core skips current by +1) (#690)
          // Allow -1 to include index 0 match.
          const effectiveFrom = (dir==='fwd') ? (fromOff-1) : fromOff;
          const res = _searchFindNext(pat, flags, dir, effectiveFrom, true);
          if (res && Number.isFinite(res.start)){
            try{
              const rc = _rcFromOffset(res.start);
              caretRow = rc.r; caretCol = rc.c;
              // Keep the current viewport stable while syncing the native selection
              // to the overlay caret. Setting selection can auto-scroll the textarea.
              const stPrev = (editor.scrollTop||0);
              _syncNativeSelectionToCaret();
              try{ editor.scrollTop = stPrev; }catch{}
              // Do NOT scroll here even if scrolloff would normally re-center.
              // The match is visible thanks to incremental preview; pause once.
              _scrolloffPaused = true; _scrolloffPauseAnchorR = rc.r; _scrolloffPauseAnchorC = rc.c;
              _repositionCaret(); updateGutter();
              // Preserve original direction separately so 'n' keeps the original
              // and 'N' always uses the inverse of that original (avoid bouncing between two matches).
              const explicitCase = explicitInsensitive ? 'i' : (explicitSensitive ? 'I' : '');
              _lastSearch = { src: pat, flags: flags||'', dir, origDir: dir, explicitCase };
              _updateHlsearchFull();
            }catch{}
          } else {
            toast('no match');
            try{ _triggerVisualBell(); }catch{}
          }
          // Clear the incremental search anchor after a confirmed search
          try{ _incSearchAnchorOff = null; }catch{}
          return;
        }
      }
    }catch{}

    // :s and :%s — substitute, with flags [g][i][c]
    try{
      const ms = cmd && cmd.match(/^:?\s*(%|'<,'>)?\s*s(?:ubstitute)?\/(.*?)\/(.*?)(?:\/([A-Za-z]*))?\s*$/i);
      if (ms){
        const rangeTok = String(ms[1]||'');
        const isAll = (rangeTok === '%');
        const pat = String(ms[2]||'');
        const repl = String(ms[3]||'');
  const flagsGiven = String(ms[4]||'');
  // Validate flags: allow g i I c n (I=force case-sensitive) (#696)
  const invalid = flagsGiven.replace(/[giIcn]/g, '');
  if (invalid){ toast('invalid flags: ' + invalid); try{ _triggerVisualBell(); }catch{} return; }
  if (!pat){ toast('empty pattern'); try{ _triggerVisualBell(); }catch{} return; }
  // Determine case flag: explicit i / I overrides buffer ignorecase+smartcase
  let wantI = null; // true=insensitive, false=sensitive, null=defer to buffer opts
  if (/i/.test(flagsGiven)) wantI = true;
  if (/I/.test(flagsGiven)) wantI = false; // if both present, I wins (later assignment)
  if (wantI==null){
    try{
      const b=currentBuffer(); const ic=!!(b&&b.ignorecase); const sc=!!(b&&b.smartcase);
      if (ic){ if (sc && /[A-Z]/.test(pat)){ wantI=false; } else { wantI=true; } }
    }catch{}
  }
  // Always multiline so ^/$ anchor per line; add i if needed
  let reFlags = 'm';
  if (wantI===true) reFlags += 'i';
        // We'll use a global regex for scan; per-line non-g behavior is handled manually
        let reAll = null; try{ reAll = new RegExp(pat, reFlags+'g'); }catch{ reAll=null; }
  if (!reAll){ toast('invalid pattern'); try{ _triggerVisualBell(); }catch{} return; }
  const wantGlobalPerLine = /g/.test(flagsGiven);
    const reportOnly = /n/.test(flagsGiven);
    const needConfirm = /c/.test(flagsGiven) && !reportOnly;

  const orig = String(editor.value||'');
  // Capture pre-substitute snapshot upfront and push it at the end iff any change occurred (#312)
  const _preSubSnap = _makeSnapshot();

        // Helper to preview a match in current evolving text without causing visible scroll
        function previewAt(start,len, textForPreview){
          try{
            const stKeep = (editor && typeof editor.scrollTop === 'number') ? editor.scrollTop : 0;
            editor.value = textForPreview; // show live text for correct measurement
            try{ editor.scrollTop = stKeep; }catch{}
            const rc = _rcFromOffset(start);
            caretRow = rc.r; caretCol = rc.c;
            // Sync native selection to overlay caret, but immediately restore scrollTop
            try{ const stSel = editor.scrollTop; _syncNativeSelectionToCaret(); editor.scrollTop = stSel; }catch{}
            // ensureScrolloff() is suppressed during modal by caller, but safe to call
            ensureScrolloff();
            _repositionCaret(); updateGutter();
            _incPrevShowAt(start, len);
            // Keep visual selection overlay visible during the confirm modal
            try{ _renderVisSelOverlay(); }catch{}
          }catch{}
        }

  let replaced = 0;
  let firstReplaceStart = -1;

  const inVisual = (!!_visualActive) || (rangeTok === "'<,'>");
        if (isAll){
          // Whole buffer
          let text = orig;
          let acceptAll = false;
          const seenLineFirst = new Set();
          // For report-only: track unique affected lines regardless of g
          const affectedRows = new Set();
          // Decision stack for step-back undo (store state before a decision is made)
          const _decStack = [];
          // helper: compute row index from absolute offset within evolving `text`
          const rowFromOffAll = (off)=>{
            try{
              let idx = 0, row=0;
              while (true){
                const p = text.indexOf('\n', idx);
                if (p<0 || p>=off) return row;
                row++; idx = p+1;
              }
            }catch{ return 0; }
          };
          reAll.lastIndex = 0; let m;
          while ((m = reAll.exec(text))){
            const start = m.index|0; const len = ((m[0]||'').length|0); if (!(len>0)) { reAll.lastIndex++; continue; }
            // Per-line non-g: only first per line
            let row=0; try{ row = rowFromOffAll(start)|0; }catch{}
            if (!wantGlobalPerLine){ if (seenLineFirst.has(row)) continue; seenLineFirst.add(row); }
            let doReplace = true;
            if (needConfirm && !acceptAll){
              // count remaining if All now
              const countRemaining = (()=>{
                try{
                  const tempSeen = new Set(seenLineFirst);
                  const rc = new RegExp(pat, reFlags+'g');
                  rc.lastIndex = start; // include current match
                  let cnt = 0; let mm;
                  while ((mm = rc.exec(text))){
                    const st = (mm.index|0); const ln = ((mm[0]||'').length|0); if (!(ln>0)){ rc.lastIndex++; continue; }
                    let r0=0; try{ r0 = rowFromOffAll(st)|0; }catch{}
                    if (!wantGlobalPerLine){ if (tempSeen.has(r0)) continue; tempSeen.add(r0); }
                    cnt++;
                  }
                  return cnt|0;
                }catch{ return 0; }
              })();
              // Push snapshot before asking (for step-back undo)
              _decStack.push({
                text,
                resumeIndex: start,
                replacedBefore: replaced,
                firstReplaceStartBefore: firstReplaceStart,
                seenLineFirst: new Set(seenLineFirst)
              });
              // Suppress automatic scroll adjustments while the confirm modal is shown
              // to avoid viewport jumps when the modal opens.
              const stBeforeModal = (editor && typeof editor.scrollTop === 'number') ? editor.scrollTop : 0;
              try{
                _suppressScrollDuringModal = true;
                // Also suppress scroll snapping while modal is up
                try{ _zoomGuardUntil = Date.now() + 2000; }catch{}
                previewAt(start, len, text);
                const cmdLabel = ':' + (isAll? '%s' : 's') + '/' + pat + '/' + repl + '/' + flagsGiven;
                const ch = await _subConfirmModal((countRemaining>0? (countRemaining+" matches left.\n") : '') + 'Replace this match?', { cmdLabel, canUndo: (_decStack.length>=2) });
                if (ch==='q'){ _incPrevHide(); break; }
                else if (ch==='u'){
                  // Step back to previous decision (if any). Also move the scan pointer back.
                  _incPrevHide();
                  const before = text;
                  // Discard snapshot for current candidate; keep the previous one to allow multi-step undo
                  if (_decStack.length >= 2){
                    _decStack.pop();
                    let prev = _decStack[_decStack.length-1];
                    // If prev produces no visible change (duplicate snapshot), try stepping back one more (#309)
                    if (prev && String(prev.text||'') === String(before||'') && _decStack.length >= 2){
                      _decStack.pop();
                      prev = _decStack[_decStack.length-1];
                    }
                    if (prev){
                      text = prev.text;
                      replaced = prev.replacedBefore|0;
                      firstReplaceStart = (prev.firstReplaceStartBefore|0);
                      // restore seen per-line state
                      try{ if (prev.seenLineFirst){
                        seenLineFirst.clear();
                        prev.seenLineFirst.forEach(v=> seenLineFirst.add(v));
                      } }catch{}
                      // restore scan position to re-show that previous match
                      try{ reAll.lastIndex = Math.max(0, prev.resumeIndex|0); }catch{}
                      continue;
                    }
                  }
                  // nothing to undo; re-show current match
                  try{ reAll.lastIndex = Math.max(0, start|0); }catch{}
                  try{ if (!wantGlobalPerLine){ seenLineFirst.delete(row); } }catch{}
                  continue;
                }
                else if (ch==='a'){ acceptAll=true; doReplace=true; }
                else if (ch==='y'){ doReplace=true; }
                else if (ch==='n'){ doReplace=false; }
                else { doReplace=false; }
              } finally {
                _suppressScrollDuringModal = false;
                try{ if (editor) editor.scrollTop = stBeforeModal; }catch{}
              }
            }
            if (doReplace){
              if (reportOnly){
                replaced++; if (firstReplaceStart<0) firstReplaceStart = start;
                try{ affectedRows.add(row); }catch{}
                // Do not mutate text; lastIndex already advanced by exec
              } else {
                const rep = _expandReplacement(repl, m);
                text = text.slice(0, start) + rep + text.slice(start + len);
                replaced++; if (firstReplaceStart<0) firstReplaceStart = start;
                reAll.lastIndex = start + rep.length;
              }
            }
          }
          _incPrevHide();
          if (reportOnly){ editor.value = orig; toast(replaced + ' matches on ' + affectedRows.size + ' lines'); }
          else if (replaced>0){ editor.value = text; _touchBufferModified(); try{ _pushUndoSnapshotObj('substitute', _preSubSnap); }catch{} }
          else { editor.value = orig; toast('replaced: 0'); }
        } else if (inVisual){
          // Visual selection range only (character-wise or line-wise)
          // Determine absolute selection range [selStart, selEnd)
          let selStart = 0, selEnd = 0;
          try{
            // '<,'> が明示されており、かつ CMD エントリ時の VISUAL スナップショットがあればそれを優先
            const useSnap = (rangeTok === "'<,'>" && _visCmdActive);
            const linewiseNow = useSnap ? _visCmdLinewise : _visualLinewise;
            if (linewiseNow){
              const aR = useSnap ? (_visCmdAnchorR|0) : (_visualAnchorR|0);
              const aC = useSnap ? (_visCmdAnchorC|0) : (_visualAnchorC|0); // 未使用（整合のため保持）
              const bR = useSnap ? (_visCmdCaretR|0)  : (caretRow|0);
              const rs = Math.min(aR, bR);
              const re = Math.max(aR, bR);
              selStart = _offsetFromRC(rs, 0)|0;
              const linesAll = _splitLines();
              const lastLen = String(linesAll[re]||'').length;
              selEnd = _offsetFromRC(re, lastLen)|0;
            } else {
              const aR = useSnap ? (_visCmdAnchorR|0) : (_visualAnchorR|0);
              const aC = useSnap ? (_visCmdAnchorC|0) : (_visualAnchorC|0);
              const bR = useSnap ? (_visCmdCaretR|0)  : (caretRow|0);
              const bC = useSnap ? (_visCmdCaretC|0)  : (caretCol|0);
              const sOff = _offsetFromRC(aR, aC)|0;
              const eOff = _offsetFromRC(bR, bC)|0;
              selStart = Math.min(sOff, eOff)|0;
              selEnd = Math.max(sOff, eOff)|0;
            }
          }catch{ selStart=0; selEnd=0; }
          if (!(selEnd>selStart)){
            // empty selection → nothing to do
            toast('replaced: 0');
            try{ _exitVisual(); }catch{}
            // CMD 由来の VISUAL スナップショットは消去
            _visCmdActive = false; _cmdFromVisual = false;
            return;
          }
          const pre = orig.slice(0, selStart);
          let mid = orig.slice(selStart, selEnd);
          const post = orig.slice(selEnd);
          // For scanning within the selection, clone regex for this scope
          let reMid = null; try{ reMid = new RegExp(pat, reFlags + 'g'); }catch{ reMid=null; }
          if (!reMid){ toast('invalid pattern'); try{ _triggerVisualBell(); }catch{} try{ _exitVisual(); }catch{} return; }
          const seenLineFirst = new Set(); // track first match per (relative) line when !g
          // For report-only: count unique relative rows within selection
          const affectedRows = new Set();
          const linesInMid = mid.split('\n');
          // helper: row index in mid from offset
          const midRowFromOff = (off)=>{
            try{
              let idx = 0, row=0;
              while (true){
                const p = mid.indexOf('\n', idx);
                if (p<0 || p>=off) return row;
                row++; idx = p+1;
              }
            }catch{ return 0; }
          };
          let m; reMid.lastIndex = 0; let acceptAll=false; const _decStackSel = [];
          while ((m = reMid.exec(mid))){
            const startInMid = m.index|0; const len = ((m[0]||'').length|0); if (!(len>0)){ reMid.lastIndex++; continue; }
            // Per-line non-g: only first per relative line
            let doReplace = true;
            let relRow = 0; try{ relRow = midRowFromOff(startInMid)|0; }catch{ relRow=0; }
            if (!wantGlobalPerLine){ if (seenLineFirst.has(relRow)) continue; }
            if (needConfirm && !acceptAll){
              const absStart = selStart + startInMid;
              // Preview using composed text (orig with current mid)
              const textForPreview = pre + mid + post;
              // count remaining within selection if All now
              const countRemaining = ( ()=>{
                try{
                  const rc = new RegExp(pat, reFlags+'g');
                  rc.lastIndex = startInMid; // include current match
                  let cnt=0; let mm; const tempSeen = new Set(seenLineFirst);
                  while ((mm = rc.exec(mid))){ const ln = ((mm[0]||'').length|0); if (!(ln>0)){ rc.lastIndex++; continue; }
                    const st = (mm.index|0); let rr=0; try{ rr = midRowFromOff(st)|0; }catch{}
                    if (!wantGlobalPerLine){ if (tempSeen.has(rr)) continue; tempSeen.add(rr); }
                    cnt++; }
                  return cnt|0;
                }catch{ return 0; }
              })();
              _decStackSel.push({ mid, resumeIndex: startInMid, replacedBefore: replaced, firstReplaceStartBefore: firstReplaceStart, seenLineFirst: new Set(seenLineFirst) });
              const stBeforeModal = (editor && typeof editor.scrollTop === 'number') ? editor.scrollTop : 0;
              try{
                _suppressScrollDuringModal = true;
                try{ _zoomGuardUntil = Date.now() + 2000; }catch{}
                previewAt(absStart, len, textForPreview);
                const cmdLabel = ':' + 's' + '/' + pat + '/' + repl + '/' + flagsGiven;
                const ch = await _subConfirmModal((countRemaining>0? (countRemaining+" matches left.\n") : '') + 'Replace this match?', { cmdLabel, canUndo: (_decStackSel.length>=2) });
                if (ch==='q'){ _incPrevHide(); break; }
                else if (ch==='u'){
                  _incPrevHide();
                  const before = mid;
                  if (_decStackSel.length >= 2){
                    _decStackSel.pop();
                    let prev = _decStackSel[_decStackSel.length-1];
                    if (prev && String(prev.mid||'') === String(before||'') && _decStackSel.length >= 2){
                      _decStackSel.pop();
                      prev = _decStackSel[_decStackSel.length-1];
                    }
                    if (prev){
                      mid = prev.mid;
                      replaced = prev.replacedBefore|0;
                      firstReplaceStart = (prev.firstReplaceStartBefore|0);
                      seenLineFirst.clear();
                      try{ prev.seenLineFirst.forEach(v=> seenLineFirst.add(v)); }catch{}
                      try{ reMid.lastIndex = Math.max(0, prev.resumeIndex|0); }catch{}
                      continue;
                    }
                  }
                  { try{ reMid.lastIndex = Math.max(0, startInMid|0); }catch{}; continue; }
                }
                else if (ch==='a'){ acceptAll=true; doReplace=true; }
                else if (ch==='y'){ doReplace=true; }
                else if (ch==='n'){ doReplace=false; }
                else { doReplace=false; }
              } finally {
                _suppressScrollDuringModal = false; try{ if (editor) editor.scrollTop = stBeforeModal; }catch{}
              }
            }
            if (doReplace){
              if (reportOnly){
                replaced++; if (firstReplaceStart<0) firstReplaceStart = selStart + startInMid;
                try{ affectedRows.add(relRow); }catch{}
                if (!wantGlobalPerLine){ seenLineFirst.add(relRow); }
                // Do not mutate mid; lastIndex already advanced by exec
                if (!wantGlobalPerLine){ /* only first per line counted */ }
              } else {
                const rep = _expandReplacement(repl, m);
                mid = mid.slice(0, startInMid) + rep + mid.slice(startInMid + len);
                replaced++; if (firstReplaceStart<0) firstReplaceStart = selStart + startInMid;
                reMid.lastIndex = startInMid + rep.length;
                if (!wantGlobalPerLine){ seenLineFirst.add(relRow); }
              }
            }
          }
          _incPrevHide();
          if (reportOnly){ editor.value = orig; toast(replaced + ' matches on ' + affectedRows.size + ' lines'); }
          else if (replaced>0){ editor.value = pre + mid + post; _touchBufferModified(); try{ _pushUndoSnapshotObj('substitute', _preSubSnap); }catch{} }
          else { editor.value = orig; toast('replaced: 0'); }
          try{ _exitVisual(); }catch{}
          // スナップショット/フラグをクリア
          _visCmdActive = false; _cmdFromVisual = false;
        } else {
          // Current line only
          const lines = _splitLines();
          const r = Math.max(0, Math.min(lines.length-1, caretRow|0));
          const line = String(lines[r]||'');
          // For scanning within the line, clone regex for this scope
          let reLine = null; try{ reLine = new RegExp(pat, reFlags + 'g'); }catch{ reLine=null; }
          if (!reLine){ toast('invalid pattern'); try{ _triggerVisualBell(); }catch{} return; }
          const affectedRows = new Set();
          let m; reLine.lastIndex = 0; let accLine = line; let acceptAll=false; let baseStartOff = (function(){ try{ return _offsetFromRC(r,0)|0; }catch{ return 0; } })();
          const _decStackLine = [];
          while ((m = reLine.exec(accLine))){
            const startInLine = m.index|0; const len = ((m[0]||'').length|0); if (!(len>0)) { reLine.lastIndex++; continue; }
            // non-g per line: only first match
            let doReplace = true;
            if (!wantGlobalPerLine && reLine.lastIndex>0 && replaced>=0){
              // Already replaced one? Then skip further (we'll end after this continue)
              // Implement by flagging after a replace below
            }
            if (needConfirm && !acceptAll){
              const absStart = baseStartOff + startInLine;
              // Preview using composed text (orig with current accLine)
              const textForPreview = orig.slice(0, baseStartOff) + accLine + orig.slice(baseStartOff + line.length);
              // count remaining for this line if All now
              const countRemaining = (()=>{
                try{
                  const rc = new RegExp(pat, reFlags+'g');
                  rc.lastIndex = startInLine; // include current match
                  let cnt = 0; let mm;
                  while ((mm = rc.exec(accLine))){ const ln = ((mm[0]||'').length|0); if (!(ln>0)){ rc.lastIndex++; continue; } cnt++; if (!wantGlobalPerLine) break; }
                  return cnt|0;
                }catch{ return 0; }
              })();
              _decStackLine.push({
                accLine,
                resumeIndex: startInLine,
                replacedBefore: replaced,
                firstReplaceStartBefore: firstReplaceStart
              });
              // Suppress automatic scroll adjustments while the confirm modal is shown
              const stBeforeModalLine = (editor && typeof editor.scrollTop === 'number') ? editor.scrollTop : 0;
              try{
                _suppressScrollDuringModal = true;
                try{ _zoomGuardUntil = Date.now() + 2000; }catch{}
                previewAt(absStart, len, textForPreview);
                const cmdLabel = ':' + (isAll? '%s' : 's') + '/' + pat + '/' + repl + '/' + flagsGiven;
                const ch = await _subConfirmModal((countRemaining>0? (countRemaining+" matches left.\n") : '') + 'Replace this match?', { cmdLabel, canUndo: (_decStackLine.length>=2) });
                if (ch==='q'){ _incPrevHide(); break; }
                else if (ch==='u'){
                  _incPrevHide();
                  const before = accLine;
                  if (_decStackLine.length >= 2){
                    _decStackLine.pop();
                    let prev = _decStackLine[_decStackLine.length-1];
                    if (prev && String(prev.accLine||'') === String(before||'') && _decStackLine.length >= 2){
                      _decStackLine.pop();
                      prev = _decStackLine[_decStackLine.length-1];
                    }
                    if (prev){
                      accLine = prev.accLine;
                      replaced = prev.replacedBefore|0;
                      firstReplaceStart = (prev.firstReplaceStartBefore|0);
                      try{ reLine.lastIndex = Math.max(0, prev.resumeIndex|0); }catch{}
                      continue;
                    }
                  }
                  // nothing to undo; re-show current match
                  try{ reLine.lastIndex = Math.max(0, startInLine|0); }catch{}
                  continue;
                }
                else if (ch==='a'){ acceptAll=true; doReplace=true; }
                else if (ch==='y'){ doReplace=true; }
                else if (ch==='n'){ doReplace=false; }
                else { doReplace=false; }
              } finally {
                _suppressScrollDuringModal = false;
                try{ if (editor) editor.scrollTop = stBeforeModalLine; }catch{}
              }
            }
            if (doReplace){
              if (reportOnly){
                replaced++; if (firstReplaceStart<0) firstReplaceStart = baseStartOff + startInLine;
                try{ affectedRows.add(0); }catch{}
                if (!wantGlobalPerLine) { break; }
              } else {
                const rep = _expandReplacement(repl, m);
                accLine = accLine.slice(0, startInLine) + rep + accLine.slice(startInLine + len);
                replaced++; if (firstReplaceStart<0) firstReplaceStart = baseStartOff + startInLine;
                reLine.lastIndex = startInLine + rep.length;
                if (!wantGlobalPerLine) { break; }
              }
            }
          }
          _incPrevHide();
          if (reportOnly){ editor.value = orig; toast(replaced + ' matches on ' + affectedRows.size + ' lines'); }
          else if (replaced>0){
            lines[r] = accLine; const out = lines.join('\n'); editor.value = out; _touchBufferModified(); try{ _pushUndoSnapshotObj('substitute', _preSubSnap); }catch{}
          } else { editor.value = orig; toast('replaced: 0'); }
        }

        if (!reportOnly){
          if (replaced>0){
            try{
              const pos = (firstReplaceStart>=0? firstReplaceStart : 0);
              const rc = _rcFromOffset(pos);
              caretRow = rc.r; caretCol = rc.c;
              // Suppress the first scrolloff after substitute finishes (#306)
              _scrolloffPaused = true; _scrolloffPauseAnchorR = rc.r; _scrolloffPauseAnchorC = rc.c;
              // Keep native selection in sync without moving viewport
              const stKeep = (editor && typeof editor.scrollTop === 'number') ? editor.scrollTop : 0;
              _syncNativeSelectionToCaret();
              try{ editor.scrollTop = stKeep; }catch{}
              // Snap scrollTop to the nearest line boundary to avoid half-line state (#307)
              try{
                const snapped = Math.round((editor.scrollTop||0)/LINE_HEIGHT)*LINE_HEIGHT;
                if (Math.abs(snapped - (editor.scrollTop||0)) > 0.1){ editor.scrollTop = snapped; }
              }catch{}
            }catch{}
            _repositionCaret(); updateGutter(); _renderHlMatchesVisible(); toast('replaced: ' + replaced, 1500);
          } else {
            // 置換無し: undo スナップショットは作っていない（lazy push）ので特別な後始末は不要
          }
        }
        try{ _incSearchAnchorOff = null; }catch{}
        // Ensure we always return to NORMAL mode after :s completes, and clear any pending ops/counts.
        try{ _setMode('NORMAL'); _clearPending(); _clearPendingOp(); }catch{}
        try{ setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0); }catch{}
        return;
      }
    }catch{}
    // :help — ヘルプモーダルを表示（[コマンド]タブをデフォルト選択）
    if (/^:help\b/i.test(cmd||'')){
      // CMD 中に呼ばれた場合は、閉じた後も CMD を維持（#533/#534）
      const restoreMode = (_mode === 'CMD') ? 'CMD' : _mode;
      try{ await helpModal({ defaultTab: 'cmd', restoreMode }); }catch{}
      // helpModal 側で事前モードへ復帰するため、ここではモード切替しない
      try{ setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0); }catch{}
      return;
    }

    // :b [N|query] — Enter で確定（数字のみは優先）
    if (/^:b/i.test(cmd)){
      const mNum = cmd.match(/^:b\s*(\d+)\s*$/i);
      if (mNum){
        const nArg = parseInt(mNum[1],10);
        if (Number.isFinite(nArg) && nArg>=1 && nArg<=buffers.length){
          // 事前に現在の scrollTop を保存（同一バッファ選択時に視界を完全維持するため）
          let st0 = 0; try{ st0 = (editor && typeof editor.scrollTop==='number') ? (editor.scrollTop|0) : 0; }catch{}
          // Esc 相当の終了処理を行ってから切替（ユーザー操作「Esc→F{n}」と同等の経路）
          try{ _cmdExitAndRestoreView({ forImmediateSwitch:true }); }catch{}
          const absIdx = (nArg-1)|0;
          setTimeout(()=>{ try{ if (absIdx !== currentIdx){ _switchToBuffer(absIdx); } else { _keepViewportNoop(st0); } }catch{} }, 0);
          try{ setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0); }catch{}
          return;
        }
      }
      if (_bufPopupVisible()){
        // 現在の可視リストから選択アイテムの絶対インデックスへマップ
        const list = _bufPopupComputeList ? _bufPopupComputeList() : buffers.map((b,i)=>({b,i}));
        if (list.length === 0){
          // 無該当
          const q = (_bufFilter||'').trim();
              if (q) { toast('No such buffer: ' + q); try{ _triggerVisualBell(); }catch{} }
          try{ _bufPopupHide(); }catch{}
          try{ _setMode('NORMAL'); }catch{}
          try{ if (cmdinput){ cmdinput.value=''; try{ cmdinput.dispatchEvent(new Event('input', { bubbles:true })); }catch{} } }catch{}
      return;
        }
        const visIdx = Math.max(0, Math.min(list.length-1, _bufSel));
        const absIdx = (list[visIdx] ? list[visIdx].i : currentIdx);
        // 事前に現在の scrollTop を保存（同一バッファ選択時に視界を完全維持するため）
        let st0 = 0; try{ st0 = (editor && typeof editor.scrollTop==='number') ? (editor.scrollTop|0) : 0; }catch{}
        // Esc 相当の終了処理を行ってから切り替え（ユーザー操作「Esc→F{n}」と同等の経路）
        try{ _cmdExitAndRestoreView({ forImmediateSwitch:true }); }catch{}
        if (Number.isFinite(absIdx)){
          setTimeout(()=>{ try{ if (absIdx !== currentIdx) _switchToBuffer(absIdx); else _keepViewportNoop(st0); }catch{} }, 0);
        }
        try{ setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0); }catch{}
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
      // 行ジャンプ直後に他の描画でスクロールが揺れるのを抑止
      const targetTop = editor.scrollTop;
      _scrollGuardUntil = Date.now() + 900;
      const reinforce = ()=>{ try{ editor.scrollTop = targetTop; _repositionCaret(); updateGutter(); }catch{} };
      reinforce();
      try{ if (window.requestAnimationFrame){ requestAnimationFrame(()=>{ reinforce(); requestAnimationFrame(()=>reinforce()); }); } }catch{}
      try{ setTimeout(reinforce, 140); }catch{}
      // 直後にタブ切替してもこのジャンプ位置が確実に記憶されるよう、即時にビュー状態を保存 (#359)
      try{
        const b = currentBuffer();
        if (b){
          b.viewRow = caretRow|0;
          b.viewCol = caretCol|0;
          b.viewScrollTop = (editor.scrollTop||0)|0;
        }
      }catch{}
      // レイアウト確定後にももう一度保存して、最終的なscrollTopをベースラインにする
      try{
        const persist = ()=>{ try{ const bb=currentBuffer(); if (bb){ bb.viewRow=caretRow|0; bb.viewCol=caretCol|0; bb.viewScrollTop=(editor.scrollTop||0)|0; } }catch{} };
        if (window.requestAnimationFrame){ requestAnimationFrame(persist); }
        setTimeout(persist, 80);
      }catch{}
      _setMode('NORMAL');
      return;
    }
    // :q — quit current buffer only (exit app only when last one)
    if (cmd === ':q' || cmd === ':quit'){
      (async()=>{
        try{
          const b = currentBuffer();
          if (!b){ _closeCurrentBuffer(); return; }
          if (b.modified){
            const label = b.path ? _prettyFileUrlLabel(b.path) : (b.name || '(untitled)');
            const id = await choiceModal({
              title: 'Unsaved changes',
              detail: `Save changes to: ${label}?`,
              buttons: [
                { id:'save', label:'Save', primary:true },
                { id:'dont', label:"Don't Save" },
                { id:'cancel', label:'Cancel', danger:true }
              ],
              returnFocusEl: editor
            });
            if (id === 'cancel' || id === null){
              // Ensure NORMAL mode and focus back to editor
              try{ _setMode('NORMAL'); if (cmdinput){ cmdinput.value=''; } setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0); }catch{}
              return; // abort
            }
            if (id === 'save'){
              if (b.path){
                const textData = _normalizeTextForSaveInternal(editor.value||'');
                const ok = await _saveToURLWithExternalCheck(b, b.path, textData);
                if (!ok){ toast('write failed: ' + (b.name||'')); return; }
                try{ editor.value = textData; b.text = textData; b.savedText = textData; b._savedTick = (b._changeTick|0); b.modified = false; }catch{}
              } else {
                // No path -> prompt for a save path (Save As)
                const base = _currentDirBase();
                const suggest = (b && b.name && b.name!=='(untitled)') ? b.name : '';
                const input = await inputModal({ title:'Save As', detail:'Enter a file path (relative or absolute)', initialValue: suggest, okText:'Save', cancelText:'Cancel' });
                if (!input){ toast('write cancelled', 1500); return; }
                let targetUrl = null;
                try{ targetUrl = _normalizeToURLString(input, base); }catch{}
                if (!targetUrl){ toast('invalid path', 1500); try{ _triggerVisualBell(); }catch{} return; }
                const _t = _normalizeTextForSaveInternal(editor.value||'');
                const ok = await _saveToURLWithExternalCheck(b, targetUrl, _t);
                if (!ok){ toast('write failed', 1500); try{ _triggerVisualBell(); }catch{} return; }
                try{ b.path = targetUrl; b.name = _basename(targetUrl); editor.value = _t; b.text = _t; b.savedText = _t; b._savedTick = (b._changeTick|0); b.modified=false; }catch{}
                _setTitle(); _renderTabbar();
              }
            }
          }
          _closeCurrentBuffer();
        }catch{}
      })();
      return;
    }
    // :q! — force: discard changes for current buffer and close it
    if (cmd === ':q!'){
      _closeCurrentBuffer();
      return;
    }
    // :qa — quit all (old :q behavior)
    if (cmd === ':qa' || cmd === ':quitall'){
      (async()=>{
        try{
          // If current buffer is unmodified, close it first (spec in #192)
          try{ const b0=currentBuffer(); if (b0 && b0.modified===false){ _closeCurrentBuffer(); } }catch{}
          // Collect modified buffers (including current if modified)
          const items = buffers.map((b,i)=>({b,i})).filter(x=>x.b && x.b.modified);
          if (items.length > 0){
            const ok = await multiSaveDialog(items);
            if (!ok){
              // Ensure we fall back to NORMAL and focus editor on cancel
              try{ _setMode('NORMAL'); if (cmdinput) cmdinput.value=''; setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} },0); }catch{}
              return;
            }
          }
          // Persist cleared session so closed buffers don't resurrect next launch
          try{ _persistClearedSession(); }catch{}
          _quittingAll = true; window.close();
        }catch{}
      })();
      return;
    }
    // :set so=N
    const m = cmd.match(/^:set\s+so\s*=\s*(\d+)$/i);
    if (m){
      const n = parseInt(m[1],10);
      if (!Number.isNaN(n)) { window.six.setScrolloff(n); try{ toast('scrolloff = ' + (n|0), 900); }catch{} }
      return;
    }
    // :set scrolloff=N
    const mSo = cmd.match(/^:set\s+scrolloff\s*=\s*(\d+)$/i);
    if (mSo){
      const n = parseInt(mSo[1],10);
      if (!Number.isNaN(n)) { window.six.setScrolloff(n); try{ toast('scrolloff = ' + (n|0), 900); }catch{} }
      return;
    }
    // :set scrolloff?
    if (/^:set\s+scrolloff\?\s*$/i.test(cmd)){
      try{ toast('scrolloff = ' + (Number.isFinite(scrolloff)?(scrolloff|0):3), 1200); }catch{}
      return;
    }
    // :set shiftwidth=N  / :set sw=N
    let mSW = cmd.match(/^:set\s+(?:shiftwidth|sw)\s*=\s*(\d+)$/i);
    if (mSW){
      const n = parseInt(mSW[1],10);
      if (!Number.isNaN(n)){
        const b=currentBuffer(); if (b){ b.shiftwidth = Math.max(1, n|0); _schedulePersist('shiftwidth'); }
        try{ _updateOverlayShiftwidthVisual(); }catch{}
        try{ toast('shiftwidth = ' + (n|0), 900); }catch{}
      }
      return;
    }
    // :set shiftwidth?
    if (/^:set\s+shiftwidth\?\s*$/i.test(cmd)){
      try{ const b=currentBuffer(); const sw = b && Number.isFinite(b.shiftwidth)? (b.shiftwidth|0) : 4; toast('shiftwidth = ' + sw, 1200); }catch{}
      return;
    }
    // :set visualbell / :set novisualbell / :set visualbell! / :set visualbell?
    if (/^:set\s+visualbell\s*$/i.test(cmd)){
      _optVisualBell = true; toast('visualbell: on', 900); return;
    }
    if (/^:set\s+novisualbell\s*$/i.test(cmd)){
      _optVisualBell = false; toast('visualbell: off', 900); return;
    }
    if (/^:set\s+visualbell!\s*$/i.test(cmd)){
      _optVisualBell = !_optVisualBell; toast('visualbell: ' + (_optVisualBell?'on':'off'), 900); return;
    }
    if (/^:set\s+visualbell\?\s*$/i.test(cmd)){
      toast('visualbell: ' + (_optVisualBell?'on':'off'), 1200); return;
    }
    // :set hlsearch / :set nohlsearch / :set hlsearch!
    if (/^:set\s+hlsearch\s*$/i.test(cmd)){
      _optHlsearch = true; _updateHlsearchFull(); try{ _updateOverlayHlsearchVisual(); }catch{} toast('hlsearch: on', 900); return;
    }
    if (/^:set\s+nohlsearch\s*$/i.test(cmd)){
      _optHlsearch = false; _updateHlsearchFull(); try{ _updateOverlayHlsearchVisual(); }catch{} toast('hlsearch: off', 900); return;
    }
    if (/^:set\s+hlsearch!\s*$/i.test(cmd)){
      _optHlsearch = !_optHlsearch; _updateHlsearchFull(); try{ _updateOverlayHlsearchVisual(); }catch{} toast('hlsearch: ' + (_optHlsearch?'on':'off'), 900); return;
    }
    // :set ignorecase / :set noignorecase / :set ignorecase! / :set ignorecase?
    if (/^:set\s+ignorecase\s*$/i.test(cmd)){
      const b=currentBuffer(); if (b){ b.ignorecase=true; _schedulePersist('ignorecase'); }
      _updateHlsearchFull();
      try{ _updateOverlayCaseVisual(); }catch{}
      toast('ignorecase: on', 900); return;
    }
    if (/^:set\s+noignorecase\s*$/i.test(cmd)){
      const b=currentBuffer(); if (b){ b.ignorecase=false; _schedulePersist('ignorecase'); }
      _updateHlsearchFull();
      try{ _updateOverlayCaseVisual(); }catch{}
      toast('ignorecase: off', 900); return;
    }
    if (/^:set\s+ignorecase!\s*$/i.test(cmd)){
      const b=currentBuffer(); if (b){ b.ignorecase=!b.ignorecase; _schedulePersist('ignorecase'); _updateHlsearchFull(); try{ _updateOverlayCaseVisual(); }catch{} toast('ignorecase: ' + (b.ignorecase?'on':'off'), 900); }
      return;
    }
    if (/^:set\s+ignorecase\?\s*$/i.test(cmd)){
      const b=currentBuffer(); toast('ignorecase: ' + (b&&b.ignorecase?'on':'off'), 1200); return;
    }
    // :set smartcase / :set nosmartcase / :set smartcase! / :set smartcase?
    if (/^:set\s+smartcase\s*$/i.test(cmd)){
      const b=currentBuffer(); if (b){ b.smartcase=true; _schedulePersist('smartcase'); }
      _updateHlsearchFull();
      try{ _updateOverlayCaseVisual(); }catch{}
      toast('smartcase: on', 900); return;
    }
    if (/^:set\s+nosmartcase\s*$/i.test(cmd)){
      const b=currentBuffer(); if (b){ b.smartcase=false; _schedulePersist('smartcase'); }
      _updateHlsearchFull();
      try{ _updateOverlayCaseVisual(); }catch{}
      toast('smartcase: off', 900); return;
    }
    if (/^:set\s+smartcase!\s*$/i.test(cmd)){
      const b=currentBuffer(); if (b){ b.smartcase=!b.smartcase; _schedulePersist('smartcase'); _updateHlsearchFull(); try{ _updateOverlayCaseVisual(); }catch{} toast('smartcase: ' + (b.smartcase?'on':'off'), 900); }
      return;
    }
    if (/^:set\s+smartcase\?\s*$/i.test(cmd)){
      const b=currentBuffer(); toast('smartcase: ' + (b&&b.smartcase?'on':'off'), 1200); return;
    }
    // :set list / :set nolist / :set list! / :set list?
    if (/^:set\s+list\s*$/i.test(cmd)){
      _optList = true; toast('list: on', 900); try{ _renderListChars(); }catch{} updateGutter(); try{ _updateOverlayListVisual(); }catch{} return;
    }
    if (/^:set\s+nolist\s*$/i.test(cmd)){
      _optList = false; toast('list: off', 900); try{ _renderListChars(); }catch{} updateGutter(); try{ _updateOverlayListVisual(); }catch{} return;
    }
    if (/^:set\s+list!\s*$/i.test(cmd)){
      _optList = !_optList; toast('list: ' + (_optList?'on':'off'), 900); try{ _renderListChars(); }catch{} updateGutter(); try{ _updateOverlayListVisual(); }catch{} return;
    }
    if (/^:set\s+list\?\s*$/i.test(cmd)){
      toast('list: ' + (_optList?'on':'off'), 1200); return;
    }
    // :set strictnormalime / :set nostrictnormalime / :set strictnormalime! / :set strictnormalime?
    if (/^:set\s+strictnormalime\s*$/i.test(cmd)){ _optStrictNormalIME = true; toast('strictnormalime: on', 900); return; }
    if (/^:set\s+nostrictnormalime\s*$/i.test(cmd)){ _optStrictNormalIME = false; toast('strictnormalime: off', 900); return; }
    if (/^:set\s+strictnormalime!\s*$/i.test(cmd)){ _optStrictNormalIME = !_optStrictNormalIME; toast('strictnormalime: ' + (_optStrictNormalIME?'on':'off'), 900); return; }
    if (/^:set\s+strictnormalime\?\s*$/i.test(cmd)){ toast('strictnormalime: ' + (_optStrictNormalIME?'on':'off'), 1200); return; }
    // :set debugkeys / :set nodebugkeys / :set debugkeys! / :set debugkeys?
    if (/^:set\s+debugkeys\s*$/i.test(cmd)){
      _optDebugKeys = true; toast('debugkeys: on', 900); return;
    }
    if (/^:set\s+nodebugkeys\s*$/i.test(cmd)){
      _optDebugKeys = false; toast('debugkeys: off', 900); return;
    }
    if (/^:set\s+debugkeys!\s*$/i.test(cmd)){
      _optDebugKeys = !_optDebugKeys; toast('debugkeys: ' + (_optDebugKeys?'on':'off'), 900); return;
    }
    if (/^:set\s+debugkeys\?\s*$/i.test(cmd)){
      toast('debugkeys: ' + (_optDebugKeys?'on':'off'), 1200); return;
    }
    // :set rawkeys / :set norawkeys / :set rawkeys! / :set rawkeys?
    if (/^:set\s+rawkeys\s*$/i.test(cmd)){ _optRawKeys = true; toast('rawkeys: on', 900); return; }
    if (/^:set\s+norawkeys\s*$/i.test(cmd)){ _optRawKeys = false; toast('rawkeys: off', 900); return; }
    if (/^:set\s+rawkeys!\s*$/i.test(cmd)){ _optRawKeys = !_optRawKeys; toast('rawkeys: ' + (_optRawKeys?'on':'off'), 900); return; }
    if (/^:set\s+rawkeys\?\s*$/i.test(cmd)){ toast('rawkeys: ' + (_optRawKeys?'on':'off'), 1200); return; }
    // :lastsynctime — print last synchronized filesystem mtime/size of current buffer (debug; no I/O)
    if (/^:lastsynctime\s*$/i.test(cmd)){
      const b = currentBuffer();
      if (!b){ toast('no buffer'); try{ _triggerVisualBell(); }catch{} _setMode('NORMAL'); return; }
      const mt = (typeof b._extMtime === 'number') ? b._extMtime : null;
      const sz = (typeof b._extSize  === 'number') ? b._extSize  : null;
      try{ console.log('[debug] last-sync', { name:(b&&b.name)||null, path:(b&&b.path)||null, mtime:mt, size:sz, ignored:!!b._externalChangeIgnored }); }catch{}
      // Keep silent by design; only console output
      _setMode('NORMAL');
      return;
    }
    // :statmeta — I/O: fetch current file's metadata now (mtime/size) and print
    if (/^:statmeta\s*$/i.test(cmd)){
      (async()=>{
        const b = currentBuffer();
        if (!b || !b.path || !/^file:\/\//i.test(b.path)){ toast('no file-backed buffer'); try{ _triggerVisualBell(); }catch{} _setMode('NORMAL'); return; }
        const meta = await _statFileMeta(b.path);
        try{ console.log('[debug] statmeta', { name:(b&&b.name)||null, path:b.path, meta }); }catch{}
      })();
      _setMode('NORMAL');
      return;
    }
    // :statmeta! — I/O: dump raw directory entry for the current file (to confirm provider fields)
    if (/^:statmeta!\s*$/i.test(cmd)){
      (async()=>{
        const b = currentBuffer();
        if (!b || !b.path || !/^file:\/\//i.test(b.path)){ toast('no file-backed buffer'); try{ _triggerVisualBell(); }catch{} _setMode('NORMAL'); return; }
        try{
          const parent = _dirnameURL(b.path);
          const baseName = _basename(b.path);
          const list = await _listDirEntriesWithQuickRetry(parent);
          let caseSensitive = false; try{ const u = new URL(b.path); if (u.host && u.host.toLowerCase()==='wsl.localhost') caseSensitive = true; }catch{}
          const ent = Array.isArray(list) ? list.find(e=> e && !e.isDir && (caseSensitive ? (e.name===baseName) : (String(e.name||'').toLowerCase()===String(baseName||'').toLowerCase()))) : null;
          try{ console.log('[debug] statmeta! raw-entry', { parent, baseName, entry: ent||null }); }catch{}
        }catch(e){ try{ console.warn('statmeta! failed', e); }catch{} }
      })();
      _setMode('NORMAL');
      return;
    }
    // :parentnav — 親移動デバッグログトグル (#794)
    if (/^:parentnav\s*$/i.test(cmd)){
      try{ if (typeof window._fileParentDebug === 'undefined') window._fileParentDebug = false; }catch{}
      window._fileParentDebug = !window._fileParentDebug;
      try{ _fileParentLog({ phase:'debug-toggle', enabled:window._fileParentDebug }); }catch{}
      try{ console.debug('[parentnav toggle]', window._fileParentDebug); }catch{}
      try{ toast('parentNav debug: '+(window._fileParentDebug?'ON':'OFF'), 1500); }catch{}
      return;
    }
    // :dumpkeys [N] — copy last N (or all) debug key events to clipboard
    {
      const mDump = cmd.match(/^:dumpkeys(?:\s*([0-9０-９]+))?\s*$/i);
      if (mDump){
        let arr = _debugKeyRing.slice();
        let numStr = (mDump[1]||'').trim();
        // Normalize full-width digits to ASCII
        if (numStr){ numStr = numStr.replace(/[０-９]/g, ch=> String.fromCharCode(ch.charCodeAt(0)-0xFF10+0x30)); }
        const nArg = parseInt(numStr||'',10);
        if (Number.isFinite(nArg) && nArg>0 && nArg < arr.length){ arr = arr.slice(arr.length - nArg); }
        if (!arr.length){ toast('debugkeys: ring empty', 900); return; }
        const s2 = arr.map((e,i)=>{
          return i.toString().padStart(3,'0')+' '+new Date(e.t).toISOString()+` ${e.type}`+
            ` m=${e.mode}`+
            (e.key!==undefined?` key=${JSON.stringify(e.key)}`:'')+
            (e.code?` code=${e.code}`:'')+
            (e.inputType?` inputType=${e.inputType}`:'')+
            (e.data!==undefined?` data=${JSON.stringify(e.data)}`:'')+
            (e.compData!==undefined?` comp=${JSON.stringify(e.compData)}`:'')+
            ` ctrl=${e.ctrl?'1':'0'} alt=${e.alt?'1':'0'} meta=${e.meta?'1':'0'} isComp=${e.isComp?'1':'0'}`;
        }).join('\n');
        (async()=>{ const ok = await _copyToClipboard(s2); toast(ok?`dumped ${arr.length} events to clipboard.`:'Clipboard write failed.', ok?1000:1500); })();
        return;
      }
    }
    // :dumprawkeys [N] — copy last N raw key events
    {
      const mDumpRaw = cmd.match(/^:dumprawkeys(?:\s*([0-9０-９]+))?\s*$/i);
      if (mDumpRaw){
        let arr = _rawKeyRing.slice();
        let numStr = (mDumpRaw[1]||'').trim();
        if (numStr){ numStr = numStr.replace(/[０-９]/g, ch=> String.fromCharCode(ch.charCodeAt(0)-0xFF10+0x30)); }
        const nArg = parseInt(numStr||'',10);
        if (Number.isFinite(nArg) && nArg>0 && nArg < arr.length){ arr = arr.slice(arr.length - nArg); }
        if (!arr.length){ toast('rawkeys: ring empty', 900); return; }
        const s = _rawDump(arr);
        (async()=>{ const ok = await _copyToClipboard(s); toast(ok?`dumped ${arr.length} raw events.`:'Clipboard write failed.', ok?1000:1500); })();
        return;
      }
    }
    // :clearkeys — clear the debug key log
    if (/^:clearkeys\s*$/i.test(cmd)){
      try{ _debugKeyRing.splice(0,_debugKeyRing.length); }catch{}
      toast('debugkeys: cleared', 900); return;
    }
    // :clearrawkeys — clear raw key log
    if (/^:clearrawkeys\s*$/i.test(cmd)){
      try{ _rawKeyRing.splice(0,_rawKeyRing.length); }catch{}
      toast('rawkeys: cleared', 900); return;
    }
    // :wqa[!] [path?] — write all & quit (use previous :wq behavior)
    const wqam = cmd.match(/^:(wqa!?)(?:\s*(.*))?$/i);
    if (wqam){
      const bang = /!$/.test(wqam[1]||'');
      const arg = (wqam[2]||'').trim();
      const b = currentBuffer();
  if (!b){ toast('no buffer'); try{ _triggerVisualBell(); }catch{} _setMode('NORMAL'); return; }
      // unchanged and no path → close current, then aggregate others and exit
      try{ if (!arg && b && b.modified===false){
        (async()=>{
          _closeCurrentBuffer();
          const others = buffers.map((x,i)=>({b:x,i})).filter(x=>x.b && x.b.modified);
          if (others.length>0){ const ok = await multiSaveDialog(others); if (!ok){ _setMode('NORMAL'); return; } }
          window.close();
        })();
        _setMode('NORMAL');
        return; } }catch{}
      // Resolve target URL
      const base = (function(){ try{ if (b && b.path) return _dirnameURL(b.path); }catch{} return _htmlBaseURL(); })();
      let targetUrl = null;
      try{ targetUrl = arg ? _normalizeToURLString(arg, base) : (b.path||null); }catch{ targetUrl = b && b.path || null; }
      if (!targetUrl){ toast('no file path; use :wq <path>'); _setMode('NORMAL'); return; }
      (async()=>{
        // Overwrite confirm if arg present and target exists and not bang
        if (arg && !bang){
          try{
            const parent = _dirnameURL(targetUrl);
            const baseName = _basename(targetUrl);
            const list = await _listDirEntriesWithQuickRetry(parent);
            if (Array.isArray(list)){
              let caseSensitive = false; try{ const u = new URL(targetUrl); if (u.protocol==='file:' && u.host && u.host.toLowerCase()==='wsl.localhost') caseSensitive = true; }catch{}
              const exists = list.some(e=> e && !e.isDir && (caseSensitive ? (e.name===baseName) : (String(e.name||'').toLowerCase()===String(baseName||'').toLowerCase())));
              if (exists){
                const ok = await confirmModal({ title:'Overwrite', detail:_prettyFileUrlLabel(targetUrl), okText:'Overwrite', okClass:'danger', cancelText:'Cancel' });
                if (!ok){ toast('write cancelled', 1500); _setMode('NORMAL'); return; }
              }
            }
          }catch{}
    }
  // Preserve text verbatim (do not add/remove trailing newline) — #597/#598
  let _txtForSave = _normalizeTextForSaveInternal(editor.value||'');
  const ok = await _saveToURLWithExternalCheck(b, targetUrl, _txtForSave);
        if (ok){
          try{
            const was = b.path||null;
            if (was !== targetUrl){ b.path = targetUrl; b.name = _basename(targetUrl); }
            // Update buffer with normalized text (may include newly added final newline)
            editor.value = _txtForSave;
            b.text = _txtForSave; b.savedText = _txtForSave; b._savedTick = (b._changeTick|0); b.modified = false;
          }catch{}
          _setTitle(); _renderTabbar();
          toast('written: ' + _prettyFileUrlLabel(targetUrl));
          try{ _schedulePersist('save'); }catch{}
          // Close current before dialog (spec in #192)
          _closeCurrentBuffer();
          if (bang){ window.close(); return; }
          const others = buffers.map((x,i)=>({b:x,i})).filter(x=>x.b && x.b.modified);
          if (others.length>0){ const ok2 = await multiSaveDialog(others); if (!ok2){ _setMode('NORMAL'); return; } }
          window.close();
        }
      })();
      _setMode('NORMAL');
      return;
    }

    // :wq[!] [path?] — write current buffer and close it (exit app only when last)
    const wqm = cmd.match(/^:(wq!?)(?:\s*(.*))?$/i);
    if (wqm){
      const bang = /!$/.test(wqm[1]||'');
      const arg = (wqm[2]||'').trim();
      const b = currentBuffer();
  if (!b){ toast('no buffer'); try{ _triggerVisualBell(); }catch{} _setMode('NORMAL'); return; }
      // unchanged and no path → just close current buffer
      try{ if (!arg && b && b.modified===false){ _setMode('NORMAL'); _closeCurrentBuffer(); return; } }catch{}
      // Resolve target URL
      const base = (function(){ try{ if (b && b.path) return _dirnameURL(b.path); }catch{} return _htmlBaseURL(); })();
      let targetUrl = null;
      try{ targetUrl = arg ? _normalizeToURLString(arg, base) : (b.path||null); }catch{ targetUrl = b && b.path || null; }
      if (!targetUrl){ toast('no file path; use :wq <path>'); _setMode('NORMAL'); return; }
      (async()=>{
        // Overwrite confirm if arg present and target exists and not bang
        if (arg && !bang){
          try{
            const parent = _dirnameURL(targetUrl);
            const baseName = _basename(targetUrl);
            const list = await _listDirEntriesWithQuickRetry(parent);
            if (Array.isArray(list)){
              let caseSensitive = false; try{ const u = new URL(targetUrl); if (u.protocol==='file:' && u.host && u.host.toLowerCase()==='wsl.localhost') caseSensitive = true; }catch{}
              const exists = list.some(e=> e && !e.isDir && (caseSensitive ? (e.name===baseName) : (String(e.name||'').toLowerCase()===String(baseName||'').toLowerCase())));
              if (exists){
                const ok = await confirmModal({ title:'Overwrite', detail:_prettyFileUrlLabel(targetUrl), okText:'Overwrite', okClass:'danger', cancelText:'Cancel' });
                if (!ok){ toast('write cancelled', 1500); _setMode('NORMAL'); return; }
              }
            }
          }catch{}
        }
  let _txtForSave2 = _normalizeTextForSaveInternal(editor.value||'');
  const ok = await _saveToURLWithExternalCheck(b, targetUrl, _txtForSave2);
        if (ok){
          try{
            const was = b.path||null;
            if (was !== targetUrl){ b.path = targetUrl; b.name = _basename(targetUrl); }
            editor.value = _txtForSave2;
            b.text = _txtForSave2; b.savedText = _txtForSave2; b._savedTick = (b._changeTick|0); b.modified = false;
          }catch{}
          _setTitle(); _renderTabbar();
          toast('written: ' + _prettyFileUrlLabel(targetUrl));
          try{ _schedulePersist('save'); }catch{}
          _closeCurrentBuffer();
        }
      })();
      _setMode('NORMAL');
      return;
    }

    // :wa — write all modified buffers with a path
    if (/^:wa\s*$/i.test(cmd)){
      (async()=>{
        for (let i=0;i<buffers.length;i++){
          const b = buffers[i];
          if (!b || !b.modified || !b.path) continue;
          const textData = (i===currentIdx)?(editor.value||''):(b.text||'');
            const textDataN = (i===currentIdx)? _normalizeTextForSaveInternal(editor.value||'') : _normalizeTextForSaveInternal(textData||'');
            const ok = await _saveToURLWithExternalCheck(b, b.path, textDataN);
          if (ok){
            try{
              if (i===currentIdx){
                // Guard selection sync and preserve viewport while rewriting value
                try{ _selGuardUntil = Date.now() + 800; }catch{}
                let stKeep=0, slKeep=0; try{ stKeep=editor.scrollTop|0; slKeep=editor.scrollLeft|0; }catch{}
                editor.value = textDataN;
                try{ editor.scrollTop = stKeep; editor.scrollLeft = slKeep; }catch{}
                try{ _syncNativeSelectionToCaret(); }catch{}
              }
              b.text=textDataN; b.savedText=textDataN; b._savedTick=(b._changeTick|0); b.modified=false;
            }catch{}
            toast('written: ' + _prettyFileUrlLabel(b.path));
          } else { toast('write failed: ' + (b.name||'')); try{ _triggerVisualBell(); }catch{} }
        }
        _setTitle(); _renderTabbar();
        try{ _schedulePersist('save-all'); }catch{}
      })();
      _setMode('NORMAL');
      return;
    }

    // :w[!] [path?] — save current buffer (file:// only via local API)
    const wm = cmd.match(/^:(w!?)(?:\s*(.*))?$/i);
    if (wm){
      const bang = /!$/.test(wm[1]||'');
      const arg = (wm[2]||'').trim();
      const b = currentBuffer();
  if (!b){ toast('no buffer'); try{ _triggerVisualBell(); }catch{} _setMode('NORMAL'); return; }
      // Capture viewport and selection to stabilize after save
      let _w_st = 0, _w_sl = 0, _w_cr = caretRow|0, _w_cc = caretCol|0, _w_sS = 0, _w_sE = 0;
      try{ _w_st = editor.scrollTop|0; _w_sl = editor.scrollLeft|0; _w_sS = editor.selectionStart|0; _w_sE = editor.selectionEnd|0; }catch{}
      const _w_restore = ()=>{
        try{
          _scrollGuardUntil = Date.now() + 1200;
          // Suppress select-driven caret sync briefly while we restore caret/selection
          _selGuardUntil = Date.now() + 400;
          // Restore caret first, then sync native selection from caret to avoid EOF jumps
          try{ caretRow = Math.max(0, Math.min(_totalLines()-1, _w_cr|0)); }catch{ caretRow = (_w_cr|0); }
          try{ caretCol = Math.max(0, _w_cc|0); }catch{ caretCol = (_w_cc|0); }
          try{ _syncNativeSelectionToCaret(); }catch{}
          try{ editor.scrollTop = _w_st; }catch{}
          try{ editor.scrollLeft = _w_sl; }catch{}
          _repositionCaret(); updateGutter(); _renderHlMatchesVisible();
          // Reinforce after a frame in case a deferred select event fires post-value assignment
          try{
            if (window.requestAnimationFrame){
              requestAnimationFrame(()=>{ try{ _syncNativeSelectionToCaret(); _repositionCaret(); updateGutter(); }catch{} });
            }
          }catch{}
        }catch{}
      };
      // 変更なし + パス引数なしのときは何もしない（エラーも出さない）
      try{ if (!arg && b && b.modified === false){
        // 強固にチラつき抑止: 一時的にスクロールガードを有効化し、その場で状態を復元
        const st = editor.scrollTop, cr = caretRow, cc = caretCol;
        // ネイティブ selection（textarea 側）も保持・復元（内部スクロール発生の芽を摘む）
        let selS = 0, selE = 0; try{ selS = editor.selectionStart; selE = editor.selectionEnd; }catch{}
        _scrollGuardUntil = Date.now() + 1500; // ガード時間をさらに伸ばす
        _centerScrolloffOnce = false; // G 相当のセンタリングを抑止
        _clearPending && _clearPending();
        _setMode('NORMAL'); toast('Nothing has been changed.', 1500);
        const restore = ()=>{
          try{
            // selection を先に戻し、後で scrollTop を上書き（選択復元での自動スクロールを打ち消す）
            try{ if (typeof selS === 'number' && typeof selE === 'number'){ editor.setSelectionRange(selS, selE); } }catch{}
            caretRow = cr; caretCol = cc;
            editor.scrollTop = st;
            _repositionCaret(); updateGutter();
          }catch{}
        };
        // 直ちに復元 → 次フレームでもう一度 → 少し遅延してもう一度（描画タイミングの揺れ吸収）
        restore();
        try{
          if (window.requestAnimationFrame){
            requestAnimationFrame(()=>{ restore(); requestAnimationFrame(()=>{ restore(); }); });
          }
        }catch{}
        try{ setTimeout(restore, 160); }catch{}
        return; } }catch{}
      // Resolve target URL
      const base = (function(){ try{ if (b && b.path) return _dirnameURL(b.path); }catch{} return _htmlBaseURL(); })();
      let targetUrl = null;
      try{ targetUrl = arg ? _normalizeToURLString(arg, base) : (b.path||null); }catch{ targetUrl = b && b.path || null; }
      if (!targetUrl){ toast('no file path; use :w <path>'); _setMode('NORMAL'); return; }
      (async()=>{
        // Overwrite confirm if arg present and target exists and not bang
        if (arg && !bang){
          try{
            const parent = _dirnameURL(targetUrl);
            const baseName = _basename(targetUrl);
            const list = await _listDirEntriesWithQuickRetry(parent);
            if (Array.isArray(list)){
              let caseSensitive = false; try{ const u = new URL(targetUrl); if (u.protocol==='file:' && u.host && u.host.toLowerCase()==='wsl.localhost') caseSensitive = true; }catch{}
              const exists = list.some(e=> e && !e.isDir && (caseSensitive ? (e.name===baseName) : (String(e.name||'').toLowerCase()===String(baseName||'').toLowerCase())));
              if (exists){
                const ok = await confirmModal({ title:'Overwrite', detail:_prettyFileUrlLabel(targetUrl), okText:'Overwrite', okClass:'danger', cancelText:'Cancel' });
                if (!ok){ toast('write cancelled', 1500); _setMode('NORMAL'); return; }
              }
            }
          }catch{}
        }
  let _txtForSave3 = _normalizeTextForSaveInternal(editor.value||'');
  const ok = await _saveToURLWithExternalCheck(b, targetUrl, _txtForSave3);
        if (ok){
          try{
            const was = b.path||null;
            if (was !== targetUrl){ b.path = targetUrl; b.name = _basename(targetUrl); }
            // Guard selection sync before rewriting value to prevent transient EOF jumps
            try{ _selGuardUntil = Date.now() + 800; }catch{}
            let stKeep=0, slKeep=0; try{ stKeep=editor.scrollTop|0; slKeep=editor.scrollLeft|0; }catch{}
            editor.value = _txtForSave3;
            try{ editor.scrollTop = stKeep; editor.scrollLeft = slKeep; }catch{}
            // keep overlay caret authoritative and resync native selection from it
            try{ _syncNativeSelectionToCaret(); }catch{}
            b.text = _txtForSave3; b.savedText = _txtForSave3; b._savedTick = (b._changeTick|0); b.modified = false;
          }catch{}
          _setTitle(); _renderTabbar();
          toast('written: ' + _prettyFileUrlLabel(targetUrl));
          try{ _schedulePersist('save'); }catch{}
        }
      })().finally(()=>{ try{ _w_restore(); }catch{} });
      _setMode('NORMAL');
      return;
    }
    // :e [path]  / :e! で現バッファ再読込（:e はポップアップ表示）
    const em = cmd.match(/^:(e!?)(?:\s*(.*))?$/i);
    if (em){
      const bang = (em[1] && em[1].toLowerCase()==='e!');
      const arg = (em[2]||'').trim();
      if (!arg){
        // 引数なし
        if (bang){
          // :e! は再読込（現バッファの変更を破棄）
          const b = currentBuffer();
          if (b){
            if (b.path){
              // 既存ファイル → ディスクから読み直し
              _loadFromPath(b.path, null, { mode:'replace' });
            } else {
              // 無名/未保存バッファ → savedText に戻す
              try{
                const t = (typeof b.savedText === 'string') ? b.savedText : (b.text||'');
                editor.value = String(t||'');
                // caret/scroll を初期化
                caretRow = 0; caretCol = 0; editor.scrollTop = 0;
                _centerScrolloffOnce = true; ensureScrolloff({centerOnce:true});
                try{ _repositionCaret(); updateGutter(); }catch{}
                // バッファ状態を saved に戻す
                b.text = editor.value||''; b.savedText = b.text; b.modified = false; b._changeTick=0; b._savedTick=0;
                try{ b._undo=[]; b._redo=[]; }catch{}
                try{ _setTitle(); _renderTabbar(); }catch{}
              }catch{}
            }
          }
          _setMode('NORMAL');
          return;
        }
    // :e はファイル候補ポップアップを開く（先に表示→ローディングのち反映）
  // 開始基点は常に現バッファのディレクトリ。Esc 記憶の一時基点は使わない（#178）。
  _fileBaseURL = _currentDirBase();
  _fileStartBaseURL = _ensureSlash(_fileBaseURL);
  _fileNextStartBaseURL = null;
        _fileTypedDirRaw = '';
        _fileFilter = '';
        _fileInvalid = false;
        _filePopupNoUp = false;
        _fileLoading = true;
        _filePopupShow();
        (function(){
          const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
          // Freshen directory listing on popup open to include newly added files (e.g., TODO.md)
          try{ if (reqKey && _dirCache && _dirCache.delete) _dirCache.delete(reqKey); }catch{}
          _listDirEntries(_fileBaseURL)
            .then(list=>{
              try{
                const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                if (!reqKey || curKey === reqKey){
                  _fileEntries = Array.isArray(list) ? list : [];
                  if (Array.isArray(list) && list.length>0){
                    _fileStableEntries = list.slice();
                    _fileStableBaseKey = curKey;
                  }
                }
              }catch{}
            })
            .catch((e)=>{ console.warn('dir list (argless :e) failed', e); /* keep previous entries */ })
            .finally(()=>{ _fileLoading=false; _filePopupRender(); });
        })();
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

        // 引数ありの :e はここで履歴に残す（起動直後・新規作成ケースも含めて統一）
        try{
          const hist = ':e ' + _collapseDotDotPath(String(arg||'').replace(/\\/g,'/'));
          _cmdHistoryMaybePush(hist);
        }catch{}

        // ディレクトリ指定ヒントの場合は、そのディレクトリでポップアップを開く
        if (_isDirHint(arg)){
          try{
            const dirUrl = _ensureSlash(new URL(arg.replace(/\\/g,'/'), base));
            _fileBaseURL = dirUrl;
            _fileStartBaseURL = _ensureSlash(_fileBaseURL);
            _fileTypedDirRaw = '';
            _fileFilter = '';
            _fileInvalid = false;
            _fileLoading = true;
            _filePopupShow();
            (function(){
              const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
              // Freshen directory listing on popup open (dir hint) to include newly added files
              try{ if (reqKey && _dirCache && _dirCache.delete) _dirCache.delete(reqKey); }catch{}
              _listDirEntries(_fileBaseURL)
                .then(list=>{
                  try{
                    const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                    if (!reqKey || curKey === reqKey){
                      _fileEntries = Array.isArray(list) ? list : [];
                      if (Array.isArray(list) && list.length>0){
                        _fileStableEntries = list.slice();
                        _fileStableBaseKey = curKey;
                      }
                    }
                  }catch{}
                })
                .catch((e)=>{ console.warn('dir list (dir hint) failed', e); /* keep previous entries */ })
                .finally(()=>{ _fileLoading=false; _filePopupRender(); });
            })();
          }catch{
            _fileBaseURL = base; _fileTypedDirRaw=''; _fileFilter=''; _filePopupShow();
          }
          return;
        }

        // まずは直接 file:// 読み込みを試す（XHR + fetch フォールバック）
        // 引数ありは新規バッファとして追加
        _loadFromPath(arg, base, {silentOnFail:true, mode:'new'}).then(async ok=>{
          if (ok) return;
          // 失敗時は新規バッファを作成（ピッカーは開かない）
          let finalURL = null;
          try { finalURL = new URL(arg, base).toString(); } catch {}
          const exist = _findBufferByURL(finalURL);
          if (exist >= 0){ _switchToBuffer(exist); }
          else { _addBuffer({ name: _basename(arg), path: finalURL, text: '', modified:false }); _switchToBuffer(buffers.length-1); }
        });
      }
      return;
    }
    // :reload -> location.reload (hash保持)
    if (cmd === ':reload'){
      _allowUnloadOnce = true; location.reload(); return;
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
      toast('api = ' + (_apiBase || '(none)'));
      return;
    }
  }

  function _setMode(m){
    _mode = m;
    if (modestatus){
      // CMDモードでは表示を変更しない（[CMD]を出さない）
      if (m === 'NORMAL' || m === 'INSERT' || m === 'VISUAL'){
        modestatus.textContent = '['+_mode+']';
        // モード色: 未設定なら即 yellow 固定フォールバック (#521 指示)
        try{
          const T = (window && window.THEME) ? window.THEME : {};
          let col = null;
          if (m === 'INSERT') col = T.modeInsertFGColor;
          else if (m === 'VISUAL') col = T.modeVisualFGColor;
          else col = T.modeNormalFGColor; // NORMAL
          if (!col) col = 'yellow';
          modestatus.style.color = col;
        }catch{ try{ modestatus.style.color = 'yellow'; }catch{} }
      }
    }
    // Persist mode per buffer (exclude transient CMD). VISUAL/INSERT/NORMAL only.
    try{
      if (m === 'NORMAL' || m === 'INSERT' || m === 'VISUAL'){
        const b = currentBuffer(); if (b) b.savedMode = m;
      }
    }catch{}
    // While in CMD, prefer a hollow caret (no gradient fill/blink)
    // by ensuring the global 'hide-cursor' class is cleared.
    if (m === 'CMD'){
      try{ _showCursor(); }catch{}
    }
    // Begin an INSERT compound edit by pushing a snapshot before edits start
    if (m==='INSERT'){
      // Allow IME in INSERT
      try{ if (editor){ editor.removeAttribute('inputmode'); editor.style.imeMode = ''; } }catch{}
      // ユーザー編集を許可（INSERT のみ）
      try{ if (editor) editor.readOnly = false; }catch{}
      // If we previously hinted IME off by focus juggling, restore focus cleanly once here
      try{ if (editor && document.activeElement !== editor){ editor.focus(); } }catch{}
      // Snap scrollTop to exact line boundary proactively to avoid half-line misalignment before typing
      try{
        const st = (editor && typeof editor.scrollTop==='number') ? editor.scrollTop : 0;
        const snapped = Math.round(st/LINE_HEIGHT)*LINE_HEIGHT;
        if (Math.abs(snapped - st) > 0.25){ editor.scrollTop = snapped; }
      }catch{}
      if (!_suppressInsertSnapshotOnce){
        _pushUndoSnapshot('insert');
      }
      _suppressInsertSnapshotOnce = false;
      // ensure native textarea caret matches overlay caret position
      try{ editor && editor.focus && editor.focus(); }catch{}
      _syncNativeSelectionToCaret();
      try{ if (cmdfloat) cmdfloat.style.display='none'; }catch{}
  // Caret color remains baseline (IME visualization removed)
    } else {
      // NORMAL/VISUAL/CMD: IME on/off キーや未確定表示は許容するため、inputmode/imeMode の強制変更はしない。
      // 内容変更は beforeinput/input で阻止するため readOnly も false のままにする。
      try{ if (editor){ editor.removeAttribute('inputmode'); editor.style.imeMode=''; editor.readOnly = false; } }catch{}
      // 以前の blur→focus による IME 強制終了は行わない（#522）。
    }
    // Show/hide floating command bar for CMD mode
    try{
      if (m==='CMD'){ if (cmdfloat){ cmdfloat.style.display='flex'; _positionCmdFloat(); } }
      else { if (cmdfloat){ cmdfloat.style.display='none'; } }
    }catch{}
  }

  // Compute editor viewport-aligned geometry and margins
  function _computeOverlayBand(){
    const rect = viewport ? viewport.getBoundingClientRect() : { left:0, right: (window.innerWidth||0), top:36, height: (window.innerHeight||0) - 36 };
    const gw = (typeof gutter!=='undefined' && gutter && gutter.offsetWidth)|0;
    const rootFS = (function(){ try{ return parseFloat(getComputedStyle(document.documentElement).fontSize)||16; }catch{ return 16; } })();
    const basePad = Math.round(0.8 * rootFS);
    const sbw = (function(){ try{ if (!editor) return 0; const w = (editor.offsetWidth|0) - (editor.clientWidth|0); return w>0?w:0; }catch{ return 0; } })();
    const left = Math.round((rect.left|0) + gw + basePad);
    const rightLimit = Math.round((rect.right|0) - (sbw + basePad));
    const width = Math.max(80, rightLimit - left);
    const viewH = (viewport ? (viewport.clientHeight|0) : Math.max(0, (window.innerHeight|0) - (rect.top|0)));
    const topMargin = Math.round(2.5 * LINE_HEIGHT);
    const bottomMargin = Math.round(2.5 * LINE_HEIGHT);
    return { rect, left, rightLimit, width, viewH, topMargin, bottomMargin, sbw };
  }

  // Lay out buffer/file popup near top with margins and scrollbar-aware width/height
  function _layoutBufPopup(){
    try{
      if (!bufpopup || bufpopup.style.display==='none') return;
      const band = _computeOverlayBand();
      const isFile = (_popupKind && _popupKind()==='file');
      const isBuf  = (_popupKind && _popupKind()==='buf');
      const leftPx = Math.max(8, band.left);
      const widthPx = Math.max(120, band.width);
      bufpopup.style.left = leftPx + 'px';
      bufpopup.style.width = widthPx + 'px';
      bufpopup.style.right = 'auto'; // use explicit width/left
      // Gap units
      const rootFS = (function(){ try{ return parseFloat(getComputedStyle(document.documentElement).fontSize)||16; }catch{ return 16; } })();
      const gapRem = Math.round(1.5 * rootFS);
      // Default top-aligned position (2.5 lines below viewport top)
      const defaultTopAbs = Math.max(8, (band.rect.top|0) + band.topMargin);
      const windowH = (window.innerHeight||0)|0;

      if (isFile){
        // :e popup — fixed height (75% of visible lines) while preserving 2.5-line bottom margin
        const topAbs = defaultTopAbs;
        bufpopup.style.top = topAbs + 'px';
        bufpopup.style.bottom = 'auto';
        const maxByBottom = Math.max(0, band.viewH - (topAbs - (band.rect.top|0)) - band.bottomMargin);
        const fixedH = Math.max(0, Math.min(maxByBottom, Math.floor((0.75 * band.viewH)/LINE_HEIGHT) * LINE_HEIGHT));
        // Apply fixed height to keep stable across directory navigation
        if (fixedH > 0){
          bufpopup.style.height = fixedH + 'px';
          bufpopup.style.maxHeight = '';
          if (bufpopupInner){
            // 固定高に正確に追従させるため、max-height ではなく明示的な height を指定する
            // 枠線の厚み（上下合計約2px）を控除して、スクロール領域の実効高さを安定化
            const innerH = Math.max(0, fixedH - 2);
            bufpopupInner.style.height = innerH + 'px';
            bufpopupInner.style.maxHeight = '';
          }
        }
      } else if (isBuf && cmdfloat && cmdfloat.style.display !== 'none' && _mode==='CMD'){
        // :b popup — position relative to command float with 1.5rem gap; do NOT move the command float
        const vr = band.rect; // viewport rect
        const cr = cmdfloat.getBoundingClientRect();
        // Determine which half the command float occupies (relative to viewport)
        const cmdCenterRel = ((cr.top + cr.bottom)/2) - vr.top;
        const upperHalf = (cmdCenterRel < (band.viewH/2));
        if (upperHalf){
          // Place below command float
          const topRel = (cr.bottom - vr.top) + gapRem;
          const topAbs = (vr.top|0) + Math.max(0, topRel);
          bufpopup.style.top = topAbs + 'px';
          bufpopup.style.bottom = 'auto';
          const maxH = Math.max(0, band.viewH - topRel - 8);
          bufpopup.style.height = '';
          bufpopup.style.maxHeight = (maxH>0 ? (maxH + 'px') : '');
          if (bufpopupInner){ bufpopupInner.style.height=''; bufpopupInner.style.maxHeight = (maxH>0 ? (Math.max(0, maxH - 8) + 'px') : ''); }
        } else {
          // Place above command float: anchor bottom so the gap stays exactly 1.5rem
          const bottomAbs = Math.max(8, windowH - ((cr.top - gapRem)|0));
          bufpopup.style.top = 'auto';
          bufpopup.style.bottom = bottomAbs + 'px';
          const available = Math.max(0, (cr.top - gapRem) - vr.top - 8);
          bufpopup.style.height = '';
          bufpopup.style.maxHeight = (available>0 ? (available + 'px') : '');
          if (bufpopupInner){ bufpopupInner.style.height=''; bufpopupInner.style.maxHeight = (available>0 ? (Math.max(0, available - 8) + 'px') : ''); }
        }
      } else {
        // Fallback: top-aligned with 2.5 lines margin, variable height within bottom margin
        const topAbs = defaultTopAbs;
        bufpopup.style.top = topAbs + 'px';
        bufpopup.style.bottom = 'auto';
        const maxByBottom = Math.max(0, band.viewH - (topAbs - (band.rect.top|0)) - band.bottomMargin);
        bufpopup.style.height = '';
        bufpopup.style.maxHeight = (maxByBottom>0 ? (maxByBottom + 'px') : '');
        if (bufpopupInner){ bufpopupInner.style.height=''; bufpopupInner.style.maxHeight = (maxByBottom>0 ? (Math.max(0, maxByBottom - 8) + 'px') : ''); }
      }
    }catch{}
  }

  // Floating command bar positioning
  // - Places near caret by default
  // - If VISUAL->CMD: prefer below selection with 1.5rem gap (fallback above if no room)
  // - If popup visible: place below popup (non-overlap by Y)
  // - Right edge accounts for editor scrollbar width
  function _positionCmdFloat(){
    try{
      if (!cmdfloat || _mode!=='CMD') return;
      const band = _computeOverlayBand();
      // Apply width band to cmdfloat (left + right margin incl. scrollbar)
      cmdfloat.style.left = (band.left) + 'px';
      cmdfloat.style.right = (Math.max(0, (window.innerWidth||0) - band.rightLimit)) + 'px';
      // Determine vertical placement
      const st = (editor && typeof editor.scrollTop==='number') ? (editor.scrollTop|0) : 0;
      const h = cmdfloat.offsetHeight || 26;
      let topPx = 0;
      const gapBelowSel = Math.round(1.5 * (function(){ try{ return parseFloat(getComputedStyle(document.documentElement).fontSize)||16; }catch{ return 16; } })());
      // If :e popup visible: place command float below popup with 1.5rem gap (Y stacking)
      if (typeof _filePopupVisible==='function' && _filePopupVisible() && _popupKind && _popupKind()==='file'){
        const vr = viewport ? viewport.getBoundingClientRect() : { top:36 };
        const pr = bufpopup.getBoundingClientRect();
        const relBottom = Math.max(0, (pr.bottom|0) - (vr.top|0));
        topPx = relBottom + gapBelowSel;
      } else if (_visCmdActive){
        // VISUAL snapshot available while in CMD
        const aR = _visCmdAnchorR|0, aC = _visCmdAnchorC|0, cR = _visCmdCaretR|0, cC = _visCmdCaretC|0;
        const rMin = Math.max(0, Math.min(aR, cR));
        const rMax = Math.max(aR, cR);
        const selTop = (rMin*LINE_HEIGHT) - st;
        const selBottom = ((rMax+1)*LINE_HEIGHT) - st;
        const below = selBottom + gapBelowSel;
        const minTop = 4; const maxTop = band.viewH - h - 4;
        // Prefer below; fallback above if not enough space
        if (below <= maxTop){ topPx = below; }
        else {
          const above = selTop - gapBelowSel - h; // overlap above (preserve 1.5rem below priority)
          topPx = Math.max(minTop, Math.min(maxTop, above));
        }
      } else {
        // Caret-based default (3 lines above/below relative to viewport)
        const caretTopPx = (caretRow|0) * LINE_HEIGHT - st;
        const half = band.viewH/2;
        if (caretTopPx < half){ topPx = caretTopPx + (3*LINE_HEIGHT); }
        else { topPx = caretTopPx - (3*LINE_HEIGHT) - h; }
      }
      // Clamp to viewport band
      const minTop = 4;
      const maxTop = band.viewH - h - 4;
      if (topPx < minTop) topPx = minTop;
      if (topPx > maxTop) topPx = maxTop;
      cmdfloat.style.top = topPx + 'px';
    }catch{}
  }
  try{ editor.addEventListener('scroll', ()=>{ try{ if (_mode==='CMD') _positionCmdFloat(); }catch{} }); }catch{}
  try{ window.addEventListener('resize', ()=>{ try{ if (_mode==='CMD') _positionCmdFloat(); _positionPaletteUI(); }catch{} }); }catch{}

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

  // custom modal (confirm/choice) — avoid native confirm() banner
  const _modalOverlay = document.getElementById('modalOverlay');
  const _modalTitle   = document.getElementById('modalTitle');
  const _modalDetail  = document.getElementById('modalDetail');
  const _modalButtons = document.getElementById('modalButtons');

  // modal box element (for dragging)
  const _modalBox = document.getElementById('modalBox');
  // Simple drag support for the modal box using the title bar.
  (function(){
    try{
      if (!_modalBox || !_modalTitle) return;
      const state = { active: false, startX:0, startY:0, boxLeft:0, boxTop:0 };
      const onMove = (ev)=>{
        if (!state.active) return;
        try{
          ev.preventDefault();
          const pt = (ev.touches && ev.touches[0]) ? ev.touches[0] : ev;
          const nx = state.boxLeft + (pt.clientX - state.startX);
          const ny = state.boxTop  + (pt.clientY - state.startY);
          // clamp to viewport a little bit (modal should remain visible)
          const vw = Math.max(100, window.innerWidth||0);
          const vh = Math.max(100, window.innerHeight||0);
          const rect = _modalBox.getBoundingClientRect();
          const w = rect.width || 400; const h = rect.height || 120;
          const left = Math.min(Math.max(-w + 24, nx), vw - 24);
          const top  = Math.min(Math.max(8, ny), vh - 24);
          _modalBox.style.left = left + 'px';
          _modalBox.style.top  = top  + 'px';
          _modalBox.style.right = 'auto';
        }catch{}
      };
      const onUp = ()=>{
        if (!state.active) return; state.active=false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); try{ _modalTitle.style.cursor='grab'; }catch{}
      };
      const onDown = (ev)=>{
        try{
          const pt = (ev.touches && ev.touches[0]) ? ev.touches[0] : ev;
          const rect = _modalBox.getBoundingClientRect();
          // put modalBox into fixed coordinates so left/top can be set
          _modalBox.style.position = 'fixed';
          _modalBox.style.margin = '0';
          _modalBox.style.left = rect.left + 'px';
          _modalBox.style.top  = rect.top  + 'px';
          state.active = true;
          state.startX = pt.clientX; state.startY = pt.clientY;
          state.boxLeft = rect.left; state.boxTop = rect.top;
          document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
          document.addEventListener('touchmove', onMove, { passive:false }); document.addEventListener('touchend', onUp);
          try{ _modalTitle.style.cursor='grabbing'; }catch{}
          ev.preventDefault();
        }catch{}
      };
      _modalTitle.style.cursor = 'grab';
      _modalTitle.addEventListener('mousedown', onDown);
      _modalTitle.addEventListener('touchstart', onDown, { passive:false });
    }catch{}
  })();
  function _hideModal(){ if (_modalOverlay) _modalOverlay.style.display='none'; try{ _modalButtons && (_modalButtons.innerHTML=''); }catch{} }
  function _showModal(){ if (_modalOverlay) _modalOverlay.style.display='flex'; }
  function confirmModal(opts){
    return new Promise((resolve)=>{
      try{
        if (!_modalOverlay || !_modalTitle || !_modalDetail || !_modalButtons){
          const ok = window.confirm(String(opts && (opts.title||opts.detail) || 'Are you sure?'));
          return resolve(!!ok);
        }
        const title = (opts && opts.title) || 'Confirm';
        const detail = (opts && opts.detail) || '';
        const okText = (opts && opts.okText) || 'OK';
        const cancelText = (opts && opts.cancelText) || 'Cancel';
        const okClass = (opts && opts.okClass) || 'primary';
        const cancelClass = (opts && opts.cancelClass) || '';
        const restoreEl = (opts && opts.returnFocusEl) || ((_mode==='CMD' && cmdinput) ? cmdinput : editor);
        _modalTitle.textContent = title;
        _modalDetail.textContent = detail;
        _modalButtons.innerHTML = '';
        const btnCancel = document.createElement('button'); btnCancel.textContent = cancelText; if (cancelClass) btnCancel.classList.add(cancelClass);
        const btnOk = document.createElement('button'); btnOk.textContent = okText; if (okClass) btnOk.classList.add(okClass);
        _modalButtons.appendChild(btnCancel); _modalButtons.appendChild(btnOk);
        const btnEls = [btnCancel, btnOk];
        const cleanup = ()=>{ try{ document.removeEventListener('keydown', onKey); }catch{} _hideModal(); try{ setTimeout(()=>{ try{ restoreEl && restoreEl.focus && restoreEl.focus(); }catch{} }, 0); }catch{} };
        const onCancel = ()=>{ cleanup(); resolve(false); };
        const onOk = ()=>{ cleanup(); resolve(true); };
        btnCancel.addEventListener('click', onCancel, { once:true });
        btnOk.addEventListener('click', onOk, { once:true });
        const onKey = (e)=>{
          if (_isEsc(e)){ e.preventDefault(); onCancel(); }
          else if (e.key==='Enter'){ e.preventDefault(); onOk(); }
          else if (e.key==='Tab'){
            e.preventDefault();
            if (!btnEls.length) return;
            const idx = btnEls.findIndex(el=> el===document.activeElement);
            const dir = e.shiftKey ? -1 : 1;
            const next = (idx>=0 ? (idx+dir+btnEls.length)%btnEls.length : (dir>0?0:btnEls.length-1));
            try{ btnEls[next].focus(); }catch{}
          }
        };
        document.addEventListener('keydown', onKey);
        _showModal();
        try{ btnOk.focus(); }catch{}
        try{ requestAnimationFrame(()=>{ try{ btnOk.focus(); }catch{} }); }catch{}
        try{ setTimeout(()=>{ try{ btnOk.focus(); }catch{} }, 0); }catch{}
      }catch{ resolve(false); }
    });
  }
  // Simple input modal (Save As) — returns Promise<string|null>
  function inputModal(opts){
    return new Promise((resolve)=>{
      try{
        if (!_modalOverlay || !_modalTitle || !_modalDetail || !_modalButtons){
          const v = window.prompt(String((opts&&opts.title)||'Input'), String((opts&&opts.initialValue)||''));
          return resolve(v==null?null:v);
        }
        const title = (opts && opts.title) || 'Input';
        const detail = (opts && opts.detail) || '';
        const initial = (opts && opts.initialValue) || '';
        const okText = (opts && opts.okText) || 'OK';
        const cancelText = (opts && opts.cancelText) || 'Cancel';
        const restoreEl = ((_mode==='CMD' && cmdinput) ? cmdinput : editor);
        _modalTitle.textContent = title;
        _modalDetail.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.style.display='flex'; wrap.style.flexDirection='column'; wrap.style.gap='8px';
        if (detail){ const p = document.createElement('div'); p.textContent = detail; wrap.appendChild(p); }
        const inp = document.createElement('input');
        inp.type='text'; inp.value = initial; inp.style.width='100%';
        wrap.appendChild(inp);
        _modalDetail.appendChild(wrap);
        _modalButtons.innerHTML='';
        const btnCancel = document.createElement('button'); btnCancel.textContent = cancelText;
        const btnOk = document.createElement('button'); btnOk.textContent = okText; btnOk.classList.add('primary');
        _modalButtons.appendChild(btnCancel); _modalButtons.appendChild(btnOk);
        const cleanup = ()=>{ try{ document.removeEventListener('keydown', onKey); }catch{} _hideModal(); try{ setTimeout(()=>{ try{ restoreEl && restoreEl.focus && restoreEl.focus(); }catch{} }, 0); }catch{} };
        const finishOk = ()=>{ const v = inp.value; cleanup(); resolve(v!=null?v:''); };
        const finishCancel = ()=>{ cleanup(); resolve(null); };
        btnOk.addEventListener('click', finishOk, { once:true });
        btnCancel.addEventListener('click', finishCancel, { once:true });
        const onKey = (e)=>{
          if (_isEsc(e)){ e.preventDefault(); finishCancel(); }
          else if (e.key==='Enter'){ e.preventDefault(); finishOk(); }
          else if (e.key==='Tab'){
            e.preventDefault(); // trap focus between input and two buttons
            const focusables = [inp, btnOk, btnCancel];
            const idx = focusables.findIndex(el=> el===document.activeElement);
            const dir = e.shiftKey ? -1 : 1;
            const next = (idx>=0 ? (idx+dir+focusables.length)%focusables.length : 0);
            try{ focusables[next].focus(); }catch{}
          }
        };
        document.addEventListener('keydown', onKey);
        _showModal();
        try{ setTimeout(()=>{ try{ inp.focus(); inp.select(); }catch{} }, 0); }catch{}
      }catch{ resolve(null); }
    });
  }
  function choiceModal(opts){
    return new Promise((resolve)=>{
      try{
        if (!_modalOverlay || !_modalTitle || !_modalDetail || !_modalButtons){
          const ok = window.confirm(String(opts && (opts.title||opts.detail) || 'Continue?'));
          return resolve(ok ? ((opts && opts.buttons && opts.buttons[0] && opts.buttons[0].id) || 'ok') : null);
        }
        const title = (opts && opts.title) || 'Confirm';
        const detail = (opts && opts.detail) || '';
        const buttons = (opts && Array.isArray(opts.buttons)) ? opts.buttons : [{id:'ok', label:'OK', primary:true}];
        const restoreEl = (opts && opts.returnFocusEl) || ((_mode==='CMD' && cmdinput) ? cmdinput : editor);
        _modalTitle.textContent = title;
        _modalDetail.textContent = detail;
        _modalButtons.innerHTML = '';
        const btnEls = [];
        for (const b of buttons){
          const el = document.createElement('button');
          el.textContent = b.label || b.id;
          if (b.primary) el.classList.add('primary');
          if (b.danger) el.classList.add('danger');
          el.addEventListener('click', ()=>{ cleanup(); resolve(b.id); }, { once:true });
          _modalButtons.appendChild(el);
          btnEls.push(el);
        }
        const onKey = (e)=>{
          if (_isEsc(e)){ e.preventDefault(); cleanup(); resolve(null); }
          else if (e.key==='Enter'){ e.preventDefault(); cleanup(); resolve((buttons.find(x=>x.primary)||buttons[0]).id); }
          else if (e.key>='1' && e.key<='9'){
            const idx = parseInt(e.key,10) - 1;
            if (idx >= 0 && idx < buttons.length){ e.preventDefault(); cleanup(); resolve(buttons[idx].id); }
          } else if (e.key==='Tab'){
            // trap focus within the choice buttons
            e.preventDefault();
            if (!btnEls.length) return;
            const idx = btnEls.findIndex(el=> el===document.activeElement);
            const dir = e.shiftKey ? -1 : 1;
            const next = (idx>=0 ? (idx+dir+btnEls.length)%btnEls.length : (dir>0?0:btnEls.length-1));
            try{ btnEls[next].focus(); }catch{}
          }
        };
        const cleanup = ()=>{ try{ document.removeEventListener('keydown', onKey); }catch{} _hideModal(); try{ setTimeout(()=>{ try{ restoreEl && restoreEl.focus && restoreEl.focus(); }catch{} }, 0); }catch{} };
        document.addEventListener('keydown', onKey);
        _showModal();
        try{ const prim = btnEls.find(el=>el.classList.contains('primary')) || btnEls[0]; if (prim){ prim.focus(); requestAnimationFrame(()=>{ try{ prim.focus(); }catch{} }); setTimeout(()=>{ try{ prim.focus(); }catch{} }, 0); } }catch{}
      }catch{ resolve(null); }
    });
  }

  // Help modal (:help)
  function helpModal(opts){
    // opts: { defaultTab: 'all'|'cmd'|'normal'|'insert'|'visual' }
    return new Promise((resolve)=>{
      try{
    if (!_modalOverlay || !_modalTitle || !_modalDetail || !_modalButtons){
          try{ alert('Help is not available in this environment.'); }catch{}
          resolve();
          return;
        }
  // Remember mode to restore after closing help
  const _prevHelpMode = (opts && opts.restoreMode) ? opts.restoreMode : _mode;
  // Prevent any editor scrolling while help is open
  const stKeep = (editor && typeof editor.scrollTop === 'number') ? editor.scrollTop : 0;
  try{ _suppressScrollDuringModal = true; _scrollGuardUntil = Date.now() + 2000; _zoomGuardUntil = Date.now() + 2000; }catch{}
  // Build modal chrome
  const prevBtnsDisp = _modalButtons && _modalButtons.style ? _modalButtons.style.display : '';
  try{ if (_modalButtons) _modalButtons.style.display = 'none'; }catch{}
  const prevBoxBg = _modalBox && _modalBox.style ? _modalBox.style.background : '';
  try{ if (_modalBox) _modalBox.style.background = 'var(--six-modal-bg, #1e1e1e)'; }catch{}
  const prevDetailPad = _modalDetail && _modalDetail.style ? _modalDetail.style.padding : '';
  try{ if (_modalDetail) _modalDetail.style.padding = '0'; }catch{}
  _modalButtons.innerHTML = '';
        // Title
        try{ _modalTitle.textContent = 'Six ヘルプ'; }catch{}

        // Prepare content skeleton
    _modalDetail.innerHTML = '';
  const root = document.createElement('div');
  root.id = 'help';
    root.style.display = 'flex';
        root.style.flexDirection = 'column';
        root.style.width = '72vw';
        root.style.maxWidth = '1000px';
  root.style.height = '68vh';
        root.style.maxHeight = '80vh';
  root.style.margin = '0';
  root.style.fontSize = '15px';

        // Tabs bar
        const tabsBar = document.createElement('div');
        tabsBar.style.display = 'flex';
        tabsBar.style.gap = '8px';
  tabsBar.style.borderBottom = '1px solid var(--six-border,#888)';
  tabsBar.style.paddingBottom = '6px';
  tabsBar.style.outline = 'none';

        // Scrollable content area
        const sc = document.createElement('div');
        sc.style.flex = '1 1 auto';
        sc.style.overflow = 'auto';
  sc.style.padding = '8px 2px 8px 2px';
  sc.tabIndex = -1; // focus stays on modal, not scroll area
  sc.style.outline = 'none';

        // Bottom ops line (non-scroll)
        const ops = document.createElement('div');
        ops.style.flex = '0 0 auto';
        ops.style.display = 'flex';
        ops.style.borderTop = '1px solid var(--six-border,#888)';
        ops.style.alignItems = 'center';
  ops.style.padding = '6px 0 0 0';
  ops.style.margin = '0';

        const opsLeft = document.createElement('div');
        opsLeft.style.whiteSpace = 'nowrap';
        opsLeft.style.overflow = 'hidden';
        opsLeft.style.textOverflow = 'ellipsis';
        // Esc は記載しない（ボタンに表示）
        const keys = ['j','k','↓','↑','SPACE','Shift+SPACE','gg','G','Tab','Shift+Tab'];
        const styleKbd = (el)=>{
          try{
            el.style.background = 'var(--six-help-kbd-bg, rgb(95,143,223))';
            el.style.color = 'var(--six-help-kbd-fg, #000)';
            el.style.borderRadius = '0.18rem';
            el.style.padding = '0 0.22rem';
            el.style.margin = '0 2px';
          }catch{}
        };
        keys.forEach((k, idx)=>{
          const kbd = document.createElement('kbd'); kbd.textContent = k; styleKbd(kbd);
          opsLeft.appendChild(kbd);
          if (idx < keys.length-1){ opsLeft.appendChild(document.createTextNode(' / ')); }
        });
        const opsRight = document.createElement('div');
        opsRight.style.marginLeft = 'auto';
  const btnClose = document.createElement('button');
  btnClose.textContent = '閉じる(Esc)';
  // Match Unsaved changes [Save] look (themeable)
  btnClose.style.minWidth = '80px';
  btnClose.style.border = '1px solid var(--six-help-close-border, #2f4064)';
  btnClose.style.background = 'var(--six-help-close-bg, #2a3756)';
  btnClose.style.color = 'var(--six-help-close-fg, #e6e6e6)';
  btnClose.style.padding = '6px 10px';
  btnClose.style.borderRadius = '6px';
  btnClose.style.cursor = 'pointer';
        opsRight.appendChild(btnClose);
        ops.appendChild(opsLeft);
        ops.appendChild(opsRight);

        // Assemble
        root.appendChild(tabsBar);
        root.appendChild(sc);
        root.appendChild(ops);
        _modalDetail.appendChild(root);

        // Tabs
        const TABS = [
          { id:'all', label:'全体' },
          { id:'cmd', label:'コマンド' },
          { id:'normal', label:'NORMAL' },
          { id:'insert', label:'INSERT' },
          { id:'visual', label:'VISUAL' },
          { id:'regex', label:'正規表現' }
        ];
        let curTab = (opts && opts.defaultTab) || 'cmd';
        if (!TABS.some(t=>t.id===curTab)) curTab = 'cmd';

        const tabButtons = new Map();
        function applyTabStyles(){
          for (const [id, el] of tabButtons.entries()){
            if (id === curTab){
              el.style.borderBottom = '2px solid var(--six-accent,#4b8)';
              el.style.background = 'var(--six-help-tab-active-bg, rgba(0,0,0,0.06))';
              el.style.color = 'var(--six-help-tab-active-fg, inherit)';
              el.setAttribute('aria-selected','true');
            } else {
              el.style.borderBottom = '2px solid transparent';
              el.style.background = 'var(--six-help-tab-bg, transparent)';
              el.style.color = 'var(--six-help-tab-fg, inherit)';
              el.setAttribute('aria-selected','false');
            }
          }
        }
        function renderContent(){
          sc.innerHTML = '';
          const wrap = document.createElement('div');
          wrap.style.padding = '4px 8px';
          wrap.style.lineHeight = '1.55';
          wrap.style.margin = '0';

          const mkH = (txt)=>{ const h=document.createElement('div'); h.textContent = txt; h.style.fontWeight='600'; h.style.margin='6px 0'; return h; };
          const mkP = (txt)=>{ const p=document.createElement('div'); p.textContent = txt; p.style.whiteSpace='pre-wrap'; return p; };
          const mkList = (items)=>{
            const ul = document.createElement('ul'); ul.style.margin='6px 0 10px 1.2em'; ul.style.padding='0';
            items.forEach(item=>{
              const li=document.createElement('li');
              if (typeof item === 'string'){ li.textContent=item; }
              else if (Array.isArray(item)){
                item.forEach((node, idx)=>{
                  if (typeof node === 'string'){ li.appendChild(document.createTextNode(node)); }
                  else { li.appendChild(node); }
                });
              }
              ul.appendChild(li);
            });
            return ul;
          };
          const K = (txt)=>{ const k=document.createElement('kbd'); k.textContent=txt; styleKbd(k); return k; };
          const sep = (s)=> document.createTextNode(s);

          if (curTab==='all'){
            // 起動後に変更可能なパラメータの初期値
            wrap.appendChild(mkH('起動後に変更可能なパラメータの初期値'));
            const initList = [
              'scrolloff = 3',
              '検索ハイライト hlsearch = off',
              '制御文字表示 list = on'
            ];
            initList.forEach(s=>{ const d=document.createElement('div'); d.textContent=s; wrap.appendChild(d); });
            // ウインドウ
            wrap.appendChild(mkH('ウインドウ'));
            const winList = [
              'エディタ拡大率は Ctrl+ホイール で変更可能で、前回終了時の拡大率を維持',
              '1行の文字数：110 (半角)',
              '行数：32'
            ];
            wrap.appendChild(mkList(winList.map(x=>[x])));
            // 即時終了
            wrap.appendChild(mkH('即時終了'));
            // サブセクション: ウインドウのクローズボタン / F10 / ボタンクリック
            const mkSub = (title, lines)=>{
              const sub = document.createElement('div');
              sub.style.marginLeft = '1.2em';
              const h = mkH(title); try{ h.style.margin = '6px 0 2px 0'; }catch{}
              const list = mkList(lines.map(x=>[x])); try{ list.style.marginLeft = '1.2em'; }catch{}
              sub.appendChild(h); sub.appendChild(list); return sub;
            };
            wrap.appendChild(mkSub('ウインドウのクローズボタン', [
              '即時終了と同等。変更の有無にかかわらず確認ダイアログ無しで終了',
              '現在のセッション状態を保存してから終了（未保存の編集・モード・ビュー・Undo一部を次回復元）'
            ]));
            wrap.appendChild(mkSub('F10', [
              '即時終了のショートカット。NORMAL/INSERT/VISUALの各モードで受け付け',
              '現在のセッション状態を保存してから終了（未保存の編集・モード・ビュー・Undo一部を次回復元）'
            ]));
            wrap.appendChild(mkSub('ボタンクリック', [
              '右下オーバーレイの「即時終了/F10」ボタンで同等動作',
              '未保存の編集内容・モード状態（NORMAL/INSERT/VISUAL）・Undo履歴は通常の作業中に随時セッションへ保存され、次回起動時に復元される'
            ]));
          } else if (curTab==='cmd'){
            // 先頭の「コマンド」見出しは不要
            const strongHeadings = new Set(['置換','読み込み','保存・終了','検索・ハイライト','検索ハイライト','ジャンプ','表示','その他']);
            const section = (title, items)=>{
              const h = mkH(title);
              if (strongHeadings.has(title)){
                try{ h.style.fontSize = '1.1em'; h.style.fontWeight = '700'; }catch{}
              }
              wrap.appendChild(h);
              wrap.appendChild(mkList(items));
            };
            const sectionSub = (title, items)=>{
              const subWrap = document.createElement('div');
              subWrap.style.marginLeft = '1.2em';
              const h = mkH(title);
              try{ h.style.margin = '6px 0 2px 0'; }catch{}
              const list = mkList(items);
              try{ list.style.marginLeft = '1.2em'; }catch{}
              subWrap.appendChild(h);
              subWrap.appendChild(list);
              wrap.appendChild(subWrap);
            };
            // 読み込み
            section('読み込み', [
              [K(':e '), sep('（半角スペースまで入力で）ファイル選択ポップアップ')],
              [K(':e!'), sep(' 現バッファを再読込（変更破棄）。ファイル名は不要・無視')]
            ]);
            // 保存・終了
            section('保存・終了', [
              [K(':w'), sep(' 保存 / '), K(':wa'), sep(' すべて保存 / '), K(':wq'), sep(' 保存して終了 / '), K(':wqa'), sep(' すべて保存して終了')],
              [K(':w!'), sep(' 強制保存（許可されている場合）')],
              [K(':q'), sep(' 終了 / '), K(':q!'), sep(' 変更破棄して終了 / '), K(':qa'), sep(' すべて終了')]
            ]);
            // ジャンプ
            section('ジャンプ', [
              [K(':N'), sep('N行目にジャンプ')]
	    ]);
            // 置換
            section('置換', [
              [K(':s'), sep('(1行のみ) / '), K(':%s'), sep('(ファイル全体) / '), K(":'<,'>s"), sep('（VISUAL 範囲）でテキストを置換')],
              ['置換はデフォルトで各行の最初の一致のみ。', K('g'), sep(' フラグで行内全一致に')]
            ]);
            sectionSub('書式', [
              [K(':s/pat/repl/flags')],
              [K(':%s/pat/repl/flags')],
              [K(":'\u003c,'\u003e s/pat/repl/flags")]
            ]);
            sectionSub('フラグ', [
              [K('g'), sep(' 行内の全一致を置換（無指定時は各行内で最初の1箇所のみ）')],
              [K('i'), sep(' 大文字小文字を無視する（case-insensitive）')],
              [K('c'), sep(' 各候補ごとに確認モーダルを表示（y/n/a/q/u）')],
              [K('n'), sep(' 件数のみを表示し、テキストは変更しない（非破壊） ※replは無視')]
            ]);
            sectionSub('確認モーダル操作', [
              [K('y'), sep(' 置換 / '), K('n'), sep(' スキップ / '), K('a'), sep(' 以降すべて置換 / '), K('q'), sep(' 中止 / '), K('u'), sep(' 1手戻す（モーダル内）')]
            ]);
            sectionSub('範囲指定', [
              [K('%'), sep(' バッファ全体')],
              [K("'\u003c,'\u003e"), sep(' VISUAL 範囲（VISUAL 中に '), K(':'), sep(' を押すと自動付与）')]
            ]);
            sectionSub('メッセージ', [
              [K('replaced: N'), sep(' 置換数（0 の場合も '), K('replaced: 0'), sep(' を表示）')],
              [K('X matches on Y lines'), sep(' '), K('n'), sep(' フラグ時の件数表示（非破壊）')]
            ]);
            sectionSub('エラー', [
              ['不正なフラグ（大文字など）が含まれる場合、エラーを表示し置換は実行しない'],
              ['正規表現コンパイルに失敗した場合も実行しない']
            ]);
            sectionSub('例', [
              [K(':%s/foo/bar/g'), sep(' 全行で '), K('foo'), sep(' を '), K('bar'), sep(' に全置換')],
              [K(":'\u003c,\u003e s/\\bdog\\b/cat/g"), sep(' 選択範囲で単語 '), K('dog'), sep(' を '), K('cat'), sep(' に')],
              [K(':s/^\\s\u002b//'), sep(' 先頭の空白を1箇所削除（現在行）')]
            ]);
            // 検索ハイライト
            section('検索ハイライト', [
              [K(':set hlsearch'), sep(' 有効 / '), K(':set nohlsearch'), sep(' 無効 / '), K(':set hlsearch!'), sep(' トグル')]
            ]);
            // ビジュアルベル
            section('ビジュアルベル', [
              [K(':set visualbell'), sep(' 有効 / '), K(':set novisualbell'), sep(' 無効 / '), K(':set visualbell!'), sep(' トグル / '), K(':set visualbell?'), sep(' 状態表示')],
              [sep('失敗時などにエディタ全体を一瞬黒くフラッシュ表示します')],
              [sep('既定値: 起動時 visualbell=on (SIX_OPTIONS.visualbell===false なら off)')]
            ]);
            // 制御文字表示 (:set list)
            section('制御文字表示', [
              [K(':set list'), sep(' 有効 / '), K(':set nolist'), sep(' 無効 / '), K(':set list!'), sep(' トグル / '), K(':set list?'), sep(' 状態表示')],
              [sep('表示内容: タブ → '), K('▸'), sep(' / 行末 → '), K('↲'), sep(' / 末尾の空白 → '), K('·')],
              [sep('行末記号色: '), K('LF(unix)'), sep(' 緑 / '), K('CRLF(dos)'), sep(' 青 / '), K('CR(mac)'), sep(' 赤')],
              [sep('既定値: 起動時 list=on (SIX_OPTIONS.list===false なら off)')]
            ]);
            // 表示
            section('表示', [
              [K(':set scrolloff=N'), sep(' スクロールオフ（上下余白行数） / '), K(':set scrolloff?'), sep(' 現在値表示 / '), K(':set so=N'), sep(' 省略形')],
              [sep('既定値: セッション未保存時 scrolloff=3 （変更はセッションへ保存し次回復元）')]
            ]);
            // インデント
            section('インデント', [
              [K(':set shiftwidth=N'), sep(' / '), K(':set sw=N'), sep(' インデント幅（半角スペース数）を設定（バッファ毎・セッション保存・既定値4）')],
              [K(':set shiftwidth?'), sep(' 現在の '), K('shiftwidth'), sep(' を表示')]
            ],[
              K(':set ignorecase'), sep(' / '), K(':set noignorecase'), sep(' 検索で大文字小文字を無視 / 区別（バッファ毎）')
            ],[
              K(':set ignorecase!'), sep(' トグル '), K(':set ignorecase?'), sep(' 状態表示')
            ],[
              K(':set smartcase'), sep(' / '), K(':set nosmartcase'), sep(' smartcase: 英大文字含むパターンで大文字小文字を区別')
            ],[
              K(':set smartcase!'), sep(' トグル '), K(':set smartcase?'), sep(' 状態表示')
            ]);
            // その他
            section('その他', [
              [K(':pick'), sep(' ピッカー起動 / '), K(':pick!'), sep(' 強制起動')],
              [K(':help'), sep(' このヘルプを開く')],
              // Discoverability: overlay buttons and function keys
              [sep('右下オーバーレイ: '), K('ヘルプ'), sep(' (F9 と同等) / '), K('検索ハイライト'), sep(' ON/OFF トグル')],
              [sep('タブ切替: '), K('F1'), sep('〜'), K('F8'), sep(' で直接切替（:b ポップアップでも F キー確定可）')]
            ]);
          } else if (curTab==='normal'){
            const mkSec = (title)=>{ const h=mkH(title); try{ h.style.fontSize='1.1em'; h.style.fontWeight='700'; }catch{} return h; };

            // 移動
            wrap.appendChild(mkSec('移動(モーション)'));
            wrap.appendChild(mkList([
              [K('h'), sep(' / '), K('←'), sep(' 左へ1文字')],
              [K('j'), sep(' / '), K('↓'), sep(' 下へ1行')],
              [K('k'), sep(' / '), K('↑'), sep(' 上へ1行')],
              [K('l'), sep(' / '), K('→'), sep(' 右へ1文字')],
              [K('gg'), sep('  先頭へ')],
              [K('G'), sep('  末尾へ')],
              [K('0'), sep('  行頭へ')],
              [K('Home'), sep('  行頭へ（'), K('0'), sep(' と同等）')],
              [K('^'), sep('  空白文字に続く行頭へ')],
              [K('$'), sep('  行末へ')],
              [K('End'), sep('  行末へ（'), K('$'), sep(' と同等）')],
              [K('w'), sep(' / '), K('b'), sep('  単語の先頭へ進む/戻る')],
              [K('W'), sep(' / '), K('B'), sep('  WORD（空白区切りの大きな語）単位で進む/戻る')],
              [K('Nw'), sep(' / '), K('Nb'), sep(' / '), K('NW'), sep(' / '), K('NB'), sep('  N回分まとめて移動（例: '), K('3w'), sep('）')],
              [K('{'), sep('  段落/空行区切りの前へ')],
              [K('}'), sep('  段落/空行区切りの次へ')]
            ]));

            // オペレータ
            wrap.appendChild(mkSec('オペレータ'));
            wrap.appendChild(mkList([
              [K('x'), sep('  caret直下の1文字削除（yank バッファは更新しない。2以上の前置数字時のみ更新）')],
              [K('dd'), sep(' 行削除')],
              [K('d モーション'), sep(' 削除 ※範囲はモーションによる')], 
              [K('Nd モーション'), sep('  カウント付き（例: '), K('2dw'), sep('）')],
              [K('yy'), sep(' 行ヤンク(行コピー)（空ならyank バッファを更新しない）')],
              [K('y モーション'), sep(' ヤンク(コピー) ※範囲はモーションによる ')],
              [K('Y'), sep(' Windowsクリップボードへコピー（y のモーション/カウントと同等、unnamed レジスタは変えない。空の場合はWindowsクリップボードを更新しない。例: '), K('YY'), sep(' / '), K('3Yw'), sep('）')],
              [K('p'), sep('  caret行の下に行ペースト')],
              [K('P'), sep('  caret行の上に行ペースト')],
              [K('s'), sep('  1文字変更 (cl と同等。前置カウントで複数文字)。1文字のみではunnamedレジスタを更新しない。改行も1文字として扱う')],
              [K('cl'), sep('  1文字変更（'), K('s'), sep(' と同等。前置カウントで複数文字）。1文字のみではunnamedレジスタを更新しない。改行も1文字として扱う')],
              [K('>>'), sep('  インデントを '), K('shiftwidth'), sep(' 分増やす（現在行から）。前置カウント '), K('N'), sep(' で '), K('N'), sep(' 行を対象（例: '), K('3>>'), sep('）')],
              [K('<<'), sep('  インデントを '), K('shiftwidth'), sep(' 分減らす（現在行から）。前置カウント '), K('N'), sep(' で '), K('N'), sep(' 行を対象')],
              [sep('※ 空行は変更しません（対象行数には含まれます）。行頭の連続 '), K('TAB'), sep(' は保持し、その直後に空白を挿入/削除します')]
            ]));

            // 検索
            wrap.appendChild(mkSec('検索'));
            wrap.appendChild(mkList([
              [K('/'), sep(' EOF方向にインクリメンタル検索（確定で最後の検索状態を更新）')],
              [K('?'), sep(' ファイル先頭方向にインクリメンタル検索（確定で最後の検索状態を更新）')],
              [K('n'), sep(' 最後の検索語を検索方向に沿って検索('), K('/'), sep('による検索ならEOF方向、'), K('?'), sep('による検索ならファイル先頭方向)')],
              [K('N'), sep(' 最後の検索語を検索方向の逆方向に検索('), K('/'), sep('による検索ならファイル先頭方向、'), K('?'), sep('による検索ならEOF方向)')],
              [sep('正規表現: ^ / $ は各行の先頭/末尾にマッチ（内部的にmultiline）。/i で大文字小文字を無視')],
              [sep('例: TAB を検索するには '), K('/\u005ct'), sep('（/ でも ? でも可）。行頭の連続TABは '), K('/^\u005ct+/'), sep(' など')]
            ]));

            // モード切替
            wrap.appendChild(mkSec('モード切替'));
            wrap.appendChild(mkList([
              [K('v'), sep('  VISUAL モードへ(文字単位選択)')],
              [K('V'), sep('  VISUAL モードへ(行単位選択)')],
              [K('i'), sep('  INSERT モードへ(caret位置そのまま)')],
              [K('I'), sep('  行頭へ移動 & INSERT モードへ')],
              [K('a'), sep('  INSERT モードへ(caretを右に1文字移動してから)')],
              [K('A'), sep('  行末へ移動 & INSERT モードへ')],
              [K('o'), sep('  caret行の下に空行作成 & INSERTモード')],
              [K('O'), sep('  caret行の上に空行作成 & INSERTモード')],
              [K('cc'), sep('  行削除 & INSERTモード')],
              [K('c モーション'), sep('  削除 & INSERTモード ※削除範囲はモーションによる')],
              [K('Nc モーション'), sep('  カウント付き（例: '), K('2cw'), sep('）')]
            ]));
          } else if (curTab==='insert'){
            wrap.appendChild(mkH('INSERT'));
            wrap.appendChild(mkP('文字入力とUndoスナップショットの扱い。INSERT中は textarea の標準編集機能（WebView2/Chromium 準拠）も利用できます。挙動はOS/環境に依存します。'));

            // 基本編集
            const mkSec = (title)=>{ const h=mkH(title); try{ h.style.fontSize='1.1em'; h.style.fontWeight='700'; }catch{} return h; };
            wrap.appendChild(mkSec('基本編集'));
            wrap.appendChild(mkList([
              [K('Backspace'), sep('  左の1文字を削除')],
              [K('Delete'), sep('  右の1文字を削除')],
              [K('Enter'), sep('  改行を挿入（Sixの最終改行ポリシー: 視覚のみのダミー最終行あり、保存で自動追加/削除しない）')]
            ]));

            // カーソル移動（標準挙動）
            wrap.appendChild(mkSec('カーソル移動（標準挙動）'));
            wrap.appendChild(mkList([
              [K('←/→/↑/↓'), sep('  1文字/1行 単位で移動')],
              [K('Home'), sep('  行頭へ移動')],
              [K('End'), sep('  行末へ移動')],
              [K('Ctrl+←'), sep('  単語の前へ移動')],
              [K('Ctrl+→'), sep('  単語の次へ移動')],
              [K('PageUp/PageDown'), sep('  複数行を一気に移動（表示環境依存）')]
            ]));

            // 範囲選択（標準挙動）
            wrap.appendChild(mkSec('範囲選択（標準挙動）'));
            wrap.appendChild(mkList([
              [K('Shift+矢印'), sep('  文字/行単位で選択を拡張/縮小')],
              [K('Shift+Home/End'), sep('  行頭/行末まで選択')],
              [K('Ctrl+Shift+←/→'), sep('  単語単位で選択')],
              [K('Ctrl+A'), sep('  全選択')]
            ]));

            // 文字削除（標準挙動）
            wrap.appendChild(mkSec('文字削除（標準挙動）'));
            wrap.appendChild(mkList([
              [K('Ctrl+Backspace'), sep('  左側の単語を削除')],
              [K('Ctrl+Delete'), sep('  右側の単語を削除')]
            ]));

            // クリップボード（Windows/Chromium 標準）
            wrap.appendChild(mkSec('クリップボード（Windows/Chromium 標準）'));
            wrap.appendChild(mkList([
              [K('Ctrl+C'), sep('  選択範囲をコピー（空選択時は行の既定動作は環境依存）')],
              [K('Ctrl+X'), sep('  選択範囲を切り取り')],
              [K('Ctrl+V'), sep('  貼り付け（改行やTABもそのまま挿入）')]
            ]));

            // Undo/Redo（Chromium 標準）
            wrap.appendChild(mkSec('Undo/Redo（Chromium 標準）'));
            wrap.appendChild(mkList([
              [K('Ctrl+Z'), sep('  元に戻す（Undo）')],
              [K('Ctrl+Y / Ctrl+Shift+Z'), sep('  やり直し（Redo、環境によりどちらか）')]
            ]));

            // 注意
            wrap.appendChild(mkSec('注意'));
            wrap.appendChild(mkList([
              [sep('これらは Six 独自実装ではなく textarea の標準機能です。WebView2/Chromium および OS の設定、IME により挙動が変わることがあります。')]
            ]));
          } else if (curTab==='visual'){
            const p = document.createElement('div');
            p.style.whiteSpace='pre-wrap';
            p.appendChild(document.createTextNode('選択範囲の操作。:s との連携（'));
            p.appendChild(K(":'<,'>"));
            p.appendChild(document.createTextNode(' 自動挿入・ハイライト維持）。'));
            wrap.appendChild(p);
            // VISUAL の追加ヘルプ: Y -> Windows クリップボードにコピー
            const p2 = document.createElement('div');
            p2.style.marginTop = '8px';
            p2.appendChild(K('Y'));
            p2.appendChild(document.createTextNode('  選択範囲をWindowsクリップボードへコピーします（行選択/文字選択とも対応）。空の場合はWindowsクリップボードを更新しません。成功時のみ「Copied to Windows clipboard.」トーストを表示します。unnamed レジスタは変更しません。'));
            wrap.appendChild(p2);

            // VISUAL の移動（選択拡張）
            const mkSec = (title)=>{ const h=mkH(title); try{ h.style.fontSize='1.1em'; h.style.fontWeight='700'; }catch{} return h; };
            wrap.appendChild(mkSec('移動(選択拡張)'));
            wrap.appendChild(mkList([
              [K('h'), sep(' / '), K('←'), sep(' 左へ1文字（選択調整）')],
              [K('j'), sep(' / '), K('↓'), sep(' 下へ1行（選択調整）')],
              [K('k'), sep(' / '), K('↑'), sep(' 上へ1行（選択調整）')],
              [K('l'), sep(' / '), K('→'), sep(' 右へ1文字（選択調整）')],
              [K('gg'), sep('  先頭へ（選択範囲更新）')],
              [K('G'), sep('  末尾へ（選択範囲更新）')],
              [K('0'), sep('  行頭へ（選択調整）')],
              [K('Home'), sep('  行頭へ（'), K('0'), sep(' と同等。選択調整）')],
              [K('^'), sep('  空白後の行頭へ（選択調整）')],
              [K('$'), sep('  行末へ（選択調整）')],
              [K('End'), sep('  行末へ（'), K('$'), sep(' と同等。選択調整。前置カウント対応）')],
              [K('w'), sep(' / '), K('b'), sep('  単語単位で進む/戻る（選択調整）')],
              [K('W'), sep(' / '), K('B'), sep('  WORD 単位で進む/戻る（選択調整）')],
              [K('Nw'), sep(' / '), K('Nb'), sep(' / '), K('NW'), sep(' / '), K('NB'), sep('  N回分まとめて移動（例: '), K('3w'), sep('。選択調整）')],
              [K('{'), sep('  段落/空行区切りの前へ（選択調整）')],
              [K('}'), sep('  段落/空行区切りの次へ（選択調整）')]
            ]));

            // 操作
            wrap.appendChild(mkSec('操作'));
            wrap.appendChild(mkList([
              [K('y'), sep('  選択範囲をヤンク（unnamed レジスタ）')],
              [K('Y'), sep('  Windowsクリップボードへコピー（unnamedは変更しない）')],
              [K('d'), sep('  選択削除（レジスタ更新）')],
              [K('c'), sep('  選択削除 + INSERT へ')],
              [K('o'), sep('  caret を選択の反対端へトグル（anchor/caret 入替）')],
              [K('p'), sep('  選択範囲を unnamed レジスタ内容で置換（終了して NORMAL）')],
              [K('> / <'), sep('  インデントを '), K('shiftwidth'), sep(' 分 増減。前置カウント '), K('N'), sep(' で '), K('N'), sep(' 倍量。空行は変更しません。行頭の連続 '), K('TAB'), sep(' は保持し、直後に空白を挿入/削除します')]
            ]));
            // VISUAL 中の検索起動 (#683/#684)
            wrap.appendChild(mkSec('検索起動'));
            wrap.appendChild(mkList([
              [K('/'), sep('  選択文字列を初期値として前方向インクリメンタル検索入力へ。選択中の改行は '), K('\\n'), sep(' / TAB は '), K('\\t'), sep(' にエスケープ表示。正規表現メタ文字は自動的にリテラル化（エスケープ）')],
              [K('?'), sep('  選択文字列を初期値として後方向インクリメンタル検索入力へ。エスケープ仕様は同上')]
            ]));

            // 大文字/小文字変換
            wrap.appendChild(mkSec('大文字/小文字変換'));
            wrap.appendChild(mkList([
              [K('gU'), sep('  選択範囲を大文字化（VISUAL継続）')],
              [K('gu'), sep('  選択範囲を小文字化（VISUAL継続）')]
            ]));

            // テキストオブジェクト（簡易）
            wrap.appendChild(mkSec('テキストオブジェクト（簡易）'));
            wrap.appendChild(mkList([
              [K('i{'), sep(' / '), K('i}'), sep('  最も近い {…} の内部を選択（ネストは最内でなく最外を簡易検出）')],
              [K('a{'), sep(' / '), K('a}'), sep('  最も近い {…} 全体を選択（波括弧含む）')],
              [sep('※ ネスト対応は簡易。複雑な入れ子では最初の対応する括弧を採用する。')]
            ]));
          } else if (curTab==='regex'){
            wrap.appendChild(mkH('正規表現（Sixで使える仕様）'));
            wrap.appendChild(mkList([
              [sep('Six の検索(/, ?)・置換(:s)は JavaScript の正規表現 (ECMAScript) に準拠して解釈します')],
              [sep('検索では '), K('^'), sep(' / '), K('$'), sep(' は常に各行の先頭/末尾にマッチ（内部的に '), K('m'), sep(' フラグを付与）')],
              [sep(' '), K('.'), sep(' は改行にマッチしません。改行を含めて任意文字にしたい場合は '), K('[\u005cs\u005cS]'), sep(' や '), K('(?:.|\n)'), sep(' を使用してください')]
            ]));

            wrap.appendChild(mkH('フラグ'));
            wrap.appendChild(mkList([
              [K('/pat/i'), sep(' / '), K('?pat?i'), sep(' で '), K('i'), sep('（大文字小文字無視）を指定可能。'), K('m'), sep(' は常に有効'), sep('（指定不要）')],
              [K(':s'), sep(' のフラグは '), K('g'), sep('（行内で全置換） / '), K('i'), sep('（大小無視） / '), K('c'), sep('（要確認） / '), K('n'), sep('（件数のみ）')],
              [sep('それ以外のフラグ（例: '), K('s'), sep(' / '), K('u'), sep('）は未対応')] 
            ]));

            wrap.appendChild(mkH('主な構文'));
            wrap.appendChild(mkList([
              [K('.'), sep(' 任意の1文字（改行以外） / '), K('[]'), sep(' 文字クラス / '), K('[^...]'), sep(' 否定文字クラス')],
              [K('^'), sep(' 行頭 / '), K('$'), sep(' 行末 / '), K('\u005cb'), sep(' 単語境界 / '), K('\u005cB'), sep(' 非単語境界')],
              [K('* + ? {m,n}'), sep(' 繰り返し（' ), K('*? +? ?? {m,n}?'), sep(' で最短一致）')],
              [K('()'), sep(' グループ / '), K('(?:...)'), sep(' 非捕捉グループ / '), K('|'), sep(' 選択（OR）')],
              [K('(?=...)'), sep(' 先読み / '), K('(?!...)'), sep(' 否定先読み / '), K('(?<=...)'), sep(' 先行後読み / '), K('(?<!...)'), sep(' 否定先行後読み')],
              [sep('代表的なショートハンド: '), K('\u005cd'), sep('（数字） / '), K('\u005cw'), sep('（英数_） / '), K('\u005cs'), sep('（空白）')]
            ]));

            wrap.appendChild(mkH('置換の特殊シーケンス'));
            wrap.appendChild(mkList([
              [K('$&'), sep(' マッチ全体'),
               sep(' / '), K('$1..$9'), sep(' キャプチャグループ1〜9')],
              [sep(' '), K('$`'), sep('（マッチより前）、'), K('$\''), sep('（マッチより後）、'), K('$+'), sep('（最後のキャプチャ）は現状未対応')]
            ]));

            wrap.appendChild(mkH('文字クラス'));
            wrap.appendChild(mkList([
              [K('[abc]'), sep(' 文字 '), K('a/b/c'), sep(' のいずれかに一致')],
              [K('[^abc]'), sep(' 上記以外（否定）に一致')],
              [K('[a-z]'), sep(' 小文字英字の範囲')],
              [K('[A-Za-z0-9_]'), sep(' 英数字とアンダースコア（'), K('\u005cw'), sep(' と同等）')],
              [K('[ \u005ct]'), sep(' スペースまたは TAB（'), K('\u005cs'), sep(' は空白全般）')],
              [K('[\u005cw.-]'), sep(' 英数_ に加えてピリオドとハイフン')],
              [sep('クラス内のリテラル '), K('-'), sep(' は先頭/末尾に置くか '), K('[\u005c-]'), sep(' のようにエスケープ')],
              [sep('クラス内の '), K(']'), sep(' は '), K('[^\u005c]]'), sep(' のように '), K('\u005c]'), sep(' でエスケープ')],
              [sep('POSIX 文字クラス '), K('[[:digit:]]'), sep(' などは未対応（JavaScript 正規表現仕様）')]
            ]));

            wrap.appendChild(mkH('デリミタとエスケープ'));
            wrap.appendChild(mkList([
              [sep('検索 '), K('/pat/'), sep(' / '), K('?pat?'), sep(' の区切り文字や、置換 '), K(':s/pat/repl/'), sep(' の区切り文字 '), K('/'), sep(' をパターン内で使う場合は '), K('\u005c/'), sep(' のようにエスケープ')],
              [sep('フラグは末尾の '), K('/i'), sep(' や '), K('?i'), sep(' のみ解釈。パターン内の '), K('?'), sep(' は通常どおり量指定子として扱われます')]
            ]));

            wrap.appendChild(mkH('例'));
            wrap.appendChild(mkList([
              [K('/^\u005cs+$/'), sep(' 空白のみの行')],
              [K('/\u005cbfoo\u005cb/'), sep(' 単語 '), K('foo'), sep(' に一致')],
              [K('/(foo|bar)/i'), sep(' 大文字小文字を無視して '), K('foo'), sep(' または '), K('bar')],
              [K(':s/^/# /'), sep(' 行頭に '), K('# '), sep(' を付与（現在行）')],
              [K(':%s/(^|\n)\u005cs*TODO(?!:)/$1TODO:/g'), sep(' TODO の後ろにコロンを付ける（既にある行は除外）')],
              [K('/\u005ct/'), sep(' TAB 文字に一致')],
              [K(':%s/\u005ct/    /g'), sep(' すべての TAB を半角スペース4つに展開')],
              [K(':%s/^\u005ct+//g'), sep(' 行頭の TAB を削除（インデントの TAB 抜き）')],
              [K(':%s/[ \u005ct]+/ /g'), sep(' 連続する空白（スペース/TAB）を単一スペースに圧縮')]
            ]));
          }

          sc.appendChild(wrap);
          // reset scroll on tab switch
          try{ sc.scrollTop = 0; }catch{}
        }

        tabsBar.innerHTML = '';
        for (const t of TABS){
          const b = document.createElement('button');
          b.textContent = t.label;
          b.setAttribute('role','tab');
          b.style.background = 'transparent';
          b.style.border = 'none';
          b.style.padding = '6px 8px';
          b.style.cursor = 'pointer';
          b.style.outline = 'none'; b.style.boxShadow = 'none';
          b.setAttribute('tabindex','-1');
          b.addEventListener('click', (ev)=>{ ev.preventDefault(); curTab = t.id; applyTabStyles(); renderContent(); try{ b.blur(); }catch{} });
          tabsBar.appendChild(b);
          tabButtons.set(t.id, b);
        }
  applyTabStyles(); renderContent();
  // Prevent focusing tabs/content area by mouse (avoid focus ring after click)
  try{ tabsBar.addEventListener('mousedown', (e)=>{ e.preventDefault(); }, true); }catch{}
  try{ sc.addEventListener('mousedown', (e)=>{ e.preventDefault(); }, true); }catch{}

        // Key handling (trap inside modal)
        let gPending = false; let gTimer = 0;
        const cleanup = ()=>{
          try{ document.removeEventListener('keydown', onKey, true); }catch{}
          _hideModal();
          try{
            setTimeout(()=>{
              try{
                // Restore the mode present before opening help
                if (_prevHelpMode === 'INSERT'){
                  _suppressInsertSnapshotOnce = true;
                  _setMode('INSERT');
                } else if (_prevHelpMode === 'VISUAL'){
                  // If we came from VISUAL via ':' (CMD), rebuild the selection from the saved snapshot
                  const hasSnap = Number.isFinite(_visCmdAnchorR) && Number.isFinite(_visCmdAnchorC);
                  if (hasSnap){
                    try{
                      _visualActive = true;
                      _visualLinewise = !!_visCmdLinewise;
                      _visualAnchorR = (_visCmdAnchorR|0);
                      _visualAnchorC = (_visCmdAnchorC|0);
                      if (Number.isFinite(_visCmdCaretR) && Number.isFinite(_visCmdCaretC)){
                        caretRow = (_visCmdCaretR|0); caretCol = (_visCmdCaretC|0);
                      }
                    }catch{}
                  }
                  _setMode('VISUAL');
                  _updateVisualSelection();
                  // Clear any CMD-time overlay artifacts
                  try{ _visCmdActive = false; _cmdFromVisual = false; _visSelClear && _visSelClear(); }catch{}
                } else if (_prevHelpMode === 'CMD'){
                  // Keep CMD mode and return focus to command input if available
                  _setMode('CMD');
                  try{ if (cmdinput){ cmdinput.focus(); } }catch{}
                  try{ _positionCmdFloat(); }catch{}
                } else {
                  _setMode('NORMAL');
                  editor && editor.focus && editor.focus();
                }
              }catch{}
            }, 0);
          }catch{}
          try{ if (_modalButtons) _modalButtons.style.display = prevBtnsDisp; }catch{}
          try{ if (_modalBox) _modalBox.style.background = prevBoxBg; }catch{}
          try{ if (_modalDetail) _modalDetail.style.padding = prevDetailPad; }catch{}
          try{ if (typeof stKeep === 'number' && editor) editor.scrollTop = stKeep; }catch{}
          try{ _suppressScrollDuringModal = false; }catch{}
          try{
            // absorb stray keys and reinforce scrollTop to avoid any jump
            _kbdGuardUntil = Date.now() + 350; _clearPending();
            const reinforce = ()=>{ try{ if (editor && typeof stKeep==='number') editor.scrollTop = stKeep; }catch{} };
            reinforce();
            if (window.requestAnimationFrame){
              requestAnimationFrame(()=>{ reinforce(); requestAnimationFrame(()=>reinforce()); });
            }
            setTimeout(reinforce, 120);
            _scrollGuardUntil = Date.now() + 500;
          }catch{}
          resolve();
        };
        const scrollByLines = (n)=>{
          try{
            const lh = (typeof LINE_HEIGHT==='number' && LINE_HEIGHT>0) ? LINE_HEIGHT : 20;
            sc.scrollTop = Math.max(0, sc.scrollTop + n*lh);
          }catch{}
        };
        const switchTab = (dir)=>{
          try{
            const idx = TABS.findIndex(t=>t.id===curTab);
            const next = (idx+dir+TABS.length)%TABS.length;
            curTab = TABS[next].id; applyTabStyles(); renderContent();
          }catch{}
        };
        const onKey = (e)=>{
          // Prevent leaking to editor and block browser defaults for function keys while help is open
          try{ e.stopPropagation(); }catch{}
          if (_isEsc(e)){ e.preventDefault(); cleanup(); return; }
          // hidden shortcuts: q/Q/F9 to close
          if (e.key==='q' || e.key==='Q' || e.key==='F9'){ e.preventDefault(); cleanup(); return; }
          // Consume remaining function keys (e.g., F1〜F8, F10〜F12) so Edge/host側に渡さない
          if (/^F\d{1,2}$/i.test(e.key)) { e.preventDefault(); return; }
          // Tab / Shift+Tab
          if (e.key==='Tab'){ e.preventDefault(); switchTab(e.shiftKey?-1:1); return; }
          // Ctrl+I / Ctrl+Shift+I as Tab / Shift+Tab equivalents
          if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key==='i' || e.key==='I')){ e.preventDefault(); switchTab(e.shiftKey?-1:1); return; }
          if (e.key==='j' || e.key==='ArrowDown'){ e.preventDefault(); scrollByLines(1); return; }
          if (e.key==='k' || e.key==='ArrowUp'){ e.preventDefault(); scrollByLines(-1); return; }
          if (e.key===' '){ e.preventDefault(); scrollByLines(e.shiftKey ? -1 : 1); return; }
          if (e.key==='G'){ e.preventDefault(); sc.scrollTop = sc.scrollHeight; return; }
          if (e.key==='g'){
            e.preventDefault();
            if (gPending){
              // gg
              gPending = false; try{ clearTimeout(gTimer); }catch{}
              sc.scrollTop = 0; return;
            } else {
              gPending = true; try{ clearTimeout(gTimer); }catch{} gTimer = setTimeout(()=>{ gPending=false; }, 700);
              return;
            }
          }
        };
        document.addEventListener('keydown', onKey, true);
        btnClose.addEventListener('click', ()=> cleanup(), { once:true });
        _showModal();
        try{ editor && (editor.scrollTop = stKeep); }catch{}
        try{
          const reinforce = ()=>{ try{ if (editor) editor.scrollTop = stKeep; }catch{} };
          reinforce();
          if (window.requestAnimationFrame){
            requestAnimationFrame(()=>{ reinforce(); requestAnimationFrame(()=>reinforce()); });
          }
          setTimeout(reinforce, 120);
        }catch{}
      }catch{ resolve(); }
    });
  }

  // Substitute confirmation modal (y/n/a/q) without numeric shortcuts
  async function _subConfirmModal(detail, opts){
    return new Promise((resolve)=>{
      try{
        if (!_modalOverlay || !_modalTitle || !_modalDetail || !_modalButtons){
          const ok = window.confirm(String(detail||'Replace?'));
          resolve(ok ? 'y' : 'n');
          return;
        }
  // Always restore focus to editor per spec
  const restoreEl = editor;
        const cmdLabel = opts && opts.cmdLabel ? String(opts.cmdLabel) : '';
        const canUndo = !!(opts && opts.canUndo);
        // Build title with 4rem gap between label and command
        try{
          _modalTitle.textContent = '';
          const spanTitle = document.createElement('span');
          spanTitle.textContent = 'Substitute(置換)';
          const spanCmd = document.createElement('span');
          spanCmd.textContent = cmdLabel;
          spanCmd.style.marginLeft = '4rem';
          _modalTitle.appendChild(spanTitle);
          if (cmdLabel){ _modalTitle.appendChild(spanCmd); }
        }catch{
          // Fallback to simple text if DOM ops fail
          _modalTitle.textContent = 'Substitute(置換)' + (cmdLabel? ('    ' + cmdLabel) : '');
        }
        _modalDetail.textContent = String(detail||'Replace this occurrence?');
        _modalButtons.innerHTML = '';
        const btnY = document.createElement('button'); btnY.textContent='Yes (y)'; btnY.classList.add('primary');
        const btnN = document.createElement('button'); btnN.textContent='No (n)';
        const btnA = document.createElement('button'); btnA.textContent='All (a)';
        const btnQ = document.createElement('button'); btnQ.textContent='Quit (q)'; btnQ.classList.add('danger');
  const btnU = document.createElement('button'); btnU.textContent='Undo (u)'; btnU.disabled = !canUndo; if (btnU.disabled){ btnU.style.color = 'gray'; }
        _modalButtons.appendChild(btnY); _modalButtons.appendChild(btnN); _modalButtons.appendChild(btnA); _modalButtons.appendChild(btnU); _modalButtons.appendChild(btnQ);
        const buttons = { y:btnY, n:btnN, a:btnA, u:btnU, q:btnQ };
  const cleanup = ()=>{ try{ document.removeEventListener('keydown', onKey); }catch{} _hideModal(); try{ setTimeout(()=>{ try{ restoreEl && restoreEl.focus && restoreEl.focus(); _renderVisSelOverlay(); }catch{} }, 0); }catch{} };
        const finish = (ch)=>{ try{ const el=buttons[ch]; el && el.focus && el.focus(); }catch{} cleanup(); resolve(ch); };
        btnY.addEventListener('click', ()=>finish('y'), { once:true });
        btnN.addEventListener('click', ()=>finish('n'), { once:true });
        btnA.addEventListener('click', ()=>finish('a'), { once:true });
        btnU.addEventListener('click', ()=>{ if (!btnU.disabled) finish('u'); }, { once:true });
        btnQ.addEventListener('click', ()=>finish('q'), { once:true });
        const onKey = (e)=>{
          try{ _renderVisSelOverlay(); }catch{}
          if (_isEsc(e)){ e.preventDefault(); e.stopPropagation(); finish('q'); }
          else if (e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); finish('y'); }
          else if (e.key==='y' || e.key==='Y'){ e.preventDefault(); e.stopPropagation(); finish('y'); }
          else if (e.key==='n' || e.key==='N'){ e.preventDefault(); e.stopPropagation(); finish('n'); }
          else if (e.key==='a' || e.key==='A'){ e.preventDefault(); e.stopPropagation(); finish('a'); }
          else if (e.key==='u' || e.key==='U'){ e.preventDefault(); e.stopPropagation(); if (!btnU.disabled) finish('u'); }
          else if (e.key==='q' || e.key==='Q'){ e.preventDefault(); e.stopPropagation(); finish('q'); }
          else if (e.key==='Tab'){
            // Trap focus among enabled buttons only
            e.preventDefault(); e.stopPropagation();
            const btns=[btnY,btnN,btnA,btnU,btnQ].filter(b=>!b.disabled);
            const idx = btns.findIndex(el=> el===document.activeElement);
            const dir = e.shiftKey ? -1 : 1;
            const next = (idx>=0 ? (idx+dir+btns.length)%btns.length : (dir>0?0:btns.length-1));
            try{ btns[next].focus(); }catch{}
          }
        };
  document.addEventListener('keydown', onKey);
  _showModal();
  try{ _renderVisSelOverlay(); }catch{}
        try{ btnY.focus(); }catch{}
      }catch{ resolve('n'); }
    });
  }

  function _expandReplacement(template, match){
    try{
      const src = String(template||'');
      return src.replace(/\$(\d|&)/g, (m, g1)=>{
        if (g1 === '&') return String(match[0]||'');
        const idx = parseInt(g1,10);
        return String(match[idx]||'');
      });
    }catch{ return String(template||''); }
  }

  // Aggregated multi-save dialog for :wq (no bang)
  function multiSaveDialog(modifiedItems){
    // modifiedItems: Array<{b,i}>
    return new Promise((resolve)=>{
      try{
        if (!_modalOverlay || !_modalTitle || !_modalDetail || !_modalButtons){
          // Fallback to sequential prompts if custom modal not available
          (async()=>{
            for (const {b,i} of modifiedItems){
              const id = await choiceModal({ title:'Unsaved changes', detail:`Save changes to: ${b.path? _prettyFileUrlLabel(b.path):(b.name||'(untitled)')}`, buttons:[{id:'save',label:'Save',primary:true},{id:'dont',label:"Don't Save"},{id:'cancel',label:'Cancel',danger:true}] });
              if (id===null || id==='cancel'){ resolve(false); return; }
              if (id==='save' && b.path){ const textData = (i===currentIdx)? _normalizeTextForSaveInternal(editor.value||'') : _normalizeTextForSaveInternal(b.text||''); const ok = await _saveToURLWithExternalCheck(b, b.path, textData); if (!ok){ toast('write failed: ' + (b.name||'')); try{ _triggerVisualBell(); }catch{} resolve(false); return; } try{ if (i===currentIdx){ try{ _selGuardUntil = Date.now() + 800; }catch{} let st=0, sl=0; try{ st=editor.scrollTop|0; sl=editor.scrollLeft|0; }catch{} editor.value=textData; try{ editor.scrollTop=st; editor.scrollLeft=sl; }catch{} try{ _syncNativeSelectionToCaret(); }catch{} } b.text=textData; b.savedText=textData; b._savedTick=(b._changeTick|0); b.modified=false; }catch{} }
            }
            resolve(true);
          })();
          return;
        }
        _modalTitle.textContent = 'Save changes before quitting?';
        _modalDetail.innerHTML = '';
        const listWrap = document.createElement('div');
        listWrap.style.display='flex'; listWrap.style.flexDirection='column'; listWrap.style.gap='6px';
        const rows = new Map();
        function makeRow(entry){
          const {b,i} = entry;
          const row = document.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px';
          const label = document.createElement('div'); label.style.flex='1'; label.style.whiteSpace='nowrap'; label.style.overflow='hidden'; label.style.textOverflow='ellipsis';
          label.textContent = b.path ? _prettyFileUrlLabel(b.path) : (b.name||'(untitled)');
          const btnSave = document.createElement('button'); btnSave.textContent='Save'; btnSave.classList.add('primary'); btnSave.tabIndex = -1; // exclude from focus trap
          const btnSkip = document.createElement('button'); btnSkip.textContent="Don't Save"; btnSkip.tabIndex = -1;
          if (!b.path){ btnSave.disabled = true; btnSave.title = 'No path'; }
          const removeRow = ()=>{ try{ listWrap.removeChild(row); rows.delete(i); }catch{} };
          btnSave.addEventListener('click', async()=>{
            btnSave.disabled = true; btnSkip.disabled=true;
            if (b.path){ const textData = (i===currentIdx)? _normalizeTextForSaveInternal(editor.value||'') : _normalizeTextForSaveInternal(b.text||''); const ok = await _saveToURLWithExternalCheck(b, b.path, textData); if (!ok){ toast('write failed: ' + (b.name||'')); try{ _triggerVisualBell(); }catch{} btnSave.disabled=false; btnSkip.disabled=false; return; } try{ if (i===currentIdx){ try{ _selGuardUntil = Date.now() + 800; }catch{} let st=0, sl=0; try{ st=editor.scrollTop|0; sl=editor.scrollLeft|0; }catch{} editor.value=textData; try{ editor.scrollTop=st; editor.scrollLeft=sl; }catch{} try{ _syncNativeSelectionToCaret(); }catch{} } b.text=textData; b.savedText=textData; b._savedTick = (b._changeTick|0); b.modified=false; }catch{} }
            removeRow(); maybeFinish();
          });
          btnSkip.addEventListener('click', ()=>{ removeRow(); maybeFinish(); });
          row.appendChild(label); row.appendChild(btnSave); row.appendChild(btnSkip);
          rows.set(i, {row, b});
          return row;
        }
        modifiedItems.forEach(x=> listWrap.appendChild(makeRow(x)));
        _modalDetail.appendChild(listWrap);
        _modalButtons.innerHTML='';
        const btnAll = document.createElement('button'); btnAll.textContent='All save'; btnAll.classList.add('primary');
        const btnDiscardAll = document.createElement('button'); btnDiscardAll.textContent='Discard all';
        const btnCancel = document.createElement('button'); btnCancel.textContent='Cancel'; btnCancel.classList.add('danger');
        _modalButtons.appendChild(btnAll); _modalButtons.appendChild(btnDiscardAll); _modalButtons.appendChild(btnCancel);
        const topBtns = [btnAll, btnDiscardAll, btnCancel];
        const finish = (ok)=>{ try{ document.removeEventListener('keydown', onKey); }catch{} _hideModal(); setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} },0); resolve(ok); };
        async function doAllSave(){
          btnAll.disabled = true; btnCancel.disabled = true;
          for (const [i, obj] of Array.from(rows.entries())){
            const b = obj.b;
            if (b && b.modified && b.path){
              const textData = (i===currentIdx)? _normalizeTextForSaveInternal(editor.value||'') : _normalizeTextForSaveInternal(b.text||'');
              const ok = await _saveToURLWithExternalCheck(b, b.path, textData);
              if (!ok){ toast('write failed: ' + (b.name||'')); try{ _triggerVisualBell(); }catch{} btnAll.disabled=false; btnCancel.disabled=false; return; }
              try{ if (i===currentIdx){ editor.value=textData; } b.text=textData; b.savedText=textData; b._savedTick = (b._changeTick|0); b.modified=false; }catch{}
            }
            try{ listWrap.removeChild(obj.row); rows.delete(i); }catch{}
          }
          maybeFinish();
        }
        function doDiscardAll(){
          // treat as don't save for all remaining
          for (const [i, obj] of Array.from(rows.entries())){
            try{ listWrap.removeChild(obj.row); rows.delete(i); }catch{}
          }
          maybeFinish();
        }
        function maybeFinish(){ if (rows.size===0){ finish(true); } }
        btnAll.addEventListener('click', ()=>{ doAllSave(); });
        btnDiscardAll.addEventListener('click', ()=>{ doDiscardAll(); });
        btnCancel.addEventListener('click', ()=>{ finish(false); });
        const onKey = (e)=>{
          if (_isEsc(e)){ e.preventDefault(); finish(false); }
          else if (e.key==='Tab'){
            // trap among top buttons only
            e.preventDefault();
            const idx = topBtns.findIndex(el=> el===document.activeElement);
            const dir = e.shiftKey ? -1 : 1;
            const next = (idx>=0 ? (idx+dir+topBtns.length)%topBtns.length : (dir>0?0:topBtns.length-1));
            try{ topBtns[next].focus(); }catch{}
          }
        };
        document.addEventListener('keydown', onKey);
        _showModal();
        try{ btnAll.focus(); }catch{}
      }catch{ resolve(false); }
    });
  }

  function _clearPending(){
    _pendingNormal = null;
    _pendingNormalCount = null;
    if (_pendingTimer){ clearTimeout(_pendingTimer); _pendingTimer = null; }
  }

  /*********************************************************
   * Events
   *********************************************************/
  function bindEvents(){
  // Show cursor on any mouse move or window blur
  window.addEventListener('mousemove', _showCursor, { passive:true });
  window.addEventListener('blur', _showCursor);
  // When window becomes active, make caret active (hide mouse cursor briefly)
  window.addEventListener('focus', ()=>{
    try{ _hideCursor(); _repositionCaret(); updateGutter(); }catch{}
    // 前面復帰時にアクティブバッファの外部変更も確認（スロットル内蔵） (#476)
    try{
      const idx = (typeof currentIdx==='number') ? currentIdx : -1;
      const b = (idx>=0 && idx<buffers.length) ? buffers[idx] : null;
      if (b && b.path && /^file:\/\//i.test(b.path)){
        _maybeCheckExternalChangeOnActivate(idx);
      }
      // セッション復元直後など idx 未確定の可能性に備え、少し遅延して再試行
      setTimeout(()=>{
        try{
          const idx2 = (typeof currentIdx==='number') ? currentIdx : -1;
          const b2 = (idx2>=0 && idx2<buffers.length) ? buffers[idx2] : null;
          if (b2 && b2.path && /^file:\/\//i.test(b2.path)){
            _maybeCheckExternalChangeOnActivate(idx2);
          }
        }catch{}
      }, 220);
    }catch{}
  });
  // タブ切替なしでアプリが不可視→可視になった場合も同様に確認
  document.addEventListener('visibilitychange', ()=>{
    try{
      if (document.visibilityState === 'visible'){
        const idx = (typeof currentIdx==='number') ? currentIdx : -1;
        const b = (idx>=0 && idx<buffers.length) ? buffers[idx] : null;
        if (b && b.path && /^file:\/\//i.test(b.path)){
          _maybeCheckExternalChangeOnActivate(idx);
        }
        // 端末/環境により発火順が前後する場合のフォローとして遅延再試行
        setTimeout(()=>{
          try{
            const idx2 = (typeof currentIdx==='number') ? currentIdx : -1;
            const b2 = (idx2>=0 && idx2<buffers.length) ? buffers[idx2] : null;
            if (b2 && b2.path && /^file:\/\//i.test(b2.path)){
              _maybeCheckExternalChangeOnActivate(idx2);
            }
          }catch{}
        }, 220);
      }
    }catch{}
  });
  // Unified scroll handler: snap to line grid and render once per frame
  let _scrollRAF = 0;
  const scheduleScrollRender = ()=>{
    try{ if (_scrollRAF) cancelAnimationFrame(_scrollRAF); }catch{}
    _scrollRAF = requestAnimationFrame(()=>{
      try{
        if (Date.now() >= _zoomGuardUntil){
          const st = (editor.scrollTop||0);
          const snapped = Math.round(st/LINE_HEIGHT)*LINE_HEIGHT;
          if (Math.abs(snapped - st) > 0.25){ editor.scrollTop = snapped; }
        }
      }catch{}
      // Hide mouse cursor when visible range changes shortly after caret moved
      if ((Date.now() - _lastCaretMovedAt) < 120){ _hideCursor(); }
      _repositionCaret(); updateGutter(); _renderHlMatchesVisible(); _incPrevRefresh(); _renderVisSelOverlay();
  _updatePosInfo();
      // Persist current buffer's view state (scroll and caret) on every scroll frame
      try{
        const b = currentBuffer();
        if (b){
          b.viewScrollTop = (editor.scrollTop||0)|0;
          b.viewRow = caretRow|0;
          b.viewCol = caretCol|0;
        }
      }catch{}
    });
  };
  viewport.addEventListener('scroll', scheduleScrollRender);
  editor.addEventListener('scroll', scheduleScrollRender);
    // Ctrl + Wheel = editor zoom (only editor/gutter)
    let _lastZoomStepAt = 0;
    const wheelZoom = (e)=>{
      if (e && e.ctrlKey){
        try{ e.preventDefault(); e.stopPropagation(); }catch{}
        const now = Date.now();
        // Rate-limit: step at most once per ~140ms to avoid multi-step jumps per notch
        if (now - _lastZoomStepAt < 140) return;
        const dy = e.deltaY||0;
        if (dy < 0){ _stepEditorScale(+1); } else if (dy > 0){ _stepEditorScale(-1); }
        _lastZoomStepAt = now;
        _zoomGuardUntil = now + 250; // suppress scroll snap briefly during zoom
      }
    };
    // Use non-passive to be able to prevent default browser zoom
    try{ viewport.addEventListener('wheel', wheelZoom, { passive:false }); }catch{ viewport.addEventListener('wheel', wheelZoom); }
    // Also capture Ctrl+Wheel anywhere in the window (outside textarea/tabbar etc.) and treat as editor zoom
    try{
      window.addEventListener('wheel', (e)=>{
        if (e && e.ctrlKey){
          try{ e.preventDefault(); e.stopPropagation(); }catch{}
          wheelZoom(e);
        }
      }, { passive:false, capture:true });
    }catch{
      window.addEventListener('wheel', (e)=>{
        if (e && e.ctrlKey){ try{ e.preventDefault(); e.stopPropagation(); }catch{}; wheelZoom(e); }
      });
    }
    // Capture Ctrl+pinch (trackpad gesture) and suppress browser zoom HUD; map to editor zoom
    const gestureZoom = (e)=>{
      try{ e.preventDefault(); e.stopPropagation(); }catch{}
      const now = Date.now();
      if (now - _lastZoomStepAt < 140) return;
      const s = (typeof e.scale === 'number') ? e.scale : 1;
      if (s > 1.02){ _stepEditorScale(+1); _lastZoomStepAt = now; _zoomGuardUntil = now + 250; }
      else if (s < 0.98){ _stepEditorScale(-1); _lastZoomStepAt = now; _zoomGuardUntil = now + 250; }
    };
    try{ window.addEventListener('gesturestart', (e)=>{ try{ e.preventDefault(); e.stopPropagation(); }catch{} }, { passive:false, capture:true }); }catch{ /* no-op */ }
    try{ window.addEventListener('gesturechange', gestureZoom, { passive:false, capture:true }); }catch{ /* no-op */ }
    try{ window.addEventListener('gestureend',   (e)=>{ try{ e.preventDefault(); e.stopPropagation(); }catch{} }, { passive:false, capture:true }); }catch{ /* no-op */ }
    // Scroll snapping is handled in the unified RAF above
    // IME破棄時のビジュアルベル制御（スパム防止のため軽いスロットリング）
    let _imeBellLastAt = 0;
    editor.addEventListener('beforeinput', (e)=>{
      // NORMAL/VISUAL/CMD では本文変更を全面禁止（未確定表示 insertCompositionText も含む）
      if (_mode !== 'INSERT'){
        try{ e.preventDefault(); }catch{}
        // IME系の insert を捨てる際に visualbell を発行（#530）
        try{
          const it = String(e.inputType||'');
          const isIMEInsert = (it==='insertCompositionText' || it==='insertFromComposition' || (it==='insertText' && _imeComposing===true));
          if (isIMEInsert){
            const now = Date.now();
            if (now - _imeBellLastAt > 120){ _imeBellLastAt = now; try{ _triggerVisualBell && _triggerVisualBell(); }catch{} }
          }
        }catch{}
        _debugPush({ t:Date.now(), type:'beforeinput-block', mode:_mode, inputType:e.inputType, data:e.data, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey, isComp:false });
        return;
      }
      // #624: INSERTモードで削除/改行操作前のテキストを保持（直後差分判定用）
      try{
        const itCap = String(e.inputType||'');
        if (itCap && (itCap.startsWith('delete') || itCap==='insertLineBreak' || itCap==='insertParagraph')){
          _prevTextBeforeInput = String(editor.value||'');
        }
      }catch{}
      // #600: ダミーEOF改行位置での Enter は「ダミー→通常改行」置換にする（空行を作らない）
      try{
        const it = String(e.inputType||'');
        if (it==='insertLineBreak' || it==='insertParagraph'){
          const b = currentBuffer();
          const v = String(editor.value||'');
          const atEnd = (editor.selectionStart|0) === (editor.selectionEnd|0) && (editor.selectionStart|0) === v.length;
          // (#606) ダミー判定は「現在末尾LFが欠落しているか」のみ
          const dummyActive = !!(b && !v.endsWith('\n'));
          if (atEnd && dummyActive){
            // 既定の改行挿入を抑止し、末尾に'\n'だけ追加。caretは改行直前へ戻すことで末尾空行を表示しない
            try{ e.preventDefault(); }catch{}
            const newV = v + '\n';
            editor.value = newV;
            // caret を改行直前へ（末尾空行を _splitLines で捨てさせる）
            const newOff = Math.max(0, newV.length - 1);
            try{ editor.selectionStart = editor.selectionEnd = newOff; }catch{}
            try{ const rc = _rcFromOffset(newOff); caretRow = rc.r; caretCol = rc.c; }catch{}
            _touchBufferModified(); ensureScrolloff(); _repositionCaret(); updateGutter();
            try{ _renderListChars(); }catch{}
            return; // 処理済み
          }
        }
      }catch{}
      _debugPush({ t:Date.now(), type:'beforeinput', mode:_mode, inputType:e.inputType, data:e.data, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey, isComp:false });
    });
    // NORMAL/VISUAL/CMD 時の入力フォールバックガード (#491, #492, #522)
    // beforeinput で止めきれない実装差分（特に IME の insertFromComposition/insertCompositionText）に備え、
    // INSERT 以外で発火した input のうち insert*/delete* 系は直ちに巻き戻す。
    editor.addEventListener('input', (e)=>{
      try{
        if (_mode !== 'INSERT'){
          if (!e || !e.isTrusted) return; // 非ユーザー操作は対象外
          const it = String(e.inputType||'');
          if (it && (it.startsWith('insert') || it.startsWith('delete'))){
            // 現在のバッファ内容に強制巻き戻し（ユーザー操作による変更は一切反映しない）
            const b = currentBuffer();
            if (b){
              // IME の未確定/確定文字列による input で caret が右へ進む「擬似 l 移動」を防ぐ (#529)
              // 以下のケースではロールバック後の caret を「確定前の選択終端」へ戻す:
              // - insertFromComposition（確定）
              // - insertCompositionText（未確定表示）
              // - insertText だが現在 IME composing 中
              let keepOff = (editor.selectionStart|0);
              try{
                if (it === 'insertFromComposition' || it === 'insertCompositionText' || (it === 'insertText' && _imeComposing)){
                  keepOff = (_preCompSelE|0);
                }
              }catch{}
              editor.value = String(b.text||'');
              const len = editor.value.length|0;
              const off = (keepOff<=len)?keepOff:len;
              editor.selectionStart = editor.selectionEnd = off;
              // オーバーレイ caret も復元オフセットへ同期して、行ジャンプ風の見え方を抑止（#530）
              try{ const rc = _rcFromOffset(off); caretRow = rc.r; caretCol = rc.c; _repositionCaret(); updateGutter(); }catch{}
            }
            _debugPush({ t:Date.now(), type:'input-rollback', mode:_mode, inputType:it, data:e.data, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey, isComp:false });
          }
          return;
        }
      }catch{}
      _debugPush({ t:Date.now(), type:'input', mode:_mode, inputType:e.inputType, data:e.data, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey, isComp:false });
    });
    editor.addEventListener('input', (e)=>{
      if (_mode === 'INSERT'){
        // centralize modified tracking (bump change tick on each input)
        _touchBufferModified();
        // sync overlay caret to native insertion point
        try{ const off = editor.selectionStart|0; const rc = _rcFromOffset(off); caretRow = rc.r; caretCol = rc.c; }catch{}
        // _touchBufferModified already hides cursor; redundant call removed
        // #624: 差分検出用に直前テキストを参照（末尾状態の変化トレース）
        try{
          if (_prevTextBeforeInput){
            // 特殊フラグは使わず、静的状態による描画へ（#629）
          }
          _prevTextBeforeInput='';
        }catch{}
        // #637/#638: caret がダミー位置（末尾LF欠落 かつ EOF）での「文字挿入」では
        // 直ちに通常LFへ昇格: 末尾に\nを追加し caret を改行直前へ戻す（保存時LF無しを回避）。
        try{
          const txt = String(editor.value||'');
          const noFinalLF = !txt.endsWith('\n');
          const caretAtEOF = (editor.selectionStart|0) === txt.length && (editor.selectionEnd|0) === txt.length;
          const it = String(e && e.inputType || '');
          const isInsertChar = it.startsWith('insert') && it!=='insertLineBreak' && it!=='insertParagraph';
          if (noFinalLF && caretAtEOF && isInsertChar){
            const withLF = txt + '\n';
            editor.value = withLF;
            const newOff = withLF.length - 1; // 改行直前
            try{ editor.selectionStart = editor.selectionEnd = newOff; }catch{}
            try{ const rc2 = _rcFromOffset(newOff); caretRow = rc2.r; caretCol = rc2.c; }catch{}
            try{ const b=currentBuffer(); if (b){ b.text = String(editor.value||''); b.modified = true; } }catch{}
          }
        }catch{}
      }
      _exactLineLockAdjust(); _repositionCaret(); updateGutter(); _updateHlsearchFull(); _updatePosInfo();
      // #621: 最終行が改行のみ -> 改行削除で dummy へ移行した直後に色/記号が反映されないケースの強制再描画
      try{
        const b=currentBuffer();
        if (b){
          const txt=String(b.text||'');
          const noFinalLF = !txt.endsWith('\n');
          // 空ファイル または 末尾行が空文字列（raw分割末尾が単一要素）かつ LF 欠落時は再描画を二段階で強制
          // #623: 末尾LF欠落の全ケースでダミー記号が即時反映されないことがあるため条件を一般化
          if (noFinalLF){
            _renderListChars();
            if (window.requestAnimationFrame){ requestAnimationFrame(()=>{ try{ _renderListChars(); }catch{} }); }
          }
        }
      }catch{}
    });
    // Mouse selection/click: sync overlay caret with native selection
    const syncCaretFromSelection = ()=>{
      try{ const off = editor.selectionStart|0; const rc = _rcFromOffset(off); caretRow = rc.r; caretCol = rc.c; }catch{}
      _repositionCaret(); updateGutter();
    };
    // Ensure single-click updates after browser updates selection
    editor.addEventListener('mousedown', ()=>{ setTimeout(syncCaretFromSelection, 0); });
    editor.addEventListener('mouseup', syncCaretFromSelection);
    editor.addEventListener('click', syncCaretFromSelection);
    // selection change — keep overlay caret in sync in all modes
    // In VISUAL mode, prefer tracking the moving edge of the selection (the end farther from the anchor)
    editor.addEventListener('select', ()=>{
      try{
        // Guard: ignore transient selection changes during protected windows (e.g., right after save)
        try{ if (Date.now() < _selGuardUntil) return; }catch{}
        if (_visualActive){
          // In VISUAL mode, keep overlay caret behavior consistent with our model.
          // For linewise VISUAL, preserve the caret column and only track the moving edge's ROW.
          if (_visualLinewise){
            const s = editor.selectionStart|0;
            const e = editor.selectionEnd|0;
            const a = _offsetFromRC(_visualAnchorR, _visualAnchorC)|0;
            const ds = Math.abs(s - a);
            const de = Math.abs(e - a);
            const offEdge = (de >= ds) ? e : s;
            const rc = _rcFromOffset(offEdge);
            // Keep column as-is to avoid jumping to line head/tail when entering with 'V' (#448)
            caretRow = rc.r;
            // caretCol: no change
          } else {
            // Characterwise VISUAL: follow the farther endpoint fully (row+col)
            let off = editor.selectionStart|0;
            const s = editor.selectionStart|0;
            const e = editor.selectionEnd|0;
            const a = _offsetFromRC(_visualAnchorR, _visualAnchorC)|0;
            const ds = Math.abs(s - a);
            const de = Math.abs(e - a);
            off = (de >= ds) ? e : s;
            const rc = _rcFromOffset(off);
            caretRow = rc.r; caretCol = rc.c;
          }
        } else {
          // Non-VISUAL: sync to native insertion point
          const off = editor.selectionStart|0;
          const rc = _rcFromOffset(off);
          caretRow = rc.r; caretCol = rc.c;
        }
      }catch{}
      _repositionCaret(); updateGutter(); _updatePosInfo();
      // #626: caret移動のみでも EOFダミー表示が最新状態になるよう即時再描画
      try{ _renderListChars(); }catch{}
    });
  editor.addEventListener('keyup', (e)=>{ _debugPush({ t:Date.now(), type:'keyup', mode:_mode, key:e.key, code:e.code, keyCode:e.keyCode, which:e.which, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey, isComp:_imeComposing }); if(e.key==='Enter') ensureScrolloff(); _repositionCaret(); updateGutter(); _updatePosInfo(); });
  editor.addEventListener('click', ()=>{ _repositionCaret(); updateGutter(); _updatePosInfo(); });
    // IME composition events — #522: NORMAL/VISUAL では未確定の表示は許可するが、確定は捨てる
    let _imeComposing = false;
    let _blockedComposition = false;
    let _preCompSelS = 0, _preCompSelE = 0;
    editor.addEventListener('compositionstart', (e)=>{
      _imeComposing = true;
      try{
        if (_mode !== 'INSERT'){
          _blockedComposition = true;
          // ロールバック用の基点はオーバーレイ caret 位置に統一（ネイティブ選択が陳腐化している場合があるため）
          try{
            const off = _offsetFromRC(caretRow|0, caretCol|0)|0;
            _preCompSelS = off; _preCompSelE = off;
            // IME の未確定表示ポップアップ位置が古い選択に引っ張られないよう、
            // ネイティブ選択も caret に同期（スクロールは即時復元）
            const stHold = editor.scrollTop|0, slHold = editor.scrollLeft|0;
            editor.selectionStart = editor.selectionEnd = off;
            if ((editor.scrollTop|0) !== stHold) editor.scrollTop = stHold;
            if ((editor.scrollLeft|0) !== slHold) editor.scrollLeft = slHold;
          }catch{}
        } else { _blockedComposition = false; }
        _debugPush({ t:Date.now(), type:'compositionstart', mode:_mode, compData:e.data, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey, isComp:true });
      }catch{}
    });
    editor.addEventListener('compositionend', (e)=>{
      try{
        if (_blockedComposition){
          // 確定は破棄：バッファ内容で強制復元し、選択も戻す
          const b = currentBuffer();
          if (b){
            editor.value = String(b.text||'');
          }
          try{ editor.selectionStart = _preCompSelS; editor.selectionEnd = _preCompSelE; }catch{}
        }
      }catch{}
      _imeComposing = false; _blockedComposition = false;
      _repositionCaret(); updateGutter();
      _debugPush({ t:Date.now(), type:'compositionend', mode:_mode, compData:e.data, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey, isComp:false });
    });
    editor.addEventListener('compositionupdate', (e)=>{
      try{
        // 未確定表示はブラウザに任せる。INSERT でも特別な処理なし。
        _debugPush({ t:Date.now(), type:'compositionupdate', mode:_mode, compData:e.data, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey, isComp:true });
        return;
      }catch{}
    });
  // editor.addEventListener('compositionend', ...) removed
    // Fallback IME full-width detection for platforms where composition events are sparse or skipped.
    // If in INSERT and not currently composing, inspect last committed character on input.
    editor.addEventListener('input', ()=>{
      try{
        if (_mode !== 'INSERT') return;
  // IME composition path removed
        const v = String(editor.value||'');
  if (!v) { return; }
        const ch = v[v.length-1];
        if (!ch){ return; }
        const cp = ch.codePointAt(0)|0;
  // Full-width alnum detection removed
      }catch{}
    });
    // Also watch keydown of direct full-width alnum (rare cases where input fires after key processing with no composition events)
    editor.addEventListener('keydown', (e)=>{
      try{
        if (_mode !== 'INSERT') return;
  // IME composition in-progress check removed
        if (!e.key || e.key.length!==1) return;
        const cp = e.key.codePointAt(0)|0;
        if (_isFullwidthAlnumCp && _isFullwidthAlnumCp(cp)){
          // _imeFullwidth visual hint removed
        }
      }catch{}
    });
  window.addEventListener('resize', ()=>{ _syncEditorMetrics(); clampViewportExactLines(); _exactLineLockAdjust(); ensureScrolloff(); _repositionCaret(); updateGutter(); _renderHlMatchesVisible(); _incPrevRefresh(); _renderVisSelOverlay(); });
  editor.addEventListener('keydown', (e)=>{
      // Short guard: absorb any stray keydown right after modal close
      if (Date.now() < _kbdGuardUntil){ try{ e.preventDefault(); e.stopPropagation(); }catch{} return; }
    // Globally consume Ctrl+U to avoid Edge opening view-source window (#447)
    if (e && e.ctrlKey && !e.altKey && !e.metaKey && (e.key==='u' || e.key==='U')){ try{ e.preventDefault(); e.stopPropagation(); }catch{} return; }
    _debugPush({ t:Date.now(), type:'keydown', mode:_mode, key:e.key, code:e.code, keyCode:e.keyCode, which:e.which, ctrl:e.ctrlKey, alt:e.altKey, meta:e.metaKey, isComp:_imeComposing });
    // DEBUG GUARD (#523): investigate spurious 'l' motions in NORMAL with IME ON.
    // If key is reported as 'l' but original event has a printable key pressed that differs and no modifiers,
    // add lightweight console trace. (Will be removed after root cause isolated.)
    try{
      if (_mode==='NORMAL' && e && !e.ctrlKey && !e.metaKey && !e.altKey){
        // Heuristic: if key=='l' and code not matching expected 'KeyL' or ArrowRight, log it.
        if (e.key==='l' && !(e.code==='KeyL' || e.code==='ArrowRight')){
          try{ console.warn('[debug#523] anomalous l-key event', {key:e.key, code:e.code, which:e.which, keyCode:e.keyCode, time:Date.now()}); }catch{}
        }
      }
    }catch{}
      if (_mode === 'CMD') return;
      if (_mode === 'INSERT'){
        // INSERTモードで Tab または Ctrl+I でタブ文字を挿入 (#459)
        // ブラウザのデフォルト Tab 挙動(フォーカス移動)を抑止し、明示的に '\t' を挿入する。
        try{
          const isCtrlI = (e.ctrlKey && !e.altKey && !e.metaKey && (e.key==='i' || e.key==='I'));
          if (e.key==='Tab' || isCtrlI){
            e.preventDefault(); e.stopPropagation();
            // 事前にネイティブ selectionStart を caretRow/Col に反映（途中で別操作でズレている可能性に備える）
            try{ const off0 = editor.selectionStart|0; const rc0 = _rcFromOffset(off0); caretRow = rc0.r; caretCol = rc0.c; }catch{}
            const selStart = editor.selectionStart|0;
            const selEnd   = editor.selectionEnd|0;
            if (selStart !== selEnd){
              // 選択範囲がある場合は置換（通常の文字入力と同様の挙動）
              const v = String(editor.value||'');
              const before = v.slice(0, selStart);
              const after  = v.slice(selEnd);
              editor.value = before + '\t' + after;
              const newOff = before.length + 1;
              try{ const rc = _rcFromOffset(newOff); caretRow = rc.r; caretCol = rc.c; }catch{}
              _setCaret(caretRow, caretCol);
              // ネイティブ選択も同期しないと次入力が末尾に挿入されうる (#506)
              try{ _syncNativeSelectionToCaret(); }catch{}
              _touchBufferModified(); ensureScrolloff(); _repositionCaret(); updateGutter();
            } else {
              // 通常ケース（選択なし）: caret位置へ挿入
              try{
                const pos = _insertTextAt(caretRow, caretCol, '\t');
                caretRow = pos.r; caretCol = pos.c;
                _setCaret(caretRow, caretCol);
                // ネイティブ選択も同期 (#506)
                try{ _syncNativeSelectionToCaret(); }catch{}
                _touchBufferModified(); ensureScrolloff(); _repositionCaret(); updateGutter();
              }catch{}
            }
            return; // 既に処理したので抜ける
          }
        }catch{}
        if (_isEsc(e)){
          e.preventDefault();
          // on leaving INSERT, capture native caret back to overlay state
          try{ const off = editor.selectionStart|0; const rc = _rcFromOffset(off); caretRow = rc.r; caretCol = rc.c; }catch{}
          _setMode('NORMAL');
          return;
        }
        // #603: INSERTモードの下方向移動は最終行以降へ進めない。'j' 文字としての入力以外で改行を合成しない。
        // Ctrl+H を Backspace と同等に扱う (#460)
        if (e.ctrlKey && !e.altKey && !e.metaKey && (e.key==='h' || e.key==='H')){
          e.preventDefault(); e.stopPropagation();
          // ネイティブ Backspace 相当: 1 文字削除（選択範囲があれば範囲削除）
          try{
            const start = editor.selectionStart|0;
            const end   = editor.selectionEnd|0;
            let s = String(editor.value||'');
            if (start !== end){
              editor.value = s.slice(0,start) + s.slice(end);
              const rc = _rcFromOffset(start); caretRow = rc.r; caretCol = rc.c;
            } else if (start>0){
              // 直前コードポイント単位で削除（サロゲート対応）
              let delStart = start-1;
              const prev = s[delStart];
              // surrogate pair check
              if (prev && /[\uDC00-\uDFFF]/.test(prev) && delStart-1>=0){
                const lead = s[delStart-1];
                if (lead && /[\uD800-\uDBFF]/.test(lead)){ delStart = delStart-1; }
              }
              editor.value = s.slice(0,delStart) + s.slice(start);
              const rc = _rcFromOffset(delStart); caretRow = rc.r; caretCol = rc.c;
            }
            _setCaret(caretRow, caretCol);
            _touchBufferModified(); ensureScrolloff(); _repositionCaret(); updateGutter();
          }catch{}
          return;
        }
        // Allow native editing behavior, but keep overlays in sync when moving the caret
        if (e.key==='ArrowLeft' || e.key==='ArrowRight' || e.key==='ArrowUp' || e.key==='ArrowDown' ||
            e.key==='Home' || e.key==='End' || e.key==='PageUp' || e.key==='PageDown'){
          // #603: ArrowDown で末尾LF欠落時に仮改行を挿入する旧処理(#602)を撤廃。
          // 最終行末尾での下方向移動は何も起こさず、そのまま位置維持。
          // #635/#636: 改行文字上 (offset===length-1) からの ArrowDown で仮想最終空行へ移動させる。
          // ただし既に改行直後 (offset===length) にいる場合はネイティブ挙動に委ねて何もしない。
          try{
            if (e.key==='ArrowDown' && _mode==='INSERT'){
              const v = String(editor.value||'');
              if (v.endsWith('\n')){
                const start = editor.selectionStart|0;
                const end = editor.selectionEnd|0;
                if (start===end && start === v.length-1){
                  // caret は改行文字上 → 仮想行へ進める
                  e.preventDefault(); e.stopPropagation();
                  const newOff = v.length; // 改行直後
                  try{ editor.setSelectionRange(newOff, newOff); }catch{}
                  try{ const rc = _rcFromOffset(newOff); caretRow = rc.r; caretCol = rc.c; }catch{}
                  try{ _flagCaretMotion(); }catch{}
                  try{ ensureScrolloff(); }catch{}
                  _repositionCaret(); updateGutter();
                  return; // ここで処理完了
                }
              }
              // EOF パッドスクロール (INSERT) 共通ヘルパー利用 (#866/#867)
              if (_maybeScrollEofPadStep('insert-eof-pad-scroll')){ e.preventDefault(); e.stopPropagation(); try{ _flagCaretMotion(); }catch{} return; }
            }
          }catch{}
          // 他の移動キーは後段 setTimeout で同期
          try{ _flagCaretMotion(); }catch{}
          // Defer until after the browser updates selection/caret
          setTimeout(()=>{
            try{ const off = editor.selectionStart|0; const rc = _rcFromOffset(off); caretRow = rc.r; caretCol = rc.c; }catch{}
            // Keep scrolloff for vertical moves
            if (e.key==='ArrowUp' || e.key==='ArrowDown' || e.key==='PageUp' || e.key==='PageDown'){
              try{ ensureScrolloff(); }catch{}
            }
            _repositionCaret(); updateGutter();
          }, 0);
        }
        return; // テキスト入力はデフォルトに委ねる
      }
      // VISUAL 専用: '/' と '?' を早期捕捉（通常経路で無視されるケースのフォールバック） (#685)
      if (_mode === 'VISUAL' && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key==='/' || e.key==='?')){
        e.preventDefault();
        let visSeed='';
        let visStartOff = null;
        try{
          const v=String(editor.value||'');
          if (_visualLinewise){
            const rs=Math.min(_visualAnchorR, caretRow);
            const re=Math.max(_visualAnchorR, caretRow);
            const sOff=_offsetFromRC(rs,0)|0;
            const eOff=_offsetFromRC(re, (_splitLines()[re]||'').length)|0;
            visSeed=v.slice(Math.max(0,sOff), Math.max(0,eOff));
            visStartOff = sOff|0;
          } else {
            const sOff=_offsetFromRC(_visualAnchorR, _visualAnchorC)|0;
            const eOff=_offsetFromRC(caretRow, caretCol)|0;
            const a=Math.min(sOff,eOff), b=Math.max(sOff,eOff);
            visSeed=v.slice(Math.max(0,a), Math.max(0,b));
            visStartOff = a|0;
          }
          // 選択文字列を「正規表現のリテラル一致」用にエスケープ（\n/\tは維持）
          visSeed = _escapeRegexLiteralForSeed(visSeed); // 空白はそのまま保持 (#687)
        }catch{ visSeed=''; }
        try{ _exitVisual(); }catch{}
        _preCmdMode=_mode; _setMode('CMD'); _clearPending();
        _incPrevHide();
        try{
          if (visStartOff!=null && Number.isFinite(visStartOff)){
            _incSearchAnchorOff = (visStartOff|0);
          } else {
            _incSearchAnchorOff = _offsetFromRC(caretRow, caretCol)|0;
          }
          _incSearchDir = (e.key==='?')?'bwd':'fwd';
        }catch{ _incSearchAnchorOff=null; _incSearchDir=(e.key==='?')?'bwd':'fwd'; }
        try{ _cmdHistBrowsing=false; _cmdHistIndex=_cmdHistory.length; _cmdHistTemp=''; }catch{}
        try{ _centerScrolloffOnce=false; }catch{}
        try{ _scrollGuardUntil = Date.now() + 120; }catch{}
        const holdLeft = (function(){ try{ return editor.scrollLeft|0; }catch{ return 0; } })();
        try{
          const st0=(editor.scrollTop||0);
          const flo=Math.floor(st0/LINE_HEIGHT)*LINE_HEIGHT;
          if (Math.abs(st0-flo)>0.1){ editor.scrollTop=flo; }
          _repositionCaret(); updateGutter();
          try{ if (editor && (editor.scrollLeft|0)!==holdLeft){ editor.scrollLeft=holdLeft; } }catch{}
        }catch{}
        if (cmdinput){
          cmdinput.value = (e.key==='?') ? ('?'+visSeed) : ('/'+visSeed);
          const stHold=(function(){ try{ return editor.scrollTop|0; }catch{ return 0; } })();
          Promise.resolve().then(()=>{
            try{ if (_mode==='CMD'){ cmdinput.focus(); const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); } }catch{}
            if (window.requestAnimationFrame){
              requestAnimationFrame(()=>{ try{
                if (_mode==='CMD' && document.activeElement!==cmdinput){ cmdinput.focus(); const p=(cmdinput.value||'').length; cmdinput.setSelectionRange(p,p); }
                if (_mode==='CMD' && editor){
                  const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                  if (Math.abs((editor.scrollTop||0)-flo)>0.1){ editor.scrollTop=flo; }
                  _repositionCaret(); updateGutter();
                  if ((editor.scrollLeft|0)!==holdLeft){ editor.scrollLeft=holdLeft; }
                }
              }catch{} });
            }
            setTimeout(()=>{ try{
              if (_mode==='CMD' && document.activeElement!==cmdinput){ cmdinput.focus(); const p=(cmdinput.value||'').length; cmdinput.setSelectionRange(p,p); }
              if (_mode==='CMD' && editor){
                const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                if (Math.abs((editor.scrollTop||0)-flo)>0.1){ editor.scrollTop=flo; }
                _repositionCaret(); updateGutter();
                if ((editor.scrollLeft|0)!==holdLeft){ editor.scrollLeft=holdLeft; }
              }
            }catch{} }, 60);
          });
        }
        return;
      }
      if (_mode === 'VISUAL'){
        // VISUAL mode key handling
        if (e.key===':' && !e.ctrlKey){
          // Open command prompt while keeping VISUAL selection active
          e.preventDefault();
          // VISUAL 選択のスナップショットを保存（'<,'>' 範囲評価に使用）
          _preCmdMode = _mode; // remember VISUAL
          _cmdFromVisual = true;
          _visCmdActive = true;
          _visCmdLinewise = !!_visualLinewise;
          _visCmdAnchorR = _visualAnchorR|0; _visCmdAnchorC = _visualAnchorC|0;
          _visCmdCaretR  = caretRow|0;       _visCmdCaretC  = caretCol|0;
          _setMode('CMD');
          _clearPending();
          _incPrevHide();
          _incSearchAnchorOff = null; _incSearchDir = 'fwd';
          try{ _cmdHistBrowsing=false; _cmdHistIndex=_cmdHistory.length; _cmdHistTemp=''; }catch{}
          // 残存センタリング抑止 + 水平成分保持（VISUALからの : でも初回横戻り/縦ズレを防止）
          try{ _centerScrolloffOnce = false; }catch{}
          try{ _scrollGuardUntil = Date.now() + 120; }catch{}
          const _holdLeftVis = (function(){ try{ return editor.scrollLeft|0; }catch{ return 0; } })();
          try{
            const st0 = (editor.scrollTop||0);
            const flo = Math.floor(st0/LINE_HEIGHT)*LINE_HEIGHT;
            if (Math.abs(st0 - flo) > 0.1){ editor.scrollTop = flo; }
            _repositionCaret(); updateGutter();
            try{ if (editor && (editor.scrollLeft|0) !== _holdLeftVis){ editor.scrollLeft = _holdLeftVis; } }catch{}
          }catch{}
          if (cmdinput){
            // Prefill with visual range
            cmdinput.value = ":'<,'>";
            // フォーカス確定は rAF + setTimeout の二段階で強化（NORMAL の ':' と同等の堅牢性）
            // さらに、フォーカス後に縦横スクロール・オーバーレイを復元
            const stHold = (function(){ try{ return editor.scrollTop|0; }catch{ return 0; } })();
            Promise.resolve().then(()=>{
              try{ if (_mode==='CMD'){ cmdinput.focus(); const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); } }catch{}
              // 1st frame: フォーカス後にスクロール/オーバーレイ復元
              try{
                const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                if (Math.abs((editor.scrollTop||0) - flo) > 0.1){ editor.scrollTop = flo; }
                _repositionCaret(); updateGutter();
                if (editor && (editor.scrollLeft|0) !== _holdLeftVis){ editor.scrollLeft = _holdLeftVis; }
              }catch{}
              try{ _updateVisualSelection(); }catch{}
              try{ _renderVisSelOverlay(); }catch{}
              if (window.requestAnimationFrame){
                requestAnimationFrame(()=>{
                  try{
                    if (_mode==='CMD' && document.activeElement !== cmdinput){ cmdinput.focus(); const p=(cmdinput.value||'').length; cmdinput.setSelectionRange(p,p); }
                    // rAF フレームでもう一度スクロール/オーバーレイを補正
                    if (_mode==='CMD' && editor){
                      const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                      if (Math.abs((editor.scrollTop||0) - flo) > 0.1){ editor.scrollTop = flo; }
                      _repositionCaret(); updateGutter();
                      if ((editor.scrollLeft|0) !== _holdLeftVis){ editor.scrollLeft = _holdLeftVis; }
                    }
                  }catch{}
                  try{ _updateVisualSelection(); }catch{}
                  try{ _renderVisSelOverlay(); }catch{}
                });
              }
              setTimeout(()=>{
                try{
                  if (_mode==='CMD' && document.activeElement !== cmdinput){ cmdinput.focus(); const p=(cmdinput.value||'').length; cmdinput.setSelectionRange(p,p); }
                  if (_mode==='CMD' && editor){
                    const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                    if (Math.abs((editor.scrollTop||0) - flo) > 0.1){ editor.scrollTop = flo; }
                    _repositionCaret(); updateGutter();
                    if ((editor.scrollLeft|0) !== _holdLeftVis){ editor.scrollLeft = _holdLeftVis; }
                  }
                }catch{}
                try{ _updateVisualSelection(); }catch{}
                try{ _renderVisSelOverlay(); }catch{}
              }, 60);
            });
          }
          return;
        }
  if (_isEsc(e)){ e.preventDefault(); _exitVisual(); _repositionCaret(); updateGutter(); return; }
        // toggle char/line visual
        if (e.key==='v' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _exitVisual(); _repositionCaret(); updateGutter(); return; }
        if (e.key==='V' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _visualLinewise = true; _updateVisualSelection(); return; }
        // yank selection in VISUAL to unnamed register
        if (e.key==='y' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); if (_visualLinewise){ const rs=Math.min(_visualAnchorR, caretRow); const re=Math.max(_visualAnchorR, caretRow); _yankWholeLines(rs, re-rs+1); } else { const a={r:_visualAnchorR,c:_visualAnchorC}; const b={r:caretRow,c:caretCol}; _yankRangePos(a,b); } _exitVisual(); _repositionCaret(); updateGutter(); return; }
        // Y in VISUAL — copy selection to Windows clipboard (no register mutation)
        if (e.key==='Y' && !e.ctrlKey && !e.metaKey && !e.altKey){
          e.preventDefault();
          let text='';
          if (_visualLinewise){ const rs=Math.min(_visualAnchorR, caretRow); const re=Math.max(_visualAnchorR, caretRow); text = _extractWholeLinesText(rs, re-rs+1); }
          else { const a={r:_visualAnchorR,c:_visualAnchorC}; const b={r:caretRow,c:caretCol}; text = _extractRangeText(a,b); }
          if ((String(text||'').length) > 0){
            (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
          }
          _exitVisual(); _repositionCaret(); updateGutter();
          return;
        }
        if (e.key==='d' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); if (_visualLinewise){ const rs=Math.min(_visualAnchorR, caretRow); const re=Math.max(_visualAnchorR, caretRow); _deleteWholeLines(rs, re-rs+1); } else { const a={r:_visualAnchorR,c:_visualAnchorC}; const b={r:caretRow,c:caretCol}; _deleteRangePos(a,b); } _exitVisual(); ensureScrolloff(); _repositionCaret(); updateGutter(); return; }
        // VISUAL change: delete selection immediately and enter INSERT
        if (e.key==='c' && !e.ctrlKey && !e.metaKey && !e.altKey){
          e.preventDefault();
          if (_visualLinewise){
            const rs=Math.min(_visualAnchorR, caretRow); const re=Math.max(_visualAnchorR, caretRow);
            _deleteWholeLines(rs, re-rs+1);
          } else {
            const a={r:_visualAnchorR,c:_visualAnchorC}; const b={r:caretRow,c:caretCol};
            _deleteRangePos(a,b);
          }
          _exitVisual(); ensureScrolloff(); _repositionCaret(); updateGutter();
          _suppressInsertSnapshotOnce = true; _setMode('INSERT');
          return;
        }
        // VISUAL indent/outdent by shiftwidth; count before '>' multiplies amount
        if ((e.key==='>' || e.key=== '<') && !e.ctrlKey && !e.metaKey && !e.altKey){
          e.preventDefault();
          const amt = Math.max(1, _consumeCount()|0);
          const rs = Math.min(_visualAnchorR, caretRow);
          const re = Math.max(_visualAnchorR, caretRow);
          const units = (e.key==='>') ? amt : -amt;
          _applyIndentRange(rs, re, units);
          // keep VISUAL selection active; update overlays
          _updateVisualSelection(); _repositionCaret(); updateGutter();
          return;
        }
    // Motions extend selection
  const moveAndUpdate=(fn)=>{ fn(); try{ _flagCaretMotion(); }catch{} _ensureAfterMotion(); _repositionCaret(); updateGutter(); _updateVisualSelection(); };
        if (e.key==='ArrowDown'){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveCaretLines(n)); return; }
        if (e.key==='ArrowUp'){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveCaretLines(-n)); return; }
        // In strict-normal-ime, ignore letter motions (and their Process-coded variants) while composing; arrows still work
        if (_optStrictNormalIME && _imeComposing){
          const isHJKLCode = (e.code==='KeyH'||e.code==='KeyJ'||e.code==='KeyK'||e.code==='KeyL');
          const isHJKLKey  = (e.key==='h'||e.key==='j'||e.key==='k'||e.key==='l');
          if (isHJKLKey || (e.key==='Process' && isHJKLCode)){
            e.preventDefault();
            _debugPush({ t:Date.now(), type:'ignored-motion', mode:_mode, key:e.key, code:e.code, reason:'strict-ime', isComp:_imeComposing });
            return;
          }
        }
        // Accept Process-coded j/k when composing (non-strict): map by code
        if (e.key==='j' || (e.key==='Process' && e.code==='KeyJ')){ e.preventDefault(); try{ _debugPush({ t:Date.now(), type:'motion-exec', mode:_mode, key:'j', code:e.code, via:(e.key==='Process'?'Process/KeyJ':'j') }); }catch{} const n=_consumeCount(); moveAndUpdate(()=>_moveCaretLines(n)); return; }
        if (e.key==='k' || (e.key==='Process' && e.code==='KeyK')){ e.preventDefault(); try{ _debugPush({ t:Date.now(), type:'motion-exec', mode:_mode, key:'k', code:e.code, via:(e.key==='Process'?'Process/KeyK':'k') }); }catch{} const n=_consumeCount(); moveAndUpdate(()=>_moveCaretLines(-n)); return; }
  // Guard against anomalous IME mapping (#523): accept 'h' when code is KeyH or Process/KeyH; always accept ArrowLeft
  if ((e.key==='h' && e.code==='KeyH' && (!_optStrictNormalIME || !_imeComposing)) || (e.key==='Process' && e.code==='KeyH' && (!_optStrictNormalIME || !_imeComposing)) || e.key==='ArrowLeft'){
    e.preventDefault(); try{ _debugPush({ t:Date.now(), type:'motion-exec', mode:_mode, key:e.key, code:e.code, via:(e.key==='ArrowLeft'?'ArrowLeft':(e.code==='KeyH'?(e.key==='Process'?'Process/KeyH':'KeyH'):'unknown')) }); }catch{} const n=_consumeCount(); moveAndUpdate(()=>_moveCaretCols(-n)); return; }
  // Likewise for 'l': accept when code is KeyL or Process/KeyL; always accept ArrowRight
  if ((e.key==='l' && e.code==='KeyL' && (!_optStrictNormalIME || !_imeComposing)) || (e.key==='Process' && e.code==='KeyL' && (!_optStrictNormalIME || !_imeComposing)) || e.key==='ArrowRight'){
    e.preventDefault(); try{ _debugPush({ t:Date.now(), type:'motion-exec', mode:_mode, key:e.key, code:e.code, via:(e.key==='ArrowRight'?'ArrowRight':(e.code==='KeyL'?(e.key==='Process'?'Process/KeyL':'KeyL'):'unknown')) }); }catch{} const n=_consumeCount(); moveAndUpdate(()=>_moveCaretCols(n)); return; }
        if (e.key==='w' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveWordW(n)); return; }
        if (e.key==='b' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveWordB(n)); return; }
  if (e.key==='W' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveWORDW(n)); return; }
  if (e.key==='B' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveWORDB(n)); return; }
    if (e.key==='^'){ e.preventDefault(); const _n=_consumeCount(); const line=(_splitLines()[caretRow]||''); _setCaret(caretRow, _firstNonBlankColOf(line)); try{ _flagCaretMotion(); }catch{} _repositionCaret(); _updateVisualSelection(); return; }
    if (e.key==='0' && _countAcc==null){ e.preventDefault(); _setCaret(caretRow, 0); try{ _flagCaretMotion(); }catch{} _repositionCaret(); _updateVisualSelection(); return; }
    // HOME -> 行頭（0 と同等）
    if (e.key==='Home' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _setCaret(caretRow, 0); try{ _flagCaretMotion(); }catch{} _repositionCaret(); _updateVisualSelection(); return; }
    // END -> 行末（$ と同等、カウント対応）
  if (e.key==='$' || (e.key==='End' && !e.ctrlKey && !e.metaKey && !e.altKey)){ e.preventDefault(); const n=_consumeCount(); let r=caretRow; if (n>1){ _moveCaretLines(n-1); r=caretRow; } const len=_lineLen(r); const noMove=(r===caretRow && len===caretCol); _setCaret(r, len, noMove?{suppressDesired:true}:undefined); try{ _flagCaretMotion(); }catch{} _repositionCaret(); updateGutter(); _updateVisualSelection(); return; }
        if (e.key==='}'){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveParagraphNext(n)); return; }
        if (e.key==='{'){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveParagraphPrev(n)); return; }
        // gg / G motions in VISUAL (extend selection)
        if (e.key==='g' && !e.ctrlKey && !e.metaKey && !e.altKey){
          e.preventDefault();
          if (_pendingNormal === 'g'){
            // gg detected (with optional count for target line)
            _clearPending();
            const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
            let targetRow = Math.max(0, Math.min(_totalLines()-1, (mcount>0? (mcount-1) : 0)));
            const newCol = Math.min(caretCol, _lineLen(targetRow));
            _setCaret(targetRow, newCol);
            ensureScrolloff({centerOnce:true});
            _repositionCaret(); updateGutter(); _updateVisualSelection();
            return;
          } else {
            _pendingNormal = 'g';
            if (_pendingTimer) clearTimeout(_pendingTimer);
            _pendingTimer = setTimeout(()=>{ _pendingNormal=null; _pendingTimer=null; }, 800);
            return;
          }
        }
        // gU / gu case transform (remain in VISUAL)
        if ((e.key==='U' || e.key==='u') && !e.ctrlKey && !e.metaKey && !e.altKey && _pendingNormal==='g'){
          e.preventDefault();
          const upper = (e.key==='U');
          _clearPending(); _countAcc=null;
          _visualTransformCase(upper);
          return;
        }
        // o: toggle caret to opposite end (swap anchor/caret)
        if (e.key==='o' && !e.ctrlKey && !e.metaKey && !e.altKey){
          e.preventDefault();
          const aR=_visualAnchorR, aC=_visualAnchorC;
          _visualAnchorR = caretRow; _visualAnchorC = caretCol;
          _setCaret(aR, aC);
          _updateVisualSelection(); _repositionCaret(); updateGutter();
          return;
        }
        // p: replace selection with unnamed register contents (charwise or linewise)
        if (e.key==='p' && !e.ctrlKey && !e.metaKey && !e.altKey){
          e.preventDefault();
          if (_regUnnamed && _visualActive){
            if (_visualLinewise && _regUnnamed.linewise){
              const rs=Math.min(_visualAnchorR, caretRow); const re=Math.max(_visualAnchorR, caretRow);
              // Delete lines then insert register lines at rs
              const linesRaw=_splitLinesRaw();
              const before=linesRaw.slice(0, rs);
              const after = linesRaw.slice(re+1);
              const clipLines=_normalizeRegText(_regUnnamed.text).split('\n');
              let out = before.concat(clipLines).concat(after).join('\n');
              const prev=String(editor.value||'');
              if (prev.endsWith('\n') && !out.endsWith('\n')) out += '\n';
              if (out!==prev){ _pushUndoSnapshot('visual-paste-linewise'); editor.value=out; _touchBufferModified(); }
              // caret to last inserted line head
              const newRow = rs + clipLines.length - 1;
              _setCaret(Math.max(0,newRow), 0);
            } else {
              // Charwise replace selection with register text; if register linewise still treat whole text block verbatim
              let a={r:_visualAnchorR,c:_visualAnchorC}, b={r:caretRow,c:caretCol};
              if (_cmpPos(a,b)>0){ const t=a; a=b; b=t; }
              const off1=_offsetFromRC(a.r,a.c); const off2=_offsetFromRC(b.r,b.c);
              const s=String(editor.value||''); const startOff=Math.max(0, Math.min(s.length, off1|0)); const endOff=Math.max(startOff, Math.min(s.length, off2|0));
              const clip=_normalizeRegText(_regUnnamed.text);
              let out = s.slice(0,startOff) + clip + s.slice(endOff);
              if (s.endsWith('\n') && !out.endsWith('\n')) out += '\n';
              if (out!==s){ _pushUndoSnapshot('visual-paste-charwise'); editor.value=out; _touchBufferModified(); }
              // Move caret to end of pasted block
              const endPos = startOff + clip.length;
              try{ const rc=_rcFromOffset(endPos); _setCaret(rc.r, rc.c); }catch{}
            }
            _afterTextMutation();
            // Keep visual selection collapsed to end (exit VISUAL like Vim does after replace)
            _exitVisual(); ensureScrolloff(); _repositionCaret(); updateGutter();
          }
          return;
        }
        // Text objects inside braces: i{ i} a{ a}
        if ((e.key==='i' || e.key==='a') && !e.ctrlKey && !e.metaKey && !e.altKey){
          // stage for next key '{' or '}'
          _pendingNormal = e.key==='i' ? 'i-obj' : 'a-obj';
          if (_pendingTimer) clearTimeout(_pendingTimer);
          _pendingTimer = setTimeout(()=>{ if (_pendingNormal && (_pendingNormal==='i-obj'||_pendingNormal==='a-obj')){ _pendingNormal=null; _pendingTimer=null; } }, 800);
          e.preventDefault();
          return;
        }
        if ((e.key==='{' || e.key==='}') && (_pendingNormal==='i-obj' || _pendingNormal==='a-obj')){
          e.preventDefault();
          const include = (_pendingNormal==='a-obj');
          _clearPending();
          _visualSelectBraces(include);
          return;
        }
        if (e.key==='G' && !e.ctrlKey && !e.metaKey && !e.altKey){
          e.preventDefault(); _clearPending();
          const mcount = (_countAcc==null?0:_countAcc); _countAcc=null;
          const total = _totalLines();
          let targetRow;
          if (mcount && mcount>0){ targetRow = Math.max(0, Math.min(total-1, mcount-1)); }
          else { targetRow = Math.max(0, total-1); }
          const newCol = Math.min(caretCol, _lineLen(targetRow));
          _setCaret(targetRow, newCol);
          ensureScrolloff({centerOnce:true, preferEOFPad:true});
          _repositionCaret(); updateGutter(); _updateVisualSelection();
          // Reinforce alignment and snap scrollTop to exact line grid over a few frames
          // to eradicate rare leading blank / half-line drift after large jumps (#423/#424)
          try{
            const snapAndResync = ()=>{
              try{
                const st0 = (editor.scrollTop||0);
                const st1 = Math.round(st0/LINE_HEIGHT)*LINE_HEIGHT;
                if (Math.abs(st1 - st0) > 0.25){ editor.scrollTop = st1; }
                _repositionCaret(); updateGutter();
              }catch{}
            };
            const reinforce = ()=>{ try{ snapAndResync(); }catch{} };
            snapAndResync();
            if (window.requestAnimationFrame){ requestAnimationFrame(()=>{ reinforce(); requestAnimationFrame(reinforce); }); }
            setTimeout(reinforce, 0); setTimeout(reinforce, 80);
          }catch{}
          return;
        }
        // counts in VISUAL
        if (e.key>='1' && e.key<='9' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _countAcc = (_countAcc==null?0:_countAcc)*10 + parseInt(e.key,10); return; }
        if (e.key==='0' && !e.ctrlKey && !e.metaKey && !e.altKey && _countAcc!=null){ e.preventDefault(); _countAcc = _countAcc*10; return; }
        // ignore other insertions
        const isPrintable = (e.key.length === 1) && !e.ctrlKey && !e.metaKey && !e.altKey;
        if (isPrintable){ e.preventDefault(); return; }
        return;
      }
    // NORMAL
  // Pending yank operator: interpret next key as motion or line-wise command
  if (_pendingOp === 'y'){
  // allow composing count for motion (digits only when Shift is NOT held)
  if (e.key>='1' && e.key<='9' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _countAcc = (_countAcc==null?0:_countAcc)*10 + parseInt(e.key,10); _armPendingOpTimeout(); return; }
  if (e.key==='0' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && _countAcc!=null){ e.preventDefault(); _countAcc = _countAcc*10; _armPendingOpTimeout(); return; }
  if (_isEsc(e)){ e.preventDefault(); _clearPendingOp(); _countAcc=null; return; }
        // Ignore standalone modifier keys while waiting for the motion key
        if (e.key==='Shift' || e.key==='Control' || e.key==='Alt' || e.key==='Meta'){
          // Do not clear or consume the operator; wait for the actual motion key
          return;
        }
        e.preventDefault();
        // yy (yank N lines)
        if (e.key==='y'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const total = Math.max(1, (_pendingOpCount||1) * mcount);
          _yankWholeLines(caretRow, total);
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
        // ygg / yNgg
        if (e.key==='g'){
          if (_pendingOpSeq === 'g'){
            // second 'g' -> gg
            const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
            // gg count means go to line N (default 1)
            const targetLine = Math.max(1, mcount) - 1;
            const r0 = caretRow;
            const r1 = Math.max(0, Math.min(_totalLines()-1, targetLine));
            const rs = Math.min(r0, r1);
            const re = Math.max(r0, r1);
            // yank complete lines between rs..re inclusive
            _yankWholeLines(rs, re-rs+1);
            _clearPendingOp(); _repositionCaret(); updateGutter();
            return;
          } else {
            _pendingOpSeq = 'g'; _armPendingOpTimeout(); return;
          }
        }
  // y$ — charwise to end-of-line (or across lines if count>1)
  if (e.key==='$'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          let rS = caretRow, cS = caretCol;
          let rE = rS, cE = (_splitLines()[rS]||'').length;
          if (mcount > 1){
            const last = _totalLines()-1;
            rE = Math.min(last, rS + (mcount-1));
            cE = (_splitLines()[rE]||'').length;
          }
          const start={r:rS, c:cS}, end={r:rE, c:cE};
          if (!(start.r===end.r && start.c===end.c)) _yankRangePos(start, end);
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
  // yG / yNG (N as target line) — linewise yank (use literal 'G')
  if (e.key==='G'){
          const mcount = (_countAcc==null?0:_countAcc); _countAcc=null;
          const r0 = caretRow; const total=_totalLines();
          let r1;
          if (mcount && mcount>0){ r1 = Math.max(0, Math.min(total-1, mcount-1)); }
          else { r1 = total-1; }
          const rs = Math.min(r0, r1);
          const re = Math.max(r0, r1);
          _yankWholeLines(rs, re-rs+1);
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
  // y} / y{ — linewise yank by paragraph
  if (e.key==='}'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const next = _paragraphNextPos(caretRow, mcount);
          const rs = caretRow;
          const re = Math.max(rs, Math.max(0, Math.min(_totalLines()-1, next.r-1)));
          if (re >= rs){ _yankWholeLines(rs, re-rs+1); }
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
  if (e.key==='{'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const prev = _paragraphPrevPos(caretRow, mcount);
          const rs = Math.min(prev.r, caretRow);
          const re = caretRow;
          if (re >= rs){ _yankWholeLines(rs, re-rs+1); }
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
        // generic y + motion (charwise)
        const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
        const totalCount = Math.max(1, (_pendingOpCount||1) * mcount);
        const target = _computeMotionTarget(caretRow, caretCol, e.key, totalCount);
        if (target){
          const start = { r: caretRow, c: caretCol };
          const end   = target;
          if (!(start.r===end.r && start.c===end.c)){
            _yankRangePos(start, end);
          }
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
        _clearPendingOp(); return;
      }
  // Pending Windows-clipboard copy operator: interpret next key as motion or line-wise command
  if (_pendingOp === 'Y'){
  // allow composing count for motion (digits only when Shift is NOT held)
  if (e.key>='1' && e.key<='9' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _countAcc = (_countAcc==null?0:_countAcc)*10 + parseInt(e.key,10); _armPendingOpTimeout(); return; }
  if (e.key==='0' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && _countAcc!=null){ e.preventDefault(); _countAcc = _countAcc*10; _armPendingOpTimeout(); return; }
  if (_isEsc(e)){ e.preventDefault(); _clearPendingOp(); _countAcc=null; return; }
        if (e.key==='Shift' || e.key==='Control' || e.key==='Alt' || e.key==='Meta'){
          return;
        }
        e.preventDefault();
        // YY (copy N lines)
        if (e.key==='Y'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const total = Math.max(1, (_pendingOpCount||1) * mcount);
          const text = _extractWholeLinesText(caretRow, total);
          if ((String(text||'').length) > 0){
            (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
            try{ const lines=_splitLines(); const rs=caretRow|0; const re=Math.min(_totalLines()-1, rs + total - 1); const lastLen=(lines[re]||'').length; _flashYanked({r:rs,c:0},{r:re,c:lastLen}); }catch{}
          }
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
        // Ygg / YNgg
        if (e.key==='g'){
          if (_pendingOpSeq === 'g'){
            const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
            const targetLine = Math.max(1, mcount) - 1;
            const r0 = caretRow;
            const r1 = Math.max(0, Math.min(_totalLines()-1, targetLine));
            const rs = Math.min(r0, r1);
            const re = Math.max(r0, r1);
            const text = _extractWholeLinesText(rs, re-rs+1);
            if ((String(text||'').length) > 0){
              (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
              try{ const lines=_splitLines(); const lastLen=(lines[re]||'').length; _flashYanked({r:rs,c:0},{r:re,c:lastLen}); }catch{}
            }
            _clearPendingOp(); _repositionCaret(); updateGutter();
            return;
          } else {
            _pendingOpSeq = 'g'; _armPendingOpTimeout(); return;
          }
        }
        // Y$ — charwise to end-of-line (or across lines if count>1)
        if (e.key==='$'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          let rS = caretRow, cS = caretCol;
          let rE = rS, cE = (_splitLines()[rS]||'').length;
          if (mcount > 1){
            const last = _totalLines()-1;
            rE = Math.min(last, rS + (mcount-1));
            cE = (_splitLines()[rE]||'').length;
          }
          const start={r:rS, c:cS}, end={r:rE, c:cE};
          const text = _extractRangeText(start, end);
          if ((String(text||'').length) > 0){
            (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
            _flashYanked(start, end);
          }
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
        // YG / YNG (N as target line) — linewise copy (use literal 'G')
        if (e.key==='G'){
          const mcount = (_countAcc==null?0:_countAcc); _countAcc=null;
          const r0 = caretRow; const total=_totalLines();
          let r1;
          if (mcount && mcount>0){ r1 = Math.max(0, Math.min(total-1, mcount-1)); }
          else { r1 = total-1; }
          const rs = Math.min(r0, r1);
          const re = Math.max(r0, r1);
          const text = _extractWholeLinesText(rs, re-rs+1);
          if ((String(text||'').length) > 0){
            (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
            try{ const lines=_splitLines(); const lastLen=(lines[re]||'').length; _flashYanked({r:rs,c:0},{r:re,c:lastLen}); }catch{}
          }
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
        // Y} / Y{ — linewise copy by paragraph
        if (e.key==='}'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const next = _paragraphNextPos(caretRow, mcount);
          const rs = caretRow;
          const re = Math.max(rs, Math.max(0, Math.min(_totalLines()-1, next.r-1)));
          if (re >= rs){
            const text = _extractWholeLinesText(rs, re-rs+1);
            if ((String(text||'').length) > 0){
              (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
              try{ const lines=_splitLines(); const lastLen=(lines[re]||'').length; _flashYanked({r:rs,c:0},{r:re,c:lastLen}); }catch{}
            }
          }
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
        if (e.key==='{'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const prev = _paragraphPrevPos(caretRow, mcount);
          const rs = Math.min(prev.r, caretRow);
          const re = caretRow;
          if (re >= rs){
            const text = _extractWholeLinesText(rs, re-rs+1);
            if ((String(text||'').length) > 0){
              (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
              try{ const lines=_splitLines(); const lastLen=(lines[re]||'').length; _flashYanked({r:rs,c:0},{r:re,c:lastLen}); }catch{}
            }
          }
          _clearPendingOp(); _repositionCaret(); updateGutter();
          return;
        }
        // generic Y + motion (charwise)
        {
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const totalCount = Math.max(1, (_pendingOpCount||1) * mcount);
          const target = _computeMotionTarget(caretRow, caretCol, e.key, totalCount);
          if (target){
          // Restore zoom
            const start = { r: caretRow, c: caretCol };
            const end   = target;
            const text  = _extractRangeText(start, end);
          // Attempt window restore (best-effort; requires host bridging in WebView2)
          try{
            if (obj.windowState && typeof obj.windowState==='object'){
              const ws = obj.windowState;
              // Provide data to host via postMessage if WebView2; host decides actual resize.
              if (_isWebView2){
                try{ window.chrome.webview.postMessage({ type:'six-window-restore', state: ws }); }catch{}
              } else {
                // Browser fallback: limited move/resize (may be blocked by settings)
                if (!ws.isMaximized && ws.normalW && ws.normalH){
                  try{ window.resizeTo(Math.max(200, ws.normalW), Math.max(150, ws.normalH)); }catch{}
                  try{ window.moveTo(ws.screenX||0, ws.screenY||0); }catch{}
                }
                // Maximize cannot be programmatically forced reliably; user will need manual.
              }
            }
          }catch{}
            if ((String(text||'').length) > 0){
              (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
              _flashYanked(start, end);
            }
            _clearPendingOp(); _repositionCaret(); updateGutter();
            return;
          }
        }
        _clearPendingOp(); return;
      }
  // Pending delete operator: interpret next key as motion or line-wise command
  if (_pendingOp === 'd'){
  // allow composing count for motion (digits only when Shift is NOT held)
  if (e.key>='1' && e.key<='9' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _countAcc = (_countAcc==null?0:_countAcc)*10 + parseInt(e.key,10); _armPendingOpTimeout(); return; }
  if (e.key==='0' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && _countAcc!=null){ e.preventDefault(); _countAcc = _countAcc*10; _armPendingOpTimeout(); return; }
  if (_isEsc(e)){ e.preventDefault(); _clearPendingOp(); _countAcc=null; return; }
        // Ignore standalone modifier keys while waiting for the motion key
        // This prevents cancelling the pending 'd' when user presses Shift for $, G, {, }
        if (e.key==='Shift' || e.key==='Control' || e.key==='Alt' || e.key==='Meta'){
          // Do not clear or consume the operator; wait for the actual motion key
          return;
        }
        e.preventDefault();
        // dd (delete N lines)
        if (e.key==='d'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const total = Math.max(1, (_pendingOpCount||1) * mcount);
          _deleteWholeLines(caretRow, total);
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          return;
        }
        // dgg / dNgg
        if (e.key==='g'){
          if (_pendingOpSeq === 'g'){
            // second 'g' -> gg
            const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
            // gg count means go to line N (default 1)
            const targetLine = Math.max(1, mcount) - 1;
            const r0 = caretRow;
            const r1 = Math.max(0, Math.min(_totalLines()-1, targetLine));
            const rs = Math.min(r0, r1);
            const re = Math.max(r0, r1);
            // delete complete lines between rs..re inclusive
            _deleteWholeLines(rs, re-rs+1);
            _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
            return;
          } else {
            _pendingOpSeq = 'g'; _armPendingOpTimeout(); return;
          }
        }
  // dG / dNG (N as target line) — linewise (use literal 'G')
  if (e.key==='G'){
          const mcount = (_countAcc==null?0:_countAcc); _countAcc=null;
          const r0 = caretRow; const total=_totalLines();
          let r1;
          if (mcount && mcount>0){ r1 = Math.max(0, Math.min(total-1, mcount-1)); }
          else { r1 = total-1; }
          const rs = Math.min(r0, r1);
          const re = Math.max(r0, r1);
          _deleteWholeLines(rs, re-rs+1);
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          return;
        }
  // d$ — charwise to end-of-line (or across lines if count>1); detect literal '$'
  if (e.key==='$'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          let rS = caretRow, cS = caretCol;
          let rE = rS, cE = (_splitLines()[rS]||'').length;
          if (mcount > 1){
            const last = _totalLines()-1;
            rE = Math.min(last, rS + (mcount-1));
            cE = (_splitLines()[rE]||'').length;
          }
          const start={r:rS, c:cS}, end={r:rE, c:cE};
          if (!(start.r===end.r && start.c===end.c)) _deleteRangePos(start, end);
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          return;
        }
  // d} / d{ — linewise delete by paragraph; detect literal '}' / '{'
  if (e.key==='}'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const next = _paragraphNextPos(caretRow, mcount);
          const rs = caretRow;
          const re = Math.max(rs, Math.max(0, Math.min(_totalLines()-1, next.r-1)));
          if (re >= rs){ _deleteWholeLines(rs, re-rs+1); }
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          return;
        }
  if (e.key==='{'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const prev = _paragraphPrevPos(caretRow, mcount);
          const rs = Math.min(prev.r, caretRow);
          const re = caretRow;
          if (re >= rs){ _deleteWholeLines(rs, re-rs+1); }
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          return;
        }
        // generic d + motion (charwise)
        const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
        const totalCount = Math.max(1, (_pendingOpCount||1) * mcount);
        // compute target based on motion key
        const target = _computeMotionTarget(caretRow, caretCol, e.key, totalCount);
        if (target){
          const start = { r: caretRow, c: caretCol };
          const end   = target;
          // If motion is left/backward and end equals start (no movement), do nothing
          if (!(start.r===end.r && start.c===end.c)){
            _deleteRangePos(start, end);
          }
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          return;
        }
        // unknown motion → cancel operator
        _clearPendingOp(); return;
      }
  // Pending change operator: interpret next key as motion or line-wise command, then enter INSERT
  if (_pendingOp === 'c'){
  // allow composing count for motion (digits only when Shift is NOT held)
  if (e.key>='1' && e.key<='9' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _countAcc = (_countAcc==null?0:_countAcc)*10 + parseInt(e.key,10); _armPendingOpTimeout(); return; }
  if (e.key==='0' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && _countAcc!=null){ e.preventDefault(); _countAcc = _countAcc*10; _armPendingOpTimeout(); return; }
  if (_isEsc(e)){ e.preventDefault(); _clearPendingOp(); _countAcc=null; return; }
        // Ignore standalone modifier keys while waiting for the motion key
        if (e.key==='Shift' || e.key==='Control' || e.key==='Alt' || e.key==='Meta'){
          return;
        }
        e.preventDefault();
        // cc (change N lines)
        if (e.key==='c'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const total = Math.max(1, (_pendingOpCount||1) * mcount);
          _deleteWholeLines(caretRow, total);
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          _suppressInsertSnapshotOnce = true; _setMode('INSERT');
          return;
        }
        // cgg / cNgg
        if (e.key==='g'){
          if (_pendingOpSeq === 'g'){
            const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
            const targetLine = Math.max(1, mcount) - 1;
            const r0 = caretRow;
            const r1 = Math.max(0, Math.min(_totalLines()-1, targetLine));
            const rs = Math.min(r0, r1);
            const re = Math.max(r0, r1);
            _deleteWholeLines(rs, re-rs+1);
            _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
            _suppressInsertSnapshotOnce = true; _setMode('INSERT');
            return;
          } else {
            _pendingOpSeq = 'g'; _armPendingOpTimeout(); return;
          }
        }
  // cG / cNG (N as target line)
  if (e.key==='G'){
          const mcount = (_countAcc==null?0:_countAcc); _countAcc=null;
          const r0 = caretRow; const total=_totalLines();
          let r1;
          if (mcount && mcount>0){ r1 = Math.max(0, Math.min(total-1, mcount-1)); }
          else { r1 = total-1; }
          const rs = Math.min(r0, r1);
          const re = Math.max(r0, r1);
          _deleteWholeLines(rs, re-rs+1);
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          _suppressInsertSnapshotOnce = true; _setMode('INSERT');
          return;
        }
  // c$ — charwise to end-of-line (or across lines if count>1)
  if (e.key==='$'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          let rS = caretRow, cS = caretCol;
          let rE = rS, cE = (_splitLines()[rS]||'').length;
          if (mcount > 1){
            const last = _totalLines()-1;
            rE = Math.min(last, rS + (mcount-1));
            cE = (_splitLines()[rE]||'').length;
          }
          const start={r:rS, c:cS}, end={r:rE, c:cE};
          if (!(start.r===end.r && start.c===end.c)) _deleteRangePos(start, end);
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          _suppressInsertSnapshotOnce = true; _setMode('INSERT');
          return;
        }
  // c} / c{ — linewise change by paragraph
  if (e.key==='}'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const next = _paragraphNextPos(caretRow, mcount);
          const rs = caretRow;
          const re = Math.max(rs, Math.max(0, Math.min(_totalLines()-1, next.r-1)));
          if (re >= rs){ _deleteWholeLines(rs, re-rs+1); }
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          _suppressInsertSnapshotOnce = true; _setMode('INSERT');
          return;
        }
  if (e.key==='{'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const prev = _paragraphPrevPos(caretRow, mcount);
          const rs = Math.min(prev.r, caretRow);
          const re = caretRow;
          if (re >= rs){ _deleteWholeLines(rs, re-rs+1); }
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          _suppressInsertSnapshotOnce = true; _setMode('INSERT');
          return;
        }
        // cl 特殊ケース (s と同等: 改行も1文字として扱う。ただしEOF直前の改行は含めない)
        if (e.key==='l'){
          const beforeAll = String(editor.value||'');
          const hadEOFSymbol = beforeAll.endsWith('\u2424');
          const motionCount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const preRawCount = (()=>{ try{ return _splitLinesRaw().length; }catch{ return null; } })();
          const totalChars = Math.max(1, (_pendingOpCount||1) * motionCount);
          const start = { r: caretRow, c: caretCol };
          const endPos = _advancePosByCpRawStopBeforeFinalLF(caretRow, caretCol, totalChars);
          // 末尾 U+2424 を削除範囲から除外 (#664)
          try{
            const raw=_splitLinesRaw();
            const last=raw.length-1;
            if (endPos.r===last){
              const line=raw[last]||'';
              if (endPos.c===line.length && line.endsWith('\u2424')){ endPos.c=Math.max(0, line.length-1); }
            }
          }catch{}
          // 1文字のみ（前置カウント1）ではレジスタ更新しない
          const upd = (totalChars>=2);
          if (!(start.r===endPos.r && start.c===endPos.c)){
            _deleteRangePos(start, endPos, { updateRegister: upd });
          }
          // 念のため: EOFの␤が消えてしまった場合は復元 (#665)
          try{
            const after=String(editor.value||'');
            const postRawCount = (()=>{ try{ return _splitLinesRaw().length; }catch{ return null; } })();
            if (hadEOFSymbol){ if (!after.endsWith('\u2424')){ editor.value = after + '\u2424'; } }
            const now=String(editor.value||'');
            if (preRawCount!=null && postRawCount!=null && postRawCount===preRawCount-1 && !now.endsWith('\n')){
              editor.value = now + '\u2424';
              try{ const raw=_splitLinesRaw(); const last=raw.length-1; _setCaret(last, 0); }catch{}
            }
          }catch{}
          // #662: cl でも末尾空行(最終行が空で末尾LF欠落)で前行へ吸着しない
          try{
            const txt=String(editor.value||'');
            const raw=_splitLinesRaw();
            const last=raw.length-1;
            const lastStr=String(raw[last]||'');
            const lastIsOnlySymbol = (lastStr.length===1 && lastStr.charCodeAt(0)===0x2424);
            if (caretRow===last && !txt.endsWith('\n') && (lastStr==='' || lastIsOnlySymbol)){
              _setCaret(caretRow, caretCol);
            }
          }catch{}
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          // 再ピン留め (reposition後のずれ対策) (#664)
          try{
            const txt=String(editor.value||'');
            if (!txt.endsWith('\n')){
              const raw=_splitLinesRaw(); const last=raw.length-1; const lastStr=String(raw[last]||'');
              if (caretRow===last && (lastStr==='' || (lastStr.length===1 && lastStr.charCodeAt(0)===0x2424))){ _setCaret(caretRow, 0); }
            }
          }catch{}
          _suppressInsertSnapshotOnce = true; _setMode('INSERT');
          return;
        }
        // cw/cW special-case (Vim: cw behaves like ce; cW like cE for WORD) — 改行は含めない（#654 で元に戻す）
        if (e.key==='w' || e.key==='W'){
          const motionCount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const totalWords = Math.max(1, (_pendingOpCount||1) * motionCount);
          const line = (_splitLines()[caretRow]||'');
          const n = line.length;
          let i = caretCol;
          let j = i;
          const isSpaceAt = (idx)=>{ const t=_wordTypeAtInLine(line, idx); return t===_WT_SPACE; };
          let consumed = 0;
          while (consumed < totalWords && j < n){
            while (j < n && isSpaceAt(j)) j = _nextIndex(line, j);
            if (j >= n) break;
            if (e.key==='W'){
              while (j < n && !isSpaceAt(j)){ j = _nextIndex(line, j); }
            } else {
              const tRun = _wordTypeAtInLine(line, j);
              while (j < n && _wordTypeAtInLine(line, j) === tRun){ j = _nextIndex(line, j); }
            }
            consumed++;
          }
          const start={ r: caretRow, c: i };
          const end={ r: caretRow, c: j };
          if (!(start.r===end.r && start.c===end.c)){
            _deleteRangePos(start, end);
          }
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          _suppressInsertSnapshotOnce = true; _setMode('INSERT');
          return;
        }
        // generic c + motion (charwise)
        const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
        const totalCount = Math.max(1, (_pendingOpCount||1) * mcount);
        const target = _computeMotionTarget(caretRow, caretCol, e.key, totalCount);
        if (target){
          const start = { r: caretRow, c: caretCol };
          const end   = target;
          if (!(start.r===end.r && start.c===end.c)){
            _deleteRangePos(start, end);
          }
          _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
          _suppressInsertSnapshotOnce = true; _setMode('INSERT');
          return;
        }
        _clearPendingOp(); return;
      }
      if (e.key===':' && !e.ctrlKey){
        e.preventDefault();
        _preCmdMode = _mode; // NORMAL or INSERT (defensive)
        _setMode('CMD');
        _clearPending();
        _incPrevHide();
        _incSearchAnchorOff = null; _incSearchDir = 'fwd';
        // reset command history browsing state when entering CMD
        try{ _cmdHistBrowsing=false; _cmdHistIndex=_cmdHistory.length; _cmdHistTemp=''; }catch{}
        // G/gg 直後の残存センタリングによるスクロールを抑止し、縦位置の半端ズレを排除
        try{ _centerScrolloffOnce = false; }catch{}
        try{ _scrollGuardUntil = Date.now() + 120; }catch{}
        // 水平成分の保持（初回だけ行頭へ戻される現象を防止）
        const _holdLeftColon = (function(){ try{ return editor.scrollLeft|0; }catch{ return 0; } })();
        // 縦スクロールは行境界にスナップし、直後にオーバーレイを再配置
        try{
          const st0 = (editor.scrollTop||0);
          const flo = Math.floor(st0/LINE_HEIGHT)*LINE_HEIGHT;
          if (Math.abs(st0 - flo) > 0.1){ editor.scrollTop = flo; }
          _repositionCaret(); updateGutter();
          // 水平位置を復元
          try{ if (editor && (editor.scrollLeft|0) !== _holdLeftColon){ editor.scrollLeft = _holdLeftColon; } }catch{}
        }catch{}
        if (cmdinput){
          // コロンは入力欄にそのまま見えるようにする
          cmdinput.value = ':';
            // 直後に他のフォーカス復元ロジックが割り込んでしまう競合を避けるため、rAF+setTimeout の二段階でフォーカス確定
            const stHold = (function(){ try{ return editor.scrollTop|0; }catch{ return 0; } })();
            Promise.resolve().then(()=>{
              try{ if (_mode==='CMD'){ cmdinput.focus(); const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); } }catch{}
              if (window.requestAnimationFrame){
                requestAnimationFrame(()=>{
                  try{
                    if (_mode==='CMD' && document.activeElement !== cmdinput){ cmdinput.focus(); const p=(cmdinput.value||'').length; cmdinput.setSelectionRange(p,p); }
                    // フォーカスでブラウザが動かしたスクロールを縦横ともに復元
                    if (_mode==='CMD' && editor){
                      const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                      if (Math.abs((editor.scrollTop||0) - flo) > 0.1){ editor.scrollTop = flo; }
                      _repositionCaret(); updateGutter();
                      if ((editor.scrollLeft|0) !== _holdLeftColon){ editor.scrollLeft = _holdLeftColon; }
                    }
                  }catch{}
                });
              }
              setTimeout(()=>{
                try{
                  if (_mode==='CMD' && document.activeElement !== cmdinput){ cmdinput.focus(); const p=(cmdinput.value||'').length; cmdinput.setSelectionRange(p,p); }
                  if (_mode==='CMD' && editor){
                    const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                    if (Math.abs((editor.scrollTop||0) - flo) > 0.1){ editor.scrollTop = flo; }
                    _repositionCaret(); updateGutter();
                    if ((editor.scrollLeft|0) !== _holdLeftColon){ editor.scrollLeft = _holdLeftColon; }
                  }
                }catch{}
              }, 60);
            });
          // close interception is now bound at startup; nothing to do here
        }
        return;
      }
      // '/' search prompt (enter CMD with '/' prefilled) with robust multi-frame focus like ':'
      if (e.key==='/' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        // VISUAL 中は選択文字列を初期値にして検索へ移行 (#683)
        let visSeed = '';
        if (_visualActive){
          try{
            const v = String(editor.value||'');
            if (_visualLinewise){
              const rs = Math.min(_visualAnchorR, caretRow);
              const re = Math.max(_visualAnchorR, caretRow);
              const sOff = _offsetFromRC(rs, 0)|0;
              const eOff = _offsetFromRC(re, (_splitLines()[re]||'').length)|0;
              visSeed = v.slice(Math.max(0,sOff), Math.max(0,eOff));
            } else {
              const sOff = _offsetFromRC(_visualAnchorR, _visualAnchorC)|0;
              const eOff = _offsetFromRC(caretRow, caretCol)|0;
              const a = Math.min(sOff, eOff), b = Math.max(sOff, eOff);
              visSeed = v.slice(Math.max(0,a), Math.max(0,b));
            }
            // リテラル一致となるよう正規表現エスケープ（\n/\tは維持）
            visSeed = _escapeRegexLiteralForSeed(visSeed); // 空白はそのまま保持 (#687)
          }catch{ visSeed=''; }
          try{ _exitVisual(); }catch{}
        }
        _preCmdMode = _mode; _setMode('CMD'); _clearPending();
        _incPrevHide();
        try{ _incSearchAnchorOff = _offsetFromRC(caretRow, caretCol)|0; _incSearchDir = 'fwd'; }catch{ _incSearchAnchorOff = null; _incSearchDir='fwd'; }
        try{ _cmdHistBrowsing=false; _cmdHistIndex=_cmdHistory.length; _cmdHistTemp=''; }catch{}
        // G/gg直後の残存センタリングフラグによるジャンプを抑止 (#432)
        try{ _centerScrolloffOnce = false; }catch{}
        // 直前の大ジャンプ強化用 rAF が CMD 遷移後に二次調整しないよう短時間ガード
        try{ _scrollGuardUntil = Date.now() + 120; }catch{}
        // 水平位置保持 (#433)
        const _holdLeftFwd = (function(){ try{ return editor.scrollLeft|0; }catch{ return 0; } })();
        // CMD開始直後にスクロール位置が半端値だと先頭余白+背景ズレが発生する (#431)
        try{
          const st0 = (editor.scrollTop||0);
          const flo = Math.floor(st0/LINE_HEIGHT)*LINE_HEIGHT;
          if (Math.abs(st0 - flo) > 0.1){ editor.scrollTop = flo; }
          // 直後に再配置して視覚ギャップを排除
          _repositionCaret(); updateGutter();
          // 水平位置再適用
          try{ if (editor && (editor.scrollLeft|0) !== _holdLeftFwd){ editor.scrollLeft = _holdLeftFwd; } }catch{}
        }catch{}
        if (cmdinput){
          cmdinput.value = visSeed ? ('/' + visSeed) : '/';
          const stHold = (function(){ try{ return editor.scrollTop|0; }catch{ return 0; } })();
          Promise.resolve().then(()=>{
            try{ if (_mode==='CMD'){ cmdinput.focus(); const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); } }catch{}
            if (window.requestAnimationFrame){
              requestAnimationFrame(()=>{ try{
                if (_mode==='CMD' && document.activeElement !== cmdinput){ cmdinput.focus(); const p=(cmdinput.value||'').length; cmdinput.setSelectionRange(p,p); }
                // フォーカス操作でブラウザがスクロールを動かした場合でも視界を保持
                if (_mode==='CMD' && editor){
                  const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                  if (Math.abs((editor.scrollTop||0) - flo) > 0.1){ editor.scrollTop = flo; }
                  _repositionCaret(); updateGutter();
                  if ((editor.scrollLeft|0) !== _holdLeftFwd){ editor.scrollLeft = _holdLeftFwd; }
                }
              }catch{} });
            }
            setTimeout(()=>{ try{
              if (_mode==='CMD' && document.activeElement !== cmdinput){ cmdinput.focus(); const p=(cmdinput.value||'').length; cmdinput.setSelectionRange(p,p); }
              if (_mode==='CMD' && editor){
                const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                if (Math.abs((editor.scrollTop||0) - flo) > 0.1){ editor.scrollTop = flo; }
                _repositionCaret(); updateGutter();
                if ((editor.scrollLeft|0) !== _holdLeftFwd){ editor.scrollLeft = _holdLeftFwd; }
              }
            }catch{} }, 60);
          });
        }
        return;
      }
      // '?' backward search prompt with robust multi-frame focus like ':'
      if (e.key==='?' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        // VISUAL 中は選択文字列を初期値にして逆方向検索へ移行 (#683)
        let visSeed = '';
        if (_visualActive){
          try{
            const v = String(editor.value||'');
            if (_visualLinewise){
              const rs = Math.min(_visualAnchorR, caretRow);
              const re = Math.max(_visualAnchorR, caretRow);
              const sOff = _offsetFromRC(rs, 0)|0;
              const eOff = _offsetFromRC(re, (_splitLines()[re]||'').length)|0;
              visSeed = v.slice(Math.max(0,sOff), Math.max(0,eOff));
            } else {
              const sOff = _offsetFromRC(_visualAnchorR, _visualAnchorC)|0;
              const eOff = _offsetFromRC(caretRow, caretCol)|0;
              const a = Math.min(sOff, eOff), b = Math.max(sOff, eOff);
              visSeed = v.slice(Math.max(0,a), Math.max(0,b));
            }
            // リテラル一致となるよう正規表現エスケープ（\n/\tは維持）
            visSeed = _escapeRegexLiteralForSeed(visSeed); // 空白はそのまま保持 (#687)
          }catch{ visSeed=''; }
          try{ _exitVisual(); }catch{}
        }
        _preCmdMode = _mode; _setMode('CMD'); _clearPending();
        _incPrevHide();
        try{ _incSearchAnchorOff = _offsetFromRC(caretRow, caretCol)|0; _incSearchDir = 'bwd'; }catch{ _incSearchAnchorOff = null; _incSearchDir='bwd'; }
        try{ _cmdHistBrowsing=false; _cmdHistIndex=_cmdHistory.length; _cmdHistTemp=''; }catch{}
        try{ _centerScrolloffOnce = false; }catch{}
        try{ _scrollGuardUntil = Date.now() + 120; }catch{}
        const _holdLeftBwd = (function(){ try{ return editor.scrollLeft|0; }catch{ return 0; } })();
        // '?'開始時も同じ補正 (#431)
        try{
          const st0 = (editor.scrollTop||0);
          const flo = Math.floor(st0/LINE_HEIGHT)*LINE_HEIGHT;
          if (Math.abs(st0 - flo) > 0.1){ editor.scrollTop = flo; }
          _repositionCaret(); updateGutter();
          try{ if (editor && (editor.scrollLeft|0) !== _holdLeftBwd){ editor.scrollLeft = _holdLeftBwd; } }catch{}
        }catch{}
        if (cmdinput){
          cmdinput.value = visSeed ? ('?' + visSeed) : '?';
          const stHold = (function(){ try{ return editor.scrollTop|0; }catch{ return 0; } })();
          Promise.resolve().then(()=>{
            try{ if (_mode==='CMD'){ cmdinput.focus(); const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); } }catch{}
            if (window.requestAnimationFrame){
              requestAnimationFrame(()=>{ try{
                if (_mode==='CMD' && document.activeElement !== cmdinput){ cmdinput.focus(); const p=(cmdinput.value||'').length; cmdinput.setSelectionRange(p,p); }
                if (_mode==='CMD' && editor){
                  const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                  if (Math.abs((editor.scrollTop||0) - flo) > 0.1){ editor.scrollTop = flo; }
                  _repositionCaret(); updateGutter();
                  if ((editor.scrollLeft|0) !== _holdLeftBwd){ editor.scrollLeft = _holdLeftBwd; }
                }
              }catch{} });
            }
            setTimeout(()=>{ try{
              if (_mode==='CMD' && document.activeElement !== cmdinput){ cmdinput.focus(); const p=(cmdinput.value||'').length; cmdinput.setSelectionRange(p,p); }
              if (_mode==='CMD' && editor){
                const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                if (Math.abs((editor.scrollTop||0) - flo) > 0.1){ editor.scrollTop = flo; }
                _repositionCaret(); updateGutter();
                if ((editor.scrollLeft|0) !== _holdLeftBwd){ editor.scrollLeft = _holdLeftBwd; }
              }
            }catch{} }, 60);
          });
        }
        return;
      }
  if (e.key==='j' || e.key==='ArrowDown'){ e.preventDefault(); try{ _debugPush({ t:Date.now(), type:'motion-exec', mode:_mode, key:e.key, code:e.code, via:(e.key==='j'?'j':'ArrowDown') }); }catch{} const n=_consumeCount(); _moveCaretLines(n); try{ _flagCaretMotion(); }catch{} _repositionCaret(); updateGutter(); return; }
  if (e.key==='k' || e.key==='ArrowUp'){ e.preventDefault(); try{ _debugPush({ t:Date.now(), type:'motion-exec', mode:_mode, key:e.key, code:e.code, via:(e.key==='k'?'k':'ArrowUp') }); }catch{} const n=_consumeCount(); _moveCaretLines(-n); try{ _flagCaretMotion(); }catch{} _repositionCaret(); updateGutter(); return; }
  // Strict IME mode: while composing in NORMAL, ignore letter motions j/k/h/l (arrows still work)
  if (_optStrictNormalIME && _imeComposing){
    if (e.key==='j' || e.key==='k' || e.key==='h' || e.key==='l'){
      _debugPush({ t:Date.now(), type:'ignored-motion', mode:_mode, key:e.key, code:e.code, reason:'strict-ime', isComp:_imeComposing });
      return;
    }
  }
  // Guard anomalous IME mapping (#523): require KeyH/KeyL for h/l, allow arrow keys as usual
  if ((e.key==='h' && e.code==='KeyH' && (!_optStrictNormalIME || !_imeComposing)) || e.key==='ArrowLeft'){ e.preventDefault(); try{ _debugPush({ t:Date.now(), type:'motion-exec', mode:_mode, key:e.key, code:e.code, via:(e.code==='KeyH'?'KeyH':'ArrowLeft') }); }catch{} const n=_consumeCount(); _moveCaretCols(-n); try{ _flagCaretMotion(); }catch{} _repositionCaret(); return; }
  if ((e.key==='l' && e.code==='KeyL' && (!_optStrictNormalIME || !_imeComposing)) || e.key==='ArrowRight'){ e.preventDefault(); try{ _debugPush({ t:Date.now(), type:'motion-exec', mode:_mode, key:e.key, code:e.code, via:(e.code==='KeyL'?'KeyL':'ArrowRight') }); }catch{} const n=_consumeCount(); _moveCaretCols(n); try{ _flagCaretMotion(); }catch{} _repositionCaret(); return; }
  // delete: x (delete char(s) under cursor / join newline)
  if (e.key==='x' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); _doDeleteX(n); ensureScrolloff(); _repositionCaret(); updateGutter(); return; }
  // >> / << — indent/outdent current and following N-1 lines by shiftwidth
  // >> — allow layout-agnostic detection via e.code 'Period' + Shift, and Process-coded
  if ((!e.ctrlKey && !e.metaKey && !e.altKey) && (e.key==='>' || (e.code==='Period' && e.shiftKey) || (e.key==='Process' && e.code==='Period' && e.shiftKey))){
    e.preventDefault();
    if (_pendingNormal === '>'){
      // commit >>
      _pendingNormal = null; if (_pendingTimer){ clearTimeout(_pendingTimer); _pendingTimer=null; }
      let mcount = (_pendingNormalCount && _pendingNormalCount>0)? _pendingNormalCount : 0;
      if (!(mcount>0) && _countAcc!=null && _countAcc>0){ mcount = _countAcc|0; }
      if (!(mcount>0)) mcount = 1;
      // debug removed: commit >> mcount
      _pendingNormalCount = null; _countAcc = null;
      const totalLines = _totalLines();
      const rs = caretRow;
      const re = Math.max(rs, Math.min(totalLines-1, rs + Math.max(1,mcount|0) - 1));
      _applyIndentRange(rs, re, +1);
      return;
    } else {
      _pendingNormal = '>';
      if (_countAcc!=null && _countAcc>0){ _pendingNormalCount = _countAcc|0; /* keep _countAcc until commit as fallback */ } else { _pendingNormalCount = null; }
      if (_pendingTimer) clearTimeout(_pendingTimer);
      _pendingTimer = setTimeout(()=>{ _pendingNormal=null; _pendingTimer=null; _pendingNormalCount=null; }, 1500);
      // debug removed: pending >
      return;
    }
  }
  // << — allow layout-agnostic detection via e.code 'Comma' + Shift, and Process-coded
  if ((!e.ctrlKey && !e.metaKey && !e.altKey) && (e.key==='<' || (e.code==='Comma' && e.shiftKey) || (e.key==='Process' && e.code==='Comma' && e.shiftKey))){
    e.preventDefault();
    if (_pendingNormal === '<'){
      // commit <<
      _pendingNormal = null; if (_pendingTimer){ clearTimeout(_pendingTimer); _pendingTimer=null; }
      let mcount = (_pendingNormalCount && _pendingNormalCount>0)? _pendingNormalCount : 0;
      if (!(mcount>0) && _countAcc!=null && _countAcc>0){ mcount = _countAcc|0; }
      if (!(mcount>0)) mcount = 1;
      // debug removed: commit << mcount
      _pendingNormalCount = null; _countAcc = null;
      const totalLines = _totalLines();
      const rs = caretRow;
      const re = Math.max(rs, Math.min(totalLines-1, rs + Math.max(1,mcount|0) - 1));
      _applyIndentRange(rs, re, -1);
      return;
    } else {
      _pendingNormal = '<';
      if (_countAcc!=null && _countAcc>0){ _pendingNormalCount = _countAcc|0; /* keep _countAcc until commit as fallback */ } else { _pendingNormalCount = null; }
      if (_pendingTimer) clearTimeout(_pendingTimer);
      _pendingTimer = setTimeout(()=>{ _pendingNormal=null; _pendingTimer=null; _pendingNormalCount=null; }, 1500);
      // debug removed: pending <
      return;
    }
  }
  // delete operator: d + motion
  if (e.key==='d' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _pendingOp='d'; _pendingOpCount=_consumeCount(); if (!_pendingOpCount || _pendingOpCount<1) _pendingOpCount=1; _pendingOpSeq=null; _armPendingOpTimeout(); return; }
  // yank operator: y + motion
  if (e.key==='y' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _pendingOp='y'; _pendingOpCount=_consumeCount(); if (!_pendingOpCount || _pendingOpCount<1) _pendingOpCount=1; _pendingOpSeq=null; _armPendingOpTimeout(); return; }
  // Windows clipboard copy operator: Y + motion (does not touch unnamed register)
  if (e.key==='Y' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _pendingOp='Y'; _pendingOpCount=_consumeCount(); if (!_pendingOpCount || _pendingOpCount<1) _pendingOpCount=1; _pendingOpSeq=null; _armPendingOpTimeout(); return; }
  // change operator: c + motion
  if (e.key==='c' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _pendingOp='c'; _pendingOpCount=_consumeCount(); if (!_pendingOpCount || _pendingOpCount<1) _pendingOpCount=1; _pendingOpSeq=null; _armPendingOpTimeout(); return; }
      // word motions (w: next word start, b: prev word start)
    if (e.key==='w' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); _moveWordW(n); try{ _flagCaretMotion(); }catch{} _ensureAfterMotion(); _repositionCaret(); updateGutter(); return; }
    if (e.key==='b' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); _moveWordB(n); try{ _flagCaretMotion(); }catch{} _ensureAfterMotion(); _repositionCaret(); updateGutter(); return; }
  if (e.key==='W' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); _moveWORDW(n); try{ _flagCaretMotion(); }catch{} _ensureAfterMotion(); _repositionCaret(); updateGutter(); return; }
  if (e.key==='B' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); _moveWORDB(n); try{ _flagCaretMotion(); }catch{} _ensureAfterMotion(); _repositionCaret(); updateGutter(); return; }
        // line anchors ^, 0, $ （Home/End を 0/$ と同等に）
      if (e.key==='^'){ e.preventDefault(); const _n=_consumeCount(); const line=(_splitLines()[caretRow]||''); _setCaret(caretRow, _firstNonBlankColOf(line)); try{ _flagCaretMotion(); }catch{} _repositionCaret(); return; }
        // '0' as a command only when no count prefix in progress
      if (e.key==='0' && _countAcc==null){ e.preventDefault(); _setCaret(caretRow, 0); try{ _flagCaretMotion(); }catch{} _repositionCaret(); return; }
        // Home -> 行頭（0 と同等）
      if (e.key==='Home' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _setCaret(caretRow, 0); try{ _flagCaretMotion(); }catch{} _repositionCaret(); return; }
        // End -> 行末（$ と同等、カウント対応）
      if (e.key==='$' || (e.key==='End' && !e.ctrlKey && !e.metaKey && !e.altKey)){ e.preventDefault(); const n=_consumeCount(); let r=caretRow; if (n>1){ _moveCaretLines(n-1); r=caretRow; } const len=_lineLen(r); const noMove=(r===caretRow && len===caretCol); _setCaret(r, len, noMove?{suppressDesired:true}:undefined); try{ _flagCaretMotion(); }catch{} _repositionCaret(); updateGutter(); return; }
      // paragraphs { }
  if (e.key==='}'){ e.preventDefault(); const n=_consumeCount(); _moveParagraphNext(n); try{ _flagCaretMotion(); }catch{} _ensureAfterMotion(); _repositionCaret(); updateGutter(); return; }
  if (e.key==='{'){ e.preventDefault(); const n=_consumeCount(); _moveParagraphPrev(n); try{ _flagCaretMotion(); }catch{} _ensureAfterMotion(); _repositionCaret(); updateGutter(); return; }
      // numeric prefix (1-9 start/extend; 0 extends if already started)
      if (e.key>='1' && e.key<='9' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        if (_pendingNormal==='>' || _pendingNormal==='<'){
          _pendingNormalCount = (_pendingNormalCount==null?0:_pendingNormalCount)*10 + parseInt(e.key,10);
          if (_pendingTimer) clearTimeout(_pendingTimer);
          _pendingTimer = setTimeout(()=>{ _pendingNormal=null; _pendingTimer=null; _pendingNormalCount=null; }, 1500);
          // debug removed: digit during pending
        } else {
          _countAcc = (_countAcc==null?0:_countAcc)*10 + parseInt(e.key,10);
          // debug removed: digit precount
        }
        return;
      }
      if (e.key==='0' && !e.ctrlKey && !e.metaKey && !e.altKey){
        if (_countAcc!=null || _pendingNormal==='>' || _pendingNormal==='<'){
          e.preventDefault();
          if (_pendingNormal==='>' || _pendingNormal==='<'){
            _pendingNormalCount = (_pendingNormalCount==null?0:_pendingNormalCount)*10; // extend pending count
            if (_pendingTimer) clearTimeout(_pendingTimer);
            _pendingTimer = setTimeout(()=>{ _pendingNormal=null; _pendingTimer=null; _pendingNormalCount=null; }, 1500);
            // debug removed: zero extend pending
          } else if (_countAcc!=null){
            _countAcc = _countAcc*10;
            // debug removed: zero extend precount
          }
          return;
        }
      }
  if (e.key==='i'){ e.preventDefault(); _setMode('INSERT'); return; }
  if (e.key==='v' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _enterVisual(false); return; }
  if (e.key==='V' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        // Preserve caret column when entering VISUAL linewise (#447)
        const colHold = caretCol|0;
        _enterVisual(true);
        try{ _setCaret(caretRow, Math.max(0, Math.min(_lineLen(caretRow), colHold))); }catch{}
        _repositionCaret(); updateGutter();
        return;
      }
      if (e.key==='a' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        // move one cp right within line if possible, then enter INSERT
        const line = (_splitLines()[caretRow]||'');
        let nc = caretCol;
        if (caretCol < line.length){ nc = _nextIndex(line, caretCol); }
        _setCaret(caretRow, nc); _setMode('INSERT'); return;
      }
      if (e.key==='I' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        const line = (_splitLines()[caretRow]||'');
        const col = _firstNonBlankColOf(line);
        _setCaret(caretRow, col); _setMode('INSERT'); return;
      }
      if (e.key==='A' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        const len = _lineLen(caretRow);
        _setCaret(caretRow, len); _setMode('INSERT'); return;
      }
      if (e.key==='o' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        _pushUndoSnapshot('open-below');
        _suppressInsertSnapshotOnce = true;
        const prev = String(editor.value||'');
        const hadFinalLF = prev.endsWith('\n'); // no longer used for auto newline augmentation (#597)
        const lines = _splitLinesRaw(); // (#607) 末尾空要素保持
        const rr = Math.max(0, Math.min(lines.length-1, caretRow));
        const wasLastRow = (rr === lines.length-1);
        const hadBlankEOFLine = (lines.length>0 && lines[lines.length-1]==='');
        let newLines = lines.slice(0, rr+1).concat(['']).concat(lines.slice(rr+1));
        let out = newLines.join('\n');
        // (#607) 既存末尾LFがあり raw 分割で末尾空行がなかった場合は本来 2 連続 LF になるべきなので補正
        if (wasLastRow && hadFinalLF && !hadBlankEOFLine){ out = prev + '\n'; }
        if (out !== prev){ editor.value = out; _touchBufferModified(); }
        _setCaret(rr+1, 0);
        ensureScrolloff(); _repositionCaret(); updateGutter(); _setMode('INSERT'); return;
      }
      if (e.key==='O' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        _pushUndoSnapshot('open-above');
        _suppressInsertSnapshotOnce = true;
        const prev = String(editor.value||'');
        const hadFinalLF = prev.endsWith('\n'); // no longer used for auto newline augmentation (#597)
        const lines = _splitLinesRaw(); // (#607)
        const rr = Math.max(0, Math.min(lines.length-1, caretRow));
        const wasLastRow = (rr === lines.length-1);
        const isEOFBlank = (lines.length>0 && rr===lines.length-1 && lines[rr]==='');
        const newLines = lines.slice(0, rr).concat(['']).concat(lines.slice(rr));
        let out = newLines.join('\n');
        // (#597) EOF 付近の自動改行付与を廃止: ユーザー操作による行挿入のみを反映し末尾LFを強制しない
        if (out !== prev){ editor.value = out; _touchBufferModified(); }
        _setCaret(rr, 0); ensureScrolloff(); _repositionCaret(); updateGutter(); _setMode('INSERT'); return;
      }
      if (e.key==='p' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        const n=_consumeCount();
        if (_regUnnamed && _regUnnamed.linewise) _pasteLinewise(true, n); else _pasteCharwise(true, n);
        return;
      }
      if (e.key==='P' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        const n=_consumeCount();
        if (_regUnnamed && _regUnnamed.linewise) _pasteLinewise(false, n); else _pasteCharwise(false, n);
        return;
      }
      // s == cl (change one char; count N -> change N chars). EOLで文字が無ければ i と同等。
      if (e.key==='s' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        const beforeAll = String(editor.value||'');
        const hadEOFSymbol = beforeAll.endsWith('\u2424');
        const n = _consumeCount();
        const preRawCount = (()=>{ try{ return _splitLinesRaw().length; }catch{ return null; } })();
        const count = Math.max(1, n|0);
        // 改行も1文字として扱う: raw 基準でコードポイント前進（EOFの正確な取り扱い）
        const endPos = _advancePosByCpRawStopBeforeFinalLF(caretRow, caretCol, count);
        // 末尾が U+2424 の場合は削除範囲に含めない安全弁 (#664)
        try{
          const raw=_splitLinesRaw();
          const last=raw.length-1;
          if (endPos.r===last){
            const line=raw[last]||'';
            if (endPos.c===line.length && line.endsWith('\u2424')){
              endPos.c = Math.max(0, line.length-1); // exclude symbol
            }
          }
        }catch{}
        // 削除（1文字のみの変更では unnamed レジスタを更新しない仕様）
        const upd = (count>=2);
        _deleteRangePos({r:caretRow,c:caretCol}, endPos, { updateRegister: upd });
        // 念のため: EOFの␤が消えてしまった場合は復元 (#665)
        try{
          const after=String(editor.value||'');
          const postRawCount = (()=>{ try{ return _splitLinesRaw().length; }catch{ return null; } })();
          if (hadEOFSymbol){ if (!after.endsWith('\u2424')){ editor.value = after + '\u2424'; } }
          // 行数が1減ってしまったら(末尾LF欠落のまま)␤を補い caret を末行先頭へ固定 (#666)
          const now=String(editor.value||'');
          if (preRawCount!=null && postRawCount!=null && postRawCount===preRawCount-1 && !now.endsWith('\n')){
            editor.value = now + '\u2424';
            try{ const raw=_splitLinesRaw(); const last=raw.length-1; _setCaret(last, 0); }catch{}
          }
        }catch{}
        // #662: s では末尾空行(最終行が空で末尾LF欠落)でも前行へ吸着しない（位置を固定）
        try{
          const txt=String(editor.value||'');
          const raw=_splitLinesRaw();
          const last=raw.length-1;
          const lastStr=String(raw[last]||'');
          const lastIsOnlySymbol = (lastStr.length===1 && lastStr.charCodeAt(0)===0x2424);
          if (caretRow===last && !txt.endsWith('\n') && (lastStr==='' || lastIsOnlySymbol)){
            _setCaret(caretRow, caretCol);
          }
        }catch{}
        ensureScrolloff(); _repositionCaret(); updateGutter();
        // 再度 EOF シンボル行での caret を明示ピン留め（reposition後にずれるケース対策） (#664)
        try{
          const txt=String(editor.value||'');
          if (!txt.endsWith('\n')){
            const raw=_splitLinesRaw(); const last=raw.length-1; const lastStr=String(raw[last]||'');
            if (caretRow===last && (lastStr==='' || (lastStr.length===1 && lastStr.charCodeAt(0)===0x2424))){ _setCaret(caretRow, 0); }
          }
        }catch{}
        _suppressInsertSnapshotOnce = true; _setMode('INSERT');
        return;
      }
      // Undo / Redo (NORMAL)
      if (e.key==='u' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _undo(); return; }
      if ((e.key==='r' && e.ctrlKey && !e.metaKey && !e.altKey) || (e.key==='R' && e.ctrlKey && !e.metaKey && !e.altKey)){
        e.preventDefault(); _redo(); return;
      }
      // 'gg' (go to first line) / 'G' (go to last line)
      if (e.key === 'g' && !e.ctrlKey && !e.metaKey){
        e.preventDefault();
        if (_pendingNormal === 'g'){
          // gg detected
          _clearPending();
          _countAcc = null;
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
        _countAcc = null;
        caretRow = Math.max(0, _totalLines()-1);
        // clamp caretCol to EOL of last line to avoid stale column causing b to stall
        try{ const len = _lineLen(caretRow); if (caretCol>len) caretCol=len; }catch{}
        _centerScrolloffOnce = true; ensureScrolloff({centerOnce:true, preferEOFPad:true}); _repositionCaret(); updateGutter();
        // Reinforce: snap scrollTop to exact line grid over a few frames so
        // leading blank / half-line drift cannot persist after a large jump (#423/#424)
        try{
          const snapAndResync = ()=>{
            try{
              const st0 = (editor.scrollTop||0);
              const st1 = Math.round(st0/LINE_HEIGHT)*LINE_HEIGHT;
              if (Math.abs(st1 - st0) > 0.25){ editor.scrollTop = st1; }
              _repositionCaret(); updateGutter();
            }catch{}
          };
          const reinforce = ()=>{ try{ snapAndResync(); }catch{} };
          snapAndResync();
          if (window.requestAnimationFrame){
            requestAnimationFrame(()=>{ reinforce(); requestAnimationFrame(reinforce); });
          }
          setTimeout(reinforce, 0);
          setTimeout(reinforce, 80);
        }catch{}
        return;
      }
      // Repeat last search: n (same direction), N (reverse)
      if ((e.key==='n' || e.key==='N') && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
        // Fallback: if no in-memory last search, seed it from the latest search history entry
        try{
          if (!(_lastSearch && _lastSearch.src)){
            const h = (function(){ try{ return _searchHistory||[]; }catch{ return []; } })();
            const last = h.length ? String(h[h.length-1]||'') : '';
            if (last){
              // Accept '/pat[/flags]' or '?pat[?flags]'
              let m = last.match(/^\/(.*?)(?:\/([A-Za-z]*))?$/);
              let dir = 'fwd';
              if (!m){ m = last.match(/^\?(.*?)(?:\?([A-Za-z]*))?$/); dir = 'bwd'; }
              if (m){
                const pat = String(m[1]||'');
                const flg = String(m[2]||'');
                if (pat){ _lastSearch = { src: pat, flags: flg||'', dir, origDir: dir }; }
              }
            }
          }
        }catch{}
        if (_lastSearch && _lastSearch.src){
          const rev = (e.key==='N');
          // Use preserved original search direction; seed if missing (legacy sessions before origDir addition)
          const origDir = (_lastSearch.origDir ? (_lastSearch.origDir==='bwd'?'bwd':'fwd') : (_lastSearch.dir==='bwd'?'bwd':'fwd'));
          if (!_lastSearch.origDir){ _lastSearch.origDir = origDir; }
          const dir = rev ? (origDir==='fwd'?'bwd':'fwd') : origDir;
          _scrolloffPaused = false; _scrolloffPauseAnchorR = -1; _scrolloffPauseAnchorC = -1;
          const caretOff = (function(){ try{ return _offsetFromRC(caretRow, caretCol)|0; }catch{ return 0; } })();
          // Include current match when unique; otherwise prefer next/prev.
          // Forward: caretOff-1; Backward: caretOff+1 (so previous when available, else wrap to current)
          const fromAdj = (dir==='fwd') ? (caretOff-1) : (caretOff+1);
          // Derive effective case flag dynamically unless explicit i/I was given when recording last search
          const pat = String(_lastSearch.src||'');
          let effI = false;
          if (_lastSearch && _lastSearch.explicitCase === 'i'){ effI = true; }
          else if (_lastSearch && _lastSearch.explicitCase === 'I'){ effI = false; }
          else {
            try{
              const b=currentBuffer(); const ic=!!(b&&b.ignorecase); const sc=!!(b&&b.smartcase);
              if (ic){ if (sc && /[A-Z]/.test(pat)){ effI=false; } else { effI=true; } }
            }catch{}
          }
          let res = _searchFindNext(pat, (effI?'i':''), dir, fromAdj, true);
          // If searching backward and the result is the same occurrence that currently contains the caret,
          // step once more to the previous match so we actually move to the prior candidate (#698).
          if (dir==='bwd' && res && Number.isFinite(res.start)){
            try{
              const curStart = res.start|0;
              const curLen = Math.max(0, res.len|0);
              if (curLen>0){
                if (caretOff >= curStart && caretOff < (curStart + curLen)){
                  const res2 = _searchFindNext(pat, (effI?'i':''), 'bwd', curStart, true);
                  if (res2 && Number.isFinite(res2.start)){
                    res = res2;
                  }
                }
              }
            }catch{}
          }
          // If searching forward and result contains the caret (same occurrence),
          // jump to the next occurrence by starting just after the end of this match.
          if (dir==='fwd' && res && Number.isFinite(res.start)){
            try{
              const curStart = res.start|0;
              const curLen = Math.max(0, res.len|0);
              if (curLen>0){
                if (caretOff >= curStart && caretOff < (curStart + curLen)){
                  const afterEndOff = (curStart + curLen - 1)|0; // +1 will be applied inside _searchFindNext
                  const res2 = _searchFindNext(pat, (effI?'i':''), 'fwd', afterEndOff, true);
                  if (res2 && Number.isFinite(res2.start)){
                    res = res2;
                  }
                }
              }
            }catch{}
          }
          if (res && Number.isFinite(res.start)){
            try{
              const sRC = _rcFromOffset(res.start);
              caretRow = sRC.r; caretCol = sRC.c;
              ensureScrolloff();
              _repositionCaret(); updateGutter(); _renderHlMatchesVisible();
              _lastSearch.dir = dir; // record last movement direction (origDir remains stable)
              // 検索ヒット範囲を一時フラッシュ（yank風）
              try{
                const mlen = Math.max(0, (res.len|0));
                if (mlen > 0){
                  const eRC = _rcFromOffset(res.start + mlen);
                  _flashYanked({r:sRC.r, c:sRC.c}, {r:eRC.r, c:eRC.c});
                }
              }catch{}
            }catch{}
          } else {
            // No matches anywhere in buffer → true no match
            toast('no match'); try{ _triggerVisualBell(); }catch{}
          }
        } else {
          toast('no last search');
        }
        return;
      }
      // Ignore standalone modifier keys to preserve pending sequences and count prefix
      if (e.key==='Shift' || e.key==='Control' || e.key==='Alt' || e.key==='Meta'){
        // Do not clear _countAcc or pending states on pure modifiers
        return;
      }
      // other keys cancel pending sequences
      _clearPending(); _countAcc = null;
      // NORMALモードでは、未対応キーでのテキスト挿入を抑止
      const isPrintable = (e.key.length === 1) && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isEditKey = ['Enter','Tab','Backspace','Delete','Insert'].includes(e.key);
      if (isPrintable || isEditKey){ e.preventDefault(); return; }
    });
      // Global fallback: when focus is not on the editor/cmdinput and no modal/popup is open,
      // route keystrokes to the editor so keys work on startup and after stray focus.
    try{
      const _globalKeyRouter = (e)=>{
        try{
          if (_globalKeyRouting) return;
          // If a modal is open, or enc popup is visible, do not steal
          const modalOpen = !!(_modalOverlay && _modalOverlay.style && _modalOverlay.style.display !== 'none');
          if (modalOpen) return;
          try{ if (typeof _encPopupVisible === 'function' && _encPopupVisible()) return; }catch{}
          const ae = document.activeElement;
          const isEditor = (ae === editor);
          const isCmd = (cmdinput && ae === cmdinput);
          const tag = (ae && ae.tagName ? ae.tagName.toLowerCase() : '');
          const isFormEl = (tag==='input' || tag==='textarea' || (ae && ae.isContentEditable));
            // Route keys to editor when focus is outside editor and not in another form control.
            // INSERT では「印字系/編集系キー」はデフォルト処理に任せるため、フォーカスだけ移してイベントは抑止しない。
            // これにより、最初のキーが消費されて無視される問題を回避。
            if (!isCmd && !isEditor && !isFormEl){
            // Let function keys fall through so tab/help shortcuts work (F1–F9) and allow DevTools (F12)
            if (['F1','F2','F3','F4','F5','F6','F7','F8','F9','F12'].includes(e.key)) return;
            // Avoid hijacking OS/meta shortcuts
            if (e.metaKey) return;
            _globalKeyRouting = true;
            try{
              // ensure subsequent input goes to editor
                try{ editor && editor.focus && editor.focus(); }catch{}
                const isInsert = (_mode === 'INSERT');
                const isPrintable = (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey);
                const isEditKey = ['Enter','Tab','Backspace','Delete','Insert'].includes(e.key);
                if (!isInsert || (!isPrintable && !isEditKey)){
                  // NORMAL/VISUAL あるいは非印字系キー: 既存挙動（合成 keydown + 元イベント抑止）
                  const evInit = {
                    key: e.key,
                    code: (e.code||''),
                    ctrlKey: !!e.ctrlKey,
                    altKey: !!e.altKey,
                    shiftKey: !!e.shiftKey,
                    metaKey: !!e.metaKey,
                    repeat: !!e.repeat,
                    location: (e.location||0),
                    bubbles: true,
                    cancelable: true,
                    composed: true
                  };
                  const ev = new KeyboardEvent('keydown', evInit);
                  setTimeout(()=>{ try{ editor && editor.dispatchEvent && editor.dispatchEvent(ev); }catch{} }, 0);
                  try{ e.preventDefault(); }catch{}
                  try{ e.stopPropagation(); }catch{}
                } else {
                  // INSERT かつ印字/編集キー: フォーカスだけ移し、デフォルト処理でそのまま挿入させる
                  // → preventDefault しない
                }
            } finally {
              _globalKeyRouting = false;
            }
          }
        }catch{}
      };
      // Capture on both window and document to cover environments where one of them swallows events
      window.addEventListener('keydown', _globalKeyRouter, true);
      document.addEventListener('keydown', _globalKeyRouter, true);
    }catch{}
    if (cmdinput){
      // If user clicks into the cmdinput directly (e.g., while in INSERT/VISUAL), treat it as entering CMD
      cmdinput.addEventListener('focus', ()=>{
        try{
          if (_mode !== 'CMD'){
            _preCmdMode = _mode; // remember where we came from
            // If coming from VISUAL via click, capture selection snapshot the same as ':'
            if (_mode === 'VISUAL'){
              _cmdFromVisual = true;
              _visCmdActive = true;
              _visCmdLinewise = !!_visualLinewise;
              _visCmdAnchorR = _visualAnchorR|0; _visCmdAnchorC = _visualAnchorC|0;
              _visCmdCaretR  = caretRow|0;       _visCmdCaretC  = caretCol|0;
            }
            _setMode('CMD');
          }
        }catch{}
      });
      cmdinput.addEventListener('keydown',(e)=>{
        // '/' 押下で選択ディレクトリへ即降下 (#836)
        try{
          if (e.key==='/' && !e.ctrlKey && !e.metaKey && !e.altKey && _filePopupVisible()){
            const listNow = Array.isArray(_fileEntries)? _fileEntries : [];
            const selIdx = Math.max(0, Math.min(listNow.length-1, _fileSel|0));
            const entSel = listNow[selIdx];
            // caret が末尾 & 選択がディレクトリ
            const caretAtEnd = (function(){ try{ return cmdinput.selectionStart === cmdinput.value.length && cmdinput.selectionEnd === cmdinput.value.length; }catch{ return false; } })();
            if (caretAtEnd && entSel && entSel.isDir){
              e.preventDefault(); e.stopPropagation();
              // 降下処理: _fileTypedDirRaw へ追加し一覧再取得
              const q = String(entSel.name||''); if (!q){ return; }
              _fileJustNavAt = Date.now(); _fileReflectGuardUntil = Date.now() + 600; _fileNavRetryCount = 0; _fileSelMuted = false;
              _fileTypedDirRaw = (_fileTypedDirRaw||'') + q + '/';
              // 入力欄更新（末尾スラッシュを残し、その後の自動再描画で選択補完）
              try{ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw); }catch{}
              // 次のレンダで反映をスキップ (末尾スラッシュ消失防止)
              window._fileSkipReflectOnce = true;
              // 子一覧ロード
              try{
                _fileBaseURL = _ensureSlash(new URL(q+'/', _fileBaseURL));
              }catch{}
              _fileEntries=[]; _fileLoading=true; try{ window._fileLastListStartTs=Date.now(); }catch{} _fileFilter='';
              if (_filePopupVisible()) _filePopupRender();
              const reqKeyDir = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
              _listDirEntriesWithQuickRetry(_fileBaseURL)
                .then(list2=>{ try{ const curKey=_ensureSlash(_fileBaseURL)?.toString()||null; if(!reqKeyDir||curKey===reqKeyDir){ _fileEntries=Array.isArray(list2)? list2: []; if(Array.isArray(list2)&&list2.length>0){ _fileStableEntries=list2.slice(); _fileStableBaseKey=curKey; } _fileSel=0; } }catch{} })
                .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); });
              return; // ハンドリング済み
            }
            // 非ディレクトリ/条件外ならそのまま入力継続 (反映スキップして末尾'/'残す)
            window._fileSkipReflectOnce = true;
          }
        }catch{}
        // :b popup 拡張 — 'd' で選択バッファを破棄（:b のままのときのみ有効）
        try{
          if (_bufPopupVisible() && !e.ctrlKey && !e.altKey && !e.metaKey && e.key==='d'){
            const vNow = String(cmdinput.value||'');
            const isBareB = /^\s*:?\s*b$/i.test(vNow);
            if (isBareB){
              e.preventDefault(); e.stopPropagation();
              const list = _bufPopupComputeList();
              if (list && list.length>0){
                const visIdx = Math.max(0, Math.min(list.length-1, _bufSel|0));
                const absIdx = list[visIdx] ? list[visIdx].i : currentIdx;
                const target = (absIdx>=0 && absIdx<buffers.length) ? buffers[absIdx] : null;
                if (target && target.modified){
                  // Modified: popupを閉じ、対象へ切替して :q の確認ダイアログへ
                  try{ _cmdExitAndRestoreView({ forImmediateSwitch:true }); }catch{}
                  setTimeout(()=>{
                    try{ if (absIdx !== currentIdx){ _switchToBuffer(absIdx); } }catch{}
                    setTimeout(()=>{ try{ runCommand(':q'); }catch{} }, 0);
                  }, 0);
                } else if (target){
                  // Unmodified: その場で破棄し :b popup と CMD を継続
                  const prevVal = String(cmdinput && cmdinput.value || '');
                  const keepCmd = (_mode === 'CMD');
                  _closeBufferAt(absIdx);
                  if (keepCmd){
                    try{ _setMode('CMD'); }catch{}
                    try{
                      if (bufpopup){ bufpopup.dataset.kind='buf'; bufpopup.style.display=''; }
                      _layoutBufPopup(); _bufPopupRender();
                      if (cmdinput){
                        cmdinput.value = prevVal;
                        try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
                        // フォーカス喪失対策: 次フレームで再度フォーカス (#587)
                        try{ setTimeout(()=>{ try{ cmdinput.focus(); }catch{} }, 0); }catch{}
                        try{ setTimeout(()=>{ try{ cmdinput.focus(); }catch{} }, 80); }catch{}
                      }
                    }catch{}
                  } else {
                    try{ _bufPopupRender(); }catch{}
                  }
                }
              }
              return;
            }
          }
        }catch{}
        // HOME キー拡張 (#577): :e 入力中はファイル名先頭へ/':'先頭へトグル
        if (e.key==='Home' && !e.ctrlKey && !e.metaKey && !e.altKey){
          try{
            const v = String(cmdinput.value||'');
            // ":e " の後に1文字以上ある場合に適用
            const m = v.match(/^(\s*:?\s*e\s+)(.+)$/i);
            if (m){
              const head = m[1];
              const tail = m[2];
              if (tail && tail.length>0){
                const tailStart = head.length;
                const sel = cmdinput.selectionStart|0;
                if (sel > tailStart){
                  e.preventDefault(); e.stopPropagation();
                  cmdinput.setSelectionRange(tailStart, tailStart);
                  return;
                } else if (sel === tailStart){
                  e.preventDefault(); e.stopPropagation();
                  const colonPos = v.indexOf(':');
                  const to = (colonPos>=0 ? colonPos : 0);
                  cmdinput.setSelectionRange(to, to);
                  return;
                }
              }
            }
          }catch{}
          // それ以外は既定動作
        }
        if (e.key==='Enter'){
          e.preventDefault(); e.stopPropagation();
          _incPrevHide();
          const raw = cmdinput.value.trim();
          // If this is a search (/ or ?), push to search history (not cmd history)
          try{
            const normCmd = (raw.startsWith(':')?raw:(':'+raw));
            if (/^:\s*[\/?].+/.test(normCmd)){
              // store normalized '/...' or '?...' form
              const store = normCmd.replace(/^:\s*/, '');
              _searchHistoryMaybePush(store);
              // Delegate to runCommand and exit early
              runCommand(normCmd);
              cmdinput.value = '';
              // VISUAL からの CMD だった場合はここで VISUAL を終了（オーバレイもクリア）
              if (_cmdFromVisual){ try{ _exitVisual(); }catch{} _cmdFromVisual=false; _visCmdActive=false; try{ _visSelClear(); }catch{} }
              _setMode('NORMAL');
              _bufPopupHide();
              setTimeout(()=>editor.focus(), 0);
              return;
            }
          }catch{}
          // Ensure :e <arg> always records into command history regardless of popup visibility (#641)
          try{
            const vNow = String(cmdinput.value||'');
            // Ignore :e! (reload); handle only :e with non-empty argument
            if (!/^\s*:e\s*!\s*$/i.test(vNow)){
              const mPre = vNow.match(/^\s*:?(?:e\b)\s*(.*)$/i);
              const afterPre = (mPre && mPre[1]) ? mPre[1].trim() : '';
              if (afterPre){
                const histPre = ':e ' + _collapseDotDotPath(afterPre.replace(/\\/g,'/'));
                _cmdHistoryMaybePush(histPre);
              }
            }
          }catch{}
          // popup 非表示かつ先頭が :e のときは、Enter で :e の動作を確定。
          // ただし ':e!'（および ':e !'）はファイル名ではなく再読込として runCommand に委譲する。
          try{
            if (!_filePopupVisible()){
              const vNow = String(cmdinput.value||'');
              // :e!（空白許容）→ runCommand へ委譲
              if (/^\s*:e\s*!\s*$/i.test(vNow)){
                const norm = vNow.trim();
                _cmdHistoryMaybePush(norm);
                runCommand(norm);
                cmdinput.value=''; _setMode('NORMAL'); _bufPopupHide(); setTimeout(()=>editor.focus(),0);
                return;
              }
              const m = vNow.match(/^\s*:?(?:e\b)\s*(.*)$/i);
              if (m){
                const after = (m[1]||'').trim();
                if (after){
                  // 入力後続を使って :e を実行（直接読み込み or 新規）
                  const base = _currentDirBase();
                  // 履歴は実際の最終文字列で
                  try{ const hist=':e ' + _collapseDotDotPath(after.replace(/\\/g,'/')); _cmdHistoryMaybePush(hist); }catch{}
                  (async()=>{
                    const ok = await _loadFromPath(after, base, { silentOnFail:true, mode:'new' });
                    if (!ok){ let finalURL = null; try{ finalURL = new URL(after, base).toString(); }catch{} _addBuffer({ name: after, path: finalURL, text: '', modified:false }); _switchToBuffer(buffers.length-1); }
                    cmdinput.value=''; _setMode('NORMAL'); _bufPopupHide(); setTimeout(()=>editor.focus(),0);
                  })();
                  return;
                }
              }
            }
          }catch{}
          // まず、:e のファイルポップアップが表示中なら Enter はポップアップに対する確定/ドリルダウンとして扱う
          if (_filePopupVisible()){
            // 追加ガード (#576): 現在の入力フィルタ末尾が禁則文字を含む名前なら即ブロック（新規生成も不可）
            try{
              const parsedPre = _eParseInput(cmdinput.value);
              const tailPre = String(parsedPre && parsedPre.filter || '').trim();
              if (tailPre && _isNtfsIllegalName(tailPre)){
                toast('Windows(NTFS)では無効な名前です', 1800); try{ _triggerVisualBell && _triggerVisualBell(); }catch{};
                return;
              }
            }catch{}
            // #348: 入力欄が空白または末尾が区切り文字('/', '\\', ':')のときは Enter で何もしない
            try{
              const vNow0 = String(cmdinput.value||'');
              const mTail0 = vNow0.match(/^\s*:?\s*e\s*(.*)$/i);
              const tail0 = (mTail0? mTail0[1] : '');
              const lastNonSpace = (function(s){
                for (let i=s.length-1;i>=0;i--){ const ch=s[i]; if (ch!==" " && ch!=="\t" && ch!=="\r" && ch!=="\n"){ return ch; } }
                return '';
              })(tail0);
              if (!lastNonSpace || lastNonSpace==='/' || lastNonSpace==='\\' || lastNonSpace===':'){
                return;
              }
            }catch{}
            // #164: 入力欄が '/' で終わっていない場合は、入力文字列を優先して確定
            try{
              const vNow = cmdinput.value;
              const parsed = _eParseInput(vNow);
              const typed = String(parsed.typedDirRaw||'');
              const filt = String(parsed.filter||'');
              const endsWithSlash = (filt.length === 0);
              // ディレクトリ移動直後の短期は、末尾が'/'（=filter空）なら Enter は何もしない（#344, #347）
              try{ if (Date.now() < (_fileReflectGuardUntil||0)) { if (endsWithSlash) return; } }catch{}
              // 追加仕様: filter が空 (=末尾スラッシュ想定) でも選択中がディレクトリならそのまま降下（二段階降下の第1段）
              if (endsWithSlash){
                try{
                  const listNow = Array.isArray(_fileEntries)? _fileEntries: [];
                  const selIdx = Math.max(0, Math.min(listNow.length-1, _fileSel|0));
                  const entSel = listNow[selIdx];
                  if (entSel && entSel.isDir){
                    const q = String(entSel.name||'');
                    if (!q){ return; }
                    // 二段階降下の第1段: _fileTypedDirRaw に追加して子一覧取得後、先頭ディレクトリ名をステージ
                    _fileJustNavAt = Date.now(); _fileReflectGuardUntil = Date.now() + 500; _fileNavRetryCount = 0; _fileSelMuted = false;
                    _fileTypedDirRaw = (_fileTypedDirRaw||'') + q + '/';
                            if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw); }
                    const baseAfter = _fileBaseURL = _ensureSlash(new URL(q+'/', _fileBaseURL));
                    _fileEntries = []; _fileLoading = true; try{ window._fileLastListStartTs = Date.now(); }catch{} _fileFilter=''; if (_filePopupVisible()) _filePopupRender();
                    const reqKeyDir = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
                    _listDirEntriesWithQuickRetry(_fileBaseURL)
                      .then(list2=>{
                        try{
                          const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                          if (!reqKeyDir || curKey===reqKeyDir){
                            _fileEntries = Array.isArray(list2)? list2: [];
                            if (Array.isArray(list2) && list2.length>0){ _fileStableEntries=list2.slice(); _fileStableBaseKey=curKey; }
                                    // 子一覧到着後の自動補完は autoprefill に委譲 (#824)
                                    try{ _fileAutoPrefillOnNextRender = { base: String(_fileBaseURL), typed: String(_fileTypedDirRaw||'') }; }catch{}
                                    // 選択は既定の 0 を維持（ディレクトリ優先並びなら最初の項目）
                                    _fileSel = Math.max(0, Math.min(_fileEntries.length-1, _fileSel));
                          }
                        }catch{}
                      })
                      .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); });
                    return;
                  }
                }catch{}
              }
              if (!endsWithSlash){
                const q = filt.trim();
                // フィルタ末尾が禁則名なら一切確定しない (#576)
                try{ if (q && _isNtfsIllegalName(q)){ toast('Windows(NTFS)では無効な名前です', 1800); _triggerVisualBell && _triggerVisualBell(); return; } }catch{}
                if (q === '..'){
                  // 親ディレクトリへ（入力優先の Enter でも有効）
                  try{
                    // 直後ガード
                    _fileReflectGuardUntil = Date.now() + 700;
                    const parent = _ensureSlash(new URL('../', _fileBaseURL));
                    // 直前ディレクトリ名は baseURL から頑健に取得
                    let prevSeg = '';
                    try{
                      const b = _ensureSlash(_fileBaseURL);
                      let p = decodeURIComponent((b && b.pathname) || '');
                      p = p.replace(/\/+$/,'');
                      const i2 = p.lastIndexOf('/');
                      prevSeg = (i2>=0 ? p.slice(i2+1) : p);
                    }catch{}
                    // 入力表示上の typed は現在の _fileTypedDirRaw から 1 段戻す
                    let s = (_fileTypedDirRaw||'').replace(/\\/g,'/').replace(/\/+$/,'');
                    const idx = s.lastIndexOf('/');
                    let newTyped = (idx>=0 ? s.slice(0, idx+1) : '');
                    if (!newTyped){ newTyped = _inputDirRawFromURL(parent); }
                    // 親一覧で直前セグメントをハイライトするため保持
                    _filePostSelectName = prevSeg || null;
                    _fileBaseURL = parent; _fileTypedDirRaw = newTyped; _fileFilter = ''; _fileSelMuted = false;
                    // 仕様変更(#581): 親へ移動した直後はフィルタを空にする（入力欄は親ディレクトリまで）
                    try{
                      if (cmdinput){
                        cmdinput.value = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||''));
                        const pos=(cmdinput.value||'').length; try{ cmdinput.setSelectionRange(pos,pos); }catch{}
                        try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
                      }
                    }catch{}
                    const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
                    _listDirEntriesWithQuickRetry(_fileBaseURL).then(list2=>{
                      try{
                        const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                        if (!reqKey || curKey===reqKey){
                          _fileEntries = Array.isArray(list2) ? list2 : [];
                          if (Array.isArray(list2) && list2.length>0){ _fileStableEntries = list2.slice(); _fileStableBaseKey = curKey; }
                          // Select previously-visited directory only (avoid accidentally selecting a file with the same name)
                          let sel = 0; const idx2 = _fileEntries.findIndex(e=> e && e.isDir && e.name===prevSeg); if (idx2>=0) sel = idx2 + (_filePopupNoUp?0:1); _fileSel = sel;
                        }
                      }catch{}
                      _filePopupRender();
                    }).finally(()=>{ /* #348: listing completion should not reflect to input */ });
                    return;
                  }catch{}
                }
                // ディレクトリ/ファイル判定は現在の一覧で判定
                try{
                  let caseSensitive = false;
                  try{ const b = _ensureSlash(_fileBaseURL); if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost') caseSensitive = true; }catch{}
                  const eq = (a,b)=> caseSensitive ? (a===b) : (String(a||'').toLowerCase()===String(b||'').toLowerCase());
                  const ent = (_fileEntries||[]).find(e=> e && eq(String(e.name||''), q));
                  if (ent && ent.isDir){
                      // 二段階降下: 1) 末尾に '/' が無い状態で Enter → そのディレクトリへ降下し子一覧取得し、子の先頭ディレクトリ名を追記（末尾スラッシュ無し）
                      try{ if (_isNtfsIllegalName(q)){ toast('Windows(NTFS)では無効な名前です',1800); _triggerVisualBell && _triggerVisualBell(); return; } }catch{}
                      _fileJustNavAt = Date.now(); _fileReflectGuardUntil = Date.now() + 500; _fileNavRetryCount = 0; _fileSelMuted = false;
                      _fileTypedDirRaw = (_fileTypedDirRaw||'') + q + '/';
                      // 入力欄はベースパスのみ更新（補完は後段 autoprefill）
                      if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw); }
                      // 非同期で子をロード→先頭ディレクトリがあれば追記（スラッシュ無しで選択状態）
                      const baseAfter = _fileBaseURL = _ensureSlash(new URL(q+'/', _fileBaseURL));
                      _fileEntries = []; _fileLoading = true; try{ window._fileLastListStartTs = Date.now(); }catch{} _fileFilter=''; if (_filePopupVisible()) _filePopupRender();
                      const reqKeyDir = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
                      _listDirEntriesWithQuickRetry(_fileBaseURL)
                        .then(list2=>{
                          try{
                            const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                            if (!reqKeyDir || curKey===reqKeyDir){
                              _fileEntries = Array.isArray(list2)? list2: [];
                              if (Array.isArray(list2) && list2.length>0){ _fileStableEntries=list2.slice(); _fileStableBaseKey=curKey; }
                              // 子一覧到着後の自動補完は autoprefill に委譲 (#824)
                              try{ _fileAutoPrefillOnNextRender = { base: String(_fileBaseURL), typed: String(_fileTypedDirRaw||'') }; }catch{}
                              _fileSel = 0; // 一覧先頭を選択
                            }
                          }catch{}
                        })
                        .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); });
                      return;
                  }
                  if (ent && !ent.isDir){
                    // ファイルを開く（確定）
                    try{ if (_isNtfsIllegalName(q)){ toast('Windows(NTFS)では無効な名前です',1800); _triggerVisualBell && _triggerVisualBell(); return; } }catch{}
                    _loadFromPath(ent.url, null, {mode:'new'});
                    // 履歴には URL 末尾から復元した名前を優先して入れる
                    try{
                      let nm = String(ent && ent.name || '');
                      try{ const u=new URL(String(ent&&ent.url||'')); const parts=String(u.pathname||'').split('/').filter(Boolean); const dec=decodeURIComponent(parts[parts.length-1]||''); if (dec) nm=dec; }catch{}
                      const hist = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + nm);
                      _cmdHistoryMaybePush(hist);
                    }catch{}
                    _filePopupHide(); _bufPopupHide(); _setMode('NORMAL'); cmdinput.value=''; setTimeout(()=>editor.focus(), 0);
                    return;
                  }
                  // 追加仕様(#176): 正確一致が無くても、先頭一致候補が1つだけならそれを確定対象にする
                  const startsWith = (name,q2)=> caseSensitive ? name.startsWith(q2) : name.toLowerCase().startsWith(q2.toLowerCase());
                  let usedOne = false;
                  const cand = (_fileEntries||[]).filter(e=> e && !e._up && startsWith(String(e.name||''), q));
                  const tryOpenEntry = (one)=>{
                    if (!one) return false;
                    if (one.isDir){
                      // ドリルダウン（補完専用）
                      try{ if (_isNtfsIllegalName(String(one.name||''))){ toast('Windows(NTFS)では無効な名前です',1800); _triggerVisualBell && _triggerVisualBell(); return false; } }catch{}
                      _fileJustNavAt = Date.now(); _fileReflectGuardUntil = Date.now() + 700; _fileNavRetryCount = 0; _fileFilter = ''; _fileSelMuted = false;
                      _fileTypedDirRaw = (_fileTypedDirRaw||'') + String(one.name||'') + '/';
                        if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw); try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {} }
                      return true;
                    } else {
                      try{ if (_isNtfsIllegalName(String(one.name||''))){ toast('Windows(NTFS)では無効な名前です',1800); _triggerVisualBell && _triggerVisualBell(); return false; } }catch{}
                      _loadFromPath(one.url, null, {mode:'new'});
                      try{
                        let nm = String(one && one.name || '');
                        try{ const u=new URL(String(one&&one.url||'')); const parts=String(u.pathname||'').split('/').filter(Boolean); const dec=decodeURIComponent(parts[parts.length-1]||''); if (dec) nm=dec; }catch{}
                        const hist=':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + nm); _cmdHistoryMaybePush(hist);
                      }catch{}
                      _filePopupHide(); _bufPopupHide(); _setMode('NORMAL'); cmdinput.value=''; setTimeout(()=>editor.focus(), 0);
                      return true;
                    }
                  };
                  if (cand.length === 1){
                    if (tryOpenEntry(cand[0])) return;
                  }
                  // 予防的なフォールバック: 表示リスト側からの startsWith 判定
                  try{
                    const vis = _filePopupComputeList().filter(e=> e && !e._up && startsWith(String(e.name||''), q));
                    if (vis.length === 1){ if (tryOpenEntry(vis[0])) return; }
                  }catch{}
                  // さらに選択中の項目が startsWith に合致しファイルならそれを優先確定
                  try{
                    const listNow = _filePopupComputeList();
                    const selNow = Math.max(0, Math.min(listNow.length-1, _fileSel));
                    const itNow = listNow[selNow];
                    if (itNow && !itNow.isDir && !itNow._up && startsWith(String(itNow.name||''), q)){
                      if (tryOpenEntry(itNow)) return;
                    }
                  }catch{}
                  // 未一致 → 入力優先で開く（無ければ新規）
                  // ただし一覧ローディング中は誤確定を防ぐため保留
                  if (_fileLoading){ return; }
                  (async()=>{
                    // 入力直接確定時も共通禁止名判定を適用 (#862)
                    try{ if (_isNtfsProhibitedNameAny(q, null)){ toast('Windows(NTFS)では無効な名前のため開けません',1800); _triggerVisualBell && _triggerVisualBell(); return; } }catch{}
                    const ok = await _loadFromPath(q, _fileBaseURL, { silentOnFail:true, mode:'new' });
                    if (!ok){
                      let finalURL = null;
                      try{ finalURL = new URL(q, _fileBaseURL).toString(); }catch{}
                      _addBuffer({ name: q, path: finalURL, text: '', modified:false });
                      _switchToBuffer(buffers.length-1);
                    }
                    _filePopupHide(); _bufPopupHide(); _setMode('NORMAL'); cmdinput.value=''; setTimeout(()=>editor.focus(), 0);
                  })();
                  return;
                }catch{}
              }
            }catch{}
            const list = _filePopupComputeList();
            if (list.length === 0){
              // 候補無し
              const q = (_fileFilter||'').trim();
              if (!q){
                // 入力が空 → なにもしない（ポップアップ維持）
                return;
              }
              // 無効名(禁則文字含む)は新規作成も読み込みも禁止 (#575)
              try{
                const rawName = q;
                if (_isNtfsIllegalName(rawName)){
                  toast('Windows(NTFS)では無効な名前です', 1800); try{ _triggerVisualBell && _triggerVisualBell(); }catch{}
                  return; // ポップアップ維持・確定しない
                }
              }catch{}
              // 以前は UNC 配下の部分入力を Enter でブロックしていたが、
              // 「補完→入力ハンドラ→確定」に一本化するため撤去。ここで確定を試みる。
              // '..' を単独入力→ 親ディレクトリへ
              if (q === '..'){
                try{
                  const parent = _ensureSlash(new URL('../', _fileBaseURL));
                  // 直前ディレクトリ名は baseURL から頑健に取得
                  let prevSeg = '';
                  try{
                    const b = _ensureSlash(_fileBaseURL);
                    let p = decodeURIComponent((b && b.pathname) || '');
                    p = p.replace(/\/+$/,'');
                    const i2 = p.lastIndexOf('/');
                    prevSeg = (i2>=0 ? p.slice(i2+1) : p);
                  }catch{}
                  // 入力表示上の typed は現在の _fileTypedDirRaw から 1 段戻す
                  let s = (_fileTypedDirRaw||'').replace(/\\/g,'/').replace(/\/+$/,'');
                  const idx = s.lastIndexOf('/');
                  let newTyped = (idx>=0 ? s.slice(0, idx+1) : '');
                  if (!newTyped){ newTyped = _inputDirRawFromURL(parent); }
                  // 親一覧で直前セグメントをハイライトするため保持（Enter専用経路も網羅）
                  _filePostSelectName = prevSeg || null;
                  _fileBaseURL = parent; _fileTypedDirRaw = newTyped; _fileFilter = '';
                  const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
                  _listDirEntriesWithQuickRetry(_fileBaseURL).then(list2=>{
                    try{
                      const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                      if (!reqKey || curKey===reqKey){
                        _fileEntries = Array.isArray(list2) ? list2 : [];
                        if (Array.isArray(list2) && list2.length>0){ _fileStableEntries = list2.slice(); _fileStableBaseKey = curKey; }
                        // Select the previous directory only to avoid landing on a file with the same name
                        let sel = 0; const idx2 = _fileEntries.findIndex(e=> e && e.isDir && e.name===prevSeg); if (idx2>=0) sel = idx2 + (_filePopupNoUp?0:1); _fileSel = sel;
                      }
                    }catch{}
                    _filePopupRender();
                  }).finally(()=>{ /* #348: listing completion should not reflect to input */ });
                  return;
                }catch{}
              }
              // 入力がある → 直接読み込みを試み、失敗したら新規作成
              // ただし一覧ローディング中は誤確定を防ぐため保留
              if (_fileLoading){ return; }
              (async()=>{
                // 候補なし確定時も共通禁止名判定 (#862)
                try{ if (_isNtfsProhibitedNameAny(q, null)){ toast('Windows(NTFS)では無効な名前のため開けません',1800); _triggerVisualBell && _triggerVisualBell(); return; } }catch{}
                const ok = await _loadFromPath(q, _fileBaseURL, { silentOnFail:true, mode:'new' });
                if (!ok){
                  let finalURL = null;
                  try{ finalURL = new URL(q, _fileBaseURL).toString(); }catch{}
                  _addBuffer({ name: q, path: finalURL, text: '', modified:false });
                  _switchToBuffer(buffers.length-1);
                }
                try{ _cmdHistoryMaybePush(cmdinput.value); }catch{}
                try{ const hist=':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + String(q)); _cmdHistoryMaybePush(hist); }catch{}
                _filePopupHide();
                _bufPopupHide();
                _setMode('NORMAL');
                cmdinput.value = '';
                setTimeout(()=>editor.focus(), 0);
              })();
              return;
            } else {
              const sel = Math.max(0, Math.min(list.length-1, _fileSel));
              const it = list[sel];
              // 無効名（WSLのNTFS非許容名など）はEnterでも開かず、トースト+ベルのみでポップアップ継続
              if (it && it._disabled){ try{ toast('Windows(NTFS)では無効な名前のため開けません', 1800); }catch{} try{ _triggerVisualBell && _triggerVisualBell(); }catch{} return; }
              if (it.isDir){
                // ディレクトリは補完専用: 入力欄更新→input ハンドラに統一委譲
                try{
                  const nextBase = _ensureSlash(new URL(it.url, _fileBaseURL));
                  _fileJustNavAt = Date.now(); _fileReflectGuardUntil = Date.now() + 700;
                  _fileNavRetryCount = 0; // 遷移直後の短期リトライを毎回リセット
                  _fileFilter = '';
                  if (it._up){
                    // 親へ戻るとき: 直前セグメントは現在の baseURL から取得（頑健）
                    let sTyped = (_fileTypedDirRaw||'').replace(/\\/g,'/').replace(/\/+$/,'');
                    const idxTyped = sTyped.lastIndexOf('/');
                    _fileTypedDirRaw = (idxTyped>=0? sTyped.slice(0,idxTyped+1) : '');
                    let prevSeg = '';
                    try{
                      const b = _ensureSlash(_fileBaseURL);
                      let p = decodeURIComponent((b && b.pathname) || '');
                      p = p.replace(/\/+$/,'');
                      const i2 = p.lastIndexOf('/');
                      prevSeg = (i2>=0 ? p.slice(i2+1) : p);
                    }catch{}
                    _filePostSelectName = prevSeg || null;
                    // ここで基点を確実に親へ更新（入力解析に依存しない）
                    _fileBaseURL = nextBase;
                    // 即座にローディングへ切り替え（旧一覧が残らないように）
                    _fileEntries = []; _fileSel = 0; _fileLoading = true; if (_filePopupVisible()) _filePopupRender();
                    if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw + prevSeg); }
                  } else {
                    // 子へ進む: ホスト直下へ進む場合は //host/ を直接設定
                    try{ const nb = nextBase; if (nb && _isHostRoot(nb)){ _fileTypedDirRaw = '//' + nb.host + '/'; }
                    else { _fileTypedDirRaw = (_fileTypedDirRaw||'') + it.name + '/'; } }catch{ _fileTypedDirRaw = (_fileTypedDirRaw||'') + it.name + '/'; }
                    if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw); }
                    // 基点も進める（入力解析待ちで遅延しないように）
                    _fileBaseURL = nextBase;
                    // ".." 自動補完撤去 (#856): 降下後はそのまま保持し不要な親ジャンプ誘発を防止
                    try{ console.debug('[dir-enter child descend]', { base: String(_fileBaseURL), typed:_fileTypedDirRaw }); }catch{}
                    // Enter遷移では非同期列挙を明示的に開始（クリックと同等のタイミング）
                    try{
                      const baseNowEnter = _ensureSlash(_fileBaseURL);
                      try{ _filePopupNoUp = !!(baseNowEnter && (_isHostRoot(baseNowEnter) || _isUncShareRoot(baseNowEnter))); }catch{}
                      const reqKeyEnter = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
                      _listDirEntriesWithQuickRetry(_fileBaseURL)
                        .then(listEnter=>{
                          try{
                            const curKeyEnter = _ensureSlash(_fileBaseURL)?.toString()||null;
                            if (!reqKeyEnter || curKeyEnter===reqKeyEnter){
                              _fileEntries = Array.isArray(listEnter) ? listEnter : [];
                              if (Array.isArray(listEnter) && listEnter.length>0){ _fileStableEntries = listEnter.slice(); _fileStableBaseKey = curKeyEnter; }
                              // 先頭選択（".." 抑止条件考慮）
                              try{
                                const suppressUpFinal = (!!_filePopupNoUp) || (baseNowEnter && (_isHostRoot(baseNowEnter) || _isUncShareRoot(baseNowEnter)));
                                _fileSel = (suppressUpFinal?0:1);
                              }catch{}
                                        // ".." 強制反映撤去 (#856)
                            }
                          }catch{}
                        })
                        .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); });
                    }catch{}
                    // 即座にローディングへ切り替え
                    _fileEntries = []; _fileSel = 0; _fileLoading = true; if (_filePopupVisible()) _filePopupRender();
                  }
                  _fileNavPendingKey = null;
                  if (cmdinput){ try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {} }
                  // Enter遷移直後: inputイベントで値が再解析されて '..' が消えるケースがあるため再度強制付与
                  try{
                    if (!it._up){
                      const baseNowLate = _ensureSlash(_fileBaseURL);
                      const suppressUpLate = (!!_filePopupNoUp) || (baseNowLate && (_isHostRoot(baseNowLate) || _isUncShareRoot(baseNowLate)));
                      if (!suppressUpLate && cmdinput){
                        // 既に '..' が末尾に無ければ付与
                        const want = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + '..');
                        if (cmdinput.value !== want){
                          cmdinput.value = want;
                          // do not force filter; just reflect text
                          try{ const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); }catch{}
                        }
                      }
                    }
                  }catch{}
                  return; // ポップアップ維持
                }catch{}
              } else {
                // 無効ファイル名は開かない（保険。通常 _disabled で捕捉済）
                try{ const bn=_bestEntryName(it); if (_isNtfsIllegalName(bn)){ toast('Windows(NTFS)では無効な名前のため開けません', 1800); _triggerVisualBell && _triggerVisualBell(); return; } }catch{}
                _loadFromPath(it.url, null, {mode:'new'});
              }
            }
            _filePopupHide();
            _bufPopupHide();
            try{
              let nm = String(it && it.name || '');
              try{ const u=new URL(String(it&&it.url||'')); const parts=String(u.pathname||'').split('/').filter(Boolean); const dec=decodeURIComponent(parts[parts.length-1]||''); if (dec) nm=dec; }catch{}
              const hist=':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + nm); _cmdHistoryMaybePush(hist);
            }catch{}
            _setMode('NORMAL');
            cmdinput.value = '';
            setTimeout(()=>editor.focus(), 0);
            return;
          }
          // bare ":e"（スペースなし）は何もしない。":e!" は通常どおり runCommand に流す。
          // 先頭コロンの重複は不正扱い（"::e" などはヒットさせない）
          if (/^:?\s*e\s*$/i.test(raw)){
            return; // 入力は維持し CMD 継続
          }
          // 明示的無効コマンド（::e）にトーストを出す（CMD 継続）
          if (/^\s*:{2,}\s*e\b/i.test(raw)){
            toast('invalid command'); try{ _triggerVisualBell(); }catch{}
            return;
          }
          if (raw){
            // Push to history before clearing (store what user sees)
            _cmdHistoryMaybePush(cmdinput.value);
            runCommand(raw.startsWith(':')?raw:(':'+raw));
          }
          cmdinput.value = '';
          // VISUAL からの CMD だった場合はここで VISUAL を終了（オーバレイもクリア）
          if (_cmdFromVisual){ try{ _exitVisual(); }catch{} _cmdFromVisual=false; _visCmdActive=false; try{ _visSelClear(); }catch{} }
          _setMode('NORMAL');
          _bufPopupHide();
          // Enter の keyup が editor に落ちないよう、フォーカス復帰を遅延
          setTimeout(()=>editor.focus(), 0);
        } else if (_isEsc(e)){
          e.preventDefault(); e.stopPropagation();
          _incPrevHide();
          // reset history browsing state on cancel
          try{ _cmdHistBrowsing=false; _cmdHistIndex=_cmdHistory.length; _cmdHistTemp=''; }catch{}
          try{ _searchHistBrowsing=false; _searchHistIndex=_searchHistory.length; _searchHistTemp=''; }catch{}
          // CMD 終了時の一瞬のスクロール揺れ（EOF 付近へ飛ぶ）を抑止するガードと座標再適用
          let st = editor.scrollTop, cr = caretRow, cc = caretCol;
          let selS = 0, selE = 0; try{ selS = editor.selectionStart; selE = editor.selectionEnd; }catch{}
          const fromVis = !!_cmdFromVisual;
          // Esc キャンセル時: VISUAL 由来であれば VISUAL に復帰（選択も復元）
          // それ以外は後段のモード復帰ロジックに委譲
          let restoredVisual = false;
          if (fromVis){
            try{
              // restore caret to the visual caret saved on ':' entry
              if (Number.isFinite(_visCmdCaretR) && Number.isFinite(_visCmdCaretC)){
                caretRow = _visCmdCaretR|0; caretCol = _visCmdCaretC|0;
              }
              // re-enter VISUAL with saved anchor and linewise flag
              _visualActive = true; _visualLinewise = !!_visCmdLinewise;
              _visualAnchorR = (_visCmdAnchorR|0); _visualAnchorC = (_visCmdAnchorC|0);
              _setMode('VISUAL');
              _updateVisualSelection();
              try{ _renderVisSelOverlay(); }catch{}
              restoredVisual = true;
            }catch{}
            // clear cmd-from-visual markers regardless
            _cmdFromVisual = false; _visCmdActive = false; try{ _visSelClear(); }catch{}
          }
          _scrollGuardUntil = Date.now() + 900; // 短期ガード
          const restoreView = ()=>{
            try{
              // VISUAL 由来の CMD を Esc で抜けたときは、選択の復元はしない
              if (!fromVis){ try{ editor.setSelectionRange(selS, selE); }catch{} }
              caretRow = cr; caretCol = cc; editor.scrollTop = st;
              _repositionCaret(); updateGutter();
            }catch{}
          };
          // :e 入力をキャンセルした際、基点をオープン時点へ復元（#174）
          try{
            if (_filePopupVisible()){
              if (_fileStartBaseURL){ _fileBaseURL = _ensureSlash(_fileStartBaseURL); }
              else { _fileBaseURL = _currentDirBase(); }
              // 次回の引数なし :e はこの復元基点から開始（親にずれないようにする）
              try{ _fileNextStartBaseURL = _ensureSlash(_fileBaseURL); }catch{ _fileNextStartBaseURL = _fileBaseURL; }
            }
          }catch{}
          _fileStartBaseURL = null;
          _fileTypedDirRaw = '';
          _fileFilter = '';
          cmdinput.value = '';
          // Decide which mode to return to on cancel
          if (!restoredVisual){
            const target = (_preCmdMode==='INSERT' || _preCmdMode==='VISUAL' || _preCmdMode==='NORMAL') ? _preCmdMode : 'NORMAL';
            if (target === 'INSERT'){
              // CancelでINSERTへ戻す際はスナップショットを抑制（余計なUNDO段を作らない）
              _suppressInsertSnapshotOnce = true;
            }
            _setMode(target);
          }
          // Esc 直後は中抜きから塗りキャレットへ戻す（見た目の一貫性）
          try{ _hideCursor(); }catch{}
          _bufPopupHide(); _filePopupHide();
          setTimeout(()=>{ try{ editor.focus(); restoreView(); if (window.requestAnimationFrame){ requestAnimationFrame(()=>restoreView()); } setTimeout(restoreView, 120); }catch{} }, 0);
        } else if (e.key==='Tab'){
          // :e ファイルポップアップ中の Tab の仕様変更
          if (_filePopupVisible()){
            e.preventDefault(); e.stopPropagation();
            try{
              const vNow = cmdinput.value;
              const parsed = _eParseInput(vNow);
              const typed = String(parsed.typedDirRaw||'');
              const filt = String(parsed.filter||'');
              const list = _filePopupComputeList();
              const sel = Math.max(0, Math.min(list.length-1, _fileSel));
              const it = list[sel];
              // 末尾スラ判定は「直近セグメントが空（=filter空）」で判定
              const endsWithSlash = (filt.length === 0);
              if (endsWithSlash){
                // '..' 上での Tab は ".." を入力欄に挿入し、ナビゲーションは行わない
                try{
                  if (it && it._up){
                    const next = ':e ' + String(typed) + '..';
                    cmdinput.value = next;
                    try{ const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); }catch{}
                    try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
                    return;
                  }
                }catch{}
                // 例外: '../' 以外の候補が1つだけ（または'../'ともう1つだけ）のとき、その候補名まで補完
                // 仕様 #163: 末尾が '/' のときに ".." 上での Tab = Enter 相当は廃止。
                // よって、候補が単一のときのみ補完し、それ以外は何もしない。
                try{
                  const nonUp = list.filter(e=> e && !e._up);
                  if (nonUp.length === 1){
                    const only = nonUp[0];
                    const next = ':e ' + _collapseDotDotPath(typed + String(only.name||''));
                    cmdinput.value = next;
                    try{ const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); }catch{}
                    try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
                    return;
                  }
                }catch{}
                // 候補が '../' のみ、または '../' 以外が複数のときは Tab は何もしない
                return;
              }
              // 末尾が '/' でない → 現在セグメントに対して共通プレフィックス補完
              // 大小文字感度: wsl.localhost は区別、それ以外は非区別
              let caseSensitive = false;
              try{ const b = _ensureSlash(_fileBaseURL); if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost') caseSensitive = true; }catch{}
              const startsWith = (name, q)=> caseSensitive ? name.startsWith(q) : name.toLowerCase().startsWith(q.toLowerCase());
              const names = (_fileEntries||[]).map(e=> String(e&&e.name||'')).filter(n=> n && startsWith(n, filt));
              if (!filt || names.length===0){ return; }
              // 最長共通接頭辞
              const lcp = (arr)=>{
                if (arr.length===0) return '';
                let prefix = arr[0];
                for (let i=1;i<arr.length;i++){
                  let j=0; const s = arr[i];
                  const a = caseSensitive ? prefix : prefix.toLowerCase();
                  const b = caseSensitive ? s : s.toLowerCase();
                  while (j<Math.min(a.length,b.length) && a[j]===b[j]) j++;
                  prefix = prefix.slice(0, j);
                  if (!prefix) break;
                }
                return prefix;
              };
              const common = lcp(names);
              if (common && common.length > filt.length){
                const next = ':e ' + _collapseDotDotPath(typed + common);
                cmdinput.value = next;
                try{ const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); }catch{}
                // 反映後は input ハンドラへ委譲（一覧はフィルタしないが選択が移動する）
                try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
              }
            }catch{}
            return;
          } else if (_bufPopupVisible()){
            // :b ポップアップ表示中の Tab は何もしない（フォーカス移動抑止）
            e.preventDefault(); e.stopPropagation();
            return;
          } else {
            // popup 非表示かつ先頭が :e のときは、Tab でポップアップを表示（補完はしない）
            try{
              const val = String(cmdinput.value||'');
              if (/^\s*:?(?:e\b)/i.test(val)){
                e.preventDefault(); e.stopPropagation();
                // 既入力があるかを判定（":e <path>" 形式）→ 末尾 '/' 無しなら親ディレクトリ列挙＋終端セグメントを選択対象フィルタとして扱う (#489)
                // 候補: :e C:/foo/bar   → base = C:/foo/, filter=bar, typedDirRaw="C:/foo/"
                let parsed = null; let havePath = false;
                try{
                  if (/^\s*:?(?:e)\s+\S+/i.test(val)){ parsed = _eParseInput(val.replace(/^\s*:?/,'').replace(/^e\s*/i,'')); }
                }catch{ parsed = null; }
                if (parsed && parsed.typedDirRaw){ havePath = true; }
                if (havePath){
                  // 既存パス入力を尊重
                  _fileBaseURL = parsed.baseURL || _currentDirBase();
                  _fileStartBaseURL = _ensureSlash(_fileBaseURL);
                  _fileNextStartBaseURL = null;
                  _fileTypedDirRaw = parsed.typedDirRaw || '';
                  _fileFilter = parsed.filter || '';
                  _fileSelAuto = true; // フィルタによる自動選択有効
                  try{ const b=_ensureSlash(_fileBaseURL); _filePopupNoUp = !!(b && (_isHostRoot(b) || _isUncShareRoot(b))); }catch{ _filePopupNoUp=false; }
                } else {
                  // 旧挙動（空起動）
                  _fileBaseURL = _currentDirBase();
                  _fileStartBaseURL = _ensureSlash(_fileBaseURL);
                  _fileNextStartBaseURL = null;
                  try{ const b=_ensureSlash(_fileBaseURL); _filePopupNoUp = !!(b && (_isHostRoot(b) || _isUncShareRoot(b))); }catch{ _filePopupNoUp=false; }
                  _fileTypedDirRaw = '';
                  _fileFilter = '';
                  _fileSelAuto = true;
                }
                _fileJustNavAt = Date.now(); _fileNavRetryCount = 0;
                _fileReflectGuardUntil = Date.now() + 700; // 直後 Enter 抑止
                _fileInvalid = false;
                _fileLoading = true;
                _fileEntries = []; _fileSel = 0; _fileSelMuted = false;
                _fileReflectedOnOpen = false;
                // 入力欄末尾へ caret を移動（既入力再利用時）
                try{ if (cmdinput){ const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); } }catch{}
                if (!_filePopupVisible()) _filePopupShow(); else _filePopupRender();
                (function(){
                  const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
                  // Freshen directory listing on popup open via Tab to include newly added files
                  try{ if (reqKey && _dirCache && _dirCache.delete) _dirCache.delete(reqKey); }catch{}
                  _listDirEntries(_fileBaseURL)
                    .then(list=>{
                      try{
                        const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                        if (!reqKey || curKey===reqKey){
                          _fileEntries = Array.isArray(list) ? list : [];
                          if (Array.isArray(list) && list.length>0){ _fileStableEntries = list.slice(); _fileStableBaseKey = curKey; }
                          // 既入力フィルタがある場合は一致ディレクトリを選択（ファイル名でもディレクトリでも）
                          if (_fileFilter){
                            let caseSensitive = false; try{ const b=_ensureSlash(_fileBaseURL); if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost') caseSensitive=true; }catch{}
                            const matchIdx = _fileEntries.findIndex(e=> e && e.name && (caseSensitive ? e.name===_fileFilter : e.name.toLowerCase()===_fileFilter.toLowerCase()));
                            if (matchIdx>=0){
                              try{ const baseNow=_ensureSlash(_fileBaseURL); const suppressUp=(!!_filePopupNoUp)||(baseNow&&(_isHostRoot(baseNow)||_isUncShareRoot(baseNow))); }catch{}
                              const suppressUp = (function(){ try{ const b=_ensureSlash(_fileBaseURL); return (!!_filePopupNoUp)||(b&&(_isHostRoot(b)||_isUncShareRoot(b))); }catch{ return false; }})();
                              _fileSel = matchIdx + (suppressUp?0:1);
                              _fileSelMuted = false;
                            }
                          }
                        }
                      }catch{}
                    })
                    .catch(()=>{})
                    .finally(()=>{ _fileLoading=false; _filePopupRender(); });
                })();
                return;
              }
              // popup 非表示かつ先頭が :b のときは、Tab でバッファポップアップを表示
              if (/^\s*:?(?:b\b)/i.test(val)){
                e.preventDefault(); e.stopPropagation();
                // 現在の入力からフィルタ/選択を反映して表示
                const mTail = val.match(/^\s*:?\s*b\s*(.*)$/i);
                const tail = (mTail? mTail[1] : '');
                const digits = tail.match(/^([0-9]+)\s*$/);
                if (digits){
                  _bufFilterKind = 'numPrefix';
                  _bufFilter = String(digits[1]);
                  _bufSelAbs = Math.max(0, Math.min(buffers.length-1, parseInt(digits[1],10)-1));
                } else if (tail && tail.trim()){ 
                  _bufFilterKind = 'text';
                  _bufFilter = tail;
                  _bufSelAbs = null;
                } else {
                  _bufFilterKind = 'text'; _bufFilter=''; _bufSelAbs=null;
                }
                _bufPopupShow();
                return;
              }
            }catch{}
            // CMD 中は Tab のフォーカス移動は常に抑止
            e.preventDefault(); e.stopPropagation();
          }
        } else if (e.key==='ArrowDown' || e.key==='ArrowUp' || e.key==='PageDown' || e.key==='PageUp'){
          // buf popup navigation
          if (_bufPopupVisible()){
            e.preventDefault(); e.stopPropagation();
            const delta = (e.key==='PageDown')?10 : (e.key==='PageUp')?-10 : (e.key==='ArrowDown'?1:-1);
            _bufPopupMove(delta);
          } else if (_filePopupVisible()){
            e.preventDefault(); e.stopPropagation();
            const delta = (e.key==='PageDown')?10 : (e.key==='PageUp')?-10 : (e.key==='ArrowDown'?1:-1);
            _filePopupMove(delta);
          } else {
            // history navigation: use search history when input begins with '/' or '?', otherwise command history
            if (e.key==='PageUp' || e.key==='PageDown') return; // 履歴では無効
            e.preventDefault(); e.stopPropagation();
            try{
              const curVal = String(cmdinput.value||'');
              const isSearchInput = /^\s*:?[\/?]/.test(curVal);
              if (isSearchInput){
                const nS = _searchHistory.length;
                if (!_searchHistBrowsing){ _searchHistTemp = curVal; _searchHistIndex = nS; _searchHistBrowsing = true; }
                if (e.key==='ArrowUp'){
                  _searchHistIndex = Math.max(0, _searchHistIndex - 1);
                } else if (e.key==='ArrowDown'){
                  _searchHistIndex = Math.min(nS, _searchHistIndex + 1);
                }
                if (_searchHistIndex === nS){
                  _searchHistBrowsing = false; // back to draft
                  cmdinput.value = _searchHistTemp;
                } else {
                  cmdinput.value = _searchHistory[_searchHistIndex] || '';
                }
              } else {
                const n = _cmdHistory.length;
                if (!_cmdHistBrowsing){ _cmdHistTemp = curVal; _cmdHistIndex = n; _cmdHistBrowsing = true; }
                if (e.key==='ArrowUp'){
                  _cmdHistIndex = Math.max(0, _cmdHistIndex - 1);
                } else if (e.key==='ArrowDown'){
                  _cmdHistIndex = Math.min(n, _cmdHistIndex + 1);
                }
                if (_cmdHistIndex === n){
                  _cmdHistBrowsing = false; // back to draft
                  cmdinput.value = _cmdHistTemp;
                } else {
                  cmdinput.value = _cmdHistory[_cmdHistIndex] || '';
                }
              }
              // move caret to end and propagate input (to trigger preview/popups if needed)
              try{ const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); }catch{}
              try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
            }catch{}
          }
        }
      });
      cmdinput.addEventListener('input', ()=>{
        const vRaw = cmdinput.value;
        const selStart = (function(){ try{ return cmdinput.selectionStart; }catch{ return null; } })();
        const selEnd   = (function(){ try{ return cmdinput.selectionEnd; }catch{ return null; } })();
        let prefSegStart=null, prefSegEnd=null;
        try{
          const prefP = String(window._fileLastPrefillPrefix||'');
          const prefS = String(window._fileLastPrefillSeg||'');
          if (prefP && prefS){
            const baseVal = ':e ' + prefP; // prefix ends with '/'
            if (vRaw.startsWith(baseVal)){
              const segPos = baseVal.length;
              if (vRaw.slice(segPos, segPos+prefS.length) === prefS){ prefSegStart=segPos; prefSegEnd=segPos+prefS.length; }
            }
          }
        }catch{}
        try{ console.debug('[e-input-raw]', { v:vRaw, mode:_mode, prefillPrefix:window._fileLastPrefillPrefix||null, prefillSeg:window._fileLastPrefillSeg||null, prefillAge: window._fileLastPrefillTs? (Date.now()-window._fileLastPrefillTs):null, selStart, selEnd, prefSegStart, prefSegEnd }); }catch{}
        // NBSP/ゼロ幅スペースなどの不可視を除去（貼り付け時の "U\u00A0b\u00A0u..." 問題の回避）
        const vSan = vRaw.replace(/[\u200B-\u200D\u2060\u00A0]/g, '');
        const v = vSan; // keep visible spaces for parsing
        // Incremental search preview for '/' and '?' inputs
        try{ if (_incPrevUpdateForCmdValue(v)) { return; } }catch{}
        // :b は履歴から戻したテキストでも即ポップアップを出さない。
        // ただし " :b"（空白のみ）に戻した場合は表示する。
        try{
          const mb = v.match(/^\s*:?\s*b\b(.*)$/i);
          if (mb){
            const tail = (mb[1]||'');
            const onlySpaces = /^\s*$/.test(tail);
            if (!onlySpaces && !_bufPopupVisible()){
              // 以降の :b 分岐はスキップ（Tab で明示表示）
              // ただし正確一致の :bN はこの早期リターンに該当しないため、先に :bN を処理する
              // （よって、このガードは :bN マッチの後段で作用する）
            } else if (onlySpaces && !_bufPopupVisible()){
              // :b or :b のみ → ポップアップ表示
              _bufFilterKind='text'; _bufFilter=''; _bufSelAbs=null; _bufPopupShow();
              return;
            }
          }
        }catch{}
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
            if (!_bufPopupVisible()) return; else _bufPopupRender();
            return;
          }
        }

        // 3) ":b <query>"（テキスト）→ インクリメンタル絞り込み
        if ((m = v.match(/^\s*:?[\s]*b\s+(.*)$/i))){
          if (!_bufPopupVisible()) return;
          _bufFilterKind = 'text';
          _bufFilter = (m[1]||'');
          _bufSelAbs = null;
          _bufPopupRender();
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

        // ---- :e 入力に応じたファイルポップアップ処理（":e " の時点で発火）----
        let me;
        // 発火条件を厳密化: 「:e」のみでは開かず、「:e 」とスペースが入った時点で開く
        // 先頭コロンは1個まで許容（"::e" は別扱い）
        if ((me = v.match(/^\s*:?\s*e\s+(.*)$/i))){
          try{ console.debug('[e-input-e-branch-start]', { raw:v, typedDir:_fileTypedDirRaw, filter:_fileFilter }); }catch{}
          // Ensure buffer popup is not shown when switching to :e (#343)
          try{ _bufPopupHide(); }catch{}
          // 後続が空白のみ（" :e" or ":e ")ならポップアップを開く。
          const tail = (me[1]||'');
          const onlySpaces = /^\s*$/.test(tail);
          if (onlySpaces){
            // ここだけポップアップ起動（基点は現バッファ）
            try{
              if (!_filePopupVisible()){
                _fileBaseURL = _currentDirBase();
                _fileStartBaseURL = _ensureSlash(_fileBaseURL);
                _fileNextStartBaseURL = null;
                try{ const b=_ensureSlash(_fileBaseURL); _filePopupNoUp = !!(b && (_isHostRoot(b) || _isUncShareRoot(b))); }catch{ _filePopupNoUp=false; }
                _fileJustNavAt = Date.now(); _fileNavRetryCount = 0;
                // 起動直後は Enter を無効化（Tab は可）
                _fileReflectGuardUntil = Date.now() + 700;
              }
            }catch{}
            // 入力直後に列挙を開始（この時点の自動選択は有効）
            _fileSelAuto = true;
            _fileTypedDirRaw = '';
            _fileFilter = '';
            _fileInvalid = false;
            _fileLoading = true;
            _fileEntries = []; _fileSel = 0;
            _fileReflectedOnOpen = false;
            if (!_filePopupVisible()) _filePopupShow(); else _filePopupRender();
            (function(){
              const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
              // Freshen directory listing on ":e " popup open to include newly added files
              try{ if (reqKey && _dirCache && _dirCache.delete) _dirCache.delete(reqKey); }catch{}
              _listDirEntriesWithQuickRetry(_fileBaseURL)
                .then(list=>{
                  try{
                    const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                    if (!reqKey || curKey===reqKey){
                      _fileEntries = Array.isArray(list) ? list : [];
                      if (Array.isArray(list) && list.length>0){ _fileStableEntries = list.slice(); _fileStableBaseKey = curKey; }
                    }
                  }catch{}
                })
                .catch(()=>{})
                .finally(()=>{ _fileLoading=false; _filePopupRender(); });
            })();
            return;
          }

          // 以降は従来の処理（手入力＝すでにポップアップ開いている場合の更新）
          if (!_filePopupVisible()){
            return; // まだ開いていないなら Enter/Tab に委譲
          }
          // :e 入力時のポップアップ
          // 新規に :e 入力を開始したときの基点は常に「現バッファのディレクトリ」。
          // 以前のセッション由来の一時基点は使わずクリアしておく（#178）。
          try{
            if (!_filePopupVisible()){
              _fileBaseURL = _currentDirBase();
              _fileStartBaseURL = _ensureSlash(_fileBaseURL);
              _fileNextStartBaseURL = null;
              // '..' 抑止フラグも現在地で初期化
              try{ const b=_ensureSlash(_fileBaseURL); _filePopupNoUp = !!(b && (_isHostRoot(b) || _isUncShareRoot(b))); }catch{ _filePopupNoUp=false; }
              // 初期表示直後の空振りに備え、短期再試行の猶予を開始
              _fileJustNavAt = Date.now(); _fileNavRetryCount = 0;
            }
          }catch{}
          const parsed = _eParseInput(v);
          try{ console.debug('[e-input-parsed]', { typedDirRaw:parsed.typedDirRaw, filter:parsed.filter }); }catch{}
              // #827: 直前の自動補完選択後最初のタイプで親ディレクトリまで巻き戻る誤判定を補正
              try{
                if (window._fileLastPrefillTs && (Date.now() - window._fileLastPrefillTs) < 2000){
                  const prefPrefix = String(window._fileLastPrefillPrefix||'');
                  const prefSeg = String(window._fileLastPrefillSeg||'');
                  if (prefPrefix && prefSeg){
                    // 現在のraw入力からディレクトリ部分を抽出
                    const m2 = v.match(/^\s*:?\s*e\s+(.*)$/i);
                    const afterNow = m2 ? m2[1] : ''; const normNow = afterNow.replace(/\\/g,'/');
                    // prefPrefix + prefSeg が存在したはずなのに、prefPrefix 末尾より短くなっている（=2段階上がったように見える）なら補正
                    const lostParent = (prefPrefix.length >= 3 && normNow.startsWith(prefPrefix.slice(0, -1)) && !normNow.startsWith(prefPrefix));
                    // 具体例: prefPrefix='C:/Users/ymaru/' prefSeg='WebView2' normNow='C:/Users/'
                    if (lostParent && normNow.endsWith('/')){
                      // フィルタは現在入力文字列末尾セグメント（selection置換で得た先頭1文字など）
                      const lastChar = normNow.slice(-1); // always '/'
                      // 再構築: prefPrefix + currentフィルタ（抽出）
                      // 現在の入力末尾がスラッシュのみなのでフィルタは空、次タイプで正しく絞り込みさせるため prefSeg を削除し再度 prefix を維持
                      _fileTypedDirRaw = prefPrefix; // 親ディレクトリまで維持
                      // filter は元の入力から prefix 除去後の残差（巻き戻し後の置換文字列）
                      // 例: ':e C:/Users/' → filter=''
                      const filtNow = parsed.filter || '';
                      _fileFilter = filtNow; // そのまま適用（空想定）
                    }
                  }
                }
              }catch{}
          // ちょうど ":e "（スペースのみ、ディレクトリ未入力）の場合も、
          // 既存のポップアップ表示の有無に関わらず基点を現バッファに固定し猶予を開始
          try{
            const mAfter = v.match(/^\s*:?[\s]*e\s+(.*)$/i);
            const afterE = (mAfter ? mAfter[1] : '');
            if ((afterE||'').trim() === ''){
              _fileBaseURL = _currentDirBase();
              _fileStartBaseURL = _ensureSlash(_fileBaseURL);
              try{ const b=_ensureSlash(_fileBaseURL); _filePopupNoUp = !!(b && (_isHostRoot(b) || _isUncShareRoot(b))); }catch{ _filePopupNoUp=false; }
              _fileJustNavAt = Date.now(); _fileNavRetryCount = 0;
            }
          }catch{}
          const mAfter = v.match(/^\s*:?\s*e\s+(.*)$/i);
          const afterE = (mAfter ? mAfter[1] : '');
          const afterNorm = afterE.replace(/\\/g,'/');
          // UNCの未確定を広く無効扱い: "//", "//host", "//host/", さらに "//host/share"（末尾スラ無し）
          const isUnc = afterNorm.startsWith('//');
          const hostOnly = /^\/\/[^/]*$/.test(afterNorm);
          const hostRootOnly = /^\/\/[^/]+\/$/.test(afterNorm);
          let shareNoTrail = false;
          if (isUnc){
            const body = afterNorm.slice(2);
            const segs = body.split('/').filter(s=>s.length>0);
            const endsSlash = afterNorm.endsWith('/');
            // セグメントが2つ(=host,share)だが末尾スラ無し → まだ共有直下未確定
            if (segs.length === 2 && !endsSlash) shareNoTrail = true;
            // セグメントが2未満 → 未確定
            if (segs.length < 2) shareNoTrail = true;
          }
          // 先頭のスキーム or ドライブ指定を取り除いてから禁止文字/コロンをチェック
          let rest = afterNorm;
          if (/^[a-z][a-z0-9+.-]*:/i.test(rest)){
            rest = rest.replace(/^[a-z][a-z0-9+.-]*:/i, '');
          } else if (/^[A-Za-z]:/.test(rest)){
            rest = rest.replace(/^[A-Za-z]:/, '');
          }
          const hasNtfsBad = /[<>:"|?*]/.test(rest);
          const hasExtraColon = rest.includes(':');
          const hasDoubleColon = /:{2,}/.test(afterNorm);
          const hasTripleDot = /\.{3,}/.test(afterNorm);
          // 共有（host/share/）まで確定している場合は、以降の下位ディレクトリ入力で shareNoTrail の無効判定を適用しない
          let hostShareFixed = false;
          if (isUnc){
            const segs = afterNorm.slice(2).split('/').filter(s=>s.length>0);
            const endsSlash = afterNorm.endsWith('/');
            hostShareFixed = (segs.length >= 2) && endsSlash; // "//host/share/" までは確定
          }
          const looksInvalid = !!(
            hostOnly || hostRootOnly ||
            (!hostShareFixed && shareNoTrail) ||
            hasNtfsBad || hasExtraColon || hasDoubleColon || hasTripleDot
          );

          // 入力の反映（まずは typed/filter の可視化）
          _fileSelAuto = true; // 入力に伴う自動選択を有効化
          _fileTypedDirRaw = parsed.typedDirRaw || '';
          _fileFilter = parsed.filter || '';
          try{ console.debug('[e-input-after-assign]', { typedDirRaw:_fileTypedDirRaw, filter:_fileFilter }); }catch{}
          // 巻き戻り/置換分類 (prefill後最初のタイプ判定) (#828)
          try{
            const prefTs = window._fileLastPrefillTs;
            const within = prefTs && (Date.now()-prefTs) < 8000; // detection window extended
            if (within){
              const prefP = String(window._fileLastPrefillPrefix||'');
              const prefS = String(window._fileLastPrefillSeg||'');
              if (prefP && prefS){
                // 期待される通常置換: typedDirRaw === prefP (prefix維持) かつ filter が1文字以上・prefS 不含
                const normalReplace = (_fileTypedDirRaw === prefP) && (_fileFilter.length>=1) && !(_fileFilter.includes('/') ) && true;
                // 二段巻き戻り異常: prefP の親までさらに短縮 (parentOfPrefP)
                let parentOfPrefP = prefP.replace(/\/+$/,'');
                parentOfPrefP = parentOfPrefP.replace(/\\/g,'/');
                const iSlash = parentOfPrefP.lastIndexOf('/');
                parentOfPrefP = (iSlash>=0? parentOfPrefP.slice(0,iSlash+1):'');
                const lostTwo = parentOfPrefP && _fileTypedDirRaw === parentOfPrefP; // prefixより1段多く失われ
                const classify = lostTwo ? 'B_TWO_LEVEL_BACK' : (normalReplace ? 'A_REPLACE_SEG' : 'OTHER');
                console.debug('[e-input-prefill-classify]', { classify, prefPrefix:prefP, prefSeg:prefS, typedDirRaw:_fileTypedDirRaw, filter:_fileFilter, parentOfPrefP });
              }
            }
          }catch{}
          if (!_filePopupVisible()) _filePopupShow(); else _filePopupRender();

          // 無効なら '********' 表示
          // ただし "//host/"（hostRootOnly）や "//host/<partial>"（共有名プレフィックス）では shares API を試す
          // 備考: "//host"（末尾にスラなし）は引き続き '********' とする設計。
          //       ":e //" → Tab で "wsl.localhost" を補完した直後に '********' になるのはこのため（#163）。
          if (looksInvalid){
            // 追加: ":e //" 直後は擬似候補として "wsl.localhost/" を常に提示（Tab で補完しやすく）
            if (/^\/\/$/.test(afterNorm)){
              _fileInvalid = false; _fileLoading = false;
              _filePopupNoUp = true;
              _fileEntries = [ { name:'wsl.localhost', isDir:true, url:'file:////wsl.localhost/' } ];
              _fileSel = 0; if (!_filePopupVisible()) _filePopupShow(); else _filePopupRender();
              return;
            }
            const mh = afterNorm.match(/^\/\/([^/]+)\/(.*)?$/);
            const hostMaybe = mh ? mh[1] : '';
            const sharePrefix = mh ? (mh[2]||'').replace(/\/+/g,'/').split('/')[0] : '';
            const isPartialShare = (!!hostMaybe && !!sharePrefix && !afterNorm.endsWith('/'));
            if ((hostRootOnly || isPartialShare) && _apiIsEnabled()){
                try{
                  const host = hostMaybe;
                  // host 直下を基点として設定
                  try{ _fileBaseURL = _ensureSlash(new URL('file:////' + host + '/', _htmlBaseURL())); }catch{}
                  // 入力欄側も //host/ を厳密に保持（スラッシュ欠落防止）
                  _fileTypedDirRaw = '//' + host + '/';
                // 共有名のフィルタ（"//host/U" 入力中なら "U"）
                _fileFilter = parsed.filter || '';
                _fileInvalid = false; _fileLoading = true;
                _fileEntries = []; _fileSel = 0; if (!_filePopupVisible()) _filePopupShow(); else _filePopupRender();
                const apiUrl = _apiBase + 'shares?host=' + encodeURIComponent(host);
                _fetchJSONWithTimeout(apiUrl, 4000).then(j=>{
                  const raw = (j && Array.isArray(j.shares)) ? j.shares : [];
                  const seen = new Set();
                  const clean = (s)=>{
                    try{
                      let t = String(s||'');
                      // ゼロ幅系や制御っぽい不可視を除去（表示/一致の安定化）
                      t = t.replace(/[\u200B-\u200D\u2060\u00A0]/g, '');
                      t = t.replace(/[\u0000-\u001F]/g, '');
                      try{ t = t.normalize('NFKC'); }catch{}
                      return t.trim();
                    }catch{ return String(s||''); }
                  };
                  const entries = [];
                  for (const e of raw){
                    const n0 = (e && e.name);
                    const n1 = clean(n0);
                    if (!n1) continue;
                    if (n1 === '.' || n1 === '..' || n1.includes('/')) continue;
                    const key = n1.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
                    const url = (e && e.url) ? String(e.url) : ('file:////' + host + '/' + encodeURIComponent(n1) + '/');
                    entries.push({ name: n1, isDir: true, url });
                  }
                  entries.sort((a,b)=> a.name.localeCompare(b.name));
                  _fileEntries = entries;
                  try{ const curKey = _ensureSlash(_fileBaseURL)?.toString()||null; _fileStableEntries = entries.slice(); _fileStableBaseKey = curKey; }catch{}
                  _fileInvalid = false;
                }).catch(()=>{
                  _fileInvalid = true;
                }).finally(()=>{ _fileLoading = false; /* keep _filePopupNoUp as-is for shares */ _filePopupRender(); });
              }catch{
                _fileInvalid = true; _fileLoading = false; _filePopupRender();
              }
              return;
            }
            _fileInvalid = true; _fileLoading = false; _filePopupRender();
            return;
          }

          // 有効になったら列挙（この時点で base を更新）。
          // ベース変更時のみ列挙。フィルタ変更のみは描画のみ（デバウンス）。
          const prevKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
          // 変更前の基点URLオブジェクト（"../" 入力時の表示正規化に使用）
          const prevBaseObj = (function(){ try{ return _ensureSlash(_fileBaseURL); }catch{ return null; } })();
          if (parsed.baseURL){ _fileBaseURL = parsed.baseURL; }
          let newKey = null; try{ newKey = _ensureSlash(_fileBaseURL)?.toString()||null; }catch{}
          _fileInvalid = false;
          if (newKey !== prevKey){
            try{ console.debug('[e-input-base-changed]', { prevKey, newKey, typedDirRaw:_fileTypedDirRaw, filter:_fileFilter }); }catch{}
            // ベースが変わったら ".." 抑止フラグを現在地に合わせて再計算
            try{
              const baseNow = _ensureSlash(_fileBaseURL);
              _filePopupNoUp = !!(baseNow && (_isHostRoot(baseNow) || _isUncShareRoot(baseNow)));
            }catch{ _filePopupNoUp = false; }
            // 新ベースへ切り替えたら一覧をクリアしてローディングへ（親一覧のまま止まらないようにする）
            _fileEntries = [];
            _fileSel = 0; _fileLoading = true; _fileFilter = '';
            // 選択ドリルダウン直後の追加再試行カウンタをリセット
            _fileNavRetryCount = 0;
            if (_fileListTimer){ try{ clearTimeout(_fileListTimer); }catch{} _fileListTimer=null; }
            if (_filePopupVisible()) _filePopupRender();
            // 入力で "../" を付与して親へ遷移した場合、入力表示を正規化し、短期ガードを有効化
            try{
              const typedNow = String(_fileTypedDirRaw||'').replace(/\\/g,'/');
              const wentParent = /(^|\/)\.\.\/$/.test(typedNow) && String(_fileFilter||'')==='';
              if (wentParent){
                try{ console.debug('[e-input-went-parent]', { typedNow, prevSeg:_filePostSelectName }); }catch{}
                // 旧基点から直前セグメント名を取得し、親一覧で選択するために保持
                let prevSeg = '';
                try{
                  const b = prevBaseObj;
                  let p = decodeURIComponent((b && b.pathname) || '');
                  p = p.replace(/\/+$/,'');
                  const i2 = p.lastIndexOf('/');
                  prevSeg = (i2>=0 ? p.slice(i2+1) : p);
                }catch{}
                _filePostSelectName = prevSeg || null;
                // 新しい基点に対するディレクトリ表記へ置換
                try{ _fileTypedDirRaw = _inputDirRawFromURL(_fileBaseURL); }catch{}
                // 表示は "<parent>/<prevSeg>" の形にして、prevSeg をフィルタとして反映
                try{
                  if (cmdinput){
                    cmdinput.value = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + String(prevSeg||''));
                    const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos);
                    try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
                  }
                }catch{}
                // 直後の Enter と選択反映を抑止
                _fileReflectGuardUntil = Date.now() + 700;
                _fileJustNavAt = Date.now();
              }
            }catch{}
            const doList = ()=>{
              const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
              _listDirEntriesWithQuickRetry(_fileBaseURL)
                .then(list=>{
                  try{
                    const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                    if (!reqKey || curKey === reqKey){
                      // 取得結果が非空のときのみ上書き。空のときは直前の一覧を維持し、
                      // 一時的に "../" だけになる・"(no entries)" に振れる瞬間を避ける。
                      if (Array.isArray(list) && list.length>0){
                        _fileEntries = list;
                        _fileStableEntries = list.slice();
                        _fileStableBaseKey = curKey;
                        // 親へ戻った直後の選択フォーカス（".." 経由）
                        if (_filePostSelectName){
                          try{
                            const baseNow = _ensureSlash(_fileBaseURL);
                            const suppressUp = (!!_filePopupNoUp) || (baseNow && (_isHostRoot(baseNow) || _isUncShareRoot(baseNow)));
                            const idx2 = _fileEntries.findIndex(e=> e && e.isDir && e.name === _filePostSelectName);
                            if (idx2>=0){ _fileSel = idx2 + (suppressUp?0:1); }
                          }catch{}
                          _filePostSelectName = null;
                        }
                      }
                    }
                  }catch{}
                })
        .catch((e)=>{ console.warn('dir list (:e typing) failed', e); /* keep previous entries */ })
        .finally(()=>{
          try{
            const stillEmpty = !(_fileEntries && _fileEntries.length>0);
            // 遷移直後は（UNCに限らず）猶予内は必ず Loading 維持＋再試行
            const withinGrace = (Date.now() - _fileJustNavAt) < 4000;
            if (stillEmpty && withinGrace && _fileNavRetryCount < 5){
              _fileNavRetryCount++;
              _fileLoading = true;
              _filePopupRender();
              const delay = (_fileNavRetryCount<=2 ? 250 : _fileNavRetryCount<=4 ? 400 : 600);
              setTimeout(()=>{ try{ const kNow = _ensureSlash(_fileBaseURL)?.toString(); if (kNow===reqKey) { doList(); } else { _fileLoading=false; _filePopupRender(); } }catch{} }, delay);
              return;
            }
          }catch{}
          _fileLoading=false; _filePopupRender();
        });
            };
            // デバウンスせず即列挙（補完・手入力とも一本化、確実に開始）
            doList();
          } else {
            // ベース不変でも、":e "（afterEが空）の場合は初回列挙を必ず開始（#180）
            const isAfterEEmpty = (function(){ try{ const mAfter=v.match(/^\s*:?[\s]*e\s+(.*)$/i); const a=(mAfter?mAfter[1]:''); return (a.trim()===''); }catch{ return false; } })();
            if (isAfterEEmpty){
              // 現在の基点で強制列挙
              _fileEntries = []; _fileSel = 0; _fileLoading = true;
              if (_fileListTimer){ try{ clearTimeout(_fileListTimer); }catch{} _fileListTimer=null; }
              if (_filePopupVisible()) _filePopupRender();
              const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
              const doList2 = ()=>{
                _listDirEntriesWithQuickRetry(_fileBaseURL)
                  .then(list=>{
                    try{
                      const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                      if (!reqKey || curKey === reqKey){
                        if (Array.isArray(list) && list.length>0){
                          _fileEntries = list;
                          _fileStableEntries = list.slice();
                          _fileStableBaseKey = curKey;
                        }
                      }
                    }catch{}
                  })
                  .catch((e)=>{ console.warn('dir list (:e typing force) failed', e); /* keep previous entries */ })
                  .finally(()=>{
                    try{
                      const stillEmpty = !(_fileEntries && _fileEntries.length>0);
                      const withinGrace = (Date.now() - _fileJustNavAt) < 4000;
                      if (stillEmpty && withinGrace && _fileNavRetryCount < 5){
                        _fileNavRetryCount++;
                        _fileLoading = true;
                        _filePopupRender();
                        const delay = (_fileNavRetryCount<=2 ? 250 : _fileNavRetryCount<=4 ? 400 : 600);
                        setTimeout(()=>{ try{ const kNow = _ensureSlash(_fileBaseURL)?.toString(); if (kNow===reqKey) { doList2(); } else { _fileLoading=false; _filePopupRender(); } }catch{} }, delay);
                        return;
                      }
                    }catch{}
                    _fileLoading=false; _filePopupRender();
                  });
              };
              doList2();
            } else {
              // ベース不変時（フィルタ入力など）はローディング状態を変更しない
              if (_filePopupVisible()) _filePopupRender();
            }
          }
          // #828: Prefill後短時間で補完セグメントが消失したか検知ログ
          try{
            if (window._fileLastPrefillTs && (Date.now()-window._fileLastPrefillTs)<8000){
              const prefP = String(window._fileLastPrefillPrefix||'');
              const prefS = String(window._fileLastPrefillSeg||'');
              if (prefP && prefS){
                const curFull = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||''));
                const expectedPrefix = ':e ' + _collapseDotDotPath(prefP + prefS);
                const lost = (expectedPrefix.startsWith(':e ') && curFull.startsWith(':e ') && !curFull.includes(prefS));
                if (lost){ console.debug('[e-input-prefill-seg-lost]', { curFull, expectedPrefix, prefPrefix:prefP, prefSeg:prefS }); }
              }
            }
          }catch{}
          return;
        }

        // 5) それ以外
        // 入力が ":e"（スペース可）のみに戻った場合、ポップアップが開いていれば
        // バッファのカレントディレクトリに戻して一覧を再表示（#175 後段）
        try{
          if (_filePopupVisible() && /^\s*:?\s*e\s*$/i.test(v)){
            // オープン時の開始基点があればそれへ戻す。無ければ現バッファ基点。
            _fileBaseURL = (_fileStartBaseURL ? _ensureSlash(_fileStartBaseURL) : _currentDirBase());
            _fileTypedDirRaw = '';
            _fileFilter = '';
            _fileInvalid = false;
            _fileLoading = true;
            _fileEntries = []; _fileSel = 0;
            // '..' 抑止フラグを現在地に合わせて再計算
            try{
              const baseNow = _ensureSlash(_fileBaseURL);
              _filePopupNoUp = !!(baseNow && (_isHostRoot(baseNow) || _isUncShareRoot(baseNow)));
            }catch{ _filePopupNoUp = false; }
            if (_filePopupVisible()) _filePopupRender();
            (function(){
              const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
              _listDirEntriesWithQuickRetry(_fileBaseURL)
                .then(list=>{
                  try{
                    const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                    if (!reqKey || curKey === reqKey){
                      _fileEntries = Array.isArray(list) ? list : [];
                      if (Array.isArray(list) && list.length>0){
                        _fileStableEntries = list.slice();
                        _fileStableBaseKey = curKey;
                      }
                    }
                  }catch{}
                })
                .catch((e)=>{ console.warn('dir list (:e back to current) failed', e); })
                .finally(()=>{ _fileLoading=false; _filePopupRender(); });
            })();
            return;
          }
        }catch{}
        // 非表示
        _bufPopupHide();
        _filePopupHide();
      });

      // Close interception setup (bind once at startup, outside CMD flow)
      // WebView2: host sends 'close-request' and expects 'close-result'
      // Browser fallback: use beforeunload to cancel and run :qa-like flow
      (function setupCloseInterceptionOnce(){
        try{
          if (_isWebView2){
            const onHostMessage = (ev)=>{
              try{
                const msg = (ev && ev.data) || {};
                if (!msg || msg.type !== 'close-request') return;
                if (_quitInProgress) return;
                _quitInProgress = true;
                // Treat window close as immediate quit (F10 semantics): persist session, no prompt (#435)
                try{ _persistSessionNow(); _suppressPersistOnQuit = false; _skipPersistOnUnloadOnce = true; _quittingAll = true; _allowUnloadOnce = true; }catch{}
                try{ window.chrome.webview.postMessage({ type:'close-result', ok: true }); }catch{}
                try{ window.close(); }catch{}
                _quitInProgress = false;
              }catch{}
            };
            // Bind once
            try{ window.chrome.webview.removeEventListener && window.chrome.webview.removeEventListener('message', onHostMessage); }catch{}
            window.chrome.webview.addEventListener('message', onHostMessage);
            // Important: DO NOT attach beforeunload in WebView2 to avoid native dialog
            try{ window.onbeforeunload = null; }catch{}
          } else {
            // Browser fallback
            const onBeforeUnload = (e)=>{
              try{
                if (_allowUnloadOnce){ _allowUnloadOnce = false; return; }
                if (_quittingAll) return;
                // Treat native window close like F10 immediate quit: persist via capture listener, don't prompt
                try{ _suppressPersistOnQuit = false; _skipPersistOnUnloadOnce = false; }catch{}
                // Allow the unload to proceed without intervention
                return;
              }catch{}
            };
            // ensure no duplicate listeners
            try{ window.removeEventListener('beforeunload', onBeforeUnload); }catch{}
            window.addEventListener('beforeunload', onBeforeUnload);
          }
        }catch{}
      })();
    }
  }

  // Apply caret color depending on IME full-width state
  // _applyCaretImeVisual removed; caret color no longer toggled by IME state.

  /*********************************************************
   * Buffer popup (:b ...)
   *********************************************************/
  const bufpopup = document.getElementById('bufpopup');
  const bufpopupInner = bufpopup ? bufpopup.querySelector('.inner') : null;
  let _bufSel = 0;              // 可視リスト内の選択インデックス
  let _bufSelAbs = null;        // 絶対バッファインデックス（必要時）
  let _bufFilter = '';
  let _bufFilterKind = 'text';  // 'text' | 'numPrefix'
  function _popupKind(){ return bufpopup ? (bufpopup.dataset && bufpopup.dataset.kind) : undefined; }
  function _bufPopupVisible(){ return !!(bufpopup && bufpopup.style.display !== 'none' && _popupKind() === 'buf'); }
  function _filePopupVisible(){ return !!(bufpopup && bufpopup.style.display !== 'none' && _popupKind() === 'file'); }
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
        // Include plain number, function-key label, and circled number for filtering
        const n = i+1;
        const decorated = ((String(n) + ' ') + ('F'+n + ' ') + _bufferNumberLabel(n) + ' ' + (b.name||'')).toLowerCase();
        return name.startsWith(q) || path.startsWith(q) || decorated.startsWith(q);
      });
  }
  function _bufPopupRender(){
    if (!bufpopup || !bufpopupInner) return;
    bufpopup.dataset.kind = 'buf';
    bufpopupInner.innerHTML = '';
    // 先に候補を計算（ヘッダのグレー表示条件に使用）
    const list = _bufPopupComputeList();
    // 操作ヘッダ: 「数字, Fキー ダイレクト選択」 + 「d バッファ破棄」
    try{
      const vNow = String((cmdinput && cmdinput.value) || '');
      const isBareB = /^\s*:?\s*b$/i.test(vNow);
      const isBWithSpaceOnly = /^\s*:?\s*b\s+$/i.test(vNow);
      const isBWithSpaceAndMore = /^\s*:?\s*b\s+\S/.test(vNow);
      const noItems = !(Array.isArray(list) && list.length>0);
      const hdr = document.createElement('div');
      hdr.className = 'hint';
      try{
        hdr.style.padding = '2px 0 6px 0';
        hdr.style.userSelect='none';
        hdr.style.display='flex';
        hdr.style.gap='1.25rem';
        hdr.style.alignItems='center';
        // 追加の上下マージン (#587)
        hdr.style.marginTop = '0.2rem';
        hdr.style.marginBottom = '0.1rem';
        // ヘッダ背景（テーマ）
        const bg = (window && window.THEME && window.THEME.popupHeaderBg) ? window.THEME.popupHeaderBg : null;
        if (bg) hdr.style.background = String(bg);
      }catch{}
      // 左側: 「[数字], [Fキー] ダイレクト選択」
      const left = document.createElement('div');
      try{ left.style.display='flex'; left.style.alignItems='center'; }catch{}
      // 数字 (kbd) + 直後のカンマ
      const kbdStyle = (el)=>{
        try{
          el.style.background = 'var(--six-kbd-bg, var(--six-help-kbd-bg, rgb(95,143,223)))';
          el.style.color = 'var(--six-kbd-fg, var(--six-help-kbd-fg, #000))';
          el.style.borderRadius = '0.18rem';
          el.style.padding = '0 0.22rem';
        }catch{}
      };
      const kNum = document.createElement('kbd'); kNum.textContent='数字'; kbdStyle(kNum);
      const comma = document.createElement('span'); comma.textContent = ',';
      try{ comma.style.marginLeft='0.25rem'; }catch{}
      const kF = document.createElement('kbd'); kF.textContent='Fキー'; kbdStyle(kF);
      const direct = document.createElement('span'); direct.textContent='ダイレクト選択';
      try{ direct.style.marginLeft = '0.42rem'; }catch{}
      // 3rem 左マージンは「数字,」ブロックに適用
      const numWrap = document.createElement('span');
      try{ numWrap.style.marginLeft='3rem'; }catch{}
      numWrap.appendChild(kNum); numWrap.appendChild(comma);
      left.appendChild(numWrap);
      left.appendChild(document.createTextNode(' '));
      left.appendChild(kF);
      left.appendChild(direct);
      // 入力状態に応じたグレー表示
      // - 候補ゼロ: 数字部分のみグレー（Fキー ダイレクト選択は常に有効表示）
      // - テキストフィルタ中（:b <text>）: 数字部分のみグレー
      if (noItems){
        try{ kNum.style.opacity='0.5'; comma.style.color='#777'; }catch{}
      } else if (isBWithSpaceAndMore){
        try{ kNum.style.opacity='0.5'; comma.style.color='#777'; }catch{}
      }
      // 右側: 「d バッファ破棄」
      const right = document.createElement('div');
      try{ right.style.display='flex'; right.style.alignItems='center'; right.style.marginLeft='1rem'; }catch{}
      const k = document.createElement('kbd'); k.textContent = 'd'; kbdStyle(k);
      try{ k.style.marginRight = '0.42rem'; }catch{}
      const txt = document.createElement('span'); txt.textContent = 'バッファ破棄';
      // d の利用可否: :b 以外、または候補ゼロならグレー
      if (!isBareB || noItems){ try{ k.style.opacity='0.45'; txt.style.color='#777'; }catch{} }
      hdr.appendChild(left); hdr.appendChild(right);
      right.appendChild(k); right.appendChild(txt);
      bufpopupInner.appendChild(hdr);
    }catch{}
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
      const num = document.createElement('span'); num.className='num';
      try{
        // 更新フラグ（*）：Fキー表示の左に固定幅で配置
        const chg = document.createElement('span');
        try{ chg.style.display='inline-block'; chg.style.width='1ch'; chg.style.marginRight='0.25rem'; }catch{}
        if (b && b.modified){ chg.textContent='*'; try{ chg.style.color='#d33'; }catch{} }
        num.appendChild(chg);
        const n = i+1;
        if (n>=1 && n<=8){
          const k = document.createElement('kbd'); k.textContent = 'F' + String(n);
          try{ k.style.background = 'var(--six-kbd-bg, var(--six-help-kbd-bg, rgb(95,143,223)))'; }catch{}
          try{ k.style.color = 'var(--six-kbd-fg, var(--six-help-kbd-fg, #000))'; }catch{}
          try{ k.style.borderRadius = '0.18rem'; k.style.padding = '0 0.22rem'; }catch{}
          num.appendChild(k);
        } else {
          num.textContent = _bufferNumberLabel(n);
        }
      }catch{ num.textContent = _bufferNumberLabel(i+1); }
      const name = document.createElement('span'); name.className='name';
      // WSLなど file:// のときはアクティブタブ表示に合わせて 'file:' を外した体裁へ
      let disp = b && b.name || '(untitled)';
      try{
        if (b && b.path && /^file:\/\//i.test(b.path)){
          const rel = _relativeDisplayPath(b.path);
          disp = rel && rel !== b.path ? rel : _prettyFileUrlLabel(b.path);
          if (!disp) disp = b.name || '(untitled)';
        }
      }catch{}
      name.textContent = disp;
      div.appendChild(num); div.appendChild(name);
      // 動的再バインド用に名前を保持（クリック時に現在一覧から再探索し stale クロージャを回避） (#848/#850)
      try{ div.dataset.entryName = String(it && it.name || ''); }catch{}
      div.addEventListener('click', ()=>{
        // クリック確定でも Esc 相当の終了処理 → 次フレームで切替 の順に統一
        let st0 = 0; try{ st0 = (editor && typeof editor.scrollTop==='number') ? (editor.scrollTop|0) : 0; }catch{}
        try{ _cmdExitAndRestoreView({ forImmediateSwitch:true }); }catch{}
        setTimeout(()=>{ try{ if (i !== currentIdx){ _switchToBuffer(i); } else { _keepViewportNoop(st0); } }catch{} }, 0);
        try{ setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0); }catch{}
      });
      return div;
    });
    items.forEach(el=>bufpopupInner.appendChild(el));
    // アクティブ項目が見切れていれば可視範囲にスクロール
    try{ const act = bufpopupInner.querySelector('.item.active'); if (act && act.scrollIntoView) act.scrollIntoView({block:'nearest', inline:'nearest'}); }catch{}
    // 可視スナップショット更新（現在表示している一覧/基点を保存）
    try{
      const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
      _fileVisibleBaseKey = curKey;
      _fileVisibleEntries = (_fileEntries && Array.isArray(_fileEntries)) ? _fileEntries.slice() : [];
    }catch{}
  }
  function _bufPopupShow(){ if (!bufpopup) return; try{ if (typeof _encPopupHide==='function') _encPopupHide(); }catch{} bufpopup.dataset.kind='buf'; bufpopup.style.display=''; if (!(_bufSel>=0)) _bufSel=Math.max(0,Math.min(buffers.length-1,currentIdx)); _layoutBufPopup(); _bufPopupRender(); }
  function _bufPopupHide(){ if (!bufpopup) return; if (_bufPopupVisible()) bufpopup.style.display='none'; }
  function _bufPopupMove(d){ if (!bufpopup) return; _bufSel=_bufSel+d; if (_bufSel<0) _bufSel=0; _bufPopupRender(); }

  function _extractBufQuery(){
    if (!cmdinput) return '';
    const v = cmdinput.value.trim();
    const m = v.match(/^:?[\s]*b\s+(.*)$/i);
    return m ? m[1] : '';
  }

  // runCommand へのフック（Enter確定）

  /*********************************************************
   * File popup (:e ...)
   *********************************************************/
  // 簡易キャッシュ（ディレクトリURL→エントリ）
  const _dirCache = new Map();
  let _fileSel = 0;              // 可視リスト内選択
  let _fileFilter = '';
  let _fileBaseURL = null;       // URL オブジェクト（末尾/を保証）
  let _fileTypedDirRaw = '';     // ユーザーが :e の後に入力したディレクトリ部分（最後の区切りまで）
  // _fileRelativeMode 廃止 (#853)
  let _fileEntries = [];         // {name,isDir,url}
  let _fileLoading = false;      // ディレクトリ一覧ロード中か
  let _fileListTimer = null;     // :e 入力時の列挙ディレイ用
  // 選択直後の短期リトライ管理
  let _fileJustNavAt = 0;        // 直近のディレクトリ選択での遷移発火時刻
  let _fileNavRetryCount = 0;    // 選択直後の追加再試行回数
  // 親へ戻った直後に、親一覧で「今いたフォルダ」を選択するための一時的なターゲット名
  let _filePostSelectName = null;
  // 直近の安定した一覧/基点（"//" 入力途中で再利用）
  let _fileStableEntries = [];
  let _fileStableBaseKey = null; // _ensureSlash(_fileBaseURL).toString()
  // 直前に“実際に画面表示していた”一覧（レースや未確定ホスト操作時の復元に使う）
  let _fileVisibleEntries = [];
  let _fileVisibleBaseKey = null;
  // 親ディレクトリ移動デバッグフラグ / ログバッファ（グローバルに保持して再初期化を防ぐ）
  if (typeof window._fileParentDebug === 'undefined') window._fileParentDebug = false;
  let _fileParentLogs = [];
  function _fileParentLog(entry){
    try{
      if (!window._fileParentDebug && entry && entry.phase !== 'debug-toggle') return;
      const ts = new Date().toISOString();
      const rec = Object.assign({ ts }, entry||{});
      _fileParentLogs.push(rec);
      if (_fileParentLogs.length > 200) _fileParentLogs.splice(0, _fileParentLogs.length - 200);
      console.debug('[parentNav]', rec);
    }catch{}
  }
  // 子ディレクトリクリック遷移デバッグ (#844-#847)
  if (typeof window._fileClickDebug === 'undefined') window._fileClickDebug = false;
  let _fileClickLogs = [];
  function _fileClickLog(entry){
    try{
      if (!window._fileClickDebug) return;
      const ts = new Date().toISOString();
      const rec = Object.assign({ ts }, entry||{});
      _fileClickLogs.push(rec);
      if (_fileClickLogs.length > 400) _fileClickLogs.splice(0, _fileClickLogs.length - 400);
      console.debug('[clickDir]', rec);
    }catch{}
  }
  let _fileInvalid = false; // 不正な :e 入力中（一覧の代わりに '********' を表示）
  let _filePopupNoUp = false; // 特殊ケース（":e //" の疑似候補表示など）で ".." を消す
  // 選択ドリルダウン時に、:e 入力ハンドラのデバウンスをバイパスするためのキー
  let _fileNavPendingKey = null;
  // 入力文字列が候補のいずれにもマッチしないときは、選択の塗り潰しを抑制（Enter は入力優先の新仕様 #164）
  let _fileSelMuted = false;
  // :e ポップアップを開いた当初の基点（Esc キャンセルで復元するため）
  let _fileStartBaseURL = null;
  // Esc キャンセル後、次の引数なし :e の開始基点を上書きするための一時記憶
  let _fileNextStartBaseURL = null;
  // ポップアップ起動直後に現在選択（通常 ".."）を入力欄へ1度だけ反映するためのフラグ
  let _fileReflectedOnOpen = false;
  // 初回裸 :e 起動時 ".." 自動補完用 (#758)
  let _fileInitialUpPrefill = false;
  let _fileInitialSelectActive = false; // 初回自動補完で ".." が選択状態
  // 子ディレクトリ降下直後の ".." 自動補完トリガ (#761)
  // _filePostNavUpPrefill 廃止 (#856 ディレクトリ降下後の ".." 自動補完を撤去)
  let _fileAutoUpPrefilledTransient = false; // 降下直後1回のみの状態識別
  // ディレクトリ移動直後のみ、ポップアップ選択→入力欄への反映を抑止し、Enterも無効化するための猶予ガード
  // Tab 補完は引き続き有効。タイムスタンプで短時間のみ適用する。
  let _fileReflectGuardUntil = 0;
  // 相対モード初回 ':e ' で開いた直後一度だけ先頭候補を補完したかどうか
  // _fileInitialRelPrefillDone 廃止 (#853)

  // NTFS で不許可な名前かどうかを判定（WSL配下の表示で選択不可にする目的）
  function _isNtfsIllegalName(name){
    try{
      const s = String(name||'');
      // 親ディレクトリ表現 ".." はファイル名ではない（ナビゲーション用途）ため常に許可
      if (s === '..') return false;
      // 禁止文字: < > : " | ? *
      if (/[<>:"|?*]/.test(s)) return true;
      // UI 表示上コロンが私用領域文字（PUA）へ置換されるケース (例 U+F03A '') もコロン扱いで禁止 (#861)
      if (/\uF03A/.test(s)) return true;
      // よくある「代替コロン」類（全角/小さいコロン/比率記号など）も念のため捕捉
      if (/[\uFF1A\uFE55\u2236\u02D0\u02F8]/.test(s)) return true; // ：﹕∶ː˸
      // モジバケ等で %3A が残っている（または二重エンコード %253A）場合も無効扱い
      if (/%25?3a/i.test(s)) return true;
      // PUA コロン (U+F03A) のエンコード形 (%EF%80%BA) も無効扱い (#861)
      if (/%ef%80%ba/i.test(s)) return true;
      // 末尾のピリオド/スペースは禁止
      if (/[\. ]$/.test(s)) return true;
      // 予約名（拡張子の前のベース名で判定、拡張子が付いていても不可）
      const base = s.split('.')[0].toUpperCase();
      const reserved = new Set(['CON','PRN','AUX','NUL','COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9','LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9']);
      if (reserved.has(base)) return true;
      return false;
    }catch{ return false; }
  }

  // URL の末尾セグメントからNTFS禁則を検出（URL上の %3A 等も拾う）
  function _urlLastSegHasNtfsBad(urlStr){
    try{
      const u = new URL(String(urlStr||''));
      const parts = String(u.pathname||'').split('/').filter(Boolean);
      const last = parts.length ? parts[parts.length-1] : '';
      // まずデコードした実名で判定
      try{ const decoded = decodeURIComponent(last); if (_isNtfsIllegalName(decoded)) return true; }catch{}
      // デコード前の生文字列にも ':' が含まれていれば無効
      if (/:/.test(last)) return true;
      // デコード不可や保険として、エンコード表現にも含まれていれば無効扱い
      if (/%3a/i.test(last)) return true;      // ':'
      if (/%253a/i.test(last)) return true;    // 二重エンコードケース
      // PUA コロン (U+F03A) の UTF-8 エンコード (%EF%80%BA) を含む末尾も無効 (#861)
      if (/%ef%80%ba/i.test(last)) return true;
      // その他の禁則（" < > | ? * など）は encodeURIComponent 済みなら %22 等になるが、
      // Linux 側で実際に使われ得るのは ':' が主目的のため、ここでは ':' を優先検出。
      return false;
    }catch{ return false; }
  }

  // 名前ヒューリスティクス（WSL環境で良く見る ADS 由来）
  function _nameHintsNtfsIllegalLike(name){
    try{
      const s = String(name||'');
      // 代表例: "xxx:Zone.Identifier" の派生（モジバケや全角コロン込みでラフに検出）
      if (/zone\.identifier/i.test(s)){
        if (/:/.test(s)) return true;
        if(/[\uFF1A\uFE55\u2236\u02D0\u02F8\uF03A]/.test(s)) return true; // ：﹕∶ː˸ + 私用領域コロン (#861)
        if (/%25?3a/i.test(s)) return true; // %3A or %253A
        if (/%ef%80%ba/i.test(s)) return true; // PUA コロンエンコード (#861)
        // 区切りが非英数字・非ドットで不自然なケースも無効扱い
        if (/[^A-Za-z0-9._-]Zone\.Identifier/i.test(s)) return true;
      }
      return false;
    }catch{ return false; }
  }

  // 統合 NTFS 禁止名判定: ファイル/ディレクトリ名と URL の末尾から包括的に検出 (#862)
  function _isNtfsProhibitedNameAny(name, url){
    try{
      const fname = String(name||'');
      if (_isNtfsIllegalName(fname)) return true;
      if (_nameHintsNtfsIllegalLike(fname)) return true;
      if (/[:]/.test(fname)) return true; // 直接コロン
      if (/\uF03A/.test(fname)) return true; // PUA コロン
      if (/%25?3a/i.test(fname)) return true; // エンコード/二重エンコード
      if (/%ef%80%ba/i.test(fname)) return true; // PUA コロン UTF-8 (%EF%80%BA)
      if (url && _urlLastSegHasNtfsBad(url)) return true;
      return false;
    }catch{ return false; }
  }

  function _ensureSlash(u){
    try{
      const x = new URL(u);
      if (!x.pathname.endsWith('/')) x.pathname += '/';
      return x;
    }catch{ return null; }
  }

  // Convert file:// URL to Windows/UNC fs path for local API
  function _fsPathFromFileURL(urlLike){
    try{
      const u = (urlLike instanceof URL) ? urlLike : new URL(String(urlLike||''));
      if (u.protocol !== 'file:') return null;
      const host = u.host || '';
      const path = decodeURIComponent(u.pathname || '');
      if (host){
        return ('\\\\' + host + path.replace(/\//g,'\\'));
      }
      const m = path.match(/^\/([A-Za-z]:)(\/.*)?$/);
      if (m){
        const drive = m[1];
        const rest  = (m[2]||'');
        return drive + rest.replace(/\//g,'\\');
      }
      return null;
    }catch{ return null; }
  }

  async function _saveToURL(urlStr, textUtf8){
    try{
      // 書き込みはサーキットブレーカー無視で常に試行（_apiBase があれば）
      if (!_apiBase) { toast('save unavailable (no API)'); return false; }
      const u = new URL(urlStr);
      if (u.protocol !== 'file:'){ toast('save only supports file://'); return false; }
  // 保存方針: 本文は常にUTF-8で送信し、サーバ側 /write の enc/eol/bom で再符号化
  const b = currentBuffer();
  const enc = (b&&b.enc)||'utf-8';
  const ff = (b&&b.ff)||'unix';
  const bom = !!(b&&b.bom);
  let out = String(textUtf8||'');
  // 改行コード変換はサーバ側に委譲するため、ここでは行わない（サーバがeolで実施）
  let payloadBytes = new TextEncoder().encode(out);
  // Safety: 空→UTF-8 リカバリ
  try{ if ((payloadBytes && payloadBytes.byteLength===0) && out && out.length>0){ payloadBytes = new TextEncoder().encode(out); } }catch{}
      let fsPath = _fsPathFromFileURL(u);
  if (!fsPath){ toast('invalid target path'); try{ _triggerVisualBell(); }catch{} return false; }
      // クエリ組立（enc/eol/bom/strict）
      const encParam = (enc && enc.toLowerCase()==='shift_jis') ? 'sjis' : 'utf8';
      const eolParam = (ff==='dos' ? 'dos' : (ff==='mac' ? 'mac' : 'unix'));
      const bomParam = (bom && encParam==='utf8') ? '&bom=1' : '';
      const apiUrl = _apiBase + 'write?fs=' + encodeURIComponent(fsPath) + '&enc=' + encParam + '&eol=' + eolParam + bomParam + '&strict=0';
      const makeBody = ()=>{
        // Send raw bytes without setting Content-Type to avoid CORS preflight (#380)
        // Use the exact Uint8Array view to prevent implicit Blob type headers.
        try{
          if (payloadBytes && (payloadBytes.byteOffset!==0 || payloadBytes.byteLength !== payloadBytes.buffer.byteLength)){
            return new Uint8Array(payloadBytes); // copies the slice
          } else {
            return payloadBytes; // direct
          }
        }catch{ return payloadBytes; }
      };
      let lastErr = null;
      for (let attempt=0; attempt<2; attempt++){
        const ac = (window.AbortController ? new AbortController() : null);
        const to = setTimeout(()=>{ try{ ac && ac.abort(); }catch{} }, 8000);
        try{
          const resp = await fetch(apiUrl, { method:'POST', body: makeBody(), signal: (ac?ac.signal:undefined) });
          try{ clearTimeout(to); }catch{}
          if (resp.ok){ try{ _apiNoteSuccess(); }catch{} return true; }
          // HTTP error: report and stop (再試行はネットワークエラー時のみ)
          let msg = 'write failed';
          try{
            const rt = await resp.text();
            try{ const j = JSON.parse(rt); if (j && j.error) msg = 'write failed: ' + j.error; else if (rt) msg = 'write failed: ' + rt; }
            catch{ if (rt) msg = 'write failed: ' + rt; }
          }catch{}
          try{ if ((!msg || msg==='write failed') && resp){ msg = 'write failed: ' + resp.status + ' ' + (resp.statusText||''); } }catch{}
          try{ _apiNoteFailure(); }catch{}
          toast(msg);
          return false;
        }catch(e){
          lastErr = e;
          // ネットワーク層の失敗（例: 接続拒否/一時停止）: 一度だけ短い遅延で再試行
          const emsg = (e && (e.message||'')) + '';
          const isAbort = (e && (e.name==='AbortError'));
          const isNet = /Failed to fetch|NetworkError|ERR_CONNECTION|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH/i.test(emsg);
          if (attempt===0 && !isAbort){
            if (isNet){ try{ _apiQuickReconnect(); }catch{} }
            const hint = isNet ? ' (reconnecting...)' : '';
            toast('write: network error' + hint, 900);
            await new Promise(r=>setTimeout(r, 900));
            continue;
          }
          break;
        }
      }
      // 最終失敗
  toast('write failed: connection'); try{ _triggerVisualBell(); }catch{}
      try{ _apiNoteFailure(); }catch{}
      return false;
  }catch(e){ toast('write failed'); try{ _triggerVisualBell(); }catch{} return false; }
  }

  // Normalize internal text right before save: preserve as-is (no forced trailing newline).
  function _normalizeTextForSaveInternal(s){
    try{
      return String(s||'');
    }catch{ return String(s||''); }
  }

  // Wrapper: warn when previously ignored external change; offer 3 choices
  // Returns {status:'saved'|'discarded'|'cancel'}
  async function _saveToURLWithExternalCheck(b, urlStr, textUtf8){
    try{
      if (b && b._externalChangeIgnored){
        const label = b.path ? _prettyFileUrlLabel(b.path) : (b.name||'(untitled)');
        const id = await choiceModal({ title:'外部変更の可能性', detail:`このファイルは外部で編集されました。どうしますか？\n${label}`, buttons:[{id:'force',label:'強制保存',primary:true},{id:'discard',label:'編集内容を破棄'},{id:'cancel',label:'キャンセル',danger:true}] });
        if (id==='force'){
          const ok = await _saveToURL(urlStr, textUtf8);
          if (ok){
            try{
              const meta = await _statFileMeta(b.path||urlStr);
              if (meta){
                if (typeof meta.mtime === 'number') b._extMtime = meta.mtime;
                if (typeof meta.size  === 'number') b._extSize  = meta.size;
              }
              b._externalChangeIgnored=false;
              /* baseline log removed: after force-save */
            }catch{}
            return { status:'saved' };
          }
          return { status:'cancel' };
        } else if (id==='discard'){
          if (b && b.path){
            await _loadFromPath(b.path, null, { mode:'replace' });
            try{
              const meta = await _statFileMeta(b.path);
              if (meta){
                if (typeof meta.mtime === 'number') b._extMtime = meta.mtime;
                if (typeof meta.size  === 'number') b._extSize  = meta.size;
              }
              b._externalChangeIgnored=false;
              /* baseline log removed: after discard-reload */
            }catch{}
          }
          return { status:'discarded' };
        } else {
          return { status:'cancel' };
        }
      } else {
        const ok = await _saveToURL(urlStr, textUtf8);
        if (ok){
          try{
            const meta = await _statFileMeta(b && (b.path||urlStr));
            if (b && meta){
              if (typeof meta.mtime === 'number') b._extMtime = meta.mtime;
              if (typeof meta.size  === 'number') b._extSize  = meta.size;
              b._externalChangeIgnored=false;
              /* baseline log removed: after normal-save */
            } else if (b){
              // Retry once later (some hosts may populate mtime/size slightly after save completes)
              try{
                setTimeout(async()=>{
                  try{
                    const meta2 = await _statFileMeta(b && (b.path||urlStr));
                    if (meta2){
                      if (typeof meta2.mtime === 'number') b._extMtime = meta2.mtime;
                      if (typeof meta2.size  === 'number') b._extSize  = meta2.size;
                      b._externalChangeIgnored=false;
                      /* baseline log removed: after save (delayed) */
                      try{ _schedulePersist('meta-retry'); }catch{}
                    }
                  }catch{}
                }, 800);
              }catch{}
            }
          }catch{}
        }
        return { status: ok ? 'saved' : 'cancel' };
      }
    }catch{ return { status:'cancel' }; }
  }

  // Minimal Shift_JIS encoder (ASCII + halfwidth-kana + common mappings). Returns Uint8Array.
  function _encodeShiftJIS(str){
    const bytes = [];
    for (let i=0;i<str.length;i++){
      let code = str.charCodeAt(i);
      // Surrogate pair collapse to replacement
      if (code >= 0xD800 && code <= 0xDBFF && i+1<str.length){
        const low = str.charCodeAt(i+1);
        if (low >= 0xDC00 && low <= 0xDFFF){ i++; code = 0x003F; } // '?'
      }
      if (code <= 0x7F){
        // ASCII as-is (except map U+005C backslash remains 0x5C)
        bytes.push(code);
        continue;
      }
      // Map common single-byte overrides in CP932
      if (code === 0x00A5){ bytes.push(0x5C); continue; }        // U+00A5 YEN SIGN -> 0x5C
      if (code === 0x203E){ bytes.push(0x7E); continue; }        // U+203E OVERLINE -> 0x7E
      // Halfwidth katakana U+FF61..U+FF9F -> 0xA1..0xDF
      if (code >= 0xFF61 && code <= 0xFF9F){ bytes.push(0xA1 + (code - 0xFF61)); continue; }
      // Not supported: map to '?'
      bytes.push(0x3F);
    }
    return new Uint8Array(bytes);
  }

  // UNC 共有ルート判定: file:////host/share/ （先頭セグメントが1個のみ）
  function _isUncShareRoot(u){
    try{
      const x = (u instanceof URL) ? u : new URL(u);
      if (x.protocol !== 'file:' || !x.host) return false;
      const segs = (x.pathname||'').split('/').filter(s=>s.length>0);
      return segs.length === 1; // 例: /Ubuntu/
    }catch{ return false; }
  }

  // UNC 向けのクイック再試行付き列挙（初回が空なら短い遅延で数回再試行）
  async function _listDirEntriesWithQuickRetry(dirUrl){
    const u = _ensureSlash(dirUrl);
    let list = await _listDirEntries(u);
    if (Array.isArray(list) && list.length > 0) return list;
    // UNC 全般（ホストがある file://）は列挙が揺れやすいので短時間で数回だけ再試行
    const isUnc = (function(){ try{ return (u && u.protocol==='file:' && !!u.host); }catch{ return false; } })();
    if (isUnc){
      // UNC は初回直後に空で返る揺らぎがあるため、再試行回数をやや増やす
      const delays = [250, 450, 800, 1200, 1800];
      for (const d of delays){
        // ベースが変わっていたら中断
        try{ const curKey = _ensureSlash(_fileBaseURL)?.toString()||null; if (!curKey || curKey !== _ensureSlash(u)?.toString()) break; }catch{}
        await new Promise(r=>setTimeout(r, d));
        // 同一ベースを確認して再列挙
        const again = await _listDirEntries(u);
        if (Array.isArray(again) && again.length > 0){ list = again; break; }
      }
      // なお空のままなら、バックグラウンド再試行スケジューラへ委譲
      try{ const key = _ensureSlash(u)?.toString(); if (key) _scheduleDirRetry(key); }catch{}
    }
    return list;
  }

  // 空結果時のバックグラウンド再試行を管理（key: dirUrlString → {tries,timer}）
  const _dirRetryState = new Map();
  function _scheduleDirRetry(key){
    if (!_apiBase) return;
    const cur = _dirRetryState.get(key) || { tries: 0, timer: null };
    if (cur.tries >= 3) return; // 最大3回まで
    const delays = [1000, 2000, 4000];
    const delay = delays[cur.tries] || 4000;
    cur.tries++;
    if (cur.timer) { try{ clearTimeout(cur.timer); }catch{} }
    cur.timer = setTimeout(async ()=>{
      try{
        const apiUrl2 = _apiBase + 'dir?cwd=' + encodeURIComponent(key);
        const jx = await _fetchJSONWithTimeout(apiUrl2, 7000);
        if (jx && Array.isArray(jx.entries) && jx.entries.length){
          const arrx = jx.entries.map(e=>({ name: e.name, isDir: !!e.isDir, url: String(e.url||''), size: (typeof e.size==='number'?e.size:null), mtime: (typeof e.mtime==='number'?e.mtime:null) }));
          _dirCache.set(key, arrx);
          // まだ同じディレクトリを見ているなら即時反映
          try{
            const curKey = _ensureSlash(_fileBaseURL)?.toString();
            if (curKey === key){ _fileEntries = arrx; _filePopupRender(); }
          }catch{}
          _dirRetryState.delete(key);
          return;
        }
      } catch {}
      // 失敗 → 次の遅延で再試行
      _scheduleDirRetry(key);
    }, delay);
    _dirRetryState.set(key, cur);
  }
  async function _listDirEntries(dirUrl){
    try{
      const u = _ensureSlash(dirUrl);
      if (!u) return [];
      // ホスト直下 (file:////host/) は _listDirEntries の対象外: shares は別経路で取得する
      try{ if (_isHostRoot(u)) return []; }catch{}
      const key = u.toString();
      if (_dirCache.has(key)) return _dirCache.get(key);
      // URL 正規化ヘルパー（APIのentries.urlが省略/相対/Windowsパスの場合に補う）
      const makeEntryUrl = (baseUrlObj, name, isDir, urlField)=>{
        try{
          const s = String(urlField||'');
          if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s; // 既に絶対URL
          const seg = encodeURIComponent(String(name||'')) + (isDir?'/':'');
          return new URL(seg, baseUrlObj).toString();
        }catch{ return ''; }
      };

      // Windows パス推定ヘルパー（file:///C:/... または UNC）
      const winPathFromFileURL = (urlObj)=>{
        try{
          if (!urlObj || urlObj.protocol !== 'file:') return null;
          const host = urlObj.host; // '' for local drive, 'server' for UNC
          const path = decodeURIComponent(urlObj.pathname || '');
          if (host){
            // UNC: file:////server/share/...
            const p = ('\\\\' + host + path.replace(/\//g,'\\'));
            return p;
          }
          // local drive: '/C:/Users/...'
          const m = path.match(/^\/([A-Za-z]:)(\/.*)?$/);
          if (m){
            const drive = m[1];
            const rest  = (m[2]||'');
            return drive + rest.replace(/\//g,'\\');
          }
          return null;
        }catch{ return null; }
      };

      // 1) ループバック API 優先（cwd=）。UNC は一時的無効化中でも試す。
      const isUncPre = (function(){ try{ return (u.protocol==='file:' && !!u.host); }catch{ return false; } })();
      const apiCanTry = _apiIsEnabled() || isUncPre;
      if (apiCanTry){
        try{
          // UNC の場合は fs= 優先で列挙（Uri.LocalPath 解決の揺れを回避）
          if (isUncPre){
            try{
              const fsPath0 = winPathFromFileURL(u);
              // 追加: WSL 用に "\\wsl$" 形式も試す（環境により wsl.localhost と相互に可/不可があるため）
              let fsPathWslAlt = null;
              try{
                const host = u.host;
                if (host && host.toLowerCase()==='wsl.localhost'){
                  const p = decodeURIComponent(u.pathname||'');
                  const segs = p.split('/').filter(s=>s.length>0);
                  if (segs.length>=1){
                    const distro = segs[0];
                    const rest = segs.slice(1).join('\\');
                    fsPathWslAlt = rest ? (`\\\\wsl$\\${distro}\\${rest}`) : (`\\\\wsl$\\${distro}\\`);
                    // URL がディレクトリを指している場合は末尾に'\\'を付与
                    try{ if ((u.pathname||'').endsWith('/') && !fsPathWslAlt.endsWith('\\')) fsPathWslAlt += '\\'; }catch{}
                  }
                }
              }catch{}
              const tryFs = async (fsPath)=>{
                const apiFs = _apiBase + 'dir?fs=' + encodeURIComponent(fsPath);
                let jf; const timeoutFs = 6000;
                jf = await _fetchJSONWithTimeout(apiFs, timeoutFs); try{ _apiNoteSuccess(); }catch{}
                if (jf && Array.isArray(jf.entries)){
                  const arrFs = jf.entries.map(e=>{
                    const n = e.name; const d = !!e.isDir; const url = makeEntryUrl(u, n, d, e.url);
                    return { name: n, isDir: d, url, size: (typeof e.size==='number'?e.size:null), mtime: (typeof e.mtime==='number'?e.mtime:null) };
                  });
                  if (arrFs.length > 0){ _dirCache.set(key, arrFs); return arrFs; }
                }
                return null;
              };
              // まず wsl$ を優先、その後 wsl.localhost を試す
              if (fsPathWslAlt){
                try{ const r = await tryFs(fsPathWslAlt); if (r) return r; }catch(ea){ if (_apiIsEnabled()){ try{ _apiNoteFailure(); }catch{} } }
              }
              if (fsPath0){
                try{ if ((u.pathname||'').endsWith('/') && !/\\$/.test(fsPath0)) fsPath0 += '\\'; }catch{}
                try{ const r0 = await tryFs(fsPath0); if (r0) return r0; }catch(e0){ if (_apiIsEnabled()){ try{ _apiNoteFailure(); }catch{} } }
              }
            }catch{}
          }
          const apiUrl = _apiBase + 'dir?cwd=' + encodeURIComponent(key);
          let j;
          const isUnc = isUncPre;
          const timeout1 = isUnc ? 6000 : 2000;
          try{ j = await _fetchJSONWithTimeout(apiUrl, timeout1); try{ _apiNoteSuccess(); }catch{} }catch(e){ if (_apiIsEnabled()){ try{ _apiNoteFailure(); }catch{} } throw e; }
          if (j && Array.isArray(j.entries)){
            // API 正常応答: size / mtime も保持して外部変更検出の基礎情報に使う (#477)
            const arr = j.entries.map(e=>{
              const n = e.name; const d = !!e.isDir; const url = makeEntryUrl(u, n, d, e.url);
              const sz = (typeof e.size === 'number') ? e.size : null;
              const mt = (typeof e.mtime === 'number') ? e.mtime : null;
              return { name: n, isDir: d, url, size: sz, mtime: mt };
            });
            if (arr.length > 0){ _dirCache.set(key, arr); return arr; }
            // 空なら fs= でも試す（Uri.LocalPath 解決の失敗対策）
            try{
              const fsPath = winPathFromFileURL(u);
              if (fsPath){
                const apiFs = _apiBase + 'dir?fs=' + encodeURIComponent(fsPath);
                let j2;
                const timeout2 = isUnc ? 6000 : 2000;
                try{ j2 = await _fetchJSONWithTimeout(apiFs, timeout2); try{ _apiNoteSuccess(); }catch{} }catch(e2){ if (_apiIsEnabled()){ try{ _apiNoteFailure(); }catch{} } throw e2; }
                if (j2 && Array.isArray(j2.entries)){
                  const arr2 = j2.entries.map(e=>{
                    const n = e.name; const d = !!e.isDir; const url = makeEntryUrl(u, n, d, e.url);
                    const sz = (typeof e.size === 'number') ? e.size : null;
                    const mt = (typeof e.mtime === 'number') ? e.mtime : null;
                    return { name: n, isDir: d, url, size: sz, mtime: mt };
                  });
                  if (arr2.length > 0){ _dirCache.set(key, arr2); return arr2; }
                }
              }
            } catch (e2){ console.warn('API fs fallback failed', e2); }
          }
        } catch (e) {
          console.warn('API listing failed, trying fs fallback', e);
          // タイムアウト等でも fs= を試す
          try{
            const fsPath = winPathFromFileURL(u);
            if (fsPath){
              const apiFs = _apiBase + 'dir?fs=' + encodeURIComponent(fsPath);
              let j2;
              // UNC(\\host\share\...) は遅延しやすいためタイムアウトを延長。isUnc 未定義エラー対策で都度判定 (#850)
              const _isUncFs = (p)=>{ try{ return /^\\\\[^\\]+/.test(p); }catch{ return false; } };
              const timeout3 = _isUncFs(fsPath) ? 6000 : 2000;
              try{ j2 = await _fetchJSONWithTimeout(apiFs, timeout3); try{ _apiNoteSuccess(); }catch{} }catch(e3){ if (_apiIsEnabled()){ try{ _apiNoteFailure(); }catch{} } throw e3; }
              if (j2 && Array.isArray(j2.entries)){
                const arr2 = j2.entries.map(e=>{
                  const n = e.name; const d = !!e.isDir; const url = makeEntryUrl(u, n, d, e.url);
                  const sz = (typeof e.size === 'number') ? e.size : null;
                  const mt = (typeof e.mtime === 'number') ? e.mtime : null;
                  return { name: n, isDir: d, url, size: sz, mtime: mt };
                });
                if (arr2.length > 0){ _dirCache.set(key, arr2); return arr2; }
              }
            }
          } catch (e3){ console.warn('API fs fallback failed after API error', e3); }
          // 最後に file:// 解析へ
        }
      }

      // 2) file:// ディレクトリインデックス解析（fetch→XHRフォールバック）
      let html = '';
      try {
        html = await _fetchTextWithTimeout(key, 3000);
      } catch {
        // フォールバックで XHR を試す
        html = await new Promise((resolve, reject)=>{
          try{
            const xhr = new XMLHttpRequest();
            xhr.open('GET', key, true);
            xhr.responseType = 'text';
            try { xhr.timeout = 2500; } catch {}
            xhr.onload = ()=>{
              // status 0 でも responseText が空の場合は失敗扱い
              if (xhr.responseText && (xhr.status === 0 || (xhr.status>=200 && xhr.status<300))) resolve(xhr.responseText);
              else reject(new Error('dir XHR empty'));
            };
            xhr.onerror = ()=>reject(new Error('dir XHR error'));
            xhr.ontimeout = ()=>reject(new Error('dir XHR timeout'));
            xhr.send();
          }catch(e){ reject(e); }
        });
      }
      // file:// ディレクトリインデックスHTMLから <a href> を抽出
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const links = Array.from(doc.querySelectorAll('a[href]'));
  const out = [];
      for (const a of links){
        const href = a.getAttribute('href');
        if (!href) continue;
        if (href === '../' || href === './' || href.startsWith('#')) continue;
        try{
          const resolved = new URL(href, u);
          const isDir = /\/$/.test(resolved.pathname);
          // name は URL パス末尾から復元を第一優先（文字化けを避ける）。失敗時のみ textContent を使用。
          let nm = '';
          try{ const parts = resolved.pathname.split('/').filter(Boolean); nm = decodeURIComponent(parts[parts.length-1]||''); }catch{}
          if (!nm){ nm = (a.textContent||'').trim(); }
          out.push({ name: nm, isDir, url: resolved.toString() });
        }catch{}
      }
      // 重複排除+並び（ディレクトリ→ファイル、名前昇順）
      const seen = new Set();
      const dedup = [];
      for (const e of out){ const k=e.url; if (seen.has(k)) continue; seen.add(k); dedup.push(e); }
      dedup.sort((a,b)=> (a.isDir===b.isDir) ? a.name.localeCompare(b.name) : (a.isDir? -1: 1));
      if (dedup.length > 0) {
        _dirCache.set(key, dedup);
        return dedup;
      }
      // 空だった場合、API があるなら複数回のバックグラウンド再試行（指数バックオフ）
  if (_apiIsEnabled()){ _scheduleDirRetry(key); }
      return dedup;
    }catch(e){ console.warn('dir list failed', e); return []; }
  }

  function _filePopupComputeList(){
    // 仕様変更: 疑似候補 ".."（親ディレクトリ行）を一覧に挿入しない。
    // 親移動は Alt+U で行う。ここでは _fileEntries の内容のみを描画する。
    const list = [];
    // 共通 NTFS 禁止名判定（WSL/UNC/ローカルを問わず列挙時にマーキング） #862
    for (const e of _fileEntries){
      if (!e){ continue; }
      const disabled = _isNtfsProhibitedNameAny(e.name||'', e.url||'');
      if (disabled){ list.push(Object.assign({}, e, { _disabled: true })); continue; }
      list.push(e);
    }
    return list;
  }
  function _collapseDotDotPath(s){
    if (!s) return '';
    // 絶対/相対を問わず ".." を畳み込む（UNC "//host/..." や Windows ドライブ "C:/..." も考慮）
    const norm = s.replace(/\\/g,'/');
    const hadTrail = norm.endsWith('/');
    let prefix = '';
    let rest = norm;
    // UNC 先頭 "//"
    if (rest.startsWith('//')){
      prefix = '//';
      rest = rest.slice(2);
    } else if (/^[A-Za-z]:\//.test(rest)){
      // Windows ドライブ
      prefix = rest.slice(0, 3); // 例: "C:/"
      rest = rest.slice(3);
    } else if (rest.startsWith('/')){
      // ルート開始（POSIX）
      prefix = '/';
      rest = rest.slice(1);
    }
    const parts = rest.split('/');
    const stack = [];
    const isAbsolute = !!prefix;
    for (const raw of parts){
      const seg = raw.trim();
      if (!seg || seg === '.') continue;
      if (seg === '..'){
        if (stack.length > 0){
          stack.pop();
        } else {
          // 絶対パスではこれ以上は遡らない。相対なら先頭に残す。
          if (!isAbsolute) stack.push('..');
        }
      } else {
        stack.push(seg);
      }
    }
    let out = prefix + stack.join('/');
    if (hadTrail && out && !out.endsWith('/')) out += '/';
    return out;
  }

  // Normalize colon-like glyph variants to plain ASCII ':' for stable display & input reflection (#574)
  // Includes: Private Use U+F03A, Fullwidth U+FF1A, Ratio U+2236, Modifier Letter U+02D0, Latin Small Letter : U+A789, Small Form Variants U+FE55
  // (Some fonts substitute ':' with PUA glyphs; unify them here.)
  function _normalizeColonVariants(s){
    try{
      return String(s||'').replace(/[\uF03A\uFF1A\u2236\u02D0\uA789\uFE55]/g, ':');
    }catch{ return String(s||''); }
  }

  function _filePopupRender(){
    if (!bufpopup || !bufpopupInner) return;
    // Re-entrancy guard to prevent overlapping renders causing visual glitches
    if (window.__sixFileRendering) return; window.__sixFileRendering = true;
    bufpopup.dataset.kind = 'file';
    bufpopupInner.innerHTML = '';
    // Path header (breadcrumb) (#830)
    try{
      const header = document.createElement('div'); header.className='path-header';
      const baseDir = (function(){ try{ return _fileBaseURL ? _ensureSlash(_fileBaseURL) : null; }catch{ return null; } })();
      const hostPart = (function(){ try{ return baseDir ? (baseDir.host||'') : ''; }catch{ return ''; } })();
      let rawPath = (function(){ try{ return baseDir ? String(baseDir.pathname||'') : ''; }catch{ return ''; } })();
      rawPath = rawPath.replace(/\\/g,'/');
      // Remove leading '/' (file:///C:/Users -> /C:/Users)
      if (rawPath.startsWith('/')) rawPath = rawPath.slice(1);
      // Ensure ends with '/' for directory
      if (rawPath && !/\/$/ .test(rawPath)) rawPath += '/';
      // UNC/WSL host semantics: When hostPart present, path as-is (do not prepend host again in segment labels)
      // Split into segments (ignore final empty segment after trailing '/')
      let segs = rawPath.split('/').filter(s=>s.length>0);
      // Windows ドライブ先頭は 'C:/' 形式で表示 (末尾スラッシュ保持)
      // Windowsドライブ表示は "C:" のまま (末尾スラッシュ付与しない) (#833)
      try{ if (segs.length>0 && /^[A-Za-z]:\/$/.test(segs[0])) segs[0] = segs[0].replace(/\/$/, ''); }catch{}
      // Build cumulative paths
      let cumulative = [];
      const pushSlash = ()=>{ const slash=document.createElement('span'); slash.className='slash'; slash.textContent=' / '; header.appendChild(slash); };
      // WSL プレフィックス表示 (非クリック文字列)
      if (hostPart && hostPart.toLowerCase()==='wsl.localhost'){
        const prefix = document.createElement('span');
        prefix.className='prefix-host'; prefix.textContent='//wsl.localhost'; // 末尾スラッシュ除去 (#833)
        header.appendChild(prefix);
        if (segs.length>0) pushSlash();
      }
      const clickableWraps = [];
      segs.forEach((seg, idx)=>{
        const isLast = (idx === segs.length-1);
        cumulative.push(seg);
        const targetPath = cumulative.join('/') + '/';
        if (isLast){
          const lastSpan = document.createElement('span'); lastSpan.className='crumb-last'; lastSpan.textContent=seg; // 非クリック (#832/#833)
          if (seg.length < 4) lastSpan.classList.add('short');
          header.appendChild(lastSpan);
        } else {
          const wrap = document.createElement('div'); wrap.style.position='relative'; wrap.style.display='inline-flex'; wrap.style.alignItems='flex-end';
          const btn = document.createElement('button'); btn.type='button'; btn.textContent=seg; if (seg.length < 4) btn.classList.add('short');
          btn.addEventListener('click', ()=>{
            try{
              // パンくずクリック開始時に親ナビ pending を明示解除し二重上位遷移を抑制 (#851)
              try{ _fileNavParentPending=false; window._fileParentNavAutoRunFlag=false; }catch{}
              try{ window._fileParentNavGuardUntil = Date.now() + 450; }catch{}
              try{ console.debug('[pathHeader nav pre]', { seg, targetPath }); }catch{}
              // 直前（遷移前）のディレクトリ末尾セグメントを記憶し、親へ移動後そのディレクトリを選択状態にする (#857)
              let prevSeg = '';
              try{
                const prevBase = _ensureSlash(_fileBaseURL);
                if (prevBase){
                  let p = decodeURIComponent(prevBase.pathname||'').replace(/\/+$/,'');
                  const i = p.lastIndexOf('/');
                  prevSeg = (i>=0 ? p.slice(i+1) : p);
                }
              }catch{}
              try{ _filePostSelectName = prevSeg || null; }catch{}
              let urlStr = 'file://';
              if (hostPart){ urlStr += '//' + hostPart + '/' + targetPath; } else { urlStr += '///' + targetPath; }
              const newBase = _ensureSlash(new URL(urlStr));
              _fileBaseURL = newBase; _fileTypedDirRaw = targetPath; _fileFilter=''; _fileAutoPrefillOnNextRender=null;
              _fileEntries=[]; _fileSel=0; _fileLoading=true; try{ window._fileLastListStartTs=Date.now(); }catch{}
              // 入力欄追従 (#833)
              try{ _reflectCmdInputFullPath(hostPart, targetPath); }catch{}
              const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
              console.debug('[pathHeader nav]', { target:targetPath, url:urlStr });
              _listDirEntriesWithQuickRetry(_fileBaseURL)
                .then(list=>{ try{ const curKey=_ensureSlash(_fileBaseURL)?.toString()||null; if (!reqKey || reqKey===curKey){ _fileEntries=Array.isArray(list)? list: []; if (Array.isArray(list)&&list.length>0){ _fileStableEntries=list.slice(); _fileStableBaseKey=curKey; } } }catch{} })
                .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); try{ console.debug('[pathHeader nav done]', { seg, targetPath, base:_fileBaseURL?String(_fileBaseURL):null }); }catch{} });
            }catch(e){ console.warn('[pathHeader nav error]', e); }
          });
          wrap.appendChild(btn); header.appendChild(wrap); clickableWraps.push({ wrap, btn, idx }); pushSlash();
        }
      });
      // Fキー: 親方向 (最終=現在は除外)。F1=1つ上 ... 最大8。
      function _navigateUpLevels(levels){
        try{
          if (!Number.isFinite(levels) || levels < 1) return;
          const segCount = segs.length; const targetIdx = segCount - 1 - levels; if (targetIdx < 0) return;
          const upSegs = segs.slice(0, targetIdx+1); const pathRel = upSegs.join('/') + '/';
          let urlStr='file://'; if (hostPart){ urlStr += '//' + hostPart + '/' + pathRel; } else { urlStr += '///' + pathRel; }
          // 遡上前の末尾セグメントを post-select ターゲットに保持 (#857)
          let prevSeg='';
          try{
            const prevBase=_ensureSlash(_fileBaseURL);
            if (prevBase){
              let p=decodeURIComponent(prevBase.pathname||'').replace(/\/+$/,'');
              const i=p.lastIndexOf('/');
              prevSeg=(i>=0? p.slice(i+1): p);
            }
          }catch{}
          try{ _filePostSelectName = prevSeg || null; }catch{}
          const newBase=_ensureSlash(new URL(urlStr)); _fileBaseURL=newBase; _fileTypedDirRaw=pathRel; _fileFilter=''; _fileAutoPrefillOnNextRender=null;
          // 多段遡上時も pending フラグ解除して追加の自動親遷移を防ぐ (#851)
          try{ _fileNavParentPending=false; window._fileParentNavAutoRunFlag=false; window._fileParentNavGuardUntil = Date.now() + 450; }catch{}
          _fileEntries=[]; _fileSel=0; _fileLoading=true; try{ window._fileLastListStartTs=Date.now(); }catch{}
          // 入力欄追従 (F2/F3等多段遡上) (#833)
          try{ _reflectCmdInputFullPath(hostPart, pathRel); }catch{}
          const reqKey=(function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
          console.debug('[fkey nav]', { levels, target:pathRel, url:urlStr });
          _listDirEntriesWithQuickRetry(_fileBaseURL)
            .then(list=>{ try{ const curKey=_ensureSlash(_fileBaseURL)?.toString()||null; if (!reqKey || reqKey===curKey){ _fileEntries=Array.isArray(list)? list: []; if (Array.isArray(list)&&list.length>0){ _fileStableEntries=list.slice(); _fileStableBaseKey=curKey; } } }catch{} })
            .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); });
        }catch(e){ console.warn('[fkey nav error]', e); }
      }
      // CMD入力欄へ常にフルパスを反映 (末尾'/'除去 + 最後のセグメント選択) (#834)
      function _reflectCmdInputFullPath(hostPartRaw, pathRaw){
        if (!cmdinput) return;
        try{
          let body = String(pathRaw||'');
          // 末尾スラッシュ除去 (ルート『/』や 'C:' の場合は残さない)
          if (body.length>1 && /\/$/.test(body)) body = body.replace(/\/+$/,'');
          let display = body;
          if (hostPartRaw && hostPartRaw.toLowerCase()==='wsl.localhost'){
            display = '//' + hostPartRaw + '/' + display.replace(/^\/+/, '');
          }
          // Windows ドライブ: 'C:/' -> 'C:'
          display = display.replace(/^([A-Za-z]:)\/$/, '$1');
          const prefix = ':e ';
          const full = prefix + display;
          cmdinput.value = full;
          // 最後の '/' を探し、その右側を選択 (無い場合は全体後半=末尾から0長さ選択)
          const lastSlashIdx = full.lastIndexOf('/');
          let selStart = full.length; let selEnd = full.length;
          if (lastSlashIdx >= prefix.length){
            selStart = lastSlashIdx + 1; selEnd = full.length; // ディレクトリ名部分
          } else if (/^:e\s+[A-Za-z]:$/.test(full)){ // ドライブ単体 'C:' 選択
            selStart = prefix.length; selEnd = full.length;
          }
          try{ cmdinput.setSelectionRange(selStart, selEnd); }catch{}
        }catch{}
      }
      const maxLevels = Math.min(8, Math.max(0, segs.length-1));
      for (let level=1; level<=maxLevels; level++){
        const targetIdx = segs.length - 1 - level; if (targetIdx < 0) continue;
        const wrapInfo = clickableWraps.find(w=>w.idx===targetIdx); if (!wrapInfo) continue;
        try{
          const tag = document.createElement('div'); const fKey='F'+String(level);
          tag.className='fkey-tag'; tag.textContent=fKey; tag.dataset.level=String(level);
          tag.title=fKey + ' で親ディレクトリへ移動 ('+level+'つ上)';
          tag.addEventListener('click', (ev)=>{ ev.preventDefault(); ev.stopPropagation(); _navigateUpLevels(level); });
          wrapInfo.wrap.appendChild(tag);
        }catch(e){ console.debug('[fkey-tag error]', e); }
      }
      try{
        const _fkeyHandler=(e)=>{ try{ if(!e||!/^F[1-8]$/.test(e.key)) return; const visible=(_filePopupVisible&&_filePopupVisible()); if(!visible) return; if(_mode!=='CMD') return; const num=parseInt(e.key.slice(1),10); if(!Number.isFinite(num)||num<1) return; e.preventDefault(); e.stopPropagation(); _navigateUpLevels(num); }catch{} };
        try{ window.removeEventListener('keydown', window.__sixFKeyHandler, true); }catch{}
        window.__sixFKeyHandler=_fkeyHandler; window.addEventListener('keydown', _fkeyHandler, true);
      }catch{}
      // レンダ直後: フィルタ未入力時は選択行を反映 (#836)
      try{
        if (_mode==='CMD' && cmdinput && (!_fileFilter || _fileFilter.length===0)){
          if (window._fileSkipReflectOnce){ window._fileSkipReflectOnce=false; } else {
            const listNow = (function(){
              try{
                // list 変数は後段で定義されるがここではまだ未構築の可能性があるため再取得
                return Array.isArray(_fileEntries)? _fileEntries : [];
              }catch{ return []; }
            })();
            const selIdx = Math.max(0, Math.min(listNow.length-1, _fileSel|0));
            const entSel = listNow[selIdx];
            // ベースディレクトリ（末尾スラッシュ付）
            const basePathRel = (segs.length? segs.join('/') + '/' : '');
            if (entSel && entSel.name){
              // 選択行名を末尾に付与してその部分を選択
              let display = basePathRel + String(entSel.name||'');
              // WSL prefix
              if (hostPart && hostPart.toLowerCase()==='wsl.localhost'){
                display = '//' + hostPart + '/' + display.replace(/^\/+/, '');
              }
              // Windowsドライブ: 'C:/' + name -> 'C:/'維持
              display = display.replace(/^([A-Za-z]:)([^/]|$)/, '$1/$2');
              const prefix=':e ';
              cmdinput.value = prefix + display;
              const selStart = (prefix + basePathRel).length + (hostPart && hostPart.toLowerCase()==='wsl.localhost'? ('//'+hostPart+'/').length : 0);
              const basePrefixExtra = (hostPart && hostPart.toLowerCase()==='wsl.localhost'? ('//'+hostPart+'/').length : 0);
              // 正しい開始位置再計算 (WSL時 prefix + //host/ + basePathRel)
              const hostExtra = (hostPart && hostPart.toLowerCase()==='wsl.localhost') ? ('//'+hostPart+'/').length : 0;
              const startPos = prefix.length + hostExtra + basePathRel.length;
              const endPos = cmdinput.value.length;
              try{ cmdinput.setSelectionRange(startPos, endPos); }catch{}
            } else {
              // 選択行なし: フルパスのみ反映
              _reflectCmdInputFullPath(hostPart, basePathRel);
            }
          }
        }
      }catch{}
      // 未割当のFキーはスキップ。キーイベント追加 (popup描画ごとに最新再登録)。
      function _navigateUpLevels(levels){
        try{
          if (!Number.isFinite(levels) || levels < 1) return;
          const segCount = segs.length;
          const targetIdx = segCount - 1 - levels;
          if (targetIdx < 0) return;
          // 組み立て: targetIdx までの cumulative path
          const upSegs = segs.slice(0, targetIdx+1);
          const pathRel = upSegs.join('/') + '/';
          let urlStr = 'file://';
          if (hostPart){ urlStr += '//' + hostPart + '/' + pathRel; }
          else { urlStr += '///' + pathRel; }
          const newBase = _ensureSlash(new URL(urlStr));
          _fileBaseURL = newBase;
          _fileTypedDirRaw = pathRel;
          _fileFilter = '';
          _fileAutoPrefillOnNextRender = null;
          _fileEntries = []; _fileSel=0; _fileLoading=true; try{ window._fileLastListStartTs = Date.now(); }catch{}
          const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
          console.debug('[fkey nav]', { levels, target:pathRel, url:urlStr });
          _listDirEntriesWithQuickRetry(_fileBaseURL)
            .then(list=>{ try{ const curKey=_ensureSlash(_fileBaseURL)?.toString()||null; if (!reqKey || reqKey===curKey){ _fileEntries=Array.isArray(list)? list: []; if (Array.isArray(list)&&list.length>0){ _fileStableEntries=list.slice(); _fileStableBaseKey=curKey; } } }catch{} })
            .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); });
        }catch(e){ console.warn('[fkey nav error]', e); }
      }
      try{
        // 既存のグローバル F1 (親1つ) とは別の多段遡上: capture 優先
        const _fkeyHandler = (e)=>{
          try{
            if (!e || !/^F[1-8]$/.test(e.key)) return;
            const visible = (_filePopupVisible && _filePopupVisible());
            if (!visible) return; // popup 可視のみ
            // CMD モードのみ動作
            if (_mode !== 'CMD') return;
            const num = parseInt(e.key.slice(1),10);
            if (!Number.isFinite(num) || num<1) return;
            e.preventDefault(); e.stopPropagation();
            _navigateUpLevels(num);
          }catch{}
        };
        // 一旦既存を除去して再登録 (多重描画防止)
        try{ window.removeEventListener('keydown', window.__sixFKeyHandler, true); }catch{}
        window.__sixFKeyHandler = _fkeyHandler;
        window.addEventListener('keydown', _fkeyHandler, true);
      }catch{}
      // If no segments (root), show just host or placeholder
      if (segs.length===0){
        const rootBtn=document.createElement('button'); rootBtn.type='button'; rootBtn.textContent = hostPart ? hostPart : '/'; rootBtn.className='active'; header.appendChild(rootBtn);
      }
      // ヘッダはスクロール領域外（上側固定）へ配置 (#839)
      try{
        let host = bufpopup.querySelector('.path-header-host');
        if (!host){
          host = document.createElement('div'); host.className='path-header-host';
          // inner の直前に挿入して flex-column で固定
          if (bufpopupInner){ bufpopup.insertBefore(host, bufpopupInner); }
          else { bufpopup.appendChild(host); }
        }
        host.innerHTML=''; host.appendChild(header);
      }catch{ bufpopupInner.appendChild(header); }
    }catch{}
    // 基点変更ごとにリトライカウンタ初期化 (#826)
    try{
      const curKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
      if (curKey && window._fileListRetryKey !== curKey){ window._fileListRetryKey = curKey; window._fileListRetryCount = 0; }
    }catch{}
    // ハング/空即表示抑止: 直近ナビゲーション後の空一覧は一定時間ロード扱い (#826)
    try{
      const now = Date.now();
      const navElapsed = now - (_fileJustNavAt||0);
      const startElapsed = now - (window._fileLastListStartTs||0);
      const baseKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
      // 自動再試行条件
      const wantRetry = (
        _fileLoading && startElapsed > 1800 && window._fileListRetryCount < 3
      ) || (
        !_fileLoading && Array.isArray(_fileEntries) && _fileEntries.length===0 && navElapsed < 2500 && window._fileListRetryCount < 3
      );
      if (wantRetry && baseKey){
        console.debug('[filePopup auto-retry]', { startElapsed, navElapsed, retry: window._fileListRetryCount });
        window._fileListRetryCount = (window._fileListRetryCount||0)+1;
        window._fileLastListStartTs = now; _fileLoading = true;
        const reqKey = baseKey;
        try{
          _listDirEntriesWithQuickRetry(_fileBaseURL)
            .then(list=>{ try{ const cur = _ensureSlash(_fileBaseURL)?.toString()||null; if (!reqKey || cur===reqKey){ _fileEntries = Array.isArray(list)? list: []; } }catch{} })
            .finally(()=>{ _fileLoading = false; try{ if (_filePopupVisible && _filePopupVisible()) _filePopupRender&&_filePopupRender(); }catch{} });
        }catch{}
      }
    }catch{}
  if (_fileInvalid){
    _fileSel = 0; _fileSelMuted = false;
    const row = document.createElement('div');
    row.className = 'item';
    const num = document.createElement('span'); num.className='num'; num.textContent='';
    const name = document.createElement('span'); name.className='name'; name.textContent = '********';
    row.appendChild(num); row.appendChild(name);
    bufpopupInner.appendChild(row);
    // ensure render guard is released even on early return
    window.__sixFileRendering = false;
    return;
  }
  const list = _filePopupComputeList();
    if (list.length===0){
      _fileSel = 0; _fileSelMuted = false;
      const empty = document.createElement('div');
      empty.className = 'item';
      const num = document.createElement('span'); num.className='num'; num.textContent='';
      // 遷移直後は（UNCに限らず）猶予内は強制的に '(loading...)' を表示して空表示のフリッカーを抑止
      let forceLoading = false;
      try{
        const elapsed = Date.now() - (_fileJustNavAt||0);
        if (elapsed >= 0 && elapsed < 4000){ forceLoading = true; }
      }catch{}
  const name = document.createElement('span'); name.className='name'; name.textContent = ((_fileLoading || forceLoading) ? '(loading…)' : '(no entries)');
      empty.appendChild(num); empty.appendChild(name);
      bufpopupInner.appendChild(empty);
      window.__sixFileRendering = false; return;
    }
    // 仕様変更 (#343): ポップアップ開いた直後に自動で".."を挿入しない
    // 利用者がそのまま "//wsl.localhost/..." をタイピングできるようにするため。
    // 親へ戻った直後に選択ターゲットがあれば、ここでも最終的に優先適用（安全ネット）
    try{
      if (_filePostSelectName){
        const idx2 = list.findIndex(e=> e && e.isDir && e.name === _filePostSelectName);
        if (idx2>=0){
          _fileSel = idx2; _fileSelMuted = false;
          _filePostSelectName = null; // 適用できたときだけクリア
        }
        // 見つからない場合は保持を継続（ディレイ列挙完了後に適用）
      }
    }catch{}
    // 入力欄の文字はフィルタではなくインクリメンタルサーチとして扱い、選択のみ移動（反映は上下キーで）
    try{
      const qRawOrig = String(_fileFilter||'');
      const qTrim = (_fileInitialSelectActive ? '' : qRawOrig.replace(/\/+$/,'')); // 初回開き ".." 選択中は絞り込み抑止 (#761)
      if (qTrim){
        if (qTrim === '..'){
          // 親ディレクトリ指定は常にカーソル表示
          _fileSelMuted = false;
        } else if (qTrim === '.') {
          // '.' は何もマッチさせずカーソルのみ表示 (#583)
          _fileSelMuted = false;
        } else {
          let caseSensitive = false;
          try{ const b = _ensureSlash(_fileBaseURL); if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost') caseSensitive = true; }catch{}
          const pred = (nm)=>{
            if (caseSensitive) return nm.startsWith(qTrim);
            return nm.toLowerCase().startsWith(qTrim.toLowerCase());
          };
          const idxMatch = list.findIndex(e=> e && !e._up && pred(String(e.name||'')));
          if (idxMatch>=0){
            if (_fileSelAuto){ _fileSel = idxMatch; }
            _fileSelMuted = false;
          } else {
            _fileSelMuted = true;
          }
        }
      } else {
        _fileSelMuted = false;
      }
    }catch{}
    // 追加: フィルタ一致候補一覧と位置をグローバルに保持し、上下移動を非ラップ化 (#838)
    try{
      const qTrim = String(_fileFilter||'').replace(/\/+$/,'').trim();
      let caseSensitive=false; try{ const b=_ensureSlash(_fileBaseURL); if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost') caseSensitive=true; }catch{}
      const starts = (nm)=> caseSensitive ? nm.startsWith(qTrim) : nm.toLowerCase().startsWith(qTrim.toLowerCase());
      if (qTrim && qTrim!=='.' && qTrim!=='..'){
        const matches = list.map((e,i)=> (e && starts(String(e.name||''))) ? i : -1).filter(i=> i>=0);
        window._fileFilteredIndices = matches;
        if (matches.length>0){
          if (!matches.includes(_fileSel)) _fileSel = matches[0];
          let pos = matches.indexOf(_fileSel); if (pos < 0) pos = 0; window._fileFilterPos = pos;
        } else {
          window._fileFilteredIndices = []; window._fileFilterPos = 0;
        }
      } else {
        window._fileFilteredIndices = []; window._fileFilterPos = 0;
      }
    }catch{}
  _fileSel = Math.max(0, Math.min(list.length-1, _fileSel));
    // ディレクトリ降下直後の自動補完 (#810): 直前に設定されたフラグがあり、フィルタ未入力なら
    // 現在選択項目名を入力欄へ補完（カーソル未移動でも即利用可能に）
    try{
      if (_fileAutoPrefillOnNextRender && !_fileFilter){
        const baseStrNow = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
        if (baseStrNow && _fileAutoPrefillOnNextRender.base === baseStrNow){
          try{ console.debug('[e-prefill-check]', { base: baseStrNow, typedRaw: _fileTypedDirRaw, filter:_fileFilter, sel:_fileSel, desired:_fileAutoPrefillOnNextRender.desiredName||null }); }catch{}
          // #817: desiredName 優先（親移動直後に前ディレクトリを補完したいケース）
          let itPref = list[_fileSel];
          let forcedName = (_fileAutoPrefillOnNextRender.desiredName ? String(_fileAutoPrefillOnNextRender.desiredName) : null);
          if (forcedName){
            let bestName = forcedName;
            if (bestName){
              try{ console.debug('[e-prefill-forcedName]', { bestName, before:cmdinput?cmdinput.value:null }); }catch{}
              const newVal = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + bestName);
              if (cmdinput){
                const curVal = String(cmdinput.value||'');
                const baseOnlyRaw = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||''));
                const baseOnlyAug = (function(){
                  try{
                    const b=_ensureSlash(_fileBaseURL);
                    if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost'){
                      const body=String(_fileTypedDirRaw||'').replace(/^\/+/, '');
                      return ':e //' + b.host + '/' + _collapseDotDotPath(body);
                    }
                  }catch{}
                  return null;
                })();
                if (curVal.trim() === baseOnlyRaw.trim() || (baseOnlyAug && curVal.trim() === baseOnlyAug.trim())){
                  cmdinput.value = newVal;
                  // 末尾に追加された bestName 部分を選択 (#823 親移動後 "今いたディレクトリ" の補完選択)
                  const full=String(cmdinput.value||'');
                  const segLen=bestName.length;
                  const start=Math.max(full.length - segLen, 0);
                  try{ cmdinput.setSelectionRange(start, full.length); }catch{}
                  // Prefillメタ情報保持 (#827 親移動後タイプでパスが二段巻き戻る問題を補正)
                  try{ window._fileLastPrefillPrefix = String(_fileTypedDirRaw||''); window._fileLastPrefillSeg = String(bestName||''); window._fileLastPrefillTs = Date.now(); console.debug('[e-prefill-meta-store]', { prefix:window._fileLastPrefillPrefix, seg:window._fileLastPrefillSeg }); }catch{}
                  try{ console.debug('[e-prefill-applied-forced]', { value:cmdinput.value }); }catch{}
                }
              }
            }
          } else if (itPref && !itPref._up){
            // _bestEntryName はこの位置未定義なので安全な簡易名復元を行う
            let bestName = '';
            try{
              const u = new URL(String(itPref.url||''));
              const parts = String(u.pathname||'').split('/').filter(Boolean);
              bestName = decodeURIComponent(parts[parts.length-1]||'');
            }catch{}
            if (!bestName){ try{ bestName = String(itPref.name||''); }catch{} }
            if (bestName){
              // #817: 到着時補完は末尾 '/' を除いて候補名のみ貼り付け（パス + 名）
              const newVal = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + bestName);
              if (cmdinput){
                const curVal = String(cmdinput.value||'');
                const baseOnlyRaw = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||''));
                const baseOnlyAug = (function(){
                  try{
                    const b=_ensureSlash(_fileBaseURL);
                    if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost'){
                      const body=String(_fileTypedDirRaw||'').replace(/^\/+/, '');
                      return ':e //' + b.host + '/' + _collapseDotDotPath(body);
                    }
                  }catch{}
                  return null;
                })();
                if (curVal.trim() === baseOnlyRaw.trim() || (baseOnlyAug && curVal.trim() === baseOnlyAug.trim())){
                  cmdinput.value = newVal;
                  // 子ディレクトリ/ファイル降下直後の候補名選択 (#823)
                  const full=String(cmdinput.value||'');
                  const segLen=bestName.length;
                  const start=Math.max(full.length - segLen, 0);
                  try{ cmdinput.setSelectionRange(start, full.length); }catch{}
                  // Prefillメタ情報保持 (#827)
                  try{ window._fileLastPrefillPrefix = String(_fileTypedDirRaw||''); window._fileLastPrefillSeg = String(bestName||''); window._fileLastPrefillTs = Date.now(); console.debug('[e-prefill-meta-store]', { prefix:window._fileLastPrefillPrefix, seg:window._fileLastPrefillSeg }); }catch{}
                  try{ console.debug('[e-prefill-applied-list]', { value:cmdinput.value }); }catch{}
                }
              }
            }
          }
          _fileAutoPrefillOnNextRender = null; // 一度のみ（forcedName 消費）
        }
      }
    }catch{}
    // "(loading...)" が一定時間継続した場合の自動再試行 (#825)
    try{
      if (_fileLoading){
        const now = Date.now();
        const last = (typeof window._fileLastListStartTs==='number') ? window._fileLastListStartTs : 0;
        if (last && (now - last) > 1500){
          console.debug('[filePopup retry stale-loading]', { since: now - last });
          window._fileLastListStartTs = now; // update start ts
          const key = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
          _listDirEntriesWithQuickRetry(_fileBaseURL)
            .then(list=>{ try{ const cur=_ensureSlash(_fileBaseURL)?.toString()||null; if (!key || cur===key){ _fileEntries=Array.isArray(list)? list: []; } }catch{} })
            .finally(()=>{ _fileLoading=false; try{ if (_filePopupVisible && _filePopupVisible()) _filePopupRender&&_filePopupRender(); }catch{} });
        }
      }
    }catch{}
    // URLから安全に表示名を決めるヘルパ
    const _bestEntryName = (it)=>{
      try{
        if (it && it._up) return '..';
        const u=new URL(String(it&&it.url||''));
        const parts=String(u.pathname||'').split('/').filter(Boolean);
        let nm=decodeURIComponent(parts[parts.length-1]||'');
        try{ if (nm && nm.normalize) nm = nm.normalize('NFKC'); }catch{}
        // Convert any fullwidth ASCII range (FF01-FF5E) back to basic ASCII (0021-007E)
        try{ nm = nm.replace(/[\uFF01-\uFF5E]/g, c=> String.fromCharCode(c.charCodeAt(0) - 0xFEE0)); }catch{}
        // Strip embedded NUL or other control chars except LF/TAB (root cause of pseudo-fullwidth appearance)
        try{ nm = nm.replace(/[\u0000-\u001F]/g, ch=> (ch==='\n'||ch==='\t')? ch : ''); }catch{}
        if(nm) return _normalizeColonVariants(nm);
      }catch{}
      try{
        let nm = _normalizeColonVariants(String(it&&it.name||''));
        try{ if (nm && nm.normalize) nm = nm.normalize('NFKC'); }catch{}
        try{ nm = nm.replace(/[\uFF01-\uFF5E]/g, c=> String.fromCharCode(c.charCodeAt(0) - 0xFEE0)); }catch{}
        try{ nm = nm.replace(/[\u0000-\u001F]/g, ch=> (ch==='\n'||ch==='\t')? ch : ''); }catch{}
        return nm;
      }catch{ return ''; }
    };
    for (let i=0;i<list.length;i++){
      const it = list[i];
  const div = document.createElement('div');
      div.className = 'item'+((i===_fileSel && !_fileSelMuted)?' active':'');
      if (i===_fileSel && _fileSelMuted){
        div.className += ' muted';
      }
      // 数字は付けない（配置合わせのため空の num を置く）
      const num = document.createElement('span'); num.className='num'; num.textContent='';
      const name = document.createElement('span'); name.className='name';
      const dispName = _bestEntryName(it);
      name.textContent = dispName + (it.isDir? '/':'');
      try{ div.dataset.entryName = String(it && it.name || ''); }catch{}
      if (it && it._disabled){
        try{ div.className += ' disabled'; }catch{}
        try{ name.style.color = '#d33'; }catch{}
        try{ name.title = 'Windows(NTFS)では無効な名前のため開けません'; }catch{}
      }
      // フィルタ非一致はグレー表示 (#576)
      try{
        const qRaw = (_fileInitialSelectActive ? '' : String(_fileFilter||'').replace(/\/+$/,'').trim()); // 初回開きは非一致グレー抑止 (#761)
        if (qRaw){
          let caseSensitive=false; try{ const b=_ensureSlash(_fileBaseURL); if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost') caseSensitive=true; }catch{}
          const starts = (nm)=> caseSensitive ? nm.startsWith(qRaw) : nm.toLowerCase().startsWith(qRaw.toLowerCase());
          // '.' フィルタ時は親("../")も含めて常に非一致グレー (#583)
          if (!(it && !it._up && starts(String(it.name||''))) && !(qRaw==='..' && it && it._up)){
            if (!it._disabled){ name.style.color='#777'; }
          }
        }
      }catch{}
      div.appendChild(num); div.appendChild(name);
      // クリックでフォーカスを奪わない
      div.addEventListener('mousedown', (ev)=>{ ev.preventDefault(); });
      div.addEventListener('click', ()=>{
        // クリック開始時に parentNav 自動実行待機フラグを明示的に解除（誤遷移二重発火抑止）
        try{ _fileNavParentPending = false; window._fileParentNavAutoRunFlag=false; }catch{}
        try{ const baseStr0=_ensureSlash(_fileBaseURL)?.toString()||''; _fileClickLog({ phase:'click-start', base:baseStr0, typedDirRaw:String(_fileTypedDirRaw||''), domName: div && div.dataset ? div.dataset.entryName : null }); }catch{}
        // 動的再取得（staleクロージャ疑い対策）: DOMに保持した名前から現在の一覧を再探索
        try{
          const nmDom = div && div.dataset ? (div.dataset.entryName||'') : '';
          const origName = (it && it.name) ? String(it.name) : '';
          let rebound = null;
          try{
            const entriesNow = Array.isArray(_fileEntries)? _fileEntries:[];
            rebound = entriesNow.find(e=> e && e.isDir && !e._up && String(e.name||'')===nmDom) || null;
          }catch{}
          if (rebound){ it = rebound; }
          _fileClickLog({ phase:'rebinding', domName:nmDom, origName, reboundName: (rebound && rebound.name)||null });
        }catch{}
        if (it && it._disabled){ try{ _triggerVisualBell && _triggerVisualBell(); }catch{} try{ toast('Windows(NTFS)では無効な名前のため開けません', 1800); }catch{} return; }
        // クリック時も補完専用: 入力欄に貼り付けて input ハンドラに委譲
        if (it.isDir){
          try{
            // 直後ガード中かつフィルタ空（末尾スラッシュ状態）で ".." をクリックした場合は
            // ナビゲーションせず ".." を入力欄に補完するだけに留める（#344/#347）
            try{
              const guardActive = (Date.now() < (_fileReflectGuardUntil||0));
              // 現在のフィルタ末尾がスラッシュかどうかを入力から再評価
              let endsWithSlashNow = false;
              try{
                const vNow = (cmdinput && cmdinput.value) || '';
                const parsedNow = _eParseInput(vNow);
                const filtNow = String(parsedNow && parsedNow.filter || '');
                endsWithSlashNow = (filtNow.length === 0);
              }catch{}
              if (guardActive && endsWithSlashNow && it._up){
                if (cmdinput){
                  const next = ':e ' + String(_fileTypedDirRaw||'') + '..';
                  cmdinput.value = next;
                  try{ const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); }catch{}
                  try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {}
                }
                return; // 補完のみで抜ける
              }
            }catch{}
            // 子ディレクトリ遷移: 現在ディレクトリ(最終セグメント)自身は遷移しない。ローカル・WSL・UNC 全て名前連結で統一 (#846 再修正)
            let nextBase = null;
            try{
              const b = _ensureSlash(_fileBaseURL);
              if (!b){ return; }
              const itemName = String(it && it.name || '');
              if (!itemName){ return; }
              const pathParts = (function(){
                try{ return (b.pathname||'').replace(/\\/g,'/').replace(/\/+$/,'').split('/').filter(Boolean); }catch{ return []; }
              })();
              const lastSeg = pathParts.length? pathParts[pathParts.length-1] : '';
              const dbg = { phase:'pre-build', base:String(b), baseHost:b.host||'', basePath:b.pathname||'', pathParts:pathParts.slice(), lastSeg, itemName, itUrl:String(it&&it.url||''), typedDirRaw:String(_fileTypedDirRaw||'') };
              // 初期ログ（従来 post-build のみだったため前段階も記録）
              try{ _fileClickLog(Object.assign({}, dbg, { phase:'pre-build' })); }catch{}
              // 現在のディレクトリ自身 (it.url === _fileBaseURL) の重複表示があればスキップ (#849)
              try{
                const baseStrCur = _ensureSlash(_fileBaseURL)?.toString()||'';
                const itUrlStr = String(it && it.url || '');
                if (baseStrCur && itUrlStr && itUrlStr === baseStrCur){
                  _fileClickLog(Object.assign({}, dbg, { phase:'self-url-skip', baseStrCur, itUrlStr }));
                  try{ toast && toast('現在のディレクトリです', 800); }catch{}
                  return;
                }
              }catch{}
              if (itemName === lastSeg){
                // 自己ディレクトリ -> 何もしない
                try{ toast && toast('現在のディレクトリです', 800); }catch{}
                _fileClickLog(Object.assign({}, dbg, { phase:'self-dir-skip' }));
                try{ _fileClickLog({ phase:'branch-decision', branch:'self-dir-skip', item:itemName, lastSeg }); }catch{}
                return;
              }
              // 入力欄の生ディレクトリが既に itemName/ で終わっている場合も自己クリックとみなして抑止（基点ズレ時の二重遷移防止）
              try{
                const typedRawNow = String(_fileTypedDirRaw||'');
                if (typedRawNow.endsWith(itemName + '/')){
                  _fileClickLog(Object.assign({}, dbg, { phase:'self-typed-skip', typedRawNow }));
                  try{ toast && toast('現在のディレクトリです', 800); }catch{}
                  try{ _fileClickLog({ phase:'branch-decision', branch:'self-typed-skip', item:itemName }); }catch{}
                  return;
                }
              }catch{}
              const newParts = pathParts.concat(itemName);
              const newPath = '/' + newParts.join('/') + '/';
              if (b.host){
                nextBase = _ensureSlash(new URL('file://' + '//' + b.host + newPath));
              } else {
                // Windows ドライブ /C:/Users → 先頭スラッシュを保持したまま
                nextBase = _ensureSlash(new URL('file://' + '///' + newPath.replace(/^\/+/, '')));
              }
              try{ dbg.newPath=newPath; dbg.nextBaseStr=String(nextBase); }catch{}
              _fileClickLog(Object.assign({}, dbg, { phase:'post-build' }));
              try{ _fileClickLog({ phase:'branch-decision', branch:'child-descend', item:itemName, from:String(b), to:String(nextBase) }); }catch{}
            }catch{ nextBase = null; }
            if (!nextBase) return; // 解決不能時は中断
            // 選択直後の短期リトライウィンドウを開始
            _fileJustNavAt = Date.now();
            // 直後の反映/Enterガードを短期オン
            _fileReflectGuardUntil = Date.now() + 700;
            _fileNavRetryCount = 0;
            _fileFilter = '';
            _fileSelMuted = false;
            // 旧一覧のまま残らないよう直ちにローディング表示へ
            _fileEntries = []; _fileSel = 0; _fileLoading = true; if (_filePopupVisible()) _filePopupRender();
            if (it._up){
              try{ _fileClickLog({ phase:'branch-decision', branch:'parent-up', item:String(it&&it.name||'') }); }catch{}
              // 親: 直前セグメントは baseURL から頑健に取得し、基点も即更新
              let s = (_fileTypedDirRaw||'').replace(/\\/g,'/').replace(/\/+$/,'');
              const idx = s.lastIndexOf('/');
              if (!s){
                // 入力欄に基底パスが無い場合、親ディレクトリの絶対表記を生成して入力側に採用
                _fileTypedDirRaw = _inputDirRawFromURL(nextBase);
              } else {
                _fileTypedDirRaw = (idx>=0? s.slice(0,idx+1) : '');
              }
              let prevSeg = '';
              try{
                const b = _ensureSlash(_fileBaseURL);
                let p = decodeURIComponent((b && b.pathname) || '');
                p = p.replace(/\/+$/,'');
                const i2 = p.lastIndexOf('/');
                prevSeg = (i2>=0 ? p.slice(i2+1) : p);
              }catch{}
              _filePostSelectName = prevSeg || null;
              _fileBaseURL = nextBase;
              // 仕様変更 (#583): 親クリック後はフィルタを完全クリアし前セグメントを残さない
              if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw); }
              // クリック移動では明示的に列挙を開始し、(loading...) のままにならないようにする（#350）
              try{
                const baseNow = _ensureSlash(_fileBaseURL);
                if (baseNow && _isHostRoot(baseNow)){
                  // ホスト直下: 共有一覧
                  _fileTypedDirRaw = '//' + baseNow.host + '/'; _fileFilter=''; _filePopupNoUp = true;
                  _fileEntries = []; _fileSel = 0; _fileLoading = true; if (_filePopupVisible()) _filePopupRender();
                  _loadSharesForHost(baseNow.host, prevSeg)
                    .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); });
                } else {
                  const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
                  _listDirEntriesWithQuickRetry(_fileBaseURL)
                    .then(list2=>{
                      try{
                        const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                        if (!reqKey || curKey===reqKey){
                          _fileEntries = Array.isArray(list2) ? list2 : [];
                          if (Array.isArray(list2) && list2.length>0){ _fileStableEntries = list2.slice(); _fileStableBaseKey = curKey; }
                          // 親で直前セグメントを選択
                          try{
                            const baseNow2 = _ensureSlash(_fileBaseURL);
                            const suppressUp = (!!_filePopupNoUp) || (baseNow2 && (_isHostRoot(baseNow2) || _isUncShareRoot(baseNow2)));
                            const idx2 = _fileEntries.findIndex(e=> e && e.isDir && e.name===prevSeg);
                            if (idx2>=0){ _fileSel = idx2 + (suppressUp?0:1); }
                          }catch{}
                        }
                      }catch{}
                    })
                    .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); });
                }
              }catch{}
            } else {
              // Enter/Tab と同じ補完のみに徹する。"//" 段階で "wsl.localhost/" を選んだ場合は先頭 "//" を保持。
              // "/" はローカルルートとして通常処理（UNC化しない）。
              // WSLホストパス重複バグ (#858) 対策: typedDirRaw を常に baseURL から再構築し末尾に itemName を単一付加
              try{
                const bNow = _ensureSlash(_fileBaseURL);
                if (bNow && bNow.host && bNow.host.toLowerCase()==='wsl.localhost'){
                  let body = decodeURIComponent(bNow.pathname||'').replace(/^\/+/,'');
                  if (body && !/\/$/.test(body)) body += '/';
                  // 既存 typedDirRaw が二重化している場合の除去: 末尾半分が先頭と完全一致なら一度だけ残す
                  const dedupe = (s)=>{
                    try{
                      const parts = s.split('/').filter(Boolean);
                      for (let n=Math.floor(parts.length/2); n>=2; n--){
                        const head = parts.slice(0,n).join('/');
                        const tail = parts.slice(-n).join('/');
                        if (head === tail){ return head + '/'; }
                      }
                    }catch{}
                    return s;
                  };
                  body = dedupe(body);
                  _fileTypedDirRaw = '//' + bNow.host + '/' + body + _bestEntryName(it) + '/';
                  _fileClickLog({ phase:'wsl-build', host:bNow.host, body, item:_bestEntryName(it) });
                } else {
                  // 通常パス: 既存方式（単純連結）
                  const isAtRootDoubleSlash = /^\s*:?\s*e\s+\/\/$/i.test((cmdinput && cmdinput.value)||'') || (_fileTypedDirRaw==='//');
                  if (isAtRootDoubleSlash){
                    _fileTypedDirRaw = '//' + _bestEntryName(it) + '/';
                  } else {
                    _fileTypedDirRaw = (_fileTypedDirRaw||'') + _bestEntryName(it) + '/';
                  }
                }
              }catch{ _fileTypedDirRaw = (_fileTypedDirRaw||'') + _bestEntryName(it) + '/'; }
              // 二重化一般ケースの後処理: パス内で同一シーケンスが連続した場合は前半のみ残す
              try{
                if (/^\/\/wsl\.localhost\//i.test(_fileTypedDirRaw)){
                  const body = _fileTypedDirRaw.replace(/^\/\/wsl\.localhost\//i,'');
                  const parts = body.split('/').filter(Boolean);
                  for (let n=Math.floor(parts.length/2); n>=2; n--){
                    const head = parts.slice(0,n).join('/');
                    const tail = parts.slice(n, n+n).join('/');
                    if (tail && head===tail){
                      const rest = parts.slice(n+n).join('/');
                      _fileTypedDirRaw = '//' + 'wsl.localhost' + '/' + head + (rest? '/'+rest:'') + '/';
                      _fileClickLog({ phase:'wsl-dedupe', head, rest });
                      break;
                    }
                  }
                }
              }catch{}
              if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw); }
              // 基点も進める
              _fileBaseURL = nextBase;
              // クリック降下時の ".." 自動補完撤去 (#856)
              try{ console.debug('[dir-click child descend]', { base:String(_fileBaseURL), typed:_fileTypedDirRaw }); }catch{}
              // 子ディレクトリへのクリック移動でも即列挙を開始（#350）
              try{
                const baseNow = _ensureSlash(_fileBaseURL);
                try{ _filePopupNoUp = !!(baseNow && (_isHostRoot(baseNow) || _isUncShareRoot(baseNow))); }catch{ /* keep as-is */ }
                const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
                _listDirEntriesWithQuickRetry(_fileBaseURL)
                  .then(list2=>{
                    try{
                      const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
                      if (!reqKey || curKey===reqKey){
                        _fileEntries = Array.isArray(list2) ? list2 : [];
                        if (Array.isArray(list2) && list2.length>0){ _fileStableEntries = list2.slice(); _fileStableBaseKey = curKey; }
                        // 先頭選択（".." 抑止に応じて）
                        try{ _fileSel = 0; }catch{}
                      }
                    }catch{}
                  })
                  .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); });
              }catch{}
            }
            try{ _fileNavPendingKey = _ensureSlash(nextBase)?.toString()||null; }catch{ _fileNavPendingKey=null; }
            if (cmdinput){ try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {} }
            try{ cmdinput && cmdinput.focus(); }catch{}
          }catch{}
        } else {
          // ファイル: 選択不可でなければ読み込み
          _loadFromPath(it.url, null, {mode:'new'});
          // Enter と同等に、入力欄をクリアし NORMAL に戻す
          try{ const hist=':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + String(_bestEntryName(it)||'')); _cmdHistoryMaybePush(hist); }catch{}
          try{ if (cmdinput) cmdinput.value=''; }catch{}
          _filePopupHide(); _bufPopupHide(); _setMode('NORMAL'); setTimeout(()=>editor.focus(),0);
        }
      });
      bufpopupInner.appendChild(div);
    }
  // アクティブ（またはミュート）項目を常に表示（ラップ移動対応） (#842)
  try{ const act = bufpopupInner.querySelector('.item.active, .item.muted'); if (act && act.scrollIntoView) act.scrollIntoView({block:'nearest', inline:'nearest'}); }catch{}
  window.__sixFileRendering = false;
    // 旧仕様安全ネット（".." 自動補完）は廃止。
    // 相対モード初回自動補完: 入力欄が ':e ' かつ relativeMode で一覧があれば先頭ディレクトリ名を補完し選択状態にする
    try{
      // relative モード初回自動補完機能は廃止 (#853)
    }catch{}
  }
  function _filePopupApplyInitialUpPrefill(){ /* no-op (".." 初期補完廃止) */ }
  function _filePopupApplyPostNavUpPrefill(){ /* no-op (".." 自動補完廃止) */ }

  
  function _filePopupShow(){
    if (!bufpopup) return;
    try{ if (typeof _encPopupHide==='function') _encPopupHide(); }catch{}
    bufpopup.dataset.kind='file';
    bufpopup.style.display='';
    _layoutBufPopup();
    // 相対モード判定（空の :e で開いた場合）と基点設定
    try{
      const vRaw = (cmdinput && cmdinput.value)||'';
      // relative モード判定廃止 (#853)
      const cur = currentBuffer();
      if (cur && cur.path){
        _fileBaseURL = _ensureSlash(_dirnameURL(cur.path));
      } else if (!_fileBaseURL){
        // 初回: 現在バッファに path が無い場合でも親移動可能にするフォールバック
        try{ _fileBaseURL = _ensureSlash(_currentDirBase()); }catch{}
        if (!_fileBaseURL){ try{ _fileBaseURL = _ensureSlash(new URL('./', _htmlBaseURL())); }catch{} }
      }
      // ディレクトリURLへ正規化（末尾スラッシュ付与）
      try{ if (_fileBaseURL && !/\/$/.test(_fileBaseURL.pathname||'')) _fileBaseURL = _ensureSlash(_dirnameURL(_fileBaseURL.toString())); }catch{}
      try{ _fileVisibleBaseKey = _fileBaseURL ? _fileBaseURL.toString() : _fileVisibleBaseKey; }catch{}
      try{
        let raw = _inputDirRawFromURL(_fileBaseURL) || (_fileBaseURL && _fileBaseURL.pathname.replace(/^\//,'')) || '';
        if (raw && !/\/$/.test(raw)) raw+='/';
        _fileTypedDirRaw = raw;
      }catch{ _fileTypedDirRaw=''; }
      try{ console.debug('[e-show]', { base: (_fileBaseURL?_fileBaseURL.toString():null), typedDirRaw:_fileTypedDirRaw }); }catch{}
    }catch{}
    try{ _fileInitialUpPrefill=false; _fileInitialSelectActive=false; }catch{}
    // Immediately reposition command float below the :e popup with the specified gap
    try{ if (_mode==='CMD' && cmdfloat && cmdfloat.style.display!=='none'){ _positionCmdFloat(); } }catch{}
    _filePopupRender();
    // 初回列挙未取得なら即開始（親移動F1/Alt+Uの早期可動化）
    try{
      if (_fileBaseURL && (!_fileEntries || _fileEntries.length===0)){
        _fileLoading = true;
        const reqKey0 = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
        _listDirEntriesWithQuickRetry(_fileBaseURL)
          .then(list0=>{
            try{
              const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
              if (!reqKey0 || curKey===reqKey0){
                _fileEntries = Array.isArray(list0)? list0: [];
                if (Array.isArray(list0) && list0.length>0){ _fileStableEntries=list0.slice(); _fileStableBaseKey=curKey; }
              }
            }catch{}
          })
          .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); });
      }
    }catch{}
    // 初回相対モード自動補完（非同期列挙考慮: 最大3回）
    try{
      // relative モード再レンダ遅延処理廃止 (#853)
    }catch{}
    // 同期列挙完了済みなら即適用試行
    try{ _filePopupApplyInitialUpPrefill(); }catch{}
  }
  function _filePopupHide(){ if (!bufpopup) return; if (_filePopupVisible()){ bufpopup.style.display='none'; _fileLoading=false; try{ _fileReflectedOnOpen=false; }catch{} try{ window.__sixFileRendering=false; }catch{} } }
  // 旧: 一覧の単純移動は廃止（反映ロジック付きの新実装は下）
  // ↑↓で選択を動かしたときは、即座に入力欄へ反映（末尾 '/' なし、".." は例外で反映しない）
  function _filePopupMove(d){
    if (!bufpopup) return;
    const list = _filePopupComputeList();
    _fileSelAuto = false; // ユーザ操作により自動選択を停止
    const prevSel = _fileSel|0;
    // 新ロジック: フィルタ一致候補間を非ラップ移動し、グローバル位置 _fileFilterPos を利用 (#838)
    const filtered = Array.isArray(window._fileFilteredIndices) ? window._fileFilteredIndices : [];
    if (filtered.length>0){
      // ラップ移動: 端で更に進むと反対側へ (#842)
      let pos = (typeof window._fileFilterPos==='number') ? window._fileFilterPos : filtered.indexOf(_fileSel);
      if (pos < 0) pos = 0;
      if (d>0){ pos = (pos + 1) % filtered.length; }
      else if (d<0){ pos = (pos - 1 + filtered.length) % filtered.length; }
      window._fileFilterPos = pos;
      _fileSel = filtered[pos];
    } else {
      // フィルタなし: 全体インデックスでラップ
      if (list.length>0){
        _fileSel = (_fileSel + d + list.length) % list.length;
      } else {
        _fileSel = 0;
      }
    }
    _fileSelMuted = false; // 矢印移動で通常のハイライトに復帰
    // 初期 '..' 選択状態なら解除（選択範囲をカーソル末尾へ）
    if (_fileInitialSelectActive){
      try{ if (cmdinput){ const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); } }catch{}
      _fileInitialSelectActive=false;
      // #759: 自動補完された '..' はユーザ入力扱いではないので、フィルタをクリアして他候補へ移動可能にする
      if (_fileFilter==='..'){ _fileFilter=''; }
    }
    try{
      const it = list[_fileSel];
      // 仕様変更(#573): 無効項目でも入力欄へ名前を反映（Enter/click時はブロック）
      const bestName = (function(x){
        try{
          const u=new URL(String(x&&x.url||''));
          const parts=String(u.pathname||'').split('/').filter(Boolean);
          const nm=decodeURIComponent(parts[parts.length-1]||'');
          if (nm) return _normalizeColonVariants(nm);
        }catch{}
        return _normalizeColonVariants(String(x&&x.name||''));
      })(it);
      if (cmdinput && it){
        // ディレクトリ移動直後の短期は、選択反映をスキップ
        const guardActive = (Date.now() < (_fileReflectGuardUntil||0));
        if (!guardActive){
          const val = ':e ' + _collapseDotDotPath((_fileTypedDirRaw||'') + bestName);
          cmdinput.value = val;
          try{ const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); }catch{}
        
        // 入力欄に選択内容を反映してもフィルタは保持（#576 スキップ用）。ミュートは解除。
        _fileSelMuted = false;
        }
      }
    }catch{}
    const prevScroll = (function(){ try{ return bufpopupInner ? bufpopupInner.scrollTop : 0; }catch{ return 0; } })();
    _filePopupRender();
    // 選択行を必要最小限で可視化 (scrolloff=0的挙動) (#837)
    // 要望 (#843): scrolloff=99999 相当の挙動へ変更。
    // つまり選択行が常にビュー中央付近に来るようスクロールし、端条件による最小移動ではなく積極的中央化。
    try{
      const inner = bufpopupInner;
      if (inner){
        const rows = inner.querySelectorAll('.item');
        if (rows.length>0 && _fileSel>=0 && _fileSel<rows.length){
          const target = rows[_fileSel];
          const desiredTop = Math.max(0, target.offsetTop - Math.round((inner.clientHeight - target.offsetHeight)/2));
          const maxTop = Math.max(0, inner.scrollHeight - inner.clientHeight);
          const clamped = Math.min(maxTop, desiredTop);
          inner.scrollTop = clamped;
        }
      }
    }catch{}
  }

  // フォーカス管理: ポップアップそのものでもエディタ/コマンドのフォーカスを維持
  if (bufpopup){
    bufpopup.addEventListener('mousedown', (ev)=>{ ev.preventDefault(); });
    bufpopup.addEventListener('mouseenter', ()=>{ try{ if (_mode==='CMD' && cmdinput) cmdinput.focus(); else editor.focus(); }catch{} });
    // ホイールはポップアップ内スクロールへ
    bufpopup.addEventListener('wheel', (ev)=>{
      try{
        const inner = bufpopupInner;
        if (!inner) return;
        const prev = inner.scrollTop;
        inner.scrollTop += ev.deltaY;
        if (inner.scrollTop !== prev){ ev.preventDefault(); ev.stopPropagation(); }
      }catch{}
    }, { passive:false });
    // Reposition on resize/zoom changes
    try{ window.addEventListener('resize', ()=>{ try{ _layoutBufPopup(); if (_mode==='CMD') _positionCmdFloat(); }catch{} }); }catch{}
  }

  function _currentDirBase(){
    // Prefer directory of current buffer
    try{ const cur = currentBuffer(); if (cur && cur.path) return _dirnameURL(cur.path); }catch{}
    // Fall back to most recently visible :e base
    try{ if (_fileVisibleBaseKey){ const u=_ensureSlash(_fileVisibleBaseKey); if (u) return u; } }catch{}
    // Fall back to last stable listed base
    try{ if (_fileStableBaseKey){ const u=_ensureSlash(_fileStableBaseKey); if (u) return u; } }catch{}
    // Any other buffer
    try{ const any=(buffers||[]).find(b=> b && b.path); if (any && any.path) return _dirnameURL(any.path); }catch{}
    // Default
    return _htmlBaseURL();
  }

  // :e 入力文字列の解析 → {baseURL, typedDirRaw, filter}
  function _eParseInput(vRaw){
    // 先頭のコロンは1つのみ許容（"::e" は不正とみなす）。未マッチ時は "vRaw" 全体をパス入力として扱う (#490)
    const m = vRaw.match(/^:?\s*e\s*(.*)$/i);
    // 既存実装は未マッチ時に rest="" となり Tab 再オープン時 (":e path" → Esc → Tab) にパスが消失していた。
    // 未マッチ（:e/e が前置されていない生パス文字列）なら vRaw 全体をそのまま解析対象にする。
    const rest = (m? m[1] : vRaw).trimStart();
    const orig = rest;
    // バックスラッシュ→スラッシュ統一（内部処理用）。raw は保持
    const norm = orig.replace(/\\/g,'/');
    let dirPart = '';
    let filter = '';
    const slashIdx = norm.lastIndexOf('/');
    if (slashIdx >= 0){
      dirPart = norm.slice(0, slashIdx+1); // include '/'
      filter = norm.slice(slashIdx+1);
    } else {
      dirPart = '';
      filter = norm;
    }
  // 入力解釈の基点: :e ポップアップが開いている間は、インタラクティブな現在地(_fileBaseURL)
  // を最優先に使う。未表示時/未初期化時はカレントバッファ基点へフォールバック（#169）。
  let base = null;
  try{
    base = _fileBaseURL ? _ensureSlash(_fileBaseURL) : _currentDirBase();
  }catch{
    base = _currentDirBase();
  }

  // Alt+U で親ディレクトリへ移動（旧疑似行 ".." の代替）
  // 本体定義: 先のスタブを上書き。pending があれば即時実行。
  function _fileNavParentReal(){
    try{
      try{ window._fileNavParentRef = _fileNavParentReal; }catch{}
      if (_fileNavParent !== _fileNavParentReal){ _fileNavParent = _fileNavParentReal; }
      if (_fileNavParentPending){
        try{ console.debug('[parentNav pending flush]'); }catch{}
        _fileNavParentPending = false;
      }
      const nowTs = Date.now();
      const isAutoRun = !!window._fileParentNavAutoRunFlag;
      const lastTs = (typeof window._fileParentNavRealLastTs==='number') ? window._fileParentNavRealLastTs : null;
      const delta = (lastTs!=null) ? (nowTs - lastTs) : null;
      if (!isAutoRun && lastTs!=null && delta < 140){
        try{ console.debug('[parentNav real skip multi-fire]', { delta, lastTs }); }catch{}
        return;
      }
      if (!isAutoRun){ window._fileParentNavRealLastTs = nowTs; }
      let haveBase = !!_fileBaseURL;
      if (!haveBase){
        try{ const cur=currentBuffer&&currentBuffer(); if (cur && cur.path){ _fileBaseURL=_dirnameURL(cur.path); haveBase=!!_fileBaseURL; } }catch{}
        if (!haveBase){ try{ _fileBaseURL=_currentDirBase(); haveBase=!!_fileBaseURL; }catch{} }
        if (!haveBase) return;
      }
      let baseDir = _ensureSlash(_fileBaseURL); if (!baseDir) return;
      try{ if (!/\/$/.test(baseDir.pathname||'')) baseDir = _ensureSlash(_dirnameURL(baseDir.toString())); }catch{}
      const fullPath = String(baseDir.pathname||'').replace(/\\/g,'/');
      const pathNoLead = fullPath.replace(/^\//,'');
      const isDriveRoot = /^[A-Za-z]:\/$/.test(pathNoLead);
      const isTrueRoot = (fullPath === '/');
      let isWSLDistRoot=false; try{ const h=(baseDir&&baseDir.host||'').toLowerCase(); if (h==='wsl.localhost' && /^\/[^\/]+\/$/.test(fullPath)) isWSLDistRoot=true; }catch{}
      if (isDriveRoot || isTrueRoot || isWSLDistRoot){
        try{ console.debug('[parentNav at-root]', { fullPath, pathNoLead, isDriveRoot, isTrueRoot, isWSLDistRoot }); }catch{}
        try{ toast && toast(isWSLDistRoot? 'WSL ディストリビューションの最上位です':'最上位ディレクトリです',1200); }catch{}
        return;
      }
      const trimmed = fullPath.replace(/\/+$/,'');
      const cutIdx = trimmed.lastIndexOf('/');
      if (cutIdx < 0){ try{ console.debug('[parentNav no-cut]', { fullPath }); }catch{} return; }
      const parentPath = trimmed.slice(0, cutIdx+1);
      _fileTypedDirRaw = parentPath.replace(/^\//,'');
      let parent = baseDir; try{ parent=_ensureSlash(new URL('../', baseDir)); }catch{}
      if (!parent) return;
      let prevSeg=''; try{ prevSeg = trimmed.slice(cutIdx+1) || ''; }catch{}
      _filePostSelectName = prevSeg || null;
      _fileBaseURL = parent;
      _fileEntries = [];
      _fileLoading = true; try{ window._fileLastListStartTs = Date.now(); }catch{}
      _fileSel = 0;
      const _augmentWSL=(raw=>{ try{ const b=_ensureSlash(_fileBaseURL); if (b && b.protocol==='file:' && b.host && b.host.toLowerCase()==='wsl.localhost'){ const body=String(raw||'').replace(/^\/+/, ''); return '//'+b.host+'/' + body; } }catch{} return raw; });
      try{ _fileAutoPrefillOnNextRender = { base: String(_fileBaseURL), typed: _augmentWSL(String(_fileTypedDirRaw||'')), desiredName: prevSeg }; }catch{}
      try{ if (cmdinput){ const disp=_augmentWSL(_collapseDotDotPath(String(_fileTypedDirRaw||''))); cmdinput.value=':e ' + disp; const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); } }catch{}
      const prevBaseStr = (function(){ try{ return baseDir ? baseDir.toString() : null; }catch{ return null; } })();
      const reqKey = (function(){ try{ return _ensureSlash(_fileBaseURL)?.toString()||null; }catch{ return null; } })();
      _listDirEntriesWithQuickRetry(_fileBaseURL)
        .then(list2=>{
          try{
            const curKey = _ensureSlash(_fileBaseURL)?.toString()||null;
            if (!reqKey || curKey===reqKey){
              _fileEntries = Array.isArray(list2)? list2: [];
              if (Array.isArray(list2) && list2.length>0){ _fileStableEntries=list2.slice(); _fileStableBaseKey=curKey; }
              const idx = _fileEntries.findIndex(e=> e && e.isDir && e.name===prevSeg);
              if (idx>=0){ _fileSel = idx; }
            }
          }catch{}
        })
        .finally(()=>{ _fileLoading=false; if (_filePopupVisible()) _filePopupRender(); try{ const newBaseStr = (function(){ try{ return _fileBaseURL ? _fileBaseURL.toString() : null; }catch{ return null; } })(); console.debug('[parentNav done]', { prevBase:prevBaseStr, newBase:newBaseStr, entries:Array.isArray(_fileEntries)? _fileEntries.length:0 }); }catch{} });
    }catch{}
  }
  // 参照を本体へ即差し替え
  try{
    _fileNavParent = _fileNavParentReal;
    window._fileNavParentRef = _fileNavParentReal;
    window._fileNavParentReady = true;
    console.debug('[parentNav install real]');
    if (_fileNavParentWaitTimer){ try{ clearInterval(_fileNavParentWaitTimer); }catch{} _fileNavParentWaitTimer=null; }
    if (_fileNavParentPending){
      if (window._fileNavParentDidFallback){
        try{ console.debug('[parentNav auto-run skip after-fallback]'); }catch{}
        _fileNavParentPending = false; // 既に一段移動済みなので消化のみ
      } else {
        try{ console.debug('[parentNav auto-run pending]'); _fileNavParentPending = false; window._fileParentNavAutoRunFlag=true; _fileNavParentReal(); }catch(e){ try{ console.warn('[parentNav auto-run error]', e); }catch{} } finally { window._fileParentNavAutoRunFlag=false; }
      }
    }
  }catch{}

  // 早期キャプチャ: 他ハンドラに奪われる前に F1 / Alt+U を検出
  try{
    const earlyParentKey = (e)=>{
      try{
        // 直近ログダンプ (Ctrl+Shift+U) — トーストに加えて Console へ詳細配列を出力
        if ((e.key==='u' || e.key==='U') && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey){
          try{ const lastArr = _fileParentLogs.slice(-20); console.debug('[parentNav dump]', lastArr); }catch{}
          e.preventDefault(); e.stopPropagation(); const last=_fileParentLogs.slice(-10).map(r=>r.phase).join(', '); try{ toast && toast('parentNav logs: '+(last||'(none)'),1200); }catch{} return; }

        // 可視状態を先に取得し、生F1/Alt+U を必ず Console へ記録（初回無反応原因切り分け）
        const popupVisible = (function(){ try{ return typeof _filePopupVisible==='function' && _filePopupVisible(); }catch{ return false; } })();
        const domVisible = (function(){ try{ return bufpopup && bufpopup.dataset && bufpopup.dataset.kind==='file' && bufpopup.style.display!=='none'; }catch{ return false; } })();
        const debugOn = !!window._fileParentDebug;
        if (e.key==='F1' || (e.altKey && (e.key==='u' || e.key==='U' || e.code==='KeyU'))){
          try{
            if (typeof window._fileParentKeyCount!=='number') window._fileParentKeyCount=0;
            window._fileParentKeyCount++;
            const sinceLast = (function(){ try{ return (window._fileParentLastKeyTs? (Date.now()-window._fileParentLastKeyTs):null); }catch{ return null; } })();
            window._fileParentLastKeyTs = Date.now();
            console.debug('[parentNav raw]', { key:e.key, alt:e.altKey, ctrl:e.ctrlKey, shift:e.shiftKey, meta:e.metaKey, mode:_mode, popupVisible, domVisible, debugOn, count:window._fileParentKeyCount, sinceLast });
          }catch{}
        }

        // #812: popup が閉じていても :e 入力中ならコンテキスト許可。初回一度のみになるのを解消。
        const eVal = (cmdinput && typeof cmdinput.value==='string') ? cmdinput.value : '';
        const looksFileCmd = /^\s*:e\s+/i.test(eVal);
        const haveBase = !!_fileBaseURL;
        // #813: 基点が確定していれば popup 不可視でも親移動を許可
        // #814: コンテキスト条件撤廃。F1/Alt+U は常に親移動試行。
        // （モードや可視性は _fileNavParentReal 内部で安全に処理）
        const ctxOk = true;

        const now = Date.now();
        if (typeof window._fileParentNavGuardUntil!=='number') window._fileParentNavGuardUntil = 0;
        const guarded = (now < window._fileParentNavGuardUntil);
        const wantF1 = (!e.altKey && !e.ctrlKey && !e.metaKey && e.key==='F1');
        const wantAltU = (e.altKey && !e.ctrlKey && !e.metaKey && (e.key==='u' || e.key==='U' || e.code==='KeyU'));
        _fileParentLog({ phase:'key-check', wantF1, wantAltU, guarded, popupVisible, domVisible, keyCount:window._fileParentKeyCount });
        if (!guarded && (wantF1 || wantAltU)){
          window._fileParentNavGuardUntil = now + 160;
          e.preventDefault(); e.stopPropagation(); _fileParentLog({ phase:'trigger', key:e.key }); _fileNavParent(); return;
        }
        if (wantF1 || wantAltU){ _fileParentLog({ phase:'guarded-skip', key:e.key }); }
      }catch{ _fileParentLog({ phase:'early-exc' }); }
    };
    // capture=true で最優先（window のみに限定し二重発火を避ける）
    window.addEventListener('keydown', earlyParentKey, true);
    // バブルフェーズでも補足（他リスナーによる stopPropagation 前提の衝突調査用）
    window.addEventListener('keydown', earlyParentKey, false);
  }catch{}

  // Alt+U キーバインド
  try{
    // 親ナビ用の旧補助ハンドラはグローバル統合済みのため除去
  }catch{}
    let typedDirRaw = orig.slice(0, orig.length - filter.length);
    // 特例: スキーム相対の先頭入力 "//host" の途中
    try{
      if (norm.startsWith('//')){
        // UNC/WSL 風の先頭入力は、常に「現時点のディレクトリ部分(dirPart)」を file: スキームでそのまま基点にする
        // 例: "//wsl.localhost/Ubuntu/" → base = file:////wsl.localhost/Ubuntu/
        const body = norm.slice(2); // host/...
        const segs = body.split('/').filter(s=>s.length>0);
        const host = segs[0] || '';
        if (host && host.length >= 3){
          // dirPart は既に先頭から最後の '/' まで（=ディレクトリ部分）。これをそのまま base に採用する。
          const dirForBase = (dirPart || ('//'+host+'/')).replace(/\\/g,'/');
          base = _ensureSlash(new URL('file:' + dirForBase));
          // typedDirRaw/filter は先頭で計算した値を尊重（再構成しない）
        } else {
          // まだ host 未確定: ベースは仮（列挙は別側で抑止）
          base = _ensureSlash(new URL('./', _htmlBaseURL()));
        }
      } else {
        // 通常: '..' を含む場合も URL 解決に任せる
        // 先頭が '/' の絶対パス入力は、現バッファのホストに引きずられないよう
        // HTML 側ベース（ローカル PC 側）を基点に解決する（#168）。
        const isAbsFromRoot = dirPart.startsWith('/') && !dirPart.startsWith('//');
        const baseForResolve = isAbsFromRoot ? _htmlBaseURL() : base;
        base = _ensureSlash(new URL(dirPart || './', baseForResolve));
      }
    } catch {}
    // 絶対パス系のとき、不要な '../' が残らないよう軽く正規化
    // ただし UNC 先頭の '//' は絶対に潰さない（'//host/share/...' を '/host/...' にしない）
    try{
      const raw = typedDirRaw.replace(/\\/g,'/');
      const isUNC = raw.startsWith('//');
      const absLike = /^(?:\/[\/]|[A-Za-z]:\/|\/)/.test(raw);
      if (absLike){
        if (isUNC){
          // 先頭の '//' を保持しつつ、それ以外の重複スラッシュや '/./' を整理
          const restUNC = raw.slice(2).replace(/\/\.\//g,'/').replace(/\/{2,}/g,'/');
          typedDirRaw = '//' + restUNC;
        } else {
          // UNC 以外は通常通り簡易正規化
          typedDirRaw = raw.replace(/\/\.\//g,'/').replace(/\/{2,}/g,'/');
        }
      }
    }catch{}
    return { baseURL: base, typedDirRaw, filter };
  }

  /*********************************************************
   * Seed demo
   *********************************************************/
  function _seedDemo(){
    if (editor.value) return;
    const t = [
      'このバッファは実ファイルに紐づいていないダミーバッファです。',
      ':qで破棄しても問題ありません。',
      '※sixはバッファ無し状態で動作することはないので、他にバッファ(タブ)が無くなれば終了します。',
      '',
      '好きに編集して`:e ファイル名`で保存することも可能です。\n'
    ].join('\n');
    editor.value = t;
    if (buffers.length===0){ _addBuffer({ name: null, path: null, text: t, modified:false }); }
  }

  /*********************************************************
   * Bootstrap
   *********************************************************/
  // Overlay palettes (top-right: buffer-scoped, bottom-right: global)
  function _initOverlayPalette(){
    try{
      const viewport = document.getElementById('editorViewport');
      if (!viewport) return;
      // Ensure palette toggle button wiring (button lives outside overlayPalette) (#469)
      try{
        const toggleBtn = document.getElementById('paletteToggleBtn');
        if (toggleBtn && !toggleBtn.__wired){
          toggleBtn.__wired = true;
          toggleBtn.addEventListener('click', (e)=>{ try{ e.preventDefault(); }catch{} _toggleOverlayPaletteVisibility(); });
          // Enlarge the palette icon (first line) to 1.5x
          try{ const icon = toggleBtn.querySelector('span'); if (icon){ icon.style.fontSize = '1.5em'; icon.style.lineHeight = '1'; } }catch{}
        }
      }catch{}
      // Create roots once
      let palBR = document.getElementById('overlayPalette'); // keep existing id for bottom-right
      if (!palBR){
        palBR = document.createElement('div');
        palBR.id = 'overlayPalette';
        palBR.style.position = 'absolute';
        // Right/bottom will be adjusted to align with scrollbars by _positionPaletteUI()
        palBR.style.right = '0px';
        palBR.style.bottom = '1rem';
        palBR.style.zIndex = '3'; // above caret layer (2)
        palBR.style.pointerEvents = 'auto';
        palBR.style.display = 'flex';
        // Narrow down gap between buttons ~half
        palBR.style.gap = '4px';
        palBR.style.alignItems = 'flex-end';
        // Make overlay palette background fully transparent (#682)
        palBR.style.background = 'rgba(0,0,0,0)';
        palBR.style.border = 'none';
        palBR.style.borderRadius = '0';
        palBR.style.padding = '4px';
        viewport.appendChild(palBR);
      }
      let palTR = document.getElementById('overlayPaletteTop');
      if (!palTR){
        palTR = document.createElement('div');
        palTR.id = 'overlayPaletteTop';
        palTR.style.position = 'absolute';
        // Right/top will be adjusted to align with scrollbars by _positionPaletteUI()
        palTR.style.right = '0px';
        palTR.style.top = '0px';
        palTR.style.zIndex = '3';
        palTR.style.pointerEvents = 'auto';
        palTR.style.display = 'flex';
        palTR.style.flexDirection = 'column';
        palTR.style.gap = '4px';
        palTR.style.alignItems = 'flex-end';
        palTR.style.background = 'rgba(0,0,0,0)';
        palTR.style.border = 'none';
        palTR.style.borderRadius = '0';
        palTR.style.padding = '4px';
        viewport.appendChild(palTR);
      }
      palBR.innerHTML = '';
      palTR.innerHTML = '';
      // Track and restore focus around clicks to keep pre-click focus
      let lastFocusedEl = null;

      // Common hover effect (red-ish background while hovering)
      const attachHover = (el)=>{
        if (!el) return;
        const baseBg = '#1a2030';
        const hovBg  = '#5a1a1a';
        el.addEventListener('mouseenter', ()=>{ try{ el.style.background = hovBg; }catch{} });
        el.addEventListener('mouseleave', ()=>{ try{ el.style.background = baseBg; }catch{} });
      };

  // Create buttons first (append to respective palettes later)
      // 検索ハイライトトグルボタン（左下配置）
      const hlBtn = document.createElement('button');
      hlBtn.type = 'button';
      hlBtn.id = 'overlayBtnHlsearch';
      hlBtn.style.minWidth = '112px';
      hlBtn.style.border = '1px solid #2a3244';
      hlBtn.style.background = '#1a2030';
      hlBtn.style.color = '#e6e6e6';
      hlBtn.style.borderRadius = '6px';
      hlBtn.style.padding = '4px 3px';
      hlBtn.style.cursor = 'pointer';
      hlBtn.style.font = "12px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif";
      hlBtn.style.opacity = '0.92';
      hlBtn.style.userSelect = 'none';
      hlBtn.style.outline = 'none';
      attachHover(hlBtn);
      // Prevent focus change on mouse click
      hlBtn.addEventListener('mousedown', (e)=>{ try{ lastFocusedEl = document.activeElement; e.preventDefault(); }catch{} });
      // inner layout
      const hlWrap = document.createElement('div');
      hlWrap.style.display = 'flex';
      hlWrap.style.flexDirection = 'column';
      hlWrap.style.gap = '2px';
      const hlTitle = document.createElement('div');
      hlTitle.textContent = '検索ハイライト';
      hlTitle.style.textAlign = 'center';
      hlTitle.style.fontWeight = '500';
      const hlLine = document.createElement('div');
      hlLine.style.display = 'flex';
      hlLine.style.justifyContent = 'center';
      hlLine.style.gap = '6px';
      const pillBase = (label, id)=>{
        const s = document.createElement('span');
        s.id = id;
        s.textContent = label;
        s.style.display = 'inline-block';
        s.style.padding = '1px 8px';
        s.style.border = '1px solid #2a3244';
        s.style.borderRadius = '6px';
        s.style.fontSize = '11px';
        s.style.lineHeight = '1.5';
        s.style.userSelect = 'none';
        return s;
      };
      const pillOff = pillBase('OFF', 'overlayBtnHl_off');
      const pillOn  = pillBase('ON',  'overlayBtnHl_on');
      hlLine.appendChild(pillOff);
      hlLine.appendChild(pillOn);
      hlWrap.appendChild(hlTitle);
      hlWrap.appendChild(hlLine);
      hlBtn.appendChild(hlWrap);
      hlBtn.addEventListener('click', (e)=>{
        try{ e.preventDefault(); e.stopPropagation(); }catch{}
        try{ _optHlsearch = !_optHlsearch; }catch{}
        try{ _updateHlsearchFull(); }catch{}
        try{ _updateOverlayHlsearchVisual(); }catch{}
        try{ toast('hlsearch: ' + (_optHlsearch?'on':'off'), 900); }catch{}
        // Restore pre-click focus if possible
        try{ if (lastFocusedEl && typeof lastFocusedEl.focus === 'function'){ lastFocusedEl.focus(); } }catch{}
      });

      // インデント幅ボタン（右上パレット：バッファ毎設定）
      const swBtn = document.createElement('button');
      swBtn.type = 'button';
      swBtn.id = 'overlayBtnShiftwidth';
      swBtn.style.minWidth = '100px';
      swBtn.style.border = '1px solid #2a3244';
      swBtn.style.background = '#1a2030';
      swBtn.style.color = '#e6e6e6';
      swBtn.style.borderRadius = '6px';
      swBtn.style.padding = '4px 3px';
      swBtn.style.cursor = 'pointer';
      swBtn.style.font = "12px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif";
      swBtn.style.opacity = '0.92';
      swBtn.style.userSelect = 'none';
      swBtn.style.outline = 'none';
      attachHover(swBtn);
      swBtn.addEventListener('mousedown', (e)=>{ try{ lastFocusedEl = document.activeElement; e.preventDefault(); }catch{} });
      const swWrap = document.createElement('div');
      swWrap.style.display = 'flex';
      swWrap.style.flexDirection = 'column';
      swWrap.style.gap = '2px';
      const swTitle = document.createElement('div');
      swTitle.textContent = 'インデント幅';
      swTitle.style.textAlign = 'center';
      swTitle.style.fontWeight = '500';
      const swLine = document.createElement('div');
      swLine.style.display = 'flex';
      swLine.style.justifyContent = 'center';
      swLine.style.gap = '3px';
      const swPillBase = (label, id)=>{
        const s = document.createElement('span');
        s.id = id;
        s.textContent = label;
        s.style.display = 'inline-block';
        s.style.padding = '1px 8px';
        s.style.border = '1px solid #2a3244';
        s.style.borderRadius = '6px';
        s.style.fontSize = '11px';
        s.style.lineHeight = '1.5';
        s.style.userSelect = 'none';
        return s;
      };
      const swP2 = swPillBase('2', 'overlayBtnSw_2');
      const swP4 = swPillBase('4', 'overlayBtnSw_4');
      const swP8 = swPillBase('8', 'overlayBtnSw_8');
      swLine.appendChild(swP2); swLine.appendChild(swP4); swLine.appendChild(swP8);
      swWrap.appendChild(swTitle); swWrap.appendChild(swLine); swBtn.appendChild(swWrap);
      swBtn.addEventListener('click', (e)=>{
        try{ e.preventDefault(); e.stopPropagation(); }catch{}
        try{
          const b = currentBuffer();
          const cur = _getShiftWidth();
          const next = (cur===2)?4 : (cur===4)?8 : (cur===8)?2 : 2;
          if (b){ b.shiftwidth = Math.max(1, next|0); _schedulePersist('shiftwidth'); }
          try{ _updateOverlayShiftwidthVisual(); }catch{}
          try{ toast('shiftwidth = ' + next, 900); }catch{}
        }catch{}
        try{ if (lastFocusedEl && typeof lastFocusedEl.focus === 'function'){ lastFocusedEl.focus(); } }catch{}
      });

      // Help button（右下配置, 2行ラベル: ヘルプ / F9, :help）
      const helpBtn = document.createElement('button');
      helpBtn.type = 'button';
      helpBtn.textContent = 'ヘルプ\nF9, :help';
      helpBtn.style.whiteSpace = 'pre';
      helpBtn.style.minWidth = '64px';
      helpBtn.style.border = '1px solid #2a3244';
      helpBtn.style.background = '#1a2030';
      helpBtn.style.color = '#e6e6e6';
      helpBtn.style.borderRadius = '6px';
      helpBtn.style.padding = '4px 3px';
      helpBtn.style.cursor = 'pointer';
      helpBtn.style.font = "12px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif";
      helpBtn.style.opacity = '0.92';
      helpBtn.style.userSelect = 'none';
      helpBtn.style.outline = 'none';
      attachHover(helpBtn);
      helpBtn.addEventListener('mousedown', (e)=>{ try{ lastFocusedEl = document.activeElement; e.preventDefault(); }catch{} });
      helpBtn.addEventListener('click', (e)=>{
        try{ e.preventDefault(); e.stopPropagation(); }catch{}
        try{ helpModal({ defaultTab: 'cmd' }); }catch{}
        try{
          if (!_modalOverlay || _modalOverlay.style.display === 'none'){
            if (lastFocusedEl && typeof lastFocusedEl.focus === 'function'){
              lastFocusedEl.focus();
            }
          }
        }catch{}
      });

      // 制御文字表示（list オプション）ボタン（即時終了ボタンの左側 = グリッド上段左）
      const listBtn = document.createElement('button');
      listBtn.type = 'button';
      listBtn.id = 'overlayBtnList';
      listBtn.style.minWidth = '112px';
      listBtn.style.border = '1px solid #2a3244';
      listBtn.style.background = '#1a2030';
      listBtn.style.color = '#e6e6e6';
      listBtn.style.borderRadius = '6px';
      listBtn.style.padding = '4px 3px';
      listBtn.style.cursor = 'pointer';
      listBtn.style.font = "12px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif";
      listBtn.style.opacity = '0.92';
      listBtn.style.userSelect = 'none';
      listBtn.style.outline = 'none';
      attachHover(listBtn);
      listBtn.addEventListener('mousedown', (e)=>{ try{ lastFocusedEl = document.activeElement; e.preventDefault(); }catch{} });
      const listWrap = document.createElement('div');
      listWrap.style.display = 'flex';
      listWrap.style.flexDirection = 'column';
      listWrap.style.gap = '2px';
      const listTitle = document.createElement('div');
      listTitle.textContent = '制御文字表示';
      listTitle.style.textAlign = 'center';
      listTitle.style.fontWeight = '500';
      const listLine = document.createElement('div');
      listLine.style.display = 'flex';
      listLine.style.justifyContent = 'center';
      listLine.style.gap = '6px';
      const listPillOff = pillBase('OFF', 'overlayBtnList_off');
      const listPillOn  = pillBase('ON',  'overlayBtnList_on');
      listLine.appendChild(listPillOff); listLine.appendChild(listPillOn);
      listWrap.appendChild(listTitle); listWrap.appendChild(listLine); listBtn.appendChild(listWrap);
      listBtn.addEventListener('click', (e)=>{
        try{ e.preventDefault(); e.stopPropagation(); }catch{}
        try{ _optList = !_optList; }catch{}
        try{ _renderListChars(); }catch{}
        try{ updateGutter(); }catch{}
        try{ _updateOverlayListVisual(); }catch{}
        try{ toast('list: ' + (_optList?'on':'off'), 900); }catch{}
        try{ if (lastFocusedEl && typeof lastFocusedEl.focus === 'function'){ lastFocusedEl.focus(); } }catch{}
      });

      // 即時終了ボタン（右上配置。ラベル後半は 'F10'）
      const quitBtn = document.createElement('button');
      quitBtn.type = 'button';
      quitBtn.textContent = '即時終了\nF10';
      quitBtn.style.whiteSpace = 'pre';
      quitBtn.style.minWidth = '80px';
      quitBtn.style.border = '1px solid #2a3244';
      quitBtn.style.background = '#1a2030';
      quitBtn.style.color = '#e6e6e6';
      quitBtn.style.borderRadius = '6px';
      quitBtn.style.padding = '4px 3px';
      quitBtn.style.cursor = 'pointer';
      quitBtn.style.font = "12px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif";
      quitBtn.style.opacity = '0.92';
      quitBtn.style.userSelect = 'none';
      quitBtn.style.outline = 'none';
      attachHover(quitBtn);
      let lastFocusedEl2 = null;
      quitBtn.addEventListener('mousedown', (e)=>{ try{ lastFocusedEl2 = document.activeElement; e.preventDefault(); }catch{} });
      quitBtn.addEventListener('click', (e)=>{
        try{ e.preventDefault(); e.stopPropagation(); }catch{}
        try{
          _persistSessionNow();
          _suppressPersistOnQuit = false;
          _skipPersistOnUnloadOnce = true; _quittingAll = true; _allowUnloadOnce = true;
        }catch{}
        try{ window.close(); }catch{}
        try{ if (lastFocusedEl2 && typeof lastFocusedEl2.focus==='function') lastFocusedEl2.focus(); }catch{}
      });

      // Build bottom-right grid 3x2 (global options)
      const gridBR = document.createElement('div');
      gridBR.style.display = 'grid';
      gridBR.style.gridTemplateColumns = 'auto auto auto';
      gridBR.style.columnGap = '4px';
      gridBR.style.rowGap = '4px';
      // Row1: [empty][list][quit]
      const emptyTL = document.createElement('div');
      gridBR.appendChild(emptyTL);   // top-left empty
      gridBR.appendChild(listBtn);   // top-center
      gridBR.appendChild(quitBtn);   // top-right
      // Row2: [empty][hlsearch][help] （shiftwidth は右上へ移動）
      const emptyBL = document.createElement('div');
      gridBR.appendChild(emptyBL);   // bottom-left empty
      gridBR.appendChild(hlBtn);     // bottom-center
      gridBR.appendChild(helpBtn);   // bottom-right
      palBR.appendChild(gridBR);

      // Build top-right palette content (buffer-scoped)
      // Encode button (moved from tabbar; placed above shiftwidth)
      const encOLBtn = document.createElement('button');
      encOLBtn.type = 'button';
      encOLBtn.id = 'overlayBtnEncode';
      encOLBtn.style.minWidth = '100px';
      encOLBtn.style.border = '1px solid #2a3244';
      encOLBtn.style.background = '#1a2030';
      encOLBtn.style.color = '#e6e6e6';
      encOLBtn.style.borderRadius = '6px';
      encOLBtn.style.padding = '4px 3px';
      encOLBtn.style.cursor = 'pointer';
      encOLBtn.style.font = "12px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif";
      encOLBtn.style.opacity = '0.92';
      encOLBtn.style.userSelect = 'none';
      encOLBtn.style.outline = 'none';
      attachHover(encOLBtn);
      encOLBtn.addEventListener('mousedown', (e)=>{ try{ lastFocusedEl = document.activeElement; e.preventDefault(); }catch{} });
      const encWrap = document.createElement('div');
      encWrap.style.display = 'flex'; encWrap.style.flexDirection = 'column'; encWrap.style.gap = '2px';
      const encTitle = document.createElement('div'); encTitle.textContent = 'encode'; encTitle.style.textAlign = 'center'; encTitle.style.fontWeight = '500';
      const encLine = document.createElement('div'); encLine.id = 'overlayBtnEncode_label'; encLine.style.display = 'block'; encLine.style.textAlign = 'center'; encLine.style.padding = '2px 8px'; encLine.style.border = '1px solid #2a3244'; encLine.style.borderRadius = '6px'; encLine.style.fontSize = '11px'; encLine.style.lineHeight = '1.5'; encLine.style.background = '#0e2348'; encLine.style.boxShadow = '0 1px 2px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.06)'; encLine.style.color = '#e6f0ff';
      encWrap.appendChild(encTitle); encWrap.appendChild(encLine); encOLBtn.appendChild(encWrap);
      encOLBtn.addEventListener('click', (e)=>{ try{ e.preventDefault(); e.stopPropagation(); }catch{}; if (_encPopupVisible()){ _encPopupHide(); } else { _encPopupShow(encOLBtn); } try{ if (lastFocusedEl && typeof lastFocusedEl.focus==='function') lastFocusedEl.focus(); }catch{} });
      palTR.appendChild(encOLBtn);

      palTR.appendChild(swBtn);

      // 検索時 A/a（ignorecase/smartcase のまとめボタン） — shiftwidthの下に配置
      const caseBtn = document.createElement('button');
      caseBtn.type = 'button';
      caseBtn.id = 'overlayBtnCase';
      // Align width with shiftwidth button
      caseBtn.style.minWidth = '100px';
      caseBtn.style.border = '1px solid #2a3244';
      caseBtn.style.background = '#1a2030';
      caseBtn.style.color = '#e6e6e6';
      caseBtn.style.borderRadius = '6px';
      caseBtn.style.padding = '4px 3px';
      caseBtn.style.cursor = 'pointer';
      caseBtn.style.font = "12px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif";
      caseBtn.style.opacity = '0.92';
      caseBtn.style.userSelect = 'none';
      caseBtn.style.outline = 'none';
      attachHover(caseBtn);
      caseBtn.addEventListener('mousedown', (e)=>{ try{ lastFocusedEl = document.activeElement; e.preventDefault(); }catch{} });
      const caseWrap = document.createElement('div');
      caseWrap.style.display = 'flex';
      caseWrap.style.flexDirection = 'column';
      caseWrap.style.gap = '2px';
      const caseTitle = document.createElement('div');
      caseTitle.textContent = '検索時 A/a';
      caseTitle.style.textAlign = 'center';
      caseTitle.style.fontWeight = '500';
      const caseLine = document.createElement('div');
      caseLine.id = 'overlayBtnCase_label';
      caseLine.style.display = 'block';
      caseLine.style.textAlign = 'center';
      caseLine.style.padding = '2px 8px';
      caseLine.style.border = '1px solid #2a3244';
      caseLine.style.borderRadius = '6px';
      caseLine.style.fontSize = '11px';
      caseLine.style.lineHeight = '1.5';
      // 影付きの浮き上がった紺色
      caseLine.style.background = '#0e2348';
      caseLine.style.boxShadow = '0 1px 2px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.06)';
      caseLine.style.color = '#e6f0ff';
      caseWrap.appendChild(caseTitle);
      caseWrap.appendChild(caseLine);
      caseBtn.appendChild(caseWrap);
      caseBtn.addEventListener('click', (e)=>{
        try{ e.preventDefault(); e.stopPropagation(); }catch{}
        if (_casePopupVisible()) _casePopupHide(); else _casePopupShow(caseBtn);
        try{ if (lastFocusedEl && typeof lastFocusedEl.focus==='function') lastFocusedEl.focus(); }catch{}
      });
      palTR.appendChild(caseBtn);

  // initialize visual state for hlsearch & list pills
  try{ _updateOverlayHlsearchVisual(); }catch{}
  try{ _updateOverlayListVisual(); }catch{}
  try{ _updateOverlayEncodeVisual(); }catch{}
  try{ _updateOverlayShiftwidthVisual(); }catch{}
  try{ _updateOverlayCaseVisual(); }catch{}
      // Initial position sync with scrollbars
      try{ _positionPaletteUI(); }catch{}
      
    }catch{}
  }

  // Position palette toggle button (fixed) and overlay palette (absolute) to align with scrollbars
  function _positionPaletteUI(){
    try{
      const toggleBtn = document.getElementById('paletteToggleBtn');
      const palBR = document.getElementById('overlayPalette');
      const palTR = document.getElementById('overlayPaletteTop');
      // Compute vertical scrollbar width and horizontal scrollbar height from editor
      const sbw = (function(){ try{ if (!editor) return 0; const w=(editor.offsetWidth|0)-(editor.clientWidth|0); return w>0?w:0; }catch{ return 0; } })();
      const sbh = (function(){ try{ if (!editor) return 0; const h=(editor.offsetHeight|0)-(editor.clientHeight|0); return h>0?h:0; }catch{ return 0; } })();
      // Palette container padding (keep in sync with pal.style.padding above)
      const palPad = 4;
      // Align toggle button: right edge should align to the right edge of the palette's rightmost inner button
      // → palette right edge aligns to scrollbar (sbw), inner button ends at (sbw + palPad) from viewport right.
      if (toggleBtn){
        toggleBtn.style.right = ((sbw|0) + palPad) + 'px';
        toggleBtn.style.bottom = (sbh|0) + 'px';
      }
      // Align bottom-right overlay with scrollbar (sbw) and above the toggle button
      if (palBR){
        palBR.style.right = (sbw|0) + 'px';
        let btnH = 28;
        try{ if (toggleBtn){ const r = toggleBtn.getBoundingClientRect(); if (r && r.height) btnH = Math.ceil(r.height); } }catch{}
        const gap = 0;
        palBR.style.bottom = ((sbh|0) + btnH + gap) + 'px';
      }
      // Align top-right overlay with scrollbar (sbw) at the very top of the editor viewport
      if (palTR){
        palTR.style.right = (sbw|0) + 'px';
        palTR.style.top = '0px';
      }
    }catch{}
  }

  // Internal flag (not persisted) for palette visibility (#469)
  let _overlayPaletteVisible = true; // start visible every session
  function _toggleOverlayPaletteVisibility(){
    try{
      const palBR = document.getElementById('overlayPalette');
      const palTR = document.getElementById('overlayPaletteTop');
      _overlayPaletteVisible = !_overlayPaletteVisible;
      if (palBR) palBR.style.display = _overlayPaletteVisible ? 'flex' : 'none';
      if (palTR) palTR.style.display = _overlayPaletteVisible ? 'flex' : 'none';
      try{ _positionPaletteUI(); }catch{}
    }catch{}
  }

  // Reflect current hlsearch state to overlay button
  function _updateOverlayHlsearchVisual(){
    try{
      const off = document.getElementById('overlayBtnHl_off');
      const on  = document.getElementById('overlayBtnHl_on');
      if (!off || !on) return;
      // colors
      const gray = '#9aa0aa';
      const green = '#49e26f';
      // reset
      off.style.background = 'transparent';
      on.style.background  = 'transparent';
      off.style.color = '#e6e6e6';
      on .style.color = '#e6e6e6';
      // active
      if (_optHlsearch){
        on.style.background = green; on.style.color = '#000';
      }else{
        off.style.background = gray; off.style.color = '#000';
      }
    }catch{}
  }

  // Reflect current list option state to overlay button
  function _updateOverlayListVisual(){
    try{
      const off = document.getElementById('overlayBtnList_off');
      const on  = document.getElementById('overlayBtnList_on');
      if (!off || !on) return;
      const gray = '#9aa0aa';
      const green = '#49e26f';
      off.style.background = 'transparent';
      on.style.background  = 'transparent';
      off.style.color = '#e6e6e6';
      on .style.color = '#e6e6e6';
      if (_optList){
        on.style.background = green; on.style.color = '#000';
      }else{
        off.style.background = gray; off.style.color = '#000';
      }
    }catch{}
  }

  // Reflect current shiftwidth (2/4/8) state to overlay button
  function _updateOverlayShiftwidthVisual(){
    try{
      const p2 = document.getElementById('overlayBtnSw_2');
      const p4 = document.getElementById('overlayBtnSw_4');
      const p8 = document.getElementById('overlayBtnSw_8');
      if (!p2 || !p4 || !p8) return;
      const green = '#49e26f';
      // reset
      for (const p of [p2,p4,p8]){ p.style.background = 'transparent'; p.style.color = '#e6e6e6'; }
      const sw = _getShiftWidth();
      if (sw === 2){ p2.style.background = green; p2.style.color = '#000'; }
      else if (sw === 4){ p4.style.background = green; p4.style.color = '#000'; }
      else if (sw === 8){ p8.style.background = green; p8.style.color = '#000'; }
      // other values: none highlighted
    }catch{}
  }

  // Reflect current ignorecase/smartcase state to overlay case button label
  function _updateOverlayCaseVisual(){
    try{
      const el = document.getElementById('overlayBtnCase_label');
      if (!el) return;
      const b = currentBuffer();
      const ic = !!(b && b.ignorecase);
      const sc = !!(b && b.smartcase);
      let label = '常に区別';
      if (ic){ label = sc ? '混在時区別' : '同一視'; }
      el.textContent = label;
    }catch{}
  }

  // Reflect current encode/ff/bom to overlay encode button label
  function _updateOverlayEncodeVisual(){
    try{
      const el = document.getElementById('overlayBtnEncode_label');
      if (!el) return;
      const b=currentBuffer();
      const meta = b ? { enc:b.enc||'utf-8', ff:b.ff||'unix', bom:!!b.bom } : { enc:'utf-8', ff:'unix', bom:false };
      const d = _encDisplayLines(meta);
      // On overlay label: show single line, append bomb inline when present
      el.textContent = d.line2 ? (d.line1 + ' ' + d.line2) : d.line1;
    }catch{}
  }

  function _wireHelpOpenShortcut(){
    // Consume F1–F9 globally to block browser/host default actions.
    // Actions: F1–F8 switch tabs (also from :b popup); F9 opens Help when no modal/other popup is visible.
    try{
      const handler = (e)=>{
        try{
          const key = e.key;
          // Allow hard reload (Ctrl+F5) to bypass interception so browser can fetch fresh resources (#440)
          if (key === 'F5' && e.ctrlKey && !e.altKey && !e.metaKey){
            return; // don't preventDefault
          }
          // Compute UI states up-front
          const isModalOpen = !!(_modalOverlay && _modalOverlay.style && _modalOverlay.style.display !== 'none');
          const inCmd = (_mode === 'CMD');
          const encOpen  = (typeof _encPopupVisible==='function' && _encPopupVisible());
          const caseOpen = (typeof _casePopupVisible==='function' && _casePopupVisible());
          const fileOpenReal = (typeof _filePopupVisible==='function' && _filePopupVisible());
          const bufOpen  = (typeof _bufPopupVisible==='function' && _bufPopupVisible());

          // Special: F1 in :e file popup (CMD) => parent directory navigation (override generic consumption)
          if (fileOpenReal && inCmd && key==='F1' && !e.altKey && !e.ctrlKey && !e.metaKey){
            try{ e.preventDefault(); e.stopPropagation(); }catch{}
            try{ _fileNavParent && _fileNavParent(); }catch{}
            return;
          }
          // Alt+U / Alt+↑: 親ディレクトリ（ポップアップ表示中のみ）
          if (fileOpenReal && inCmd && e.altKey && !e.ctrlKey && !e.metaKey && (key==='u' || key==='U' || e.code==='KeyU')){
            try{ e.preventDefault(); e.stopPropagation(); }catch{}
            try{ _fileNavParent && _fileNavParent(); }catch{}
            return;
          }

          // Ctrl+F9 (or Meta+F9): toggle overlay palette visibility (#469) — handle before plain F9
          if ((key==='F9' || e.keyCode===120 || e.which===120) && (e.ctrlKey || e.metaKey)){
            try{ e.preventDefault(); e.stopPropagation(); }catch{}
            _toggleOverlayPaletteVisibility();
            return;
          }
          // Hidden feature: Ctrl+9 toggles overlay palette as well (same as Ctrl+F9)
          if ((key==='9' || e.keyCode===57 || e.which===57) && e.ctrlKey){
            try{ e.preventDefault(); e.stopPropagation(); }catch{}
            _toggleOverlayPaletteVisibility();
            return;
          }
          // F10: 即時終了（#435: 終了直前にセッションを保存してから閉じる）
          if (key === 'F10'){
            try{ e.preventDefault(); e.stopPropagation(); }catch{}
            try{
              _persistSessionNow();
              _suppressPersistOnQuit = false;
              _skipPersistOnUnloadOnce = true; // onbeforeunload での二重書き込みを避ける
              _quittingAll = true; _allowUnloadOnce = true;
            }catch{}
            try{ window.close(); }catch{}
            return;
          }
          // F9: open Help (if no modal). If Help (modal) is open, let F9 pass through so Help's own handler can close it.
          if (key === 'F9'){
            if (!isModalOpen){
              try{ e.preventDefault(); e.stopPropagation(); }catch{}
              try{ if (encOpen) _encPopupHide(); }catch{}
              try{ if (caseOpen) _casePopupHide(); }catch{}
              try{ if (fileOpen) _filePopupHide(); }catch{}
              try{ if (bufOpen) _bufPopupHide(); }catch{}
              helpModal({ defaultTab: 'cmd' });
            } else {
              // Do not consume; allow Help's onKey handler to see F9 and close
            }
            return;
          }
          // (Plain F5 is handled by the generic F1–F8 tab switching below; do not swallow here)

          // :b popup visible → F1–F8 or digits 1–8 = direct selection（ただし、テキストフィルタ中は数字を無効化して入力として扱う）
          if (bufOpen && (/^F[1-8]$/.test(key) || /^[1-8]$/.test(key))){
            // In CMD with ":b <text>..." (text filter), disable digit direct selection
            const isFKey = /^F[1-8]$/.test(key);
            const isDigit = /^[1-8]$/.test(key);
            const vNow = (function(){ try{ return String((cmdinput && cmdinput.value) || ''); }catch{ return ''; } })();
            const isBWithSpaceAndMore = /^\s*:?:?\s*b\s+\S/i.test(vNow);
            const textFilterActive = (inCmd && _bufFilterKind === 'text' && isBWithSpaceAndMore);
            const allow = isFKey || !textFilterActive; // always allow F-keys; block digits under text filter
            if (allow){
              try{ e.preventDefault(); e.stopPropagation(); }catch{}
              const n = isFKey ? parseInt(key.slice(1), 10) : parseInt(key, 10);
              const targetIdx = n - 1;
              if (targetIdx >= 0 && targetIdx < buffers.length){
                // Fully emulate 'Esc → F{n}': exit CMD/popups with guarded viewport restore (light), then switch next tick
                let st0 = 0; try{ st0 = (editor && typeof editor.scrollTop==='number') ? (editor.scrollTop|0) : 0; }catch{}
                try{ _cmdExitAndRestoreView({ forImmediateSwitch:true }); }catch{}
                setTimeout(()=>{ try{ if (targetIdx !== currentIdx){ _switchToBuffer(targetIdx); } else { _keepViewportNoop(st0); } }catch{} }, 0);
              }
              return;
            }
            // If not allowed (text filter + digit), fall through so the key is handled by cmdinput
          }

          // When any modal or non-buf popup is open, consume function keys to avoid host defaults (except F10 handled above)
          if (isModalOpen || encOpen || (fileOpenReal && key!=='F1')){
            if (/^F\d{1,2}$/i.test(key)){ try{ e.preventDefault(); e.stopPropagation(); }catch{} }
            return;
          }

          // F1–F8: direct tab switching (not in CMD)
          if (/^F[1-8]$/.test(key) && !inCmd){
            try{ e.preventDefault(); e.stopPropagation(); }catch{}
            const n = parseInt(key.slice(1), 10);
            const targetIdx = n - 1;
            if (targetIdx >= 0 && targetIdx < buffers.length){
              if (targetIdx !== currentIdx){ _switchToBuffer(targetIdx); }
              setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0);
            }
            return;
          }
          // In CMD, trap F1–F8 to block browser defaults (do not switch tabs here)
          if (/^F[1-8]$/.test(key) && inCmd){ try{ e.preventDefault(); e.stopPropagation(); }catch{} return; }
          // Other keys: ignore
          return;
          // (F9 handled earlier)
        }catch{}
      };
      // Capture at both window and document to be resilient across hosts
      window.addEventListener('keydown', handler, true);
      document.addEventListener('keydown', handler, true);
    }catch{}
  }

  function _bootstrap(){
    try{
      _readApiFromHash();
      _applyTheme();
      // Try to refresh customize file with cache-buster, then re-apply theme once more
      try{
        _reloadCustomizeFresh()
          .then(()=>{ try{ _applyTheme(); _repositionCaret(); updateGutter(); }catch{} })
          .catch(()=>{});
      }catch{}
      // Sync metrics (line-height, font-size, measurement span)
      _syncEditorMetrics();
      _wireZoomHUD();
      // Save session opportunistically on unload (no prompt)
  try{ window.addEventListener('beforeunload', ()=>{ try{ if (!_skipPersistOnUnloadOnce) _persistSessionNow(); }catch{} }, { capture:true }); }catch{}
      const loadP = Promise.resolve().then(()=>_loadDocFromQuery()).catch(()=>false);
      const watchdog = new Promise(resolve=> setTimeout(()=>resolve(false), 1500));
      Promise.race([loadP, watchdog]).then(loaded=>{
        // If no ?doc= provided or it failed, try restoring last session
        let ok = !!loaded;
        try{ if (!ok){ ok = !!_loadSessionFromStorage(); } }catch{}
        if (!ok && !editor.value) _seedDemo();
        initialQuickViewportPaint();
        clampViewportExactLines();
        _initLineLock();
        bindEvents();
        if (cmdinput){ cmdinput.placeholder = 'command (e.g. :100, :q)'; }
        caretRow = Math.max(0, Math.min(_totalLines()-1, caretRow));
        caretCol = Math.max(0, caretCol);
        ensureScrolloff({centerOnce:false});
        _repositionCaret();
        updateGutter();
        _renderTabbar();
        _initOverlayPalette();
        _wireHelpOpenShortcut();
        // Background: on startup session restore, refresh ext mtime/size for all file-backed buffers
        // Skip ones marked as external-change-ignored. Persist once after refresh.
        try{
          setTimeout(()=>{
            (async()=>{
              let touched = false;
              for (const b of buffers){
                try{
                  if (!b || !b.path || !/^file:\/\//i.test(b.path)) continue;
                  if (b._externalChangeIgnored) continue; // do not override when user chose to ignore
                  const meta = await _statFileMeta(b.path);
                  if (meta){
                    let any = false;
                    if (typeof meta.mtime === 'number' && meta.mtime !== b._extMtime){ b._extMtime = meta.mtime; any = true; }
                    if (typeof meta.size  === 'number' && meta.size  !== b._extSize ){ b._extSize  = meta.size;  any = true; }
                    if (any) touched = true;
                  }
                }catch{}
              }
              if (touched){ try{ _schedulePersist('startup-mtime'); }catch{} }
            })();
          }, 0);
        }catch{}
        // 起動直後（セッション復元直後）にもアクティブファイルの外部削除/変更を一度確認
        try{
          setTimeout(()=>{
            try{
              const idx = (typeof currentIdx==='number') ? currentIdx : -1;
              const b = (idx>=0 && idx<buffers.length) ? buffers[idx] : null;
              if (b && b.path && /^file:\/\//i.test(b.path)){
                _maybeCheckExternalChangeOnActivate(idx);
              }
            }catch{}
          }, 180);
        }catch{}
  // Ensure initial IME hint/visuals match current mode (typically NORMAL)
  try{ _setMode(_mode); }catch{}
        // Wire encoding button and popup interactions
        try{
          // Global capture: consume Ctrl+U to avoid Edge side-effects (#447)
          window.addEventListener('keydown', (e)=>{
            try{
              if (e && e.ctrlKey && !e.altKey && !e.metaKey && (e.key==='u' || e.key==='U')){
                e.preventDefault(); e.stopPropagation();
              }
            }catch{}
          }, true);
          // Remove legacy tabbar encode button (moved to right-top overlay)
          try{ if (encBtn && encBtn.parentNode){ encBtn.parentNode.removeChild(encBtn); } }catch{}
          if (encBtn && encBtn.isConnected){
            encBtn.style.whiteSpace = 'pre';
            encBtn.addEventListener('mousedown', (e)=>{ e.preventDefault(); });
            encBtn.addEventListener('click', (e)=>{ try{ e.preventDefault(); e.stopPropagation(); }catch{}; if (_encPopupVisible()){ _encPopupHide(); } else { _encPopupShow(encBtn); }});
          }
          // Close on outside click
          document.addEventListener('mousedown', (e)=>{
            try{
              const pop = document.getElementById('encpopup');
              if (!pop || pop.style.display==='none') return;
              const withinPopup = pop.contains(e.target);
              const withinBtn1 = encBtn && encBtn.contains && encBtn.contains(e.target);
              const encOL = document.getElementById('overlayBtnEncode');
              const withinBtn2 = encOL && encOL.contains && encOL.contains(e.target);
              if (!withinPopup && !withinBtn1 && !withinBtn2){ _encPopupHide(); }
            }catch{}
          }, true);
          // Keyboard navigation for popup (capture-phase)
          window.addEventListener('keydown', (e)=>{
            try{
              if (!_encPopupVisible()) return;
              const key = e.key;
              if (key==='Escape'){ e.preventDefault(); e.stopPropagation(); _encPopupHide(); return; }
              if (key==='ArrowUp' || key==='k'){ e.preventDefault(); e.stopPropagation(); _encPopupMoveSel(-1); return; }
              if (key==='ArrowDown' || key==='j' || key==='Tab'){ e.preventDefault(); e.stopPropagation(); _encPopupMoveSel(+1); return; }
              if (key==='Home'){ e.preventDefault(); e.stopPropagation(); try{ _encSel = 0; _encPopupRender(); }catch{} return; }
              if (key==='End'){ e.preventDefault(); e.stopPropagation(); try{ _encSel = Math.max(0, _allowedEncodeSets.length-1); _encPopupRender(); }catch{} return; }
              if (key==='PageUp'){ e.preventDefault(); e.stopPropagation(); try{ _encPopupMoveSel(-4); }catch{} return; }
              if (key==='PageDown'){ e.preventDefault(); e.stopPropagation(); try{ _encPopupMoveSel(+4); }catch{} return; }
              if (e.key==='Enter'){
                e.preventDefault(); e.stopPropagation();
                const idx = Math.max(0, Math.min(_allowedEncodeSets.length-1, _encSel|0));
                const meta = _allowedEncodeSets[idx] || null;
                if (meta) _applyEncodeMeta(meta);
                _encPopupHide();
                setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0);
                return;
              }
            }catch{}
          }, true);
          // Case popup: outside-click close and keyboard navigation (capture-phase)
          try{
            const caseBtnEl = document.getElementById('overlayBtnCase');
            // Close on outside click
            document.addEventListener('mousedown', (e)=>{
              try{
                const pop = document.getElementById('casepopup');
                if (!pop || pop.style.display==='none') return;
                const withinPopup = pop.contains(e.target);
                const withinBtn = caseBtnEl && caseBtnEl.contains && caseBtnEl.contains(e.target);
                if (!withinPopup && !withinBtn){ _casePopupHide(); }
              }catch{}
            }, true);
            // Keyboard navigation
            window.addEventListener('keydown', (e)=>{
              try{
                if (!_casePopupVisible()) return;
                const key = e.key;
                if (key==='Escape'){ e.preventDefault(); e.stopPropagation(); _casePopupHide(); return; }
                if (key==='ArrowUp' || key==='k'){ e.preventDefault(); e.stopPropagation(); _casePopupMoveSel(-1); return; }
                if (key==='ArrowDown' || key==='j' || key==='Tab'){ e.preventDefault(); e.stopPropagation(); _casePopupMoveSel(+1); return; }
                if (key==='Home'){ e.preventDefault(); e.stopPropagation(); try{ _caseSel = 0; _casePopupRender(); }catch{} return; }
                if (key==='End'){ e.preventDefault(); e.stopPropagation(); try{ _caseSel = 2; _casePopupRender(); }catch{} return; }
                if (e.key==='Enter'){
                  e.preventDefault(); e.stopPropagation();
                  const idx = Math.max(0, Math.min(2, _caseSel|0));
                  _applyCaseIndex(idx);
                  _casePopupHide();
                  setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} }, 0);
                  return;
                }
              }catch{}
            }, true);
          }catch{}
          // Ensure Esc closes :e file popup even when focus is not in cmdinput
          window.addEventListener('keydown', (e)=>{
            try{
              if (!_filePopupVisible || !_filePopupVisible()) return;
              if (_isEsc(e)){
                e.preventDefault(); e.stopPropagation();
                try{ _filePopupHide(); }catch{}
                // keep CMD input as-is; focus back to cmdinput if present
                try{ if (cmdinput && typeof cmdinput.focus==='function'){ cmdinput.focus(); } }catch{}
                return;
              }
            }catch{}
          }, true);
        }catch{}
        // hide boot sentinel if present
        try{ const bw = document.getElementById('bootwarn'); if (bw) bw.style.display='none'; }catch{}
        setTimeout(()=>{ try{ editor.focus(); }catch{} }, 0);
        try{ console.debug && console.debug('[six] boot done'); }catch{}
      });
    }catch(e){
      try{
        console.error('起動に失敗しました。再度お試しください。');
        console.error('[six] boot error', e);
        // 可能なら画面にも表示
        try{
          const bw = document.getElementById('bootwarn');
          if (bw){ bw.style.display=''; bw.textContent='six: 起動に失敗しました。再度お試しください。'; }
        }catch{}
        // すぐに閉じる（ポリシー上閉じられない環境もある）
        try{ window.close(); }catch{}
      }catch{}
    }
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _bootstrap, { once:true });
  } else {
    _bootstrap();
  }

  window.six = {
    runCommand,
    setScrolloff:(n)=>{ try{ const v = parseInt(n,10); if (Number.isNaN(v)) return; scrolloff = v|0; _schedulePersist('scrolloff'); ensureScrolloff({force:true}); _repositionCaret(); updateGutter(); }catch{} }
  };
})();
