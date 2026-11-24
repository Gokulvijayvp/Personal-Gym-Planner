export default function ExerciseListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="ex-grid" aria-busy="true" aria-label="Loading exercises" role="status">
      {Array.from({ length: count }, (_, i) => (
        <div className="ex-card skeleton-card" key={i} data-testid="exercise-skeleton">
          <div className="skeleton sk-title" />
          <div className="sk-row"><div className="skeleton sk-tag" /><div className="skeleton sk-tag" /><div className="skeleton sk-tag" /></div>
          <div className="skeleton sk-line" />
          <div className="skeleton sk-line short" />
          <div className="sk-row"><div className="skeleton sk-btn" /><div className="skeleton sk-btn" /><div className="skeleton sk-btn" /></div>
        </div>
      ))}
    </div>
  );
}
