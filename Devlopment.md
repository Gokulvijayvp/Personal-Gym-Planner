# PERSONAL GYM PLANNER – COMPLETE DEVELOPMENT PROMPTS

## PROMPT 0 – PROJECT CONTEXT & MASTER INSTRUCTIONS

I am developing a Personal Gym Planner web application for my own fitness journey.

I already have a Phase 1 project. First, inspect the complete existing project before making any changes.

### Existing technology stack
- Frontend: React + TypeScript + Vite
- Backend: Python + FastAPI
- ORM: SQLAlchemy
- Database: SQLite
- Database migrations: Alembic
- Frontend API communication: REST API
- Future deployment: AWS EC2
- Current development environment: Windows laptop
- Docker is NOT installed. Do not require Docker for local development.

### Application requirements
- Personal-use application.
- No login, registration, or authentication.
- Light theme only.
- Fully responsive desktop, tablet, and mobile UI.
- Must work well on iPhone browsers.
- Clean, modern, premium fitness dashboard design.
- Use reusable React components.
- Follow clean architecture and maintainable coding standards.

### IMPORTANT DEVELOPMENT RULES
1. Inspect the existing project structure before coding.
2. Do not unnecessarily rewrite or delete existing files.
3. Reuse existing database models wherever appropriate.
4. Do not introduce a different technology stack.
5. Use Alembic migrations for database schema changes.
6. Implement real frontend-to-backend API integration.
7. Do not use hardcoded mock data as a replacement for real functionality.
8. Add proper loading, empty, success, and error states.
9. Validate inputs on both frontend and backend.
10. Use proper TypeScript types.
11. Use SQLAlchemy relationships and appropriate foreign keys.
12. Avoid duplicate records and handle database transactions correctly.
13. Do not leave navigation buttons or action buttons without functionality.
14. Keep the UI consistent across all pages.
15. Do not implement everything in one step. Work phase by phase.

### First task
Inspect:
- Complete frontend structure
- Complete backend structure
- Existing database models
- Existing Alembic migrations
- Existing API endpoints
- Existing React routes and navigation
- Existing CSS and responsive layout

Identify why the current navigation pages cannot be accessed.

Prepare a development plan and list the existing issues.

Do not start major feature development until the inspection report is ready.

---

## PROMPT 1 – FIX NAVIGATION & APPLICATION ROUTING

Implement proper page navigation throughout the application.

Required pages:
1. Dashboard
2. Exercise Library
3. Workout Cycles
4. Weekly Workout Planner
5. Workout Calendar
6. Workout Tracking
7. Progress Tracking
8. Settings

Requirements:
- Use React Router.
- Every sidebar navigation item must open its corresponding page.
- Add active navigation states.
- Support browser back and forward navigation.
- Support direct URL access and page refresh.
- Add a 404 page for invalid routes.
- Ensure mobile navigation works correctly.
- Keep the existing dashboard design.
- Do not create blank placeholder pages.
- If a module is not implemented yet, show a meaningful under-development page rather than a broken link.

Test every route before completing this phase.

---

## PROMPT 2 – DESIGN SYSTEM & RESPONSIVE UI

Improve the overall application UI.

Design direction:
- Modern premium fitness application.
- Light mode only.
- Primary color: Deep forest green.
- Secondary color: Sage green.
- Background: Very light grey/white.
- Cards: White with subtle borders and shadows.
- Rounded corners.
- Clean typography.
- Minimal icons.
- Good spacing and visual hierarchy.

Requirements:
- Create reusable buttons, cards, modals, forms, tables, dropdowns and badges.
- Use consistent colors, font sizes, spacing and border radius.
- Add toast notifications.
- Add confirmation dialogs for destructive actions.
- Add loading skeletons.
- Add empty states.
- Add error states.
- Avoid unnecessary animations.

Responsive requirements:
- Desktop: Sidebar navigation.
- Tablet: Compact navigation.
- Mobile/iPhone: Bottom navigation or suitable mobile navigation.
- Forms must fit mobile screens.
- Tables must be mobile-friendly.
- No horizontal overflow.
- Buttons must be easy to tap.

Do not change the application's functional requirements.

---

## PROMPT 3 – EXERCISE LIBRARY MODULE

Build a complete Exercise Library module.

This is one of the most important modules.

I want to maintain a personal exercise library based on exercises recommended by my gym mentor.

Each exercise should support:

1. Exercise name
2. Description
3. Main muscle group
4. Secondary muscle groups
5. Target muscle area
6. Workout type
7. Equipment
8. Exercise instructions
9. Image URL or media reference (optional)
10. Active/inactive status

### Workout types
- Barbell
- Dumbbell
- Machine
- Cable
- Bodyweight
- Smith Machine
- Resistance Band
- Other

### Muscle groups
- Chest
- Back
- Shoulders
- Biceps
- Triceps
- Forearms
- Abs
- Quadriceps
- Hamstrings
- Glutes
- Calves
- Full Body

### Target muscle areas

Chest:
- Upper Chest
- Middle Chest
- Lower Chest
- Inner Chest

Back:
- Upper Back
- Middle Back
- Lower Back
- Lats

Shoulders:
- Front Delts
- Side Delts
- Rear Delts

Legs:
- Quadriceps
- Hamstrings
- Glutes
- Calves

Arms:
- Biceps
- Triceps
- Forearms

Requirements:
- Add exercise.
- Edit exercise.
- Delete exercise.
- View exercise details.
- Search exercises.
- Filter by muscle group.
- Filter by equipment/workout type.
- Filter by target muscle area.
- Prevent accidental duplicate exercises.
- Allow exercise activation/deactivation.
- Add pagination if required.

Create all necessary backend APIs and frontend screens.

Use the existing database models if possible. Add Alembic migrations only when necessary.

---

## PROMPT 4 – MUSCLE GROUP & WORKOUT TYPE MASTER DATA

Build master-data management.

Requirements:

Muscle group management:
- Add muscle group.
- Edit muscle group.
- View muscle groups.
- Enable/disable muscle groups.

Workout type management:
- Barbell
- Dumbbell
- Machine
- Cable
- Bodyweight
- Smith Machine
- Resistance Band
- Other

Requirements:
- Avoid duplicate master records.
- Exercise Library should use these master records.
- Do not hardcode master data repeatedly in different frontend components.
- Provide sensible default seed data.

---

## PROMPT 5 – WORKOUT CYCLE MANAGEMENT

Build a complete Workout Cycle Management module.

I want to create workout plans for any custom number of weeks.

Examples:
- 4-week cycle
- 6-week cycle
- 8-week cycle
- 12-week cycle

Requirements:

Create workout cycle with:
- Cycle name
- Start date
- End date
- Number of weeks
- Description
- Status (Draft, Active, Completed, Archived)

Important:
- The number of weeks must be configurable.
- Do not restrict the user to a fixed 4-week plan.
- Automatically calculate the cycle end date.
- Allow editing a draft cycle.
- Prevent accidental overlapping active cycles unless explicitly supported.
- Allow viewing previous cycles.
- Allow activating and completing cycles.

Each cycle must contain its own weekly workout plans.

---

## PROMPT 6 – WEEKLY WORKOUT PLANNER

Build the Weekly Workout Planner.

I want to assign different workouts for each weekday.

Example:

Monday – Chest
Tuesday – Back
Wednesday – Shoulders
Thursday – Arms
Friday – Legs
Saturday – Cardio / Abs
Sunday – Rest

But the schedule must be fully customizable.

Requirements:
- Select a workout cycle.
- Display all weeks in that cycle.
- Select a week.
- Display Monday to Sunday.
- Assign workouts to individual days.
- Allow rest days.
- Allow multiple muscle groups on one day.
- Allow cardio-only days.
- Allow changing the weekday workout.
- Allow copying one week's schedule to another week.
- Allow clearing a day's schedule.
- Show a weekly summary.

Important:
Different weeks may have completely different workout structures.

Example:
Week 1 – Barbell-focused chest workouts.
Week 2 – Dumbbell-focused chest workouts.
Week 3 – Machine-focused chest workouts.
Week 4 – Mixed exercises.

Do not assume every week has the same exercises.

All schedules must be stored in SQLite through backend APIs.

---

## PROMPT 7 – DAILY WORKOUT EXERCISE ASSIGNMENT

Build detailed exercise assignment for each scheduled workout.

When I open a scheduled day, I should be able to add exercises from my Exercise Library.

Each exercise assignment should support:
- Exercise name
- Target muscle
- Workout type
- Number of sets
- Target repetitions
- Target weight
- Rest duration
- Exercise order
- Notes

Example:

Monday – Chest

1. Barbell Bench Press
   - 4 sets
   - 10 reps

2. Incline Dumbbell Press
   - 3 sets
   - 12 reps

3. Cable Fly
   - 3 sets
   - 15 reps

Requirements:
- Add multiple exercises.
- Remove exercises.
- Reorder exercises.
- Edit sets and repetitions.
- Show target muscle groups.
- Allow different exercises for every week.
- Allow different workout structures for every day.

---

## PROMPT 8 – WORKOUT SESSION TRACKING

Build the actual workout tracking screen.

I want to use this screen while exercising at the gym.

When I start a scheduled workout:
- Start workout session.
- Show today's assigned exercises.
- Display sets and repetitions.
- Allow entering actual weights and repetitions.
- Mark completed sets.
- Add additional sets.
- Skip an exercise.
- Add workout notes.
- Finish the workout.

Each set log should record:
- Exercise
- Set number
- Weight
- Repetitions
- Completion status
- Timestamp (where appropriate)

Session information:
- Start time
- End time
- Duration
- Completed exercises
- Total completed sets
- Notes

Important:
- Save data immediately or reliably as the workout progresses.
- Prevent accidental data loss if the page refreshes.
- Allow viewing previous workout sessions.
- Do not overwrite planned targets with actual workout results.

---

## PROMPT 9 – CARDIO TRACKING

Build a separate Cardio Tracking module.

Supported cardio activities:
- Treadmill
- Walking
- Running
- Cycling
- Elliptical
- Stair Climber
- Rowing
- Other

Cardio log fields:
- Activity
- Date
- Duration
- Distance
- Speed
- Incline
- Calories (optional)
- Notes

Requirements:
- Add cardio during a workout session.
- Add standalone cardio sessions.
- View cardio history.
- Filter by date.
- Show weekly cardio duration.
- Show total distance.
- Integrate cardio data into the dashboard and progress reports.

---

## PROMPT 10 – WORKOUT CALENDAR

Build a calendar based on actual calendar dates.

Requirements:
- Monthly calendar view.
- Weekly calendar view.
- Navigate previous and next months.
- Display scheduled workout days.
- Display rest days.
- Display completed workouts.
- Display missed workouts.
- Click a date to view workout details.
- Show assigned muscle groups.
- Show exercise count.
- Show cardio information.

Important:
The calendar must use real dates based on the workout cycle start date.

Do not use static weekday labels without date calculations.

Ensure date handling works correctly across months and years.

---

## PROMPT 11 – PROGRESS TRACKING

Build a complete Progress Tracking module.

Body measurements:
- Body weight
- Height
- Chest
- Waist
- Hips
- Left arm
- Right arm
- Left thigh
- Right thigh
- Body fat percentage (optional)

Requirements:
- Add body measurements by date.
- Edit and delete measurement records.
- View historical measurements.
- Show weight change.
- Display charts for measurements.
- Show progress over selectable date ranges.
- Allow comparing two dates.

Workout progress:
- Exercise-wise weight progression.
- Repetition progression.
- Total completed workouts.
- Workout consistency.
- Weekly training volume.
- Muscle group training frequency.

Use meaningful charts with actual database data.

Do not generate fake progress values.

---

## PROMPT 12 – DASHBOARD INTEGRATION

Upgrade the existing dashboard to use real API data.

Dashboard sections:

1. Greeting and current date.
2. Active workout cycle.
3. Current cycle week.
4. This week's scheduled sessions.
5. Completed sessions.
6. Workout consistency.
7. Today's workout.
8. Upcoming workouts.
9. Recent workout history.
10. Body weight summary.
11. Weekly cardio summary.
12. Setup checklist.

Requirements:
- Every metric must come from actual database data.
- Clicking dashboard cards should navigate to relevant pages.
- Display helpful empty states for new users.
- Refresh data after creating or completing workouts.
- Avoid hardcoded dashboard values.

---

## PROMPT 13 – SETTINGS

Build a Settings page.

Requirements:

General:
- Application name.
- Preferred units: KG / LB.
- Distance units: KM / MILES.
- First day of the week.
- Date format.

Workout:
- Default rest time.
- Default workout duration.
- Default cardio units.

Data management:
- Export workout history.
- Export body measurements.
- Export cardio history.
- Database backup/download.
- Restore backup only with appropriate validation and confirmation.

Important:
This is a personal application. Do not add authentication or user registration.

---

## PROMPT 14 – BACKEND QUALITY & DATABASE VALIDATION

Review the entire backend.

Requirements:
- Check SQLAlchemy models.
- Check foreign key relationships.
- Check cascade delete behavior.
- Check nullable fields.
- Check unique constraints.
- Check indexes.
- Check database transactions.
- Check API validation.
- Check error handling.
- Check Alembic migration history.
- Check SQLite foreign key enforcement.

Add:
- Pydantic request and response schemas.
- Proper HTTP status codes.
- Consistent API response structures.
- Pagination where required.
- Filtering and sorting where appropriate.

Do not delete existing workout data during migrations.

Test all APIs using automated tests.

---

## PROMPT 15 – FRONTEND QUALITY & ERROR HANDLING

Review the complete React application.

Requirements:
- Check all routes.
- Check all navigation links.
- Check API service functions.
- Check TypeScript types.
- Check form validation.
- Check loading states.
- Check error messages.
- Check empty states.
- Check modal behavior.
- Check mobile layouts.
- Check console errors.
- Check accessibility and keyboard navigation.

Fix all major issues.

Do not leave non-functional buttons or dead links.

---

## PROMPT 16 – MOBILE / IPHONE OPTIMIZATION

Optimize the complete application for iPhone.

Requirements:
- Responsive layout for mobile screens.
- Mobile-friendly navigation.
- Proper touch target sizes.
- No horizontal scrolling.
- Forms must fit the screen.
- Calendar must be usable on mobile.
- Workout tracking screen must be easy to use inside the gym.
- Buttons must be accessible with one hand.
- Avoid tiny text.
- Ensure charts resize properly.
- Ensure the API works when accessing the frontend from another device on the same Wi-Fi.

Test at common mobile viewport widths.

---

## PROMPT 17 – FINAL APPLICATION TESTING & DELIVERY

Perform an end-to-end review of the entire Personal Gym Planner.

Test this complete user journey:

1. Open the dashboard.
2. Add muscle groups.
3. Add exercises to Exercise Library.
4. Create an 8-week workout cycle.
5. Configure Week 1.
6. Configure Week 2 with different exercises.
7. Assign workouts to weekdays.
8. Open the calendar.
9. Start a workout.
10. Enter actual sets, repetitions and weights.
11. Complete the workout.
12. Add cardio.
13. Add body measurements.
14. Review progress charts.
15. Return to dashboard and verify updated statistics.

Requirements:
- All frontend pages must work.
- All backend APIs must work.
- All database operations must persist.
- No mock data in production functionality.
- No broken routes.
- No console errors.
- No major API errors.
- No data loss during normal use.

Provide:
1. Final project folder structure.
2. List of implemented features.
3. List of API endpoints.
4. Database table overview.
5. Installation instructions for Windows.
6. Backend run commands.
7. Frontend run commands.
8. Database backup instructions.
9. Test results.
10. Known limitations.

Keep local development compatible with Windows without Docker.

Do not start AWS deployment until the local application is fully tested and approved.