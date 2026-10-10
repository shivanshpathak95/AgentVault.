import {randomUUID} from "node:crypto";
import type {ActivityEntry} from "@agentvault/shared";

/**
 * Structured activity log.
 *
 * Every payment attempt lands here — settled, rejected by policy, or failed to
 * submit — with the timestamp, service, amount, recipient, transaction hash and
 * rejection reason. Rejections are recorded with the same weight as settlements
 * because they are the product working, not errors to bury.
 *
 * In-memory ring buffer plus a JSON line on stdout, so the operator console can
 * poll it and a terminal demo still shows something useful. Swap for a database
 * if this outlives the hackathon.
 */

const MAX_ENTRIES = 500;

export class ActivityLog {
  readonly #entries: ActivityEntry[] = [];

  record(entry: Omit<ActivityEntry, "id" | "timestamp">): ActivityEntry {
    const full: ActivityEntry = {
      id: `act_${randomUUID()}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.#entries.unshift(full);
    if (this.#entries.length > MAX_ENTRIES) this.#entries.length = MAX_ENTRIES;

    console.log(JSON.stringify({event: "activity", ...full}));
    return full;
  }

  /**
   * Attach the service outcome to the payment that bought it.
   *
   * A payment that settled and a service that then failed to deliver are two
   * separate facts. The payment is NOT reversed and must not be shown as
   * such; this records the delivery failure alongside it.
   */
  annotateService(
    reference: string,
    outcome: {serviceStatus: "delivered" | "failed"; serviceMessage?: string},
  ): ActivityEntry | undefined {
    const entry = this.#entries.find((e) => e.reference === reference && e.status === "executed");
    if (!entry) return undefined;
    entry.serviceStatus = outcome.serviceStatus;
    if (outcome.serviceMessage !== undefined) entry.serviceMessage = outcome.serviceMessage;
    console.log(JSON.stringify({event: "activity.service", id: entry.id, ...outcome}));
    return entry;
  }

  /** Most recent first. */
  list(limit = 50): ActivityEntry[] {
    return this.#entries.slice(0, Math.max(0, limit));
  }

  get size(): number {
    return this.#entries.length;
  }
}
