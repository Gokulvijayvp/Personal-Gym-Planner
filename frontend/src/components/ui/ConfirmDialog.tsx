import type { ReactNode } from "react";
import Modal from "./Modal";

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  /** Shown inside the dialog (e.g. "can't delete: in use") instead of closing it. */
  error?: string | null;
  /** Optional safer alternative offered next to Confirm (e.g. "Deactivate instead"). */
  alternative?: { label: string; onClick: () => void } | null;
  /** Hide the confirm button, e.g. once the action is known to be impossible. */
  hideConfirm?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title, children, confirmLabel, cancelLabel = "Cancel", tone = "default", busy = false, error, alternative,
  hideConfirm = false, onConfirm, onCancel,
}: Props) {
  return (
    <Modal
      title={title} size="sm" role="alertdialog" onClose={onCancel} dismissible={!busy} closeOnBackdrop
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy} data-autofocus>{cancelLabel}</button>
          {alternative && (
            <button type="button" className="btn btn-outline" onClick={alternative.onClick} disabled={busy}>{alternative.label}</button>
          )}
          {!hideConfirm && (
            <button type="button" className={tone === "danger" ? "btn btn-danger" : "btn"} onClick={onConfirm} disabled={busy}>
              {busy ? "Working…" : confirmLabel}
            </button>
          )}
        </>
      }
    >
      <div className="confirm-text">{children}</div>
      {error && <p className="form-alert" role="alert">{error}</p>}
    </Modal>
  );
}
