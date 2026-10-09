import type {ReactNode} from "react";

/**
 * Scaffolding marker for a route that exists but is not built yet.
 *
 * Each one states what the page will own, so the routing skeleton doubles as the
 * build plan rather than being a set of empty files.
 */
export function Placeholder({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <span className="rounded-full border border-vault-border px-2.5 py-0.5 text-xs text-vault-muted">
          {phase}
        </span>
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-vault-muted">{children}</div>
    </section>
  );
}
