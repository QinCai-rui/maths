import { z } from "zod";

export const CollaborativeSetToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const CollaboratorName = z.string().trim().min(1).max(20);
export const CollaborativeQuestionId = z.string().uuid();

export const DraftSolution = z.discriminatedUnion("type", [
  z.object({ type: z.literal("number"), value: z.union([z.number(), z.literal("")]) }),
  z.object({ type: z.literal("text"), value: z.string() }),
  z.object({ type: z.literal("expression"), value: z.string() })
]);

export const DraftQuestion = z.object({
  contents: z.string(),
  solutions: z.array(DraftSolution),
  allowEquivalent: z.boolean(),
  answerComment: z.string().max(2000).default("")
});

export const CollaborativeQuestion = DraftQuestion.extend({ id: CollaborativeQuestionId });

export const DraftPdfOptions = z.object({
  questionTextSize: z.number().min(6).max(18),
  answerTextSize: z.number().min(6).max(16),
  imageHeight: z.number().min(5).max(35),
  slipHeight: z.number().min(1),
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

export const CreateCollaborativeSetInput = z.object({ set: CollaborativeSetDraft });
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

export type DraftQuestionValue = z.infer<typeof DraftQuestion>;
export type CollaborativeQuestionValue = z.infer<typeof CollaborativeQuestion>;
export type CollaborativeSetSnapshot = z.infer<typeof CollaborativeSetSnapshotSchema>;

export const CollaboratorPresenceSchema = z.object({
  connectionId: z.string().min(1),
  displayName: CollaboratorName,
  isHost: z.boolean()
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

export type CollaborativeOperationResult = { ok: true } | { ok: false; error: string };
export type CollaborativeCreateResult =
  { ok: true; sessionToken: string; hostToken: string; state: CollaborativeSetSnapshot } | { ok: false; error: string };
export type CollaborativeJoinResult = { ok: true; state: CollaborativeSetJoinState } | { ok: false; error: string };

type OperationAck = (result: CollaborativeOperationResult) => void;

export interface CollaborativeSetClientToServerEvents {
  createSession: (input: unknown, callback: (result: CollaborativeCreateResult) => void) => void;
  joinSession: (input: unknown, callback: (result: CollaborativeJoinResult) => void) => void;
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
  endSession: (callback?: OperationAck) => void;
  deleteSession: (callback?: OperationAck) => void;
}

export interface CollaborativeSetServerToClientEvents {
  state: (state: CollaborativeSetSnapshot) => void;
  questionUpdated: (question: CollaborativeQuestionValue) => void;
  lockChanged: (questionId: string, lock: QuestionLock | null) => void;
  presence: (collaborators: CollaboratorPresence[]) => void;
  sessionDeleted: () => void;
}

export interface CollaborativeSetInterServerEvents {}
export interface CollaborativeSetSocketData {
  sessionToken?: string;
  displayName?: string;
  isHost?: boolean;
}
