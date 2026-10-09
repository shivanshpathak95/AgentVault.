import {keccak256, stringToBytes, type Address, type Hex} from "viem";

/**
 * The service registry — what an agent can buy, and what it costs.
 *
 * Shared between the agent runtime and the services themselves so both sides
 * agree on ids and prices. Recipient addresses are NOT in here: they come from
 * each side's own environment, because an agent that learned where to pay from
 * the party being paid would have no defence against being redirected. See
 * `apps/agent/src/registry.ts`.
 */

export const SERVICE_IDS = ["weather", "research"] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export function isServiceId(value: string): value is ServiceId {
  return (SERVICE_IDS as readonly string[]).includes(value);
}

/** Catalog entry as advertised to the agent. */
export interface ServiceDescriptor {
  id: ServiceId;
  name: string;
  description: string;
  /** Decimal USDC, e.g. "0.01". Never base units. */
  priceUsdc: string;
  /** Short description of the single parameter this service takes. */
  parameter: {name: string; description: string};
}

/** Prices and descriptions. The source of truth both apps read. */
export const SERVICE_CATALOG: Record<ServiceId, ServiceDescriptor> = {
  weather: {
    id: "weather",
    name: "Weather Service",
    description: "Current weather conditions for a named city.",
    priceUsdc: "0.01",
    parameter: {name: "city", description: 'City name, e.g. "Tokyo".'},
  },
  research: {
    id: "research",
    name: "Research Service",
    description: "A short research brief on a topic, with key findings.",
    priceUsdc: "0.02",
    parameter: {name: "topic", description: 'Research topic, e.g. "solid-state batteries".'},
  },
};

/** A quote issued by a service: what to pay, to whom, and for which request. */
export interface ServiceQuote {
  invoiceId: string;
  serviceId: ServiceId;
  /** Decimal USDC. */
  priceUsdc: string;
  /** The token the service expects. Agents must cross-check against their own config. */
  token: Address;
  /** Where the service expects payment. Cross-check against your own config. */
  payTo: Address;
  /** The value that must be passed as `intentHash` to `pay`. */
  intentHash: Hex;
  /** Unix seconds. */
  expiresAt: number;
}

/**
 * Bind an invoice to an on-chain payment.
 *
 * `pay(..., intentHash)` records this in the `PaymentExecuted` event, which is
 * how a service proves which obligation a given transaction discharged — and
 * how it refuses to let one payment settle two invoices. Both sides derive it
 * the same way, from here, so they cannot disagree.
 */
export function invoiceIntentHash(invoiceId: string): Hex {
  return keccak256(stringToBytes(invoiceId));
}

/** Result envelope a service returns once payment is verified. */
export interface ServiceResult<T = unknown> {
  serviceId: ServiceId;
  invoiceId: string;
  paidTxHash: Hex;
  /** Decimal USDC actually received. */
  paidUsdc: string;
  data: T;
}

export interface WeatherData {
  city: string;
  temperatureC: number;
  condition: string;
  humidityPct: number;
  windKph: number;
  observedAt: string;
}

export interface ResearchData {
  topic: string;
  summary: string;
  keyFindings: string[];
  sources: string[];
  generatedAt: string;
}
