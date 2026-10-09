"use client";

import {useQuery} from "@tanstack/react-query";
import {useMemo} from "react";
import {Icon} from "@/components/ui/Icon";
import {
  AddressChip,
  Button,
  Callout,
  EmptyState,
  PageHeader,
  Panel,
  StatusPill,
} from "@/components/ui/Panel";
import {ProvenanceTag} from "@/components/ui/Provenance";
import {useAgentServices, useAgentStatus, useRecipientApprovals} from "@/hooks/useVault";
import {AGENT_API_URL} from "@/lib/agent-api";
import {chainConfig} from "@/lib/config";
import {explorerAddress, usdc} from "@/lib/format";

/**
 * The configured service registry.
 *
 * Everything here comes from the agent runtime's own environment — nothing is
 * invented in the browser. Approval status is read from the contract, because
 * "the operator configured this recipient" and "the contract will actually let
 * the agent pay it" are different facts and only the second one matters.
 */

/** Liveness probe against each service's own health endpoint. */
function useServiceHealth(baseUrl: string | undefined) {
  return useQuery({
    queryKey: ["service", "health", baseUrl],
    enabled: Boolean(baseUrl),
    refetchInterval: 20_000,
    retry: 0,
    queryFn: async () => {
      const res = await fetch(`${baseUrl}/health`, {signal: AbortSignal.timeout(5000)});
      if (!res.ok) throw new Error(`Service returned ${res.status}`);
      return (await res.json()) as {ok: boolean; invoices?: number};
    },
  });
}

export default function ServicesPage() {
  const services = useAgentServices();
  const status = useAgentStatus();
  const sessionKey = status.data?.sessionKey;

  const recipients = useMemo(
    () => services.data?.services.map((s) => s.recipient) ?? [],
    [services.data],
  );
  const {approvals, enabled: approvalsEnabled} = useRecipientApprovals(sessionKey, recipients);

  // The services are hosted by apps/service; the agent knows its base URL but
  // does not proxy /health, so probe it directly from the browser.
  const serviceBase = process.env.NEXT_PUBLIC_SERVICE_API_URL?.replace(/\/+$/, "");
  const health = useServiceHealth(serviceBase);

  return (
    <>
      <PageHeader
        title="Services"
        description="What the agent can buy, what it costs, and whether the contract permits paying for it."
      />

      <div className="flex flex-col gap-4">
        <Callout tone="info" title="Configured, not discovered">
          Prices and recipients come from the agent runtime&apos;s environment. The agent
          cross-checks every quote against this registry before paying, so a service that asks to
          be paid somewhere else is refused before any gas is spent — and the contract&apos;s
          allowlist refuses it again regardless.
        </Callout>

        {services.isError ? (
          <Callout tone="warn" title="Registry unavailable">
            Could not reach the agent backend at <code className="text-ink">{AGENT_API_URL}</code>.
            Start it with <code className="text-ink">pnpm dev:agent</code>.
          </Callout>
        ) : null}

        <Panel
          title="Service registry"
          padded={false}
          actions={
            <div className="flex items-center gap-2">
              <ProvenanceTag value="backend" />
              <Button variant="ghost" onClick={() => void services.refetch()}>
                <Icon.Refresh size={12} />
              </Button>
            </div>
          }
        >
          {services.isLoading ? (
            <div className="flex flex-col gap-px">
              {[0, 1].map((i) => (
                <div key={i} className="h-24 bg-raised/40 pending-pulse" />
              ))}
            </div>
          ) : (services.data?.services.length ?? 0) === 0 ? (
            <EmptyState title="No services configured" icon={<Icon.Services size={20} />}>
              The agent runtime has no service registry. Check{" "}
              <code>WEATHER_SERVICE_ADDRESS</code> and <code>RESEARCH_SERVICE_ADDRESS</code>.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {services.data?.services.map((s) => {
                const approved = approvals.get(s.recipient.toLowerCase());
                return (
                  <li key={s.id} className="flex flex-col gap-3 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-[13px] font-semibold text-ink">{s.name}</h3>
                          <code className="rounded-sm border border-line bg-raised px-1 py-px text-[10px] text-ink-subtle">
                            {s.id}
                          </code>
                        </div>
                        <p className="mt-1 max-w-prose text-xs leading-5 text-ink-muted">
                          {s.description}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="tnum block text-base text-ink">{usdc(s.priceUsdc)}</span>
                        <span className="text-[10px] uppercase tracking-wider text-ink-subtle">
                          USDC per call
                        </span>
                      </div>
                    </div>

                    <dl className="grid gap-x-6 gap-y-2 text-[11px] sm:grid-cols-3">
                      <div>
                        <dt className="uppercase tracking-wider text-ink-subtle">Recipient</dt>
                        <dd className="mt-1">
                          <AddressChip
                            address={s.recipient}
                            href={explorerAddress(chainConfig.explorerUrl, s.recipient)}
                          />
                        </dd>
                      </div>

                      <div>
                        <dt className="uppercase tracking-wider text-ink-subtle">
                          Endpoint status
                        </dt>
                        <dd className="mt-1 flex items-center gap-1.5">
                          {!serviceBase ? (
                            <span className="text-ink-subtle">not configured</span>
                          ) : health.isLoading ? (
                            <StatusPill status="pending" />
                          ) : health.isError ? (
                            <span className="text-deny">unreachable</span>
                          ) : (
                            <span className="text-allow">online</span>
                          )}
                        </dd>
                      </div>

                      <div>
                        <dt className="uppercase tracking-wider text-ink-subtle">
                          Policy approval
                        </dt>
                        <dd className="mt-1 flex items-center gap-1.5">
                          {!approvalsEnabled ? (
                            <span className="text-ink-subtle">connect wallet to verify</span>
                          ) : approved === undefined ? (
                            <StatusPill status="pending" />
                          ) : approved ? (
                            <span className="inline-flex items-center gap-1 text-allow">
                              <Icon.Check size={11} /> allowlisted
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-deny">
                              <Icon.Deny size={11} /> not allowlisted
                            </span>
                          )}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-subtle">
                      <span className="rounded-sm border border-line bg-raised px-1.5 py-0.5">
                        parameter: <span className="text-ink-muted">{s.parameter.name}</span>
                      </span>
                      <span>{s.parameter.description}</span>
                    </div>

                    {approvalsEnabled && approved === false ? (
                      <Callout tone="deny" title="The agent cannot pay this service">
                        The contract has no allowlist entry for this recipient, so any payment to it
                        is refused with <code className="text-ink">RecipientNotAllowed</code>.
                        Approve it on the Policy page.
                      </Callout>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="How a purchase works">
          <ol className="flex flex-col gap-2 text-xs leading-5 text-ink-muted">
            {[
              "The agent asks the service for a quote. The service replies 402 Payment Required with an invoice id, a price and a payment address.",
              "The agent checks that quote against this registry. A changed recipient, token or price is refused here, before any gas.",
              "The agent asks the vault to pay. The contract runs every policy check and either transfers USDC or reverts with a specific error.",
              "The service independently verifies the settled payment on chain — the right vault, recipient, token, amount and invoice — before returning anything.",
              "One invoice redeems once, and one transaction settles one invoice, so a receipt cannot be replayed.",
            ].map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="tnum mt-px w-4 shrink-0 text-right text-ink-subtle">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}
