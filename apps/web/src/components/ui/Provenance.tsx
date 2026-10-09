import type {ReactNode} from "react";
import {Icon} from "./Icon";

/**
 * Where a number came from.
 *
 * A financial console that blurs "read from the chain" with "a server told me"
 * is lying by omission, and this product's whole argument is about which layer
 * you can trust. Every figure in the UI carries one of these.
 *
 *   chain       read directly from the contract via the user's RPC
 *   backend     reported by the agent runtime — convenient, not authoritative
 *   demo        illustrative only; never used for balances or payment state
 *   unavailable the source could not be reached, so we show nothing
 *   loading     in flight
 */
export type Provenance = "chain" | "backend" | "demo" | "unavailable" | "loading";

const META: Record<Provenance, {label: string; title: string; className: string}> = {
  chain: {
    label: "on-chain",
    title: "Read directly from the AgentVault contract. Authoritative.",
    className: "text-accent-ink border-accent-soft bg-accent-soft/20",
  },
  backend: {
    label: "backend",
    title:
      "Reported by the agent runtime, not read from the chain by your wallet. " +
      "Convenient, but the contract is the authority.",
    className: "text-ink-muted border-line bg-raised",
  },
  demo: {
    label: "demo",
    title: "Illustrative value for layout only. Not live data.",
    className: "text-warn border-warn-soft bg-warn-soft/20",
  },
  unavailable: {
    label: "unavailable",
    title: "This source could not be reached.",
    className: "text-ink-subtle border-line bg-transparent",
  },
  loading: {
    label: "loading",
    title: "Reading…",
    className: "text-ink-subtle border-line bg-transparent",
  },
};

export function ProvenanceTag({value}: {value: Provenance}) {
  const meta = META[value];
  return (
    <span
      title={meta.title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
    >
      {value === "chain" ? <Icon.Chain size={9} /> : null}
      {value === "backend" ? <Icon.Server size={9} /> : null}
      {meta.label}
    </span>
  );
}

/**
 * A labelled figure with its provenance.
 *
 * Renders an explicit placeholder for loading and unavailable rather than a
 * zero: "0.00 USDC" and "we could not read your balance" must never look alike.
 */
export function Metric({
  label,
  value,
  unit,
  provenance,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  unit?: string | undefined;
  provenance: Provenance;
  hint?: string | undefined;
  tone?: "default" | "allow" | "deny" | "warn" | undefined;
}) {
  const toneClass =
    tone === "allow"
      ? "text-allow"
      : tone === "deny"
        ? "text-deny"
        : tone === "warn"
          ? "text-warn"
          : "text-ink";

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
          {label}
        </span>
        <ProvenanceTag value={provenance} />
      </div>

      {provenance === "loading" ? (
        <div className="h-6 w-24 rounded-sm bg-raised pending-pulse" aria-label={`${label} loading`} />
      ) : provenance === "unavailable" ? (
        <span className="text-base text-ink-subtle">Unavailable</span>
      ) : (
        <span className={`tnum text-lg leading-6 ${toneClass}`}>
          {value}
          {unit ? <span className="ml-1 text-xs text-ink-subtle">{unit}</span> : null}
        </span>
      )}

      {hint ? <span className="text-[11px] leading-4 text-ink-subtle">{hint}</span> : null}
    </div>
  );
}
