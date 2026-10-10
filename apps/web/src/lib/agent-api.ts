import type {ActivityEntry, ServiceId} from "@agentvault/shared";
import type {Address, Hex} from "viem";

/**
 * Typed client for the agent runtime (apps/agent).
 *
 * Only the base URL is public config — the session key lives in that process
 * and is never exposed here. Everything this client returns is backend-derived
 * and is labelled as such in the UI, so a reader can always tell what was read
 * from the chain and what was read from a server.
 */

export const AGENT_API_URL = (
  process.env.NEXT_PUBLIC_AGENT_API_URL ?? "http://localhost:8787"
).replace(/\/+$/, "");

export class AgentApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${AGENT_API_URL}${path}`, {
      ...init,
      headers: {"content-type": "application/json", ...init?.headers},
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    // A backend that is not running is the single most likely local failure.
    // Say so plainly rather than surfacing "Failed to fetch".
    throw new AgentApiError(
      `Cannot reach the agent backend at ${AGENT_API_URL}. Is it running? ` +
        `(${err instanceof Error ? err.message : String(err)})`,
      0,
    );
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    throw new AgentApiError(`Agent backend returned a non-JSON response (${res.status}).`, res.status);
  }

  if (!res.ok) {
    const message = (body as {error?: string} | null)?.error ?? `Request failed (${res.status}).`;
    throw new AgentApiError(message, res.status);
  }
  return body as T;
}

/** GET /api/status — vault and session state, as the backend reads it. */
export interface AgentStatus {
  chain: {id: number; name: string};
  vault: Address;
  sessionKey: Address;
  sessionKeyExplorer: string;
  token: Address;
  paused: boolean;
  sessionExists: boolean;
  revoked: boolean;
  balance: string;
  maxPerTx: string;
  dailyLimit: string;
  dailyRemaining: string;
  expiresAt: number;
  gasBalanceNative: string;
}

export interface AgentRegisteredService {
  id: ServiceId;
  name: string;
  description: string;
  priceUsdc: string;
  recipient: Address;
  parameter: {name: string; description: string};
}

export interface TranscriptEntry {
  step: number;
  kind: "assistant_text" | "tool_call" | "tool_result";
  name?: string;
  text?: string;
  input?: unknown;
  output?: unknown;
}

export interface AgentRunResult {
  finalText: string;
  transcript: TranscriptEntry[];
  steps: number;
  stopReason: string | null;
  usage: {inputTokens: number; outputTokens: number};
  activity: ActivityEntry[];
}

export const agentApi = {
  health: () => request<{ok: boolean; vault: Address; sessionKey: Address; model: string}>("/health"),
  status: () => request<AgentStatus>("/api/status"),
  services: () => request<{services: AgentRegisteredService[]}>("/api/services"),
  activity: (limit = 50) => request<{entries: ActivityEntry[]}>(`/api/activity?limit=${limit}`),
  run: (prompt: string) =>
    request<AgentRunResult>("/api/run", {method: "POST", body: JSON.stringify({prompt})}),
};

/** Shape of the settlement facts a tool result carries, for the detail panel. */
export interface PaymentToolResult {
  status?: "executed" | "rejected" | "failed" | "unconfirmed";
  stage?: string;
  txHash?: Hex;
  explorerUrl?: string;
  amountPaid?: string;
  dailyRemaining?: string;
  reason?: string;
  message?: string;
  detail?: Record<string, string>;
  invoiceId?: string;
}
