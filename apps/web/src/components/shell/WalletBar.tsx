"use client";

import {useAccount, useConnect, useDisconnect, useSwitchChain} from "wagmi";
import {Button} from "@/components/ui/Panel";
import {Icon} from "@/components/ui/Icon";
import {chainConfig, isMainnetChain} from "@/lib/config";
import {shortAddress} from "@/lib/format";

/**
 * Wallet connection and network state.
 *
 * The network badge is not decoration: chain 5042 moves real USDC and 5042002
 * does not, and the two differ by three characters. Mainnet is called out in
 * the warning colour permanently, not just on first connect.
 */
export function WalletBar() {
  const {address, isConnected, chain} = useAccount();
  const {connectors, connect, isPending} = useConnect();
  const {disconnect} = useDisconnect();
  const {switchChain, isPending: switching} = useSwitchChain();

  const wrongNetwork = isConnected && chain?.id !== chainConfig.chainId;
  const injected = connectors[0];

  return (
    <div className="flex items-center gap-2">
      <span
        title={`${chainConfig.name} — chain id ${chainConfig.chainId}`}
        className={`hidden items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] sm:inline-flex ${
          isMainnetChain
            ? "border-warn-soft bg-warn-soft/20 text-warn"
            : "border-line bg-raised text-ink-muted"
        }`}
      >
        <span
          className={`size-1.5 rounded-full ${isMainnetChain ? "bg-warn" : "bg-ink-subtle"}`}
        />
        {chainConfig.name}
        {isMainnetChain ? " · real funds" : null}
      </span>

      {wrongNetwork ? (
        <Button
          variant="danger"
          busy={switching}
          onClick={() => switchChain({chainId: chainConfig.chainId})}
        >
          <Icon.Alert size={12} />
          Switch to {chainConfig.name}
        </Button>
      ) : null}

      {isConnected ? (
        <button
          onClick={() => disconnect()}
          title={`${address} — click to disconnect`}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 py-1.5 text-[11px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
        >
          <span className="size-1.5 rounded-full bg-allow" />
          <span className="tnum">{shortAddress(address)}</span>
        </button>
      ) : (
        <Button
          variant="primary"
          busy={isPending}
          disabled={!injected}
          onClick={() => injected && connect({connector: injected})}
        >
          <Icon.Wallet size={12} />
          {injected ? "Connect wallet" : "No wallet found"}
        </Button>
      )}
    </div>
  );
}
