$ErrorActionPreference = "Stop"

$bindAddress = "127.0.0.1"
$port = 8080
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pidFile = Join-Path $PSScriptRoot ".reader-server.pid"
$serverScript = Join-Path $PSScriptRoot "reader-server.ps1"
$url = "http://${bindAddress}:$port/browser/"

function Test-ReaderPort {
  param (
    [string] $Address,
    [int] $Port
  )

  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.BeginConnect($Address, $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(250, $false)) {
      return $false
    }

    $client.EndConnect($connect)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Show-ReaderError {
  param ([string] $Message)

  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($Message, "Kaibunsho Reader", "OK", "Error") | Out-Null
}

try {
  if (-not (Test-ReaderPort -Address $bindAddress -Port $port)) {
    if (-not (Test-Path -LiteralPath $serverScript)) {
      throw "Reader server script was not found."
    }

    $arguments = @(
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      $serverScript,
      "-Root",
      $root,
      "-Port",
      [string] $port,
      "-BindAddress",
      $bindAddress
    )
    $serverProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $pidFile -Value $serverProcess.Id -Encoding ASCII

    $started = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 150
      if (Test-ReaderPort -Address $bindAddress -Port $port) {
        $started = $true
        break
      }
    }

    if (-not $started) {
      throw "Reader server startup timed out."
    }
  }

  Start-Process $url
} catch {
  Show-ReaderError $_.Exception.Message
}
