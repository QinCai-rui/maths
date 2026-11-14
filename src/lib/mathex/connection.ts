import { io as connect, type Socket } from "socket.io-client";

export const CONNECTION_EVENT = "mathex-connection-interrupted";

/** Keep recovery in Socket.IO; only notify after a sustained interruption. */
export function watchConnection(socket: Socket) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const interrupted = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (!socket.connected && socket.active && typeof window !== "undefined") {
        window.dispatchEvent(new Event(CONNECTION_EVENT));
      }
    }, 10000);
  };
  socket.on("connect", clear);
  let checking = false;
  socket.on("connect_error", () => {
    interrupted();
    if (checking || typeof window === "undefined") return;
    checking = true;
    void fetch("/mathex/connection-check", { cache: "no-store", signal: AbortSignal.timeout(3000) })
      .then((response) => {
        if (response.status === 403 && !socket.connected) {
          clear();
          window.dispatchEvent(new Event(CONNECTION_EVENT));
        }
      })
      .catch(() => {})
      .finally(() => {
        checking = false;
      });
  });
  // Socket.IO buffers ordinary emits while offline. A stale answer or edit
  // must not be submitted later without the user choosing to send it again.
  const emit = socket.emit;
  socket.emit = function (...args) {
    if (!socket.connected) {
      if (typeof window !== "undefined") window.dispatchEvent(new Event(CONNECTION_EVENT));
      const internal = socket as unknown as { flags: { timeout?: number } };
      const timed = internal.flags.timeout !== undefined;
      internal.flags = {};
      const acknowledgement = args.at(-1);
      if (typeof acknowledgement === "function") {
        queueMicrotask(() =>
          acknowledgement(
            timed
              ? new Error("Connection interrupted")
              : {
                  ok: false,
                  error: "Connection interrupted. Reconnect before trying again."
                }
          )
        );
      }
      return socket;
    }
    return emit.apply(socket, args);
  };
  socket.on("disconnect", (reason) => {
    if (reason === "io client disconnect" || reason === "io server disconnect") clear();
    else interrupted();
  });
  return socket;
}

export const io: typeof connect = ((...args: Parameters<typeof connect>) =>
  watchConnection(connect(...args))) as typeof connect;
