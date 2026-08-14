import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

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
        const set = CollaborativeSetSnapshotSchema.parse(JSON.parse(row.data));
        if (set.sessionToken === row.session_token) sets.set(row.session_token, { hostToken: row.host_token, set });
      } catch {
        // Ignore a corrupt row without affecting other durable sessions.
      }
    }
    return sets;
  }

  save(session: StoredCollaborativeSet): void {
    this.database
      .query(
        "INSERT OR REPLACE INTO mathex_collaborative_sets (session_token, host_token, data, updated_at) VALUES (?, ?, ?, ?)"
      )
      .run(session.set.sessionToken, session.hostToken, JSON.stringify(session.set), session.set.updatedAt);
  }

  delete(sessionToken: string): void {
    this.database.query("DELETE FROM mathex_collaborative_sets WHERE session_token = ?").run(sessionToken);
  }
}
