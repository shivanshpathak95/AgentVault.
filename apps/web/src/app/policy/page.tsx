"use client";

import {agentVaultAbi, fromBaseUnits, toBaseUnits, UsdcAmountError} from "@agentvault/shared";
import {useMemo, useState} from "react";
import type {Address} from "viem";
import {useAccount} from "wagmi";
import {TxState} from "@/components/policy/TxState";
import {Icon} from "@/components/ui/Icon";
import {
  AddressChip,
  Button,
  Callout,
  PageHeader,
  Panel,
  StatusPill,
} from "@/components/ui/Panel";
import {ProvenanceTag} from "@/components/ui/Provenance";
import {
  useAgentServices,
  useAgentStatus,
  useIsOperator,
  useRecipientApprovals,
  useVaultChainData,
} from "@/hooks/useVault";
import {secondsUntil, useNow} from "@/hooks/useNow";
import {useVaultWrite} from "@/hooks/useVaultWrite";
import {chainConfig, vaultAddress} from "@/lib/config";
import {duration, shortAddress, usdc} from "@/lib/format";

/** A labelled numeric input with units and inline validation. */
function AmountField({
  label,
  value,
  onChange,
  hint,
  error,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
}) {
  const id = `field-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
        {label}
      </label>
      <div
        className={`flex items-center rounded-md border bg-raised ${
          error ? "border-deny-soft" : "border-line focus-within:border-line-strong"
        }`}
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className="tnum w-full bg-transparent px-2.5 py-1.5 text-sm text-ink outline-none disabled:opacity-50"
        />
        <span className="shrink-0 border-l border-line px-2.5 py-1.5 text-[11px] text-ink-subtle">
          USDC
        </span>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-[11px] text-deny">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] leading-4 text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

function validateAmount(value: string): string | undefined {
  if (value.trim() === "") return "Required.";
  try {
    toBaseUnits(value.trim(), chainConfig.usdcDecimals);
    return undefined;
  } catch (err) {
    return err instanceof UsdcAmountError ? err.message : "Invalid amount.";
  }
}

/**
 * The limits editor.
 *
 * Owns its own draft state and is seeded by `key` from the parent, so it
 * remounts whenever the on-chain policy changes. That avoids mirroring props
 * into state in an effect, and means the inputs can never drift from the
 * contract without the operator having typed the difference themselves.
 */
function LimitsForm({
  initialMaxPerTx,
  initialDailyLimit,
  onChainMaxPerTx,
  onChainDailyLimit,
  disabled,
  busy,
  onSubmit,
}: {
  initialMaxPerTx: string;
  initialDailyLimit: string;
  onChainMaxPerTx?: string | undefined;
  onChainDailyLimit?: string | undefined;
  disabled: boolean;
  busy: boolean;
  onSubmit: (maxPerTx: string, dailyLimit: string) => void;
}) {
  const [maxPerTx, setMaxPerTx] = useState(initialMaxPerTx);
  const [dailyLimit, setDailyLimit] = useState(initialDailyLimit);

  const decimals = chainConfig.usdcDecimals;
  const maxErr = validateAmount(maxPerTx);
  const dailyErr = validateAmount(dailyLimit);
  const valid = !maxErr && !dailyErr;

  const ceilingAboveDaily =
    valid && toBaseUnits(maxPerTx.trim(), decimals) > toBaseUnits(dailyLimit.trim(), decimals);

  const dirty = maxPerTx !== initialMaxPerTx || dailyLimit !== initialDailyLimit;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <AmountField
          label="Max per transaction"
          value={maxPerTx}
          onChange={setMaxPerTx}
          error={maxPerTx ? maxErr : undefined}
          disabled={disabled}
          hint={onChainMaxPerTx ? `Currently ${usdc(onChainMaxPerTx)} USDC on chain.` : undefined}
        />
        <AmountField
          label="Daily limit"
          value={dailyLimit}
          onChange={setDailyLimit}
          error={dailyLimit ? dailyErr : undefined}
          disabled={disabled}
          hint={
            onChainDailyLimit
              ? `Currently ${usdc(onChainDailyLimit)} USDC. Resets at the next UTC day.`
              : undefined
          }
        />
      </div>

      {ceilingAboveDaily ? (
        <div className="mt-3">
          <Callout tone="warn" title="Per-transaction ceiling exceeds the daily limit">
            This is allowed — the daily limit binds first — but it usually means a typo.
          </Callout>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => onSubmit(maxPerTx, dailyLimit)}
          disabled={disabled || !valid || !dirty}
          busy={busy}
        >
          Update limits on chain
        </Button>
        <span className="text-[11px] text-ink-subtle">
          {dirty
            ? "Spend already recorded today is preserved."
            : "No changes to submit."}
        </span>
      </div>
    </>
  );
}

export default function PolicyPage() {
  const {isConnected} = useAccount();
  const status = useAgentStatus();
  const sessionKey = status.data?.sessionKey as Address | undefined;

  const chainData = useVaultChainData(sessionKey);
  const isOperator = useIsOperator(chainData.owner);
  const services = useAgentServices();

  const recipients = useMemo(
    () => services.data?.services.map((s) => s.recipient) ?? [],
    [services.data],
  );
  const {approvals, refetch: refetchApprovals} = useRecipientApprovals(sessionKey, recipients);

  const limits = useVaultWrite();
  const expiryWrite = useVaultWrite();
  const recipientWrite = useVaultWrite();
  const pauseWrite = useVaultWrite();
  const revokeWrite = useVaultWrite();

  const session = chainData.session;
  const decimals = chainConfig.usdcDecimals;

  const [expiryHours, setExpiryHours] = useState("24");
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  // The limits form seeds itself from chain values via its `key` below, rather
  // than mirroring them into state in an effect: syncing state to props in an
  // effect causes a cascading render, and remounting is both simpler and
  // guarantees the inputs always reflect the policy that is actually on chain.
  const seedKey = session?.exists
    ? `${session.maxPerTx}-${session.dailyLimit}`
    : "unseeded";

  const hoursNum = Number(expiryHours);
  const hoursErr =
    !Number.isFinite(hoursNum) || hoursNum <= 0 ? "Must be a positive number of hours." : undefined;

  const canWrite = isConnected && chainData.onCorrectChain && isOperator && Boolean(vaultAddress);
  const sessionExists = Boolean(session?.exists);

  const now = useNow();
  const expiresIn = secondsUntil(session ? Number(session.expiresAt) : undefined, now);

  async function saveLimits(maxPerTx: string, dailyLimit: string) {
    if (!vaultAddress || !sessionKey) return;
    const expiresAt = session?.expiresAt ?? BigInt(Math.floor((now ?? Date.now()) / 1000) + 86_400);
    const ok = await limits.execute({
      address: vaultAddress,
      abi: agentVaultAbi,
      functionName: "updatePolicy",
      args: [
        sessionKey,
        toBaseUnits(maxPerTx.trim(), decimals),
        toBaseUnits(dailyLimit.trim(), decimals),
        expiresAt,
      ],
    });
    if (ok) void chainData.refetch();
  }

  async function extendExpiry() {
    if (!vaultAddress || !sessionKey || hoursErr || !session) return;
    const newExpiry = BigInt(
      Math.floor((now ?? Date.now()) / 1000) + Math.round(hoursNum * 3600),
    );
    const ok = await expiryWrite.execute({
      address: vaultAddress,
      abi: agentVaultAbi,
      functionName: "updatePolicy",
      args: [sessionKey, session.maxPerTx, session.dailyLimit, newExpiry],
    });
    if (ok) void chainData.refetch();
  }

  async function toggleRecipient(recipient: Address, allowed: boolean) {
    if (!vaultAddress || !sessionKey) return;
    const ok = await recipientWrite.execute({
      address: vaultAddress,
      abi: agentVaultAbi,
      functionName: "setRecipient",
      args: [sessionKey, recipient, allowed],
    });
    if (ok) void refetchApprovals();
  }

  async function togglePause() {
    if (!vaultAddress) return;
    const ok = await pauseWrite.execute({
      address: vaultAddress,
      abi: agentVaultAbi,
      functionName: "setPaused",
      args: [!chainData.paused],
    });
    if (ok) void chainData.refetch();
  }

  async function revoke() {
    if (!vaultAddress || !sessionKey) return;
    const ok = await revokeWrite.execute({
      address: vaultAddress,
      abi: agentVaultAbi,
      functionName: "revokeSession",
      args: [sessionKey],
    });
    if (ok) {
      setConfirmRevoke(false);
      void chainData.refetch();
    }
  }

  return (
    <>
      <PageHeader
        title="Policy"
        description="The rules the contract enforces on every payment. Changing any of them is an on-chain transaction signed by the operator."
        actions={<ProvenanceTag value="chain" />}
      />

      <div className="flex flex-col gap-4">
        <Callout tone="info" title="These are on-chain settings, not preferences">
          Every control on this page writes to the AgentVault contract and requires a wallet
          signature. There is no off-chain &ldquo;saved setting&rdquo; here: the agent runtime also
          pre-checks payments for faster feedback, but that check is a convenience and carries no
          authority. Only the contract can refuse a payment.
        </Callout>

        {!vaultAddress ? (
          <Callout tone="warn" title="No vault configured">
            Set <code className="text-ink">NEXT_PUBLIC_VAULT_ADDRESS</code> after deploying.
          </Callout>
        ) : !isConnected ? (
          <Callout tone="warn" title="Connect the operator wallet">
            Policy changes must be signed by the vault owner.
          </Callout>
        ) : !chainData.onCorrectChain ? (
          <Callout tone="deny" title="Wrong network">
            Switch to {chainConfig.name} (chain {chainConfig.chainId}).
          </Callout>
        ) : chainData.owner && !isOperator ? (
          <Callout tone="deny" title="Connected wallet is not the owner">
            This vault is owned by <AddressChip address={chainData.owner} />. Only that wallet can
            change policy — which is the guarantee, not an inconvenience.
          </Callout>
        ) : !sessionExists ? (
          <Callout tone="warn" title="No session registered for the agent key">
            The agent key{" "}
            <code className="text-ink">{shortAddress(sessionKey)}</code> has no session, so every
            payment is refused with <code className="text-ink">UnauthorizedAgent</code>. Creating a
            session requires <code className="text-ink">createSession</code>, which this console does
            not yet expose — see the report for the gap.
          </Callout>
        ) : null}

        {/* Spending limits */}
        <Panel
          title="Spending limits"
          description="Enforced by AgentVault.pay on every payment, before any USDC moves."
        >
          <LimitsForm
            key={seedKey}
            initialMaxPerTx={session?.exists ? fromBaseUnits(session.maxPerTx, decimals) : ""}
            initialDailyLimit={session?.exists ? fromBaseUnits(session.dailyLimit, decimals) : ""}
            onChainMaxPerTx={session?.exists ? fromBaseUnits(session.maxPerTx, decimals) : undefined}
            onChainDailyLimit={
              session?.exists ? fromBaseUnits(session.dailyLimit, decimals) : undefined
            }
            disabled={!canWrite || !sessionExists}
            busy={limits.state.status === "signing" || limits.state.status === "pending"}
            onSubmit={(max, daily) => void saveLimits(max, daily)}
          />
          <TxState state={limits.state} successLabel="Limits updated" />
        </Panel>

        {/* Session expiry */}
        <Panel
          title="Session expiry"
          description="Sessions fail closed. After expiry the agent cannot spend until the operator issues a new window."
          actions={
            session?.exists ? (
              <span
                className={`text-xs ${expiresIn !== null && expiresIn <= 0 ? "text-deny" : "text-ink-muted"}`}
              >
                {expiresIn === null
                  ? "—"
                  : expiresIn > 0
                    ? `expires in ${duration(expiresIn)}`
                    : "expired"}
              </span>
            ) : null
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="expiry-hours"
                className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle"
              >
                New window from now
              </label>
              <div className="flex items-center rounded-md border border-line bg-raised focus-within:border-line-strong">
                <input
                  id="expiry-hours"
                  type="number"
                  min={1}
                  step={1}
                  value={expiryHours}
                  disabled={!canWrite || !sessionExists}
                  onChange={(e) => setExpiryHours(e.target.value)}
                  className="tnum w-24 bg-transparent px-2.5 py-1.5 text-sm text-ink outline-none disabled:opacity-50"
                />
                <span className="border-l border-line px-2.5 py-1.5 text-[11px] text-ink-subtle">
                  hours
                </span>
              </div>
            </div>
            <Button
              onClick={() => void extendExpiry()}
              disabled={!canWrite || !sessionExists || Boolean(hoursErr)}
              busy={expiryWrite.state.status === "signing" || expiryWrite.state.status === "pending"}
            >
              <Icon.Clock size={12} />
              Set expiry
            </Button>
          </div>
          {hoursErr ? <p className="mt-1.5 text-[11px] text-deny">{hoursErr}</p> : null}
          <TxState state={expiryWrite.state} successLabel="Expiry updated" />
        </Panel>

        {/* Recipients */}
        <Panel
          title="Approved recipients"
          description="The only addresses the agent may pay. Everything else is refused with RecipientNotAllowed."
          padded={false}
        >
          {services.isLoading ? (
            <div className="h-16 bg-raised/40 pending-pulse" />
          ) : services.isError || recipients.length === 0 ? (
            <div className="px-4 py-4 text-xs text-ink-subtle">
              The agent backend is unreachable, so the configured service registry cannot be listed.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {services.data?.services.map((s) => {
                const allowed = approvals.get(s.recipient.toLowerCase());
                return (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] text-ink">{s.name}</span>
                        {allowed === undefined ? (
                          <StatusPill status="pending" />
                        ) : allowed ? (
                          <StatusPill status="active" />
                        ) : (
                          <StatusPill status="inactive" />
                        )}
                      </div>
                      <div className="mt-1">
                        <AddressChip address={s.recipient} />
                      </div>
                    </div>
                    <Button
                      variant={allowed ? "danger" : "default"}
                      disabled={!canWrite || !sessionExists || allowed === undefined}
                      onClick={() => void toggleRecipient(s.recipient, !allowed)}
                    >
                      {allowed ? "Remove" : "Approve"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-line px-4 py-3">
            <TxState state={recipientWrite.state} successLabel="Allowlist updated" />
          </div>
        </Panel>

        {/* Emergency controls */}
        <Panel
          title="Emergency controls"
          description="Two different tools. Freezing is reversible and vault-wide; revocation is permanent and scoped to one key."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-md border border-line bg-raised/40 p-3.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-ink">Freeze vault</h3>
                {chainData.paused ? <StatusPill status="rejected" /> : <StatusPill status="active" />}
              </div>
              <p className="mb-3 text-[11px] leading-5 text-ink-muted">
                Halts all agent spending immediately. Reversible. Your own withdrawals are never
                blocked.
              </p>
              <Button
                variant={chainData.paused ? "default" : "danger"}
                disabled={!canWrite}
                busy={pauseWrite.state.status === "signing" || pauseWrite.state.status === "pending"}
                onClick={() => void togglePause()}
              >
                {chainData.paused ? "Unfreeze vault" : "Freeze vault"}
              </Button>
              <TxState
                state={pauseWrite.state}
                successLabel={chainData.paused ? "Vault frozen" : "Vault unfrozen"}
              />
            </div>

            <div className="rounded-md border border-deny-soft bg-deny-soft/10 p-3.5">
              <h3 className="mb-1.5 text-xs font-semibold text-deny">Revoke session</h3>
              <p className="mb-3 text-[11px] leading-5 text-ink-muted">
                Permanently kills this session key. It can never be reinstated — a new key is
                required. Use this if you suspect the agent or its host is compromised.
              </p>

              {confirmRevoke ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="danger"
                    disabled={!canWrite || !sessionExists}
                    busy={
                      revokeWrite.state.status === "signing" ||
                      revokeWrite.state.status === "pending"
                    }
                    onClick={() => void revoke()}
                  >
                    Yes, revoke permanently
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmRevoke(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="danger"
                  disabled={!canWrite || !sessionExists || session?.revoked}
                  onClick={() => setConfirmRevoke(true)}
                >
                  <Icon.Deny size={12} />
                  {session?.revoked ? "Already revoked" : "Revoke session"}
                </Button>
              )}
              <TxState state={revokeWrite.state} successLabel="Session revoked" />
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
