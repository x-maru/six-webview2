# six-webview2 launcher (Edge app mode replacement)
param(
  # Positional arg(s): one or more documents to open (even if .html)
  [Parameter(Position=0, ValueFromRemainingArguments=$true)]
  [string[]]$Docs,

  # Layout HTML (default _six.html). Named parameter only (no positional)
  [string]$Html = "_six.html",

  # Development only: widen CORS (do not use for distribution)
  [switch]$DevInsecure = $false,

  # Delete Edge profile (.edge-profile) before launch (reset warnings)
  [switch]$ResetProfile = $false,

  # Keep console open at the end of script
  [switch]$KeepOpen = $false,

  # Max wait minutes for Edge window (default 720 = 12h)
  [int]$WaitMinutes = 720,

  # Debug: print Edge app URL (with #api) on launch
  [switch]$ShowUrl = $false
)

$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "six.ps1 starting in: $here"
$index = Join-Path $here $Html

if (-not (Test-Path $index)) {
  Write-Host "HTML not found: $index"
  exit 1
}

# Normalize Doc to relative from script folder (for file:// fetch convenience)
function Convert-ToFileUrl([string]$p){
  if ([string]::IsNullOrWhiteSpace($p)) { return $null }
  if ($p -match '^[a-zA-Z]:\\') { # ドライブ直下
    $norm = $p -replace '\\','/'
    return 'file:///' + $norm.Substring(0,1) + ':' + $norm.Substring(2)
  }
  if ($p -like '\\*') { # UNC
    $noPrefix = $p.TrimStart('\\') -replace '\\','/'
    return 'file://' + $noPrefix
  }
  return $null
}

$DocItems = @()
if ($Docs -and $Docs.Count -gt 0) {
  foreach($d in $Docs){
    $docPath = $d
    try { $docPath = (Resolve-Path $d -ErrorAction Stop).Path } catch { $docPath = $d }
    $absPath = $null
    try { if ($docPath -and (Test-Path $docPath) -and [System.IO.Path]::IsPathRooted($docPath)) { $absPath = (Resolve-Path $docPath -ErrorAction SilentlyContinue).Path } } catch {}
    $fileUrl = $null
    try { if ([System.IO.Path]::IsPathRooted($docPath)) { $fileUrl = Convert-ToFileUrl $docPath } } catch {}
    $docRel = $null
    if ($fileUrl) {
      $docRel = $fileUrl
    } else {
      try {
        $pathType = [System.IO.Path]
        if ($pathType.GetMethod('GetRelativePath')) {
          $docRel = [System.IO.Path]::GetRelativePath($here, $docPath)
        } else {
          $baseUri = [System.Uri]::new((Join-Path $here ''))
          $docUri  = [System.Uri]::new($docPath)
          $docRel  = [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($docUri).ToString())
        }
      } catch {
        $docRel = [System.IO.Path]::GetFileName($docPath)
      }
    }

    # 単一ファイル時のみ data を埋め込む。複数は URL を短く保つため省略（フロント側で file:// 読み込み）
    $item = [pscustomobject]@{
      doc  = $docRel
      name = [System.IO.Path]::GetFileName($docPath)
      abs  = $absPath
    }
    $DocItems += $item
  }
}

# Start a minimal loopback HTTP API (TcpListener) for directory listing
# Returns JSON { entries: [ { name, isDir, url } ] }
function Start-NanoApi([int]$Port){
  # ランタイムごとに一意なクラス名を使って型名衝突を回避（常に最新コードを利用）
  $className = "NanoApi_" + ([Guid]::NewGuid().ToString('N').Substring(0,8))
  # 外部 C# ファイルを読み込み（__CLASSNAME__ を実クラス名に置換）。見つからない場合はインライン定義にフォールバック。
  $csPath = Join-Path $here "_six.cs"
  if (-not (Test-Path $csPath)) { throw "_six.cs not found: $csPath" }
  $code = Get-Content -LiteralPath $csPath -Raw -Encoding UTF8
  $code = $code.Replace('__CLASSNAME__', $className)

  # 毎回ユニークな型名を使うため基本はコンパイルする（同一名再利用時のみスキップ）
  if (-not ($className -as [type])) {
    Add-Type -TypeDefinition $code -Language CSharp -IgnoreWarnings -ErrorAction Stop
  }

  $global:_nano = New-Object $className $Port
  $global:_nano.Start()
}

function Test-NanoApi([string]$Base){
  try {
    $hc = [System.Net.Http.HttpClient]::new()
    $hc.Timeout = [System.TimeSpan]::FromMilliseconds(1200)
    $resp = $hc.GetAsync($Base + 'ping').GetAwaiter().GetResult()
    return ($resp -and $resp.IsSuccessStatusCode)
  } catch { return $false }
}

# Build file:/// URL for the layout html
$indexAbs = (Resolve-Path $index).Path
$indexUri = [System.Uri]::new($indexAbs)
# Pick a loopback port and start API
$apiPort = Get-Random -Minimum 20000 -Maximum 60000
Start-NanoApi -Port $apiPort
$apiBase = "http://127.0.0.1:$apiPort/"
# Warm-up: retry /ping briefly (max ~1.2s)
for($i=0; $i -lt 8; $i++){
  if (Test-NanoApi -Base $apiBase) { break }
  Start-Sleep -Milliseconds 150
}
if ($DocItems.Count -ge 2) {
  # 複数ドキュメントは bundle=Base64(JSON) で渡す（data は含めない）
  $json = $DocItems | ConvertTo-Json -Depth 2 -Compress
  $b64  = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
  $qsBundle = [System.Uri]::EscapeDataString($b64)
  $targetUrl = $indexUri.AbsoluteUri + "#bundle=" + $qsBundle + "&api=" + ([System.Uri]::EscapeDataString($apiBase))
} elseif ($DocItems.Count -eq 1) {
  # 互換の単一ドキュメント経路（doc/name/data）
  $one = $DocItems[0]
  $text = $null
  try {
    $candidate = $null
    if ($one.PSObject.Properties.Name -contains 'abs' -and $one.abs) {
      $candidate = $one.abs
    } elseif ($one.doc -and $one.doc.StartsWith('file:', 'InvariantCultureIgnoreCase')) {
      try { $candidate = ([System.Uri]::new($one.doc)).LocalPath } catch {}
    } else {
      try { $candidate = (Resolve-Path $one.doc -ErrorAction Stop).Path } catch { $candidate = $one.doc }
    }
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      $text = Get-Content -LiteralPath $candidate -Raw -Encoding UTF8
    } else {
      $text = ''
    }
  } catch { $text = '' }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $b64   = [System.Convert]::ToBase64String($bytes)
  $qsDoc  = [System.Uri]::EscapeDataString($one.doc)
  $qsName = [System.Uri]::EscapeDataString($one.name)
  $includeData = $true
  # EscapeDataString は非常に長い文字列で例外を投げる場合があるため、閾値を超えたら data 伝達を省略
  try { if ($b64.Length -gt 60000) { $includeData = $false } } catch { $includeData = $false }
  if ($includeData) {
    try {
      $qsData = [System.Uri]::EscapeDataString($b64)
      $frag = "doc=$qsDoc&name=$qsName&data=$qsData&api=" + ([System.Uri]::EscapeDataString($apiBase))
    } catch {
      # フォールバック: data を付けずに doc/name のみ（フロント側で file:// を読み込む）
      $frag = "doc=$qsDoc&name=$qsName&api=" + ([System.Uri]::EscapeDataString($apiBase))
    }
  } else {
    $frag = "doc=$qsDoc&name=$qsName&api=" + ([System.Uri]::EscapeDataString($apiBase))
  }
  $targetUrl = $indexUri.AbsoluteUri + "#" + $frag
} else {
  $targetUrl = $indexUri.AbsoluteUri + "#api=" + ([System.Uri]::EscapeDataString($apiBase))
}

if ($ShowUrl) { Write-Host "Launching URL: $targetUrl" }

function Start-WebView2Host([string]$Url){
  # 探索: NuGet の Microsoft.Web.WebView2 パッケージから DLL を見つける
  $nugetBase = Join-Path $env:USERPROFILE ".nuget/packages/microsoft.web.webview2"
  $coreDll = $null; $wfDll = $null
  if (Test-Path $nugetBase){
    $candidates = Get-ChildItem -Path $nugetBase -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
    foreach($ver in $candidates){
      try {
        $coreCand = Get-ChildItem -Path (Join-Path $ver.FullName "lib") -Recurse -Filter "Microsoft.Web.WebView2.Core.dll" -ErrorAction SilentlyContinue | Select-Object -First 1
        $wfCand   = Get-ChildItem -Path (Join-Path $ver.FullName "lib") -Recurse -Filter "Microsoft.Web.WebView2.WinForms.dll" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($coreCand -and $wfCand) { $coreDll = $coreCand.FullName; $wfDll = $wfCand.FullName; break }
      } catch {}
    }
  }
  if (-not ($coreDll -and $wfDll)) { return $false }

  # ウィンドウアイコン: 最適な PNG を選択（256x256 を優先。なければ 512x512、1024x1024 の順）
  $iconCandidates = @(
    Join-Path $here "256x256.png",
    Join-Path $here "512x512.png",
    Join-Path $here "1024x1024.png"
  )
  $iconFile = $null
  foreach($cand in $iconCandidates){ if (Test-Path $cand) { $iconFile = $cand; break } }
  $iconLiteral = $null
  if ($iconFile) {
    $iconLiteral = '"' + ($iconFile -replace '\\','\\\\') + '"'
  } else {
    $iconLiteral = 'null'
  }

  $code = @"
using System;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.IO;
using System.Drawing;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

public static class SixHostApp
{
  private static bool _closing = false;
  private static bool _approved = false;
  private static TaskCompletionSource<bool> _tcs;
  [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true)]
  private static extern bool DestroyIcon(IntPtr hIcon);

  private static bool TryGetBool(string json, string key, out bool value){
    value = false; if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return false;
    try{
      var m = Regex.Match(json, "\""+Regex.Escape(key)+"\"\\s*:\\s*(true|false)", RegexOptions.IgnoreCase);
      if (m.Success){ value = string.Equals(m.Groups[1].Value, "true", StringComparison.OrdinalIgnoreCase); return true; }
    }catch{}
    return false;
  }
  private static bool TryGetInt(string json, string key, out int value){
    value = 0; if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(key)) return false;
    try{
      var m = Regex.Match(json, "\""+Regex.Escape(key)+"\"\\s*:\\s*(-?\\d+)", RegexOptions.IgnoreCase);
      if (m.Success){ int v; if (int.TryParse(m.Groups[1].Value, out v)){ value = v; return true; } }
    }catch{}
    return false;
  }

  public static void Run(string url)
  {
    Application.SetHighDpiMode(HighDpiMode.SystemAware);
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);

    var form = new Form();
    form.Text = "six-webview2";
    form.Width = 1200; form.Height = 800;
    var wv = new WebView2(){ Dock = DockStyle.Fill };
    form.Controls.Add(wv);

    // Try to set window icon: choose best available PNG (prefer 256x256)
    try{
      string iconPath = ICON_PATH_PLACEHOLDER;
      if (!string.IsNullOrEmpty(iconPath) && File.Exists(iconPath)){
        using (var bmp = new Bitmap(iconPath)){
          IntPtr hIcon = bmp.GetHicon();
          using (var tmp = Icon.FromHandle(hIcon)){
            form.Icon = (Icon)tmp.Clone();
          }
          DestroyIcon(hIcon);
        }
      }
    }catch{}

    form.Load += async (_, __) => {
      var env = await CoreWebView2Environment.CreateAsync();
      await wv.EnsureCoreWebView2Async(env);
      wv.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = false;
      wv.CoreWebView2.WebMessageReceived += (s, e) => {
        try{
          var txt = e.TryGetWebMessageAsString();
          if (string.IsNullOrEmpty(txt)) return;
          // very small parser to detect {"type":"close-result","ok":true|false}
          if (txt.Contains("\"type\"\s*:\s*\"close-result\"")){
            bool ok = txt.Contains("\"ok\"\s*:\s*true");
            _tcs?.TrySetResult(ok);
            return;
          }
          // handle {"type":"six-window-restore", ...}
          if (txt.Contains("\"type\":\"six-window-restore\"")){
            bool requestMax = false; TryGetBool(txt, "requestMaximize", out requestMax);
            int nW=0,nH=0,sX=0,sY=0,nX=0,nY=0;
            bool hasNW = TryGetInt(txt, "normalOuterW", out nW);
            bool hasNH = TryGetInt(txt, "normalOuterH", out nH);
            bool hasSX = TryGetInt(txt, "screenX", out sX);
            bool hasSY = TryGetInt(txt, "screenY", out sY);
            bool hasNX = TryGetInt(txt, "normalX", out nX);
            bool hasNY = TryGetInt(txt, "normalY", out nY);
            form.BeginInvoke(new Action(()=>{
              try{
                if (requestMax){
                  // 任意: 最大化前に通常サイズを適用してから最大化（ちらつき低減のため近いサイズに）
                  if (hasNW && hasNH){ try{ form.WindowState = FormWindowState.Normal; form.StartPosition = FormStartPosition.Manual; if (hasNX && hasNY) form.Location = new System.Drawing.Point(nX, nY); else if (hasSX && hasSY) form.Location = new System.Drawing.Point(sX, sY); form.Size = new System.Drawing.Size(Math.Max(200, nW), Math.Max(150, nH)); }catch{} }
                  try{ form.WindowState = FormWindowState.Maximized; }catch{}
                } else {
                  if (hasNW && hasNH){
                    try{ form.WindowState = FormWindowState.Normal; form.StartPosition = FormStartPosition.Manual; if (hasNX && hasNY) form.Location = new System.Drawing.Point(nX, nY); else if (hasSX && hasSY) form.Location = new System.Drawing.Point(sX, sY); form.Size = new System.Drawing.Size(Math.Max(200, nW), Math.Max(150, nH)); }catch{}
                  }
                }
              }catch{}
            }));
            return;
          }
        }catch{}
      };
      wv.CoreWebView2.Navigate(url);
    };

    form.FormClosing += async (sender, e) => {
      if (_approved) return;
      if (_closing) { e.Cancel = true; return; }
      if (wv.CoreWebView2 == null) return;
      e.Cancel = true;
      _closing = true; _tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
      try{
        wv.CoreWebView2.PostWebMessageAsJson("{\\\"type\\\":\\\"close-request\\\"}");
        using (var cts = new System.Threading.CancellationTokenSource(15000)){
          using (cts.Token.Register(()=> _tcs.TrySetResult(false))){
            var ok = await _tcs.Task.ConfigureAwait(true);
            if (ok){ _approved = true; form.Close(); }
          }
        }
      }catch{}
      finally{ _closing = false; }
    };

    Application.Run(form);
  }
}
"@

  # 置換: アイコンパスをコードへ埋め込み
  $code = $code.Replace('ICON_PATH_PLACEHOLDER', $iconLiteral)

  $refs = @("System.Windows.Forms","System.Drawing", $coreDll, $wfDll)
  try {
    Add-Type -TypeDefinition $code -ReferencedAssemblies $refs -Language CSharp -IgnoreWarnings -ErrorAction Stop
    [SixHostApp]::Run($Url)
    return $true
  } catch {
    Write-Host "WebView2 host compile failed: $($_.Exception.Message)"
    return $false
  }
}

# 1) まず WebView2 ホストで起動を試みる（成功すればブラウザは使わない）
$launched = Start-WebView2Host -Url $targetUrl
if (-not $launched) {
  # 2) フォールバック: Edge app mode
  $edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  if (!(Test-Path $edge)) { $edge = "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe" }

  if (Test-Path $edge) {
    # 引数は 1 文字列で渡す。空白含みも OK
    $profileDir = Join-Path $here ".edge-profile"
    if ($ResetProfile) { try { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $profileDir } catch {} }
    if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir | Out-Null }
    $args = @("--allow-file-access-from-files","--user-data-dir=$profileDir","--app=$targetUrl")
    if ($DevInsecure) { $args = @("--allow-file-access-from-files","--disable-web-security","--user-data-dir=$profileDir","--app=$targetUrl") }
    $p = Start-Process -FilePath $edge -ArgumentList $args -WorkingDirectory $here -PassThru
    # 監視ループ: user-data-dir が一致する msedge.exe のうち、ウィンドウを持つものが存在する間は待機
    $deadline = (Get-Date).AddMinutes([Math]::Max(1, $WaitMinutes))
    $seenWindow = $false; $lastHadWindow = Get-Date
    while ((Get-Date) -lt $deadline) {
      try {
        $wmi = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
          Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) }
      } catch { $wmi = @() }
      $withWindow = @()
      foreach($pinfo in $wmi){
        try {
          $gp = Get-Process -Id $pinfo.ProcessId -ErrorAction SilentlyContinue
          if ($gp -and $gp.MainWindowHandle -ne 0) { $withWindow += $gp }
        } catch {}
      }
      if ($withWindow.Count -gt 0) {
        $seenWindow = $true; $lastHadWindow = Get-Date
      } elseif ($seenWindow) {
        # 以前はウィンドウがあった → 1秒以上なければ終了
        if ((Get-Date) -gt $lastHadWindow.AddSeconds(1)) { break }
      } else {
        # まだウィンドウを検知していない → Edge 親プロセスが死んでいたら終了
        try { $parent = Get-Process -Id $p.Id -ErrorAction SilentlyContinue } catch { $parent = $null }
        if (-not $parent) { break }
      }
      Start-Sleep -Milliseconds 300
    }
  } else {
    Write-Host "Edge not found. Open $index manually."
    if ($DocRel) { Write-Host "Then append ?doc=$qsDoc to the file URL." }
  }
}

if ($KeepOpen) { Write-Host 'Press Enter to exit...'; Read-Host | Out-Null }
