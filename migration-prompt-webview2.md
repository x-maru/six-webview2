# six 移植用プロンプト（PowerShell + WebView2 にそのまま渡してOK）

このドキュメントは、HTA/IE11 ベースのエディタ「six」を PowerShell + WebView2（Windows）へ移植するための実装指示です。ここに書かれた仕様と受け入れ条件を満たす形で、最小の依存と安定した挙動を重視して実装してください。

## ゴールと非ゴール

- ゴール
  - six の現在の動作（スクロール、scrolloff、ガター、キャレット、HSB 初期表示、テーマ）を WebView2 上で再現。
  - UI は HTML/CSS/JS、ホストは PowerShell（.NET 経由で WebView2 コントロールをホスト）。
  - 既存 HTA の構成/関数名に近い形で移植し、将来の差分検証が容易な形にする。
- 非ゴール
  - 高度な refactor、機能追加、テーマ刷新は本フェーズでは行わない。

## 成果物（受け渡し物）

- PowerShell スクリプト: `app.ps1`
  - WebView2（WinForms または WPF ホスト）を起動し、同梱の `index.html` を表示。
- フロントエンド: `index.html`, `styles.css`, `app.js`, `theme.js`
  - 可能な限り既存の `_six.html`, `_six.css`, `_six.run-command.js`, `_six.overlay.js` に対応。
- オプション（簡易テスト用）: `spec-migration.md`（チェックリストと既知の注意点）

## 技術スタックとホスティング

- WebView2 ホストは以下のどちらでも可（選択理由を README に記載）
  - WPF + WebView2（推奨）
  - WinForms + WebView2
- PowerShell 7.x 推奨（5.x でも動作可能であれば可）。
- WebView2 ランタイム必須（クライアント環境にインストールされている前提）。

## フォルダ構成（例）

```
/ (プロジェクトルート)
  app.ps1               # WebView2 ホスト（PowerShell）
  index.html            # メインビュー
  styles.css            # スタイル（エディタ・ガター・オーバーレイ等）
  app.js                # メインロジック（ensureScrolloff, updateGutter など）
  theme.js              # THEME 定義（bodyBGColor 等）
  README.md             # 実行方法、要件
```

## 初期化フロー（必須）

1. ホスト（PowerShell）で WebView2 を起動し、`index.html` をロード。
2. `index.html` 側で DOM 要素を構築（エディタ、ガター、ストライプ等）。
3. `theme.js` で THEME を定義し、起動時に body 背景などへ適用。
4. `app.js` 初期化: 初期高速描画 → ビューポート行数クランプ（HSB 予約込み） → ラインロック開始。
5. イベント束縛（scroll/input/keyup/click）でガター/キャレット/リスト等の同期を開始。

## DOM 構成（対応関係）

- `#editorViewport`（スクロールコンテナ）
  - `#gutter`（行番号領域）
  - `#edstripe`（オーバーレイ用ストライプ: アクティブ行、カーソル、その他）
  - `#editor`（実体: textarea。行高固定）
- 上部 UI
  - `#tabbar`（タブ表示）
  - `#cmdbar`（コマンド表示/入力）

必要に応じて HTA 時代の id 名を踏襲。スクロールは `#editorViewport` に集約。

## CSS の要点

- 行高基準（line-height）は整数行を前提。丸め誤差を吸収するための閾値: 0.985。
- HSB（水平スクロールバー）確保のための予約高さ: `HSCROLL_RESERVE ≈ 18px`。
- body 背景の余白は最小限（約 2px 以内）に抑え、下端の白帯が広がらないよう調整。

## THEME（必須キー）

- bodyBGColor
- gradientLineStart/End, activeLineGradient*
- gutterGradient*, gutterActive*
- eofFillColor, eofGutterFillColor
- lineBaseFill
- caretGradient*, caretPadRem, caretShrinkRem

`theme.js` で定義し、`app.js` で参照して適用。

## コアロジック移植（関数ごとの要件）

以下は既存 HTA 実装の動作を忠実に再現するための仕様です。

### ensureScrolloff

- 目的: キャレット位置に対して上下の可視マージン（scrolloff 行）を常に確保する。
- 仕様:
  - 方向別評価: `k`（上移動）は上側マージンのみ、`j`（下移動）は下側マージンのみをチェック。
  - 中央寄せ: `scrolloff >= (visibleLines/2)` または `_centerScrolloffOnce` が明示された場合のみ発火。
  - EOF 近傍: 最終行が下端に張り付かないよう最小下余白を確保（1 行未満でもよい）。
  - 丸め: 可視行計算・位置計算は閾値 0.985 を用いた一貫した丸めを行う。
  - フォールバック: 差分が僅少（浮動小数の端数）で位置が更新されない場合に、微小スクロールをトリガー。
  - visibleH: 理想行数と物理解像（実測）の最小値を用いる（ラインロック下では物理優先）。
  - 大 scrolloff: `99999` など大きな値ではキャレットを中央付近に固定。`:N/gg/G` を含む各モーションでも一貫性を保つ。

### updateGutter

- 目的: 可視範囲の行番号と背景の描画、アクティブ行強調、EOF ガター塗り。
- 仕様:
  - 可視範囲の行のみを描画（仮想化）。
  - アクティブ行のスタイル適用。
  - EOF 以降のガター下部は `THEME.eofGutterFillColor` で塗りつぶし。
  - 部分表示（端数行）でも行番号は表示し、塗りが乱れないこと。
  - 丸めは ensureScrolloff と同じ閾値で統一。

### _repositionCaret（キャレット位置）

- 目的: キャレットオーバーレイをテキストとガターに同期させる。
- 仕様:
  - `scrollTop` は切り捨て（整数）にして使用。ガター丸めと一致させ、1 行ズレを防ぐ。
  - キャレットの縦位置は行境界にスナップ。グラデーションやパディングは THEME に従う。

### clampViewportExactLines（整数行のビューポート）

- 目的: ビューポート高さを整数行にクランプし、ピクセルブレを防ぐ。
- 仕様:
  - HSB が必要な場合のみ `HSCROLL_RESERVE`（約 18px）を高さから引いて予約。
  - 初期描画段で予約を入れ、起動直後から HSB が隠れないようにする。

### _initLineLock / _exactLineLockAdjust

- 目的: 固定行数（ラインロック）での描画安定化。
- 仕様:
  - ラインロック時も HSB 予約を含む高さでコンテンツが HSB を覆わないこと。

### runCommand（:N など）

- 仕様:
  - 数値ジャンプ `:N` 後のスクロール調整は `ensureScrolloff` を 1 回だけ呼ぶ（ダブルスクロール禁止）。

### イベント束縛（同期）

- `scroll/input/keyup/click` → `_repositionCaret()` → `updateGutter()` の順で同期。
- 必要に応じてリスト/プレビューオーバーレイの再描画も同タイミングで更新。

## 初期描画順序（重要・厳守）

1. `initialQuickViewportPaint`
2. `clampViewportExactLines`（HSB 予約を条件付きで適用）
3. `_initLineLock`（予約を保持したまま）
4. 以後の再計算でビューポート行数が「+1 行」増えないようガード（後述の既知事項参照）

## 既知の注意点（再現/解消のいずれか）

- 最終段リフローで行数が 1 増えて HSB を覆う現象があった。移植では以下のどちらかで対処：
  - a) その再計算経路を特定して上限キャップ（増やさない）
  - b) 予約分を失わないよう高さ調整を順序固定
- EOF 端数行のガター描画は `eofGutterFillColor` を保ちつつ行番号を表示。
- 稀にキャレットの赤グラデが出ないケースがある。丸めと z-index を点検。

## 受け入れ条件（必須テスト）

- scrolloff=2: 起動 → `:99` → `k` 連打で表示範囲が下降しない（上側マージンが保たれる）。
- scrolloff=99999: `gg` → `:200` で中央化し、その後 `j/k` で中央付近に留まり張り付かない。
- EOF 近傍: 最終行が下端に被らず全行が見える。ガター下部は `eofGutterFillColor` で塗られる。
- 起動直後から HSB が可視（手動リサイズ不要）。
- `:N` 後のスクロール調整が 1 回で終わる（バウンスしない）。
- スクロール/入力/キー/クリックでキャレットとガターが常に同期。

## テストチェックリスト（抜粋）

- 可視行数・丸め: 0.985 閾値での端数境界時、1 行のズレが出ない。
- フォント変更/ウィンドウサイズ変更時に HSB が覆われない。
- 長文（数千行）でのスクロール性能（ガター仮想化で 60FPS 近傍）。
- 大きな行幅（水平スクロール必要）での HSB 予約が正しく働く。

## 実装ヒント

- ガターは可視行のみ DOM を持つ仮想リストにする（先頭行インデックスと高さオフセットで算出）。
- `scrollTop` の取り扱いは常に切り捨てで統一し、ガターとキャレットの丸めロジックと揃える。
- HSB の有無は `scrollWidth > clientWidth` などで検出し、`clampViewportExactLines` 時にのみ予約を適用。

## PowerShell ホスト（例：WPF + WebView2）

> 以下は概念例です。実装ではプロジェクトに合わせて DLL 参照や初期化を調整してください。

```powershell
# app.ps1（概念例）
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
# WebView2 .NET 参照を用意（プロジェクトに同梱 or 事前配置）

$Xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="six" Width="900" Height="700">
  <Grid Name="Root" />
</Window>
"@

[xml]$xml = $Xaml
$reader = (New-Object System.Xml.XmlNodeReader $xml)
$window = [Windows.Markup.XamlReader]::Load($reader)
$grid   = $window.FindName('Root')

# TODO: WebView2 コントロールを生成し、Source を index.html に設定
# ex. $webview.Source = (Resolve-Path './index.html').Path
# JS との通信用にポストメッセージやホストオブジェクトを準備

$window.ShowDialog() | Out-Null
```

## index.html（骨子）

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>six</title>
  <link rel="stylesheet" href="styles.css" />
  <script defer src="theme.js"></script>
  <script defer src="app.js"></script>
</head>
<body>
  <div id="tabbar"></div>
  <div id="cmdbar"></div>
  <div id="editorViewport">
    <div id="gutter"></div>
    <div id="edstripe"></div>
    <textarea id="editor" spellcheck="false"></textarea>
  </div>
</body>
</html>
```

## styles.css（骨子）

```css
html, body { height: 100%; margin: 0; background: var(--body-bg, #111); }
#editorViewport { position: relative; height: 100%; overflow: auto; }
#gutter { position: absolute; left: 0; top: 0; bottom: 0; width: 48px; }
#edstripe { position: absolute; left: 48px; right: 0; top: 0; bottom: 0; pointer-events: none; }
#editor { position: absolute; left: 48px; right: 0; top: 0; bottom: 0; font-family: monospace; line-height: 20px; white-space: pre; overflow: hidden; }
```

## theme.js（骨子）

```javascript
const THEME = {
  bodyBGColor: '#0e0e0e',
  eofGutterFillColor: '#1e1e1e',
  // 他: gradientLineStart/End, gutterActive*, caretGradient*, ...
};

document.addEventListener('DOMContentLoaded', () => {
  document.body.style.setProperty('--body-bg', THEME.bodyBGColor);
});
```

## app.js（重要ロジックの骨子）

```javascript
(function(){
  const HSCROLL_RESERVE = 18; // 条件付きで使用
  const ROUND_THRESH = 0.985;

  const vp = document.getElementById('editorViewport');
  const gutter = document.getElementById('gutter');
  const stripe = document.getElementById('edstripe');
  const editor = document.getElementById('editor');

  function initialQuickViewportPaint(){ /* 初期軽量描画 */ }

  function clampViewportExactLines(){
    // clientHeight を行高で割って、整数行になるよう高さを調整
    // 水平スクロールが出る場合のみ HSCROLL_RESERVE を差し引いた値でクランプ
  }

  function _initLineLock(){
    // ラインロック時も HSCROLL_RESERVE を保持
  }

  function getVisibleLines(){ /* visibleTop, visibleCount（丸め統一）を返す */ }

  function ensureScrolloff(opts){
    // 方向別に上下マージンを評価
    // 中央寄せ条件: opts.centerOnce || (scrolloff >= visible/2)
    // EOF 最小ボトム余白
    // 差分僅少時のフォールバック
  }

  function updateGutter(){
    // 可視行のみ行番号を再描画
    // アクティブ行の強調
    // 末尾のガター余白を THEME.eofGutterFillColor で塗る
  }

  function _repositionCaret(){
    // scrollTop を切り捨て、行境界でキャレット（stripe 内）を配置
  }

  function bindEvents(){
    vp.addEventListener('scroll', () => { _repositionCaret(); updateGutter(); });
    editor.addEventListener('input',  () => { _repositionCaret(); updateGutter(); });
    editor.addEventListener('keyup',  () => { _repositionCaret(); updateGutter(); });
    editor.addEventListener('click',  () => { _repositionCaret(); updateGutter(); });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initialQuickViewportPaint();
    clampViewportExactLines();
    _initLineLock();
    bindEvents();
    _repositionCaret();
    updateGutter();
  });
})();
```

## 既存仕様の反映メモ

- 丸め/スナップの一貫性が最重要。ガター・キャレット・ストライプ・可視行計算を同じ閾値で統一する。
- `:N` のあとのダブルスクロール（上→下など）を禁止。ensureScrolloff は一度のみ。
- HSB は起動直後から見えること。予約は初期クランプ段で必ず考慮。

## README に記載すべき項目

- 実行要件（PowerShell バージョン、WebView2 ランタイム）
- 実行方法（`app.ps1` の起動）
- 既知の注意点と将来の改善項目

---

このプロンプトに従い、six の UI/挙動を WebView2 上で再現してください。テストチェックリストと受け入れ条件をすべて満たすことを完了条件とします。