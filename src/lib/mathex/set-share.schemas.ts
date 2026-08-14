import { z } from "zod";
import { QuestionSet } from "./schemas";

export const SetShareToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
export const SetShareExpiryMs = z.union([
  z.literal(60 * 60 * 1000),
  z.literal(6 * 60 * 60 * 1000),
  z.literal(12 * 60 * 60 * 1000),
  z.literal(24 * 60 * 60 * 1000)
]);
export const CreateSetShareInput = z.object({
  set: QuestionSet,
  expiresInMs: SetShareExpiryMs
});

export type SharedSet = {
  set: z.infer<typeof QuestionSet>;
  expiresAt: number;
};
export type CreateSetShareResult = { ok: true; token: string; expiresAt: number } | { ok: false; error: string };
export type GetSetShareResult = { ok: true; share: SharedSet } | { ok: false; error: string };

export interface SetShareClientToServerEvents {
  createShare: (input: unknown, callback: (result: CreateSetShareResult) => void) => void;
  getShare: (token: string, callback: (result: GetSetShareResult) => void) => void;
}

export interface SetShareServerToClientEvents {}
export interface SetShareInterServerEvents {}
export interface SetShareSocketData {}
