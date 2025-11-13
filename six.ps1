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

# Start a minimal loopback HTTP API (TcpListener) for directory listing
# Returns JSON { entries: [ { name, isDir, url } ] }
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

if ($ShowUrl) { Write-Host "Launching URL: $targetUrl" }

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
$launched = Start-WebView2Host -Url $targetUrl
if (-not $launched) {
  # 2) Fallback to Edge app mode
  $edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  if (!(Test-Path $edge)) { $edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe" }
  if (Test-Path $edge) {
    $profileDir = Join-Path $here ".edge-profile"
    if ($ResetProfile) { try { Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $profileDir } catch {} }
    if (-not (Test-Path $profileDir)) { New-Item -ItemType Directory -Path $profileDir | Out-Null }
    $args = @("--allow-file-access-from-files","--user-data-dir=$profileDir","--app=$targetUrl")
    if ($DevInsecure) { $args = @("--allow-file-access-from-files","--disable-web-security","--user-data-dir=$profileDir","--app=$targetUrl") }
    $p = Start-Process -FilePath $edge -ArgumentList $args -WorkingDirectory $here -PassThru
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