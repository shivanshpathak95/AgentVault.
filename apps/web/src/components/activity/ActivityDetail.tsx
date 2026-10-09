"use client";

import {REJECTION_EXPLANATION, type ActivityEntry} from "@agentvault/shared";
import {Icon} from "@/components/ui/Icon";
import {AddressChip, Callout, StatusPill} from "@/components/ui/Panel";
import {chainConfig} from "@/lib/config";
import {absoluteTime, explorerAddress, explorerTx, isTxHash, usdc} from "@/lib/format";

function Row({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="grid grid-cols-[108px_1fr] gap-3 px-4 py-2">
      <dt className="text-[11px] uppercase tracking-wider text-ink-subtle">{label}</dt>
      <dd className="min-w-0 text-xs text-ink">{children}</dd>
    </div>
  );
}

/**
 * Detail for one payment attempt.
 *
 * The honest part: a rejected payment reverted, so there is no transaction to
 * link and no on-chain log to show. This panel says so explicitly rather than
 * leaving a blank where a hash would be, and it never fabricates one.
 */
export function ActivityDetail({
  entry,
  onClose,
}: {
  entry: ActivityEntry;
  onClose: () => void;
}) {
  const hasTx = isTxHash(entry.txHash);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[13px] font-semibold text-ink">
              {entry.serviceName ?? "Payment attempt"}
            </h2>
            <StatusPill status={entry.status} />
          </div>
          <p className="mt-0.5 text-[11px] text-ink-subtle">{absoluteTime(entry.timestamp)}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close detail"
          className="rounded-md border border-line bg-raised p-1 text-ink-muted hover:text-ink"
        >
          <Icon.Close size={13} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section>
          <h3 className="border-b border-line bg-raised/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            Requested payment
          </h3>
          <dl className="divide-y divide-line">
            <Row label="Amount">
              <span className="tnum">{usdc(entry.amount)} USDC</span>
            </Row>
            <Row label="Recipient">
              <AddressChip
                address={entry.recipient}
                href={explorerAddress(chainConfig.explorerUrl, entry.recipient)}
              />
            </Row>
            <Row label="Token">
              <AddressChip address={entry.token} />
            </Row>
            <Row label="Reference">
              <span className="tnum break-all text-ink-muted">{entry.reference}</span>
            </Row>
            {entry.serviceId ? (
              <Row label="Service">
                <span className="text-ink-muted">{entry.serviceId}</span>
              </Row>
            ) : null}
          </dl>
        </section>

        <section>
          <h3 className="border-b border-line bg-raised/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            Policy decision
          </h3>
          <div className="px-4 py-3">
            {entry.status === "executed" ? (
              <Callout tone="allow" title="Permitted">
                The contract ran every policy check and released the funds.
              </Callout>
            ) : entry.status === "rejected" ? (
              <div className="flex flex-col gap-2">
                <Callout tone="deny" title={entry.reason ?? "Blocked"}>
                  {entry.message ??
                    (entry.reason ? REJECTION_EXPLANATION[entry.reason] : "Payment was refused.")}
                </Callout>
                {entry.reason ? (
                  <p className="text-[11px] leading-4 text-ink-subtle">
                    Contract error:{" "}
                    <code className="rounded-sm border border-line bg-raised px-1 py-px text-ink-muted">
                      {entry.reason}
                    </code>
                  </p>
                ) : null}
              </div>
            ) : (
              <Callout tone="warn" title="Could not be submitted">
                {entry.message ??
                  "The payment never reached the contract, so no policy decision was made."}
              </Callout>
            )}
          </div>
        </section>

        {entry.detail && Object.keys(entry.detail).length > 0 ? (
          <section>
            <h3 className="border-b border-line bg-raised/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
              Decision detail
            </h3>
            <dl className="divide-y divide-line">
              {Object.entries(entry.detail).map(([k, v]) => (
                <Row key={k} label={k}>
                  <span className="tnum break-all text-ink-muted">{v}</span>
                </Row>
              ))}
            </dl>
          </section>
        ) : null}

        <section>
          <h3 className="border-b border-line bg-raised/40 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            Transaction
          </h3>
          <div className="px-4 py-3">
            {hasTx ? (
              <div className="flex flex-col gap-2">
                <code className="tnum block break-all rounded-md border border-line bg-raised px-2 py-1.5 text-[11px] text-ink-muted">
                  {entry.txHash}
                </code>
                <a
                  href={entry.explorerUrl ?? explorerTx(chainConfig.explorerUrl, entry.txHash!)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 self-start rounded-md border border-line bg-raised px-2.5 py-1.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink"
                >
                  <Icon.External size={11} />
                  View on {chainConfig.name} explorer
                </a>
              </div>
            ) : (
              <p className="max-w-prose text-[11px] leading-5 text-ink-subtle">
                No transaction exists for this attempt. A payment the contract refuses{" "}
                <span className="text-ink-muted">reverts</span>, and a reverted transaction
                discards its state changes and its logs — so there is nothing on chain to link to,
                and nothing was spent. This record lives in the agent runtime&apos;s activity log,
                which is off-chain and not a substitute for it.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
