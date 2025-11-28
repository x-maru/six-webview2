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
  [switch]$ShowUrl = $false,

  # Allow multiple instances (bypass single-instance mutex). Default: false
  [switch]$AllowMulti = $false,
  # Optional instance tag appended to mutex name for parallel debug runs
  [string]$InstanceTag,
  # Suppress non-error informational logs
  # Diag: 通常はエラーのみ出力し、指定時に情報ログも表示 (PowerShell共通 -Verbose と衝突回避)
  [switch]$Diag = $false
)

$global:SixLaunched = $false
$here  = Split-Path -Parent $MyInvocation.MyCommand.Path

# Sanitize instance tag early for reuse (profile dir, mutex)
$InstanceTagSan = $null
if ($InstanceTag) {
  try { $InstanceTagSan = ($InstanceTag -replace '[^a-zA-Z0-9_-]', '_') } catch { $InstanceTagSan = 'tag' }
  if ($InstanceTagSan.Length -gt 24) { $InstanceTagSan = $InstanceTagSan.Substring(0,24) }
}
if (-not $AllowMulti) {
  $hash = ''
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($here)
    $hb = $sha.ComputeHash($bytes)
    $hash = ([System.BitConverter]::ToString($hb)).Replace('-', '').Substring(0,12)
  } catch {
    $hash = ($here -replace '[^a-zA-Z0-9]', '_')
    if ($hash.Length -gt 12) { $hash = $hash.Substring($hash.Length-12) }
  }
  $mutexName = if ($InstanceTagSan) { "six-webview2-$hash-$InstanceTagSan" } else { "six-webview2-$hash" }
  try {
    $createdNew = $false
    $global:SixMutex = [System.Threading.Mutex]::new($false, $mutexName, [ref]$createdNew)
    if (-not $createdNew) {
      Write-Host "six already running (mutex: $mutexName). Exiting." -ForegroundColor Yellow
      # Release immediately to avoid holding mutex when forcing exit
      try { if ($global:SixMutex) { $global:SixMutex.ReleaseMutex(); $global:SixMutex.Dispose(); $global:SixMutex = $null } } catch {}
      if ($KeepOpen) {
        Write-Host 'Press Enter to force launch anyway (multi-instance) or Ctrl-C to cancel.'
        $inp = Read-Host
      } else {
        return  # return instead of exit: avoid blocking parent shell waiting for host
      }
    } else {
      $releaseScript = {
        try { if ($global:SixMutex) { $global:SixMutex.ReleaseMutex(); $global:SixMutex.Dispose(); $global:SixMutex = $null } } catch {}
      }
      try { Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action $releaseScript | Out-Null } catch {}
      $global:SixReleaseAction = $releaseScript
    }
  } catch {
    Write-Host "Mutex setup failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
  }
}
if ($Diag) { Write-Host "six.ps1 starting in: $here" }
$index = Join-Path $here $Html

if (-not (Test-Path $index)) {
  Write-Error "HTML not found: $index"
  if ($KeepOpen) { Write-Host 'Press Enter to exit...'; Read-Host | Out-Null }
  return
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

# --- Functions ---------------------------------------------------------------
function Start-NanoApi([int]$Port){
  $className = "NanoApi_" + ([Guid]::NewGuid().ToString('N').Substring(0,8))
  $csPath = Join-Path $here "_six.cs"
  if (-not (Test-Path $csPath)) { throw "_six.cs not found: $csPath" }
  $code = Get-Content -LiteralPath $csPath -Raw -Encoding UTF8
  $code = $code.Replace('__CLASSNAME__', $className)
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

function Test-TcpPortFree([int]$Port){
  try {
    $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $l.Start(); $l.Stop(); return $true
  } catch { return $false }
}

# More reliable: attempt an actual TCP connect to detect a listening server.
function Test-TcpPortOccupied([int]$Port){
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $iar = $client.BeginConnect([System.Net.IPAddress]::Loopback, $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(300)
    if (-not $ok) { try { $client.Close() } catch {}; return $false }
    $client.EndConnect($iar)
    try { $client.Close() } catch {}
    return $true
  } catch {
    return $false
  }
}

function Start-WebView2Host([string]$Url){
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
  $iconCandidates = @(Join-Path $here "256x256.png",Join-Path $here "512x512.png",Join-Path $here "1024x1024.png")
  $iconFile = $null; foreach($cand in $iconCandidates){ if (Test-Path $cand){ $iconFile=$cand; break } }
  $iconLiteral = if($iconFile){ '"' + ($iconFile -replace '\\','\\\\') + '"' } else { 'null' }
  $hostCs = Join-Path $here 'SixHostApp.cs'
  if (!(Test-Path $hostCs)){ Write-Host "Missing SixHostApp.cs: $hostCs"; return $false }
  $code = Get-Content -LiteralPath $hostCs -Raw -Encoding UTF8
  $code = $code.Replace('ICON_PATH_PLACEHOLDER', $iconLiteral)
  $refs = @('System.Windows.Forms','System.Drawing', $coreDll, $wfDll)
  try {
    Add-Type -TypeDefinition $code -ReferencedAssemblies $refs -Language CSharp -IgnoreWarnings -ErrorAction Stop
    [SixHostApp]::Run($Url); return $true
  } catch {
    Write-Host "WebView2 host compile failed: $($_.Exception.Message)"; return $false
  }
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
    if ($fileUrl) { $docRel = $fileUrl }
    else {
      try {
        $pathType = [System.IO.Path]
        if ($pathType.GetMethod('GetRelativePath')) { $docRel = [System.IO.Path]::GetRelativePath($here, $docPath) }
        else {
          $baseUri = [System.Uri]::new((Join-Path $here ''))
          $docUri  = [System.Uri]::new($docPath)
          $docRel  = [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($docUri).ToString())
        }
      } catch { $docRel = [System.IO.Path]::GetFileName($docPath) }
    }
    $DocItems += [pscustomobject]@{ doc=$docRel; name=[System.IO.Path]::GetFileName($docPath); abs=$absPath }
  }
}

# Filter out tokens that are actually known switch names accidentally captured as docs (robust against wrapper forwarding).
try {
  $knownSwitches = @('-Diag','-AllowMulti','-DevInsecure','-ResetProfile','-KeepOpen','-ShowUrl','-WaitMinutes','-Html','-InstanceTag')
  if ($DocItems.Count -gt 0) {
    $DocItems = $DocItems | Where-Object { $_.doc -and (-not ($knownSwitches -contains $_.doc)) }
  }
} catch {}

# Start a minimal loopback HTTP API (TcpListener) for directory listing
# Returns JSON { entries: [ { name, isDir, url } ] }
# Build file:/// URL for the layout html
$indexAbs = (Resolve-Path $index).Path
$indexUri = [System.Uri]::new($indexAbs)
# Pick a loopback port and start API once (avoid multiple servers)
$apiPort = $null; $apiBase = $null; $apiStarted = $false
# choose a free port first (few tries)
$tryPort = $null
for($attempt=0; $attempt -lt 6; $attempt++){
  $cand = Get-Random -Minimum 25000 -Maximum 61000
  if (Test-TcpPortFree -Port $cand) { $tryPort = $cand; break }
}
if (-not $tryPort) { $tryPort = Get-Random -Minimum 25000 -Maximum 61000 }
try {
  Start-NanoApi -Port $tryPort
  if ($Diag) { Write-Host "[nanoapi] start attempted on $tryPort" }
} catch {
  Write-Host "[nanoapi] start failed: $($_.Exception.Message)" -ForegroundColor Yellow
}
try {
  Start-Sleep -Milliseconds 120  # allow listener to enter Accept loop
  $portOccupied = Test-TcpPortOccupied -Port $tryPort
  $freeProbe = Test-TcpPortFree -Port $tryPort
  # freeProbe true means we could bind+release (may race); occupied true means a real listener accepted or handshake succeeded
  if ($Diag) { Write-Host "[nanoapi] port occupied(connect): $portOccupied freeProbe:$freeProbe" }
} catch { Write-Host "[nanoapi] port occupied check error: $($_.Exception.Message)" -ForegroundColor Yellow }
try {
  if ($global:_nano -and $global:_nano.GetType().GetMethod('IsAlive')) {
    $alive = $false
    try { $alive = $global:_nano.IsAlive() } catch { $alive = $false }
    if ($Diag) { Write-Host "[nanoapi] IsAlive(): $alive" }
  }
} catch { Write-Host "[nanoapi] IsAlive() check error: $($_.Exception.Message)" -ForegroundColor Yellow }

## --- Ping loop & diagnostics (HttpClient assembly load + fallback) ---------
try {
  Add-Type -AssemblyName System.Net.Http -ErrorAction Stop
} catch {
  Write-Host "[nanoapi] System.Net.Http load failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
}
$haveHttpClient = $false
try { $null = [System.Net.Http.HttpClient]; $haveHttpClient = $true } catch { $haveHttpClient = $false }
if (-not $haveHttpClient) { Write-Host "[nanoapi] HttpClient unavailable; using HttpWebRequest fallback" -ForegroundColor DarkYellow }

$base = "http://127.0.0.1:$tryPort/"
$ok = $false
for($i=0; $i -lt 30; $i++){
  $pong = $false
  try {
    if ($haveHttpClient) {
      $hcTry = [System.Net.Http.HttpClient]::new(); $hcTry.Timeout = [TimeSpan]::FromMilliseconds(1000)
      $respTry = $hcTry.GetAsync($base + 'ping').GetAwaiter().GetResult()
      if ($respTry) {
        $pong = $respTry.IsSuccessStatusCode
        if ($Diag) { Write-Host "[nanoapi] ping attempt $i status=$($respTry.StatusCode) success=$pong via=HttpClient" }
      } else {
        if ($Diag) { Write-Host "[nanoapi] ping attempt $i null response via=HttpClient" }
      }
    } else {
      $req = [System.Net.WebRequest]::Create($base + 'ping')
      $req.Method = 'GET'
      $resp = $req.GetResponse()
      # Try to cast to HttpWebResponse to read StatusCode; fallback assumes success if no exception
      $httpResp = $null
      if ($resp -is [System.Net.HttpWebResponse]) {
        $httpResp = [System.Net.HttpWebResponse]$resp
      }
      if ($httpResp) {
        $pong = ($httpResp.StatusCode -eq 200)
        if ($Diag) { Write-Host "[nanoapi] ping attempt $i status=$($httpResp.StatusCode) success=$pong via=HttpWebRequest" }
      } else {
        $pong = $true
        if ($Diag) { Write-Host "[nanoapi] ping attempt $i fallback success via=WebRequest" }
      }
      try { $resp.Close() } catch {}
    }
  } catch {
    Write-Host "[nanoapi] ping attempt $i exception: $($_.Exception.Message)"
  }
  if ($pong) { $ok = $true; if ($Diag) { Write-Host "[nanoapi] /ping OK on attempt $i" }; break }
  if ($i -in 0,5,10,20 -and $Diag){ Write-Host "[nanoapi] waiting for /ping (attempt $i)" }
  if ($i -eq 5) {
    $postStartAlive = $false
    if ($global:_nano -and $global:_nano.GetType().GetMethod('IsAlive')) {
      try { $postStartAlive = $global:_nano.IsAlive() } catch { $postStartAlive = $false }
    }
    if ($Diag) { Write-Host "[nanoapi] mid-loop IsAlive=$postStartAlive" }
  }
  if ($i -eq 8) {
    try {
      $portStillBound = -not (Test-TcpPortFree -Port $tryPort)
      if ($Diag) { Write-Host "[nanoapi] re-check port bound (attempt $i): $portStillBound" }
    } catch { Write-Host "[nanoapi] re-check port error: $($_.Exception.Message)" -ForegroundColor DarkYellow }
  }
  Start-Sleep -Milliseconds 160
}
if (-not $ok){ Write-Host "[nanoapi] final ping failed after attempts" -ForegroundColor DarkYellow }
try {
  if ($global:_nano -and $global:_nano.GetType().GetMethod('LastError')) {
    $le = $null
    try { $le = $global:_nano.LastError() } catch {}
    if ($le) { Write-Host "[nanoapi] LastError: $le" -ForegroundColor Yellow }
  }
} catch {}
if ($ok) { $apiPort = $tryPort; $apiBase = $base; $apiStarted = $true }
else { $apiPort = $tryPort; $apiBase = $base; Write-Host "Warning: Nano API did not respond on $tryPort. UI features may be limited." }
if ($DocItems.Count -ge 2) {
  # 複数ドキュメントは bundle=Base64(JSON) で渡す（data は含めない）
  $json = $DocItems | ConvertTo-Json -Depth 2 -Compress
  $b64  = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
  $qsBundle = [System.Uri]::EscapeDataString($b64)
  $targetUrl = $indexUri.AbsoluteUri + "#bundle=" + $qsBundle + "&api=" + ([System.Uri]::EscapeDataString($apiBase))
} elseif ($DocItems.Count -eq 1) {
  # 互換の単一ドキュメント経路（doc/name/data） + 文字コード推定 (UTF-8 / UTF-16 / CP932)
  $one = $DocItems[0]
  $text = ''
  $charset = 'utf8'
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
      try { [System.Text.Encoding]::RegisterProvider([System.Text.CodePagesEncodingProvider]::Instance) } catch {}
      $bytesOrig = [System.IO.File]::ReadAllBytes($candidate)
      if ($bytesOrig.Length -ge 3 -and $bytesOrig[0] -eq 0xEF -and $bytesOrig[1] -eq 0xBB -and $bytesOrig[2] -eq 0xBF) {
        $text = [System.Text.Encoding]::UTF8.GetString($bytesOrig,3,$bytesOrig.Length-3); $charset='utf8-bom'
      } elseif ($bytesOrig.Length -ge 2 -and (( $bytesOrig[0] -eq 0xFF -and $bytesOrig[1] -eq 0xFE ) -or ( $bytesOrig[0] -eq 0xFE -and $bytesOrig[1] -eq 0xFF ))) {
        $text = [System.Text.Encoding]::Unicode.GetString($bytesOrig); $charset='utf16'
      } else {
        $utf8Ok = $false
        try {
          $tmp = [System.Text.Encoding]::UTF8.GetString($bytesOrig)
          $re = [System.Text.Encoding]::UTF8.GetBytes($tmp)
            # 長さ一致のみの簡易判定（厳密ではないが過剰判定を避ける）
          if ($re.Length -eq $bytesOrig.Length) { $text = $tmp; $utf8Ok = $true; $charset='utf8' }
        } catch {}
        if (-not $utf8Ok) {
          try { $enc932 = [System.Text.Encoding]::GetEncoding(932); $text = $enc932.GetString($bytesOrig); $charset='cp932' } catch { $text = [System.Text.Encoding]::UTF8.GetString($bytesOrig); $charset='utf8-fallback' }
        }
      }
    }
  } catch {}
  # 埋め込みは常に UTF-8 base64 に正規化
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $b64   = [System.Convert]::ToBase64String($bytes)
  $qsDoc  = [System.Uri]::EscapeDataString($one.doc)
  $qsName = [System.Uri]::EscapeDataString($one.name)
  $qsCharset = [System.Uri]::EscapeDataString($charset)
  $includeData = $true
  try { if ($b64.Length -gt 60000) { $includeData = $false } } catch { $includeData = $false }
  if ($includeData) {
    try {
      $qsData = [System.Uri]::EscapeDataString($b64)
      $frag = "doc=$qsDoc&name=$qsName&charset=$qsCharset&data=$qsData&api=" + ([System.Uri]::EscapeDataString($apiBase))
    } catch {
      $frag = "doc=$qsDoc&name=$qsName&charset=$qsCharset&api=" + ([System.Uri]::EscapeDataString($apiBase))
    }
  } else {
    $frag = "doc=$qsDoc&name=$qsName&charset=$qsCharset&api=" + ([System.Uri]::EscapeDataString($apiBase))
  }
  $targetUrl = $indexUri.AbsoluteUri + "#" + $frag
} else {
  $targetUrl = $indexUri.AbsoluteUri + "#api=" + ([System.Uri]::EscapeDataString($apiBase))
}

if ($ShowUrl -and $Diag) { Write-Host "Launching URL: $targetUrl" }

# --- Low-level keyboard hook: F19 -> Esc (six内限定) ----------------------
# Edge appモード利用時、前景ウィンドウのプロセスが six 起動時の専用プロフィールディレクトリを
# コマンドラインに含む msedge.exe の場合のみ、F19 を Esc として注入する。
Add-Type -Language CSharp -TypeDefinition @'
using System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Threading;
public static class F19EscHookService {
  private static IntPtr _hook = IntPtr.Zero;
  private static F19EscHookService.LowLevelKeyboardProc _proc = HookProc;
  private static int[] _allowPids = new int[0];
  private static Thread _th = null; private static uint _thId = 0; private static volatile bool _running = false;
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYDOWN = 0x0100; private const int WM_SYSKEYDOWN = 0x0104; private const int WM_KEYUP = 0x0101; private const int WM_SYSKEYUP = 0x0105;
  private const int VK_ESCAPE = 0x1B;
  // User environment (JIS): kana/eisu observed as vk=22 and vk=26
  private const int VK_KANA_OBS = 22;  // かな: force IME ON
  private const int VK_EISU_OBS = 26;  // 英数: force IME OFF
  private static bool _diag = false; private static int _eventCount = 0; private static int _escInjected = 0; private static int _suppressCount = 0; private static int _pidMiss = 0;
  public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct KBDLLHOOKSTRUCT { public int vkCode; public int scanCode; public int flags; public int time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError=true)] private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);
  [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hhk);
  [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] private static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);
  [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG lpMsg);
  [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG lpMsg);
  [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint idThread, uint Msg, UIntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] private static extern uint GetLastError();
  private const uint WM_QUIT = 0x0012;
  private const uint GA_ROOT = 2;
    [DllImport("user32.dll", CharSet=CharSet.Auto)] private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] private static extern IntPtr GetFocus();
  [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left; public int top; public int right; public int bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public uint cbSize; public uint flags; public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture; public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret; public RECT rcCaret;
  }
  [DllImport("imm32.dll")] private static extern IntPtr ImmGetContext(IntPtr hWnd);
  [DllImport("imm32.dll")] private static extern bool ImmSetOpenStatus(IntPtr hIMC, bool fOpen);
  [DllImport("imm32.dll")] private static extern bool ImmReleaseContext(IntPtr hWnd, IntPtr hIMC);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public int type; public INPUTUNION U; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public short wVk; public short wScan; public int dwFlags; public int time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hWnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int pt_x; public int pt_y; }
  private const int INPUT_KEYBOARD = 1; private const int KEYEVENTF_KEYUP = 0x0002;
    private const uint WM_IME_CONTROL = 0x0283; private const int IMC_SETOPENSTATUS = 0x0006;
    [DllImport("imm32.dll")] private static extern IntPtr ImmGetDefaultIMEWnd(IntPtr hWnd);
  public static void EnableDiag(){ _diag = true; try { Console.WriteLine("[hook] diag enabled"); } catch {} }
  private static string _imeNotifyBase = null; // e.g., http://127.0.0.1:12345/
  public static void SetImeNotifyBase(string baseUrl){ try{ _imeNotifyBase = baseUrl; if(_diag){ try { Console.WriteLine("[hook] imeNotifyBase="+baseUrl); }catch{} } }catch{} }
  public static void SetAllowPids(int[] pids){ _allowPids = (pids==null)? new int[0] : pids; if(_diag){ try { Console.WriteLine("[hook] allowPids=" + string.Join(",", _allowPids)); } catch {} } }
  public static string GetStats(){ return "running=" + _running + " hook=" + (int)_hook + " events=" + _eventCount + " escInjected=" + _escInjected + " suppressed=" + _suppressCount + " pidMiss=" + _pidMiss; }
  public static void Start(){
    if (_running) return;
    _running = true;
    _th = new Thread(()=>{
      try{
        _thId = GetCurrentThreadId();
        _hook = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, IntPtr.Zero, 0);
        if (_diag){ try { Console.WriteLine("[hook] SetWindowsHookEx result=" + (int)_hook + " lastErr=" + GetLastError()); } catch {} }
        MSG msg;
        while (_running && GetMessage(out msg, IntPtr.Zero, 0, 0)){
          TranslateMessage(ref msg); DispatchMessage(ref msg);
          if (msg.message == WM_QUIT) break;
        }
      } catch {} finally {
        try{ if (_hook!=IntPtr.Zero){ UnhookWindowsHookEx(_hook); if(_diag){ try { Console.WriteLine("[hook] unhooked"); } catch {} } _hook=IntPtr.Zero; } }catch{}
        _running = false; _thId = 0;
      }
    });
    _th.IsBackground = true; _th.Start();
  }
  public static void Stop(){
    try{ _running = false; if (_thId!=0){ PostThreadMessage(_thId, WM_QUIT, UIntPtr.Zero, IntPtr.Zero); } }catch{}
    try{ if (_th!=null && _th.IsAlive){ _th.Join(300); } }catch{}
    try{ if (_hook!=IntPtr.Zero){ UnhookWindowsHookEx(_hook); _hook=IntPtr.Zero; } }catch{}
  }
  private static bool IsSixForeground(){
    try{
      var hwnd = GetForegroundWindow(); if (hwnd==IntPtr.Zero) return false;
      uint pidChild; GetWindowThreadProcessId(hwnd, out pidChild);
      // ルートウィンドウのPIDも許可対象に含める（WebView2の子ウィンドウ対策）
      var root = GetAncestor(hwnd, GA_ROOT);
      uint pidRoot = 0; if (root != IntPtr.Zero) { GetWindowThreadProcessId(root, out pidRoot); }
      if (_allowPids==null || _allowPids.Length==0) return false;
      foreach(var ap in _allowPids){ if (ap == (int)pidChild || (pidRoot!=0 && ap == (int)pidRoot)) return true; }
      _pidMiss++; if(_diag){ try { Console.WriteLine("[hook] pid miss child=" + pidChild + " root=" + pidRoot); } catch {} }
      return false;
    }catch{ return false; }
  }
  public static IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam){
    if (nCode>=0){
      int msg = (int)wParam;
      bool isDown = (msg==WM_KEYDOWN || msg==WM_SYSKEYDOWN);
      bool isUp   = (msg==WM_KEYUP   || msg==WM_SYSKEYUP);
      if (isDown || isUp){
        var kb = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
        // Robust: treat any F13..F24 as candidate and remap to Esc (six前景限定)
        int vk = kb.vkCode;
        _eventCount++;
        if(_diag){ try { Console.WriteLine("[hook] vk=" + vk + " down=" + isDown + " up=" + isUp); } catch {} }
        // Kana/Eisu handling (pass-through): when six is foreground, force IME state
        if (IsSixForeground() && isDown){
          if (vk == VK_KANA_OBS){
            try{ ForceImeOnWithRetry(); if(_diag){ try { Console.WriteLine("[hook] Kana detected: IME ON"); } catch {} } }catch{}
            try{ if(!string.IsNullOrEmpty(_imeNotifyBase)){ NotifyImeState("on"); } }catch{}
          } else if (vk == VK_EISU_OBS){
            try{ ForceImeOffWithRetry(); if(_diag){ try { Console.WriteLine("[hook] Eisu detected: IME OFF"); } catch {} } }catch{}
            try{ if(!string.IsNullOrEmpty(_imeNotifyBase)){ NotifyImeState("off"); } }catch{}
          }
        }
        if (vk >= 0x7C && vk <= 0x87){
          if (IsSixForeground()){
            if (isDown) { InjectEsc(); _escInjected++; if(_diag){ try { Console.WriteLine("[hook] Esc injected for vk="+vk); } catch {} } }
            _suppressCount++; return (IntPtr)1; // suppress original F13..F24 (down/up)
          }
        }
        // Esc 自体が押された場合も six 前景なら IME を閉じる（即時＋50ms再試行）
        if (vk == VK_ESCAPE && isDown){
          if (IsSixForeground()){
            try{ ForceImeOffWithRetry(); }catch{}
          }
        }
      }
    }
    return CallNextHookEx(_hook, nCode, wParam, lParam);
  }
  private static void InjectEsc(){
    try{
      // 1) SendInput による仮想入力注入
      var down = new INPUT{ type=INPUT_KEYBOARD, U=new INPUTUNION{ ki = new KEYBDINPUT{ wVk=VK_ESCAPE, wScan=0, dwFlags=0, time=0, dwExtraInfo=IntPtr.Zero } } };
      var up   = new INPUT{ type=INPUT_KEYBOARD, U=new INPUTUNION{ ki = new KEYBDINPUT{ wVk=VK_ESCAPE, wScan=0, dwFlags=KEYEVENTF_KEYUP, time=0, dwExtraInfo=IntPtr.Zero } } };
      INPUT[] arr = new INPUT[]{ down, up }; SendInput((uint)arr.Length, arr, Marshal.SizeOf(typeof(INPUT)));
    }catch{}
    try{
      // 2) フォールバック: 前景とルートに PostMessage で WM_KEYDOWN/UP を送る
      var hwnd = GetForegroundWindow();
      var root = GetAncestor(hwnd, GA_ROOT);
      if (hwnd != IntPtr.Zero){
        PostMessage(hwnd, (uint)WM_KEYDOWN, (IntPtr)VK_ESCAPE, IntPtr.Zero);
        PostMessage(hwnd, (uint)WM_KEYUP,   (IntPtr)VK_ESCAPE, IntPtr.Zero);
      }
      if (root != IntPtr.Zero && root != hwnd){
        PostMessage(root, (uint)WM_KEYDOWN, (IntPtr)VK_ESCAPE, IntPtr.Zero);
        PostMessage(root, (uint)WM_KEYUP,   (IntPtr)VK_ESCAPE, IntPtr.Zero);
      }
      if(_diag){ try { Console.WriteLine("[hook] Esc postmsg hwnd=" + (long)hwnd + " root=" + (long)root); } catch {} }
    }catch{}
    // F19→Esc 注入時にも IME を閉じる（即時＋50ms再試行）
    try{ ForceImeOffWithRetry(); }catch{}
  }

  private static void ForceImeOffWithRetry(){
    try{ ForceImeOffOnce(); }catch{}
    try{
      var th1 = new Thread(()=>{ try{ Thread.Sleep(50); ForceImeOffOnce(); }catch{} }); th1.IsBackground = true; th1.Start();
      var th2 = new Thread(()=>{ try{ Thread.Sleep(120); ForceImeOffOnce(); }catch{} }); th2.IsBackground = true; th2.Start();
    }catch{}
  }
  private static void ForceImeOffOnce(){
    try{
      var root = GetForegroundWindow(); if (root==IntPtr.Zero) { if(_diag){ try { Console.WriteLine("[hook] no foreground window"); } catch {} } return; }
      uint pid; var tid = GetWindowThreadProcessId(root, out pid);
      IntPtr target = IntPtr.Zero;
      try{
        var gti = new GUITHREADINFO(); gti.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(GUITHREADINFO));
        if (GetGUIThreadInfo(tid, ref gti)) { target = gti.hwndFocus; }
      }catch{}
      if (target == IntPtr.Zero){
        uint selfTid = GetCurrentThreadId(); bool attached = false;
        try{ attached = AttachThreadInput(selfTid, tid, true); target = GetFocus(); }catch{} finally{ try{ if (attached) AttachThreadInput(selfTid, tid, false); }catch{} }
      }
      if (target != IntPtr.Zero){ if (TryImeOff(target)) { if(_diag){ try { Console.WriteLine("[hook] IME OFF via focus hwnd=" + (long)target); } catch {} } return; } }
      if (TryImeOff(root)) { if(_diag){ try { Console.WriteLine("[hook] IME OFF via root hwnd=" + (long)root); } catch {} } return; }
      bool done = false;
      try{
        EnumChildWindows(root, (h, l)=>{ if (done) return false; if (TryImeOff(h)) { done = true; if(_diag){ try { Console.WriteLine("[hook] IME OFF via child hwnd=" + (long)h); } catch {} } return false; } return true; }, IntPtr.Zero);
      }catch{}
      if (!done && _diag){ try { Console.WriteLine("[hook] IME context not available"); } catch {} }
    }catch{}
  }
  private static bool TryImeOff(IntPtr hwnd){
    try{
      var hImc = ImmGetContext(hwnd);
      if (hImc != IntPtr.Zero){
        ImmSetOpenStatus(hImc, false);
        ImmReleaseContext(hwnd, hImc);
        return true;
      }
      var imeWnd = ImmGetDefaultIMEWnd(hwnd);
      if (imeWnd != IntPtr.Zero){
        SendMessage(imeWnd, WM_IME_CONTROL, (IntPtr)IMC_SETOPENSTATUS, IntPtr.Zero);
        return true;
      }
    }catch{}
    return false;
  }

  private static bool TryImeOn(IntPtr hwnd){
    try{
      var hImc = ImmGetContext(hwnd);
      if (hImc != IntPtr.Zero){
        ImmSetOpenStatus(hImc, true);
        ImmReleaseContext(hwnd, hImc);
        return true;
      }
      var imeWnd = ImmGetDefaultIMEWnd(hwnd);
      if (imeWnd != IntPtr.Zero){
        SendMessage(imeWnd, WM_IME_CONTROL, (IntPtr)IMC_SETOPENSTATUS, (IntPtr)1);
        return true;
      }
    }catch{}
    return false;
  }

  private static void ForceImeOnWithRetry(){
    try{ ForceImeOnOnce(); }catch{}
    try{
      var th1 = new Thread(()=>{ try{ Thread.Sleep(50); ForceImeOnOnce(); }catch{} }); th1.IsBackground = true; th1.Start();
      var th2 = new Thread(()=>{ try{ Thread.Sleep(120); ForceImeOnOnce(); }catch{} }); th2.IsBackground = true; th2.Start();
    }catch{}
  }

  private static void ForceImeOnOnce(){
    try{
      var root = GetForegroundWindow(); if (root==IntPtr.Zero) { if(_diag){ try { Console.WriteLine("[hook] no foreground window (on)"); } catch {} } return; }
      uint pid; var tid = GetWindowThreadProcessId(root, out pid);
      IntPtr target = IntPtr.Zero;
      try{
        var gti = new GUITHREADINFO(); gti.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(GUITHREADINFO));
        if (GetGUIThreadInfo(tid, ref gti)) { target = gti.hwndFocus; }
      }catch{}
      if (target == IntPtr.Zero){
        uint selfTid = GetCurrentThreadId(); bool attached = false;
        try{ attached = AttachThreadInput(selfTid, tid, true); target = GetFocus(); }catch{} finally{ try{ if (attached) AttachThreadInput(selfTid, tid, false); }catch{} }
      }
      if (target != IntPtr.Zero){ if (TryImeOn(target)) { if(_diag){ try { Console.WriteLine("[hook] IME ON via focus hwnd=" + (long)target); } catch {} } return; } }
      if (TryImeOn(root)) { if(_diag){ try { Console.WriteLine("[hook] IME ON via root hwnd=" + (long)root); } catch {} } return; }
      bool done = false;
      try{
        EnumChildWindows(root, (h, l)=>{ if (done) return false; if (TryImeOn(h)) { done = true; if(_diag){ try { Console.WriteLine("[hook] IME ON via child hwnd=" + (long)h); } catch {} } return false; } return true; }, IntPtr.Zero);
      }catch{}
      if (!done && _diag){ try { Console.WriteLine("[hook] IME context not available (on)"); } catch {} }
    }catch{}
  }
  // Minimal HTTP notify to Nano API: POST /ime with form state=on/off
  private static void NotifyImeState(string st){
    try{
      string u = _imeNotifyBase + "ime";
      var req = System.Net.WebRequest.Create(u);
      req.Method = "POST"; req.ContentType = "application/x-www-form-urlencoded";
      var body = "state=" + Uri.EscapeDataString(st ?? "");
      var bytes = System.Text.Encoding.ASCII.GetBytes(body);
      req.ContentLength = bytes.Length;
      using (var os = req.GetRequestStream()){ os.Write(bytes,0,bytes.Length); }
      using (var resp = req.GetResponse()){}
    }catch{}
  }
}
'@

function Start-WebView2Host([string]$Url){
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
  $iconCandidates = @(Join-Path $here "256x256.png",Join-Path $here "512x512.png",Join-Path $here "1024x1024.png")
  $iconFile = $null; foreach($cand in $iconCandidates){ if (Test-Path $cand){ $iconFile=$cand; break } }
  $iconLiteral = if($iconFile){ '"' + ($iconFile -replace '\\','\\\\') + '"' } else { 'null' }
  $hostCs = Join-Path $here 'SixHostApp.cs'
  if (!(Test-Path $hostCs)){ Write-Host "Missing SixHostApp.cs: $hostCs"; return $false }
  $code = Get-Content -LiteralPath $hostCs -Raw -Encoding UTF8
  $code = $code.Replace('ICON_PATH_PLACEHOLDER', $iconLiteral)
  $refs = @('System.Windows.Forms','System.Drawing', $coreDll, $wfDll)
  try {
    Add-Type -TypeDefinition $code -ReferencedAssemblies $refs -Language CSharp -IgnoreWarnings -ErrorAction Stop
    [SixHostApp]::Run($Url); return $true
  } catch {
    Write-Host "WebView2 host compile failed: $($_.Exception.Message)"; return $false
  }
}

# 1) Try WebView2 host first
# WebView2ホスト経路でもフックを有効化するため、まず現在プロセスPIDで許可し起動
try { [F19EscHookService]::SetAllowPids(@([System.Diagnostics.Process]::GetCurrentProcess().Id)); [F19EscHookService]::SetImeNotifyBase($apiBase); [F19EscHookService]::Start() } catch {}
if ($Diag) { try { [F19EscHookService]::EnableDiag(); Write-Host "[hook] diag request sent" } catch {} }

$launched = Start-WebView2Host -Url $targetUrl
if ($launched) { $global:SixLaunched = $true }
if (-not $launched) {
  # 2) Fallback to Edge app mode
  $edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  if (!(Test-Path $edge)) { $edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe" }
  if (Test-Path $edge) {
    $profileDirBase = ".wv2-profile"
    if ($InstanceTagSan) { $profileDirBase = ".wv2-profile-" + $InstanceTagSan }
    $profileDir = Join-Path $here $profileDirBase
    if ($ResetProfile) { try { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $profileDir } catch {} }
    if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir | Out-Null }
    $args = @("--allow-file-access-from-files","--user-data-dir=$profileDir","--app=$targetUrl")
    if ($DevInsecure) { $args = @("--allow-file-access-from-files","--disable-web-security","--user-data-dir=$profileDir","--app=$targetUrl") }
    $p = Start-Process -FilePath $edge -ArgumentList $args -WorkingDirectory $here -PassThru
    $global:SixLaunched = $true
    # Start/Update F19->Esc hook limited to this Edge instance profile
    # 初期PID集合（親プロセスのみ）。レンダラ/サブプロセスは後続で追加
    try { [F19EscHookService]::SetAllowPids(@($p.Id)); [F19EscHookService]::SetImeNotifyBase($apiBase); [F19EscHookService]::Start() } catch {}
    if ($Diag) { try { [F19EscHookService]::EnableDiag() } catch {} }
    # プロフィールディレクトリ文字列を含む msedge.exe プロセスを数回スキャンして PID を拡張
    try {
      $allow = @($p.Id)
      for($scan=0; $scan -lt 5; $scan++){
        Start-Sleep -Milliseconds (150 + ($scan*50))
        $procs = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) }
        foreach($q in $procs){ if ($allow -notcontains $q.ProcessId){ $allow += $q.ProcessId } }
        try { [F19EscHookService]::SetAllowPids($allow) } catch {}
      }
    } catch {}
    $deadline = (Get-Date).AddMinutes([Math]::Max(1, $WaitMinutes))
    $seenWindow = $false; $lastHadWindow = Get-Date
    while ((Get-Date) -lt $deadline) {
      try {
        $wmi = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
          Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) }
      } catch { $wmi = @() }
      $withWindow = @()
      foreach($pinfo in $wmi){
        try { $gp = Get-Process -Id $pinfo.ProcessId -ErrorAction SilentlyContinue; if ($gp -and $gp.MainWindowHandle -ne 0) { $withWindow += $gp } } catch {}
      }
      if ($withWindow.Count -gt 0) { $seenWindow = $true; $lastHadWindow = Get-Date }
      elseif ($seenWindow) { if ((Get-Date) -gt $lastHadWindow.AddSeconds(1)) { break } }
      else { try { $parent = Get-Process -Id $p.Id -ErrorAction SilentlyContinue } catch { $parent = $null }; if (-not $parent) { break } }
      Start-Sleep -Milliseconds 300
    }
  } else {
    Write-Host "Edge not found. Open $index manually."
  }
}

if ($KeepOpen) { Write-Host 'Press Enter to exit...'; Read-Host | Out-Null }

# Final mutex release fallback (in case events did not fire)
if (-not $AllowMulti) {
  try { if ($global:SixMutex) { $global:SixMutex.ReleaseMutex(); $global:SixMutex.Dispose(); $global:SixMutex = $null } } catch {}
}

# Stop keyboard hook on script end
try { [F19EscHookService]::Stop() } catch {}