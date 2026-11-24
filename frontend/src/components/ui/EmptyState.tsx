import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface Props { Icon: LucideIcon; title: string; description: string; children?: ReactNode }

export default function EmptyState({ Icon, title, description, children }: Props) {
  return (
    <div className="empty">
      <span><Icon size={25} /></span>
      <b>{title}</b>
      <p>{description}</p>
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
}
