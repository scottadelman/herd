# First-time setup for Herd on GitHub.
# Creates the repo under YOUR GitHub account, turns on GitHub Pages, and
# pushes the code. Every step runs on your PC as you: your git name and
# email on the commit, your GitHub login for the push.
#
# Run it by double-clicking setup-github.cmd in the project folder.

$ErrorActionPreference = 'Continue'
$repoName = 'herd'
$description = 'Herd: shared pet care for your household'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Say($text) { Write-Host ''; Write-Host $text -ForegroundColor Cyan }
function Fail($text) { Write-Host ''; Write-Host $text -ForegroundColor Red; exit 1 }

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Require-Tool($command, $wingetId, $label) {
  if (Get-Command $command -ErrorAction SilentlyContinue) { return }
  Say "$label isn't installed on this PC."
  $answer = Read-Host "Install $label now with winget? (y/n)"
  if ($answer -ne 'y') { Fail "Install $label, then run setup-github.cmd again." }
  winget install --id $wingetId -e --source winget --accept-package-agreements --accept-source-agreements
  Refresh-Path
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    Fail "$label is installed. Close this window and double-click setup-github.cmd again."
  }
}

Say 'Checking for Git and the GitHub command line tool...'
Require-Tool 'git' 'Git.Git' 'Git'
Require-Tool 'gh' 'GitHub.cli' 'GitHub CLI'

Say 'Checking your GitHub sign-in...'
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Your browser will open so you can sign in to GitHub.'
  gh auth login --hostname github.com --git-protocol https --web
  if ($LASTEXITCODE -ne 0) { Fail 'GitHub sign-in did not finish. Run setup-github.cmd again to retry.' }
}
gh auth setup-git | Out-Null
$owner = (gh api user --jq .login).Trim()
if (-not $owner) { Fail 'Could not read your GitHub username. Run setup-github.cmd again.' }
Write-Host "Signed in as $owner"

Say 'Checking the name and email on your commits...'
$gitName = git config --global user.name
$gitEmail = git config --global user.email
if (-not $gitName) {
  $gitName = Read-Host 'Your name, as it should appear on commits'
  git config --global user.name $gitName
}
if (-not $gitEmail) {
  $gitEmail = Read-Host 'Your email (use one that is on your GitHub account)'
  git config --global user.email $gitEmail
}
Write-Host "Commits will be signed as $gitName <$gitEmail>"

Say 'Creating the first commit...'
if (-not (Test-Path '.git')) {
  git init -b main | Out-Null
  if ($LASTEXITCODE -ne 0) { git init | Out-Null; git checkout -b main | Out-Null }
}
git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m 'Herd: shared pet care web app' -m 'Households with invites, pets and routines, a shared Today checklist with live sync, activity history, and a demo mode.'
  if ($LASTEXITCODE -ne 0) { Fail 'The commit did not go through. The message above says why.' }
} else {
  Write-Host 'Nothing new to commit.'
}

Say "Creating github.com/$owner/$repoName..."
gh repo view "$owner/$repoName" 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "You already have a repo named $repoName."
  $answer = Read-Host "Push this project to github.com/$owner/$repoName? (y/n)"
  if ($answer -ne 'y') { Fail "Stopped. Rename the repo on GitHub, or change `$repoName at the top of scripts\setup-github.ps1." }
} else {
  # Public, because GitHub Pages is free for public repos. Nothing secret is in the code.
  gh repo create $repoName --public --description $description | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail 'GitHub did not create the repo. The message above says why.' }
}
$remoteUrl = "https://github.com/$owner/$repoName.git"
git remote get-url origin 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { git remote set-url origin $remoteUrl } else { git remote add origin $remoteUrl }

Say 'Turning on GitHub Pages...'
gh api -X POST "repos/$owner/$repoName/pages" -f build_type=workflow 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  gh api -X PUT "repos/$owner/$repoName/pages" -f build_type=workflow 2>$null | Out-Null
}
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Could not turn on Pages automatically. On GitHub: Settings > Pages > Source: GitHub Actions.' -ForegroundColor Yellow
}

Say 'Pushing...'
git push -u origin main
if ($LASTEXITCODE -ne 0) { Fail 'The push did not go through. The message above says why.' }

$site = "https://$($owner.ToLower()).github.io/$repoName/"
Say 'Done.'
Write-Host "Repo:     https://github.com/$owner/$repoName"
Write-Host "Your app: $site  (live in about 2 minutes, once the Actions run turns green)"
Write-Host ''
Write-Host 'Next: follow "Connect the two" in README.md to add your Supabase keys.'
Start-Process "https://github.com/$owner/$repoName/actions"
