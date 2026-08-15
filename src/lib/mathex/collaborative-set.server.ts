import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { z } from "zod";

import {
  CollaborativeSetSnapshotSchema,
  CollaborativeSetToken,
  type CollaborativeSetSnapshot
} from "./collaborative-set.schemas";

export interface StoredCollaborativeSet {
  hostToken: string;
  set: CollaborativeSetSnapshot;
}

export class CollaborativeSetStore {
  private database: Database;
  private pending = new Map<string, StoredCollaborativeSet>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushDelayMs: number;

  constructor(path = process.env.MATHEX_DB_PATH || "data/mathex.sqlite") {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true });
    this.database.run(`
      CREATE TABLE IF NOT EXISTS mathex_collaborative_sets (
        session_token TEXT PRIMARY KEY,
        host_token TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    this.flushDelayMs = envInteger("MATHEX_COLLAB_PERSIST_DELAY_MS", 30_000, 1_000, 300_000);
  }

  load(): Map<string, StoredCollaborativeSet> {
    const sets = new Map<string, StoredCollaborativeSet>();
    const rows = this.database
      .query<{ session_token: string; host_token: string; data: string }, []>(
        "SELECT session_token, host_token, data FROM mathex_collaborative_sets"
      )
      .all();
    for (const row of rows) {
      try {
        if (!CollaborativeSetToken.safeParse(row.host_token).success) continue;
        const data: unknown = JSON.parse(row.data);
        const envelope = zStoredData.safeParse(data);
        const set = envelope.success ? envelope.data.set : CollaborativeSetSnapshotSchema.parse(data);
        if (set.sessionToken === row.session_token) {
          sets.set(row.session_token, { hostToken: row.host_token, set });
        }
      } catch {
        // Ignore a corrupt row without affecting other durable sessions.
      }
    }
    return sets;
  }

  save(session: StoredCollaborativeSet): void {
    this.pending.set(session.set.sessionToken, session);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), this.flushDelayMs);
    this.flushTimer.unref?.();
  }

  saveNow(session: StoredCollaborativeSet): void {
    this.pending.delete(session.set.sessionToken);
    this.write(session);
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const session of this.pending.values()) this.write(session);
    this.pending.clear();
  }

  private write(session: StoredCollaborativeSet): void {
    this.database
      .query(
        "INSERT OR REPLACE INTO mathex_collaborative_sets (session_token, host_token, data, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run(session.set.sessionToken, session.hostToken, JSON.stringify(session.set), session.set.updatedAt);
  }

  delete(sessionToken: string): void {
    this.pending.delete(sessionToken);
    this.database.query("DELETE FROM mathex_collaborative_sets WHERE session_token = ?").run(sessionToken);
  }
}

const zStoredData = z.object({
  set: CollaborativeSetSnapshotSchema
});

function envInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
