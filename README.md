# six-webview2 (skeleton)

This is a minimal scaffold to prototype the six editor UI in a modern WebView (Edge/Chromium). It mirrors the HTA layout with:

- `_six.html` – Shell HTML (tabbar, editorViewport with gutter + textarea, caret overlay, cmdbar)
- `_six.css` – Minimal layout and theme-friendly CSS variables
- `_six.js` – Tiny bootstrap implementing gutter, scroll, and an active-line band with j/k navigation and scrolloff=2
- `_six-theme.js` – Theme object matching the HTA THEME API shape
- `six.ps1` – Convenience launcher using Edge app mode as a stand-in for a native WebView2 host

## Quick start (Windows)

1. Open PowerShell in this folder
2. Run: `./six.ps1`
3. The app window opens. Click into the editor area, then use `j` / `k` to move the caret. Gutter scrolls with the text.

Note: This uses Edge in app mode, not a compiled WebView2 host. Replace with your native host later.

## Notes

- Line-height and gutter width are parameterized via CSS variables (`--lh`, `--gw`).
- The viewport height is clamped to whole lines using padding adjustment to avoid reflow.
- EOF gutter area is filled using `THEME.eofGutterFillColor`.
- The code intentionally stays minimal and independent from HTA-specific APIs.

## Next steps

- Port command layer and more accurate ensureScrolloff logic
- Implement caret overlay drawing and selection
- Add file loading and persistence hooks
- Migrate from Edge app mode to native WebView2 host
移植元: HTA版six (https://github.com/x-maru/six.git)

移植ガイド: migration-prompt-webview2.md

