param (
  [Parameter(Mandatory = $true)]
  [string] $Root,

  [int] $Port = 8080,

  [string] $BindAddress = "127.0.0.1"
)

$ErrorActionPreference = "Stop"

$rootPath = [System.IO.Path]::GetFullPath($Root)
$address = [System.Net.IPAddress]::Parse($BindAddress)
$listener = [System.Net.Sockets.TcpListener]::new($address, $Port)

function Get-ContentType {
  param ([string] $Path)

  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { return "text/html; charset=utf-8" }
    ".htm" { return "text/html; charset=utf-8" }
    ".css" { return "text/css; charset=utf-8" }
    ".js" { return "application/javascript; charset=utf-8" }
    ".json" { return "application/json; charset=utf-8" }
    ".md" { return "text/markdown; charset=utf-8" }
    ".txt" { return "text/plain; charset=utf-8" }
    ".svg" { return "image/svg+xml" }
    ".png" { return "image/png" }
    ".jpg" { return "image/jpeg" }
    ".jpeg" { return "image/jpeg" }
    ".gif" { return "image/gif" }
    ".webp" { return "image/webp" }
    default { return "application/octet-stream" }
  }
}

function Write-Response {
  param (
    [System.IO.Stream] $Stream,
    [int] $StatusCode,
    [string] $Reason,
    [byte[]] $Body,
    [string] $ContentType = "text/plain; charset=utf-8"
  )

  $header = "HTTP/1.1 $StatusCode $Reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

function Write-TextResponse {
  param (
    [System.IO.Stream] $Stream,
    [int] $StatusCode,
    [string] $Reason,
    [string] $Text
  )

  $body = [System.Text.Encoding]::UTF8.GetBytes($Text)
  Write-Response -Stream $Stream -StatusCode $StatusCode -Reason $Reason -Body $body
}

function Resolve-RequestPath {
  param ([string] $Target)

  $pathOnly = ($Target -split "\?", 2)[0]
  if ([string]::IsNullOrWhiteSpace($pathOnly) -or $pathOnly -eq "/") {
    $pathOnly = "/browser/"
  }

  $decoded = [System.Uri]::UnescapeDataString($pathOnly)
  $relative = $decoded.TrimStart("/").Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $rootPath $relative))

  if (-not $candidate.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }

  if ([System.IO.Directory]::Exists($candidate)) {
    $candidate = Join-Path $candidate "index.html"
  }

  return $candidate
}

try {
  $listener.Start()

  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq "") {
          break
        }
      }

      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        Write-TextResponse -Stream $stream -StatusCode 400 -Reason "Bad Request" -Text "Bad Request"
        continue
      }

      $parts = $requestLine.Split(" ")
      if ($parts.Length -lt 2 -or $parts[0] -ne "GET") {
        Write-TextResponse -Stream $stream -StatusCode 405 -Reason "Method Not Allowed" -Text "Method Not Allowed"
        continue
      }

      $filePath = Resolve-RequestPath -Target $parts[1]
      if (-not $filePath) {
        Write-TextResponse -Stream $stream -StatusCode 403 -Reason "Forbidden" -Text "Forbidden"
        continue
      }

      if (-not [System.IO.File]::Exists($filePath)) {
        Write-TextResponse -Stream $stream -StatusCode 404 -Reason "Not Found" -Text "Not Found"
        continue
      }

      $body = [System.IO.File]::ReadAllBytes($filePath)
      Write-Response -Stream $stream -StatusCode 200 -Reason "OK" -Body $body -ContentType (Get-ContentType -Path $filePath)
    } catch {
      try {
        Write-TextResponse -Stream $stream -StatusCode 500 -Reason "Internal Server Error" -Text "Internal Server Error"
      } catch {
      }
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
