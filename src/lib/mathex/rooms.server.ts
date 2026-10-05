import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

import type { Room, RoomSocketData } from "./schemas";
import { restorePlayerCounts, sanitizeRoomSettings } from "./room-state";

type StoredRoom = Omit<Room, "players"> & { players: [string, RoomSocketData][] };

export class RoomStore {
  private database: Database;

  constructor(path = process.env.MATHEX_DB_PATH || "data/mathex.sqlite") {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new Database(path, { create: true });
    this.database.run(`
      CREATE TABLE IF NOT EXISTS mathex_rooms (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  loadRooms(): Map<string, Room> {
    const rooms = new Map<string, Room>();
    const rows = this.database.query<{ id: string; data: string }, []>("SELECT id, data FROM mathex_rooms").all();
    for (const row of rows) {
      try {
        const stored = JSON.parse(row.data) as StoredRoom;
        const players = new Map(stored.players);
        // Pending answer timers cannot survive a restart. Let affected players continue normally.
        for (const player of players.values()) {
          player.isRunning = false;
          player.runningUntil = null;
          restorePlayerCounts(player, stored);
        }
        const room: Room = {
          ...stored,
          players,
          settings: sanitizeRoomSettings(stored.settings),
          endsAt: typeof stored.endsAt === "number" && Number.isFinite(stored.endsAt) ? stored.endsAt : null,
          startedAt:
            stored.startedAt ??
            [...players.values()].find((player) => player.startingTime !== null)?.startingTime ??
            null,
          chat: Array.isArray(stored.chat) ? stored.chat.slice(-200) : []
        };
        // A deadline that passed while the server was down finishes the room
        // now, so clients never see a live round with a past deadline.
        if (room.state === "started" && room.endsAt !== null && room.endsAt <= Date.now()) {
          room.state = "finished";
          room.endsAt = null;
          const now = Date.now();
          for (const player of room.players.values()) {
            if (player.startingTime !== null) player.finishingTime ??= now;
            player.isRunning = false;
            player.runningUntil = null;
          }
          this.save(room);
        }
        rooms.set(row.id, room);
      } catch {
        // Keep a corrupt historical row from preventing active rooms from loading.
      }
    }
    return rooms;
  }

  save(room: Room) {
    const stored: StoredRoom = { ...room, players: [...room.players.entries()] };
    this.database
      .query("INSERT OR REPLACE INTO mathex_rooms (id, data, updated_at) VALUES (?, ?, ?)")
      .run(room.id, JSON.stringify(stored), Date.now());
  }
}
