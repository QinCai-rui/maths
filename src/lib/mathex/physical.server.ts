import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Database } from "bun:sqlite";

import type { PhysicalCompetition, PhysicalTeam } from "./physical.schemas";

type StoredPhysicalCompetition = Omit<PhysicalCompetition, "teams"> & { teams: [string, PhysicalTeam][] };

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashMarkerPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const digest = await scryptAsync(pin, salt, 32);
  return `${salt.toString("hex")}:${digest.toString("hex")}`;
}

export async function verifyMarkerPin(pin: string, storedHash: string): Promise<boolean> {
  const [saltHex, digestHex, extra] = storedHash.split(":");
  if (!saltHex || !digestHex || extra) return false;
  try {
    const expected = Buffer.from(digestHex, "hex");
    if (expected.length === 0) return false;
    const actual = await scryptAsync(pin, Buffer.from(saltHex, "hex"), expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export class PhysicalCompetitionStore {
  private database: Database;

  constructor(path = process.env.MATHEX_DB_PATH || "data/mathex.sqlite") {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true });
    this.database.run(`
      CREATE TABLE IF NOT EXISTS mathex_physical_competitions (
        code TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  load(): Map<string, PhysicalCompetition> {
    const competitions = new Map<string, PhysicalCompetition>();
    const rows = this.database
      .query<{ code: string; data: string }, []>("SELECT code, data FROM mathex_physical_competitions")
      .all();
    for (const row of rows) {
      try {
        const stored = JSON.parse(row.data) as StoredPhysicalCompetition;
        if (stored.code !== row.code || !/^\d{6}$/.test(row.code) || !Array.isArray(stored.teams)) continue;
        competitions.set(row.code, { ...stored, teams: new Map(stored.teams) });
      } catch {
        // A corrupt historical competition must not prevent valid competitions loading.
      }
    }
    return competitions;
  }

  save(competition: PhysicalCompetition): void {
    const stored: StoredPhysicalCompetition = { ...competition, teams: [...competition.teams.entries()] };
    this.database
      .query("INSERT OR REPLACE INTO mathex_physical_competitions (code, data, updated_at) VALUES (?, ?, ?)")
      .run(competition.code, JSON.stringify(stored), Date.now());
  }
}
