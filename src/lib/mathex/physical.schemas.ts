import { z } from "zod";

export const PhysicalCompetitionName = z.string().trim().min(3).max(80);
export const PhysicalCode = z.string().regex(/^\d{6}$/);
export const PhysicalMarkerPin = z.string().regex(/^(?:[A-Z0-9]{8}|\d{4,12})$/);
export const PhysicalQuestionCount = z.number().int().min(1).max(200);
export const PhysicalCountdownDuration = z
  .number()
  .int()
  .min(1_000)
  .max(24 * 60 * 60 * 1_000)
  .nullable();
export const PhysicalTeamName = z.string().trim().min(1).max(60);
export const PhysicalTeamGroup = z.string().trim().max(60);
export const PhysicalTeamId = z.string().trim().min(1).max(128);

export const CreatePhysicalCompetitionInput = z.object({
  name: PhysicalCompetitionName,
  markerPin: PhysicalMarkerPin,
  questionCount: PhysicalQuestionCount,
  countdownDurationMs: PhysicalCountdownDuration.optional().default(null),
  teams: z
    .array(z.object({ name: PhysicalTeamName, group: PhysicalTeamGroup.optional().default("") }))
    .min(1)
    .max(200)
});

export const AddPhysicalTeamInput = z.object({
  name: PhysicalTeamName,
  group: PhysicalTeamGroup.optional().default("")
});

export const EditPhysicalTeamInput = z.object({
  id: PhysicalTeamId,
  name: PhysicalTeamName,
  group: PhysicalTeamGroup.optional().default("")
});

export const ReplacePhysicalTeamsInput = z
  .array(
    z.object({
      id: PhysicalTeamId.optional(),
      name: PhysicalTeamName,
      group: PhysicalTeamGroup.optional().default("")
    })
  )
  .min(1)
  .max(200);

export const PhysicalMarkerActionInput = z.object({
  teamId: PhysicalTeamId,
  action: z.enum(["correct", "wrong", "skip"]),
  expectedQuestion: z.number().int().min(1).max(200),
  expectedLastActionId: z.string().uuid().nullable()
});

export const PhysicalUndoInput = z.object({
  teamId: PhysicalTeamId,
  actionId: z.string().uuid()
});

export const ConfigurePhysicalCompetitionInput = z.object({
  name: PhysicalCompetitionName.optional(),
  questionCount: PhysicalQuestionCount.optional(),
  countdownDurationMs: PhysicalCountdownDuration.optional(),
  markerPin: PhysicalMarkerPin.optional()
});

export type PhysicalLifecycle = "lobby" | "running" | "paused" | "finished";
export type PhysicalMarkerActionType = "correct" | "wrong" | "skip";
export type PhysicalQuestionOutcome = "pending" | "correct" | "skipped";

export interface PhysicalAction {
  id: string;
  sequence: number;
  teamId: string;
  questionNumber: number;
  action: PhysicalMarkerActionType;
  elapsedMs: number;
  timestamp: number;
}

export interface PhysicalTeam {
  id: string;
  name: string;
  group: string;
}

export interface PhysicalCompetition {
  code: string;
  name: string;
  hostToken: string;
  markerPinHash: string;
  questionCount: number;
  countdownDurationMs: number | null;
  state: PhysicalLifecycle;
  startedAt: number | null;
  runningSince: number | null;
  elapsedBeforeRunMs: number;
  nextActionSequence: number;
  teams: Map<string, PhysicalTeam>;
  actions: PhysicalAction[];
}

export interface PhysicalQuestionSnapshot {
  questionNumber: number;
  outcome: PhysicalQuestionOutcome;
  incorrect: number;
  history: PhysicalAction[];
}

export interface PhysicalTeamSnapshot extends PhysicalTeam {
  rank: number;
  currentQuestion: number;
  correct: number;
  incorrect: number;
  skipped: number;
  correctReachedAtMs: number;
  finishTimeMs: number | null;
  lastResult: PhysicalMarkerActionType | null;
  lastActionId: string | null;
  canUndo: boolean;
  questions: PhysicalQuestionSnapshot[];
}

export interface PhysicalScoreboardSnapshot {
  code: string;
  name: string;
  state: PhysicalLifecycle;
  questionCount: number;
  countdownDurationMs: number | null;
  countdownRemainingMs: number | null;
  elapsedMs: number;
  serverNow: number;
  teams: PhysicalTeamSnapshot[];
}

export interface PhysicalHostSnapshot extends PhysicalScoreboardSnapshot {}
export interface PhysicalMarkerSnapshot extends PhysicalScoreboardSnapshot {}

export type PhysicalOperationResult = { ok: true } | { ok: false; error: string };
export type PhysicalCreateResult =
  { ok: true; code: string; hostToken: string; hostPath: string } | { ok: false; error: string };

type OperationAck = (result: PhysicalOperationResult) => void;

export interface PhysicalCreateClientToServerEvents {
  createCompetition: (input: unknown, callback?: (result: PhysicalCreateResult) => void) => void;
  checkCompetition: (code: string, callback?: (exists: boolean) => void) => void;
}

export interface PhysicalCreateServerToClientEvents {
  goto: (path: string) => void;
  error: (message: string) => void;
}

export interface PhysicalHostClientToServerEvents {
  start: (callback?: OperationAck) => void;
  pause: (callback?: OperationAck) => void;
  resume: (callback?: OperationAck) => void;
  finish: (callback?: OperationAck) => void;
  configure: (input: unknown, callback?: OperationAck) => void;
  addTeam: (input: unknown, callback?: OperationAck) => void;
  editTeam: (input: unknown, callback?: OperationAck) => void;
  removeTeam: (teamId: string, callback?: OperationAck) => void;
  updateTeams: (input: unknown, callback?: OperationAck) => void;
}

export interface PhysicalHostServerToClientEvents {
  snapshot: (snapshot: PhysicalHostSnapshot) => void;
  error: (message: string) => void;
}

export interface PhysicalMarkerClientToServerEvents {
  mark: (input: unknown, callback?: OperationAck) => void;
  undo: (input: unknown, callback?: OperationAck) => void;
}

export interface PhysicalMarkerServerToClientEvents {
  snapshot: (snapshot: PhysicalMarkerSnapshot) => void;
  error: (message: string) => void;
}

export interface PhysicalScoreboardClientToServerEvents {}
export interface PhysicalScoreboardServerToClientEvents {
  snapshot: (snapshot: PhysicalScoreboardSnapshot) => void;
}

export interface PhysicalInterServerEvents {}
export interface PhysicalSocketData {}
