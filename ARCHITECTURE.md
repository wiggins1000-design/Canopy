# Canopy — Architecture Overview

This document describes how Canopy is built so a developer can get up to speed quickly. It covers the stack, project structure, data model, authentication, real-time patterns, edge functions, and external service integrations.

Last verified against the live codebase and Supabase project on 2026-07-05.

---

## Stack at a Glance

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, React Router v6 |
| Backend / DB | Supabase (PostgreSQL, Auth, Realtime, Storage, Edge Functions) |
| Edge Functions | Deno (TypeScript), deployed to Supabase |
| AI | Anthropic Claude (Haiku for extraction/parsing; document API for PDFs) |
| Email (outbound) | Resend |
| Email (inbound) | Cloudflare Email Routing + Email Worker → `process-email` edge function (**not** Postmark) |
| SMS | Telnyx |
| Push notifications | Web Push API + VAPID (web/Android), APNs via Capacitor (iOS) |
| Payments | RevenueCat (App Store / Google Play in-app purchases). **Stripe has been fully removed** — do not reintroduce a web payment path |
| Crash reporting | Sentry (`@sentry/react` + `@sentry/capacitor`) |
| Mobile | Capacitor (iOS live in TestFlight; Android scaffolded, not yet submitted) |
| Deployment | Railway (frontend), Supabase (backend) |
| Marketing site | Static HTML at `website/`, deployed via Cloudflare Pages |

---

## Repository Layout

This repo hosts more than one product, sharing the same Supabase backend:

```
/
├── src/                  # Canopy app (React)
│   ├── pages/            # Top-level route views (incl. pages/admin/)
│   ├── components/       # Feature components, organised by domain
│   ├── context/          # React context providers
│   ├── hooks/            # Data-fetching hooks
│   ├── lib/              # Pure utilities and the Supabase client
│   ├── config/regions/   # Per-locale config (en-GB, en-US, en-AU, en-IE, en-NZ)
│   └── sw.js             # Service worker (Workbox, injected by vite-plugin-pwa)
├── supabase/
│   ├── migrations/       # Numbered SQL migrations (001–069)
│   └── functions/        # Deno edge functions (one folder per function)
│       └── _shared/      # Shared Deno utilities (localeConfig.ts, debugAlert.ts)
├── services/reader/      # Standalone Node.js web-scraping service (Puppeteer), deployed separately
├── website/              # Marketing site (canopy-app.app), plain HTML/CSS, Cloudflare Pages
├── parentingplan/        # Separate React app — parentingplan.help (questionnaire, time calculator).
│                         # Own package.json/server.js, deployed separately, but shares this Supabase
│                         # project (pp_plans, pp_versions, pp_analyses, pp_amendments, pp_collaborators
│                         # tables; analyze-plan/send-plan-invite/pp-draft-submitted/grant-test-analyses
│                         # edge functions)
├── ios/                  # Capacitor iOS project (generated)
├── android/              # Capacitor Android project (generated, scaffolded)
├── public/               # Static assets (PWA manifest, icons)
├── capacitor.config.json # Mobile app ID and webDir
├── vite.config.js        # Vite + PWA plugin config
└── tailwind.config.js    # Brand colour palette extension
```

---

## Frontend Architecture

### Entry Point

`main.jsx` renders `<BrowserRouter>` → `<AuthProvider>` → `<App />`.

`App.jsx` declares all routes. Public routes (`/login`, `/2fa`, `/reset-password`, `/join/:code`, `/plan`) are accessible without authentication. Everything else is wrapped in `<ProtectedRoute>` → `<AppLayout>`. Admin routes have their own guard (`<AdminRoute>`) and layout.

```
/                  → redirect to /calendar
/login             LoginPage
/2fa               TwoFAPage
/reset-password    ResetPasswordPage
/join/:code        JoinPage
/plan              PlanPage (parenting plan questionnaire, React version)
/calendar          CalendarPage
/board             NoticeBoardPage
/board/media       MediaPage
/messages          MessagesPage
/messages/:threadId ThreadPage
/config            ConfigPage
/expenses          ExpensesPage
/childcare         ChildcarePage
/info              InfoBankPage
/invite            InvitePage
/requests          RequestsPage
/export            ExportPage

/admin/login       AdminLoginPage
/admin/dashboard   AdminDashboardPage
/admin/family/:id  AdminFamilyPage
/admin/term-dates  AdminTermDatesPage
/admin/familyfeed  AdminFamilyFeedPage
/admin/broadcast   AdminBroadcastPage
```

> There is no "Parenting Agreement" / court-order route any more — that feature (`CourtOrderPage.jsx`, `analyze-court-order` edge function, `court_orders` table) was deliberately removed on 2026-06-30. Don't recreate it from memory of older docs.

### Global State: Context Providers

Three context providers wrap the authenticated app: `AuthProvider` → `FamilyProvider` → `SessionActivityProvider`.

**`AuthContext`** (`src/context/AuthContext.jsx`)

Owns session management. Key state:

- `session` / `user` — Supabase auth session
- `needsTwoFa` — boolean; set to `true` after password login when 2FA is enabled, cleared after successful code verification

Key methods: `signInWithEmail`, `signUpWithEmail`, `signOut`, `sendTwoFaCode`, `verifyTwoFaCode`, `completeTwoFa`, `resetPasswordForEmail`.

On login, calls `registerPushSubscription()` to store the push token in `family_members.push_token`.

**`FamilyContext`** (`src/context/FamilyContext.jsx`)

Owns the family's shared data. Key state:

- `family` — the `families` row (id, config JSONB, subscription fields, ical_token)
- `member` — the current user's `family_members` row
- `members` — all family members
- `schedule` — the `baseline_schedules` row (includes `pending_*` columns for a proposed-but-not-yet-accepted schedule change)
- `userRole` — `'parent_a'` | `'parent_b'` | `'third_party'` | `null`
- `isParent`, `parentA`, `parentB` — derived values

A Supabase Realtime channel watches `baseline_schedules` so both parents see schedule changes instantly without polling.

`family.config` is a free-form JSONB column used for settings that don't need their own table: changeover times/locations per date, children (name + dob + PE day pattern), locale, feature toggles (`messaging_enabled`, `expenses_enabled`, `childcare_enabled`, `familyfeed_event_scope`), `viewer_permissions` for third-party members, and `childcare_rates`.

**`SessionActivityContext`** (`src/context/SessionActivityContext.jsx`) — batches in-session actions (Info Bank edits, vault access, etc.) and flushes a single digest notice post at session end (logout, 30-min idle, or PWA backgrounding) instead of posting one notice per action. See `sessionFlushRegistry.js` for how this breaks the circular dependency between `AuthContext` and `FamilyContext`.

### Pages

Each file in `src/pages/` corresponds to one route. Pages compose hooks and components; they contain no direct Supabase queries — those live in hooks or RPC calls.

### Components

Organised by domain under `src/components/`:

| Directory | Contains |
|-----------|---------|
| `calendar/` | Month grid, day cell, day detail panel, new/edit event sheets, schedule change and FROR panels, week ahead, children events panel, PE day indicator |
| `noticeboard/` | Post cards, new post sheet |
| `messages/` | Thread sheet |
| `expenses/` | Expense sheet |
| `infobank/` | Per-child sections (medical, school, personal, contacts, accounts, docs, pets), vault section |
| `settings/` | `TermDatesSection.jsx` (the rest of Settings/Config lives inline in `ConfigPage.jsx`: FamilyFeed, notifications incl. evening reminder time, region/locale, features, legal, account) |
| `subscription/` | Trial banner, paywall overlay (RevenueCat-backed) |
| `layout/` | AppLayout, BottomNav, ProtectedRoute |
| `admin/` | Admin layout and route guard |
| `ui/` | Button, Badge, BottomSheet, PasswordField, PWAInstallPrompt |

### Hooks

Data-fetching hooks in `src/hooks/` keep data logic out of components. Each hook subscribes to a Supabase Realtime channel where relevant so both parents see live updates.

| Hook | What it fetches |
|------|----------------|
| `useCalendar()` | Month grid with schedule, changes, and FROR offers layered in |
| `useFamilyEvents(year, month)` | `family_events` for a given month (excludes term-dates rows, which come from `useTermDates`) |
| `useMessages()` | Message threads and read receipts |
| `useExpenses()` | Expense records (settled and unsettled), plus inline childcare hours summary |
| `useTermDates(year)` | School term dates; returns `Map<dateStr, [{type, schoolIndex, schoolName}]>` |
| `usePeDays()` | Per-child weekly PE/sport day pattern, for the calendar flag icon |
| `useBirthdays()` | Children's and pets' birthdays from `family.config` |
| `useSubscription()` | Derived subscription state (`isTrialing`, `isActive`, `daysLeft`, etc.) from `families` columns |
| `useNoticeboard()` | Notice posts and read receipts |
| `useMediaAttachments()` | Files attached to notice posts |
| `useLocale()` | Resolves the active locale config from `family.config.locale` (defaults `en-GB`) |

### Lib Utilities

**`src/lib/supabase.js`** — exports the single Supabase client instance plus push/SMS notification helpers. All code imports `supabase` from here.

**`src/lib/scheduleEngine.js`** — pure functions, no DB calls. Handles all schedule logic:
- `buildPresetPattern(patternType, startingParent)` — generates cycle arrays for alternating weeks, 2-2-5-5, 2-2-3, 3-4-4-3, custom
- `getBaselineOwner(dateStr, schedule)` — resolves which parent owns a date
- `getDayState(dateStr, { schedule, changes, offers })` — layers approved changes and FROR offers on top of baseline
- `getCalendarMonthDays(year, month)` — builds the month grid structure

This exact custody-resolution logic is also ported into Deno for `send-evening-reminders` (differentially tested against the frontend version — see below).

**`src/lib/imageUtils.js`** — client-side image compression before upload (resize + JPEG quality reduction).

**`src/lib/termDatesUtils.js`** — locale-aware term/holiday label helpers shared by `TermDatesSection` and calendar day detail.

**`src/lib/revenuecat.js`** — wraps `@revenuecat/purchases-capacitor`: configures the SDK with the family's `id` as RevenueCat's App User ID (family-wide entitlement), exposes purchase/restore, and reads localized pricing for `PaywallOverlay`.

**`src/lib/sentry.js`** — initialises `@sentry/react` (web) / `@sentry/capacitor` (iOS) crash reporting.

**`src/lib/sessionFlushRegistry.js`** — a plain registry object (not a context) that lets the outer `AuthContext` call into the inner `FamilyContext`'s session-flush logic without a circular import.

**`src/lib/validationUtils.js`** — shared form validation helpers.

### Styling

Tailwind CSS with a custom brand colour palette defined in `tailwind.config.js`:

| Token | Hex | Use |
|-------|-----|-----|
| `canopy-deep` | `#1b4332` | Primary dark green (headers, buttons) — "Forest Deep" |
| `canopy-mid` | `#2d6a4f` | Mid green (interactive elements) |
| `canopy-green` | `#52b788` | Accent green |
| `canopy-light` | `#74c69d` | Light green |
| `canopy-mist` | `#d8f3dc` | Very light green (borders) |
| `canopy-frost` | `#f4fbf4` | Near-white green (backgrounds) |
| `pa-*` | Green scale | Parent A accent colours |
| `pb-*` | Grey/orange scale | Parent B accent colours |

### PWA & Service Worker

`vite-plugin-pwa` injects a manifest and registers `src/sw.js` (Workbox-based service worker). The app installs as a PWA on mobile and desktop. The service worker precaches all built assets and handles push notification display. In dev mode the service worker can interfere with Playwright e2e runs unrelated to the test itself — already worked around in `mockApi.js`.

**iOS layout quirk:** flex children must have `min-w-0` and `overflow-hidden` to prevent iOS Capacitor WebView from zooming out on load. Use `h-dvh` rather than `h-screen` for full-height layouts. `@capacitor/status-bar` must call `StatusBar.setOverlaysWebView({overlay:true})` on init or `env(safe-area-inset-top)` returns 0 even with `viewport-fit=cover`.

---

## Database Architecture

### Row-Level Security

Every table has RLS enabled. **Direct client-side inserts/updates to most tables are blocked.** All writes go through `SECURITY DEFINER` RPC functions so the server-side function can perform the operation without the caller needing direct table access. This is the core security pattern throughout the codebase.

> When adding new write operations, always create an RPC function rather than using `.from('table').insert()` directly.

### Core Tables (Canopy app; live as of 2026-07-05)

```
families
  id, config (jsonb), ical_token, subscription_status, trial_ends_at,
  subscription_period_end, subscription_platform, subscription_product_id
  -- stripe_customer_id / stripe_subscription_id are legacy columns from
  -- before RevenueCat replaced Stripe; slated for removal, see migration 069

family_members
  id, family_id, user_id (→ auth.users), role, display_name, color,
  push_token, phone_number, two_fa_enabled, consents (jsonb)

family_invites
  id, family_id, code (unique), role, used, used_by, expires_at

member_additional_emails
  -- forwarding addresses a member has registered for FamilyFeed sender matching

baseline_schedules
  id, family_id, pattern_type, pattern_data (jsonb), start_date, starting_parent,
  pending_pattern_type, pending_pattern_data, pending_start_date,
  pending_starting_parent, pending_proposed_by, pending_proposed_at

schedule_changes
  id, family_id, requested_by, start_date, end_date, assigned_to, note,
  status (pending/accepted/declined), start_time, end_time, is_holiday

fror_offers
  id, family_id, date, offered_by_role, status, start_time, end_time, note, expires_at

family_events
  id, family_id, title, event_date, end_date, event_time, end_time, notes,
  source ('manual' | 'email_ai' | 'term_dates'), source_subject, recurrence,
  recurrence_end, tagged_children (text[]), school_calendar_id (→ school_calendars)

school_calendars
  id, homepage_url, term_dates_url, school_name, term_dates (jsonb), content_hash,
  last_fetched_at, school_address, school_email, school_phone, head_teacher, school_hours
  -- shared knowledge-base cache across all families, keyed by homepage_url

notice_posts
  id, family_id, author_id, content, tag, image_url, file_url, file_name,
  is_pinned, is_archived, created_at, updated_at

notice_post_reads
  id, post_id, user_id, read_at

message_threads / messages / message_reads
  topic-based threads between parents only

expenses / expense_settlements
  id, family_id, paid_by_role, description, amount, category, date, settled, receipt_url

childcare_logs / childcare_bills
  per-carer-per-date hour logs; bills roll up unbilled entries per carer/period,
  locking billed entries against edit/delete

info_bank
  id, family_id, child_name, section (medical/school/personal/contacts/accounts/docs/pets),
  data (jsonb)

child_accounts
  id, family_id, child_name, platform, url, notes,
  vault_secret_id / vault_username_id (→ Supabase Vault)

vault_documents
  id, family_id, child_name, category, label, storage_path, file_name, mime_type

calendar_connections
  Google/Outlook OAuth tokens for calendar sync

email_processing_log / familyfeed_content_cache
  FamilyFeed processing history + admin stats; and hash-keyed cache of expensive
  content extraction, split from cheap per-family filtering (two-stage architecture)

two_factor_codes
  hashed 2FA codes, 10-min expiry

admin_accounts
  separate auth path for the /admin panel (not family_members)

app_settings
  key (pk), value (jsonb) — global settings (e.g. two_fa_enabled flag)
```

> There is no `court_orders` table any more (dropped 2026-06-30 alongside the feature removal). There is no separate `baseline_schedule_proposals` table — proposed schedule changes live as `pending_*` columns directly on `baseline_schedules`.

### Vault (Encrypted Secrets)

Passwords and usernames for children's online accounts are stored in Supabase Vault (the `vault.secrets` table), not in plaintext columns. The `child_accounts` table stores the Vault secret IDs. Two RPC functions handle access:

- `get_account_secret(p_id)` — returns decrypted password
- `get_account_username(p_id)` — returns decrypted username

### Schedule Engine (Database Side)

The baseline schedule is stored as `pattern_type` + `pattern_data.cycle` (an array of `'parent_a'` / `'parent_b'` entries) + `start_date`. The JavaScript `scheduleEngine.js` replays this cycle from the start date to resolve ownership of any given day. Approved `schedule_changes` and `fror_offers` are overlaid by `getDayState()` at render time on the client. The same resolution logic is independently ported into Deno for the evening reminder cron.

### Migrations

69 numbered SQL migration files in `supabase/migrations/`, applied sequentially. To apply a new migration to the live database without replaying history:

```powershell
$env:PATH += ";C:\Users\chris\AppData\Local\supabase"
supabase db query --linked --file supabase/migrations/069_drop_superseded_term_date_rpc.sql
```

> Do **not** use `supabase db push --linked` for one-off migrations against this project's history — prefer `db query --file` for a single migration. Confirm destructive migrations (DROP COLUMN/FUNCTION) with the project owner before running them; they are irreversible.

---

## Edge Functions

All backend logic lives in Supabase Edge Functions (Deno TypeScript). Deployed with:

```powershell
supabase functions deploy <function-name> --no-verify-jwt
```

### Canopy App Functions

| Function | Trigger | What it does |
|----------|---------|-------------|
| `send-push` | Called from client | Sends Web Push notification to a family member's device (auth-guarded: service role or family-member JWT) |
| `send-sms` | Called from client | Sends SMS via Telnyx when an urgent notice post is created (same auth guard) |
| `send-invite-email` | Called from client | Emails a family invite link via Resend |
| `send-2fa-code` | Called from client | Generates a 6-digit code, hashes it in DB, emails plaintext code via Resend |
| `verify-2fa-code` | Called from client | Compares submitted code against stored hash |
| `export-pdf` | Called from client | Generates a tamper-proof PDF of schedule history, posts, and events |
| `export-user-data` | Called from client | GDPR data export — returns all user data as JSON |
| `delete-account` | Called from client | Deletes all family data then removes the auth user |
| `extract-event-from-image` | Called from client | Passes an image/voice memo to Claude; returns structured event data (photo-a-flyer) |
| `extract-school-info` | Called from client | Fetches school website via the `reader` service, passes content to Claude, returns school metadata + term dates |
| `process-email` | Cloudflare Email Worker webhook (**not** Postmark) | FamilyFeed: parses inbound email (or PDF/docx/HTML attachments, or JS-rendered newsletter links) via Claude, creates `family_events` and/or `notice_posts`. Family identified by sender's From address via `member_additional_emails`. Locale-aware date parsing. |
| `calendar-feed` | HTTP GET (unauthenticated, token in URL) | Returns iCal `.ics` feed for the family (`schedule`, `events`, `term_dates`, `schedule_changes`), authenticated by `ical_token` |
| `calendar-oauth-callback` | OAuth redirect | Handles Google/Outlook OAuth callback and stores calendar access tokens |
| `check-term-dates` | Called from client ("Sync from school website"); monthly cron **not yet scheduled** | Re-scrapes school websites for term dates — see [Term Dates Pipeline](#term-dates-pipeline) below |
| `send-evening-reminders` | Scheduled via `pg_cron`, every 15 min | Pushes tomorrow's events + PE days to whichever parent has custody that night |
| `revenuecat-webhook` | RevenueCat webhook | Syncs `families.subscription_status` / `subscription_platform` / `subscription_product_id` on purchase/renewal/cancellation events |
| `admin-broadcast` | Called from admin panel | Sends a broadcast email to all/filtered families |
| `admin-delete-family` | Called from admin panel | GDPR-compliant full family deletion |
| `analyze-admin-failures` | Called from admin panel | Clusters a period's FamilyFeed/term-dates processing failures into root causes via Claude (human-in-the-loop, not auto-patch) |

> `analyze-court-order` was removed 2026-06-30 along with the Parenting Agreement feature. `create-checkout-session` and `stripe-webhook` were removed 2026-07-05 as dead code — Stripe was already fully replaced by RevenueCat in the client and had no remaining callers.

### Parenting Plan Tool Functions (shared project, separate product)

`analyze-plan`, `send-plan-invite`, `pp-draft-submitted`, `grant-test-analyses` — back the `parentingplan/` app (parentingplan.help), not the Canopy app itself. They share this Supabase project's database (`pp_*` tables) and secrets but are otherwise independent.

### Shared Utilities

- `supabase/functions/_shared/debugAlert.ts` — imported by edge functions to send error alerts to `debug@canopy-app.app` via Resend when an unhandled exception occurs. Redacts common sensitive field names (`password`, `token`, `secret`, `key`, `authorization`) before sending. Swallows its own errors so it never breaks the calling function. Sentry (`f069e01`) now also captures backend errors in parallel.
- `supabase/functions/_shared/localeConfig.ts` — locale-aware regexes, Claude prompt variants, and closed-day patterns for all 5 supported locales (en-GB, en-US, en-AU, en-IE, en-NZ), used by `process-email`, `check-term-dates`, and `extract-school-info`.

### Required Secrets (set in Supabase dashboard)

| Secret | Used by |
|--------|---------|
| `RESEND_API_KEY` | send-invite-email, send-2fa-code, admin-broadcast, debugAlert |
| `ANTHROPIC_API_KEY` | extract-event-from-image, extract-school-info, process-email, check-term-dates, analyze-admin-failures |
| `TELNYX_API_KEY` / `TELNYX_FROM` | send-sms |
| `VAPID_SUBJECT` / `VAPID_PUBLIC` / `VAPID_PRIVATE` | send-push |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | calendar-oauth-callback |
| `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET` | calendar-oauth-callback (personal Microsoft accounts only — work/school accounts need Azure publisher verification) |
| `READER_URL` / `READER_SECRET` | extract-school-info, check-term-dates |
| `EMAIL_WEBHOOK_TOKEN` | process-email (must match the value the Cloudflare Email Worker sends) |
| `TERM_DATES_WEBHOOK_TOKEN` | check-term-dates |
| `REVENUECAT_WEBHOOK_SECRET` | revenuecat-webhook |

---

## Authentication Flow

1. User submits email + password → `supabase.auth.signInWithPassword()`
2. On success, `AuthContext` checks `app_settings` for `two_fa_enabled` and the user's `family_members.two_fa_enabled`
3. If 2FA is required, `needsTwoFa = true` — the app routes to `/2fa`
4. `/2fa` calls `send-2fa-code` edge function (generates code, stores hash, emails plaintext)
5. User submits code → `verify-2fa-code` edge function validates and clears the hash
6. `completeTwoFa()` sets `needsTwoFa = false`, app proceeds to main routes
7. `ProtectedRoute` checks both `session` and `!needsTwoFa` before rendering protected content

Password reset uses Supabase's built-in flow with a custom HTML email template (`supabase/templates/password-reset.html`).

The `/admin` panel uses a separate `admin_accounts` table and its own login (`AdminLoginPage` → `AdminRoute`), not `family_members`.

---

## Inbound Email Flow (FamilyFeed)

Canopy has a shared email address `familyfeed@canopy-app.app`. **Cloudflare Email Routing** (catch-all on the domain) forwards inbound mail to a **Cloudflare Email Worker** (`worker-yellow-sea-400e`), which POSTs it as a webhook to the `process-email` edge function. This is not Postmark — an earlier design used Postmark and that reference has been corrected here.

The function:
1. Authenticates the webhook via `EMAIL_WEBHOOK_TOKEN` (must match what the Worker sends)
2. Identifies the family by matching the sender's From address against `family_members.email` or `member_additional_emails`
3. Reads the email body plus any PDF/docx/doc/HTML attachments, and follows PDF/JS-rendered newsletter links (Sway, Smore, Peachjar)
4. Passes content to Claude with a locale-aware structured prompt (date format hints per region)
5. Claude returns JSON: calendar events and/or a notice board post
6. Results are cached (content-hash keyed, in `familyfeed_content_cache`) and inserted via RPC — never direct table access
7. Requires explicit per-user consent first (`family_members.consents.familyfeed_ai`)

### Term Dates Pipeline

`check-term-dates` (invoked from Settings → School Term Dates, "Sync from school website") does, per school:
1. Checks `school_calendars` KB cache first — skips scraping if cached and unchanged (content-hash comparison)
2. If not cached: fetches the school homepage (Puppeteer `reader` service → Jina → direct fetch fallback), finds the term-dates page via pattern matching + Claude link-picking, fetches that page, and extracts dates via Claude (including any linked PDFs, using Claude's native document API)
3. Upserts results to `school_calendars`, then applies new dates to the requesting family's `family_events` (deduped, capped to skip dates >1 month old), tagging `source_subject` with the school name via `SchoolPicker`
4. A monthly cron for this has been made cost-safe (staleness + unchanged-hash checks) but is **deliberately not yet scheduled** — needs explicit go-ahead since it writes to real family calendars

---

## AI Integration

Claude is used via edge functions in several places:

**Event extraction from images/voice** (`extract-event-from-image`) — Parent uploads an image (e.g. a school letter photo) or voice memo. Claude extracts date, time, title, and notes, with known-names spelling correction and recurrence/child auto-tagging. The client pre-fills `NewEventSheet` with the result.

**FamilyFeed email parsing** (`process-email`) — see above.

**School info extraction** (`extract-school-info`, `check-term-dates`) — term dates, INSET days, school metadata; native PDF extraction via Claude's document API.

**Admin failure clustering** (`analyze-admin-failures`) — collates a period's FamilyFeed or term-dates failures and asks Claude to cluster them into root causes for a human to review (not an auto-patch loop).

---

## Reader Service

`services/reader/` is a small standalone Node.js (Puppeteer) service deployed separately (not a Supabase function). It accepts a URL and returns clean rendered content — handling HTML pages, PDFs, and images, including sites that block naive fetches. Edge functions that need to read external web pages call this service (authenticated by `READER_SECRET`) before falling back to Jina or a direct fetch.

---

## Push Notifications

1. On login (web), `registerPushSubscription(userId)` calls `navigator.serviceWorker.ready`, requests push permission, and calls `pushManager.subscribe()` with the VAPID public key. On iOS, `@capacitor/push-notifications` registers for APNs instead.
2. The resulting token is stored in `family_members.push_token`
3. When an action should notify the other parent (new post, schedule change, evening reminder, etc.), the client (or an edge function) calls `sendPushNotification(...)`
4. This invokes the `send-push` edge function, which looks up the recipient's `push_token` and sends via Web Push or APNs as appropriate
5. The service worker (`sw.js`) receives web push events and displays a notification; clicking it navigates to the payload `url`

---

## Real-Time Updates

Supabase Realtime (Postgres Changes) is used to keep both parents in sync without polling.

Key subscriptions:
- `baseline_schedules` — watched in `FamilyContext`; schedule updates appear instantly on both devices
- `family_events` — watched in `useFamilyEvents`
- `schedule_changes` and `fror_offers` — watched in `useCalendar`
- `message_threads` and `messages` — watched in `useMessages`
- `expenses` — watched in `useExpenses`
- `notice_posts` — watched in `useNoticeboard`

All channels are cleaned up in the hook's `useEffect` return function.

---

## Mobile (Capacitor)

The iOS app (live in TestFlight) and scaffolded Android app are Capacitor wrappers around the Vite-built web app. `capacitor.config.json`:

```json
{
  "appId": "app.canopy.app",
  "appName": "Canopy",
  "webDir": "dist"
}
```

Build and sync process (iOS, via MacinCloud):
1. `git pull` → `npm install` → `npm run build` — produces `dist/`
2. `npx cap sync ios` — copies `dist/` into the Xcode project (required for any native plugin change, e.g. the vendored speech-recognition plugin)
3. Xcode: Clean Build Folder → bump Build number → Archive → Distribute to App Store Connect

**Native plugin gotcha:** Capacitor's SPM dependency resolution silently drops plugins that aren't distributed via SPM. `@capacitor-community/speech-recognition` is vendored directly into the App target rather than relying on `cap sync` alone.

The app is also installable as a PWA on Android and desktop via the install prompt in `AppLayout`.

---

## Deployment

**Frontend (Canopy app):** Hosted on Railway (`my.canopy-app.app`). Deploy by pushing to `main` — Railway picks up the push via GitHub integration and rebuilds using `nixpacks.toml`. `railway.json` specifies `npm start` (runs `server.js`) as the start command. Never Vercel — this project has never used it.

**Backend:** Supabase project `zhxuegizpmukynifstuu` (region eu-west-2). Edge functions are deployed manually via the Supabase CLI. Database migrations are applied with `supabase db query --linked --file <migration>`.

**Marketing site:** `website/` — separate Cloudflare Pages deployment at `canopy-app.app`.

**Parenting plan tool:** `parentingplan/` — separate deployment at `parentingplan.help`, own build/start process, shares the Supabase project above.

**Environment variables** (frontend, committed in `.env` / `.env.production` — all public/publishable values, safe to commit):

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |
| `VITE_VAPID_PUBLIC_KEY` | VAPID public key for web push registration |
| `VITE_SENTRY_DSN` | Sentry project DSN |
| `VITE_REVENUECAT_IOS_KEY` | RevenueCat public SDK key |
| `VITE_PAYWALL_ENABLED` | Gates the paywall entirely — set `false` while RevenueCat testing is blocked (currently the case: Apple hasn't finished processing the Paid Apps Agreement address/bank details, so sandbox purchases can't be tested yet) |

---

## Subscription Model

Subscription state is stored on the `families` row (family-wide — one subscription covers both parents, keyed by RevenueCat App User ID = `family.id`):

| Column | Meaning |
|--------|---------|
| `trial_ends_at` | When the free trial expires |
| `subscription_status` | `trialing`, `active`, `past_due`, `canceled` |
| `subscription_period_end` | Next billing/renewal date |
| `subscription_platform` | `ios` or `android` — which store the active subscription came through |
| `subscription_product_id` | RevenueCat product identifier (monthly/annual), for support/debugging |

The `useSubscription()` hook derives `isTrialing`, `isActive`, `isExpired`, and `daysLeft` from these fields. `TrialBanner` and `PaywallOverlay` in `AppLayout` gate access, but only when `VITE_PAYWALL_ENABLED=true`.

Payments are handled entirely via RevenueCat for in-app purchases (App Store / Google Play). `revenuecat-webhook` keeps the `families` row in sync with RevenueCat on purchase/renewal/cancellation. **There is no web payment path — Stripe has been fully removed** (both from the client and, as of migration 069, from the edge functions and `families` columns).

RevenueCat itself is currently blocked on Apple's side: the Paid Apps Agreement isn't Active yet (legal-entity address needed updating, tax form and banking still processing) — this is why the paywall is switched off, not a code issue.

---

## Key Patterns and Conventions

**No direct table writes from the client.** All mutations use `SECURITY DEFINER` RPC functions. This is enforced by RLS — direct inserts will be rejected.

**Supabase CLI on Windows.** The CLI is not in the system PATH by default. Prepend:
```powershell
$env:PATH += ";C:\Users\chris\AppData\Local\supabase"
```

**Config as JSONB.** Feature flags and per-family settings that don't need indexing live in `families.config` rather than dedicated columns. Access via `family?.config?.someKey`.

**Locale-aware everywhere.** Currency, date format, term/year-group terminology, and closed-day detection all branch on `family.config.locale` via `useLocale()` (client) and `_shared/localeConfig.ts` (edge functions). Check `src/config/regions/` before assuming UK-only behaviour anywhere.

**School colour assignment.** Schools are assigned colour indices (0=purple, 1=teal, 2=orange) by alphabetical sort of their `source_subject` names — stable regardless of insertion order.

**Encrypted child account credentials.** Stored in Supabase Vault, not plaintext columns. Fetch via `get_account_username(id)` / `get_account_secret(id)` RPC functions.

**Error alerting.** Edge functions import `sendDebugAlert` from `_shared/debugAlert.ts` for a redacted-context email alert, and errors also flow to Sentry.

**Branding language.** "Family app", never "co-parenting app". "the other parent", not "co-parent". Strapline: "Share what matters."
