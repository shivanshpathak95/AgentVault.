import type {PaymentOutcome, VaultStatus} from "@agentvault/shared";
import type {SessionSigner} from "../chain/session-signer.ts";

/**
 * PHASE 4 — the Claude tool-calling loop.
 *
 * Planned shape, recorded here so the interface is settled before the UI depends
 * on it:
 *
 *   - `client.beta.messages.toolRunner({ model, tools, messages })` drives the
 *     loop; the three handlers below are the tool implementations.
 *   - Default model `claude-opus-5-5` with adaptive thinking, so the transcript
 *     shows the model reasoning about a refusal rather than silently retrying.
 *   - Stream events out to /demo over SSE so a viewer sees reasoning, the tool
 *     call, and the on-chain verdict in order.
 *
 * The single rule this module must hold to: a contract revert is decoded into a
 * structured `PaymentOutcome` with status "rejected" and handed back to the
 * model as a normal tool result. It is never thrown, never retried
 * automatically, and never hidden. A rejection is information the agent is
 * supposed to reason about — that is the whole demonstration.
 */

export interface AgentToolHandlers {
  getVaultStatus(): Promise<VaultStatus>;
  checkPolicy(to: string, amount: string): Promise<PaymentOutcome | {status: "ok"}>;
  requestPayment(to: string, amount: string, reference: string): Promise<PaymentOutcome>;
}

export interface AgentRunOptions {
  signer: SessionSigner;
  model: string;
  prompt: string;
}

export async function runAgent(_options: AgentRunOptions): Promise<never> {
  throw new Error("Not implemented — Phase 4. See docs/ARCHITECTURE.md §6 and §11.");
}
