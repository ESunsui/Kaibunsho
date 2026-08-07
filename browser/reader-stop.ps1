$ErrorActionPreference = "Stop"

$port = 8080
$pidFile = Join-Path $PSScriptRoot ".reader-server.pid"

function Show-ReaderMessage {
  param (
    [string] $Message,
    [string] $Icon = "Information"
  )

  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($Message, "Kaibunsho Reader", "OK", $Icon) | Out-Null
}

try {
  $candidateProcessIds = @()

  if (Test-Path -LiteralPath $pidFile) {
    $storedProcessId = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($storedProcessId -match "^\d+$") {
      $candidateProcessIds += [int] $storedProcessId
    }
  }

  $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($connections) {
    $candidateProcessIds += $connections.OwningProcess
  }

  $candidateProcessIds = $candidateProcessIds | Sort-Object -Unique
  $stopped = $false

  foreach ($processId in $candidateProcessIds) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    if (-not $processInfo -or ($processInfo.CommandLine -notmatch "reader-server\.ps1" -and $processInfo.CommandLine -notmatch "http\.server")) {
      continue
    }

    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    $stopped = $true
  }

  if (Test-Path -LiteralPath $pidFile) {
    Remove-Item -LiteralPath $pidFile -Force
  }

  if ($stopped) {
    Show-ReaderMessage "Reader server has been stopped."
  } else {
    Show-ReaderMessage "No reader server was found."
  }
} catch {
  Show-ReaderMessage $_.Exception.Message "Error"
}
