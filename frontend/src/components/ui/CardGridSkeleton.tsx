export default function CardGridSkeleton({ count = 3, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <div className="ex-grid" aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: count }, (_, i) => (
        <div className="ex-card skeleton-card" key={i} data-testid="card-skeleton">
          <div className="skeleton sk-title" />
          <div className="skeleton sk-line" />
          <div className="skeleton sk-line short" />
          <div className="sk-row"><div className="skeleton sk-btn" /><div className="skeleton sk-btn" /></div>
        </div>
      ))}
    </div>
  );
}
