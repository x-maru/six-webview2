<#
  Minimal smoke test for the Nano API (/ping, /dir, /read)
  - Compiles _six.cs with a unique class name and starts the API
  - Does NOT launch Edge or source six.ps1
#>
param(
  [string]$TestDir = $PWD.Path,
  [string]$TestFile = $null
)

$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$cs    = Join-Path $here '_six.cs'
if (-not (Test-Path $cs)) { Write-Error "_six.cs not found"; exit 1 }

# Prepare unique class and compile
$className = "NanoApi_" + ([Guid]::NewGuid().ToString('N').Substring(0,8))
$code = Get-Content -LiteralPath $cs -Raw -Encoding UTF8
$code = $code.Replace('__CLASSNAME__', $className)
Add-Type -TypeDefinition $code -Language CSharp -IgnoreWarnings -ErrorAction Stop

# Start API
$port = Get-Random -Minimum 20000 -Maximum 60000
$nano = New-Object $className $port
$nano.Start()
# give the background thread a brief moment before first probe
Start-Sleep -Milliseconds 300
$base = "http://127.0.0.1:$port/"

# HTTP クライアント実装（環境に応じて選択）
$script:UseHttpClient = $false
try {
  # PowerShell 5.1 などで必要な場合がある
  if (-not ("System.Net.Http.HttpClient" -as [type])) { Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue | Out-Null }
  if ("System.Net.Http.HttpClient" -as [type]) { $script:UseHttpClient = $true }
} catch { $script:UseHttpClient = $false }

$script:hc = $null
if ($script:UseHttpClient) {
  try {
    $handler = New-Object System.Net.Http.HttpClientHandler
    try { $handler.UseProxy = $false } catch {}
    try { $handler.Proxy = $null } catch {}
    $script:hc = [System.Net.Http.HttpClient]::new($handler)
    $script:hc.Timeout = [TimeSpan]::FromMilliseconds(2500)
  } catch { $script:UseHttpClient = $false }
}

function Invoke-Get($url){
  if ($script:UseHttpClient -and $script:hc) {
    try {
      $r = $script:hc.GetAsync($url).GetAwaiter().GetResult()
      if (-not $r) { return $null }
      return [pscustomobject]@{ Status = [int]$r.StatusCode; Text = $r.Content.ReadAsStringAsync().GetAwaiter().GetResult() }
    } catch { return $null }
  }
  # フォールバック: System.Net.WebRequest
  try {
    $req = [System.Net.WebRequest]::Create($url)
    try { $req.Proxy = $null } catch {}
    try { $req.Timeout = 2500 } catch {}
    try { $req.ReadWriteTimeout = 2500 } catch {}
    $resp = $req.GetResponse()
    $hs = $null
    try { $hs = [int]([System.Net.HttpWebResponse]$resp).StatusCode } catch { $hs = 200 }
    $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $txt = $sr.ReadToEnd()
    try { $resp.Close() } catch {}
    return [pscustomobject]@{ Status = $hs; Text = $txt }
  } catch { return $null }
}

# Wait for /ping (up to ~10s)
$ok = $false; for($i=0;$i -lt 30;$i++){ $resp = Invoke-Get ($base+"ping"); if($resp -and $resp.Status -eq 200 -and $resp.Text -eq 'ok'){ $ok=$true; break }; Start-Sleep -Milliseconds 330 }
if(-not $ok){ Write-Error "Nano API didn't respond to /ping"; exit 2 }
Write-Host "/ping OK"

# Test /dir with fs=
$dirUrl = $base + "dir?fs=" + [Uri]::EscapeDataString($TestDir)
$dirResp = Invoke-Get $dirUrl
if(-not $dirResp -or $dirResp.Status -ne 200){ Write-Error "/dir failed: $($dirResp | ConvertTo-Json -Compress)"; exit 3 }
Write-Host "/dir OK (fs=)"

# Optionally test /read
if ($TestFile) {
  $tf = $TestFile
  try { if (-not (Test-Path $tf)) { $tf = Join-Path $TestDir $TestFile } } catch {}
  $readUrl = $base + "read?fs=" + [Uri]::EscapeDataString($tf)
  $readResp = Invoke-Get $readUrl
  if (-not $readResp -or $readResp.Status -ne 200) { Write-Error "/read failed"; exit 4 }
  if (-not $readResp.Text) { Write-Warning "/read returned empty text (may be expected if file empty)" } else { Write-Host "/read OK (len=" + $readResp.Text.Length + ")" }
}

Write-Host "All tests passed."
