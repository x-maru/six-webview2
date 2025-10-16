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
    }
    $DocItems += $item
  }
}

# Build file:/// URL for the layout html
$indexAbs = (Resolve-Path $index).Path
$indexUri = [System.Uri]::new($indexAbs)
if ($DocItems.Count -ge 2) {
  # 複数ドキュメントは bundle=Base64(JSON) で渡す（data は含めない）
  $json = $DocItems | ConvertTo-Json -Depth 2 -Compress
  $b64  = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
  $qsBundle = [System.Uri]::EscapeDataString($b64)
  $targetUrl = $indexUri.AbsoluteUri + "#bundle=" + $qsBundle
} elseif ($DocItems.Count -eq 1) {
  # 互換の単一ドキュメント経路（doc/name/data）
  $one = $DocItems[0]
  $text = $null
  try {
    $resolved = $null
    try { $resolved = (Resolve-Path $one.doc -ErrorAction Stop).Path } catch {}
    $candidate = if ($resolved) { $resolved } else { $one.doc }
    if ($candidate -and (Test-Path $candidate)) { $text = Get-Content -LiteralPath $candidate -Raw -Encoding UTF8 } else { $text = '' }
  } catch { $text = '' }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $b64   = [System.Convert]::ToBase64String($bytes)
  $qsDoc  = [System.Uri]::EscapeDataString($one.doc)
  $qsName = [System.Uri]::EscapeDataString($one.name)
  $qsData = [System.Uri]::EscapeDataString($b64)
  $frag = "doc=$qsDoc&name=$qsName&data=$qsData"
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
