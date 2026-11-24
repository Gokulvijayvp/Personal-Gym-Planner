import type { CatalogueItem } from "../../types/catalogue";
import ExerciseIcon from "../masters/ExerciseIcon";

interface Props {
  /** The catalogue entry, when known. Its first uploaded picture is shown. */
  item?: CatalogueItem | null;
  /** Animated icon to fall back on (defaults to the item's own). */
  motion?: string;
  size: number;
}

/** The exercise's first uploaded picture; failing that the first frame of its video; failing that the animated icon. */
export default function ExerciseThumb({ item, motion, size }: Props) {
  const media = item?.media ?? [];
  const picture = media.find((m) => m.kind === "image");
  if (picture) return <img className="thumb-img" src={picture.url} alt="" loading="lazy" />;
  const video = media.find((m) => m.kind === "video");
  if (video) return <video className="thumb-img" src={`${video.url}#t=0.1`} muted playsInline preload="metadata" aria-hidden />;
  return <ExerciseIcon motion={motion ?? item?.icon_motion} size={size} />;
}
