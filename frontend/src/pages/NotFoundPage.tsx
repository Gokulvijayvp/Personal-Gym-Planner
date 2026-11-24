import { Link } from "react-router-dom";
import { SearchX } from "lucide-react";
import PageHeader from "../components/ui/PageHeader";
import EmptyState from "../components/ui/EmptyState";

export default function NotFoundPage() {
  return (
    <>
      <PageHeader eyebrow="404" title="Page not found" />
      <section className="panel page-empty">
        <EmptyState Icon={SearchX} title="This page doesn't exist" description="Check the address or head back home." />
        <p className="center"><Link className="btn" to="/">Back to Home</Link></p>
      </section>
    </>
  );
}
