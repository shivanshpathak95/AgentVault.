import {ARC_CONFIRMATIONS, agentVaultAbi} from "@agentvault/shared";
import {decodeEventLog, type Address, type Hex, type PublicClient} from "viem";

/**
 * Independent on-chain payment verification.
 *
 * This is the point of having a separate service. It trusts neither the agent
 * nor the operator console — only the chain. The agent hands it a transaction
 * hash; everything that matters is then read back from the receipt.
 *
 * Arc finalises deterministically, so ARC_CONFIRMATIONS is 1 and that is not a
 * shortcut: there is no probabilistic reorg risk to wait out. (Threat T-11.)
 *
 * PHASE 4 wires this to the HTTP surface. The checks are listed here first
 * because getting them wrong is how a service gets paid nothing and delivers
 * anyway — or charges twice for one payment.
 */

export interface VerificationRequest {
  txHash: Hex;
  invoiceId: string;
  expectedVault: Address;
  expectedToken: Address;
  expectedRecipient: Address;
  expectedMinAmount: bigint;
  expectedIntentHash: Hex;
}

export type VerificationResult =
  | {ok: true; amount: bigint; payer: Address}
  | {ok: false; reason: string};

export async function verifyPayment(
  client: PublicClient,
  req: VerificationRequest,
): Promise<VerificationResult> {
  const receipt = await client.waitForTransactionReceipt({
    hash: req.txHash,
    confirmations: ARC_CONFIRMATIONS,
  });

  if (receipt.status !== "success") {
    return {ok: false, reason: "Transaction reverted."};
  }

  for (const log of receipt.logs) {
    // The log must come from the vault we expect. Anyone can deploy a contract
    // that emits an identically-shaped event; only this vault's logs count.
    if (log.address.toLowerCase() !== req.expectedVault.toLowerCase()) continue;

    let decoded;
    try {
      decoded = decodeEventLog({
        abi: agentVaultAbi,
        data: log.data,
        topics: log.topics,
      });
    } catch {
      continue; // not one of ours
    }

    if (decoded.eventName !== "PaymentExecuted") continue;

    const {sessionKey, to, token, amount, intentHash} = decoded.args as {
      sessionKey: Address;
      to: Address;
      token: Address;
      amount: bigint;
      intentHash: Hex;
    };

    if (to.toLowerCase() !== req.expectedRecipient.toLowerCase()) {
      return {ok: false, reason: "Payment was sent to a different recipient."};
    }
    // Settle only in the token actually quoted, so a payment in some other
    // asset the vault might one day support cannot discharge a USDC invoice.
    if (token.toLowerCase() !== req.expectedToken.toLowerCase()) {
      return {ok: false, reason: "Payment was made in a different token."};
    }
    if (amount < req.expectedMinAmount) {
      return {ok: false, reason: "Payment is below the quoted price."};
    }
    // Binds this payment to this invoice, so one transaction cannot settle two.
    if (intentHash.toLowerCase() !== req.expectedIntentHash.toLowerCase()) {
      return {ok: false, reason: "Payment does not reference this invoice."};
    }

    return {ok: true, amount, payer: sessionKey};
  }

  return {ok: false, reason: "No matching PaymentExecuted event from the expected vault."};
}
