import { TriangleAlert } from "lucide-react";

interface Props { title?: string; message: string; onRetry?: () => void }

export default function ErrorState({ title = "Something went wrong", message, onRetry }: Props) {
  return (
    <div className="empty error-state" role="alert">
      <span><TriangleAlert size={25} /></span>
      <b>{title}</b>
      <p>{message}</p>
      {onRetry && <button type="button" className="btn btn-outline" onClick={onRetry}>Try again</button>}
    </div>
  );
}
