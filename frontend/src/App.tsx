import { Route, Routes } from "react-router-dom";
import AppLayout from "./components/layout/AppLayout";
import HomePage from "./pages/HomePage";
import CalendarPage from "./pages/CalendarPage";
import WorkoutPage from "./pages/WorkoutPage";
import WorkoutSessionPage from "./pages/WorkoutSessionPage";
import ProgressPage from "./pages/ProgressPage";
import ExercisesPage from "./pages/ExercisesPage";
import WorkoutCyclesPage from "./pages/WorkoutCyclesPage";
import WeeklyPlannerPage from "./pages/WeeklyPlannerPage";
import SettingsPage from "./pages/SettingsPage";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import VerifyOtpPage from "./pages/VerifyOtpPage";
import { PublicOnly, RequireAuth } from "./features/auth/RouteGuards";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  return (
    <Routes>
      {/* Sign-in screens sit outside the app shell (no sidebar). UI only: a mock service, no real authentication yet. */}
      <Route element={<PublicOnly />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="verify" element={<VerifyOtpPage />} />
      </Route>
      <Route element={<RequireAuth />}>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="workout" element={<WorkoutPage />} />
        <Route path="workout/:id" element={<WorkoutSessionPage />} />
        <Route path="progress" element={<ProgressPage />} />
        <Route path="exercises" element={<ExercisesPage />} />
        <Route path="cycles" element={<WorkoutCyclesPage />} />
        <Route path="planner" element={<WeeklyPlannerPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      </Route>
    </Routes>
  );
}
