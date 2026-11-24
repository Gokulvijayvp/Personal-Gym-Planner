import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CatalogueMedia } from "../../types/catalogue";
import ExerciseIcon from "../masters/ExerciseIcon";

interface Props {
  media: CatalogueMedia[];
  /** Animated icon shown when nothing has been uploaded. */
  motion: string;
  alt: string;
  /** Milliseconds a picture stays before sliding on. */
  intervalMs?: number;
}

/**
 * Uploaded pictures slide on their own, with the video (always last) at the end. A video is not auto-advanced:
 * it plays on request, and once it finishes the carousel starts again from the first picture.
 * With nothing uploaded it shows the exercise's animated icon.
 */
export default function MediaCarousel({ media, motion, alt, intervalMs = 3500 }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);
  const count = media.length;
  const current = media[Math.min(index, Math.max(count - 1, 0))];

  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);

  const go = useCallback((n: number) => setIndex(count === 0 ? 0 : (n + count) % count), [count]);

  // pictures slide on by themselves; a video stays until it ends (or the viewer moves on)
  useEffect(() => {
    if (count < 2 || paused || !current || current.kind === "video") return;
    const t = window.setTimeout(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => window.clearTimeout(t);
  }, [count, paused, current, index, intervalMs]);

  if (count === 0 || !current) {
    return <span className="cat-detail-icon"><ExerciseIcon motion={motion} size={132} /></span>;
  }

  return (
    <div className="mc" role="group" aria-roledescription="carousel" aria-label={`${alt} pictures and videos`}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
      }}>
      <div className="mc-stage" aria-live="off">
        {current.kind === "video" ? (
          <video key={current.id} className="mc-media" src={current.url} controls playsInline preload="metadata"
            onEnded={() => go(0)} aria-label={`${alt} video`} />
        ) : (
          <img key={current.id} className="mc-media" src={current.url} alt={`${alt}, picture ${index + 1} of ${count}`} />
        )}
        {count > 1 && (
          <>
            <button type="button" className="mc-nav mc-prev" aria-label="Previous" onClick={() => go(index - 1)}><ChevronLeft size={18} /></button>
            <button type="button" className="mc-nav mc-next" aria-label="Next" onClick={() => go(index + 1)}><ChevronRight size={18} /></button>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="mc-dots" role="tablist" aria-label="Choose a picture or video">
          {media.map((m, i) => (
            <button key={m.id} type="button" role="tab" aria-selected={i === index}
              aria-label={`${m.kind === "video" ? "Video" : `Picture ${i + 1}`}`}
              className={i === index ? "mc-dot is-on" : "mc-dot"} onClick={() => setIndex(i)} />
          ))}
        </div>
      )}
    </div>
  );
}
