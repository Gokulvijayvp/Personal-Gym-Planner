import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Footer (buttons). Rendered outside the scrolling body so actions stay visible on phones. */
  footer?: ReactNode;
  /** When false (e.g. while saving) Esc / backdrop / X do nothing. */
  dismissible?: boolean;
  /** Clicking the dimmed backdrop closes the dialog. Off for forms so typed data isn't lost by accident. */
  closeOnBackdrop?: boolean;
  size?: "sm" | "md" | "lg";
  role?: "dialog" | "alertdialog";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open modals, topmost last. Only the topmost one reacts to Esc / Tab, so a confirm dialog opened
// from inside another dialog closes alone. The page scroll lock is released with the last one.
const openModals: symbol[] = [];
let savedScrollY = 0;

export default function Modal({
  title, onClose, children, footer, dismissible = true, closeOnBackdrop = false, size = "md", role = "dialog",
}: Props) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const me = Symbol("modal");
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Focus the first field (not the close button) so typing can start immediately.
    const first = panel?.querySelector<HTMLElement>("[data-autofocus], input, textarea, select") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    if (openModals.length === 0) {
      savedScrollY = window.scrollY;
      document.body.style.overflow = "hidden";
    }
    openModals.push(me);

    function onKeyDown(e: KeyboardEvent) {
      if (openModals[openModals.length - 1] !== me) return; // not the topmost dialog
      if (e.key === "Escape" && dismissibleRef.current) { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      openModals.splice(openModals.indexOf(me), 1);
      if (openModals.length === 0) {
        document.body.style.overflow = "";
        window.scrollTo(0, savedScrollY);
      }
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => {
      if (closeOnBackdrop && dismissible && e.target === e.currentTarget) onClose();
    }}>
      <div ref={panelRef} className={`modal modal-${size}`} role={role} aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" disabled={!dismissible} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
