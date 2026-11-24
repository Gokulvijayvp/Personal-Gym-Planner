import { useState } from "react";
import Modal from "../../components/ui/Modal";
import CatalogueBrowser from "./CatalogueBrowser";

interface Props {
  /** `changed` = at least one exercise was added, so the list behind should refresh. */
  onClose: (changed: boolean) => void;
  /** Open the manual form for an exercise that is not in the catalogue. */
  onCreateCustom: (changed: boolean) => void;
}

/** The catalogue in a dialog (used from the Exercise Library list). */
export default function CataloguePicker({ onClose, onCreateCustom }: Props) {
  const [count, setCount] = useState(0);
  const changed = count > 0;
  return (
    <Modal title="Add exercise" size="lg" onClose={() => onClose(changed)} closeOnBackdrop
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={() => onCreateCustom(changed)}>Can&apos;t find it? Create your own</button>
        <button type="button" className="btn" onClick={() => onClose(changed)}>Done</button>
      </>}>
      <CatalogueBrowser onAddedCount={setCount} />
    </Modal>
  );
}
