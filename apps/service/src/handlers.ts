import {createHash} from "node:crypto";
import type {ResearchData, ServiceId, WeatherData} from "@agentvault/shared";

/**
 * The actual paid work.
 *
 * Deterministic demo data derived from the request parameter: the same city
 * always returns the same weather. That is a demo choice, not a shortcut around
 * payment — these run behind a real HTTP endpoint that refuses to answer until
 * it has verified a settled on-chain payment itself. What is being demonstrated
 * is the payment rail, so the payload is kept boring on purpose and reproducible
 * so a judge re-running the demo sees the same thing twice.
 */

/** Stable pseudo-randomness from a string, so demos are reproducible. */
function seeded(input: string, salt: string): number {
  const digest = createHash("sha256").update(`${salt}:${input.toLowerCase()}`).digest();
  // First 4 bytes as a fraction in [0, 1).
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

function pick<T>(items: readonly T[], input: string, salt: string): T {
  const index = Math.floor(seeded(input, salt) * items.length);
  // noUncheckedIndexedAccess: clamp rather than assert.
  return items[Math.min(index, items.length - 1)] as T;
}

const CONDITIONS = [
  "Clear",
  "Partly cloudy",
  "Overcast",
  "Light rain",
  "Heavy rain",
  "Thunderstorms",
  "Snow",
  "Fog",
] as const;

export function weather(city: string): WeatherData {
  return {
    city,
    temperatureC: Math.round((seeded(city, "temp") * 38 - 6) * 10) / 10,
    condition: pick(CONDITIONS, city, "cond"),
    humidityPct: Math.round(seeded(city, "hum") * 70 + 25),
    windKph: Math.round(seeded(city, "wind") * 45 * 10) / 10,
    observedAt: new Date().toISOString(),
  };
}

export function research(topic: string): ResearchData {
  return {
    topic,
    summary:
      `Demo research brief on "${topic}". Activity in this area has accelerated over the ` +
      `last eighteen months, with the main constraints now being cost and supply chain ` +
      `rather than feasibility.`,
    keyFindings: [
      `Commercial interest in ${topic} has grown steadily, concentrated in three vendors.`,
      `The dominant cost driver is manufacturing yield, not raw materials.`,
      `Regulatory treatment of ${topic} remains unsettled across major jurisdictions.`,
    ],
    sources: [
      "https://example.invalid/demo-source-1",
      "https://example.invalid/demo-source-2",
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** Run a service's work for a validated parameter. */
export function execute(serviceId: ServiceId, param: string): WeatherData | ResearchData {
  switch (serviceId) {
    case "weather":
      return weather(param);
    case "research":
      return research(param);
  }
}
