import Link from "next/link";
import type {ReactNode} from "react";
import {chainConfig} from "@/lib/config";
import {isMainnet} from "@agentvault/shared";

/**
 * Operator console shell.
 *
 * `(vault)` is a route group: it wraps these pages in a shared layout without
 * adding a `/vault` prefix to their URLs.
 */
const NAV = [
  {href: "/vault", label: "Vault"},
  {href: "/policy", label: "Policy"},
  {href: "/sessions", label: "Sessions"},
  {href: "/activity", label: "Activity"},
  {href: "/demo", label: "Agent demo"},
] as const;

export default function VaultLayout({children}: {children: ReactNode}) {
  const mainnet = isMainnet(chainConfig);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-vault-border pb-4">
        <Link href="/" className="font-semibold">
          AgentVault
        </Link>

        {/* Which network the operator is on is never incidental information:
            5042 moves real USDC, 5042002 does not. */}
        <span
          className={`rounded-full border px-3 py-1 text-xs ${
            mainnet ? "border-deny text-deny" : "border-vault-border text-vault-muted"
          }`}
        >
          {chainConfig.name} · {chainConfig.chainId}
          {mainnet ? " · REAL FUNDS" : ""}
        </span>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-vault-border py-3 text-sm">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-1.5 text-vault-muted transition hover:bg-vault-surface hover:text-vault-text"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <main className="py-8">{children}</main>
    </div>
  );
}
