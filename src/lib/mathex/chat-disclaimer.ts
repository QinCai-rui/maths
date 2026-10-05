const CHAT_DISCLAIMER_KEY = "mathex-chat-disclaimer-v2";

export const CHAT_DISCLAIMER =
  "Player messages are visible to everyone in the room. Hosts can read and delete messages, mute players, or turn chat off. Do not share personal information.";

export function hasDismissedChatDisclaimer() {
  try {
    return localStorage.getItem(CHAT_DISCLAIMER_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissChatDisclaimer() {
  try {
    localStorage.setItem(CHAT_DISCLAIMER_KEY, "1");
  } catch {
    /* Storage is optional. */
  }
}
