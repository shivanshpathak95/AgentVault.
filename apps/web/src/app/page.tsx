import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <p className="text-sm uppercase tracking-widest text-vault-muted">AgentVault</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-5xl">
          Give AI agents money.
          <br />
          <span className="text-vault-muted">Not unlimited control.</span>
        </h1>
      </div>

      <p className="max-w-xl text-lg text-vault-muted">
        Fund a vault, define a spending policy, and hand an agent a restricted session. The
        agent can request payments. The smart contract decides whether they happen.
      </p>

      <p className="font-mono text-sm text-agent">AI proposes. Code disposes.</p>

      <div>
        <Link
          href="/vault"
          className="inline-block rounded-lg border border-vault-border bg-vault-surface px-5 py-3 text-sm font-medium transition hover:border-operator"
        >
          Open operator console →
        </Link>
      </div>
    </main>
  );
}
