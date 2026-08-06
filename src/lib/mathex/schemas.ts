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
  newQuestion: (question: string, solutionTypes: SolutionType[]) => void;
  confetti: () => void;
  questionCount: (data: number) => void;
  leaderboard: (data: LeaderboardEntry[]) => void;
}

export interface RoomClientToServerEvents {
  join: (name: string) => void;
  answer: (value: string | number) => void;
}

export interface RoomInterServerEvents {}

export interface RoomSocketData {
  name: string | null;
  currentQuestion: number;
  totalQuestions: number;
  startingTime: number | null;
  finishingTime: number | null;
  isRunning: boolean;
}

export type LogVerbosity = "all" | "submissions" | "finished";

export interface LogEntry {
  timestamp: number;
  playerName: string;
  type: "submitted" | "running" | "correct" | "wrong" | "finished";
  questionNumber: number;
  detail?: string;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  totalMs: number | null;
  questionsCompleted: number;
  totalQuestions: number;
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
  logs: (data: LogEntry[]) => void;
  log: (entry: LogEntry) => void;
  leaderboard: (data: LeaderboardEntry[]) => void;
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

export type SolutionType = z.infer<typeof SolutionItem>["type"];

export const Question = z.preprocess(
  (val) => {
    if (val && typeof val === "object" && "type" in val && "data" in val) {
      const q = val as any;
      return {
        contents: q.data.contents || "",
        solutions: q.data.solutions || [],
        allowEquivalent: q.data.allowEquivalent ?? true
      };
    }
    return val;
  },
  z.object({
    contents: z.string(),
    solutions: z.array(SolutionItem),
    allowEquivalent: z.boolean()
  })
);

export type RoomState = "lobby" | "started" | "finished";

export interface Room {
  id: string;
  name: string;
  questions: z.infer<typeof Question>[];
  runToken: string;
  state: RoomState;
  runningTimeMs: number;
  logs: LogEntry[];
}

export interface ClientKnownRoom {
  id: string;
  playerCount: number;
  name: string;
  questionCount: number;
}
