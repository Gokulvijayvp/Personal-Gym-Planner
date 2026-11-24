import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

interface Props {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
  /** A back arrow above the title that leads to another page (e.g. back to Workout). */
  back?: { to: string; label: string };
}

export default function PageHeader({ eyebrow, title, description, children, back }: Props) {
  return (
    <header className="topbar">
      <div>
        {back && (
          <Link to={back.to} className="back-link" aria-label={`Back to ${back.label}`}>
            <ArrowLeft size={16} aria-hidden /> <span>{back.label}</span>
          </Link>
        )}
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {children}
    </header>
  );
}
