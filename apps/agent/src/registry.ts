import {
  SERVICE_CATALOG,
  SERVICE_IDS,
  isServiceId,
  requiredAddress,
  type ServiceDescriptor,
  type ServiceId,
} from "@agentvault/shared";
import type {Address} from "viem";

/**
 * The agent's own service registry.
 *
 * Recipient addresses come from THIS process's environment, never from the
 * service being paid. That ordering is the point: a service that returns a
 * quote saying "pay 200 USDC to 0xATTACKER" is making a claim, and a claim is
 * checked, not obeyed. `assertQuoteMatchesRegistry` rejects any quote whose
 * recipient, token or price disagrees with what the operator configured.
 *
 * This is defence in depth and nothing more. The vault's on-chain allowlist is
 * what actually stops the payment; this layer exists so the agent fails early,
 * with a clear reason, instead of burning gas discovering the same thing.
 */

export interface RegisteredService extends ServiceDescriptor {
  /** Where the operator says this service may be paid. */
  recipient: Address;
}

export type ServiceRegistry = Readonly<Record<ServiceId, RegisteredService>>;

export function loadRegistry(): ServiceRegistry {
  return {
    weather: {
      ...SERVICE_CATALOG.weather,
      recipient: requiredAddress(
        process.env.WEATHER_SERVICE_ADDRESS,
        "WEATHER_SERVICE_ADDRESS",
      ),
    },
    research: {
      ...SERVICE_CATALOG.research,
      recipient: requiredAddress(
        process.env.RESEARCH_SERVICE_ADDRESS,
        "RESEARCH_SERVICE_ADDRESS",
      ),
    },
  };
}

export function listServices(registry: ServiceRegistry): RegisteredService[] {
  return SERVICE_IDS.map((id) => registry[id]);
}

export function lookupService(
  registry: ServiceRegistry,
  serviceId: string,
): RegisteredService | undefined {
  return isServiceId(serviceId) ? registry[serviceId] : undefined;
}

export class QuoteMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuoteMismatchError";
  }
}

/**
 * Reject a quote that disagrees with the operator's configuration.
 *
 * Checks recipient, token and price. Price is compared exactly: a service that
 * quietly raises its price mid-session is as much a problem as one that
 * redirects payment, and "it was only a bit more" is not a judgement an
 * autonomous agent should be making on its own.
 */
export function assertQuoteMatchesRegistry(
  service: RegisteredService,
  quote: {payTo: Address; token: Address; priceUsdc: string; serviceId: string},
  expectedToken: Address,
): void {
  if (quote.serviceId !== service.id) {
    throw new QuoteMismatchError(
      `Quote is for service "${quote.serviceId}" but "${service.id}" was requested.`,
    );
  }

  if (quote.payTo.toLowerCase() !== service.recipient.toLowerCase()) {
    throw new QuoteMismatchError(
      `${service.name} asked to be paid at ${quote.payTo}, but the operator configured ` +
        `${service.recipient} for this service. Refusing to pay an unexpected address.`,
    );
  }

  if (quote.token.toLowerCase() !== expectedToken.toLowerCase()) {
    throw new QuoteMismatchError(
      `${service.name} asked for payment in token ${quote.token}, but this vault pays in ` +
        `${expectedToken}.`,
    );
  }

  if (quote.priceUsdc !== service.priceUsdc) {
    throw new QuoteMismatchError(
      `${service.name} quoted ${quote.priceUsdc} USDC but the registered price is ` +
        `${service.priceUsdc} USDC. Refusing a price that changed without the operator.`,
    );
  }
}
