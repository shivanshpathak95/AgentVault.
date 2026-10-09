"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";
import {useEffect, useState, type ReactNode} from "react";
import {Icon} from "@/components/ui/Icon";
import {WalletBar} from "./WalletBar";

interface NavItem {
  href: string;
  label: string;
  icon: (p: {size?: number; className?: string}) => ReactNode;
  /** "/" must match exactly, or it would light up on every route. */
  exact?: boolean;
}

const NAV: NavItem[] = [
  {href: "/", label: "Overview", icon: Icon.Overview, exact: true},
  {href: "/agent", label: "Agent", icon: Icon.Agent},
  {href: "/policy", label: "Policy", icon: Icon.Policy},
  {href: "/activity", label: "Activity", icon: Icon.Activity},
  {href: "/services", label: "Services", icon: Icon.Services},
];

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({onNavigate}: {onNavigate?: () => void}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        const IconCmp = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            {...(onNavigate ? {onClick: onNavigate} : {})}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
              active
                ? "bg-raised text-ink"
                : "text-ink-muted hover:bg-surface hover:text-ink"
            }`}
          >
            <span className={active ? "text-accent-ink" : "text-ink-subtle"}>
              <IconCmp size={15} />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2">
      {/* The mark is the product thesis: a bounded aperture, not a vault door. */}
      <span className="flex size-6 items-center justify-center rounded-sm border border-accent-soft bg-accent-soft/30">
        <Icon.Lock size={12} className="text-accent-ink" />
      </span>
      <span className="text-[13px] font-semibold tracking-tight text-ink">AgentVault</span>
    </Link>
  );
}

export function AppShell({children}: {children: ReactNode}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // The drawer closes on navigation via each link's onNavigate callback rather
  // than an effect on pathname — syncing state to a route in an effect causes a
  // cascading render, and the click already knows it is navigating.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[216px_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:border focus:border-line focus:bg-raised focus:px-3 focus:py-2 focus:text-xs"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <div className="px-1.5">
          <Wordmark />
        </div>

        <div className="mt-6 flex-1">
          <NavLinks />
        </div>

        <p className="px-2 text-[11px] leading-4 text-ink-subtle">
          AI proposes.
          <br />
          <span className="text-ink-muted">Code disposes.</span>
        </p>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            className="rounded-md border border-line bg-raised p-1.5 text-ink-muted hover:text-ink"
          >
            {mobileOpen ? <Icon.Close size={15} /> : <Icon.Menu size={15} />}
          </button>
          <Wordmark />
        </div>
        <WalletBar />
      </header>

      {mobileOpen ? (
        <div
          id="mobile-nav"
          className="sticky top-12.25 z-20 border-b border-line bg-surface px-3 py-3 lg:hidden"
        >
          <NavLinks onNavigate={() => setMobileOpen(false)} />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col">
        {/* Desktop top bar */}
        <header className="sticky top-0 z-20 hidden items-center justify-end border-b border-line bg-base/90 px-6 py-2.5 backdrop-blur lg:flex">
          <WalletBar />
        </header>

        <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
