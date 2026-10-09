import type {ReactNode} from "react";
import {Icon} from "./Icon";

export function Panel({
  title,
  description,
  actions,
  children,
  className = "",
  padded = true,
}: {
  title?: string | undefined;
  description?: string | undefined;
  actions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
  padded?: boolean | undefined;
}) {
  return (
    <section className={`rounded-md border border-line bg-surface ${className}`}>
      {title ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
            {description ? (
              <p className="mt-0.5 max-w-prose text-xs leading-5 text-ink-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode | undefined;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-ink-muted">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "default",
  disabled,
  busy,
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void | undefined;
  type?: "button" | "submit" | undefined;
  variant?: "default" | "primary" | "danger" | "ghost" | undefined;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
  title?: string | undefined;
  className?: string | undefined;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45";
  const variants = {
    default: "border-line bg-raised text-ink hover:border-line-strong hover:bg-overlay",
    primary: "border-accent-soft bg-accent-soft/40 text-accent-ink hover:bg-accent-soft/70",
    danger: "border-deny-soft bg-deny-soft/30 text-deny hover:bg-deny-soft/55",
    ghost: "border-transparent bg-transparent text-ink-muted hover:bg-raised hover:text-ink",
  } as const;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {busy ? <Icon.Refresh size={12} className="pending-pulse" /> : null}
      {children}
    </button>
  );
}

export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode | undefined;
  icon?: ReactNode | undefined;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {icon ? <div className="text-ink-subtle">{icon}</div> : null}
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {children ? (
        <div className="max-w-md text-xs leading-5 text-ink-subtle">{children}</div>
      ) : null}
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "deny" | "allow" | undefined;
  title?: string | undefined;
  children: ReactNode;
}) {
  const tones = {
    info: "border-line bg-raised text-ink-muted",
    warn: "border-warn-soft bg-warn-soft/15 text-warn",
    deny: "border-deny-soft bg-deny-soft/15 text-deny",
    allow: "border-allow-soft bg-allow-soft/15 text-allow",
  } as const;

  const icons = {
    info: <Icon.Lock size={14} />,
    warn: <Icon.Alert size={14} />,
    deny: <Icon.Deny size={14} />,
    allow: <Icon.Check size={14} />,
  } as const;

  return (
    <div className={`flex gap-2.5 rounded-md border px-3 py-2.5 ${tones[tone]}`}>
      <span className="mt-0.5 shrink-0">{icons[tone]}</span>
      <div className="min-w-0 text-xs leading-5">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? "mt-0.5 text-ink-muted" : "text-ink-muted"}>{children}</div>
      </div>
    </div>
  );
}

/** Monospace address with a copy affordance and optional explorer link. */
export function AddressChip({
  address,
  href,
  label,
}: {
  address: string | undefined;
  href?: string | undefined;
  label?: string | undefined;
}) {
  if (!address) return <span className="text-xs text-ink-subtle">—</span>;

  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const body = (
    <>
      {label ? <span className="text-ink-subtle">{label}</span> : null}
      <span className="tnum text-[11px]">{short}</span>
      {href ? <Icon.External size={10} className="text-ink-subtle" /> : null}
    </>
  );

  const className =
    "inline-flex items-center gap-1.5 rounded-sm border border-line bg-raised px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink";

  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={className} title={address}>
      {body}
    </a>
  ) : (
    <span className={className} title={address}>
      {body}
    </span>
  );
}

export function StatusPill({
  status,
}: {
  status: "executed" | "rejected" | "failed" | "pending" | "active" | "inactive";
}) {
  const map = {
    executed: {label: "Settled", cls: "border-allow-soft bg-allow-soft/25 text-allow"},
    active: {label: "Active", cls: "border-allow-soft bg-allow-soft/25 text-allow"},
    rejected: {label: "Blocked by policy", cls: "border-deny-soft bg-deny-soft/25 text-deny"},
    failed: {label: "Failed", cls: "border-warn-soft bg-warn-soft/25 text-warn"},
    pending: {label: "Pending", cls: "border-line bg-raised text-ink-muted pending-pulse"},
    inactive: {label: "Inactive", cls: "border-line bg-raised text-ink-subtle"},
  } as const;

  const {label, cls} = map[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider ${cls}`}
    >
      {label}
    </span>
  );
}
