import type {IncomingMessage, ServerResponse} from "node:http";

/** Minimal HTTP helpers. No framework: two endpoints do not justify one. */

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    // The agent runtime and the operator console are separate origins.
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(payload);
}

const MAX_BODY_BYTES = 64 * 1024;

/** Read and parse a JSON request body, with a hard size cap. */
export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) throw new Error("Request body too large.");
    chunks.push(buf);
  }

  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body is not valid JSON.");
  }
}

/** Read a required string field from an unknown JSON body. */
export function requireString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or invalid "${field}".`);
  }
  return value.trim();
}

export function optionalString(body: unknown, field: string): string | undefined {
  const value = (body as Record<string, unknown> | null)?.[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
