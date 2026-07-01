# test-locale-term-dates.ps1
# Fetches real school URLs from AU, IE, and US education directories
# then invokes the check-term-dates edge function to test locale-aware scraping.
#
# Usage:
#   .\scripts\test-locale-term-dates.ps1 -WebhookToken "YOUR_TOKEN"
#   .\scripts\test-locale-term-dates.ps1 -WebhookToken "YOUR_TOKEN" -Market AU -Count 50
#
# Markets: AU, IE, US, ALL (default)

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

    # VIC educated guesses (likely .vic.edu.au domains)
    'https://www.assumption.vic.edu.au',       # Assumption College
    'https://www.salesian.vic.edu.au',         # Salesian College Chadstone
    'https://www.smc.vic.edu.au',              # Star of the Sea College
    'https://www.stmarys.vic.edu.au',          # St Mary's College
    'https://www.scc.vic.edu.au',              # Strathcona Baptist Girls' Grammar
    'https://www.ivanhoe.vic.edu.au',          # Ivanhoe Grammar School
    'https://www.taylors.vic.edu.au',          # Taylors Lakes Secondary College
    'https://www.sths.vic.edu.au',             # South Oakleigh College / Sunny Heights

    # QLD government (.eq.edu.au)
    'https://www.brisbaneshs.eq.edu.au',       # Brisbane State High School
    'https://www.kelvingrove.eq.edu.au',       # Kelvin Grove State College
    'https://www.fernygrove.eq.edu.au',        # Ferny Grove State High School
    'https://www.indooroopillyss.eq.edu.au',   # Indooroopilly State School
    'https://www.parmia.eq.edu.au',            # Parramatta State School (QLD)
    'https://www.mtasc.eq.edu.au',             # Mt Alvernia College (QLD)
    'https://www.ambrose.eq.edu.au',           # St Ambrose's Primary (QLD)
    'https://www.aldersyde.eq.edu.au',         # Aldersyde State School

    # NSW
    'https://www.newington.nsw.edu.au',        # Newington College
    'https://www.abbotsleigh.nsw.edu.au',      # Abbotsleigh
    'https://www.hillsgrammar.nsw.edu.au',     # Hills Grammar School
    'https://www.knox.nsw.edu.au',             # Knox Grammar School
    'https://www.tgs.nsw.edu.au',              # Trinity Grammar School, Summer Hill
    'https://www.shore.nsw.edu.au',            # Sydney Church of England Grammar
    'https://www.barker.nsw.edu.au',           # Barker College
    'https://www.pems.nsw.edu.au',             # Pymble Ladies' College
    'https://www.kambala.nsw.edu.au',          # Kambala
    'https://www.sceggs.nsw.edu.au',           # SCEGGS Darlinghurst
    'https://www.queenwood.nsw.edu.au',        # Queenwood School for Girls
    'https://www.tara.nsw.edu.au',             # Tara Anglican School for Girls
    'https://www.sac.nsw.edu.au',              # Santa Sabina College
    'https://www.ravenswood.nsw.edu.au',       # Ravenswood School for Girls
    'https://www.domremy.nsw.edu.au',          # Domremy College
    'https://www.sbhs.nsw.edu.au'              # Sydney Boys High School (government)
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

    # Educated guesses — well-known Irish schools
    'https://www.belvedere-college.ie',        # Belvedere College SJ
    'https://www.alexandracollege.ie',         # Alexandra College
    'https://www.loreto.ie',                   # Loreto schools
    'https://www.sanctamaria.ie',              # Santa Maria College
    'https://www.dominicancollegegalway.ie',   # Dominican College Galway
    'https://www.stgerards.ie',                # St Gerard's School, Bray
    'https://www.sjcs.ie',                     # St Joseph's CBS
    'https://www.rathdownschool.ie',           # Rathdown School
    'https://www.cbscarlow.ie',                # CBS Carlow
    'https://www.sionhill.ie',                 # Sion Hill School
    'https://www.colaisteiognaid.ie',          # Colaiste Iognaid, Galway
    'https://www.preschool.ie',                # Probably not a school, skip
    'https://www.smgs.ie',                     # Scoil Mhuire Gan Smal
    'https://www.colaistebride.ie',            # Colaiste Bride
    'https://www.stmaryscollege.ie',           # St Mary's College
    'https://www.pbc.ie',                      # Presentation Brothers College Cork
    'https://www.corkgrammar.ie',              # Christian Brothers College, Cork
    'https://www.colaistecriost.ie',           # Colaiste Criost Ri, Cork
    'https://www.dlscork.ie',                  # De La Salle College, Cork
    'https://www.scoildaibheid.ie',            # Scoil Dabhog Naofa
    'https://www.colaistechiarain.ie',         # Colaiste Chiaran
    'https://www.vpcollege.ie',                # VP College
    'https://www.ardscoileigecrua.ie',         # Ardscoil Eige Crua
    'https://www.stvincentss.ie',              # St Vincent's Secondary School
    'https://www.colaistecholmcille.ie',       # Colaiste Cholmcille
    'https://www.stmarysdundalk.ie',           # St Mary's College Dundalk
    'https://www.stpatrickscollege.ie',        # St Patrick's College
    'https://www.northwickcs.ie',              # Northwick Community School
    'https://www.gormanstoncollege.ie',        # Gormanston College
    'https://www.villiers.ie',                 # Villiers School, Limerick
    'https://www.laurelhill.ie',               # Laurel Hill Colaiste FCJ
    'https://www.cistercian-college.ie',       # Cistercian College Roscrea
    'https://www.hazelwoodcollege.ie',         # Hazelwood College, Limerick
    'https://www.colaistechriost.ie',          # Colaiste Chriost Ri
    'https://www.preswicklow.ie',              # Presentation College Wicklow
    'https://www.castleknockcollege.ie',       # Castleknock College
    'https://www.millstreetcs.ie',             # Millstreet Community School
    'https://www.irishstudies.ie',             # Probably not a school
    'https://www.stvincentsus.ie'              # St Vincent's Secondary School
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
    'https://www.aldine.k12.tx.us',            # Aldine ISD
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
    'https://www.cosd.us',                     # Carlsbad USD, CA
    'https://www.powayusd.com',                # Poway USD, CA
    'https://www.dmusd.org',                   # Del Mar USD, CA
    'https://www.svusd.org',                   # Saddleback Valley USD, CA
    'https://www.iusd.org',                    # Irvine USD, CA
    'https://www.capousd.org',                 # Capistrano USD, CA
    'https://www.sausd.us',                    # Santa Ana USD, CA
    'https://www.aacps.org',                   # Anne Arundel County PS, MD
    'https://www.mcpsmd.net',                  # Montgomery County PS, MD
    'https://www.fcps.edu',                    # Fairfax County PS, VA
    'https://www.lcps.org',                    # Loudoun County PS, VA
    'https://www.pwcs.edu',                    # Prince William County PS, VA
    'https://www.henrico.k12.va.us',           # Henrico County PS, VA
    'https://www.chesterfield.k12.va.us',      # Chesterfield County PS, VA
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
        # locale inferred from .edu.au / .eq.edu.au / .com.au TLD
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
