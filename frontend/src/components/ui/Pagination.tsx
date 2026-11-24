import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props { page: number; pages: number; onChange: (page: number) => void; disabled?: boolean }

export default function Pagination({ page, pages, onChange, disabled = false }: Props) {
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Pagination">
      <button type="button" className="btn btn-outline" disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>
        <ChevronLeft size={16} /> Previous
      </button>
      <span aria-live="polite">Page {page} of {pages}</span>
      <button type="button" className="btn btn-outline" disabled={disabled || page >= pages} onClick={() => onChange(page + 1)}>
        Next <ChevronRight size={16} />
      </button>
    </nav>
  );
}
