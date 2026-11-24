import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { initSession } from "./services/authService";
import { ToastProvider } from "./components/ui/Toast";
import "./styles.css";
import "./styles/ui.css";
import "./styles/exercises.css";
import "./styles/planner.css";
import "./styles/calendar.css";
import "./styles/settings.css";
import "./styles/home.css";
import "./styles/workout.css";
import "./styles/progress.css";
import "./styles/masters.css";
import "./styles/quickplan.css";
import "./styles/auth.css";
import "./styles/mobile.css";   // phone layout: compact headers, content first
import "./styles/theme.css";   // design tokens last: the single source of colour

initSession();   // ask the server who is signed in (the cookie decides); the route guards wait for the answer

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter><ToastProvider><App /></ToastProvider></BrowserRouter>
  </React.StrictMode>
);
