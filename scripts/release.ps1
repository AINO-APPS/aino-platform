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

node -e "const fs=require('fs'); for (const p of ['desktop/package.json','desktop/package-lock.json']) { const j=JSON.parse(fs.readFileSync(p,'utf8')); j.version=process.argv[1]; if (j.packages?.['']) j.packages[''].version=process.argv[1]; fs.writeFileSync(p,JSON.stringify(j,null,2)+'\\n'); }" $Version
if ($LASTEXITCODE -ne 0) { throw "Failed to update desktop package metadata." }

git -C $root add desktop/package.json desktop/package-lock.json
git -C $root commit -m "release(desktop): v$Version"
git -C $root tag "v$Version"

Write-Host "Created desktop release v$Version. Review it, then push the commit and tag explicitly." -ForegroundColor Green
