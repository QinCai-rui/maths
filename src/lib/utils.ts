import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};

export const msToMinutesAndSeconds = (ms: number) => {
  const sign = ms < 0 ? "−" : "";
  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${sign}${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

const ISSUE_REPO = "QinCai-rui/maths";

function redactSecrets(value: string) {
  return value
    .replace(/\b(runToken|hostToken|token|access_token|api_key)=[^&#\s]*/gi, "$1=[redacted]")
    .replace(/(\/mathex\/app\/create\/editor(?:\/share)?\/)[^/?#\s]+/gi, "$1[token]");
}

function publicPageUrl(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${redactSecrets(url.pathname)}`;
  } catch {
    return redactSecrets(value.split(/[?#]/)[0] || value);
  }
}

export function reportIssueUrl(status: number, pageUrl: string, message?: string) {
  const safeUrl = publicPageUrl(pageUrl);
  const safeMessage = redactSecrets(message || "unknown");
  const params = new URLSearchParams({
    title: `Error ${status} on ${safeUrl}`,
    body: `Status: ${status}\nURL: ${safeUrl}\nMessage: ${safeMessage}\n\nWhat I was doing:\n`
  });
  return `https://github.com/${ISSUE_REPO}/issues/new?${params.toString()}`;
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy API when the secure clipboard API is blocked.
    }
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard access is unavailable");
}

export function createId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes]
    .map((byte, index) => `${[4, 6, 8, 10].includes(index) ? "-" : ""}${byte.toString(16).padStart(2, "0")}`)
    .join("");
}
