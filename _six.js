// six migration oriented bootstrap (spec-aligned skeleton with file load)
(function(){

  // DOM elements
  const viewport   = document.getElementById('editorViewport');
  const editor     = document.getElementById('editor');
  const gutter     = document.getElementById('gutter');
  const caretLayer = document.getElementById('caretLayer');
  const edstripe   = document.getElementById('edstripe');
  const tabbarEl   = document.getElementById('tabbar');
  const tabbarTabs = tabbarEl ? tabbarEl.querySelector('.tabs') : null;
  const tabbarTools = tabbarEl ? tabbarEl.querySelector('#tabtools') : null;
  const encBtn    = document.getElementById('encBtn');
  const cmdinput   = document.getElementById('cmdinput');
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
  function _syncActiveViewStateIntoBuffer(){
    try{
      const b = currentBuffer();
      if (!b) return;
      b.viewRow = caretRow|0; b.viewCol = caretCol|0;
      // snap to line grid for stability
      const st = (editor && typeof editor.scrollTop==='number') ? (editor.scrollTop|0) : 0;
      try{ b.viewScrollTop = Math.round(Math.max(0, st)/LINE_HEIGHT)*LINE_HEIGHT; }catch{ b.viewScrollTop = Math.max(0, st); }
    }catch{}
  }
  function _collectSessionPayload(opts={}){
    // opts.lite: if true, omit text for unmodified file-backed buffers to reduce footprint
  const lite = !!opts.lite;
    try{
      _syncActiveViewStateIntoBuffer();
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
          savedMode: b.savedMode||'NORMAL',
          savedVisual: (b.savedVisual ? { linewise: !!b.savedVisual.linewise, anchorR: b.savedVisual.anchorR|0, anchorC: b.savedVisual.anchorC|0, caretR: b.savedVisual.caretR|0, caretC: b.savedVisual.caretC|0 } : null),
          undo: undoArr
        };
      });
      const payload = {
        version: 1,
        when: Date.now(),
        active: Math.max(0, Math.min((buffers.length?buffers.length-1:0), currentIdx|0)),
        buffers: bufs
      };
      return payload;
    }catch{ return { version:1, when:Date.now(), active:0, buffers:[] }; }
  }
  function _persistClearedSession(){
    try{
      const payload = { version:1, when:Date.now(), active:0, buffers:[] };
      try{ localStorage.setItem(_SESSION_KEY, JSON.stringify(payload)); }catch{}
    }catch{}
  }
  function _persistSessionNow(){
    try{
      const p = _collectSessionPayload({ lite:false });
      try{
        localStorage.setItem(_SESSION_KEY, JSON.stringify(p));
        return true;
      }catch(e){
        // quota fallback: retry with lite payload
        try{ const p2 = _collectSessionPayload({ lite:true }); localStorage.setItem(_SESSION_KEY, JSON.stringify(p2)); return true; }catch{ return false; }
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
      const j = JSON.parse(s);
      if (!j || !Array.isArray(j.buffers)) return false;
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
        _addBuffer({ name, path, text, modified, enc, ff, bom });
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
      if (buffers.length>0){ _switchToBuffer(act); _setTitle(); _renderTabbar(); }
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
  // Initial options may be provided via window.SIX_OPTIONS (from _six.customize)
  let scrolloff = (function(){ try{ const o=(window&&window.SIX_OPTIONS)||{}; const n=parseInt(o.scrolloff,10); if (Number.isFinite(n)) return n|0; }catch{} return 3; })();
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
    const e = (meta&&meta.enc)||'utf-8';
    const ff = (meta&&meta.ff)||'unix';
    const bom = !!(meta&&meta.bom);
    const line1 = e + ' ' + ff;
    const line2 = (e==='utf-8' && bom) ? 'bomb' : '';
    return { line1, line2 };
  }
  function _updateEncBtnLabel(){
    try{
      if (!encBtn) return;
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
      pop.innerHTML = '';
      const inner = document.createElement('div'); inner.className='inner'; pop.appendChild(inner);
      // Do NOT override current selection on re-render; only initialize if invalid
      const cur = _encCurrentMeta();
      if (!Number.isFinite(_encSel)){
        _encSel = _encFindIndex(cur);
      } else {
        // clamp within bounds
        const n = _allowedEncodeSets.length|0;
        _encSel = Math.max(0, Math.min(n>0?n-1:0, _encSel|0));
      }
      _allowedEncodeSets.forEach((meta, i)=>{
        const item = document.createElement('div'); item.className='item'; if (i===_encSel) item.classList.add('active');
        // marker
        const mark = document.createElement('span'); mark.textContent = (i===_encSel)?'●':'○'; mark.style.width='1.2em'; mark.style.textAlign='center'; mark.style.opacity='0.8';
        // name (popupは" bomb"を同一行に付与する)
        const name = document.createElement('div'); name.className='name'; const d=_encDisplayLines(meta); name.textContent = d.line2 ? (d.line1+' '+d.line2) : d.line1; name.style.whiteSpace='pre';
        item.appendChild(mark); item.appendChild(name);
        // Apply immediately on mousedown to maximize reliability across environments
        item.addEventListener('mousedown', (ev)=>{ try{ ev.preventDefault(); ev.stopPropagation(); }catch{}; try{ _encSel = i; }catch{}; try{ _applyEncodeMeta(meta); }catch{} _encPopupHide(); setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} },0); });
        // Hover updates visual selection when not clicking
        item.addEventListener('mouseenter', ()=>{ try{ _encSel=i; _encPopupRender(); }catch{} });
        // Click kept as a safety net (some platforms synthesize click differently)
        item.addEventListener('click', (ev)=>{ try{ ev.preventDefault(); ev.stopPropagation(); }catch{}; try{ _encSel = i; }catch{}; try{ _applyEncodeMeta(meta); }catch{} _encPopupHide(); setTimeout(()=>{ try{ editor && editor.focus && editor.focus(); }catch{} },0); });
        inner.appendChild(item);
      });
    }catch{}
  }
  function _encPopupShow(){
    try{
      const pop = document.getElementById('encpopup'); if (!pop) return;
      pop.style.display = '';
      // Initialize selection to current buffer meta on first show
      try{ _encSel = _encFindIndex(_encCurrentMeta()); }catch{ _encSel = 0; }
      _encPopupRender();
      // position near the button
      if (encBtn){
        const r = encBtn.getBoundingClientRect();
        // temporary visibility to measure
        const vw = (window.innerWidth||0), vh=(window.innerHeight||0);
        const pw = (pop.offsetWidth||240), ph=(pop.offsetHeight||200);
        let left = Math.max(8, Math.min(vw - pw - 8, Math.round(r.right - pw))); // align right edges roughly
        let top  = Math.max(8, Math.min(vh - ph - 8, Math.round(r.bottom + 6)));
        pop.style.left = left + 'px';
        pop.style.top  = top + 'px';
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
      try{ _setTitle && _setTitle(); _renderTabbar && _renderTabbar(); }catch{}
      try{ toast('encode set: ' + ((_encDisplayLines(meta).line2)? (_encDisplayLines(meta).line1+' bomb') : _encDisplayLines(meta).line1), 900); }catch{}
    }catch{}
  }
  // Sticky preview for :s — keep previous match position while pattern grows if it still matches
  let _incPrevEl = null;        // DOM element for incremental preview highlight
  let _incPrevLastStart = null; // last preview start offset
  let _incPrevLastLen = 0;      // last preview length
  let _incPrevStickyOff = null; // number|null
  let _incPrevStickySrc = '';
  function _incPrevHide(){ try{ if (_incPrevEl && _incPrevEl.parentNode){ _incPrevEl.parentNode.removeChild(_incPrevEl); } _incPrevEl=null; }catch{ _incPrevEl=null; } _incPrevLastStart=null; _incPrevLastLen=0; }
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
    let pat = String((mF?mF[1]:(mB?mB[1]:(mS?mS[3]:'')))||'');
      const flagsGiven = String((mF?mF[2]:(mB?mB[2]:''))||'');
      const flags = (/i/.test(flagsGiven)?'i':'');
      // For :s incremental preview: capture a stable anchor once at first pattern detection
      if (mS && !(_incSearchAnchorOff>=0)){
        try{ _incSearchAnchorOff = _offsetFromRC(caretRow, caretCol)|0; }catch{ _incSearchAnchorOff=null; }
      }
      // Do nothing on empty pattern
      if (!pat){ _incPrevHide(); return true; }
      // Try compile regex quickly; invalid → hide
      let reOk = true; try{ new RegExp(pat, flags); }catch{ reOk=false; }
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
            const reStick = new RegExp('^(?:' + pat + ')', flags);
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
          res = _searchFindNext(pat, flags, dir, fromOff, true);
        } else {
          // Manual scan within [selStart, selEnd)
          try{
            const text = String(editor.value||'');
            const sub = text.slice(selStart, selEnd);
            const re = new RegExp(pat, flags);
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
  let _hlLayer = null;               // container for match rectangles
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
      const flags = String(_lastSearch.flags||'');
      const text = String(editor.value||'');
      let re = null; try{ re = new RegExp(src, flags.includes('g')?flags:flags+'g'); }catch{ re=null; }
      if (!re) return;
      const out = [];
      let m; re.lastIndex = 0;
      while ((m = re.exec(text))){
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
  function _updateHlsearchFull(){
    if (!_optHlsearch || !(_lastSearch && _lastSearch.src)){
      _hlClear();
      return;
    }
    _recomputeHlMatches();
    _renderHlMatchesVisible();
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
      const b = currentBuffer();
      const mod = (b && b.modified) ? '*' : '';
      // OS ウインドウタイトルにはパスを出さない（file:/// を隠す）
      document.title = `six-webview2${mod ? ' ' + mod : ''}`;
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
        // pathname は先頭に /share の形なので二重スラッシュを調整
        if (p.startsWith('/')) p = p.substring(1);
        p = '//' + host + '/' + p;
      }catch{}
      // ディレクトリ末尾のスラッシュは維持
      if ((u.pathname||'').endsWith('/') && !p.endsWith('/')) p += '/';
      return p || full;
    }catch{ return full; }
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

  function _splitLines(){ return String(editor.value||'').split(/\n/); }
  function _totalLines(){ return _splitLines().length; }
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

  // ---- Search helpers (for '/', '?' and n/N) ----
  function _searchFindNext(src, flags, dir, fromOff, wrap){
    try{
      const text = String(editor.value||'');
      const n = text.length|0;
      const reFlags = (flags && /i/.test(flags)) ? 'i' : '';
      let startIdx = -1; let matchLen = 0;
      if (dir === 'fwd'){
        const off = Math.max(0, Math.min(n, (fromOff|0)));
        const start = Math.min(n, off + 1); // move past current
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
      // apply persisted scale if any
      try{
        const s = localStorage.getItem('six.edScale');
        const n = s ? parseFloat(s) : NaN;
        if (Number.isFinite(n) && n > 0.3 && n < 5){ _edScale = _nearestScale(n); }
      }catch{}
      try{ root.style.setProperty('--edScale', String(_edScale)); }catch{}
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
    _showZoomHUD();
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
      // Force visible explicitly (initial CSS is display:none)
      el.style.display = 'block';
      if (_zoomHudTimer){ clearTimeout(_zoomHudTimer); _zoomHudTimer=null; }
      _zoomHudTimer = setTimeout(()=>{ try{ el.style.display='none'; }catch{} }, 3000);
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
      const clean = (s)=>{ try{ let t=String(s||''); t=t.replace(/[\u200B-\u200D\u2060\u00A0]/g,''); t=t.replace(/[\u0000-\u001F]/g,''); return t.trim(); }catch{ return String(s||''); } };
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
        savedVisual: null
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
      _switchToBuffer(nextIndex);
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
                return (_fileTypedDirRaw||'') + it.name + '/';
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
          }
          return true;
        }catch{}
      } else {
        _loadFromPath(it.url, null, {mode:'new'});
      }
      try{ const hist=':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + String(it.name||'')); _cmdHistoryMaybePush(hist); }catch{}
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
        if (i===currentIdx){
          const rel = _relativeDisplayPath(b.path);
          label = rel && rel !== b.path ? rel : _prettyFileUrlLabel(b.path);
          if (!label) label = (b.name||'');
        } else {
          // 非アクティブタブは常にファイル名のみ（WSL含む）
          try{ label = _basename(b.path); }catch{ label = (b.name||''); }
        }
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
    // アクティブタブがスクロール領域に見えるように調整
    if (activeEl && typeof activeEl.scrollIntoView === 'function'){
      activeEl.scrollIntoView({block:'nearest', inline:'nearest'});
    }
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

  async function _loadFromPath(path, baseForRelative, opts={}){
    // 例外が途中で発生しても、本文が読み込めているなら確実にバッファを作成/切替するためのフェイルセーフ
    let urlStr = null;
    let txt; let t;
    let loadedIntoEditor = false;
    try {
      const base = baseForRelative || _htmlBaseURL();
      urlStr = _normalizeToURLString(path, base); // Normalize the URL string
      // UNC/WSL (file://host/...) は最初に API /read を優先して試す（fetch/XHR が CORS/権限で失敗しやすいため）
      try {
        const uProbe = new URL(urlStr);
        if (_apiIsEnabled() && uProbe.protocol==='file:' && uProbe.host){
          const fsPath0 = ('\\\\' + uProbe.host + decodeURIComponent(uProbe.pathname).replace(/\//g,'\\'));
          const apiRead0 = _apiBase + 'read?fs=' + encodeURIComponent(fsPath0);
          try{ txt = await _fetchTextWithTimeout(apiRead0, 8000); _apiNoteSuccess(); } catch(e){ _apiNoteFailure(); }
        }
      } catch { /* not UNC/WSL or no API */ }
      // それでも未取得なら通常経路（XHR/fetch）
      if (txt === undefined){
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
      // detect ff + BOM (utf-8 BOM appears as U+FEFF at string start)
      let ff = (txt.indexOf('\r')>=0) ? 'dos' : 'unix';
      const hasBomChar = (txt.length>0 && txt.charCodeAt(0)===0xFEFF);
      t = (hasBomChar ? txt.slice(1) : txt).replace(/\r\n?/g,'\n');
      const mode = opts.mode || (buffers.length===0 ? 'new' : 'replace');
      if (mode === 'new'){
        const exist = _findBufferByURL(urlStr);
        if (exist >= 0){
          // Switch to existing buffer without disturbing current editor state before switch
          _switchToBuffer(exist);
        } else {
          // Create buffer first; _switchToBuffer will load its text and keep previous buffer's view saved correctly
          _addBuffer({ name: _basename(path), path: urlStr, text: t, modified:false, enc:'utf-8', ff, bom: hasBomChar });
          _switchToBuffer(buffers.length-1);
        }
      } else {
        // Replace current buffer content in-place
        const b=currentBuffer();
        if (b){
          b.path = urlStr; b.name = _basename(path); b.text = t; b.savedText = t; b._changeTick=0; b._savedTick=0; b.modified=false; try{ b._undo=[]; b._redo=[]; }catch{}
          try{ b.enc='utf-8'; b.ff=ff; b.bom=hasBomChar; }catch{}
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
      console.error('open failed', e);
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
    // Align overlays (stripe/caret) with the text by canceling the remainder via translateY
    let rem = 0;
    try{
      const st = (editor.scrollTop||0);
      rem = st - Math.round(st/LINE_HEIGHT)*LINE_HEIGHT;
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
    _measureSpan.textContent = line.slice(0, Math.max(0, caretCol));
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
      _measureSpan.textContent = line.slice(0, caretCol+1);
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
    // Auto horizontal scroll to keep caret visible in NORMAL/VISUAL
    try{
      if (_mode === 'NORMAL' || _mode === 'VISUAL'){
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
    try{ caretLayer.style.transform = (Math.abs(rem) > 0.01) ? `translateY(${-rem}px)` : ''; }catch{}
    // Detect caret movement (row/col change) and hide mouse cursor accordingly
    try{
      const moved = (caretRow !== _lastCaretRow) || (caretCol !== _lastCaretCol);
      if (moved){
        // Skip initial bootstrap comparison to avoid hiding once at startup
        if (!(_lastCaretRow === -1 && _lastCaretCol === -1)){
          _hideCursor();
        }
        _lastCaretMovedAt = Date.now();
        _lastCaretRow = caretRow; _lastCaretCol = caretCol;
        // If scrolloff is paused due to a just-confirmed search, resume it
        // when the user moves the caret away from the confirm anchor.
        if (_scrolloffPaused){
          if (caretRow !== _scrolloffPauseAnchorR || caretCol !== _scrolloffPauseAnchorC){
            _scrolloffPaused = false;
            _scrolloffPauseAnchorR = -1; _scrolloffPauseAnchorC = -1;
          }
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
      const lines = _splitLines();
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
      const lines = _splitLines();
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
  function _makeSnapshot(){
    const b=currentBuffer();
    return { text: String(editor.value||''), caretRow, caretCol, scrollTop: (editor.scrollTop||0), changeTick: (b? (b._changeTick|0) : 0), enc: (b? b.enc : 'utf-8'), ff: (b? b.ff : 'unix'), bom: (b? !!b.bom : false) };
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
    try{ editor.scrollTop = Math.max(0, s.scrollTop|0); }catch{}
    // restore change tick from snapshot and recompute modified
    try{ const b=currentBuffer(); if (b){ b._changeTick = (s.changeTick|0); } }catch{}
    _syncModifiedFromTick();
    ensureScrolloff(); _repositionCaret(); updateGutter();
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
  function _deleteRangePos(p1,p2){
    // record undo before mutation
    _pushUndoSnapshot('delete-range');
    const lines=_splitLines();
    let a=_clampPos(p1), b=_clampPos(p2);
    if (_cmpPos(a,b)>0){ const t=a; a=b; b=t; }
    if (a.r===b.r && a.c===b.c) return; // nothing
    // Capture deleted text for paste (charwise)
    let deletedText = '';
    if (a.r===b.r){
      const r=a.r; const s=lines[r]||'';
      deletedText = s.slice(a.c, b.c);
    } else {
      const head=(lines[a.r]||'').slice(a.c);
      const middle = (b.r - a.r > 1) ? (lines.slice(a.r+1, b.r).join('\n') + '\n') : '';
      const tail=(lines[b.r]||'').slice(0,b.c);
      deletedText = head + '\n' + middle + tail;
    }
    if (a.r===b.r){
      const r=a.r; const s=lines[r]||'';
      const next = (s.slice(0,a.c) + s.slice(b.c));
      lines[r]=next;
    } else {
      const head=(lines[a.r]||'').slice(0,a.c);
      const tail=(lines[b.r]||'').slice(b.c);
      // remove inner lines and join
      const newLine = head + tail;
      lines.splice(a.r, (b.r - a.r + 1), newLine);
    }
    editor.value = lines.join('\n');
    // set caret at start of deletion
    _setCaret(a.r, a.c);
    // Update unnamed register (charwise)
    try{ _regUnnamed = { text: String(deletedText||''), linewise: false }; }catch{}
    _touchBufferModified();
  }
  function _deleteWholeLines(rStart, count){
    _pushUndoSnapshot('delete-lines');
    const lines=_splitLines();
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
    if (nextLines.length===0) nextLines.push('');
    const newRow = Math.max(0, Math.min(nextLines.length-1, rs));
    editor.value = nextLines.join('\n');
    _setCaret(newRow, 0);
    try{ _regUnnamed = { text: String(deletedBlock||''), linewise: true }; }catch{}
    _touchBufferModified();
  }
  function _insertTextAt(r,c,text){
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
      editor.value = lines.join('\n');
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
      editor.value = newLines.join('\n');
      const newR = rr + parts.length - 1;
      const newC = (parts[parts.length-1]||'').length;
      return { r: newR, c: newC };
    }
  }
  function _pasteCharwise(after, count){
    const n = Math.max(1, count|0);
    const clip = _regUnnamed && !_regUnnamed.linewise ? String(_regUnnamed.text||'') : '';
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
    const clip = _regUnnamed && _regUnnamed.linewise ? String(_regUnnamed.text||'') : '';
    if (!clip) return;
    _pushUndoSnapshot('paste');
    const lines = _splitLines();
    const insertAt = Math.max(0, Math.min(lines.length, (below ? (caretRow+1) : caretRow)));
    const block = clip.split('\n');
    const toInsert = [];
    for (let i=0;i<n;i++) toInsert.push(...block);
    const newLines = lines.slice(0, insertAt).concat(toInsert).concat(lines.slice(insertAt));
    editor.value = newLines.join('\n');
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
    const moveLines=(delta)=>{ rr=Math.max(0, Math.min(last, rr+delta)); const len=(lines[rr]||'').length; cc=Math.max(0, Math.min(len, cc)); };
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
    const start={ r: caretRow, c: caretCol };
    const end=_advancePosByCp(start.r, start.c, n);
    if (start.r===end.r && start.c===end.c){ return; }
    _deleteRangePos(start, end);
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
    try{ _regUnnamed = { text: String(yanked||''), linewise: false }; }catch{}
  }
  function _yankWholeLines(rStart, count){
    const lines=_splitLines();
    const total=lines.length;
    if (total===0) return;
    let rs=Math.max(0, Math.min(total-1, rStart|0));
    let n=Math.max(1, count|0);
    const rEnd = Math.min(total-1, rs + n - 1);
    const yankedBlock = lines.slice(rs, rEnd+1).join('\n');
    try{ _regUnnamed = { text: String(yankedBlock||''), linewise: true }; }catch{}
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
    const _readEofPadLines = ()=>{
      try{
        const r = getComputedStyle(document.documentElement).getPropertyValue('--eofPadLines');
        const n = parseInt(String(r||'').trim(), 10);
        return (Number.isFinite(n) && n>=0) ? n : 1;
      }catch{ return 1; }
    };
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
      const snapped = atEOFJump ? (Math.floor(stCur/LINE_HEIGHT)*LINE_HEIGHT)
                                : (Math.round(stCur/LINE_HEIGHT)*LINE_HEIGHT);
      if (Math.abs(snapped - stCur) > 0.1){ editor.scrollTop = snapped; }
      // EOFジャンプ強化: rAF で再度 floor スナップを試行し、微小ズレを完全排除
      if (atEOFJump && window.requestAnimationFrame){
        requestAnimationFrame(()=>{
          try{
            const st1 = (editor.scrollTop||0);
            const floor1 = Math.floor(st1/LINE_HEIGHT)*LINE_HEIGHT;
            if (Math.abs(floor1 - st1) > 0.1){ editor.scrollTop = floor1; }
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
      const rem = st - Math.round(st/LINE_HEIGHT)*LINE_HEIGHT;
      const first = gutter.firstElementChild;
      if (first){ first.style.marginTop = Math.abs(rem) > 0.01 ? (-rem)+'px' : '0px'; }
    }catch{}
  }

  /*********************************************************
   * Movement
   *********************************************************/
  function _moveCaretLines(delta){
    const lines = _splitLines();
    caretRow = Math.max(0, Math.min(lines.length-1, caretRow + delta));
    const line = lines[caretRow] || '';
    caretCol = Math.max(0, Math.min(line.length, caretCol));
    // Prefer no scroll on first motion after switch if caret is visible; otherwise force ensure
    _ensureAfterMotion();
  }
  function _moveCaretCols(delta){
    const line = (_splitLines()[caretRow] || '');
    caretCol = Math.max(0, Math.min(line.length, caretCol + delta));
  }
  // ---- Motion helpers ----
  function _lineLen(r){ const lines=_splitLines(); return (r>=0 && r<lines.length) ? (lines[r]||'').length : 0; }
  function _firstNonBlankColOf(line){ const m = String(line||'').match(/^\s*/); return m ? (m[0]||'').length : 0; }
  function _setCaret(r,c){ const lines=_splitLines(); r=Math.max(0, Math.min(lines.length-1, r|0)); const len=(lines[r]||'').length; caretRow=r; caretCol=Math.max(0, Math.min(len, c|0)); }
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
      if (r >= lines.length) return { r: lines.length-1, c: _lineLen(lines.length-1) };
      const line = lines[r] || '';
      const n = line.length;
      if (c > n) c = n;
      if (c >= n){ r++; c = 0; continue; }
      // skip spaces first
      let t = _wordTypeAtInLine(line, c);
      if (t === _WT_SPACE){
        while (c < n && _wordTypeAtInLine(line, c) === _WT_SPACE){ c = _nextIndex(line, c); }
        if (c < n) return { r, c };
        r++; c = 0; continue;
      }
      // in a non-space run: leave current run
      const tRun = t;
      while (c < n && _wordTypeAtInLine(line, c) === tRun){ c = _nextIndex(line, c); }
      // then skip spaces to next start
      while (c < n && _wordTypeAtInLine(line, c) === _WT_SPACE){ c = _nextIndex(line, c); }
      if (c < n) return { r, c };
      r++; c = 0;
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
      if (c > 0){
        // step left one code point first
        c = _prevIndex(line, c);
        // skip spaces/newlines to the left
        while (c >= 0 && _wordTypeAtInLine(line, c) === _WT_SPACE){
          // If at the first code point and it's space, advance to previous line trigger
          if (c === 0){ c = -1; break; }
          c = _prevIndex(line, c);
        }
        if (c < 0){ r--; c = (r>=0 ? (lines[r]||'').length : 0); continue; }
        const tRun = _wordTypeAtInLine(line, c);
        // go to start of this run
        while (c > 0){
          const prev = _prevIndex(line, c);
          if (prev < 0) break;
          if (_wordTypeAtInLine(line, prev) !== tRun) break;
          c = prev;
        }
        return { r, c };
      } else {
        r--; c = (r>=0 ? (lines[r]||'').length : 0);
      }
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
        if (!pat && _lastSearch){ pat = _lastSearch.src; }
        if (pat){
          const dir = forward? 'fwd':'bwd';
          const flags = (flagsGiven || (_lastSearch && _lastSearch.src===pat ? _lastSearch.flags : ''));
          // Use the stable anchor captured when entering the search prompt so
          // confirmation jumps to the nearest match from the original caret.
          const fromOff = (function(){
            try{
              if (typeof _incSearchAnchorOff === 'number' && _incSearchAnchorOff >= 0){ return (_incSearchAnchorOff|0); }
              return _offsetFromRC(caretRow, caretCol)|0;
            }catch{ return 0; }
          })();
          const res = _searchFindNext(pat, flags, dir, fromOff, true);
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
              _lastSearch = { src: pat, flags: flags||'', dir, origDir: dir };
              _updateHlsearchFull();
            }catch{}
          } else {
            toast('no match');
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
  // Validate flags: allow only lowercase g, i, c, n (uppercase should be invalid)
  const invalid = flagsGiven.replace(/[gicn]/g, '');
    if (invalid){ toast('invalid flags: ' + invalid); return; }
        if (!pat){ toast('empty pattern'); return; }
        let reFlags = '';
        if (/i/.test(flagsGiven)) reFlags += 'i';
        // We'll use a global regex for scan; per-line non-g behavior is handled manually
        let reAll = null; try{ reAll = new RegExp(pat, reFlags+'g'); }catch{ reAll=null; }
        if (!reAll){ toast('invalid pattern'); return; }
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
          if (!reMid){ toast('invalid pattern'); try{ _exitVisual(); }catch{} return; }
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
          if (!reLine){ toast('invalid pattern'); return; }
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
      // CMD 経由の場合は、閉じた後に CMD 突入前のモードへ復帰させる
      const restoreMode = (_mode === 'CMD') ? _preCmdMode : _mode;
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
              if (q) toast('No such buffer: ' + q);
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
                const textData = editor.value||'';
                const ok = await _saveToURL(b.path, textData);
                if (!ok){ toast('write failed: ' + (b.name||'')); return; }
                try{ b.text = textData; b.savedText = textData; b._savedTick = (b._changeTick|0); b.modified = false; }catch{}
              } else {
                // No path -> prompt for a save path (Save As)
                const base = _currentDirBase();
                const suggest = (b && b.name && b.name!=='(untitled)') ? b.name : '';
                const input = await inputModal({ title:'Save As', detail:'Enter a file path (relative or absolute)', initialValue: suggest, okText:'Save', cancelText:'Cancel' });
                if (!input){ toast('write cancelled', 1500); return; }
                let targetUrl = null;
                try{ targetUrl = _normalizeToURLString(input, base); }catch{}
                if (!targetUrl){ toast('invalid path', 1500); return; }
                const ok = await _saveToURL(targetUrl, editor.value||'');
                if (!ok){ toast('write failed', 1500); return; }
                try{ b.path = targetUrl; b.name = _basename(targetUrl); const textData = editor.value||''; b.text = textData; b.savedText = textData; b._savedTick = (b._changeTick|0); b.modified=false; }catch{}
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
      if (!Number.isNaN(n)) window.six.setScrolloff(n);
      return;
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
    // :wqa[!] [path?] — write all & quit (use previous :wq behavior)
    const wqam = cmd.match(/^:(wqa!?)(?:\s*(.*))?$/i);
    if (wqam){
      const bang = /!$/.test(wqam[1]||'');
      const arg = (wqam[2]||'').trim();
      const b = currentBuffer();
      if (!b){ toast('no buffer'); _setMode('NORMAL'); return; }
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
        const ok = await _saveToURL(targetUrl, editor.value||'');
        if (ok){
          try{
            const was = b.path||null;
            if (was !== targetUrl){ b.path = targetUrl; b.name = _basename(targetUrl); }
            b.text = editor.value||''; b.savedText = editor.value||''; b._savedTick = (b._changeTick|0); b.modified = false;
          }catch{}
          _setTitle(); _renderTabbar();
          toast('written: ' + _prettyFileUrlLabel(targetUrl));
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
      if (!b){ toast('no buffer'); _setMode('NORMAL'); return; }
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
        const ok = await _saveToURL(targetUrl, editor.value||'');
        if (ok){
          try{
            const was = b.path||null;
            if (was !== targetUrl){ b.path = targetUrl; b.name = _basename(targetUrl); }
            b.text = editor.value||''; b.savedText = editor.value||''; b._savedTick = (b._changeTick|0); b.modified = false;
          }catch{}
          _setTitle(); _renderTabbar();
          toast('written: ' + _prettyFileUrlLabel(targetUrl));
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
          const ok = await _saveToURL(b.path, textData);
          if (ok){ try{ b.text=textData; b.modified=false; }catch{} toast('written: ' + _prettyFileUrlLabel(b.path)); } else { toast('write failed: ' + (b.name||'')); }
        }
        _setTitle(); _renderTabbar();
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
      if (!b){ toast('no buffer'); _setMode('NORMAL'); return; }
      // Capture viewport and selection to stabilize after save
      let _w_st = 0, _w_sl = 0, _w_cr = caretRow|0, _w_cc = caretCol|0, _w_sS = 0, _w_sE = 0;
      try{ _w_st = editor.scrollTop|0; _w_sl = editor.scrollLeft|0; _w_sS = editor.selectionStart|0; _w_sE = editor.selectionEnd|0; }catch{}
      const _w_restore = ()=>{
        try{
          _scrollGuardUntil = Date.now() + 1200;
          // Restore selection first to avoid auto-scroll, then set scrolls
          try{ editor.setSelectionRange(_w_sS, _w_sE); }catch{}
          caretRow = _w_cr; caretCol = _w_cc;
          try{ editor.scrollTop = _w_st; }catch{}
          try{ editor.scrollLeft = _w_sl; }catch{}
          _repositionCaret(); updateGutter(); _renderHlMatchesVisible();
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
        const ok = await _saveToURL(targetUrl, editor.value||'');
        if (ok){
          try{
            const was = b.path||null;
            if (was !== targetUrl){ b.path = targetUrl; b.name = _basename(targetUrl); }
            b.text = editor.value||''; b.savedText = editor.value||''; b._savedTick = (b._changeTick|0); b.modified = false;
          }catch{}
          _setTitle(); _renderTabbar();
          toast('written: ' + _prettyFileUrlLabel(targetUrl));
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
    if (modestatus) modestatus.textContent = '['+_mode+']';
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
      // Allow IME in INSERT (best-effort; browsers may ignore)
      try{ if (editor){ editor.removeAttribute('inputmode'); editor.style.imeMode = ''; } }catch{}
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
  // Caret color remains baseline (IME visualization removed)
    } else {
      // In NON-INSERT modes, hint IME OFF (cannot force at OS level)
      try{
        if (editor){
          editor.setAttribute('inputmode', 'none');
          editor.style.imeMode = 'disabled';
          // Heuristic: brief blur→focus to nudge some IME implementations to exit composition when leaving INSERT
          // (Safe because we immediately resync caret; guarded to avoid infinite loops)
          const prev = document.activeElement;
          if (prev === editor){
            editor.blur();
            setTimeout(()=>{ try{ editor.focus(); _syncNativeSelectionToCaret(); }catch{} }, 0);
          }
        }
      }catch{}
  // IME visual reset removed (no longer tracking IME state)
    }
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
          if (e.key==='Escape'){ e.preventDefault(); onCancel(); }
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
          if (e.key==='Escape'){ e.preventDefault(); finishCancel(); }
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
          if (e.key==='Escape'){ e.preventDefault(); cleanup(); resolve(null); }
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
          { id:'visual', label:'VISUAL' }
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
              '検索ハイライト hlsearch = off'
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
            // 表示
            section('表示', [
              [K(':set scrolloff=N'), sep(' スクロールオフ（上下の余白行数）'), K('set so=N'), sep('でも同じ')]
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
              [K('^'), sep('  空白文字に続く行頭へ')],
              [K('$'), sep('  行末へ')],
              [K('w'), sep(' / '), K('b'), sep('  単語の先頭へ進む/戻る')],
              [K('W'), sep(' / '), K('B'), sep('  WORD（空白区切りの大きな語）単位で進む/戻る')],
              [K('Nw'), sep(' / '), K('Nb'), sep(' / '), K('NW'), sep(' / '), K('NB'), sep('  N回分まとめて移動（例: '), K('3w'), sep('）')],
              [K('{'), sep('  段落/空行区切りの前へ')],
              [K('}'), sep('  段落/空行区切りの次へ')]
            ]));

            // オペレータ
            wrap.appendChild(mkSec('オペレータ'));
            wrap.appendChild(mkList([
              [K('x'), sep('  caret直下の1文字削除')],
              [K('dd'), sep(' 行削除')],
              [K('d モーション'), sep(' 削除 ※範囲はモーションによる')], 
              [K('Nd モーション'), sep('  カウント付き（例: '), K('2dw'), sep('）')],
              [K('yy'), sep(' 行ヤンク(行コピー) ')],
              [K('y モーション'), sep(' ヤンク(コピー) ※範囲はモーションによる ')],
              [K('Y'), sep(' Windowsクリップボードへコピー（y のモーション/カウントと同等、unnamed レジスタは変えない。例: '), K('YY'), sep(' / '), K('3Yw'), sep('）')],
              [K('p'), sep('  caret行の下に行ペースト')],
              [K('P'), sep('  caret行の上に行ペースト')]
            ]));

            // 検索
            wrap.appendChild(mkSec('検索'));
            wrap.appendChild(mkList([
              [K('/'), sep(' EOF方向にインクリメンタル検索（確定で最後の検索状態を更新）')],
              [K('?'), sep(' ファイル先頭方向にインクリメンタル検索（確定で最後の検索状態を更新）')],
              [K('n'), sep(' 最後の検索語を検索方向に沿って検索('), K('/'), sep('による検索ならEOF方向、'), K('?'), sep('による検索ならファイル先頭方向)')],
              [K('N'), sep(' 最後の検索語を検索方向の逆方向に検索('), K('/'), sep('による検索ならファイル先頭方向、'), K('?'), sep('による検索ならEOF方向)')]
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
            wrap.appendChild(mkP('文字入力とUndoスナップショットの扱い。'));
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
            p2.appendChild(document.createTextNode('  選択範囲をWindowsクリップボードへコピーします（行選択/文字選択とも対応）。コピー後に「Copied to Windows clipboard.」トーストを表示します。unnamed レジスタは変更しません。'));
            wrap.appendChild(p2);
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
                } else {
                  _setMode('NORMAL');
                }
                editor && editor.focus && editor.focus();
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
          // Prevent leaking to editor
          try{ e.stopPropagation(); }catch{}
          if (e.key==='Escape'){ e.preventDefault(); cleanup(); return; }
          // hidden shortcuts: q/Q/F9 to close
          if (e.key==='q' || e.key==='Q' || e.key==='F9'){ e.preventDefault(); cleanup(); return; }
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
          if (e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); finish('q'); }
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
              if (id==='save' && b.path){ const textData = (i===currentIdx)?(editor.value||''):(b.text||''); const ok = await _saveToURL(b.path, textData); if (!ok){ toast('write failed: ' + (b.name||'')); resolve(false); return; } try{ b.text=textData; b.modified=false; }catch{} }
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
            if (b.path){ const textData = (i===currentIdx)?(editor.value||''):(b.text||''); const ok = await _saveToURL(b.path, textData); if (!ok){ toast('write failed: ' + (b.name||'')); btnSave.disabled=false; btnSkip.disabled=false; return; } try{ b.text=textData; b.savedText=textData; b._savedTick = (b._changeTick|0); b.modified=false; }catch{} }
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
              const textData = (i===currentIdx)?(editor.value||''):(b.text||'');
              const ok = await _saveToURL(b.path, textData);
              if (!ok){ toast('write failed: ' + (b.name||'')); btnAll.disabled=false; btnCancel.disabled=false; return; }
              try{ b.text=textData; b.savedText=textData; b._savedTick = (b._changeTick|0); b.modified=false; }catch{}
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
          if (e.key==='Escape'){ e.preventDefault(); finish(false); }
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
  window.addEventListener('focus', ()=>{ try{ _hideCursor(); _repositionCaret(); updateGutter(); }catch{} });
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
    // Scroll snapping is handled in the unified RAF above
    editor.addEventListener('beforeinput', (e)=>{
      if (_mode !== 'INSERT'){
        // NORMAL/CMD ではテキスト変更を禁止
        e.preventDefault();
      }
    });
    editor.addEventListener('input', ()=>{
      if (_mode === 'INSERT'){
        // centralize modified tracking (bump change tick on each input)
        _touchBufferModified();
        // sync overlay caret to native insertion point
        try{ const off = editor.selectionStart|0; const rc = _rcFromOffset(off); caretRow = rc.r; caretCol = rc.c; }catch{}
        // _touchBufferModified already hides cursor; redundant call removed
      }
      _exactLineLockAdjust(); _repositionCaret(); updateGutter(); _updateHlsearchFull();
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
        let off = editor.selectionStart|0;
        if (_visualActive){
          const s = editor.selectionStart|0;
          const e = editor.selectionEnd|0;
          const a = _offsetFromRC(_visualAnchorR, _visualAnchorC)|0;
          // Choose the endpoint farther from the anchor as the caret position
          const ds = Math.abs(s - a);
          const de = Math.abs(e - a);
          off = (de >= ds) ? e : s;
        }
        const rc = _rcFromOffset(off);
        caretRow = rc.r; caretCol = rc.c;
      }catch{}
      _repositionCaret(); updateGutter();
    });
    editor.addEventListener('keyup', (e)=>{ if(e.key==='Enter') ensureScrolloff(); _repositionCaret(); updateGutter(); });
    editor.addEventListener('click', ()=>{ _repositionCaret(); updateGutter(); });
    // IME composition events — detect full-width ALNUM mode and reflect on caret color
  // IME composition listeners removed (#426)
    editor.addEventListener('compositionupdate', (e)=>{
      try{
        if (_mode !== 'INSERT') return;
        const s = String(e && e.data || '');
        let fw = false;
        for (let i=0; i<s.length; i++){
          const cp = s.codePointAt(i);
          if (cp>0xFFFF) i++; // skip surrogate pair extra unit
          if (_isFullwidthAlnumCp(cp|0)){ fw = true; break; }
        }
  // IME fullwidth heuristic removed
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
      if (_mode === 'CMD') return;
      if (_mode === 'INSERT'){
        if (e.key==='Escape'){
          e.preventDefault();
          // on leaving INSERT, capture native caret back to overlay state
          try{ const off = editor.selectionStart|0; const rc = _rcFromOffset(off); caretRow = rc.r; caretCol = rc.c; }catch{}
          _setMode('NORMAL');
          return;
        }
        // Allow native editing behavior, but keep overlays in sync when moving the caret
        if (e.key==='ArrowLeft' || e.key==='ArrowRight' || e.key==='ArrowUp' || e.key==='ArrowDown' ||
            e.key==='Home' || e.key==='End' || e.key==='PageUp' || e.key==='PageDown'){
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
            // フォーカスを cmdinput に移した後でも、ネイティブ選択を再適用して
            // 選択ハイライトが残るようにする（環境によっては blur で消える対策）
            const stHold = (function(){ try{ return editor.scrollTop|0; }catch{ return 0; } })();
            Promise.resolve().then(()=>{
              try{ cmdinput.focus(); const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); }catch{}
              // フォーカス後に縦横位置を復元しつつ、選択オーバーレイを維持
              try{
                const flo=Math.floor(stHold/LINE_HEIGHT)*LINE_HEIGHT;
                if (Math.abs((editor.scrollTop||0) - flo) > 0.1){ editor.scrollTop = flo; }
                _repositionCaret(); updateGutter();
                if (editor && (editor.scrollLeft|0) !== _holdLeftVis){ editor.scrollLeft = _holdLeftVis; }
              }catch{}
              try{ _updateVisualSelection(); }catch{}
              try{ _renderVisSelOverlay(); }catch{}
            });
          }
          return;
        }
        if (e.key==='Escape'){ e.preventDefault(); _exitVisual(); _repositionCaret(); updateGutter(); return; }
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
          (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
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
        // Motions extend selection
  const moveAndUpdate=(fn)=>{ fn(); _ensureAfterMotion(); _repositionCaret(); updateGutter(); _updateVisualSelection(); };
        if (e.key==='j' || e.key==='ArrowDown'){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveCaretLines(n)); return; }
        if (e.key==='k' || e.key==='ArrowUp'){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveCaretLines(-n)); return; }
        if (e.key==='h' || e.key==='ArrowLeft'){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveCaretCols(-n)); return; }
        if (e.key==='l' || e.key==='ArrowRight'){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveCaretCols(n)); return; }
        if (e.key==='w' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveWordW(n)); return; }
        if (e.key==='b' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveWordB(n)); return; }
  if (e.key==='W' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveWORDW(n)); return; }
  if (e.key==='B' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); moveAndUpdate(()=>_moveWORDB(n)); return; }
        if (e.key==='^'){ e.preventDefault(); const _n=_consumeCount(); const line=(_splitLines()[caretRow]||''); _setCaret(caretRow, _firstNonBlankColOf(line)); _repositionCaret(); _updateVisualSelection(); return; }
        if (e.key==='0' && _countAcc==null){ e.preventDefault(); _setCaret(caretRow, 0); _repositionCaret(); _updateVisualSelection(); return; }
        if (e.key==='$'){ e.preventDefault(); const n=_consumeCount(); let r=caretRow; if (n>1){ _moveCaretLines(n-1); r=caretRow; } const len=_lineLen(r); _setCaret(r, len); _repositionCaret(); updateGutter(); _updateVisualSelection(); return; }
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
        if (e.key==='Escape'){ e.preventDefault(); _clearPendingOp(); _countAcc=null; return; }
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
        if (e.key==='Escape'){ e.preventDefault(); _clearPendingOp(); _countAcc=null; return; }
        if (e.key==='Shift' || e.key==='Control' || e.key==='Alt' || e.key==='Meta'){
          return;
        }
        e.preventDefault();
        // YY (copy N lines)
        if (e.key==='Y'){
          const mcount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const total = Math.max(1, (_pendingOpCount||1) * mcount);
          const text = _extractWholeLinesText(caretRow, total);
          (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
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
            (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
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
          (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
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
          (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
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
            (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
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
            (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
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
            const start = { r: caretRow, c: caretCol };
            const end   = target;
            const text  = _extractRangeText(start, end);
            (async ()=>{ const ok = await _copyToClipboard(text); toast(ok? 'Copied to Windows clipboard.':'Clipboard write failed.', ok? 1000:1500); })();
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
        if (e.key==='Escape'){ e.preventDefault(); _clearPendingOp(); _countAcc=null; return; }
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
        if (e.key==='Escape'){ e.preventDefault(); _clearPendingOp(); _countAcc=null; return; }
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
        // cw/cW special-case (Vim: cw behaves like ce; cW like cE for WORD)
        if (e.key==='w' || e.key==='W'){
          // cw behaves like ce, and with count N it changes up to the end of the Nth word
          const motionCount = (_countAcc==null?1:_countAcc); _countAcc=null;
          const totalWords = Math.max(1, (_pendingOpCount||1) * motionCount);
          const line = (_splitLines()[caretRow]||'');
          const n = line.length;
          let i = caretCol;
          let j = i;
          const isSpaceAt = (idx)=>{ const t=_wordTypeAtInLine(line, idx); return t===_WT_SPACE; };
          let consumed = 0;
          // Advance j to end of the totalWords-th word run; include inter-word spaces but not trailing space after last word
          while (consumed < totalWords && j < n){
            // Skip any leading spaces to the next word
            while (j < n && isSpaceAt(j)) j = _nextIndex(line, j);
            if (j >= n) break;
            if (e.key==='W'){
              // WORD: consume any non-space run entirely
              while (j < n && !isSpaceAt(j)){ j = _nextIndex(line, j); }
            } else {
              // word: consume one run of the same type (alnum/kana/han/symbol)
              const tRun = _wordTypeAtInLine(line, j);
              while (j < n && _wordTypeAtInLine(line, j) === tRun){ j = _nextIndex(line, j); }
            }
            consumed++;
          }
          // Delete from original caret (i) to j; do NOT include trailing spaces after the last word
          const start={ r: caretRow, c: i };
          const end  ={ r: caretRow, c: j };
          if (!(start.r===end.r && start.c===end.c)){
            _deleteRangePos(start, end);
            _clearPendingOp(); ensureScrolloff(); _repositionCaret(); updateGutter();
            _suppressInsertSnapshotOnce = true; _setMode('INSERT');
            return;
          }
          _clearPendingOp(); return;
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
        e.preventDefault(); _preCmdMode = _mode; _setMode('CMD'); _clearPending();
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
          cmdinput.value = '/';
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
        e.preventDefault(); _preCmdMode = _mode; _setMode('CMD'); _clearPending();
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
          cmdinput.value = '?';
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
  if (e.key==='j' || e.key==='ArrowDown'){ e.preventDefault(); const n=_consumeCount(); _moveCaretLines(n); try{ _flagCaretMotion(); }catch{} _repositionCaret(); updateGutter(); return; }
  if (e.key==='k' || e.key==='ArrowUp'){ e.preventDefault(); const n=_consumeCount(); _moveCaretLines(-n); try{ _flagCaretMotion(); }catch{} _repositionCaret(); updateGutter(); return; }
  if (e.key==='h' || e.key==='ArrowLeft'){ e.preventDefault(); const n=_consumeCount(); _moveCaretCols(-n); try{ _flagCaretMotion(); }catch{} _repositionCaret(); return; }
  if (e.key==='l' || e.key==='ArrowRight'){ e.preventDefault(); const n=_consumeCount(); _moveCaretCols(n); try{ _flagCaretMotion(); }catch{} _repositionCaret(); return; }
  // delete: x (delete char(s) under cursor / join newline)
  if (e.key==='x' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); const n=_consumeCount(); _doDeleteX(n); ensureScrolloff(); _repositionCaret(); updateGutter(); return; }
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
      // line anchors ^, 0, $
  if (e.key==='^'){ e.preventDefault(); const _n=_consumeCount(); const line=(_splitLines()[caretRow]||''); _setCaret(caretRow, _firstNonBlankColOf(line)); try{ _flagCaretMotion(); }catch{} _repositionCaret(); return; }
      // '0' as a command only when no count prefix in progress
  if (e.key==='0' && _countAcc==null){ e.preventDefault(); _setCaret(caretRow, 0); try{ _flagCaretMotion(); }catch{} _repositionCaret(); return; }
  if (e.key==='$'){ e.preventDefault(); const n=_consumeCount(); let r=caretRow; if (n>1){ _moveCaretLines(n-1); r=caretRow; } const len=_lineLen(r); _setCaret(r, len); try{ _flagCaretMotion(); }catch{} _repositionCaret(); updateGutter(); return; }
      // paragraphs { }
  if (e.key==='}'){ e.preventDefault(); const n=_consumeCount(); _moveParagraphNext(n); try{ _flagCaretMotion(); }catch{} _ensureAfterMotion(); _repositionCaret(); updateGutter(); return; }
  if (e.key==='{'){ e.preventDefault(); const n=_consumeCount(); _moveParagraphPrev(n); try{ _flagCaretMotion(); }catch{} _ensureAfterMotion(); _repositionCaret(); updateGutter(); return; }
      // numeric prefix (1-9 start/extend; 0 extends if already started)
      if (e.key>='1' && e.key<='9' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _countAcc = (_countAcc==null?0:_countAcc)*10 + parseInt(e.key,10); return; }
      if (e.key==='0' && !e.ctrlKey && !e.metaKey && !e.altKey && _countAcc!=null){ e.preventDefault(); _countAcc = _countAcc*10; return; }
  if (e.key==='i'){ e.preventDefault(); _setMode('INSERT'); return; }
  if (e.key==='v' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _enterVisual(false); return; }
  if (e.key==='V' && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); _enterVisual(true); return; }
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
        const lines = _splitLines();
        const rr = Math.max(0, Math.min(lines.length-1, caretRow));
        const newLines = lines.slice(0, rr+1).concat(['']).concat(lines.slice(rr+1));
        editor.value = newLines.join('\n');
        _setCaret(rr+1, 0); _touchBufferModified(); ensureScrolloff(); _repositionCaret(); updateGutter(); _setMode('INSERT'); return;
      }
      if (e.key==='O' && !e.ctrlKey && !e.metaKey && !e.altKey){
        e.preventDefault();
  _pushUndoSnapshot('open-above');
  _suppressInsertSnapshotOnce = true;
        const lines = _splitLines();
        const rr = Math.max(0, Math.min(lines.length-1, caretRow));
        const newLines = lines.slice(0, rr).concat(['']).concat(lines.slice(rr));
        editor.value = newLines.join('\n');
        _setCaret(rr, 0); _touchBufferModified(); ensureScrolloff(); _repositionCaret(); updateGutter(); _setMode('INSERT'); return;
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
          const fromOff = (function(){ try{ return _offsetFromRC(caretRow, caretCol)|0; }catch{ return 0; } })();
          const res = _searchFindNext(_lastSearch.src, _lastSearch.flags||'', dir, fromOff, true);
          if (res && Number.isFinite(res.start)){
            try{
              const rc = _rcFromOffset(res.start);
              caretRow = rc.r; caretCol = rc.c;
              ensureScrolloff();
              _repositionCaret(); updateGutter(); _renderHlMatchesVisible();
              _lastSearch.dir = dir; // record last movement direction (origDir remains stable)
            }catch{}
          } else { toast('no match'); }
        } else {
          toast('no last search');
        }
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
            // Let function keys fall through so tab/help shortcuts work (F1–F9)
            if (['F1','F2','F3','F4','F5','F6','F7','F8','F9'].includes(e.key)) return;
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
              if (!endsWithSlash){
                const q = filt.trim();
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
                    // 仕様 #349: 親へ移動した時点で入力欄を "<parent>/<prevSeg>" に正規化し、一覧完了時の反映は継続抑止
                    try{
                      if (cmdinput){
                        cmdinput.value = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + String(prevSeg||''));
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
                    // ドリルダウン（補完専用）
                    _fileJustNavAt = Date.now(); _fileReflectGuardUntil = Date.now() + 700; _fileNavRetryCount = 0; _fileFilter = ''; _fileSelMuted = false;
                    _fileTypedDirRaw = (_fileTypedDirRaw||'') + q + '/';
                    if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw); try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {} }
                    return;
                  }
                  if (ent && !ent.isDir){
                    // ファイルを開く（確定）
                    _loadFromPath(ent.url, null, {mode:'new'});
                    // 履歴には補完後の最終文字列を入れる
                    try{ const hist = ':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + String(ent.name||'')); _cmdHistoryMaybePush(hist); }catch{}
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
                      _fileJustNavAt = Date.now(); _fileReflectGuardUntil = Date.now() + 700; _fileNavRetryCount = 0; _fileFilter = ''; _fileSelMuted = false;
                      _fileTypedDirRaw = (_fileTypedDirRaw||'') + String(one.name||'') + '/';
                      if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw); try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {} }
                      return true;
                    } else {
                      _loadFromPath(one.url, null, {mode:'new'});
                      try{ const hist=':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + String(one.name||'')); _cmdHistoryMaybePush(hist); }catch{}
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
                    // 即座にローディングへ切り替え
                    _fileEntries = []; _fileSel = 0; _fileLoading = true; if (_filePopupVisible()) _filePopupRender();
                  }
                  _fileNavPendingKey = null;
                  if (cmdinput){ try { cmdinput.dispatchEvent(new Event('input', { bubbles:true })); } catch {} }
                  return; // ポップアップ維持
                }catch{}
              } else {
                _loadFromPath(it.url, null, {mode:'new'});
              }
            }
            _filePopupHide();
            _bufPopupHide();
            try{ const hist=':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + String(it.name||'')); _cmdHistoryMaybePush(hist); }catch{}
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
            toast('invalid command');
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
        } else if (e.key==='Escape'){
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
                // 直ちに :e 空ベースのポップアップを開く
                _fileBaseURL = _currentDirBase();
                _fileStartBaseURL = _ensureSlash(_fileBaseURL);
                _fileNextStartBaseURL = null;
                try{ const b=_ensureSlash(_fileBaseURL); _filePopupNoUp = !!(b && (_isHostRoot(b) || _isUncShareRoot(b))); }catch{ _filePopupNoUp=false; }
                _fileJustNavAt = Date.now(); _fileNavRetryCount = 0;
                // 起動直後は Enter を無効化（Tab は可）
                _fileReflectGuardUntil = Date.now() + 700;
                _fileTypedDirRaw = '';
                _fileFilter = '';
                _fileInvalid = false;
                _fileLoading = true;
                _fileEntries = []; _fileSel = 0;
                _fileReflectedOnOpen = false;
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
      const num = document.createElement('span'); num.className='num';
      try{
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
  function _bufPopupShow(){ if (!bufpopup) return; try{ if (typeof _encPopupHide==='function') _encPopupHide(); }catch{} bufpopup.dataset.kind='buf'; bufpopup.style.display=''; if (!(_bufSel>=0)) _bufSel=Math.max(0,Math.min(buffers.length-1,currentIdx)); _bufPopupRender(); }
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
  // ディレクトリ移動直後のみ、ポップアップ選択→入力欄への反映を抑止し、Enterも無効化するための猶予ガード
  // Tab 補完は引き続き有効。タイムスタンプで短時間のみ適用する。
  let _fileReflectGuardUntil = 0;

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
  // 保存時はバッファの encodeSet に従って改行/BOM/エンコーディングを適用
  const b = currentBuffer();
  const enc = (b&&b.enc)||'utf-8';
  const ff = (b&&b.ff)||'unix';
  const bom = !!(b&&b.bom);
  let out = String(textUtf8||'');
  if (ff === 'dos'){ out = out.replace(/\n/g, '\r\n'); }
  let payloadBytes = null;
  if (enc === 'utf-8'){
    let s = out; if (bom){ s = '\uFEFF' + s; }
    payloadBytes = new TextEncoder().encode(s);
  } else if (enc === 'shift_jis'){
    try{
      payloadBytes = _encodeShiftJIS(out);
      if (!(payloadBytes instanceof Uint8Array)) throw new Error('sjis encode failed');
    }catch{
      // Fallback without BOM (avoid mislabel as UTF-8 BOM)
      toast('Shift_JIS エンコード未対応のため UTF-8 で保存します', 1800);
      payloadBytes = new TextEncoder().encode(out);
    }
  } else {
    payloadBytes = new TextEncoder().encode(out);
  }
  // Safety: if encoding yielded zero bytes but we have non-empty content, fall back to UTF-8
  try{ if ((payloadBytes && payloadBytes.byteLength===0) && out && out.length>0){ payloadBytes = new TextEncoder().encode(out); } }catch{}
      let fsPath = _fsPathFromFileURL(u);
      if (!fsPath){ toast('invalid target path'); return false; }
      const apiUrl = _apiBase + 'write?fs=' + encodeURIComponent(fsPath);
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
            const hint = isNet ? ' (connection unavailable; retrying...)' : '';
            toast('write: network error' + hint, 1200);
            await new Promise(r=>setTimeout(r, 1200));
            continue;
          }
          break;
        }
      }
      // 最終失敗
      toast('write failed: connection');
      try{ _apiNoteFailure(); }catch{}
      return false;
    }catch(e){ toast('write failed'); return false; }
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
          const arrx = jx.entries.map(e=>({ name: e.name, isDir: !!e.isDir, url: String(e.url||'') }));
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
                    return { name: n, isDir: d, url };
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
            const arr = j.entries.map(e=>{
              const n = e.name; const d = !!e.isDir; const url = makeEntryUrl(u, n, d, e.url);
              return { name: n, isDir: d, url };
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
                    return { name: n, isDir: d, url };
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
              const timeout3 = isUnc ? 6000 : 2000;
              try{ j2 = await _fetchJSONWithTimeout(apiFs, timeout3); try{ _apiNoteSuccess(); }catch{} }catch(e3){ if (_apiIsEnabled()){ try{ _apiNoteFailure(); }catch{} } throw e3; }
              if (j2 && Array.isArray(j2.entries)){
                const arr2 = j2.entries.map(e=>{
                  const n = e.name; const d = !!e.isDir; const url = makeEntryUrl(u, n, d, e.url);
                  return { name: n, isDir: d, url };
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
          // name は a.textContent 優先、無ければURLパス末尾
          let nm = (a.textContent||'').trim();
          if (!nm){ const parts = resolved.pathname.split('/').filter(Boolean); nm = decodeURIComponent(parts[parts.length-1]||''); }
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
    // 入力文字ではフィルタせず、一覧は常に全件（'..' を必要に応じて含む）
    const list = [];
    // '..' は通常先頭に表示するが、ホスト直下/UNC共有ルートでは抑止
    try{
      // ローディング中や現在のエントリが空のときは、".." を強制表示しない
      if (_fileLoading || !(_fileEntries && _fileEntries.length)){
        // 下の for で _fileEntries をそのまま返す（空ならここで空配列のまま）
      } else {
      const baseNow = _ensureSlash(_fileBaseURL);
      const suppressUp = (!!_filePopupNoUp) || (baseNow && (_isHostRoot(baseNow) || _isUncShareRoot(baseNow)));
      if (!suppressUp){
        const parent = _ensureSlash(new URL('../', _fileBaseURL));
        if (parent){ list.push({ name: '..', isDir: true, url: parent.toString(), _up: true }); }
      }
      }
    }catch{}
    for (const e of _fileEntries){ list.push(e); }
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

  function _filePopupRender(){
    if (!bufpopup || !bufpopupInner) return;
    // Re-entrancy guard to prevent overlapping renders causing visual glitches
    if (window.__sixFileRendering) return; window.__sixFileRendering = true;
    bufpopup.dataset.kind = 'file';
    bufpopupInner.innerHTML = '';
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
        // '..' 抑止状況を再評価（インデックス算出は list 側で '..' を含む前提）
        let suppressUp = false;
        try{ const baseNow = _ensureSlash(_fileBaseURL); suppressUp = (!!_filePopupNoUp) || (baseNow && (_isHostRoot(baseNow) || _isUncShareRoot(baseNow))); }catch{}
  const idx2 = list.findIndex(e=> e && !e._up && e.isDir && e.name === _filePostSelectName);
        if (idx2>=0){
          _fileSel = idx2; _fileSelMuted = false; // list には '..' が含まれているため、そのままのインデックスでよい
          _filePostSelectName = null; // 適用できたときだけクリア
        }
        // 見つからない場合は保持を継続（ディレイ列挙完了後に適用）
      }
    }catch{}
    // 入力欄の文字はフィルタではなくインクリメンタルサーチとして扱い、選択のみ移動（反映は上下キーで）
    try{
      const qRawOrig = String(_fileFilter||'');
      const qTrim = qRawOrig.replace(/\/+$/,'');
      if (qTrim){
        // Special-case: when filtering with "..", treat it as the parent selector and don't mute
        if (qTrim === '..'){
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
            // 自動選択は input 直後のみ有効。矢印ナビ後は維持。
            if (_fileSelAuto){ _fileSel = idxMatch; }
            _fileSelMuted = false;
          } else {
            _fileSelMuted = true;
          }
        }
        // #345: '.' 入力時は '../' を優先的に選択する
        if (qTrim === '.'){
          try{
            const idxUp = list.findIndex(e=> e && e._up);
            if (idxUp >= 0){ _fileSel = idxUp; _fileSelMuted = false; }
          }catch{}
        }
      } else {
        _fileSelMuted = false;
      }
    }catch{}
  _fileSel = Math.max(0, Math.min(list.length-1, _fileSel));
    for (let i=0;i<list.length;i++){
      const it = list[i];
  const div = document.createElement('div');
      div.className = 'item'+((i===_fileSel && !_fileSelMuted)?' active':'');
      if (i===_fileSel && _fileSelMuted){
        div.className += ' muted';
      }
      // 数字は付けない（配置合わせのため空の num を置く）
      const num = document.createElement('span'); num.className='num'; num.textContent='';
      const name = document.createElement('span'); name.className='name'; name.textContent = it.name + (it.isDir? '/':'');
      div.appendChild(num); div.appendChild(name);
      // クリックでフォーカスを奪わない
      div.addEventListener('mousedown', (ev)=>{ ev.preventDefault(); });
      div.addEventListener('click', ()=>{
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
            const nextBase = _ensureSlash(new URL(it.url, _fileBaseURL));
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
              if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw + prevSeg); }
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
              const isAtRootDoubleSlash = /^\s*:?\s*e\s+\/\/$/i.test((cmdinput && cmdinput.value)||'') || (_fileTypedDirRaw==='//');
              if (isAtRootDoubleSlash){
                _fileTypedDirRaw = '//' + it.name + '/';
              } else {
                _fileTypedDirRaw = (_fileTypedDirRaw||'') + it.name + '/';
              }
              if (cmdinput){ cmdinput.value=':e ' + _collapseDotDotPath(_fileTypedDirRaw); }
              // 基点も進める
              _fileBaseURL = nextBase;
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
                        try{
                          const suppressUp = (!!_filePopupNoUp) || (baseNow && (_isHostRoot(baseNow) || _isUncShareRoot(baseNow)));
                          _fileSel = (suppressUp?0:1);
                        }catch{}
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
          _loadFromPath(it.url, null, {mode:'new'});
          // Enter と同等に、入力欄をクリアし NORMAL に戻す
          try{ const hist=':e ' + _collapseDotDotPath(String(_fileTypedDirRaw||'') + String(it.name||'')); _cmdHistoryMaybePush(hist); }catch{}
          try{ if (cmdinput) cmdinput.value=''; }catch{}
          _filePopupHide(); _bufPopupHide(); _setMode('NORMAL'); setTimeout(()=>editor.focus(),0);
        }
      });
      bufpopupInner.appendChild(div);
    }
  // アクティブ（またはミュート）項目が見切れていれば可視範囲にスクロール
  try{ const act = bufpopupInner.querySelector('.item.active, .item.muted'); if (act && act.scrollIntoView) act.scrollIntoView({block:'nearest', inline:'nearest'}); }catch{}
  window.__sixFileRendering = false;
  }
  function _filePopupShow(){ if (!bufpopup) return; try{ if (typeof _encPopupHide==='function') _encPopupHide(); }catch{} bufpopup.dataset.kind='file'; bufpopup.style.display=''; _filePopupRender(); }
  function _filePopupHide(){ if (!bufpopup) return; if (_filePopupVisible()){ bufpopup.style.display='none'; _fileLoading=false; try{ _fileReflectedOnOpen=false; }catch{} try{ window.__sixFileRendering=false; }catch{} } }
  // 旧: 一覧の単純移動は廃止（反映ロジック付きの新実装は下）
  // ↑↓で選択を動かしたときは、即座に入力欄へ反映（末尾 '/' なし、".." は例外で反映しない）
  function _filePopupMove(d){
    if (!bufpopup) return;
    const list = _filePopupComputeList();
    _fileSelAuto = false; // ユーザ操作により自動選択を停止
    _fileSel = Math.max(0, Math.min(list.length-1, _fileSel + d));
    _fileSelMuted = false; // 矢印移動で通常のハイライトに復帰
    try{
      const it = list[_fileSel];
      if (cmdinput && it){
        // ディレクトリ移動直後の短期は、選択反映をスキップ
        const guardActive = (Date.now() < (_fileReflectGuardUntil||0));
        if (!guardActive){
        if (!it._up){
          const val = ':e ' + _collapseDotDotPath((_fileTypedDirRaw||'') + String(it.name||''));
          cmdinput.value = val;
        } else {
          // 親("..")上にカーソルがあるときは正規化せず ".." をそのまま可視化
          const val = ':e ' + String(_fileTypedDirRaw||'') + '..';
          cmdinput.value = val;
        }
        try{ const pos=(cmdinput.value||'').length; cmdinput.setSelectionRange(pos,pos); }catch{}
        }
      }
    }catch{}
    _filePopupRender();
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
  }

  function _currentDirBase(){
    // Prefer the directory of the current buffer when available
    try{
      const cur = currentBuffer();
      if (cur && cur.path){ return _dirnameURL(cur.path); }
    }catch{}
    // If a next-start base was preserved (e.g., after Esc cancel), prefer it
    try{
      if (_fileNextStartBaseURL){ const u = _ensureSlash(_fileNextStartBaseURL); if (u) return u; }
    }catch{}
    // Fall back to the most recently visible base of :e popup (what the user last saw)
    try{
      if (_fileVisibleBaseKey){
        const u = _ensureSlash(_fileVisibleBaseKey);
        if (u) return u;
      }
    }catch{}
    // Then fall back to the last stable listed base (what we last successfully loaded)
    try{
      if (_fileStableBaseKey){
        const u = _ensureSlash(_fileStableBaseKey);
        if (u) return u;
      }
    }catch{}
    // As an additional fallback, use any other buffer that has a path
    try{
      const any = (buffers||[]).find(b=> b && b.path);
      if (any && any.path){ return _dirnameURL(any.path); }
    }catch{}
    // Finally, default to the app HTML base directory
    return _htmlBaseURL();
  }

  // :e 入力文字列の解析 → {baseURL, typedDirRaw, filter}
  function _eParseInput(vRaw){
    // 先頭のコロンは1つのみ許容（"::e" は不正とみなす）
    const m = vRaw.match(/^:?\s*e\s*(.*)$/i);
    const rest = (m? m[1] : '').trimStart();
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
    const arr=[]; for(let i=1;i<=400;i++) arr.push(String(i).padStart(4,' ')+'  The quick brown fox jumps over the lazy dog.');
    const t = arr.join('\n');
    editor.value = t;
    if (buffers.length===0){ _addBuffer({ name: null, path: null, text: t, modified:false }); }
  }

  /*********************************************************
   * Bootstrap
   *********************************************************/
  // Overlay palette (bottom-right buttons over editor)
  function _initOverlayPalette(){
    try{
      const viewport = document.getElementById('editorViewport');
      if (!viewport) return;
      // Create root once
      let pal = document.getElementById('overlayPalette');
      if (!pal){
        pal = document.createElement('div');
        pal.id = 'overlayPalette';
        pal.style.position = 'absolute';
        // Move 0.5rem further up/left from previous 8px
        pal.style.right = '1rem';
        pal.style.bottom = '1rem';
        pal.style.zIndex = '3'; // above caret layer (2)
        pal.style.pointerEvents = 'auto';
        pal.style.display = 'flex';
        // Narrow down gap between buttons ~half
        pal.style.gap = '4px';
        pal.style.alignItems = 'flex-end';
    // Fill background; adjust transparency to 0.06 per request (#431)
  pal.style.background = 'rgba(0,15,0,0.06)';
        pal.style.border = 'none';
        pal.style.borderRadius = '0';
        pal.style.padding = '4px';
        viewport.appendChild(pal);
      }
      pal.innerHTML = '';
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

      // Create buttons first (but append to a 2x2 grid later)
      // 検索ハイライトトグルボタン（左下配置）
      const hlBtn = document.createElement('button');
      hlBtn.type = 'button';
      hlBtn.id = 'overlayBtnHlsearch';
      hlBtn.style.minWidth = '112px';
      hlBtn.style.border = '1px solid #2a3244';
      hlBtn.style.background = '#1a2030';
      hlBtn.style.color = '#e6e6e6';
      hlBtn.style.borderRadius = '6px';
      hlBtn.style.padding = '6px 8px';
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
        s.style.borderRadius = '999px';
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

      // Help button（右下配置, 2行ラベル: ヘルプ / F9,:help）
      const helpBtn = document.createElement('button');
      helpBtn.type = 'button';
      helpBtn.textContent = 'ヘルプ\nF9,:help';
      helpBtn.style.whiteSpace = 'pre';
      helpBtn.style.minWidth = '64px';
      helpBtn.style.border = '1px solid #2a3244';
      helpBtn.style.background = '#1a2030';
      helpBtn.style.color = '#e6e6e6';
      helpBtn.style.borderRadius = '6px';
      helpBtn.style.padding = '6px 8px';
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

      // 即時終了ボタン（左上は空欄、右上に配置。ラベル後半は 'F10'）
      const quitBtn = document.createElement('button');
      quitBtn.type = 'button';
      quitBtn.textContent = '即時終了\nF10';
      quitBtn.style.whiteSpace = 'pre';
      quitBtn.style.minWidth = '80px';
      quitBtn.style.border = '1px solid #2a3244';
      quitBtn.style.background = '#1a2030';
      quitBtn.style.color = '#e6e6e6';
      quitBtn.style.borderRadius = '6px';
      quitBtn.style.padding = '6px 8px';
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

      // Build 2x2 grid (top-left empty)
      const grid = document.createElement('div');
      grid.style.display = 'grid';
      grid.style.gridTemplateColumns = 'auto auto';
      grid.style.columnGap = '4px';
      grid.style.rowGap = '4px';
      const empty = document.createElement('div');
      empty.style.minWidth = '80px';
      empty.style.minHeight = '42px';
      grid.appendChild(empty);      // top-left (empty)
      grid.appendChild(quitBtn);    // top-right
      grid.appendChild(hlBtn);      // bottom-left
      grid.appendChild(helpBtn);    // bottom-right

      pal.appendChild(grid);

      // initialize visual state for hlsearch pills
      try{ _updateOverlayHlsearchVisual(); }catch{}

      
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
          const fileOpen = (typeof _filePopupVisible==='function' && _filePopupVisible());
          const bufOpen  = (typeof _bufPopupVisible==='function' && _bufPopupVisible());

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
              try{ if (fileOpen) _filePopupHide(); }catch{}
              try{ if (bufOpen) _bufPopupHide(); }catch{}
              helpModal({ defaultTab: 'cmd' });
            } else {
              // Do not consume; allow Help's onKey handler to see F9 and close
            }
            return;
          }
          // (Plain F5 is handled by the generic F1–F8 tab switching below; do not swallow here)

          // :b popup visible → F1–F8 or digits 1–8 = direct selection (absolute index)
          if (bufOpen && (/^F[1-8]$/.test(key) || /^[1-8]$/.test(key))){
            try{ e.preventDefault(); e.stopPropagation(); }catch{}
            const n = /^F/.test(key) ? parseInt(key.slice(1), 10) : parseInt(key, 10);
            const targetIdx = n - 1;
            if (targetIdx >= 0 && targetIdx < buffers.length){
              // Fully emulate 'Esc → F{n}': exit CMD/popups with guarded viewport restore (light), then switch next tick
              let st0 = 0; try{ st0 = (editor && typeof editor.scrollTop==='number') ? (editor.scrollTop|0) : 0; }catch{}
              try{ _cmdExitAndRestoreView({ forImmediateSwitch:true }); }catch{}
              setTimeout(()=>{ try{ if (targetIdx !== currentIdx){ _switchToBuffer(targetIdx); } else { _keepViewportNoop(st0); } }catch{} }, 0);
            }
            return;
          }

          // When any modal or non-buf popup is open, just consume (except F10 handled above)
          if (isModalOpen || encOpen || fileOpen) return;

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
  // Ensure initial IME hint/visuals match current mode (typically NORMAL)
  try{ _setMode(_mode); }catch{}
        // Wire encoding button and popup interactions
        try{
          if (encBtn){
            encBtn.style.whiteSpace = 'pre';
            encBtn.addEventListener('mousedown', (e)=>{ e.preventDefault(); });
            encBtn.addEventListener('click', (e)=>{ try{ e.preventDefault(); e.stopPropagation(); }catch{}; if (_encPopupVisible()){ _encPopupHide(); } else { _encPopupShow(); }});
          }
          // Close on outside click
          document.addEventListener('mousedown', (e)=>{
            try{
              const pop = document.getElementById('encpopup');
              if (!pop || pop.style.display==='none') return;
              const withinPopup = pop.contains(e.target);
              const withinBtn = encBtn && encBtn.contains && encBtn.contains(e.target);
              if (!withinPopup && !withinBtn){ _encPopupHide(); }
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
          // Ensure Esc closes :e file popup even when focus is not in cmdinput
          window.addEventListener('keydown', (e)=>{
            try{
              if (!_filePopupVisible || !_filePopupVisible()) return;
              if (e.key==='Escape'){
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
    setScrolloff:(n)=>{ scrolloff = n; ensureScrolloff(); _repositionCaret(); updateGutter(); }
  };
})();
