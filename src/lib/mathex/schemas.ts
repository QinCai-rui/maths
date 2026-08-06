import { z } from "zod";
import type { ToastT } from "svelte-sonner";

export const RoomName = z
  .string()
  .min(3, "The room name has to be at least 3 characters long")
  .max(60, "The room name cannot be greater than 60 characters long");

export type State = "connecting" | "choose-name" | "waiting_start" | "started" | "finished";

export interface RoomServerToClientEvents {
  alert: (type: ToastT["type"], message: string) => void;
  lobby: () => void;
  gameStart: () => void;
  gameFinish: () => void;
  running: (durationMs: number) => void;
  stopRunning: () => void;
  newQuestion: (question: string, questionType: z.infer<typeof Question>["type"]) => void;
  confetti: () => void;
  questionCount: (data: number) => void;
}

export interface RoomClientToServerEvents {
  join: (name: string) => void;
  answer: (value: string | number) => void;
}

export interface RoomInterServerEvents {}

export interface RoomSocketData {
  name: string | null;
  currentQuestion: number;
  startingTime: number | null;
  finishingTime: number | null;
  isRunning: boolean;
}

export interface RoomCreateClientToServerEvents {
  newRoom: (name: string, questions: z.infer<typeof Question>[], runningTimeMs: number) => void;
  checkRoom: (id: string, callback: (exists: boolean) => void) => void;
}

export interface RoomCreateServerToClientEvents {
  goto: (path: string) => void;
}

export interface RoomCreateInterServerEvents {}

export interface RoomCreateSocketData {}

export interface RoomManageClientToServerEvents {
  start: () => void;
  finish: () => void;
  alertAll: (type: ToastT["type"], message: string) => void;
}

export interface RoomManageServerToClientEvents {
  alert: (type: ToastT["type"], message: string) => void;
  state: (state: RoomState) => void;
  playerData: (data: RoomSocketData[]) => void;
}

export interface RoomManageInterServerEvents {}

export interface RoomManageSocketData {}

export const SolutionItem = z.union([
  z.object({
    type: z.literal("number"),
    value: z.number()
  }),
  z.object({
    type: z.literal("text"),
    value: z.string()
  }),
  z.object({
    type: z.literal("expression"),
    value: z.string()
  })
]);

export const NumberQuestion = z.object({
  contents: z.string(),
  solutions: z.array(SolutionItem)
});

export const TextQuestion = z.object({
  contents: z.string(),
  solutions: z.array(SolutionItem)
});

export const ExpressionQuestion = z.object({
  contents: z.string(),
  solutions: z.array(SolutionItem),
  allowEquivalent: z.boolean()
});

export const Question = z.union([
  z.object({
    type: z.literal("number"),
    data: NumberQuestion
  }),
  z.object({
    type: z.literal("text"),
    data: TextQuestion
  }),
  z.object({
    type: z.literal("expression"),
    data: ExpressionQuestion
  })
]);

export type RoomState = "lobby" | "started" | "finished";

export interface Room {
  id: string;
  name: string;
  questions: z.infer<typeof Question>[];
  runToken: string;
  state: RoomState;
  runningTimeMs: number;
}

export interface ClientKnownRoom {
  id: string;
  playerCount: number;
  name: string;
  questionCount: number;
}
