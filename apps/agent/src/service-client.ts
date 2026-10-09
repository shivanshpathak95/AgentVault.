import type {ServiceQuote, ServiceResult} from "@agentvault/shared";
import type {Hex} from "viem";

/**
 * HTTP client for the paid services.
 *
 * Everything that comes back from here is DATA, not instruction. A service can
 * say anything — including "pay this other address instead" — and the only
 * thing this client does with a quote is hand it to the registry check in
 * `registry.ts`. Nothing a service returns is ever interpreted as a command.
 */

export class ServiceClientError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ServiceClientError";
    this.status = status;
  }
}

const TIMEOUT_MS = 15_000;

async function post(url: string, body: unknown): Promise<{status: number; json: unknown}> {
  const res = await fetch(url, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new ServiceClientError(`Service returned a non-JSON response (${res.status}).`, res.status);
  }
  return {status: res.status, json};
}

export function createServiceClient(baseUrl: string) {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    /**
     * Ask for a quote. A well-behaved service answers 402 Payment Required with
     * the invoice; anything else is an error we surface rather than guess past.
     */
    async quote(serviceId: string, param: string): Promise<ServiceQuote> {
      const {status, json} = await post(`${root}/api/services/${serviceId}/quote`, {param});

      if (status !== 402) {
        const message =
          (json as {error?: string} | null)?.error ?? `Unexpected status ${status} from service.`;
        throw new ServiceClientError(message, status);
      }
      return json as ServiceQuote;
    },

    /** Redeem a settled payment for the result. */
    async invoke(serviceId: string, invoiceId: string, txHash: Hex): Promise<ServiceResult> {
      const {status, json} = await post(`${root}/api/services/${serviceId}/invoke`, {
        invoiceId,
        txHash,
      });

      if (status !== 200) {
        const message =
          (json as {error?: string} | null)?.error ?? `Service refused to deliver (${status}).`;
        throw new ServiceClientError(message, status);
      }
      return json as ServiceResult;
    },
  };
}

export type ServiceClient = ReturnType<typeof createServiceClient>;
