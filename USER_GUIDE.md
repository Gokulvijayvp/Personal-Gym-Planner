# Gym Planner: User Guide

A short guide to starting the app each day and using it for the first time.

---

## Part 1: Start the app each day

You need two terminals: one for the backend and one for the frontend.

### Start

**Terminal 1: Backend**

```
cd C:\Users\Gokul\Downloads\personal-gym-planner-phase1\backend
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

Wait for `Application startup complete`.

**Terminal 2: Frontend**

```
cd C:\Users\Gokul\Downloads\personal-gym-planner-phase1\frontend
npm run dev
```

**Open** http://localhost:5173 in your browser.

On your iPhone, open `http://<your-PC-IP>:5173` while both devices are on the same Wi-Fi.

### Stop

Press `Ctrl+C` in each terminal.

### Good to know

- Use `.venv\Scripts\python.exe -m uvicorn ...`. In cmd, plain `uvicorn` is not found unless the virtual environment is activated.
- **Port busy?** An old backend is still running. Close its terminal, or find it with `netstat -ano | findstr :8000` and stop that process.
- **After an update**, run this once from the `backend` folder before starting:

  ```
  .venv\Scripts\python.exe -m alembic upgrade head
  ```

- **Backups:** your data is in `backend\data\gym_planner.db`. Copy that file, together with any `-wal` file beside it, only while the backend is stopped. A copy made while it is running can miss recent changes.

---

## Part 2: Use the app

The app has four tabs: **Home**, **Workout**, **Exercises** and **Progress**. Settings is the small gear icon.

```
 Exercises  ->  Workout  ->  Start workout  ->  Progress
 (add what      (plan the     (log it, tap       (see results
  you do)        week)         Complete)          and history)
```

### 1. Exercises: add what you do

- Open **Exercises**. Tap a muscle (Chest, Back...), then a target area and equipment if you like.
- Each card shows an animated figure doing the movement. Tap it for details, or tap **Add** to put it in **My library**.
- Not in the list? Tap **Create your own** (only a name and a muscle group are needed).

### 2. Workout: plan your week

- Open **Workout**. Today is selected; tap any day of the week to see and change it.
- **No plan yet?** Tap **Start a plan**. It starts this Monday and is switched on straight away.
- Tap **Add** to put an exercise in the day (your library, or the catalogue: it is added to your library for you).
- On each exercise: **up / down** to reorder, the swap icon to **replace**, the bin to **remove**, and tap "3 x 10" to change sets, reps and weight.
- The **...** menu: copy this day to another day, move it, fill it from another day, mark it as a **rest day**, or clear it.
- Every change shows **Undo** for a few seconds.
- Need more (cardio, notes, several weeks at once)? Use "More planning tools": the Full week planner, Workout cycles and Calendar.

### 3. Start and log a workout

- On **Workout** (or from **Home**), tap **Start workout** on today. Your plan is copied in as targets; the plan itself never changes.
- For each set enter reps and weight, then tap **Mark set done** (or **Skip**). Saving is automatic.
- When finished, tap **Complete workout**.
- No plan today? Tap **Start a blank workout**.

### 4. Progress

- Pick a date range and look at consistency, strength, volume, records, muscle groups and cardio.
- Open the **History** tab to read or filter finished workouts.

### 5. Settings (gear icon)

- Weight and distance units, date format, your name, and backups. The **Masters** tab lists the exercise names and icons (the exercise names and icons can be edited; the other lists are read-only).

---

## What happens to your input

```
 Library + Cycle + Planner   --->   PLAN (your intention)
                                        | copied when you tap Start
                                        v
 You type reps / weight / cardio -->  LOG (what you actually did)
                                        | counted only after "Complete"
                                        v
                    Home "Recent activity", History, Progress
```

Two rules the app follows:

- **Plan and log are separate.** Logging a workout never overwrites the plan.
- **Stored once, shown your way.** Weights are stored in kg and distances in km. Your unit setting only changes how they are displayed.

---

## Quick tips

- **Cycles start on a Monday.**
- **Only the active cycle** shows on Home. You can start a workout only from an active or completed cycle.
- **One open workout per day.** Finish or cancel it before starting another.
- **Weight left empty** means bodyweight. It counts as a set but adds no volume.
- **Cancelled and unfinished workouts** never count in Progress.
- **Your data is local.** Nothing leaves your computer.

---

## Where things live (for reference)

| Part | Folder |
|---|---|
| Screens | `frontend/src/pages` and `frontend/src/features` |
| API rules and calculations | `backend/app/services` |
| API endpoints | `backend/app/api/v1` |
| Database tables | `backend/app/models` |
| Database upgrades | `backend/migrations` |
| Backups | `backend/data/backups` |
