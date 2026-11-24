import Modal from "../../components/ui/Modal";
import type { CatalogueItem } from "../../types/catalogue";
import MediaCarousel from "./MediaCarousel";

interface Props {
  item: CatalogueItem;
  /** Names of the animation styles, for the "Movement" line. */
  motions?: Record<string, string>;
  onClose: () => void;
}

/** An exercise's name and details with its pictures and videos (auto-sliding, video last). Opened by tapping an exercise. */
export default function ExerciseDetailDialog({ item, motions = {}, onClose }: Props) {
  return (
    <Modal title={item.name} size="sm" onClose={onClose} closeOnBackdrop
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <div className="cat-detail">
        <MediaCarousel media={item.media ?? []} motion={item.icon_motion} alt={item.name} />
        <dl>
          <div><dt>Muscle group</dt><dd>{item.muscle_group}</dd></div>
          {item.target_area && <div><dt>Target area</dt><dd>{item.target_area}</dd></div>}
          <div><dt>Equipment</dt><dd>{item.equipment}</dd></div>
          <div><dt>Movement</dt><dd>{item.movement || (motions[item.icon_motion] ?? item.icon_motion)}</dd></div>
        </dl>
      </div>
    </Modal>
  );
}
