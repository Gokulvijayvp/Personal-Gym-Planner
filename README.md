# Personal Gym Planner — Phase 1

Foundation for a mobile-first personal workout planner.

## Stack
- Frontend: React 18, TypeScript, Vite
- Backend: Python 3.11+, FastAPI, Pydantic
- Persistence: SQLAlchemy 2.x + SQLite
- Migrations: Alembic
- Server: systemd + nginx (no Docker), see deploy/DEPLOY.md

## Local development

### Backend
```bash
cd backend
python -m venv .venv
# macOS/Linux: source .venv/bin/activate
# Windows: .venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
cp .env.example .env   # PowerShell: Copy-Item .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```
> The initial schema migration already exists in `migrations/versions/`. Do **not** run
> `alembic revision --autogenerate` for setup - only `alembic upgrade head`. Use
> `--autogenerate` only after you change a model, and review the generated file.

API: http://localhost:8000  
Swagger: http://localhost:8000/docs

### Frontend (new terminal)
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```
Web: http://localhost:5173

### Running on a server (no Docker)
Docker is not used. To run Gym Planner on a small Linux server such as an AWS EC2 instance, the API runs as a
systemd service behind nginx, and the website is the pre-built frontend. See **deploy/DEPLOY.md** for the step-by-step guide.

## Database
Core tables: workout_cycles, weekly_plans, daily_schedules, muscle_groups, workout_types, exercises, schedule_muscle_groups, schedule_exercises, body_metrics, app_settings, and the workout-log tables (workout_sessions, workout_session_exercises, workout_session_sets, workout_session_cardio).

Planned workout configuration is separate from actual workout logs. A logged workout copies the plan's targets when it starts (with name snapshots), so later plan or library edits do not rewrite history.

SQLite foreign keys and WAL mode are enabled. In deployment, store the DB on persistent storage and back it up regularly.

## Conventions (Phase 3)
- **Errors**: every non-2xx API response is `{"error": {"code", "message", "details?", "reference?"}}`
  (see `backend/app/core/errors.py`). Stack traces and DB messages are logged server-side only;
  unexpected errors return a generic message plus a short `reference` id to find in the server log.
  Raise `AppError(status, message, code)` for expected business-rule failures.
- **Time**: app timezone is `TIMEZONE` in `backend/.env` (Asia/Kolkata). `DateTime` columns store *naive UTC*;
  the API returns UTC ISO strings ending in `Z`; calendar dates (`workout_date` etc.) are local dates.
  Always use `app/core/timezone.py` (`today_local()`, `utc_now_naive()`, ...), never `date.today()` or `datetime.utcnow()`.
  Frontend equivalents live in `frontend/src/utils/date.ts`.
- **Frontend API**: components never call `fetch`; use `src/services/client.ts` (`api.get/post/...`). Failures are `ApiError`
  (`kind`: network / validation / client / server / parse) with `fieldErrors` for forms. Base URL: `VITE_API_BASE_URL`.
- `tzdata` is a required backend dependency on Windows (it has no system timezone database).

## Tests
```powershell
cd backend;  .venv\Scripts\python.exe -m pytest -q      # API + migrations (uses temporary databases only)
cd frontend; npm test; npm run build   # unit + component tests, then type-check and build
```

## Master data
Migration `a3c5e7f91b24` seeds (idempotently, without touching existing rows):
- Muscle groups: Chest, Back, Shoulders, Biceps, Triceps, Forearms, Abs / Core, Quadriceps, Hamstrings, Glutes, Calves
- Workout types: Barbell, Dumbbell, Machine, Cable, Bodyweight, Smith Machine, Resistance Band, Other

Cardio is intentionally **not** a muscle group; it is tracked separately as a workout activity (`cardio_logs`).

## Pages
Home `/`, Calendar `/calendar`, Workout `/workout`, Progress `/progress`, Exercise Library `/exercises`,
Workout Cycles `/cycles`, Weekly Planner `/planner`, Settings `/settings`. Most are empty states until their feature phase.
When deploying the built frontend, the web server must fall back to `index.html` for unknown paths (needed for refresh / direct URLs).

## Exercise Library (Phase 4)
Page: `/exercises`. Filters, sort and page are kept in the URL, so refresh and the back button work.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/exercises` | List. Query: `search`, `muscle_group_id`, `target_area_id`, `workout_type_id`, `is_active`, `sort` (`name`/`created_at`/`updated_at`), `order`, `page`, `page_size` (max 100) |
| POST | `/api/v1/exercises` | Create (201) |
| GET | `/api/v1/exercises/{id}` | Details |
| PUT | `/api/v1/exercises/{id}` | Update (replaces all editable fields) |
| PATCH | `/api/v1/exercises/{id}/status` | Activate / deactivate: `{"is_active": true}` |
| DELETE | `/api/v1/exercises/{id}` | Delete (204). **409 `exercise_in_use`** if a schedule or workout log references it - deactivate instead |
| GET | `/api/v1/muscle-groups` | Muscle groups, each with its own target areas |
| GET | `/api/v1/workout-types` | Workout types |

Rules: names are unique case-insensitively (409 `duplicate_name`); the target area must belong to the primary muscle group;
secondary muscle groups cannot include the primary one; image URL must be http(s).

Data model: `exercises.target_area_id` -> `target_areas` (seeded master data, 21 rows), secondary muscles in
`exercise_secondary_muscle_groups`, new `exercises.description`, unique index `ux_exercises_name_lower`.
Migration `b8d4f1a2c6e7` converts any old free-text `target_area` values and aborts *before* changing anything if they can't be mapped
or if case-insensitive duplicate names exist. Note: SQLite can't reflect that expression index, so a future Alembic *batch* migration
that rebuilds `exercises` must re-create it by hand.

## Workout Cycles & Weekly Planner (Phase 5)
Pages: `/cycles` and `/planner` (`?cycle=ID&week=N`).

- **Cycles** have a status (draft / active / completed / archived), start on a **Monday** and run any number of weeks (1-52).
  End date = start + 7 x weeks - 1 days (always a Sunday). Weeks 1..N are generated automatically. Two *active* cycles may not
  overlap in dates; only drafts can be deleted; completed/archived cycles are read-only.
- **Weeks are independent**: nothing is copied between weeks unless you use *Copy week* / *Copy day* (deep copies; editing one never changes another).
- A **day** is a rest day, or any mix of muscle groups (each with ordered library exercises) and cardio. Exercises are *references* to the
  Exercise Library (inactive ones can't be newly planned). Cardio is a separate master list, not a muscle group.
- Reordering uses a two-phase renumber so SQLite's `UNIQUE(schedule_muscle_group_id, exercise_order)` is never violated.
- Every multi-record change (create cycle, copy, clear, rest conversion) is one transaction.

| Method | Endpoint |
|---|---|
| GET/POST | `/api/v1/cycles` |
| GET/PUT/DELETE | `/api/v1/cycles/{id}` |
| POST | `/api/v1/cycles/{id}/activate` `/complete` `/archive` |
| GET | `/api/v1/cycles/{id}/weeks/{w}` |
| POST / DELETE | `/api/v1/cycles/{id}/weeks/{w}/copy` / `.../weeks/{w}/days` (clear week) |
| GET/PUT/DELETE | `/api/v1/cycles/{id}/weeks/{w}/days/{d}` (d: Monday=0) |
| POST | `.../days/{d}/copy`, `.../days/{d}/muscle-groups`, `.../days/{d}/cardio` |
| DELETE | `.../days/{d}/muscle-groups/{muscle_group_id}` |
| POST / PUT | `.../muscle-groups/{mg}/exercises` / `.../exercises/order` |
| PUT/DELETE | `/api/v1/schedule-exercises/{id}`, `/api/v1/schedule-cardio/{id}` |
| GET | `/api/v1/cardio-activities` |

Migration `c4e9a7b1d3f2`: `workout_cycles.status` replaces `is_active`; new `cardio_activities` (seeded) and `schedule_cardio`.
**Backups**: use SQLite's backup API (WAL mode keeps recent writes in `gym_planner.db-wal`, so copying only the `.db` file can miss data).
To test the frontend against another backend: `API_PROXY_TARGET=http://localhost:8100 npx vite --port 5273`.

## Calendar (Phase 6)
Page: `/calendar` (`?view=month|week|day&date=YYYY-MM-DD`). **Read-only**: the Workout Cycles and Weekly Planner remain the only source of truth.
Month / Week / Day views, Monday-first, with Today, previous and next. A month cell shows a compact summary (muscle groups, cardio, rest);
Day view shows the full plan (exercises, sets, reps, weight, rest, notes, cardio, day notes), the cycle, its status and the cycle week, and links to
`/planner?cycle=ID&week=N&day=D`, which opens that day's editor.

| Method | Endpoint |
|---|---|
| GET | `/api/v1/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD` (at most 62 days; every date returned, in order) |

Each day carries the cycle that covers it (active > completed > draft > archived; any others in `also_covered_by`), its 1-based cycle week and the
planner's own day object (`plan`, `null` when no cycle covers the date). The cost is a fixed handful of queries however many days, cycles or exercises
are involved. No schema change was needed for this phase.

## Settings
Page: `/settings`. One explicit **Save** (nothing is sent while typing), an unsaved-changes indicator, a leave-page warning, and **Reset section** (with confirmation) per section.

* **Workout Preferences**: default rest between sets / between exercises (seconds, 0-3600), workout duration target (minutes, 1-600), weight unit (kg/lbs), distance unit (km/miles). Saved for the workout-logging phase to use as defaults.
* **Calendar Preferences**: first day of week and date format (`DD/MM/YYYY`, `DD MMM YYYY`, `YYYY-MM-DD`). These are *preferences only*: the Calendar and cycle maths stay Monday-first and Asia/Kolkata, and stored dates are never changed.
* **Personal Preferences**: optional display name (max 50 characters). There is no login, email or password.
* **Data Management**: read-only database facts (engine, size, schema version, row counts - never file paths) and **Download backup**.

Units and date formats are display preferences: stored plans and workout records stay in kg / km / ISO dates and are never edited; values are converted only when shown (80 kg appears as 176.4 lbs).

| Method | Endpoint |
|---|---|
| GET / PUT | `/api/v1/settings` (PUT replaces all preferences; strict validation, 422 with field details) |
| POST | `/api/v1/settings/reset` with `{"section": "workout" \| "calendar" \| "personal" \| "all"}` |
| GET | `/api/v1/settings/data` (safe database information) |
| GET | `/api/v1/settings/data/backup` (downloads a consistent `.db` snapshot made with SQLite's backup API, including WAL contents) |

Storage: table `app_settings` (migration `d5a2b8c1e9f3`), one row enforced by `CHECK (id = 1)`; value ranges are also CHECK constraints. The backup is a full copy of the database, so keep it private.
Restoring is manual (stop the app, replace the database file); there is no in-app restore, reset or delete.

## Home dashboard (Phase 8)
Page: `/`. An overview built from the Weekly Planner / Calendar data (one API call) plus your Settings. It never edits plans; it can start or resume a workout (Phase 9) and lists your latest completed workouts as Recent activity.

* **Greeting and date**: "Good morning/afternoon/evening" from the Asia/Kolkata clock, your display name (if set), and today's date in your chosen format.
* **Active cycle**: name, start/end, "Week N of M" and progress (whole days before today / total days, so the start of week 3 of 8 reads 25%). Handles not-yet-started, ended, and no-active-cycle cases (draft / completed / archived are never shown as active).
* **Today**: the planned muscle groups, exercises (sets, reps, weight), cardio, notes, **Rest Day** or an empty state, with a link to that day in the Weekly Planner.
* **This week**: Monday to Sunday with today highlighted; each row opens that day in the Weekly Planner.
* **Overview numbers**: exercises in the library, active cycles, planned workout days this week (planned, never "completed").
* **Setup checklist** (real data) and **Recent activity** (your latest completed workouts; an honest empty state until you finish one).

Weight and distance are stored in kg / km and **converted** for display to your preferred units (80 kg shows as 176.4 lbs). Dates use your date-format setting; weeks stay Monday-first.

| Method | Endpoint |
|---|---|
| GET | `/api/v1/dashboard` (replaces the earlier placeholder; fixed handful of queries; reuses the Calendar service so planner logic is not duplicated) |

Only an **active** cycle's plan is treated as "your plan". No schema change was needed for this phase.

## Workout logging (Phase 9)
Pages: `/workout` (start, resume, history) and `/workout/:id` (the live log, or a read-only record once finished).

**Planned and actual data are separate.** Starting a workout *copies* the planned day (exercises in planner order, sets, reps, target weight, rest, notes, cardio) into new records. Targets are shown beside the inputs and are never written to; the Weekly Planner and Exercise Library are not touched by logging.

* **Start** from Home (Today card), the Calendar day view, the Weekly Planner day, or the Workout page; or start a **blank** workout there. Starting again returns the unfinished workout instead of creating a duplicate (the database allows only one unfinished workout per date).
* **Log** sets (reps, weight, rest, notes, done/skipped), add or remove sets and exercises, reorder, skip, add exercises from the library, and cardio (duration, distance, optional calories you type, speed, resistance, notes). Different exercises can have different set counts; a set can have no weight (bodyweight).
* **Autosave**: typing is saved after a short pause or when you leave the field, through one request queue so edits cannot overtake each other. The screen shows Saving / All changes saved / Save failed (with Retry). Your entry stays on screen until the server confirms it, a network blip is retried once, and the page warns before closing with unsaved text. Refreshing, reopening the browser or another device resumes the workout from the server.
* **Complete / cancel** with confirmation and an optional note or reason. Completed and cancelled workouts are read-only; the backend rejects every change (409 `session_locked`).
* **Elapsed time** comes from the stored start/end timestamps (UTC in the database, shown in Asia/Kolkata), so it is right after a refresh or a sleeping tab.
* **History** (`/workout`): completed workouts (optionally cancelled, clearly labelled), newest first, filter by date range and exercise, open any one read-only. Filters live in the URL.

**Units.** Weights are stored in kilograms and distances in kilometres (fixed-point `NUMERIC`). Your Settings units only affect what you type and see: values are converted at the screen boundary, and a value is only sent if you actually edited it, so viewing or tabbing through a field can never rewrite a stored number. Changing the unit later never changes saved records.

**History survives library changes.** Each logged exercise / cardio entry stores its name (and muscle group, type) as a snapshot; the foreign keys are `SET NULL`, so deactivating or deleting a library entry leaves the history readable. (The library still refuses to *delete* an exercise that has workout history; deactivate it instead.)

| Method | Endpoint |
|---|---|
| POST | `/api/v1/workouts` (`{source:"plan",cycle_id,week_number,day_of_week}` or `{source:"blank"}`; 201 new, 200 if already unfinished, 409 `session_in_progress` for a different start on the same day) |
| GET | `/api/v1/workouts` (`status`, `start`, `end`, `exercise`, `page`, `page_size`), `/api/v1/workouts/current`, `/api/v1/workouts/{id}` |
| POST | `/api/v1/workouts/{id}/complete`, `/cancel` |
| POST / PUT / PATCH / DELETE | `/api/v1/workouts/{id}/exercises`, `/exercises/order`, `/exercises/{eid}`, `/exercises/{eid}/sets`, `/sets/{sid}`, `/cardio`, `/cardio/{cid}` |

Every change returns the whole updated session. The dashboard gained `today_workout`, `in_progress_session` and `recent_activity` (the latest completed workouts), and each Calendar day gained `workout`.

Tables (migration `e6b3c9d2f7a4`): `workout_sessions`, `workout_session_exercises`, `workout_session_sets`, `workout_session_cardio`. They replace the unused Phase 1 placeholders `workout_sessions` / `workout_set_logs` / `cardio_logs`; the migration converts any rows those held, and downgrade converts back (exercise-level notes/targets cannot be represented in the old flat shape).

## Progress (Phase 10)
Page: `/progress` (`?range=7d|30d|90d|6m|12m|all|custom&from=&to=&tab=&exercise=`). Read-only analytics computed from the workout log at request time: **no new tables and no stored statistics**.

**What counts.** Only *completed workouts*, and inside them only *completed sets / cardio entries*. In-progress and cancelled workouts, planned-but-never-logged workouts, and skipped or pending sets are ignored. Dates are the workout's local Asia/Kolkata date, grouped into Monday-first weeks and calendar months; a range never runs past today, so future days are never "missed".

| Number | Definition |
|---|---|
| Completed workouts | finished workouts in the range |
| Training days | distinct dates with a completed workout (two workouts on one day count once) |
| Completed sets | sets marked done |
| Training volume | weight x reps summed over completed sets that have an external weight and reps, in kg |
| Duration / average | (ended - started) of completed workouts; average = total / workouts |
| Per-week figures | count / (days in range / 7); shown only for ranges of at least 7 days and only when there are workouts |
| Best weight | heaviest completed externally loaded set; ties go to the *earliest* date |
| Personal records | all-time up to the range end: heaviest weight (with its best reps), highest single-set volume, best reps at each of the heaviest weights, and most bodyweight reps; each links to its workout and is flagged "new" if first reached inside the range |
| Improvement | best weight on the first vs the last training date, shown only with 3+ dated points spread over 14+ days |
| Muscle groups | completed sets by the primary group stored with each exercise; no group = "Unassigned" (never guessed); secondary muscles are not added |
| Cardio | completed entries only: minutes, distance, per-activity totals; calories only if you typed them. Activities are never compared with each other |

**Bodyweight sets** count as completed sets and reps but are left out of weight progression, volume and weight records (they have their own reps record). **Volume is logged training volume, not a measure of muscle growth.** Weights are summed as integer grams, so totals are exact.

**Units.** Everything is computed and transferred in kg / km and converted only for display using your Settings units and date format; changing Settings never changes a record. An exercise is identified by its library id (a rename keeps its history together); one deleted from the library is found by its logged name.

| Method | Endpoint (all accept `start`, `end`) |
|---|---|
| GET | `/api/v1/progress/overview`, `/consistency`, `/exercises` (selector), `/exercise?key=id:<n>` or `name:<name>`, `/volume`, `/personal-records`, `/muscle-groups`, `/cardio?activity=` |

Each endpoint uses a small fixed number of aggregate queries (at most 8) however much history exists. Charts are small dependency-free SVG components (bar, line, ranked bars), each with keyboard-focusable points, an exact-value readout and a "view as a table" alternative.

## Exercise master and Settings tabs
**Settings** now has two tabs, `?tab=` **Configure** (the original preferences and data management; unsaved edits survive a visit to Masters) and **Masters** (`?tab=masters&master=`). Masters lists all five master lists; only the **Exercise master** is editable, the others (muscle groups, target areas, workout types, cardio activities) are view-only.

**Exercise master** = a list of exercise names, each with an *icon motion*. The icon is an animated stick figure drawn in the browser as inline SVG (SMIL), so it works offline and nothing is downloaded. The database stores only the motion key: `press, curl, squat, lunge, row, pullup, raise, deadlift, crunch, plank, cardio, generic`. When a master is created without one, `app/core/exercise_motion.py::guess_motion` picks it from the name (e.g. "Curl" -> curl, "Pulldown" -> pullup), then the muscle group, then `generic`; it can always be changed. Animation stops when the OS asks for reduced motion.

| Rule | Behaviour |
|---|---|
| Linking | `exercises.exercise_master_id` (FK, ON DELETE SET NULL). Adding or renaming a Library exercise links it to the master with the same name (any letter case) or creates one |
| Names | unique ignoring case (index `ux_exercise_masters_name_lower`) |
| Renaming a master | also renames its linked Library exercises (409 if another Library exercise already has that name) |
| Deleting a master | 409 `exercise_master_in_use` while any Library exercise uses it |
| Existing exercises | the migration creates one master per existing exercise and links it, so nothing is lost |

| Method | Endpoint |
|---|---|
| GET | `/api/v1/exercise-masters` (items + allowed motions) |
| POST / PUT / DELETE | `/api/v1/exercise-masters`, `/api/v1/exercise-masters/{id}` |

Library: the name field suggests master names and shows the icon of a matching one; cards show the animated icon (an uploaded image URL still wins). Migration `f7c4d0e3a8b5` (after `e6b3c9d2f7a4`) uses a batch rebuild of `exercises` and re-creates `ux_exercises_name_lower`; downgrade removes the link and table and keeps every exercise.

## Exercise catalogue (visual-first Add Exercise)
**Add Exercise** opens a built-in **catalogue** of 117 common gym exercises (Chest, Back, Shoulders, Biceps, Triceps, Forearms, Abs / Core, Quadriceps, Hamstrings, Glutes, Calves). Each card shows an animated figure, the name, muscle and target area, and equipment. Search, filter by muscle group, and tap **Add**: the exercise is copied into your Library with muscle group, target area, equipment and icon already filled in. Exercises you already have show **In library** and cannot be added twice (matching is case-insensitive). **Can't find it? Create your own** opens the manual form, which now asks only for a name and a primary muscle group; everything else is under **More details (optional)**.

**Visual approach: animated icons (not photos).** Real exercise photos cannot be bundled safely: there is no verified-licence offline set, copyrighted gym images are not allowed, and ~120 photos would add megabytes and need a network. The animated SVG figures are drawn in the browser (offline, instant, sharp on a phone, one line of data per new exercise). They were extended from 12 to 28 movements (flat / incline / decline press, fly, push-up, dip, pushdown, triceps extension, shrug, leg extension, leg curl, hip thrust, calf raise, leg raise, twist, carry) so the figure matches the exercise. An **image URL** on an exercise still takes priority, and if it fails to load the icon is shown instead.

The catalogue is static data in `app/core/exercise_catalogue.py` (no table). Cardio exercises are not in it: cardio is logged as Cardio activities. A name can live in one muscle group only, so "Bulgarian Split Squat" is under Quadriceps.

| Method | Endpoint |
|---|---|
| GET | `/api/v1/exercise-catalogue` (items with `in_library`, muscle groups, motions) |
| POST | `/api/v1/exercise-catalogue/{key}/add` (201 with the new exercise; 409 `already_in_library`; 404 unknown key) |
| GET | `/api/v1/exercise-masters/guess?name=` (the icon Auto would pick; the Add exercise master dialog previews it while you type) |

Migration `a9e1b5c7d3f0` (after `f7c4d0e3a8b5`) widens the `icon_motion` CHECK on `exercise_masters` from 12 to 28 values (batch rebuild, index re-created, no row changed). Downgrade maps each new motion to its closest original first. Existing exercises, plans, history and ids are untouched.

## Four-tab navigation (simple outside, powerful inside)
The app has exactly four tabs: **Home, Workout, Exercises, Progress** (desktop sidebar, phone bottom bar). **Settings** is a small icon (sidebar footer; phone app bar), not a tab. The Weekly Planner, Workout Cycles and Calendar are no longer tabs: they are reached from **Workout** ("More planning tools") and keep their routes (`/planner`, `/cycles`, `/calendar`), with Workout highlighted. No backend or database change was needed.

| Tab | What is inside |
|---|---|
| Home | Today's workout, next workout, the week, four shortcuts (Today's workout, Add an exercise, Browse exercises, See my progress) |
| Workout | A Mon-Sun week strip (today selected) and the selected day's plan with one-tap actions: **Add** (your library or the catalogue), **Replace**, **Remove**, **Move up/down**, inline **sets / reps / weight**, **Copy to / Move to / Fill from** another day (or same day next week), **Mark as rest**, **Clear**. Every change has **Undo** (it restores the day exactly as it was). Start / Resume workout is on today. With no plan: **Start a plan** creates and activates a 4/8/12-week plan from this Monday in one step |
| Exercises | **Browse** the catalogue (Muscle group -> Target area -> Equipment -> cards; tap a card for details) and **My library** (manage, custom exercises) |
| Progress | Consistency, Strength, Volume, Records, Muscle groups, Cardio, and **History** (workout history moved here from Workout) |

All Workout edits go through the existing Weekly Planner API (`/cycles/.../days/...`, `/schedule-exercises/...`): there is one planning system. Home's cards link to the Workout tab (`/workout`, `/workout?date=YYYY-MM-DD`, `/workout?add=1`).

**Admin-ready, not admin.** `frontend/src/config/navigation.ts` defines `USER_NAV` (the four tabs), `ADMIN_NAV` (Admin Dashboard, Exercise Master, Muscle Groups & Target Areas, Equipment & Workout Types, User Management, Application Settings) and `navForRole(role)`. `CURRENT_ROLE` is a fixed `"user"`; there is no login, no accounts, no role storage and no admin routes, and a regular user is never shown an admin tab (covered by tests). The app stays single-user.

## Scope
Built so far: foundation and data model (Phase 1), app shell and routing (2), API/error/timezone foundations (3), the Exercise Library (4), Workout Cycles + Weekly Planner (5), the read-only Calendar (6), Settings, the Home dashboard, Workout logging and Progress analytics. AWS deployment follows in a later phase.

## Security
The app intentionally has no in-app login screen. Do not expose a no-login app containing personal data to the public internet without a private access layer (e.g. Cloudflare Access or VPN), HTTPS, restricted EC2 security groups, and backups.
