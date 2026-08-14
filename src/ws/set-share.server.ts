import { randomBytes } from "node:crypto";
import type { Namespace, Server } from "socket.io";
import {
  CreateSetShareInput,
  SetShareToken,
  type SetShareClientToServerEvents,
  type SetShareInterServerEvents,
  type SetShareServerToClientEvents,
  type SetShareSocketData
} from "../lib/mathex/set-share.schemas";
import { SetShareStore } from "../lib/mathex/set-share.server";

type AnyServer = Server<any, any, any, any>;

export function registerSetShareServer(io: AnyServer): void {
  const store = new SetShareStore();
  const namespace: Namespace<
    SetShareClientToServerEvents,
    SetShareServerToClientEvents,
    SetShareInterServerEvents,
    SetShareSocketData
  > = io.of("/set-share");

  namespace.on("connection", (socket) => {
    socket.on("createShare", (rawInput, callback) => {
      const input = CreateSetShareInput.safeParse(rawInput);
      if (!input.success) {
        callback({ ok: false, error: input.error.issues[0]?.message || "Invalid question set" });
        return;
      }
      const token = randomBytes(24).toString("base64url");
      const expiresAt = Date.now() + input.data.expiresInMs;
      store.save(token, { set: input.data.set, expiresAt });
      callback({ ok: true, token, expiresAt });
    });

    socket.on("getShare", (rawToken, callback) => {
      const token = SetShareToken.safeParse(rawToken);
      if (!token.success) {
        callback({ ok: false, error: "Invalid share link" });
        return;
      }
      const share = store.get(token.data);
      callback(share ? { ok: true, share } : { ok: false, error: "This share link is invalid or has expired" });
    });
  });
}
