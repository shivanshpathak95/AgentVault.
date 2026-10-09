import type {Address} from "viem";

export function shortAddress(value: string | undefined, lead = 6, tail = 4): string {
  if (!value) return "—";
  return value.length > lead + tail + 2 ? `${value.slice(0, lead)}…${value.slice(-tail)}` : value;
}

/** Decimal USDC string -> fixed 2dp for display. Keeps columns aligned. */
export function usdc(value: string | undefined): string {
  if (value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

export function relativeTime(iso: string | number | undefined): string {
  if (iso === undefined) return "—";
  const then = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  if (!Number.isFinite(then)) return "—";

  const delta = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(delta);
  const fmt = new Intl.RelativeTimeFormat("en", {numeric: "auto"});

  if (abs < 60) return fmt.format(delta, "second");
  if (abs < 3600) return fmt.format(Math.round(delta / 60), "minute");
  if (abs < 86_400) return fmt.format(Math.round(delta / 3600), "hour");
  return fmt.format(Math.round(delta / 86_400), "day");
}

export function absoluteTime(iso: string | number | undefined): string {
  if (iso === undefined) return "—";
  const ms = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Seconds -> "3d 4h" / "12m". Used for session expiry countdowns. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "expired";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function explorerTx(explorerUrl: string, hash: string): string {
  return `${explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}

export function explorerAddress(explorerUrl: string, address: Address | string): string {
  return `${explorerUrl.replace(/\/$/, "")}/address/${address}`;
}

/** A 32-byte hash, as opposed to something we should not link to an explorer. */
export function isTxHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}
