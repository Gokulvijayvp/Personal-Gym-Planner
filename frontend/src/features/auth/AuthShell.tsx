import { useState } from "react";
import type { ReactNode } from "react";
import { Dumbbell, CalendarCheck, TrendingUp } from "lucide-react";

/** Shared frame for Login, Sign up and Verify: brand panel on desktop, one clean card everywhere. */
export default function AuthShell({ children }: { children: ReactNode }) {
  const [bgFailed, setBgFailed] = useState(false);   // if the picture can't load, the charcoal page background stays
  return (
    <div className="auth">
      {!bgFailed && (
        <picture className="auth-bg" aria-hidden>
          <source media="(max-width: 860px)" srcSet="/auth-hero-mobile.webp" />
          <img src="/auth-hero.webp" alt="" decoding="async" fetchPriority="high" onError={() => setBgFailed(true)} />
        </picture>
      )}
      <div className="auth-shade" aria-hidden />
      <aside className="auth-brand" aria-hidden>
        <span className="brand-icon"><Dumbbell size={22} /></span>
        <h2>Gym Planner</h2>
        <p>Plan your week. Train with focus. See your progress.</p>
        <ul>
          <li><CalendarCheck size={18} /> Weekly plans in a few taps</li>
          <li><TrendingUp size={18} /> Track every workout</li>
        </ul>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <div className="auth-logo"><span className="brand-icon"><Dumbbell size={18} /></span><b>Gym Planner</b></div>
          {children}
        </div>
      </main>
    </div>
  );
}
