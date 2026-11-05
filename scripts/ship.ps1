# Commits everything that changed and pushes it to GitHub, as you.
# GitHub then rebuilds and redeploys the app automatically.
#
# Run it by double-clicking ship.cmd in the project folder. If a file named
# .commit-message is in the folder, its text is used as the commit message
# (it is never committed itself). Otherwise you'll be asked for one.

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path $PSScriptRoot -Parent)
$messageFile = '.commit-message'

if (-not (Test-Path '.git')) {
  Write-Host 'This folder is not on GitHub yet. Double-click setup-github.cmd first.' -ForegroundColor Red
  exit 1
}

$changes = git status --porcelain
if (-not $changes) {
  Write-Host 'Nothing has changed since the last push.'
  exit 0
}

Write-Host 'These files changed:' -ForegroundColor Cyan
git status --short
Write-Host ''

if (Test-Path $messageFile) {
  $message = (Get-Content $messageFile -Raw).Trim()
} else {
  $message = Read-Host 'Describe the change in a few words'
  if (-not $message) { Write-Host 'Stopped: a commit needs a message.' -ForegroundColor Red; exit 1 }
  Set-Content -Path $messageFile -Value $message -NoNewline
}
Write-Host 'Commit message:' -ForegroundColor Cyan
Write-Host $message
Write-Host ''

$answer = Read-Host 'Commit and push these changes? (y/n)'
if ($answer -ne 'y') { Write-Host 'Nothing was committed.'; exit 0 }

git add -A
git commit -F $messageFile
if ($LASTEXITCODE -ne 0) { Write-Host 'The commit did not go through. The message above says why.' -ForegroundColor Red; exit 1 }
Remove-Item $messageFile

git push
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Committed on your PC, but the push did not go through. Run ship.cmd again once you are online.' -ForegroundColor Yellow
  exit 1
}
Write-Host ''
Write-Host 'Pushed. GitHub is rebuilding the app; it updates in about 2 minutes.' -ForegroundColor Green
