# test-locale-term-dates.ps1
# Fetches real school URLs from AU, IE, US, and NZ education directories/seed lists
# then invokes the check-term-dates edge function to test locale-aware scraping.
#
# Usage:
#   .\scripts\test-locale-term-dates.ps1 -WebhookToken "YOUR_TOKEN"
#   .\scripts\test-locale-term-dates.ps1 -WebhookToken "YOUR_TOKEN" -Market AU -Count 50
#
# Markets: AU, IE, US, NZ, ALL (default)

param(
    [Parameter(Mandatory=$true)] [string]$WebhookToken,
    [string]$Market = "ALL",
    [int]$Count = 10
)

$FunctionUrl = "https://zhxuegizpmukynifstuu.supabase.co/functions/v1/check-term-dates"

# -----------------------------------------------------------------------
# Verified seed URLs (fallbacks when dynamic discovery finds nothing)
# Verified 2026-07-01/02
# -----------------------------------------------------------------------

$AU_SEEDS = @(
    # VIC government
    'https://www.mhs.vic.edu.au',              # Melbourne High School
    'https://www.fhs.vic.edu.au',              # Frankston High School

    # VIC independent
    'https://www.caulfieldgs.vic.edu.au',      # Caulfield Grammar School
    'https://www.sirius.vic.edu.au',           # Sirius College (multicampus)
    'https://www.stkevins.vic.edu.au',         # St Kevin's College, Toorak
    'https://www.mgs.vic.edu.au',              # Melbourne Grammar School
    'https://www.xavier.vic.edu.au',           # Xavier College
    'https://www.ggs.vic.edu.au',              # Geelong Grammar School
    'https://www.trinity.vic.edu.au',          # Trinity Grammar School, Kew
    'https://www.haileybury.com.au',           # Haileybury College
    'https://www.overnewton.vic.edu.au',       # Overnewton Anglican Community College
    'https://sfx.vic.edu.au',                  # St Francis Xavier College
    'https://www.bmg.vic.edu.au',              # Bacchus Marsh Grammar
    'https://www.marcellin.vic.edu.au',        # Marcellin College, Bulleen
    'https://www.pegs.vic.edu.au',             # Penleigh & Essendon Grammar School
    'https://www.scopus.vic.edu.au',           # Mount Scopus Memorial College
    'https://www.elthamcollege.vic.edu.au',    # Eltham College
    'https://www.carey.com.au',                # Carey Baptist Grammar School

    # VIC — remaining guesses (schools whose real domain wasn't independently verified)
    'https://www.assumption.vic.edu.au',       # Assumption College
    'https://www.salesian.vic.edu.au',         # Salesian College Chadstone
    'https://www.stmarys.vic.edu.au',          # St Mary's College
    'https://www.scc.vic.edu.au',              # Strathcona Baptist Girls' Grammar

    # QLD government (.eq.edu.au) — remaining guesses
    'https://www.brisbaneshs.eq.edu.au',       # Brisbane State High School
    'https://www.indooroopillyss.eq.edu.au',   # Indooroopilly State School

    # Verified 2026-07-08 via web search — replacing dead domains that never resolved
    # (same "wrong guessed domain" pattern as the 2026-07-05 batch below, not real
    # site-blocking). One entry (Aldersyde State School) was dropped outright — no
    # evidence a Queensland school by that name exists at all, likely a phantom guess
    # from the original seed list, same as Twyford's dead domain — see [[term_dates_pipeline]].
    'https://www.sosc.vic.edu.au',              # South Oakleigh College (was sths.vic.edu.au, dead)
    'https://fernygroveshs.eq.edu.au',          # Ferny Grove State High School (was fernygrove.eq.edu.au, dead)
    'https://parramattass.eq.edu.au',           # Parramatta State School, Cairns (was parmia.eq.edu.au, dead)
    'https://www.mta.qld.edu.au',               # Mount Alvernia College (was mtasc.eq.edu.au, dead — it's Catholic independent, not .eq.edu.au)
    'https://www.stambrosesschool.qld.edu.au',  # St Ambrose's Catholic Primary, Newmarket (was ambrose.eq.edu.au, dead — also Catholic, not .eq.edu.au)

    # NSW — remaining guesses
    'https://www.newington.nsw.edu.au',        # Newington College
    'https://www.abbotsleigh.nsw.edu.au',      # Abbotsleigh
    'https://www.hillsgrammar.nsw.edu.au',     # Hills Grammar School
    'https://www.knox.nsw.edu.au',             # Knox Grammar School
    'https://www.shore.nsw.edu.au',            # Sydney Church of England Grammar
    'https://www.barker.nsw.edu.au',           # Barker College
    'https://www.kambala.nsw.edu.au',          # Kambala
    'https://www.sceggs.nsw.edu.au',           # SCEGGS Darlinghurst
    'https://www.queenwood.nsw.edu.au',        # Queenwood School for Girls
    'https://www.tara.nsw.edu.au',             # Tara Anglican School for Girls
    'https://www.ravenswood.nsw.edu.au',       # Ravenswood School for Girls
    'https://www.sbhs.nsw.edu.au',              # Sydney Boys High School (government)

    # Verified 2026-07-05 via web search — these replace guessed domains that turned out
    # to be dead (never resolved, not a school that went offline). Same finding as IE:
    # most "site blocking" in the original guessed list was actually wrong domains.
    'https://www.ivanhoe.com.au',               # Ivanhoe Grammar School (was ivanhoe.vic.edu.au)
    'https://www.ssc.nsw.edu.au',               # Santa Sabina College (was sac.nsw.edu.au)
    'https://www.tlsc.vic.edu.au',              # Taylors Lakes Secondary College (was taylors.vic.edu.au)
    'https://kelvingrovesc.eq.edu.au',          # Kelvin Grove State College (was kelvingrove.eq.edu.au)
    'https://www.pymblelc.nsw.edu.au',          # Pymble Ladies' College (was pems.nsw.edu.au)
    'https://www.trinity.nsw.edu.au',           # Trinity Grammar School, Summer Hill (was tgs.nsw.edu.au)
    'https://starmelb.catholic.edu.au',         # Star of the Sea College (was smc.vic.edu.au)
    'https://www.domremy.catholic.edu.au'       # Domremy College (was domremy.nsw.edu.au; site blocks — kept for reference)
)

$IE_SEEDS = @(
    # Well-known Dublin independent schools
    'https://www.gonzaga.ie',                  # Gonzaga College (Jesuit)
    'https://www.stcolumbas.ie',               # St Columba's College
    'https://highcrosscollege.ie',             # High Cross College, Tuam
    'https://cbckilkenny.ie',                  # CBC Kilkenny
    'https://www.malahidecs.ie',               # Malahide Community School
    'https://www.kingshospital.ie',            # The King's Hospital
    'https://www.mountanville.ie',             # Mount Anville Secondary School
    'https://www.clongowes.net',               # Clongowes Wood College SJ
    'https://www.terenurecollege.ie',          # Terenure College
    'https://www.rockwellcollege.ie',          # Rockwell College, Tipperary
    'https://www.alexandracollege.ie',         # Alexandra College
    'https://www.colaisteiognaid.ie',          # Colaiste Iognaid, Galway
    'https://www.stgerards.ie',                # St Gerard's School, Bray
    'https://www.rathdownschool.ie',           # Rathdown School
    'https://www.cbscarlow.ie',                # CBS Carlow

    # Verified 2026-07-05 via web search (replacing dead/guessed domains removed the
    # same day — see [[au_term_dates_work]]: 23/26 of the previous list's
    # "homepage_fetch_failed" schools turned out to be non-resolving DNS, not actual
    # site-blocking. Some of these are legitimately .com/.net, not .ie — the IE test
    # invocation below now passes -Locale "en-IE" explicitly so TLD detection doesn't
    # matter.)
    'https://www.blackrockcollege.com',        # Blackrock College, Dublin
    'https://www.stmc.ie',                     # St Michael's College, Dublin
    'https://www.pbc-cork.ie',                 # Presentation Brothers College, Cork
    'https://www.wesleycollege.ie',            # Wesley College, Dublin
    'https://www.crescentsj.com',              # Crescent College Comprehensive SJ, Limerick
    'https://www.ardscoil.com',                # Ard Scoil Rís, Limerick
    'https://www.shswestport.ie',              # Sacred Heart School, Westport
    'https://www.colaistechoilm.ie',           # Coláiste Choilm, Cork
    'https://belvederecollege.ie'               # Belvedere College SJ, Dublin — verified 2026-07-05, was belvedere-college.ie (dead, missing hyphen)
)

$NZ_SEEDS = @(
    # Verified 2026-07-05 via web search (data.govt.nz's own Schools Directory API is
    # itself behind Imperva bot-protection from this environment, so dynamic discovery
    # isn't attempted for NZ -- straight to a manually verified seed list, same as the
    # IE/AU fallback lists)
    'https://www.ags.school.nz',                 # Auckland Grammar School
    'https://www.cbhs.school.nz',                # Christchurch Boys' High School
    'https://www.wellington-college.school.nz',  # Wellington College
    'https://stcuthberts.school.nz',              # St Cuthbert's College, Epsom
    'https://www.rangitoto.school.nz',           # Rangitoto College, Auckland
    'https://www.hbhs.school.nz',                # Hamilton Boys' High School
    'https://www.scotscollege.school.nz',        # Scots College, Wellington
    'https://www.stac.school.nz',                # St Andrew's College, Christchurch
    'https://www.eggs.school.nz',                # Epsom Girls Grammar School
    'https://www.diocesan.school.nz',            # Diocesan School for Girls, Auckland
    'https://www.macleans.school.nz',            # Macleans College, Auckland
    'https://www.otagogirls.school.nz',          # Otago Girls' High School, Dunedin
    'https://lphs.school.nz'                     # Logan Park High School, Dunedin
)

$US_SEEDS = @(
    # Texas (large suburban ISDs — well-maintained websites)
    'https://www.pisd.edu',                    # Plano ISD
    'https://www.friscoisd.org',               # Frisco ISD
    'https://www.roundrockisd.org',            # Round Rock ISD
    'https://www.austinisd.org',               # Austin ISD
    'https://www.kleinisd.net',                # Klein ISD
    'https://www.aisd.net',                    # Arlington ISD
    'https://www.leanderisd.org',              # Leander ISD
    'https://www.springisd.org',               # Spring ISD
    'https://www.houstonisd.org',              # Houston ISD
    'https://www.saisd.net',                   # San Antonio ISD
    'https://www.cfisd.net',                   # Cypress-Fairbanks ISD
    'https://www.aldineisd.org',                # Aldine ISD — verified 2026-07-05, was aldine.k12.tx.us (dead)
    'https://www.nbisd.org',                   # New Braunfels ISD
    'https://www.wylieisd.net',                # Wylie ISD
    'https://www.lisd.net',                    # Lewisville ISD
    'https://www.gcisd.net',                   # Grapevine-Colleyville ISD
    'https://www.mansfieldisd.org',            # Mansfield ISD
    'https://www.fortbendisd.com',             # Fort Bend ISD
    'https://www.pearlandisd.org',             # Pearland ISD
    'https://www.ccisd.net',                   # Clear Creek ISD

    # Large US districts outside Texas
    'https://www.cps.edu',                     # Chicago Public Schools
    'https://www.bcps.org',                    # Baltimore County Public Schools
    'https://www.seattleschools.org',          # Seattle Public Schools
    'https://www.pgcps.org',                   # Prince George's County PS
    'https://www.sfusd.edu',                   # San Francisco USD
    'https://www.tusd1.org',                   # Tucson USD
    'https://www.mpsaz.org',                   # Mesa Public Schools, AZ
    'https://www.pvschools.net',               # Paradise Valley USD, AZ
    'https://www.gilbertschools.net',          # Gilbert USD, AZ
    'https://www.cusd80.com',                  # Chandler USD, AZ
    'https://www.bhusd.org',                   # Beverly Hills USD, CA
    'https://www.smmusd.org',                  # Santa Monica-Malibu USD, CA
    'https://www.conejousd.org',               # Conejo Valley USD, CA
    'https://carlsbadusd.net',                  # Carlsbad USD, CA — verified 2026-07-05, was cosd.us (dead)
    'https://www.powayusd.com',                # Poway USD, CA
    'https://www.dmusd.org',                   # Del Mar USD, CA
    'https://www.svusd.org',                   # Saddleback Valley USD, CA
    'https://www.iusd.org',                    # Irvine USD, CA
    'https://www.capousd.org',                 # Capistrano USD, CA
    'https://www.sausd.us',                    # Santa Ana USD, CA
    'https://www.aacps.org',                   # Anne Arundel County PS, MD
    'https://www.montgomeryschoolsmd.org',       # Montgomery County PS, MD — verified 2026-07-05, was mcpsmd.net (dead)
    'https://www.fcps.edu',                    # Fairfax County PS, VA
    'https://www.lcps.org',                    # Loudoun County PS, VA
    'https://www.pwcs.edu',                    # Prince William County PS, VA
    'https://www.henricoschools.us',             # Henrico County PS, VA — verified 2026-07-05, was henrico.k12.va.us (dead)
    'https://oneccps.org',                      # Chesterfield County PS, VA — verified 2026-07-05, was chesterfield.k12.va.us (dead)
    'https://www.rockingham.k12.va.us',        # Rockingham County PS, VA
    'https://www.jordandistrict.org',          # Jordan School District, UT
    'https://www.alpinedistrict.org'           # Alpine School District, UT
)

# -----------------------------------------------------------------------
# School URL discovery (best-effort; seeds used if insufficient results)
# -----------------------------------------------------------------------

function Get-AustralianSchoolUrls([int]$Count = 10) {
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

function Get-IrishSchoolUrls([int]$Count = 10) {
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

function Get-NZSchoolUrls([int]$Count = 10) {
    Write-Host ""
    Write-Host "[NZ] Using verified seed list (data.govt.nz Schools Directory API is bot-blocked from here)..." -ForegroundColor Cyan
    $urls = @()
    foreach ($u in $NZ_SEEDS) {
        if ($urls.Count -ge $Count) { break }
        Write-Host "  Seed: $u" -ForegroundColor Yellow
        $urls += $u
    }
    return $urls
}

function Get-USSchoolUrls([int]$Count = 10) {
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

    # Chunked client-side: one big request for 50 schools exceeds the edge function's
    # execution time budget (each school can now involve native PDF extraction / large
    # page fetches). Smaller chunks each get their own fresh time budget.
    $chunkSize = 5
    $chunks = for ($i = 0; $i -lt $Urls.Count; $i += $chunkSize) { , $Urls[$i..[Math]::Min($i + $chunkSize - 1, $Urls.Count - 1)] }

    Write-Host ""
    Write-Host "[$Market] Invoking check-term-dates with $($Urls.Count) school(s) in $($chunks.Count) chunk(s) of up to $chunkSize..." -ForegroundColor Yellow

    foreach ($chunk in $chunks) {
        $bodyObj = @{ test_urls = $chunk }
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
                -TimeoutSec 300

            foreach ($result in $response.results) {
                $url    = if ($result.url)        { $result.url }        else { "(unknown)" }
                $status = if ($result.status)     { $result.status }     else { "unknown" }
                $dates  = if ($result.totalDates) { $result.totalDates } elseif ($result.eventsAdded) { $result.eventsAdded } else { "?" }
                $color  = if ($status -eq "ok") { "Green" } elseif ($status -eq "unchanged") { "Cyan" } else { "Red" }
                Write-Host "  [$status] $url - $dates event(s)" -ForegroundColor $color
                if ($result.error) { Write-Host "    Error: $($result.error)" -ForegroundColor Red }
            }
        } catch {
            Write-Error "[$Market] Chunk invoke failed: $_"
        }
    }
}

# -----------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------

$markets = if ($Market -eq "ALL") { @("AU","IE","US","NZ") } else { @($Market.ToUpper()) }

foreach ($m in $markets) {
    if ($m -eq "AU") {
        $schoolUrls = Get-AustralianSchoolUrls -Count $Count
        Invoke-TermDatesTest -Market "AU" -Urls $schoolUrls
        # locale inferred from .edu.au / .eq.edu.au / .com.au TLD
    }
    if ($m -eq "IE") {
        $schoolUrls = Get-IrishSchoolUrls -Count $Count
        Invoke-TermDatesTest -Market "IE" -Urls $schoolUrls -Locale "en-IE"
        # locale passed explicitly -- some verified seeds are .com/.net domains, not .ie
    }
    if ($m -eq "US") {
        $schoolUrls = Get-USSchoolUrls -Count $Count
        Invoke-TermDatesTest -Market "US" -Urls $schoolUrls -Locale "en-US"
        # .com/.org TLDs are ambiguous -- locale passed explicitly
    }
    if ($m -eq "NZ") {
        $schoolUrls = Get-NZSchoolUrls -Count $Count
        Invoke-TermDatesTest -Market "NZ" -Urls $schoolUrls
        # locale inferred from .school.nz / .ac.nz / .govt.nz TLD
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor White
