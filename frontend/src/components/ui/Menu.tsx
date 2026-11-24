import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A line is drawn above this item. */
  separated?: boolean;
}

interface Props { label: string; items: MenuItem[]; align?: "left" | "right"; children?: ReactNode }

/** A small "…" menu: opens on tap, closes on outside tap, Escape or choosing an item; arrow keys move between items. */
export default function Menu({ label, items, align = "right", children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); root.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", away); document.addEventListener("touchstart", away); document.addEventListener("keydown", esc);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus());
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("touchstart", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const els = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (els.length === 0) return;
    e.preventDefault();
    els[(i + (e.key === "ArrowDown" ? 1 : els.length - 1)) % els.length].focus();
  }

  return (
    <div className="menu" ref={root}>
      <button type="button" className={children ? "btn btn-outline btn-sm" : "icon-btn menu-trigger"} aria-label={label}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        {children ?? <Ellipsis size={18} />}
      </button>
      {open && (
        <div className={align === "right" ? "menu-list is-right" : "menu-list"} role="menu" id={id} aria-label={label} onKeyDown={onKey}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled}
              className={`menu-item${it.danger ? " is-danger" : ""}${it.separated ? " is-sep" : ""}`}
              onClick={() => { setOpen(false); it.onSelect(); }}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
