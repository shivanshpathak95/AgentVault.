"use client";

import {useMutation} from "@tanstack/react-query";
import {useState} from "react";
import {Icon} from "@/components/ui/Icon";
import {Button, Callout, EmptyState, PageHeader, Panel, StatusPill} from "@/components/ui/Panel";
import {ProvenanceTag} from "@/components/ui/Provenance";
import {useAgentServices, useAgentStatus} from "@/hooks/useVault";
import {agentApi, type AgentRunResult, type PaymentToolResult, type TranscriptEntry} from "@/lib/agent-api";
import {chainConfig} from "@/lib/config";
import {explorerTx, isTxHash, shortAddress, usdc} from "@/lib/format";

/**
 * The agent workspace.
 *
 * This page sends a prompt to POST /api/run and renders the transcript the
 * backend returns. It deliberately contains no payment logic of its own: the
 * browser never constructs, signs or submits a transaction here, because the
 * session key lives server-side. What you see is a reflection of what the agent
 * and the contract actually did.
 */

const EXAMPLES = [
  "Get the current weather in Tokyo.",
  "Research solid-state batteries and summarise the key findings.",
  "Get the weather in Oslo and then research Nordic grid storage.",
] as const;

function toolLabel(name: string | undefined): string {
  switch (name) {
    case "list_services":
      return "Reviewed the service registry";
    case "get_vault_status":
      return "Checked vault budget";
    case "request_service_quote":
      return "Requested a quote";
    case "check_policy":
      return "Pre-checked the policy";
    case "request_payment":
      return "Requested a payment";
    case "fetch_service_result":
      return "Collected the paid result";
    default:
      return name ?? "Tool";
  }
}

/** Render a payment tool result with the settlement facts pulled to the front. */
function PaymentOutcome({output}: {output: PaymentToolResult}) {
  if (output.status === "executed") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-allow-soft bg-allow-soft/10 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status="executed" />
          <span className="tnum text-xs text-ink">{usdc(output.amountPaid)} USDC</span>
          {output.dailyRemaining !== undefined ? (
            <span className="text-[11px] text-ink-subtle">
              · {usdc(output.dailyRemaining)} USDC left today
            </span>
          ) : null}
        </div>
        {isTxHash(output.txHash) ? (
          <a
            href={output.explorerUrl ?? explorerTx(chainConfig.explorerUrl, output.txHash)}
            target="_blank"
            rel="noreferrer"
            className="tnum inline-flex items-center gap-1.5 self-start text-[11px] text-ink-muted hover:text-ink"
          >
            <Icon.External size={10} />
            {shortAddress(output.txHash, 10, 8)}
          </a>
        ) : null}
      </div>
    );
  }

  if (output.status === "unconfirmed") {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-warn-soft bg-warn-soft/10 px-3 py-2.5">
        <StatusPill status="unconfirmed" />
        <p className="text-[11px] leading-5 text-ink-muted">{output.message}</p>
      </div>
    );
  }

  if (output.status === "rejected" || output.status === "failed") {
    return (
      <div className="flex flex-col gap-1.5 rounded-md border border-deny-soft bg-deny-soft/10 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={output.status} />
          {output.reason ? (
            <code className="rounded-sm border border-line bg-raised px-1 py-px text-[10px] text-ink-muted">
              {output.reason}
            </code>
          ) : null}
        </div>
        <p className="text-[11px] leading-5 text-ink-muted">{output.message}</p>
        <p className="text-[11px] leading-4 text-ink-subtle">
          {isTxHash(output.txHash)
            ? "No funds moved. The transaction was mined and reverted, so its logs were discarded."
            : output.stage === "backend_validation"
              ? "Refused by the agent backend before reaching the chain. No transaction exists."
              : "No funds moved and no transaction exists — refused before sending."}
        </p>
      </div>
    );
  }

  return null;
}

function TranscriptView({entries}: {entries: TranscriptEntry[]}) {
  return (
    <ol className="divide-y divide-line">
      {entries.map((entry, i) => {
        if (entry.kind === "assistant_text") {
          return (
            <li key={i} className="row-enter px-4 py-3">
              <div className="mb-1.5 flex items-center gap-2">
                <Icon.Agent size={12} className="text-accent-ink" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
                  Agent
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-6 text-ink">{entry.text}</p>
            </li>
          );
        }

        if (entry.kind === "tool_call") {
          const input = entry.input as Record<string, unknown> | null;
          return (
            <li key={i} className="row-enter bg-raised/30 px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Icon.Chevron size={11} className="text-ink-subtle" />
                <span className="text-xs text-ink-muted">{toolLabel(entry.name)}</span>
                {entry.name === "request_payment" && input ? (
                  <span className="tnum text-[11px] text-ink-subtle">
                    {usdc(String(input.amount ?? ""))} USDC →{" "}
                    {shortAddress(String(input.recipient ?? ""))}
                  </span>
                ) : null}
                {entry.name === "request_service_quote" && input ? (
                  <span className="text-[11px] text-ink-subtle">
                    {String(input.serviceId ?? "")} · {String(input.param ?? "")}
                  </span>
                ) : null}
              </div>
            </li>
          );
        }

        // tool_result
        const output = entry.output as PaymentToolResult & {error?: string};
        const isPayment = entry.name === "request_payment";
        const hasError = typeof output?.error === "string";

        if (!isPayment && !hasError) return null;

        return (
          <li key={i} className="row-enter px-4 py-2.5">
            {isPayment ? <PaymentOutcome output={output} /> : null}
            {hasError ? (
              <div className="rounded-md border border-warn-soft bg-warn-soft/10 px-3 py-2 text-[11px] leading-5 text-warn">
                {output.error}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default function AgentPage() {
  const [prompt, setPrompt] = useState("");
  const status = useAgentStatus();
  const services = useAgentServices();

  const run = useMutation<AgentRunResult, Error, string>({
    mutationFn: (p) => agentApi.run(p),
  });

  const backendDown = status.isError;
  const canRun = prompt.trim().length > 0 && !run.isPending && !backendDown;

  return (
    <>
      <PageHeader
        title="Agent"
        description="Ask the agent to buy something. It proposes payments; the contract decides."
      />

      <div className="flex flex-col gap-4">
        {backendDown ? (
          <Callout tone="warn" title="Agent backend unreachable">
            {status.error instanceof Error ? status.error.message : "Unknown error."} Start it with{" "}
            <code className="text-ink">pnpm dev:agent</code>.
          </Callout>
        ) : null}

        {status.data && !status.data.sessionExists ? (
          <Callout tone="warn" title="No session registered">
            The agent&apos;s key <code className="text-ink">{shortAddress(status.data.sessionKey)}</code>{" "}
            is not registered on the vault, so every payment will be refused with{" "}
            <code className="text-ink">UnauthorizedAgent</code>. Create a session on the Policy page.
          </Callout>
        ) : null}

        {status.data?.revoked ? (
          <Callout tone="deny" title="Session revoked">
            This session was permanently revoked. The agent cannot spend; a new session key is
            required.
          </Callout>
        ) : null}

        <Panel padded={false}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canRun) run.mutate(prompt.trim());
            }}
          >
            <label htmlFor="agent-prompt" className="sr-only">
              Request for the agent
            </label>
            <textarea
              id="agent-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canRun) {
                  e.preventDefault();
                  run.mutate(prompt.trim());
                }
              }}
              rows={3}
              placeholder="Get the current weather in Tokyo."
              className="w-full resize-y bg-transparent px-4 py-3 text-[13px] leading-6 text-ink outline-none placeholder:text-ink-subtle"
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2">
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setPrompt(ex)}
                    className="rounded-md border border-line bg-raised px-2 py-1 text-[11px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
                  >
                    {ex.length > 38 ? `${ex.slice(0, 38)}…` : ex}
                  </button>
                ))}
              </div>

              <Button type="submit" variant="primary" disabled={!canRun} busy={run.isPending}>
                {!run.isPending ? <Icon.Send size={12} /> : null}
                {run.isPending ? "Working…" : "Send"}
                <span className="ml-1 text-[10px] text-ink-subtle">⌘↵</span>
              </Button>
            </div>
          </form>
        </Panel>

        {run.isPending ? (
          <Panel padded={false}>
            <div className="relative h-0.5 overflow-hidden bg-raised indeterminate" />
            <div className="px-4 py-6 text-center text-xs text-ink-muted">
              The agent is working. Payments are submitted on chain and confirmed before a result is
              returned, so this can take a few seconds.
            </div>
          </Panel>
        ) : null}

        {run.isError ? (
          <Callout tone="deny" title="Run failed">
            {run.error.message}
          </Callout>
        ) : null}

        {run.data ? (
          <>
            <Panel
              title="Transcript"
              description="What the agent did, step by step."
              padded={false}
              actions={<ProvenanceTag value="backend" />}
            >
              {run.data.transcript.length === 0 ? (
                <EmptyState title="No steps recorded" />
              ) : (
                <TranscriptView entries={run.data.transcript} />
              )}
            </Panel>

            <Panel title="Final response" actions={<ProvenanceTag value="backend" />}>
              <p className="whitespace-pre-wrap text-[13px] leading-6 text-ink">
                {run.data.finalText || "The agent returned no final text."}
              </p>
              <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink-subtle">
                {run.data.steps} step{run.data.steps === 1 ? "" : "s"} · stop reason{" "}
                <code className="text-ink-muted">{run.data.stopReason ?? "unknown"}</code> ·{" "}
                {run.data.usage.inputTokens.toLocaleString()} in /{" "}
                {run.data.usage.outputTokens.toLocaleString()} out tokens
              </p>
            </Panel>
          </>
        ) : !run.isPending ? (
          <Panel padded={false}>
            <EmptyState title="No run yet" icon={<Icon.Agent size={20} />}>
              Send a request above. The agent will consult the registry, check its budget, request a
              quote, ask the vault to pay, and collect the result — and you will see each step.
            </EmptyState>
          </Panel>
        ) : null}

        {services.data ? (
          <Panel
            title="Available to the agent"
            description="The registry this agent was configured with."
            padded={false}
          >
            <ul className="divide-y divide-line">
              {services.data.services.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs text-ink">{s.name}</p>
                    <p className="truncate text-[11px] text-ink-subtle">{s.description}</p>
                  </div>
                  <span className="tnum shrink-0 text-xs text-ink-muted">{s.priceUsdc} USDC</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
