// Minimal bootstrap to mimic six behavior (scroll, gutter, caret band)
(function(){
  const lh = 20; // px line-height
  const gutterW = 56; // px
  const editor = document.getElementById('editor');
  const viewport = document.getElementById('editorViewport');
  const gutter = document.getElementById('gutter');
  const caretLayer = document.getElementById('caretLayer');
  const edstripe = document.getElementById('edstripe');

  // Apply theme to CSS custom properties
  function applyTheme(){
    const root = document.documentElement;
    root.style.setProperty('--bodyBGColor', THEME.bodyBGColor || '#0b0d12');
  }

  // Seed editor content to demonstrate scrolling
  function seed(){
    const lines = [];
    for(let i=1;i<=400;i++) lines.push(String(i).padStart(4,' ') + '  The quick brown fox jumps over the lazy dog.');
    editor.value = lines.join('\n');
  }

  function visibleLines(){
    return Math.floor(viewport.clientHeight / lh);
  }

  function currentTopLine(){
    return Math.floor(editor.scrollTop / lh) + 1;
  }

  function clampViewportToWholeLines(){
    const h = viewport.clientHeight;
    const lines = Math.max(1, Math.floor(h / lh));
    const target = lines * lh;
    if (target !== h) {
      // Adjust using padding-bottom on viewport to avoid page reflow
      viewport.style.paddingBottom = (h - target) + 'px';
    }
  }

  function updateGutter(){
    const totalLines = editor.value.split('\n').length;
    const topLine = currentTopLine();
    const vis = visibleLines();
    const lines = [];
    const end = Math.min(totalLines, topLine + vis);
    for(let n=topLine;n<=end;n++){
      lines.push('<div style="height:'+lh+'px">'+n+'</div>');
    }
    const shown = end - topLine + 1;
    if (shown < vis) {
      const remain = vis - shown;
      for(let i=0;i<remain;i++){
        lines.push('<div style="height:'+lh+'px;background:'+THEME.eofGutterFillColor+'"></div>');
      }
    }
    gutter.innerHTML = lines.join('');
  }

  function updateStripe(){
    const topLine = currentTopLine();
    const row = caretRow + 1; // 1-based
    const topPx = Math.max(0, (row - topLine) * lh);
    if (topPx >= 0 && topPx < viewport.clientHeight) {
      edstripe.style.display = '';
      edstripe.style.top = topPx + 'px';
    } else {
      edstripe.style.display = 'none';
    }
  }

  let caretRow = 0, caretCol = 0;
  function moveCaret(dy){
    const lines = editor.value.split('\n');
    caretRow = Math.max(0, Math.min(lines.length-1, caretRow + dy));
    const line = lines[caretRow] || '';
    caretCol = Math.max(0, Math.min(line.length, caretCol));
    // scrolloff=2 simple behavior
    const so = 2;
    const topLine = currentTopLine();
    const vis = visibleLines();
    if (caretRow+1 < topLine + so) {
      editor.scrollTop = Math.max(0, (caretRow+1 - so - 1) * lh);
    } else if (caretRow+1 > topLine + vis - so - 1) {
      editor.scrollTop = Math.max(0, (caretRow+1 - (vis - so - 1) - 1) * lh);
    }
    updateGutter();
    updateStripe();
  }

  editor.addEventListener('scroll', () => { updateGutter(); updateStripe(); });
  window.addEventListener('resize', () => { clampViewportToWholeLines(); updateGutter(); updateStripe(); });

  // Keyboard: j/k move
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'j') { e.preventDefault(); moveCaret(1); }
    if (e.key === 'k') { e.preventDefault(); moveCaret(-1); }
  });

  // Focus and seed
  applyTheme();
  seed();
  clampViewportToWholeLines();
  updateGutter();
  updateStripe();
  editor.focus();
})();
