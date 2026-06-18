# Usage: .\scripts\deploy-migration.ps1 035_my_migration.sql
# Applies a single migration file to the linked Supabase project.

param(
  [Parameter(Mandatory=$true)]
  [string]$File
)

$path = "supabase/migrations/$File"
if (-not (Test-Path $path)) {
  Write-Error "Migration file not found: $path"
  exit 1
}

Write-Host "Applying $path..."
npx supabase db query --linked --file $path
Write-Host "Done."
