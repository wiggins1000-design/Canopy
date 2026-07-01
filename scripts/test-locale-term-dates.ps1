# test-locale-term-dates.ps1
# Fetches real school URLs from AU, IE, and US education directories
# then invokes the check-term-dates edge function to test locale-aware scraping.
#
# Usage:
#   .\scripts\test-locale-term-dates.ps1 -WebhookToken "YOUR_TOKEN"
#   .\scripts\test-locale-term-dates.ps1 -WebhookToken "YOUR_TOKEN" -Market AU -Count 5
#
# Markets: AU, IE, US, ALL (default)

param(
    [Parameter(Mandatory=$true)] [string]$WebhookToken,
    [string]$Market = "ALL",
    [int]$Count = 3
)

$FunctionUrl = "https://zhxuegizpmukynifstuu.supabase.co/functions/v1/check-term-dates"

# -----------------------------------------------------------------------
# Verified seed URLs (fallbacks when dynamic discovery finds nothing)
# -----------------------------------------------------------------------

# Verified 2026-07-01 — all .edu.au / .eq.edu.au / .vic.edu.au TLDs
$AU_SEEDS = @(
    'https://www.mhs.vic.edu.au',          # Melbourne High School
    'https://www.brisbaneshs.eq.edu.au',   # Brisbane State High School
    'https://www.indooroopillyss.eq.edu.au' # Indooroopilly State School (fallback)
)

# Verified 2026-07-01 — all .ie TLDs
$IE_SEEDS = @(
    'https://www.gonzaga.ie',         # Gonzaga College, Dublin (Jesuit)
    'https://www.rockwellcollege.ie', # Rockwell College, Tipperary
    'https://www.stcolumbas.ie'       # St Columba's College, Dublin
)

# Verified 2026-07-01 — locale passed explicitly for US (.edu / .org TLDs)
$US_SEEDS = @(
    'https://www.pisd.edu',       # Plano ISD, Texas
    'https://www.friscoisd.org',  # Frisco ISD, Texas
    'https://www.roundrockisd.org' # Round Rock ISD, Texas
)

# -----------------------------------------------------------------------
# School URL discovery (best-effort; seeds used if insufficient results)
# -----------------------------------------------------------------------

function Get-AustralianSchoolUrls([int]$Count = 3) {
    Write-Host ""
    Write-Host "[AU] Discovering school URLs..." -ForegroundColor Cyan
    $urls = @()

    # Try QLD Schools Directory basic search (server-rendered page)
    try {
        $page = Invoke-WebRequest -Uri "https://schoolsdirectory.eq.edu.au/BasicSearch?schoolType=2" -UseBasicParsing -TimeoutSec 15
        $ids = [regex]::Matches($page.Content, 'href="/Details/(\d+)"') |
               ForEach-Object { $_.Groups[1].Value } |
               Select-Object -Unique -First 20

        foreach ($id in $ids) {
            if ($urls.Count -ge $Count) { break }
            try {
                $detail = Invoke-WebRequest -Uri "https://schoolsdirectory.eq.edu.au/Details/$id" -UseBasicParsing -TimeoutSec 10
                $m = [regex]::Match($detail.Content, 'href="(https?://[^"]+\.(?:edu\.au|eq\.edu\.au|com\.au)[^"]*)"')
                if ($m.Success) {
                    $u = $m.Groups[1].Value -replace '/$',''
                    if ($u -notmatch 'schoolsdirectory|education\.qld\.gov|eq\.gov\.au') {
                        Write-Host "  Found: $u" -ForegroundColor Green
                        $urls += $u
                    }
                }
            } catch { }
        }
    } catch {
        Write-Host "  [AU] Dynamic discovery failed, using seeds." -ForegroundColor DarkYellow
    }

    # Fill remaining slots from verified seeds
    foreach ($u in $AU_SEEDS) {
        if ($urls.Count -ge $Count) { break }
        if ($urls -notcontains $u) {
            Write-Host "  Seed: $u" -ForegroundColor Yellow
            $urls += $u
        }
    }

    return $urls
}

function Get-IrishSchoolUrls([int]$Count = 3) {
    Write-Host ""
    Write-Host "[IE] Discovering school URLs..." -ForegroundColor Cyan
    $urls = @()

    # Try education.ie school list page
    try {
        $list = Invoke-WebRequest `
            -Uri "https://www.education.ie/en/Find-a-School/School-List/?level=Post-Primary" `
            -UseBasicParsing -TimeoutSec 15

        $paths = [regex]::Matches($list.Content, 'href="(/en/Find-a-School/School-Details/[^"]+)"') |
                 ForEach-Object { $_.Groups[1].Value } |
                 Select-Object -Unique -First 20

        foreach ($path in $paths) {
            if ($urls.Count -ge $Count) { break }
            try {
                $schoolPage = Invoke-WebRequest -Uri "https://www.education.ie$path" -UseBasicParsing -TimeoutSec 10
                $m = [regex]::Match($schoolPage.Content, 'href="(https?://(?!www\.education\.ie|www\.gov\.ie)[^"]+\.ie(?:/[^"]*)?)"')
                if ($m.Success) {
                    $u = $m.Groups[1].Value -replace '/$',''
                    if ($urls -notcontains $u) {
                        Write-Host "  Found: $u" -ForegroundColor Green
                        $urls += $u
                    }
                }
            } catch { }
        }
    } catch {
        Write-Host "  [IE] Dynamic discovery failed, using seeds." -ForegroundColor DarkYellow
    }

    # Fill remaining slots from verified seeds
    foreach ($u in $IE_SEEDS) {
        if ($urls.Count -ge $Count) { break }
        if ($urls -notcontains $u) {
            Write-Host "  Seed: $u" -ForegroundColor Yellow
            $urls += $u
        }
    }

    return $urls
}

function Get-USSchoolUrls([int]$Count = 3) {
    Write-Host ""
    Write-Host "[US] Discovering school URLs via Urban Institute API..." -ForegroundColor Cyan
    $urls = @()

    try {
        $page = 1
        while ($urls.Count -lt $Count -and $page -le 5) {
            $apiUrl = "https://educationdata.urban.org/api/v1/schools/ccd/directory/2022/" +
                      "?state_mailing=TX&school_level=3&per_page=100&page=$page"
            $resp = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 20

            $withUrl = $resp.results | Where-Object { $_.website_url -and $_.website_url -match '^https?://' }
            foreach ($school in $withUrl) {
                if ($urls.Count -ge $Count) { break }
                $u = $school.website_url -replace '/$',''
                Write-Host "  Found: $u ($($school.school_name))" -ForegroundColor Green
                $urls += $u
            }

            if (-not $resp.next) { break }
            $page++
        }
    } catch {
        Write-Host "  [US] Urban Institute API unavailable, using seeds." -ForegroundColor DarkYellow
    }

    # Fill remaining slots from verified seeds
    foreach ($u in $US_SEEDS) {
        if ($urls.Count -ge $Count) { break }
        if ($urls -notcontains $u) {
            Write-Host "  Seed: $u" -ForegroundColor Yellow
            $urls += $u
        }
    }

    return $urls
}

# -----------------------------------------------------------------------
# Edge function invocation
# -----------------------------------------------------------------------

function Invoke-TermDatesTest([string]$Market, [string[]]$Urls, [string]$Locale = "") {
    if ($Urls.Count -eq 0) {
        Write-Warning "[$Market] No school URLs found -- skipping."
        return
    }

    Write-Host ""
    Write-Host "[$Market] Invoking check-term-dates with $($Urls.Count) school(s)..." -ForegroundColor Yellow

    $bodyObj = @{ test_urls = $Urls }
    if ($Locale -ne "") { $bodyObj.locale = $Locale }

    try {
        $response = Invoke-RestMethod `
            -Uri $FunctionUrl `
            -Method POST `
            -Headers @{
                "x-webhook-token" = $WebhookToken
                "Content-Type"    = "application/json"
            } `
            -Body ($bodyObj | ConvertTo-Json -Compress) `
            -TimeoutSec 120

        foreach ($result in $response.results) {
            $url    = if ($result.url)        { $result.url }        else { "(unknown)" }
            $status = if ($result.status)     { $result.status }     else { "unknown" }
            $dates  = if ($result.totalDates) { $result.totalDates } elseif ($result.eventsAdded) { $result.eventsAdded } else { "?" }
            $color  = if ($status -eq "ok") { "Green" } elseif ($status -eq "unchanged") { "Cyan" } else { "Red" }
            Write-Host "  [$status] $url - $dates event(s)" -ForegroundColor $color
            if ($result.error) { Write-Host "    Error: $($result.error)" -ForegroundColor Red }
        }
    } catch {
        Write-Error "[$Market] Function invoke failed: $_"
    }
}

# -----------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------

$markets = if ($Market -eq "ALL") { @("AU","IE","US") } else { @($Market.ToUpper()) }

foreach ($m in $markets) {
    if ($m -eq "AU") {
        $schoolUrls = Get-AustralianSchoolUrls -Count $Count
        Invoke-TermDatesTest -Market "AU" -Urls $schoolUrls
        # locale inferred from .edu.au / .eq.edu.au TLD
    }
    if ($m -eq "IE") {
        $schoolUrls = Get-IrishSchoolUrls -Count $Count
        Invoke-TermDatesTest -Market "IE" -Urls $schoolUrls
        # locale inferred from .ie TLD
    }
    if ($m -eq "US") {
        $schoolUrls = Get-USSchoolUrls -Count $Count
        Invoke-TermDatesTest -Market "US" -Urls $schoolUrls -Locale "en-US"
        # .com/.org TLDs are ambiguous -- locale passed explicitly
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor White
