import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { SharedSet } from "./set-share.schemas";

export class SetShareStore {
  private database: Database;

  constructor(path = process.env.MATHEX_DB_PATH || "data/mathex.sqlite") {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true });
    this.database.run(`
      CREATE TABLE IF NOT EXISTS mathex_set_shares (
        token TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  save(token: string, share: SharedSet): void {
    this.cleanup();
    this.database
      .query("INSERT INTO mathex_set_shares (token, data, expires_at) VALUES (?, ?, ?)")
      .run(token, JSON.stringify(share.set), share.expiresAt);
  }

  get(token: string): SharedSet | null {
    const row = this.database
      .query<{ data: string; expires_at: number }, [string]>(
        "SELECT data, expires_at FROM mathex_set_shares WHERE token = ?"
      )
      .all(token)[0];
    if (!row || row.expires_at <= Date.now()) {
      if (row) this.database.query("DELETE FROM mathex_set_shares WHERE token = ?").run(token);
      return null;
    }
    try {
      return { set: JSON.parse(row.data), expiresAt: row.expires_at };
    } catch {
      this.database.query("DELETE FROM mathex_set_shares WHERE token = ?").run(token);
      return null;
    }
  }

  private cleanup(): void {
    this.database.query("DELETE FROM mathex_set_shares WHERE expires_at <= ?").run(Date.now());
  }
}
