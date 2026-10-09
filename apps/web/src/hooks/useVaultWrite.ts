"use client";

import {decodeRejection} from "@agentvault/shared";
import {useCallback, useState} from "react";
import type {Hex} from "viem";
import {usePublicClient, useWriteContract} from "wagmi";
import {chainConfig} from "@/lib/config";

/**
 * One on-chain write, with its full lifecycle made visible.
 *
 * The states are distinct on purpose: "awaiting signature" (the wallet is open),
 * "pending" (submitted, not yet mined) and "success" are different facts, and a
 * console that collapsed them would show "Policy updated" while the transaction
 * was still in flight. Nothing reports success until the receipt confirms it.
 */
export type WriteStatus = "idle" | "signing" | "pending" | "success" | "error";

export interface WriteState {
  status: WriteStatus;
  txHash?: Hex;
  error?: string;
  /** Set when the failure was a contract rejection rather than a network fault. */
  reason?: string;
}

export function useVaultWrite() {
  const [state, setState] = useState<WriteState>({status: "idle"});
  const {writeContractAsync} = useWriteContract();
  const publicClient = usePublicClient();

  const reset = useCallback(() => setState({status: "idle"}), []);

  const execute = useCallback(
    async (request: Parameters<typeof writeContractAsync>[0]): Promise<boolean> => {
      setState({status: "signing"});
      try {
        const txHash = await writeContractAsync(request);
        setState({status: "pending", txHash});

        // Arc finalises deterministically, so one confirmation is final.
        const receipt = await publicClient?.waitForTransactionReceipt({
          hash: txHash,
          confirmations: 1,
        });

        if (receipt && receipt.status !== "success") {
          setState({status: "error", txHash, error: "The transaction reverted on chain."});
          return false;
        }

        setState({status: "success", txHash});
        return true;
      } catch (err) {
        // A contract revert carries a policy reason; everything else is a
        // wallet or network fault. Conflating them misdirects the operator.
        const decoded = decodeRejection(err, chainConfig.usdcDecimals);
        if (decoded) {
          setState({status: "error", error: decoded.message, reason: decoded.reason});
          return false;
        }

        const message = err instanceof Error ? err.message : String(err);
        setState({
          status: "error",
          error: /user rejected|denied/i.test(message)
            ? "You rejected the request in your wallet. Nothing was changed."
            : message,
        });
        return false;
      }
    },
    [writeContractAsync, publicClient],
  );

  return {state, execute, reset};
}
