"use client";

import type {ActivityEntry} from "@agentvault/shared";
import {Icon} from "@/components/ui/Icon";
import {StatusPill} from "@/components/ui/Panel";
import {absoluteTime, relativeTime, shortAddress, usdc} from "@/lib/format";

/**
 * One payment attempt.
 *
 * Settled and refused rows get equal visual weight. A console that rendered
 * rejections as faint error text would be arguing the opposite of the product.
 */
export function ActivityRow({
  entry,
  onSelect,
  selected,
}: {
  entry: ActivityEntry;
  onSelect?: ((entry: ActivityEntry) => void) | undefined;
  selected?: boolean | undefined;
}) {
  const interactive = Boolean(onSelect);

  const body = (
    <>
      <span className="mt-1 shrink-0">
        {entry.status === "executed" ? (
          <Icon.Check size={14} className="text-allow" />
        ) : entry.status === "rejected" ? (
          <Icon.Deny size={14} className="text-deny" />
        ) : (
          <Icon.Alert size={14} className="text-warn" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">
            {entry.serviceName ?? "Payment"}
          </span>
          <StatusPill status={entry.status} />
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-subtle">
          <span title={absoluteTime(entry.timestamp)}>{relativeTime(entry.timestamp)}</span>
          <span aria-hidden>·</span>
          <span title={entry.recipient} className="tnum">
            {shortAddress(entry.recipient)}
          </span>
          {entry.txHash ? (
            <>
              <span aria-hidden>·</span>
              <span className="tnum" title={entry.txHash}>
                {shortAddress(entry.txHash, 8, 6)}
              </span>
            </>
          ) : null}
        </span>

        {entry.status !== "executed" && entry.message ? (
          <span className="mt-1 block max-w-prose text-[11px] leading-4 text-ink-muted">
            {entry.message}
          </span>
        ) : null}
      </span>

      <span className="shrink-0 text-right">
        <span className="tnum block text-[13px] text-ink">{usdc(entry.amount)}</span>
        <span className="block text-[10px] uppercase tracking-wider text-ink-subtle">USDC</span>
      </span>

      {interactive ? (
        <span className="mt-1 shrink-0 text-ink-subtle">
          <Icon.Chevron size={13} />
        </span>
      ) : null}
    </>
  );

  if (!interactive) {
    return <li className="row-enter flex items-start gap-3 px-4 py-3">{body}</li>;
  }

  return (
    <li className="row-enter">
      <button
        onClick={() => onSelect?.(entry)}
        aria-current={selected ? "true" : undefined}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
          selected ? "bg-raised" : "hover:bg-raised/60"
        }`}
      >
        {body}
      </button>
    </li>
  );
}
