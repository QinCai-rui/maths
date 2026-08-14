import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Namespace, Server, Socket } from "socket.io";

import {
  AddCollaborativeQuestionInput,
  CollaborativeHistoryEntrySchema,
  CollaborativeSetSnapshotSchema,
  CreateCollaborativeSetInput,
  DeleteCollaborativeQuestionInput,
  DraftQuestion,
  DuplicateCollaborativeQuestionInput,
  JoinCollaborativeSetInput,
  MoveCollaborativeQuestionInput,
  QuestionLockInput,
  RestoreCollaborativeDetailsInput,
  RestoreCollaborativeQuestionInput,
  UpdateCollaborativeMetadataInput,
  UpdateCollaborativePdfInput,
  UpdateCollaborativeQuestionInput,
  type CollaboratorPresence,
  type CollaborativeHistoryTarget,
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
const HISTORY_PAUSE_MS = 1_000;
const MAX_HISTORY_ENTRIES = 100;

interface PendingHistoryEntry {
  sessionToken: string;
  editorId: string;
  displayName: string;
  before: CollaborativeSetSnapshot;
  after: CollaborativeSetSnapshot;
  target: CollaborativeHistoryTarget;
  summary: string;
  timer: ReturnType<typeof setTimeout>;
}
const emptyQuestion = (): DraftQuestionValue => ({
  contents: "",
  solutions: [],
  allowEquivalent: true,
  answerComment: "",
  requireAllSolutionGroups: false,
  solutionOrderMatters: false,
  skippable: false
});

export function registerCollaborativeSetServer(io: AnyServer): void {
  const store = new CollaborativeSetStore();
  const sessions = store.load();
  const locks = new Map<string, Map<string, QuestionLock>>();
  const pendingHistory = new Map<string, PendingHistoryEntry>();
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

  function emitHistory(session: StoredCollaborativeSet): void {
    namespace.to(roomName(session.set.sessionToken)).emit("historyChanged", session.history);
  }

  function invalidateRedo(session: StoredCollaborativeSet, editorId: string): void {
    for (const entry of session.history) {
      if (entry.editorId === editorId && entry.status === "undone") entry.status = "invalidated";
    }
  }

  function appendHistory(
    session: StoredCollaborativeSet,
    editorId: string,
    displayName: string,
    before: CollaborativeSetSnapshot,
    after: CollaborativeSetSnapshot,
    target: CollaborativeHistoryTarget,
    summary: string
  ): void {
    invalidateRedo(session, editorId);
    session.history.push(
      CollaborativeHistoryEntrySchema.parse({
        id: randomUUID(),
        editorId,
        displayName,
        timestamp: Date.now(),
        summary,
        before,
        after,
        target,
        status: "applied"
      })
    );
    if (session.history.length > MAX_HISTORY_ENTRIES) {
      session.history.splice(0, session.history.length - MAX_HISTORY_ENTRIES);
    }
  }

  function finalizePending(key: string): void {
    const pending = pendingHistory.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingHistory.delete(key);
    const session = sessions.get(pending.sessionToken);
    if (!session || targetEqual(pending.before, pending.after, pending.target)) return;
    appendHistory(
      session,
      pending.editorId,
      pending.displayName,
      pending.before,
      pending.after,
      pending.target,
      pending.summary
    );
    store.save(session);
    emitHistory(session);
  }

  function finalizeSessionPending(sessionToken: string, editorId?: string): void {
    const entries = [...pendingHistory].filter(
      ([, pending]) => pending.sessionToken === sessionToken && (!editorId || pending.editorId === editorId)
    );
    entries.sort(([, left], [, right]) => left.after.updatedAt - right.after.updatedAt);
    for (const [key] of entries) {
      finalizePending(key);
    }
  }

  function queueHistory(
    socket: CollaborationSocket,
    session: StoredCollaborativeSet,
    keySuffix: string,
    before: CollaborativeSetSnapshot,
    target: CollaborativeHistoryTarget,
    summary: string
  ): void {
    const key = `${session.set.sessionToken}:${socket.data.editorId}:${keySuffix}`;
    const existing = pendingHistory.get(key);
    if (existing) clearTimeout(existing.timer);
    const pending: PendingHistoryEntry = {
      sessionToken: session.set.sessionToken,
      editorId: socket.data.editorId!,
      displayName: socket.data.displayName!,
      before: existing?.before || before,
      after: structuredClone(session.set),
      target,
      summary,
      timer: setTimeout(() => finalizePending(key), HISTORY_PAUSE_MS)
    };
    pending.timer.unref?.();
    pendingHistory.set(key, pending);
  }

  function recordImmediate(
    socket: CollaborationSocket,
    session: StoredCollaborativeSet,
    before: CollaborativeSetSnapshot,
    target: CollaborativeHistoryTarget,
    summary: string
  ): void {
    session.set.updatedAt = Date.now();
    appendHistory(
      session,
      socket.data.editorId!,
      socket.data.displayName!,
      before,
      structuredClone(session.set),
      target,
      summary
    );
    store.save(session);
    namespace.to(roomName(session.set.sessionToken)).emit("state", session.set);
    emitHistory(session);
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

  function performHistoryAction(socket: CollaborationSocket, direction: "undo" | "redo", ack: Ack): void {
    const session = activeSession(socket, ack);
    if (!session) return;
    finalizeSessionPending(session.set.sessionToken);
    const ownHistory = session.history.filter((entry) => entry.editorId === socket.data.editorId);
    const entry =
      direction === "undo"
        ? [...ownHistory].reverse().find((candidate) => candidate.status === "applied")
        : ownHistory.find((candidate) => candidate.status === "undone");
    if (!entry) return reject(ack, `Nothing to ${direction}`);
    if (entry.target.type !== "question" && !socket.data.isHost) {
      return reject(ack, `Only the host can ${direction} this operation`);
    }

    const expected = direction === "undo" ? entry.after : entry.before;
    const desired = direction === "undo" ? entry.before : entry.after;
    if (!targetEqual(session.set, expected, entry.target)) {
      return reject(ack, `Cannot ${direction}: this section has changed since that operation`);
    }
    if (entry.target.type !== "details" && lockedByOther(socket, [entry.target.questionId])) {
      return reject(ack, `Cannot ${direction}: the question is locked by another collaborator`);
    }

    applyTarget(session.set, desired, entry.target);
    session.set.updatedAt = Date.now();
    entry.status = direction === "undo" ? "undone" : "applied";
    store.save(session);
    namespace.to(roomName(session.set.sessionToken)).emit("state", session.set);
    emitHistory(session);
    accept(ack);
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
      const session: StoredCollaborativeSet = { hostToken, set, history: [] };
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
      if (previousToken && socket.data.editorId) finalizeSessionPending(previousToken, socket.data.editorId);
      releaseSocketLocks(socket);
      if (previousToken) {
        await socket.leave(roomName(previousToken));
        emitPresence(previousToken);
      }
      socket.data.sessionToken = parsed.data.sessionToken;
      socket.data.displayName = parsed.data.displayName;
      socket.data.editorId = parsed.data.editorId;
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
      finalizePending(`${session.set.sessionToken}:${socket.data.editorId}:question:${parsed.data.questionId}`);
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
      const before = structuredClone(session.set);
      const question: CollaborativeQuestionValue = { id: parsed.data.questionId, ...parsed.data.question };
      session.set.questions[index] = question;
      session.set.updatedAt = Date.now();
      lock.expiresAt = Date.now() + LOCK_TTL_MS;
      store.save(session);
      queueHistory(
        socket,
        session,
        `question:${parsed.data.questionId}`,
        before,
        { type: "question", questionId: parsed.data.questionId },
        `Edited question ${index + 1}`
      );
      socket.to(roomName(session.set.sessionToken)).emit("questionUpdated", question);
      namespace.to(roomName(session.set.sessionToken)).emit("lockChanged", lock.questionId, lock);
      accept(ack);
    });

    socket.on("updateMetadata", (rawInput, ack) => {
      const parsed = UpdateCollaborativeMetadataInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid set metadata");
      const session = hostSession(socket, ack);
      if (!session) return;
      const before = structuredClone(session.set);
      session.set.name = parsed.data.name;
      session.set.instructions = parsed.data.instructions;
      session.set.updatedAt = Date.now();
      store.save(session);
      queueHistory(socket, session, "details", before, { type: "details" }, "Edited set details");
      socket.to(roomName(session.set.sessionToken)).emit("state", session.set);
      accept(ack);
    });

    socket.on("updatePdfOptions", (rawInput, ack) => {
      const parsed = UpdateCollaborativePdfInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid PDF options");
      const session = hostSession(socket, ack);
      if (!session) return;
      const before = structuredClone(session.set);
      session.set.pdfOptions = parsed.data.pdfOptions;
      session.set.updatedAt = Date.now();
      store.save(session);
      queueHistory(socket, session, "details", before, { type: "details" }, "Edited set details");
      socket.to(roomName(session.set.sessionToken)).emit("state", session.set);
      accept(ack);
    });

    socket.on("addQuestion", (rawInput, ack) => {
      const parsed = AddCollaborativeQuestionInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question draft");
      const session = hostSession(socket, ack);
      if (!session) return;
      finalizeSessionPending(session.set.sessionToken);
      if (session.set.questions.length >= 100) return reject(ack, "A set can contain at most 100 questions");
      const insertion = insertionIndex(session.set, parsed.data.afterQuestionId);
      if (insertion < 0) return reject(ack, "Question not found");
      const question = DraftQuestion.parse(parsed.data.question || emptyQuestion());
      const before = structuredClone(session.set);
      const questionId = randomUUID();
      session.set.questions.splice(insertion, 0, { id: questionId, ...question });
      recordImmediate(
        socket,
        session,
        before,
        { type: "structure", action: "add", questionId },
        `Added question ${insertion + 1}`
      );
      accept(ack);
    });

    socket.on("duplicateQuestion", (rawInput, ack) => {
      const parsed = DuplicateCollaborativeQuestionInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question ID");
      const session = hostSession(socket, ack);
      if (!session) return;
      finalizeSessionPending(session.set.sessionToken);
      if (session.set.questions.length >= 100) return reject(ack, "A set can contain at most 100 questions");
      const source = session.set.questions[questionIndex(session.set, parsed.data.questionId)];
      if (!source) return reject(ack, "Question not found");
      if (lockedByOther(socket, [source.id])) return reject(ack, "Question is locked by another collaborator");
      const insertion = insertionIndex(
        session.set,
        parsed.data.afterQuestionId === undefined ? source.id : parsed.data.afterQuestionId
      );
      if (insertion < 0) return reject(ack, "Insertion question not found");
      const before = structuredClone(session.set);
      const questionId = randomUUID();
      session.set.questions.splice(insertion, 0, { ...structuredClone(source), id: questionId });
      recordImmediate(
        socket,
        session,
        before,
        { type: "structure", action: "duplicate", questionId },
        `Duplicated question ${questionIndex(before, source.id) + 1}`
      );
      accept(ack);
    });

    socket.on("moveQuestion", (rawInput, ack) => {
      const parsed = MoveCollaborativeQuestionInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question move");
      const session = hostSession(socket, ack);
      if (!session) return;
      finalizeSessionPending(session.set.sessionToken);
      const from = questionIndex(session.set, parsed.data.questionId);
      if (from < 0) return reject(ack, "Question not found");
      if (parsed.data.toIndex >= session.set.questions.length) return reject(ack, "Question position is out of range");
      if (lockedByOther(socket, [parsed.data.questionId]))
        return reject(ack, "Question is locked by another collaborator");
      if (from === parsed.data.toIndex) return accept(ack);
      const before = structuredClone(session.set);
      const [question] = session.set.questions.splice(from, 1);
      session.set.questions.splice(parsed.data.toIndex, 0, question);
      recordImmediate(
        socket,
        session,
        before,
        { type: "structure", action: "move", questionId: parsed.data.questionId },
        `Moved question ${from + 1} to ${parsed.data.toIndex + 1}`
      );
      accept(ack);
    });

    socket.on("deleteQuestion", (rawInput, ack) => {
      const parsed = DeleteCollaborativeQuestionInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid question ID");
      const session = hostSession(socket, ack);
      if (!session) return;
      finalizeSessionPending(session.set.sessionToken);
      const index = questionIndex(session.set, parsed.data.questionId);
      if (index < 0) return reject(ack, "Question not found");
      if (lockedByOther(socket, [parsed.data.questionId]))
        return reject(ack, "Question is locked by another collaborator");
      const before = structuredClone(session.set);
      session.set.questions.splice(index, 1);
      locks.get(session.set.sessionToken)?.delete(parsed.data.questionId);
      namespace.to(roomName(session.set.sessionToken)).emit("lockChanged", parsed.data.questionId, null);
      recordImmediate(
        socket,
        session,
        before,
        { type: "structure", action: "delete", questionId: parsed.data.questionId },
        `Deleted question ${index + 1}`
      );
      accept(ack);
    });

    socket.on("undo", (ack) => performHistoryAction(socket, "undo", ack));

    socket.on("redo", (ack) => performHistoryAction(socket, "redo", ack));

    socket.on("getHistory", (callback) => {
      const session = joinedSession(socket, undefined);
      if (!session) return callback({ ok: false, error: "Join the collaborative set first" });
      finalizeSessionPending(session.set.sessionToken);
      callback({ ok: true, history: session.history });
    });

    socket.on("restoreQuestion", (rawInput, ack) => {
      const parsed = RestoreCollaborativeQuestionInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid history entry or question ID");
      const session = hostSession(socket, ack);
      if (!session) return;
      finalizeSessionPending(session.set.sessionToken);
      const historical = session.history.find((entry) => entry.id === parsed.data.historyEntryId);
      const historicalSet = historical?.after.questions.some(({ id }) => id === parsed.data.questionId)
        ? historical.after
        : historical?.before;
      const historicalIndex = historicalSet ? questionIndex(historicalSet, parsed.data.questionId) : -1;
      if (!historical || historicalIndex < 0) return reject(ack, "Question is not present in that history entry");
      if (lockedByOther(socket, [parsed.data.questionId])) {
        return reject(ack, "Question is locked by another collaborator");
      }

      const before = structuredClone(session.set);
      const currentIndex = questionIndex(session.set, parsed.data.questionId);
      const restored = structuredClone(historicalSet!.questions[historicalIndex]);
      if (currentIndex >= 0) {
        session.set.questions[currentIndex] = restored;
        if (targetEqual(before, session.set, { type: "question", questionId: restored.id })) return accept(ack);
        recordImmediate(
          socket,
          session,
          before,
          { type: "question", questionId: restored.id },
          `Restored question ${currentIndex + 1} from history`
        );
      } else {
        if (session.set.questions.length >= 100) return reject(ack, "A set can contain at most 100 questions");
        const insertion = Math.min(historicalIndex, session.set.questions.length);
        session.set.questions.splice(insertion, 0, restored);
        recordImmediate(
          socket,
          session,
          before,
          { type: "structure", action: "restore", questionId: restored.id },
          `Restored deleted question ${historicalIndex + 1}`
        );
      }
      accept(ack);
    });

    socket.on("restoreDetails", (rawInput, ack) => {
      const parsed = RestoreCollaborativeDetailsInput.safeParse(rawInput);
      if (!parsed.success) return reject(ack, "Invalid history entry ID");
      const session = hostSession(socket, ack);
      if (!session) return;
      finalizeSessionPending(session.set.sessionToken);
      const historical = session.history.find((entry) => entry.id === parsed.data.historyEntryId);
      if (!historical) return reject(ack, "History entry not found");
      const before = structuredClone(session.set);
      session.set.name = historical.after.name;
      session.set.instructions = historical.after.instructions;
      session.set.pdfOptions = structuredClone(historical.after.pdfOptions);
      if (targetEqual(before, session.set, { type: "details" })) return accept(ack);
      recordImmediate(socket, session, before, { type: "details" }, "Restored set details from history");
      accept(ack);
    });

    socket.on("endSession", (ack) => {
      const session = hostSession(socket, ack);
      if (!session) return;
      finalizeSessionPending(session.set.sessionToken);
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
      finalizeSessionPending(session.set.sessionToken);
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
      if (token && socket.data.editorId) finalizeSessionPending(token, socket.data.editorId);
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

function targetEqual(
  current: CollaborativeSetSnapshot,
  expected: CollaborativeSetSnapshot,
  target: CollaborativeHistoryTarget
): boolean {
  if (target.type === "details") {
    return sameJson(
      { name: current.name, instructions: current.instructions, pdfOptions: current.pdfOptions },
      { name: expected.name, instructions: expected.instructions, pdfOptions: expected.pdfOptions }
    );
  }
  if (target.type === "question") {
    return sameJson(
      current.questions.find(({ id }) => id === target.questionId),
      expected.questions.find(({ id }) => id === target.questionId)
    );
  }
  if (
    !sameJson(
      current.questions.map(({ id }) => id),
      expected.questions.map(({ id }) => id)
    )
  )
    return false;
  if (target.action === "move") return true;
  return sameJson(
    current.questions.find(({ id }) => id === target.questionId),
    expected.questions.find(({ id }) => id === target.questionId)
  );
}

function applyTarget(
  current: CollaborativeSetSnapshot,
  desired: CollaborativeSetSnapshot,
  target: CollaborativeHistoryTarget
): void {
  if (target.type === "details") {
    current.name = desired.name;
    current.instructions = desired.instructions;
    current.pdfOptions = structuredClone(desired.pdfOptions);
    return;
  }
  if (target.type === "question") {
    const currentIndex = current.questions.findIndex(({ id }) => id === target.questionId);
    const desiredQuestion = desired.questions.find(({ id }) => id === target.questionId);
    if (currentIndex >= 0 && desiredQuestion) current.questions[currentIndex] = structuredClone(desiredQuestion);
    return;
  }

  const currentQuestions = new Map(current.questions.map((question) => [question.id, question]));
  current.questions = desired.questions.map(
    (question) => currentQuestions.get(question.id) || structuredClone(question)
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function safeTokenEqual(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
