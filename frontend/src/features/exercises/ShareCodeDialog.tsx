import { useRef, useState } from "react";
import { Copy } from "lucide-react";
import Modal from "../../components/ui/Modal";
import { useToast } from "../../components/ui/Toast";
import type { ShareCreated } from "../../types/exerciseSet";
import { copyText } from "./copyText";

interface Props { share: ShareCreated; copied: boolean; onClose: () => void }

/** Shows the share code (already copied for you) so it can be copied again or read out. */
export default function ShareCodeDialog({ share, copied, onClose }: Props) {
  const toast = useToast();
  const box = useRef<HTMLInputElement>(null);
  const [again, setAgain] = useState(false);

  async function copy() {
    const ok = await copyText(share.code);
    if (ok) { setAgain(true); toast.success("Code copied."); }
    else { box.current?.select(); toast.error("Your browser blocked copying. The code is selected: press Ctrl+C."); }
  }

  const days = Math.max(1, Math.round((new Date(share.expires_at).getTime() - Date.now()) / 86_400_000));
  return (
    <Modal title="Share my exercises" size="sm" onClose={onClose} closeOnBackdrop
      footer={<button type="button" className="btn" onClick={onClose}>Done</button>}>
      <div className="shc">
        <p>{copied ? "Your code is copied. Send it to the other person." : "Copy this code and send it to the other person."}</p>
        <div className="shc-row">
          <input ref={box} className="shc-code" readOnly value={share.code} aria-label="Share code" onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-outline" onClick={copy}><Copy size={16} aria-hidden /> {again ? "Copied" : "Copy"}</button>
        </div>
        <p className="hint">
          It holds your {share.sets_count} {share.sets_count === 1 ? "set" : "sets"} exactly as they are now, and works for about {days} days.
          When they paste it, it replaces their My exercises. Your own list is not changed.
        </p>
      </div>
    </Modal>
  );
}
