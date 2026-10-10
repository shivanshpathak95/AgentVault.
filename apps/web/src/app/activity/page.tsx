"use client";

import type {ActivityEntry} from "@agentvault/shared";
import {useMemo, useState} from "react";
import {ActivityDetail} from "@/components/activity/ActivityDetail";
import {ActivityRow} from "@/components/activity/ActivityRow";
import {Icon} from "@/components/ui/Icon";
import {Button, Callout, EmptyState, PageHeader, Panel} from "@/components/ui/Panel";
import {useAgentActivity} from "@/hooks/useVault";

type Filter = "all" | "executed" | "rejected" | "failed" | "unconfirmed";

const FILTERS: {id: Filter; label: string}[] = [
  {id: "all", label: "All"},
  {id: "executed", label: "Settled"},
  {id: "rejected", label: "Blocked by policy"},
  {id: "failed", label: "Failed"},
  {id: "unconfirmed", label: "Unconfirmed"},
];

export default function ActivityPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<ActivityEntry | null>(null);
  const activity = useAgentActivity(200);

  // Memoised so the counts below do not recompute on every render.
  const entries = useMemo(() => activity.data?.entries ?? [], [activity.data]);

  const counts = useMemo(
    () => ({
      all: entries.length,
      executed: entries.filter((e) => e.status === "executed").length,
      rejected: entries.filter((e) => e.status === "rejected").length,
      failed: entries.filter((e) => e.status === "failed").length,
      unconfirmed: entries.filter((e) => e.status === "unconfirmed").length,
    }),
    [entries],
  );

  const visible = filter === "all" ? entries : entries.filter((e) => e.status === filter);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every payment attempt the agent made — settled, refused, or never submitted."
        actions={
          <Button variant="ghost" onClick={() => void activity.refetch()} busy={activity.isFetching}>
            <Icon.Refresh size={12} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-4">
        <Callout tone="info" title="Where these records live">
          This log is kept by the agent runtime, off-chain. Settled payments also exist on chain as{" "}
          <code className="text-ink">PaymentExecuted</code> events; refused ones do not, because a
          refused payment reverts and a reverted transaction discards its logs. Nothing here is
          reconstructed or inferred.
        </Callout>

        {activity.isError ? (
          <Callout tone="warn" title="Agent backend unreachable">
            {activity.error instanceof Error ? activity.error.message : "Unknown error."}
          </Callout>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <Panel padded={false}>
            <div
              role="tablist"
              aria-label="Filter activity"
              className="flex flex-wrap gap-1 border-b border-line px-3 py-2"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                    filter === f.id
                      ? "bg-raised text-ink"
                      : "text-ink-muted hover:bg-raised/60 hover:text-ink"
                  }`}
                >
                  {f.label}
                  <span className="tnum text-[10px] text-ink-subtle">{counts[f.id]}</span>
                </button>
              ))}
            </div>

            {activity.isLoading ? (
              <div className="flex flex-col gap-px">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-raised/40 pending-pulse" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <EmptyState
                title={filter === "all" ? "No payment attempts yet" : "Nothing matches this filter"}
                icon={<Icon.Activity size={20} />}
              >
                {filter === "all"
                  ? "Payment attempts appear here as soon as the agent makes one."
                  : "Try a different filter."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {visible.map((entry) => (
                  <ActivityRow
                    key={entry.id}
                    entry={entry}
                    onSelect={setSelected}
                    selected={selected?.id === entry.id}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <div className="lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
            <Panel padded={false} className="h-full overflow-hidden">
              {selected ? (
                <ActivityDetail entry={selected} onClose={() => setSelected(null)} />
              ) : (
                <EmptyState title="Select a record" icon={<Icon.Chevron size={20} />}>
                  Choose a payment attempt to see the policy decision, the contract error if it was
                  refused, and the transaction if one exists.
                </EmptyState>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
