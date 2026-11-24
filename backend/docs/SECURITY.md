# Gym Planner - security notes

Design: a **multi-user app with private data**. Anyone can sign up (password, then an emailed code to verify the address). The **first account is the admin**; every later account is a normal user. Each person can only ever see and change their own data.

## What protects the API

| Layer | How it works |
|---|---|
| Sign-in | Email code (6 digits, hashed, emailed through Resend, 5 min, single use, 5 wrong tries). Unknown emails look the same as known ones. |
| Roles | The first account created becomes `admin`; all others are `user`. Admin-only: downloading the whole-database backup and editing the shared exercise list. Nobody can change a role through the API. |
| Data isolation | Every table holding personal data has a `user_id`. A filter below the application code (`app/db/scope.py`) adds `user_id = <signed-in user>` to every query on those tables (reads, updates, deletes, joins, aggregates) and stamps it on new rows, so guessed ids from another account return 404. Pre-account data is claimed by the first account. |
| Session | Random token in an `HttpOnly`, `SameSite=Lax`, `Path=/` cookie (`Secure` in production). Only its SHA-256 is stored (`auth_sessions`). Checked in the database on **every** request, so logout/revocation is immediate. Idle expiry 30 days (renewed by use), absolute 180 days. |
| Deny by default | `api/v1/router.py` puts the session check, CSRF check and write limit on one router that holds every private route. A new route added there is private automatically. Public: health, signup/login code request, verify, logout. |
| CSRF | Writes (POST/PUT/PATCH/DELETE) need the `X-CSRF-Token` header to equal the `gp_csrf` cookie **and** match the hash stored with the session. Plus an exact `Origin`/`Referer` check against `CORS_ORIGINS`. GET never changes data (tested). |
| CORS | Exact allowlist, no wildcard (refused at startup), limited methods/headers, credentials only for listed origins. Preflight (OPTIONS) runs no business code. |
| Rate limits | Code requests: 5/hour per email, 10/hour per IP, plus a 60 s cooldown. Code checks: 15 per 15 min per email, 30 per 15 min per IP, plus 5 tries per code. Writes: 240/min per session. HTTP 429 with `Retry-After`. |
| Headers | `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy`, API `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store`, HSTS in production. |
| Production guard | With `APP_ENV=production` the server refuses to start unless `SECRET_KEY` is long and random, `COOKIE_SECURE=true` and `APP_DEBUG=false`. `/docs`, `/redoc`, `/openapi.json` are off. |
| Errors | JSON only, no stack traces, SQL or secrets (existing handlers, tested). |

A signed-in Postman **can** use that user's own data when it carries their session cookie and CSRF token. That is legitimate. What cannot happen is any access without them.

## Production checklist
1. `APP_ENV=production`, `APP_DEBUG=false`, `COOKIE_SECURE=true`, a random `SECRET_KEY` (32+ chars), `CORS_ORIGINS=https://your-domain` (exact).
2. Serve over HTTPS behind a reverse proxy; add HSTS there too, and set `TRUST_PROXY=true` only if the proxy overwrites `X-Forwarded-For`.
3. Frontend CSP at the proxy, for example:
   `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
4. Keep the frontend and API on one origin (proxy `/api`), as the dev server does.
5. The rate limiter counts in memory: with several server processes, move it to Redis.
6. Sign-in codes are emailed through Resend (`EMAIL_BACKEND=resend`; production refuses `console`). With the sandbox sender `onboarding@resend.dev` Resend only delivers to your own account email: verify a domain and set `RESEND_FROM_EMAIL` to an address on it before inviting other people. Never commit API keys: a file named `re_....txt` sits in the project root. Treat that key as exposed if the folder is ever shared or put in git, rotate it, and delete the file.

## Backups and migration
`python scripts/backup_db.py` copies the database with SQLite's backup API into `data/backups/` and verifies it (`PRAGMA integrity_check` and per-table row counts).
Migrations `d3f4`  (users, otp_codes, auth_sessions), `e4a5`  (sign-up password) and `f5a6`  (adds `user_id` to the personal-data tables, per-user unique indexes) delete nothing. Tested on a copy of the real data: upgrade, rollback and re-upgrade leave all rows identical.

## Run the tests
`python -m pytest tests/test_security.py tests/test_auth_api.py tests/test_multiuser.py`, and the Postman collection in `docs/postman/`.
