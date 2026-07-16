import crypto from "node:crypto";
import { prisma } from "./db.ts";
import { sha256Hex } from "./crypto.ts";

export const STREAM_MAX_DURATION_MS = 5 * 60_000;
const MAX_GLOBAL_STREAMS = 500;
const MAX_IP_STREAMS = 5;
const MAX_SESSION_STREAMS = 100;

export type StreamEvent = Awaited<ReturnType<typeof fetchEvents>>[number];
type Subscriber = (event: StreamEvent) => void;

async function fetchEvents(sessionId: bigint, cursor: bigint) {
  return prisma.event.findMany({
    where: { sessionId, sequence: { gt: cursor } }, orderBy: { sequence: "asc" }, take: 200,
    select: { sequence: true, type: true, payload: true, agentId: true, createdAt: true, agent: { select: { id: true, name: true, role: true, character: { select: { name: true } } } } },
  });
}

class SessionHub {
  private cursor = 0n;
  private listeners = new Set<Subscriber>();
  private running = false;
  readonly sessionId: bigint;
  private readonly onEmpty: () => void;
  constructor(sessionId: bigint, onEmpty: () => void) { this.sessionId = sessionId; this.onEmpty = onEmpty; }
  subscribe(listener: Subscriber) {
    this.listeners.add(listener);
    if (!this.running) void this.poll();
    return () => { this.listeners.delete(listener); };
  }
  private async poll() {
    this.running = true;
    let idle = 0;
    try {
      while (this.listeners.size) {
        let events: StreamEvent[];
        try { events = await fetchEvents(this.sessionId, this.cursor); }
        catch { await new Promise((resolve) => setTimeout(resolve, 5000)); continue; }
        for (const event of events) {
          this.cursor = event.sequence;
          for (const listener of this.listeners) listener(event);
        }
        idle = events.length ? 0 : Math.min(idle + 1, 3);
        await new Promise((resolve) => setTimeout(resolve, idle >= 2 ? 5000 : 1500));
      }
    } finally { this.running = false; if (!this.listeners.size) this.onEmpty(); }
  }
}

const hubs = new Map<string, SessionHub>();

/**
 * Acquire a database-backed lease. The transaction and serializable isolation
 * prevent two app processes from both admitting a connection over a shared
 * limit. Expiry cleanup makes crashed clients self-healing.
 */
export async function acquireStreamSlot(ip: string, sessionId: bigint): Promise<(() => void) | null> {
  const token = crypto.randomBytes(24).toString("base64url");
  const ipHash = sha256Hex(ip);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STREAM_MAX_DURATION_MS);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.streamLease.deleteMany({ where: { expiresAt: { lte: now } } });
      const [global, byIp, bySession] = await Promise.all([
        tx.streamLease.count(),
        tx.streamLease.count({ where: { ipHash } }),
        tx.streamLease.count({ where: { sessionId } }),
      ]);
      if (global >= MAX_GLOBAL_STREAMS || byIp >= MAX_IP_STREAMS || bySession >= MAX_SESSION_STREAMS) {
        throw new Error("STREAM_LIMIT");
      }
      await tx.streamLease.create({ data: { token, sessionId, ipHash, expiresAt } });
    }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 10_000 });
  } catch (error) {
    if (error instanceof Error && error.message === "STREAM_LIMIT") return null;
    // Fail closed if the shared limiter is unavailable.
    return null;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    void prisma.streamLease.delete({ where: { token } }).catch(() => undefined);
  };
}

export function sessionHub(sessionId: bigint) {
  const key = String(sessionId);
  let hub = hubs.get(key);
  if (!hub) { hub = new SessionHub(sessionId, () => hubs.delete(key)); hubs.set(key, hub); }
  return hub;
}

export { fetchEvents };
