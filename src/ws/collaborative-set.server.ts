import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Namespace, Server, Socket } from "socket.io";

import {
  AddCollaborativeQuestionInput,
  CollaborativeSetSnapshotSchema,
  CreateCollaborativeSetInput,
  DeleteCollaborativeQuestionInput,
  DraftQuestion,
  DuplicateCollaborativeQuestionInput,
  JoinCollaborativeSetInput,
  MoveCollaborativeQuestionInput,
  QuestionLockInput,
  UpdateCollaborativeMetadataInput,
  UpdateCollaborativePdfInput,
  UpdateCollaborativeQuestionInput,
  type CollaboratorPresence,
  type CollaborativeOperationResult,
  type CollaborativeQuestionValue,
  type CollaborativeSetClientToServerEvents,
  type CollaborativeSetInterServerEvents,
  type CollaborativeSetServerToClientEvents,
  type CollaborativeSetSnapshot,
  type CollaborativeSetSocketData,
  type DraftQuestionValue,
  type QuestionLock
} from "../lib/mathex/collaborative-set.schemas";
import { CollaborativeSetStore, type StoredCollaborativeSet } from "../lib/mathex/collaborative-set.server";

type AnyServer = Server<any, any, any, any>;
type CollaborationNamespace = Namespace<
  CollaborativeSetClientToServerEvents,
  CollaborativeSetServerToClientEvents,
  CollaborativeSetInterServerEvents,
  CollaborativeSetSocketData
>;
type CollaborationSocket = Socket<
  CollaborativeSetClientToServerEvents,
  CollaborativeSetServerToClientEvents,
  CollaborativeSetInterServerEvents,
  CollaborativeSetSocketData
>;
type Ack = ((result: CollaborativeOperationResult) => void) | undefined;

const NAMESPACE = "/set-collaboration";
const LOCK_TTL_MS = 30_000;
const emptyQuestion = (): DraftQuestionValue => ({
  contents: "",
  solutions: [],
  allowEquivalent: true,
  answerComment: ""
});

export function registerCollaborativeSetServer(io: AnyServer): void {
  const store = new CollaborativeSetStore();
  const sessions = store.load();
  const locks = new Map<string, Map<string, QuestionLock>>();
  const namespace: CollaborationNamespace = io.of(NAMESPACE);

  const roomName = (token: string) => `set:${token}`;
  const reject = (ack: Ack, error: string): void => ack?.({ ok: false, error });
  const accept = (ack: Ack): void => ack?.({ ok: true });
  const errorFor = (error: { issues: { message: string }[] }, fallback: string) => error.issues[0]?.message || fallback;

  function currentLocks(token: string): QuestionLock[] {
    expireLocks(token);
    return [...(locks.get(token)?.values() || [])];
  }

  function presence(token: string): CollaboratorPresence[] {
    return [...namespace.sockets.values()]
      .filter((candidate) => candidate.data.sessionToken === token)
      .map((candidate) => ({
        connectionId: candidate.id,
        displayName: candidate.data.displayName!,
        isHost: candidate.data.isHost === true
      }));
  }

  function emitPresence(token: string): void {
    namespace.to(roomName(token)).emit("presence", presence(token));
  }

  function expireLocks(token: string, now = Date.now()): void {
    const sessionLocks = locks.get(token);
    if (!sessionLocks) return;
    for (const [questionId, lock] of sessionLocks) {
      if (lock.expiresAt > now) continue;
      sessionLocks.delete(questionId);
      namespace.to(roomName(token)).emit("lockChanged", questionId, null);
    }
    if (sessionLocks.size === 0) locks.delete(token);
  }

  function releaseSocketLocks(socket: CollaborationSocket): void {
    const token = socket.data.sessionToken;
    if (!token) return;
    const sessionLocks = locks.get(token);
    if (!sessionLocks) return;
    for (const [questionId, lock] of sessionLocks) {
      if (lock.connectionId !== socket.id) continue;
      sessionLocks.delete(questionId);
      namespace.to(roomName(token)).emit("lockChanged", questionId, null);
    }
    if (sessionLocks.size === 0) locks.delete(token);
  }

  function joinedSession(socket: CollaborationSocket, ack: Ack): StoredCollaborativeSet | null {
    const token = socket.data.sessionToken;
    const session = token ? sessions.get(token) : undefined;
    if (!session) reject(ack, "Join the collaborative set first");
    return session || null;
  }

  function activeSession(socket: CollaborationSocket, ack: Ack): StoredCollaborativeSet | null {
    const session = joinedSession(socket, ack);
    if (session && session.set.status !== "active") {
      reject(ack, "This collaborative session has ended");
      return null;
    }
    return session;
  }

  function hostSession(socket: CollaborationSocket, ack: Ack): StoredCollaborativeSet | null {
    const session = activeSession(socket, ack);
    if (session && !socket.data.isHost) {
      reject(ack, "Only the host can perform this operation");
      return null;
    }
    return session;
  }

  function joinedHostSession(socket: CollaborationSocket, ack: Ack): StoredCollaborativeSet | null {
    const session = joinedSession(socket, ack);
    if (session && !socket.data.isHost) {
      reject(ack, "Only the host can perform this operation");
      return null;
    }
    return session;
  }

  function saveAndEmit(session: StoredCollaborativeSet): void {
    session.set.updatedAt = Date.now();
    store.save(session);
    namespace.to(roomName(session.set.sessionToken)).emit("state", session.set);
  }

  function questionIndex(set: CollaborativeSetSnapshot, questionId: string): number {
    return set.questions.findIndex((question) => question.id === questionId);
  }

  function lockedByOther(socket: CollaborationSocket, questionIds: string[]): boolean {
    const token = socket.data.sessionToken!;
    expireLocks(token);
    const sessionLocks = locks.get(token);
    return questionIds.some((id) => {
      const lock = sessionLocks?.get(id);
      return lock && lock.connectionId !== socket.id;
    });
  }

  const lockTimer = setInterval(() => {
    for (const token of locks.keys()) expireLocks(token);
  }, 5_000);
  lockTimer.unref?.();

  namespace.on("connection", (socket) => {
    socket.on("createSession", (rawInput, callback) => {
      const parsed = CreateCollaborativeSetInput.safeParse(rawInput);
      if (!parsed.success) return callback({ ok: false, error: errorFor(parsed.error, "Invalid set draft") });

      let sessionToken: string;
      do sessionToken = randomBytes(32).toString("base64url");
      while (sessions.has(sessionToken));
      const hostToken = randomBytes(32).toString("base64url");
      const set = CollaborativeSetSnapshotSchema.parse({
        ...parsed.data.set,
        sessionToken,
        status: "active",
        questions: parsed.data.set.questions.map((question) => ({ id: randomUUID(), ...question })),
        updatedAt: Date.now()
      });
      const session = { hostToken, set };
      sessions.set(sessionToken, session);
      store.save(session);
      callback({ ok: true, sessionToken, hostToken, state: set });
    });

    socket.on("joinSession", async (rawInput, callback) => {
      const parsed = JoinCollaborativeSetInput.safeParse(rawInput);
      if (!parsed.success) return callback({ ok: false, error: errorFor(parsed.error, "Invalid join details") });
      const session = sessions.get(parsed.data.sessionToken);
      if (!session) return callback({ ok: false, error: "Collaborative set not found" });

      const previousToken = socket.data.sessionToken;
      releaseSocketLocks(socket);
      if (previousToken) {
        await socket.leave(roomName(previousToken));
        emitPresence(previousToken);
      }
      socket.data.sessionToken = parsed.data.sessionToken;
      socket.data.displayName = parsed.data.displayName;
      socket.data.isHost = safeTokenEqual(parsed.data.hostToken, session.hostToken);
      await socket.join(roomName(parsed.data.sessionToken));
      callback({
        ok: true,
        state: {
          set: session.set,
          collaborators: presence(parsed.data.sessionToken),
          locks: currentLocks(parsed.data.sessionToken)
        }
      });
      emitPresence(parsed.data.sessionToken);
    });

    socket.on("acquireLock", (rawInput, ack) => {
      const parsed = QuestionLockInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question ID");
      const session = activeSession(socket, ack);
      if (!session) return;
      if (questionIndex(session.set, parsed.data.questionId) < 0) return reject(ack, "Question not found");
      const token = session.set.sessionToken;
      expireLocks(token);
      const sessionLocks = locks.get(token) || new Map<string, QuestionLock>();
      const current = sessionLocks.get(parsed.data.questionId);
      if (current && current.connectionId !== socket.id)
        return reject(ack, `Question is locked by ${current.displayName}`);
      const lock = {
        questionId: parsed.data.questionId,
        connectionId: socket.id,
        displayName: socket.data.displayName!,
        expiresAt: Date.now() + LOCK_TTL_MS
      };
      sessionLocks.set(lock.questionId, lock);
      locks.set(token, sessionLocks);
      namespace.to(roomName(token)).emit("lockChanged", lock.questionId, lock);
      accept(ack);
    });

    socket.on("refreshLock", (rawInput, ack) => {
      const parsed = QuestionLockInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question ID");
      const session = activeSession(socket, ack);
      if (!session) return;
      expireLocks(session.set.sessionToken);
      const lock = locks.get(session.set.sessionToken)?.get(parsed.data.questionId);
      if (!lock || lock.connectionId !== socket.id) return reject(ack, "You do not hold this question lock");
      lock.expiresAt = Date.now() + LOCK_TTL_MS;
      namespace.to(roomName(session.set.sessionToken)).emit("lockChanged", lock.questionId, lock);
      accept(ack);
    });

    socket.on("releaseLock", (rawInput, ack) => {
      const parsed = QuestionLockInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question ID");
      const session = joinedSession(socket, ack);
      if (!session) return;
      const sessionLocks = locks.get(session.set.sessionToken);
      const lock = sessionLocks?.get(parsed.data.questionId);
      if (!lock || lock.connectionId !== socket.id) return reject(ack, "You do not hold this question lock");
      sessionLocks!.delete(lock.questionId);
      if (sessionLocks!.size === 0) locks.delete(session.set.sessionToken);
      namespace.to(roomName(session.set.sessionToken)).emit("lockChanged", lock.questionId, null);
      accept(ack);
    });

    socket.on("updateQuestion", (rawInput, ack) => {
      const parsed = UpdateCollaborativeQuestionInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question draft");
      const session = activeSession(socket, ack);
      if (!session) return;
      const index = questionIndex(session.set, parsed.data.questionId);
      if (index < 0) return reject(ack, "Question not found");
      expireLocks(session.set.sessionToken);
      const lock = locks.get(session.set.sessionToken)?.get(parsed.data.questionId);
      if (!lock || lock.connectionId !== socket.id) return reject(ack, "Acquire this question lock before updating it");
      const question: CollaborativeQuestionValue = { id: parsed.data.questionId, ...parsed.data.question };
      session.set.questions[index] = question;
      session.set.updatedAt = Date.now();
      lock.expiresAt = Date.now() + LOCK_TTL_MS;
      store.save(session);
      namespace.to(roomName(session.set.sessionToken)).emit("questionUpdated", question);
      namespace.to(roomName(session.set.sessionToken)).emit("lockChanged", lock.questionId, lock);
      accept(ack);
    });

    socket.on("updateMetadata", (rawInput, ack) => {
      const parsed = UpdateCollaborativeMetadataInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid set metadata");
      const session = hostSession(socket, ack);
      if (!session) return;
      session.set.name = parsed.data.name;
      session.set.instructions = parsed.data.instructions;
      saveAndEmit(session);
      accept(ack);
    });

    socket.on("updatePdfOptions", (rawInput, ack) => {
      const parsed = UpdateCollaborativePdfInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid PDF options");
      const session = hostSession(socket, ack);
      if (!session) return;
      session.set.pdfOptions = parsed.data.pdfOptions;
      saveAndEmit(session);
      accept(ack);
    });

    socket.on("addQuestion", (rawInput, ack) => {
      const parsed = AddCollaborativeQuestionInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question draft");
      const session = hostSession(socket, ack);
      if (!session) return;
      if (session.set.questions.length >= 100) return reject(ack, "A set can contain at most 100 questions");
      const insertion = insertionIndex(session.set, parsed.data.afterQuestionId);
      if (insertion < 0) return reject(ack, "Question not found");
      const question = DraftQuestion.parse(parsed.data.question || emptyQuestion());
      session.set.questions.splice(insertion, 0, { id: randomUUID(), ...question });
      saveAndEmit(session);
      accept(ack);
    });

    socket.on("duplicateQuestion", (rawInput, ack) => {
      const parsed = DuplicateCollaborativeQuestionInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question ID");
      const session = hostSession(socket, ack);
      if (!session) return;
      if (session.set.questions.length >= 100) return reject(ack, "A set can contain at most 100 questions");
      const source = session.set.questions[questionIndex(session.set, parsed.data.questionId)];
      if (!source) return reject(ack, "Question not found");
      if (lockedByOther(socket, [source.id])) return reject(ack, "Question is locked by another collaborator");
      const insertion = insertionIndex(
        session.set,
        parsed.data.afterQuestionId === undefined ? source.id : parsed.data.afterQuestionId
      );
      if (insertion < 0) return reject(ack, "Insertion question not found");
      session.set.questions.splice(insertion, 0, { ...structuredClone(source), id: randomUUID() });
      saveAndEmit(session);
      accept(ack);
    });

    socket.on("moveQuestion", (rawInput, ack) => {
      const parsed = MoveCollaborativeQuestionInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question move");
      const session = hostSession(socket, ack);
      if (!session) return;
      const from = questionIndex(session.set, parsed.data.questionId);
      if (from < 0) return reject(ack, "Question not found");
      if (parsed.data.toIndex >= session.set.questions.length) return reject(ack, "Question position is out of range");
      if (lockedByOther(socket, [parsed.data.questionId]))
        return reject(ack, "Question is locked by another collaborator");
      const [question] = session.set.questions.splice(from, 1);
      session.set.questions.splice(parsed.data.toIndex, 0, question);
      saveAndEmit(session);
      accept(ack);
    });

    socket.on("deleteQuestion", (rawInput, ack) => {
      const parsed = DeleteCollaborativeQuestionInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question ID");
      const session = hostSession(socket, ack);
      if (!session) return;
      const index = questionIndex(session.set, parsed.data.questionId);
      if (index < 0) return reject(ack, "Question not found");
      if (lockedByOther(socket, [parsed.data.questionId]))
        return reject(ack, "Question is locked by another collaborator");
      session.set.questions.splice(index, 1);
      locks.get(session.set.sessionToken)?.delete(parsed.data.questionId);
      namespace.to(roomName(session.set.sessionToken)).emit("lockChanged", parsed.data.questionId, null);
      saveAndEmit(session);
      accept(ack);
    });

    socket.on("endSession", (ack) => {
      const session = hostSession(socket, ack);
      if (!session) return;
      if (
        lockedByOther(
          socket,
          session.set.questions.map(({ id }) => id)
        )
      ) {
        return reject(ack, "A question is locked by another collaborator");
      }
      session.set.status = "ended";
      const sessionLocks = locks.get(session.set.sessionToken);
      locks.delete(session.set.sessionToken);
      for (const questionId of sessionLocks?.keys() || []) {
        namespace.to(roomName(session.set.sessionToken)).emit("lockChanged", questionId, null);
      }
      saveAndEmit(session);
      accept(ack);
    });

    socket.on("deleteSession", (ack) => {
      const session = joinedHostSession(socket, ack);
      if (!session) return;
      if (
        lockedByOther(
          socket,
          session.set.questions.map(({ id }) => id)
        )
      ) {
        return reject(ack, "A question is locked by another collaborator");
      }
      const token = session.set.sessionToken;
      sessions.delete(token);
      locks.delete(token);
      store.delete(token);
      namespace.to(roomName(token)).emit("sessionDeleted");
      accept(ack);
      for (const candidate of namespace.sockets.values()) {
        if (candidate.data.sessionToken === token) candidate.disconnect(true);
      }
    });

    socket.on("disconnect", () => {
      const token = socket.data.sessionToken;
      releaseSocketLocks(socket);
      if (token) emitPresence(token);
    });
  });
}

function insertionIndex(set: CollaborativeSetSnapshot, afterQuestionId?: string | null): number {
  if (afterQuestionId === null) return 0;
  if (afterQuestionId === undefined) return set.questions.length;
  const index = set.questions.findIndex(({ id }) => id === afterQuestionId);
  return index < 0 ? -1 : index + 1;
}

function safeTokenEqual(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
