# six-webview2 launcher (Edge app mode replacement)
param(
  # Positional arg 0: document to open (even if .html)
  [Parameter(Position=0)]
  [string]$Doc,

  # Positional arg 1 (or -Html): layout HTML (default _six.html)
  [Parameter(Position=1)]
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
$DocRel = $null
if ($Doc) {
  try {
    $docPath = (Resolve-Path $Doc -ErrorAction Stop).Path
  } catch {
    $docPath = $Doc
  }
  # 絶対パス(ドライブ/UNC)は相対化せず file:// URL として渡す
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
  $fileUrl = $null
  try { if ([System.IO.Path]::IsPathRooted($docPath)) { $fileUrl = Convert-ToFileUrl $docPath } } catch {}
  if ($fileUrl) {
    $DocRel = $fileUrl
  } else {
    try {
      $pathType = [System.IO.Path]
      if ($pathType.GetMethod('GetRelativePath')) {
        $DocRel = [System.IO.Path]::GetRelativePath($here, $docPath)
      } else {
        $baseUri = [System.Uri]::new((Join-Path $here ''))
        $docUri  = [System.Uri]::new($docPath)
        $DocRel  = [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($docUri).ToString())
      }
    } catch {
      $DocRel = [System.IO.Path]::GetFileName($docPath)
    }
  }
}

# Build file:/// URL for the layout html
$indexAbs = (Resolve-Path $index).Path
$indexUri = [System.Uri]::new($indexAbs)
if ($DocRel) {
  # 指定ファイルの中身を UTF-8 として読み込み、base64 でフラグメントに埋め込む（小～中規模ファイル想定）
  # If Doc provided: embed UTF-8 content as base64 fragment (small/medium files only)
  $text = $null
  try {
    if ($docPath -and (Test-Path $docPath)) { $text = Get-Content -LiteralPath $docPath -Raw -Encoding UTF8 }
    else { $text = '' } # 存在しない場合は空バッファとして開く
  } catch { $text = $null }

  $qsDoc  = [System.Uri]::EscapeDataString($DocRel)
  $qsName = [System.Uri]::EscapeDataString([System.IO.Path]::GetFileName($docPath))

  $parts = New-Object System.Collections.Generic.List[string]
  $parts.Add("doc=" + $qsDoc)
  $parts.Add("name=" + $qsName)
  if ($null -ne $text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $b64   = [System.Convert]::ToBase64String($bytes)
    $qsData = [System.Uri]::EscapeDataString($b64)
    $parts.Add("data=" + $qsData)
  }
  $frag = [string]::Join('&', $parts)
  $targetUrl = $indexUri.AbsoluteUri + "#" + $frag
} else {
  $targetUrl = $indexUri.AbsoluteUri
}

if ($ShowUrl) { Write-Host "Launching URL: $targetUrl" }

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
    if ($withWindow.Count -gt 0) { $seenWindow = $true; $lastHadWindow = Get-Date }
    elseif ($seenWindow) { if ((Get-Date) -gt $lastHadWindow.AddSeconds(1)) { break } }
    Start-Sleep -Milliseconds 300
  }
} else {
  Write-Host "Edge not found. Open $index manually."
  if ($DocRel) { Write-Host "Then append ?doc=$qsDoc to the file URL." }
}

if ($KeepOpen) { Write-Host 'Press Enter to exit...'; Read-Host | Out-Null }
