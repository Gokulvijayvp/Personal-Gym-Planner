from fastapi import APIRouter
from app.api.v1 import health, dashboard, exercises, master_data, cycles, planned_items, calendar, app_settings, workouts, progress, exercise_masters, exercise_catalogue, exercise_sets, auth, plan_shares
from app.api.deps import csrf_protect, get_current_user, limit_writes
from fastapi import Depends

api_router = APIRouter()
# Open: health check and the sign-in endpoints. Everything else needs a valid access cookie.
api_router.include_router(health.router)
api_router.include_router(auth.router)

# Every private route is checked on the server, in this order: valid session -> CSRF token (writes) -> write rate limit.
_protected = APIRouter(dependencies=[Depends(get_current_user), Depends(csrf_protect), Depends(limit_writes)])
for _r in (dashboard, master_data, exercise_masters, exercise_catalogue, exercise_sets, exercises, cycles,
           plan_shares, planned_items, calendar, app_settings, workouts, progress):
    _protected.include_router(_r.router)
api_router.include_router(_protected)
