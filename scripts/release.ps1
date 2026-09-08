<#
.SYNOPSIS
  Creates a desktop release commit and vX.Y.Z tag for AINO Platform.
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^\d+\.\d+\.\d+$')]
  [string]$Version
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$packagePath = Join-Path $root "desktop\package.json"
$lockPath = Join-Path $root "desktop\package-lock.json"

if (-not (Test-Path $packagePath)) { throw "Missing $packagePath" }
if (-not (Test-Path $lockPath)) { throw "Missing $lockPath" }
if (git -C $root status --porcelain) { throw "Working tree must be clean before releasing." }

node (Join-Path $PSScriptRoot "set-desktop-version.mjs") $Version
if ($LASTEXITCODE -ne 0) { throw "Failed to update desktop package metadata." }

git -C $root add desktop/package.json desktop/package-lock.json
git -C $root commit -m "release(desktop): v$Version"
git -C $root tag "v$Version"

Write-Host "Created desktop release v$Version. Review it, then push the commit and tag explicitly." -ForegroundColor Green
