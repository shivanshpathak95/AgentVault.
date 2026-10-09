"use client";

import {Icon} from "@/components/ui/Icon";
import type {WriteState} from "@/hooks/useVaultWrite";
import {chainConfig} from "@/lib/config";
import {explorerTx, shortAddress} from "@/lib/format";

/**
 * Transaction lifecycle feedback.
 *
 * "Signing", "pending" and "confirmed" are shown as separate states, and the
 * success wording only appears once a receipt has confirmed it — never on
 * submission.
 */
export function TxState({state, successLabel}: {state: WriteState; successLabel: string}) {
  if (state.status === "idle") return null;

  const txLink = state.txHash ? (
    <a
      href={explorerTx(chainConfig.explorerUrl, state.txHash)}
      target="_blank"
      rel="noreferrer"
      className="tnum inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline"
    >
      <Icon.External size={10} />
      {shortAddress(state.txHash, 10, 8)}
    </a>
  ) : null;

  const shell = (tone: string, icon: React.ReactNode, title: string, body: React.ReactNode) => (
    <div className={`mt-3 flex gap-2.5 rounded-md border px-3 py-2.5 text-xs ${tone}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 text-ink-muted">{body}</div>
      </div>
    </div>
  );

  switch (state.status) {
    case "signing":
      return shell(
        "border-line bg-raised text-ink",
        <Icon.Wallet size={13} className="pending-pulse" />,
        "Confirm in your wallet",
        "Review the contract and values before signing. Nothing has changed yet.",
      );

    case "pending":
      return shell(
        "border-accent-soft bg-accent-soft/15 text-accent-ink",
        <Icon.Clock size={13} className="pending-pulse" />,
        "Submitted — waiting for confirmation",
        <>
          The change is not in effect until this confirms. {txLink}
        </>,
      );

    case "success":
      return shell(
        "border-allow-soft bg-allow-soft/15 text-allow",
        <Icon.Check size={13} />,
        successLabel,
        <>Confirmed on chain. {txLink}</>,
      );

    case "error":
      return shell(
        "border-deny-soft bg-deny-soft/15 text-deny",
        <Icon.Deny size={13} />,
        state.reason ? `Refused: ${state.reason}` : "Transaction failed",
        <>
          {state.error} {txLink}
        </>,
      );
  }
}
