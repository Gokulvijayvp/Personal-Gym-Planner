import type { LucideIcon } from "lucide-react";
import PageHeader from "../components/ui/PageHeader";
import EmptyState from "../components/ui/EmptyState";

interface Props {
  eyebrow: string; title: string; Icon: LucideIcon;
  emptyTitle: string; emptyDescription: string;
}

/** Shared empty-state page used until each feature phase is built. */
export default function PlaceholderPage(p: Props) {
  return (
    <>
      <PageHeader eyebrow={p.eyebrow} title={p.title} />
      <section className="panel page-empty">
        <EmptyState Icon={p.Icon} title={p.emptyTitle} description={p.emptyDescription} />
      </section>
    </>
  );
}
