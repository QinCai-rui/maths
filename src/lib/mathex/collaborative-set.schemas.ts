import { z } from "zod";

export const CollaborativeSetToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const CollaboratorName = z.string().trim().min(1).max(20);
export const CollaborativeQuestionId = z.string().uuid();

export const DraftSolution = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("number"),
    value: z.union([z.number(), z.literal("")]),
    group: z.number().int().min(0).max(99).default(0)
  }),
  z.object({ type: z.literal("text"), value: z.string(), group: z.number().int().min(0).max(99).default(0) }),
  z.object({ type: z.literal("expression"), value: z.string(), group: z.number().int().min(0).max(99).default(0) })
]);

export const DraftQuestion = z.object({
  contents: z.string(),
  solutions: z.array(DraftSolution),
  allowEquivalent: z.boolean(),
  answerComment: z.string().max(2000).default(""),
  requireAllSolutionGroups: z.boolean().default(false),
  solutionOrderMatters: z.boolean().default(false),
  skippable: z.boolean().default(true)
});

export const CollaborativeQuestion = DraftQuestion.extend({ id: CollaborativeQuestionId });

export const DraftPdfOptions = z.object({
  questionTextSize: z.number().min(6).max(18),
  answerTextSize: z.number().min(6).max(16),
  imageHeight: z.number().min(5).max(35),
  slipHeight: z.number().min(1).max(297),
  cutMargin: z.number().min(0).max(80)
});

export const CollaborativeSetDraft = z.object({
  name: z.string().max(120),
  instructions: z.string(),
  questions: z.array(DraftQuestion).max(100),
  pdfOptions: DraftPdfOptions
});

export const CollaborativeSetSnapshotSchema = CollaborativeSetDraft.omit({ questions: true }).extend({
  sessionToken: CollaborativeSetToken,
  status: z.enum(["active", "ended"]),
  questions: z.array(CollaborativeQuestion).max(100),
  updatedAt: z.number().int()
});

/** Lets the owner win back host access from any browser. Stored only as a salted hash. */
export const OwnerPin = z.string().regex(/^\d{6,12}$/, "The owner PIN must be 6 to 12 digits");
export const CreateCollaborativeSetInput = z.object({ set: CollaborativeSetDraft, ownerPin: OwnerPin });
export const OwnerPinInput = z.object({ pin: OwnerPin });
export const JoinCollaborativeSetInput = z.object({
  sessionToken: CollaborativeSetToken,
  hostToken: CollaborativeSetToken.optional(),
  displayName: CollaboratorName
});
export const QuestionLockInput = z.object({ questionId: CollaborativeQuestionId });
export const UpdateCollaborativeQuestionInput = z.object({
  questionId: CollaborativeQuestionId,
  question: DraftQuestion
});
export const UpdateCollaborativeMetadataInput = CollaborativeSetDraft.pick({ name: true, instructions: true });
export const UpdateCollaborativePdfInput = z.object({ pdfOptions: DraftPdfOptions });
export const AddCollaborativeQuestionInput = z.object({
  afterQuestionId: CollaborativeQuestionId.nullable().optional(),
  question: DraftQuestion.optional()
});
export const DuplicateCollaborativeQuestionInput = z.object({
  questionId: CollaborativeQuestionId,
  afterQuestionId: CollaborativeQuestionId.nullable().optional()
});
export const MoveCollaborativeQuestionInput = z.object({
  questionId: CollaborativeQuestionId,
  toIndex: z.number().int().min(0).max(99)
});
export const DeleteCollaborativeQuestionInput = QuestionLockInput;
export const ApplyClientHistoryTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("question"), questionId: CollaborativeQuestionId }),
  z.object({ type: z.literal("details") }),
  z.object({
    type: z.literal("structure"),
    action: z.enum(["add", "duplicate", "move", "delete"]),
    questionId: CollaborativeQuestionId
  })
]);
export const ApplyClientHistoryInput = z.object({
  target: ApplyClientHistoryTargetSchema,
  expected: CollaborativeSetSnapshotSchema,
  desired: CollaborativeSetSnapshotSchema
});

export type DraftQuestionValue = z.infer<typeof DraftQuestion>;
export type CollaborativeQuestionValue = z.infer<typeof CollaborativeQuestion>;
export type CollaborativeSetSnapshot = z.infer<typeof CollaborativeSetSnapshotSchema>;
export type ApplyClientHistoryTarget = z.infer<typeof ApplyClientHistoryTargetSchema>;

export const CollaboratorPresenceSchema = z.object({
  connectionId: z.string().min(1),
  displayName: z.string(),
  isHost: z.boolean(),
  /** Set for agents using the HTTP API. They stay listed for a short while after their last request. */
  isAgent: z.boolean().optional()
});
export const QuestionLockSchema = z.object({
  questionId: CollaborativeQuestionId,
  connectionId: z.string().min(1),
  displayName: CollaboratorName,
  expiresAt: z.number().int()
});
export const CollaborativeSetJoinStateSchema = z.object({
  set: CollaborativeSetSnapshotSchema,
  collaborators: z.array(CollaboratorPresenceSchema),
  locks: z.array(QuestionLockSchema)
});

export type CollaboratorPresence = z.infer<typeof CollaboratorPresenceSchema>;
export type QuestionLock = z.infer<typeof QuestionLockSchema>;
export type CollaborativeSetJoinState = z.infer<typeof CollaborativeSetJoinStateSchema>;

export const AgentTokenLevel = z.enum(["editor", "host"]);
export const AgentMinterKey = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const CreateAgentTokenInput = z.object({
  label: z.string().trim().min(1).max(32),
  level: AgentTokenLevel,
  expiresInMs: z
    .number()
    .int()
    .min(15 * 60_000)
    .max(24 * 60 * 60_000),
  minterKey: AgentMinterKey
});
export const ListAgentTokensInput = z.object({ minterKey: AgentMinterKey });
export const RevokeAgentTokenInput = z.object({ id: z.string().uuid(), minterKey: AgentMinterKey });
export interface AgentTokenInfo {
  id: string;
  label: string;
  level: z.infer<typeof AgentTokenLevel>;
  createdAt: number;
  expiresAt: number;
  mine: boolean;
}
export type CreateAgentTokenResult = { ok: true; token: string; info: AgentTokenInfo } | { ok: false; error: string };
export type ListAgentTokensResult = { ok: true; tokens: AgentTokenInfo[] } | { ok: false; error: string };

export type CollaborativeOperationResult = { ok: true } | { ok: false; error: string };
export type CollaborativeQuestionResult =
  { ok: true; question: CollaborativeQuestionValue } | { ok: false; error: string };
export type CollaborativeQuestionsResult =
  { ok: true; questions: CollaborativeQuestionValue[] } | { ok: false; error: string };
export type CollaborativeCreateResult =
  { ok: true; sessionToken: string; hostToken: string; state: CollaborativeSetSnapshot } | { ok: false; error: string };
export type CollaborativeJoinResult =
  { ok: true; state: CollaborativeSetJoinState; hasOwnerPin: boolean } | { ok: false; error: string };
export type ClaimHostResult = { ok: true; hostToken: string } | { ok: false; error: string };
type OperationAck = (result: CollaborativeOperationResult) => void;

export interface CollaborativeSetClientToServerEvents {
  createSession: (input: unknown, callback: (result: CollaborativeCreateResult) => void) => void;
  joinSession: (input: unknown, callback: (result: CollaborativeJoinResult) => void) => void;
  getQuestion: (input: unknown, callback: (result: CollaborativeQuestionResult) => void) => void;
  /** Loads every question in one round trip, for exports and structural edits. */
  getQuestions: (callback: (result: CollaborativeQuestionsResult) => void) => void;
  acquireLock: (input: unknown, callback?: OperationAck) => void;
  refreshLock: (input: unknown, callback?: OperationAck) => void;
  releaseLock: (input: unknown, callback?: OperationAck) => void;
  updateQuestion: (input: unknown, callback?: OperationAck) => void;
  updateMetadata: (input: unknown, callback?: OperationAck) => void;
  updatePdfOptions: (input: unknown, callback?: OperationAck) => void;
  addQuestion: (input: unknown, callback?: OperationAck) => void;
  duplicateQuestion: (input: unknown, callback?: OperationAck) => void;
  moveQuestion: (input: unknown, callback?: OperationAck) => void;
  deleteQuestion: (input: unknown, callback?: OperationAck) => void;
  applyClientHistory: (input: unknown, callback?: OperationAck) => void;
  endSession: (callback?: OperationAck) => void;
  deleteSession: (callback?: OperationAck) => void;
  createAgentToken: (input: unknown, callback: (result: CreateAgentTokenResult) => void) => void;
  listAgentTokens: (input: unknown, callback: (result: ListAgentTokensResult) => void) => void;
  revokeAgentToken: (input: unknown, callback?: OperationAck) => void;
  /** Host only: set or replace the owner PIN. */
  setOwnerPin: (input: unknown, callback?: OperationAck) => void;
  /** Swap a correct owner PIN for a new host secret. Every other host loses host access. */
  claimHost: (input: unknown, callback: (result: ClaimHostResult) => void) => void;
}

export interface CollaborativeSetServerToClientEvents {
  state: (state: CollaborativeSetSnapshot) => void;
  questionUpdated: (question: CollaborativeQuestionValue) => void;
  lockChanged: (questionId: string, lock: QuestionLock | null) => void;
  presence: (collaborators: CollaboratorPresence[]) => void;
  sessionDeleted: () => void;
  /** Sent to a host whose access was taken over with the owner PIN. */
  hostRevoked: () => void;
}

export interface CollaborativeSetInterServerEvents {}
export interface CollaborativeSetSocketData {
  sessionToken?: string;
  displayName?: string;
  isHost?: boolean;
}
