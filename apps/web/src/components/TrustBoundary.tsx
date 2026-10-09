import {Icon} from "@/components/ui/Icon";
import {Panel} from "@/components/ui/Panel";

/**
 * The security model, stated in terms the contract actually enforces.
 *
 * Every CAN/CANNOT line below maps to a specific check in AgentVault.pay and a
 * test in AgentVault.t.sol. Nothing aspirational is listed: if the contract did
 * not enforce it, it does not appear here.
 */

const CAN = [
  "Request payments through the vault",
  "Pay recipients the operator allowlisted",
  "Spend up to maxPerTx in one payment",
  "Spend up to the daily limit per UTC day",
  "Read its own policy and remaining budget",
] as const;

const CANNOT = [
  {
    text: "Pay an address the operator did not approve",
    check: "RecipientNotAllowed",
  },
  {text: "Exceed the per-transaction ceiling", check: "ExceedsMaxPerTx"},
  {text: "Exceed the daily spending limit", check: "DailyLimitExceeded"},
  {text: "Spend after the session expires", check: "SessionExpired"},
  {text: "Spend once the operator revokes the session", check: "SessionIsRevoked"},
  {text: "Spend while the vault is frozen", check: "VaultPaused"},
  {text: "Move any token other than the configured USDC", check: "InvalidToken"},
  {text: "Change its own limits, allowlist or expiry", check: "onlyOwner"},
  {text: "Withdraw from the vault", check: "onlyOwner"},
] as const;

export function TrustBoundary() {
  return (
    <Panel
      title="Trust boundary"
      description="What the agent can and cannot do, and which contract check enforces each limit."
      padded={false}
    >
      <div className="grid gap-px bg-line sm:grid-cols-2">
        <div className="bg-surface p-4">
          <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-allow">
            <Icon.Check size={12} />
            The agent can
          </h3>
          <ul className="flex flex-col gap-1.5">
            {CAN.map((item) => (
              <li key={item} className="flex gap-2 text-xs leading-5 text-ink-muted">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-allow" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-surface p-4">
          <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-deny">
            <Icon.Deny size={12} />
            The agent cannot
          </h3>
          <ul className="flex flex-col gap-1.5">
            {CANNOT.map((item) => (
              <li key={item.text} className="flex gap-2 text-xs leading-5 text-ink-muted">
                <span className="mt-[7px] size-1 shrink-0 rounded-full bg-deny" />
                <span className="min-w-0">
                  {item.text}
                  <code className="ml-1.5 rounded-sm border border-line bg-raised px-1 py-px text-[10px] text-ink-subtle">
                    {item.check}
                  </code>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-line bg-surface p-4">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
          How the pieces interact
        </h3>
        <ol className="flex flex-col gap-2 text-xs leading-5 text-ink-muted">
          {[
            {
              role: "Operator",
              detail:
                "Signs the policy from their own wallet. The only party that can change limits, the allowlist, expiry, or move funds out.",
              tone: "text-accent-ink",
            },
            {
              role: "Agent runtime",
              detail:
                "Holds a session key, server-side only. Can call pay() and nothing else. Its compromise is a modelled scenario, not a catastrophe.",
              tone: "text-warn",
            },
            {
              role: "AgentVault contract",
              detail:
                "Re-checks every condition on every payment. The only security authority — no model, backend or frontend participates in the decision.",
              tone: "text-allow",
            },
            {
              role: "Service",
              detail:
                "Independently verifies the settled payment on chain before returning a result. Trusts neither the agent nor this console.",
              tone: "text-ink",
            },
          ].map((row, i) => (
            <li key={row.role} className="flex gap-2.5">
              <span className="tnum mt-px w-4 shrink-0 text-right text-ink-subtle">{i + 1}</span>
              <span className="min-w-0">
                <span className={`font-medium ${row.tone}`}>{row.role}</span>
                <span className="text-ink-subtle"> — {row.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
