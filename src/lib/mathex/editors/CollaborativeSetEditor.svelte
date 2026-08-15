<script lang="ts">
  import { goto, pushState } from "$app/navigation";
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import Quill from "$lib/components/Quill.svelte";
  import { Header } from "$lib/components/ui/header";
  import { copyText } from "$lib/utils";
  import { QuestionSet } from "$lib/mathex/schemas";
  import { stripTags } from "$lib/mathex/content";
  import { downloadAnswerSet, downloadQuestionSet, previewAnswerSet, previewQuestionSet } from "$lib/mathex/print";
  import type {
    CollaborativeQuestionValue,
    CollaborativeSetClientToServerEvents,
    CollaborativeSetServerToClientEvents,
    CollaborativeSetSnapshot,
    ApplyClientHistoryTarget,
    CollaboratorPresence,
    DraftQuestionValue,
    QuestionLock
  } from "$lib/mathex/collaborative-set.schemas";
  import {
    ArrowDown,
    ArrowLeft,
    ArrowUp,
    Check,
    ChevronDown,
    CircleUserRound,
    Copy,
    Download,
    FileJson,
    FileText,
    Link2,
    LockKeyhole,
    Menu,
    MoreHorizontal,
    Plus,
    Radio,
    Settings2,
    Trash2,
    Upload,
    UsersRound,
    Wifi,
    WifiOff,
    Undo2,
    Redo2,
    X
  } from "@lucide/svelte/icons";
  import { io, type Socket } from "socket.io-client";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import QuestionEditor from "./QuestionEditor.svelte";

  interface Props {
    sessionToken?: string;
  }

  const DRAFT_KEY = "mathex-draft";
  const ROOM_SET_KEY = "mathex-room-set";
  const emptyQuestion = (): DraftQuestionValue => ({
    contents: "",
    solutions: [],
    allowEquivalent: true,
    answerComment: "",
    requireAllSolutionGroups: false,
    solutionOrderMatters: false,
    skippable: true
  });
  const defaultPdfOptions = () => ({
    questionTextSize: 11,
    answerTextSize: 11,
    imageHeight: 30,
    slipHeight: 49.5,
    cutMargin: 50
  });

  let { sessionToken }: Props = $props();
  let socket = $state.raw<Socket<CollaborativeSetServerToClientEvents, CollaborativeSetClientToServerEvents> | null>(
    null
  );
  let questions = $state<CollaborativeQuestionValue[]>([]);
  let setName = $state("");
  let instructions = $state("");
  let pdfOptions = $state(defaultPdfOptions());
  let currentQuestionId = $state<string | null>(null);
  let currentQuestion = $derived(questions.find(({ id }) => id === currentQuestionId) || null);
  let currentQuestionIndex = $derived(questions.findIndex(({ id }) => id === currentQuestionId));
  let loadedQuestionIds = $state<Record<string, boolean>>({});
  let currentQuestionLoaded = $derived(!!currentQuestion && (!sessionToken || loadedQuestionIds[currentQuestion.id]));
  let collaborators = $state<CollaboratorPresence[]>([]);
  let locks = $state<QuestionLock[]>([]);
  let ownedLocks = $state<Record<string, boolean>>({});
  let acquiringQuestionId = $state<string | null>(null);
  let joined = $state(false);
  let joining = $state(false);
  let connected = $state(false);
  let hostSession = $state(false);
  let deleted = $state(false);
  let sessionStatus = $state<"active" | "ended">("active");
  let displayName = $state("");
  let ready = $state(false);
  let localSaved = $state(true);
  let goLiveOpen = $state(false);
  let goLiveName = $state("");
  let creating = $state(false);
  let detailsOpen = $state(false);
  let exportOpen = $state(false);
  let mobileOutlineOpen = $state(false);
  let lastServerSettings = "";
  const lastQuestionSent = new Map<string, string>();
  const questionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const questionLoads = new Map<string, Promise<boolean>>();
  let settingsTimer: ReturnType<typeof setTimeout> | null = null;
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  let lockHeartbeat: ReturnType<typeof setInterval> | null = null;
  let activeQuestionCard = $state.raw<HTMLElement | null>(null);
  let closingSocket = false;
  let pendingDeleteQuestion = $state<CollaborativeQuestionValue | null>(null);
  let undoHistory = $state<
    {
      before: CollaborativeSetSnapshot;
      after: CollaborativeSetSnapshot;
      target: ApplyClientHistoryTarget;
      summary: string;
      status: "applied" | "undone";
    }[]
  >([]);
  let historyTimer: ReturnType<typeof setTimeout> | null = null;
  let localBaseline: CollaborativeSetSnapshot | null = null;
  let liveHistoryBaseline: CollaborativeSetSnapshot | null = null;
  let liveTransaction: {
    before: CollaborativeSetSnapshot;
    target: ApplyClientHistoryTarget;
    summary: string;
  } | null = null;
  let applyingLocalHistory = false;

  let isHost = $derived(hostSession);
  let canUndo = $derived(undoHistory.some((entry) => entry.status === "applied"));
  let canRedo = $derived(undoHistory.some((entry) => entry.status === "undone"));
  let sessionUrl = $derived(
    sessionToken && typeof window !== "undefined"
      ? `${window.location.origin}/mathex/app/create/editor/${sessionToken}`
      : ""
  );

  function withId(question: DraftQuestionValue): CollaborativeQuestionValue {
    return { id: crypto.randomUUID(), ...question };
  }

  function plainQuestion(question: CollaborativeQuestionValue): DraftQuestionValue {
    return {
      contents: question.contents,
      solutions: question.solutions,
      allowEquivalent: question.allowEquivalent,
      answerComment: question.answerComment,
      requireAllSolutionGroups: question.requireAllSolutionGroups,
      solutionOrderMatters: question.solutionOrderMatters,
      skippable: question.skippable
    };
  }

  function plainSet() {
    return { name: setName, instructions, questions: questions.map(plainQuestion), pdfOptions };
  }

  // Svelte state proxies and editor integrations are not always structured-cloneable.
  // Document data is JSON by design, so use JSON serialization for history snapshots.
  function cloneDocument<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function editorSnapshot(): CollaborativeSetSnapshot {
    return cloneDocument({
      ...plainSet(),
      sessionToken: sessionToken || "___________________________________________",
      status: sessionStatus,
      questions,
      updatedAt: 0
    });
  }

  function sameValue(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function localChange(before: CollaborativeSetSnapshot, after: CollaborativeSetSnapshot) {
    const beforeIds = before.questions.map(({ id }) => id);
    const afterIds = after.questions.map(({ id }) => id);
    const added = after.questions.find(({ id }) => !beforeIds.includes(id));
    if (added) {
      const index = after.questions.findIndex(({ id }) => id === added.id);
      return {
        target: { type: "structure", action: "add", questionId: added.id } as ApplyClientHistoryTarget,
        summary: `Added question ${index + 1}`
      };
    }
    const deleted = before.questions.find(({ id }) => !afterIds.includes(id));
    if (deleted) {
      const index = before.questions.findIndex(({ id }) => id === deleted.id);
      return {
        target: { type: "structure", action: "delete", questionId: deleted.id } as ApplyClientHistoryTarget,
        summary: `Deleted question ${index + 1}`
      };
    }
    if (!sameValue(beforeIds, afterIds)) {
      const questionId = afterIds.find((id, index) => beforeIds[index] !== id) || afterIds[0];
      return {
        target: { type: "structure", action: "move", questionId } as ApplyClientHistoryTarget,
        summary: "Reordered questions"
      };
    }
    const changedQuestion = after.questions.find((question, index) => !sameValue(question, before.questions[index]));
    if (changedQuestion) {
      const index = after.questions.findIndex(({ id }) => id === changedQuestion.id);
      return {
        target: { type: "question", questionId: changedQuestion.id } as ApplyClientHistoryTarget,
        summary: `Edited question ${index + 1}`
      };
    }
    return { target: { type: "details" } as ApplyClientHistoryTarget, summary: "Edited set details" };
  }

  function flushHistory() {
    if (sessionToken) return;
    const baseline = localBaseline;
    if (applyingLocalHistory || !baseline) return;
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = null;
    const after = editorSnapshot();
    if (sameValue(baseline, after)) {
      return;
    }
    const before = baseline;
    const change = localChange(before, after);
    undoHistory = [
      ...undoHistory.filter((entry) => entry.status !== "undone"),
      {
        summary: change.summary,
        before,
        after,
        target: change.target,
        status: "applied" as const
      }
    ].slice(-100);
    localBaseline = cloneDocument(after);
  }

  function scheduleHistory() {
    if (sessionToken || applyingLocalHistory || !localBaseline) return;
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(flushHistory, 1_000);
  }

  function beginLiveTransaction(target: ApplyClientHistoryTarget, summary: string) {
    if (!sessionToken || liveTransaction) return;
    liveTransaction = {
      before: cloneDocument(liveHistoryBaseline || editorSnapshot()),
      target,
      summary
    };
  }

  function commitLiveTransaction() {
    const transaction = liveTransaction;
    if (!transaction) return;
    liveTransaction = null;
    const after = editorSnapshot();
    if (!sameValue(transaction.before, after)) {
      undoHistory = [
        ...undoHistory.filter((entry) => entry.status !== "undone"),
        { ...transaction, after, status: "applied" as const }
      ].slice(-100);
    }
    liveHistoryBaseline = cloneDocument(after);
  }

  function applySnapshot(snapshot: CollaborativeSetSnapshot) {
    applyingLocalHistory = true;
    setName = snapshot.name;
    instructions = snapshot.instructions;
    const localQuestions = new Map(questions.map((question) => [question.id, question]));
    questions = cloneDocument(snapshot.questions).map((question) =>
      sessionToken && loadedQuestionIds[question.id] ? localQuestions.get(question.id) || question : question
    );
    pdfOptions = cloneDocument(snapshot.pdfOptions);
    if (!currentQuestionId || !questions.some(({ id }) => id === currentQuestionId)) {
      currentQuestionId = questions[0]?.id || null;
    }
    if (sessionToken) liveHistoryBaseline = editorSnapshot();
    else localBaseline = editorSnapshot();
    queueMicrotask(() => (applyingLocalHistory = false));
  }

  function normalizeQuestion(value: any): DraftQuestionValue {
    const source = value?.type && value?.data ? value.data : value?.data || value || {};
    return {
      contents: typeof source.contents === "string" ? source.contents : "",
      solutions: Array.isArray(source.solutions)
        ? source.solutions.map((solution: any) => {
            if (solution && typeof solution === "object" && "type" in solution && "value" in solution)
              return { group: 0, ...solution };
            return typeof solution === "number"
              ? { type: "number", value: solution, group: 0 }
              : { type: "text", value: String(solution), group: 0 };
          })
        : [],
      allowEquivalent: source.allowEquivalent ?? true,
      answerComment: typeof source.answerComment === "string" ? source.answerComment : "",
      requireAllSolutionGroups: source.requireAllSolutionGroups ?? false,
      solutionOrderMatters: source.solutionOrderMatters ?? false,
      skippable: source.skippable ?? true
    };
  }

  function loadLocalDraft() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      const source = Array.isArray(parsed) ? { questions: parsed } : parsed || {};
      setName = typeof source.name === "string" ? source.name : "";
      instructions = typeof source.instructions === "string" ? source.instructions : "";
      questions = Array.isArray(source.questions)
        ? source.questions.slice(0, 100).map((question: any) => withId(normalizeQuestion(question)))
        : [];
      pdfOptions = { ...defaultPdfOptions(), ...(source.pdfOptions || {}) };
      currentQuestionId = questions[0]?.id || null;
    } catch {
      toast.error("The local draft could not be loaded");
    }
  }

  function saveLocalDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(plainSet()));
      localSaved = true;
    } catch {
      toast.error("The draft could not be saved in this browser");
    }
  }

  function applyServerState(state: CollaborativeSetSnapshot) {
    const localQuestions = new Map(questions.map((question) => [question.id, question]));
    setName = state.name;
    instructions = state.instructions;
    questions = state.questions.map((question) => {
      if (ownedLocks[question.id] || loadedQuestionIds[question.id]) return localQuestions.get(question.id) || question;
      return question;
    });
    pdfOptions = state.pdfOptions;
    sessionStatus = state.status;
    currentQuestionId = questionIdFromUrl();
    lastServerSettings = JSON.stringify({ setName, instructions, pdfOptions });
    if (liveTransaction?.target.type === "structure") {
      if (liveTransaction.target.action === "add" || liveTransaction.target.action === "duplicate") {
        const added = questions.find(
          ({ id }) => !liveTransaction!.before.questions.some((question) => question.id === id)
        );
        if (added) liveTransaction.target.questionId = added.id;
      }
      commitLiveTransaction();
    } else if (!liveTransaction) liveHistoryBaseline = cloneDocument(editorSnapshot());
  }

  function loadQuestion(questionId: string): Promise<boolean> {
    if (!questionId || !sessionToken || !socket) return Promise.resolve(false);
    if (loadedQuestionIds[questionId]) return Promise.resolve(true);
    const existing = questionLoads.get(questionId);
    if (existing) return existing;
    const load = new Promise<boolean>((resolve) => {
      socket?.emit("getQuestion", { questionId }, (result) => {
        questionLoads.delete(questionId);
        if (!result.ok) {
          toast.error(result.error);
          resolve(false);
          return;
        }
        const index = questions.findIndex(({ id }) => id === questionId);
        if (index >= 0) questions[index] = result.question;
        loadedQuestionIds = { ...loadedQuestionIds, [questionId]: true };
        lastQuestionSent.set(questionId, JSON.stringify(plainQuestion(result.question)));
        resolve(true);
      });
    });
    questionLoads.set(questionId, load);
    return load;
  }

  async function loadAllQuestions(): Promise<boolean> {
    if (!sessionToken) return true;
    return (await Promise.all(questions.map(({ id }) => loadQuestion(id)))).every(Boolean);
  }

  function questionIdFromUrl(): string | null {
    const questionId = sessionToken ? page.url.hash.slice(1) : null;
    return questionId && questions.some(({ id }) => id === questionId) ? questionId : questions[0]?.id || null;
  }

  function updateQuestionUrl(questionId: string) {
    if (!sessionToken || page.url.hash.slice(1) === questionId) return;
    const url = new URL(page.url);
    url.hash = questionId;
    pushState(url, page.state);
  }

  function joinSession(reconnecting = false) {
    const name = displayName.trim();
    if (!sessionToken || !socket || name.length < 1 || name.length > 20) {
      toast.error("Enter a name between 1 and 20 characters");
      return;
    }
    joining = true;
    socket.emit(
      "joinSession",
      {
        sessionToken,
        displayName: name,
        hostToken: localStorage.getItem(`mathex-collab-host:${sessionToken}`) || undefined
      },
      (result) => {
        joining = false;
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        displayName = name;
        localStorage.setItem(`mathex-collab-name:${sessionToken}`, name);
        applyServerState(result.state.set);
        if (currentQuestionId) void loadQuestion(currentQuestionId);
        collaborators = result.state.collaborators;
        locks = result.state.locks;
        hostSession = result.state.collaborators.some(
          (collaborator) => collaborator.connectionId === socket?.id && collaborator.isHost
        );
        joined = true;
        ready = true;
        if (reconnecting) toast.success("Reconnected to the live editor");
      }
    );
  }

  onMount(() => {
    socket = io("/set-collaboration", {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3_000
    });
    socket.on("connect", () => {
      const shouldRejoin = !!sessionToken && joined && !!displayName && !deleted;
      connected = true;
      if (shouldRejoin) joinSession(true);
    });
    socket.on("disconnect", () => {
      connected = false;
      ownedLocks = {};
      locks = [];
      collaborators = [];
      acquiringQuestionId = null;
      if (joined && !deleted && !closingSocket) toast.warning("Disconnected from the live editor. Reconnecting...");
    });
    socket.on("state", applyServerState);
    socket.on("presence", (next) => (collaborators = next));
    socket.on("lockChanged", (questionId, lock) => {
      locks = lock
        ? [...locks.filter((item) => item.questionId !== questionId), lock]
        : locks.filter((item) => item.questionId !== questionId);
      if (!lock || lock.connectionId !== socket?.id) ownedLocks = { ...ownedLocks, [questionId]: false };
    });
    socket.on("questionUpdated", (question) => {
      const index = questions.findIndex(({ id }) => id === question.id);
      if (index < 0) return;
      questions[index] = question;
      loadedQuestionIds = { ...loadedQuestionIds, [question.id]: true };
      lastQuestionSent.set(question.id, JSON.stringify(plainQuestion(question)));
      if (!liveTransaction) liveHistoryBaseline = cloneDocument(editorSnapshot());
    });
    socket.on("sessionDeleted", () => {
      deleted = true;
      joined = false;
    });

    if (sessionToken) {
      displayName = localStorage.getItem(`mathex-collab-name:${sessionToken}`) || "";
      if (displayName) joinSession();
    } else {
      loadLocalDraft();
      localBaseline = editorSnapshot();
      ready = true;
    }

    const isExternalMathControl = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest(".ML__keyboard, .ML__virtual-keyboard-toggle, [data-slot='select-content']");
    const releaseOnOutsidePointer = (event: PointerEvent) => {
      if (!currentQuestionId || !activeQuestionCard || !ownedLocks[currentQuestionId]) return;
      if (isExternalMathControl(event.target)) return;
      if (activeQuestionCard.contains(event.target as Node)) return;
      releaseQuestion(currentQuestionId);
    };
    window.addEventListener("pointerdown", releaseOnOutsidePointer, true);

    lockHeartbeat = setInterval(() => {
      for (const [questionId, owned] of Object.entries(ownedLocks)) {
        if (owned) socket?.emit("refreshLock", { questionId });
      }
    }, 10_000);

    return () => {
      closingSocket = true;
      if (lockHeartbeat) clearInterval(lockHeartbeat);
      if (historyTimer) clearTimeout(historyTimer);
      window.removeEventListener("pointerdown", releaseOnOutsidePointer, true);
      for (const questionId of Object.keys(ownedLocks)) {
        if (ownedLocks[questionId]) {
          sendQuestion(questionId);
          socket?.emit("releaseLock", { questionId });
        }
      }
      socket?.disconnect();
    };
  });

  $effect(() => {
    const serialized = JSON.stringify({ setName, instructions, questions, pdfOptions });
    if (!ready) return;
    if (applyingLocalHistory) return;
    if (!sessionToken) {
      localSaved = false;
      if (localTimer) clearTimeout(localTimer);
      localTimer = setTimeout(saveLocalDraft, 500);
      scheduleHistory();
      return;
    }
    if (!joined || !isHost) return;
    const settings = JSON.stringify({ setName, instructions, pdfOptions });
    if (settings === lastServerSettings) return;
    beginLiveTransaction({ type: "details" }, "Edited set details");
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      lastServerSettings = settings;
      socket?.emit("updateMetadata", { name: setName, instructions }, handleOperation);
      socket?.emit("updatePdfOptions", { pdfOptions }, handleOperation);
      commitLiveTransaction();
    }, 350);
    serialized;
  });

  $effect(() => {
    if (!sessionToken || !joined) return;
    const questionId = questionIdFromUrl();
    if (questionId && questionId !== currentQuestionId) selectQuestion(questionId, false);
  });

  $effect(() => {
    if (!sessionToken || !joined || !currentQuestion || !ownedLocks[currentQuestion.id]) return;
    const questionId = currentQuestion.id;
    const serialized = JSON.stringify(plainQuestion(currentQuestion));
    if (serialized === lastQuestionSent.get(questionId)) return;
    const timer = questionTimers.get(questionId);
    if (timer) clearTimeout(timer);
    questionTimers.set(
      questionId,
      setTimeout(() => {
        sendQuestion(questionId);
      }, 120)
    );
  });

  function sendQuestion(questionId: string) {
    const question = questions.find(({ id }) => id === questionId);
    if (!question || !ownedLocks[questionId]) return;
    const serialized = JSON.stringify(plainQuestion(question));
    if (serialized === lastQuestionSent.get(questionId)) return;
    const timer = questionTimers.get(questionId);
    if (timer) clearTimeout(timer);
    questionTimers.delete(questionId);
    lastQuestionSent.set(questionId, serialized);
    socket?.emit("updateQuestion", { questionId, question: plainQuestion(question) }, (result) => {
      if (!result.ok) lastQuestionSent.delete(questionId);
    });
  }

  function releaseQuestion(questionId: string) {
    if (!ownedLocks[questionId]) return;
    sendQuestion(questionId);
    if (liveTransaction?.target.type === "question" && liveTransaction.target.questionId === questionId) {
      commitLiveTransaction();
    }
    socket?.emit("releaseLock", { questionId });
    ownedLocks = { ...ownedLocks, [questionId]: false };
  }

  function handleOperation(result: { ok: true } | { ok: false; error: string }) {
    if (!result.ok) toast.error(result.error);
  }

  function handleStructuralOperation(result: { ok: true } | { ok: false; error: string }) {
    if (!result.ok) liveTransaction = null;
    handleOperation(result);
  }

  function lockFor(questionId: string) {
    return locks.find((lock) => lock.questionId === questionId) || null;
  }

  function lockedByOther(questionId: string) {
    const lock = lockFor(questionId);
    return !!lock && lock.connectionId !== socket?.id;
  }

  function focusQuestion(questionId: string) {
    if (
      !sessionToken ||
      !joined ||
      !connected ||
      sessionStatus !== "active" ||
      lockedByOther(questionId) ||
      ownedLocks[questionId] ||
      acquiringQuestionId === questionId
    )
      return;
    const question = questions.find(({ id }) => id === questionId);
    if (question) lastQuestionSent.set(questionId, JSON.stringify(plainQuestion(question)));
    acquiringQuestionId = questionId;
    socket?.emit("acquireLock", { questionId }, (result) => {
      acquiringQuestionId = null;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      ownedLocks = { ...ownedLocks, [questionId]: true };
      void loadQuestion(questionId);
      const index = questions.findIndex(({ id }) => id === questionId);
      beginLiveTransaction({ type: "question", questionId }, `Edited question ${index + 1}`);
    });
  }

  function selectQuestion(questionId: string, updateUrl = true) {
    if (currentQuestionId && ownedLocks[currentQuestionId]) {
      releaseQuestion(currentQuestionId);
    }
    currentQuestionId = questionId;
    if (updateUrl) updateQuestionUrl(questionId);
    void loadQuestion(questionId);
    mobileOutlineOpen = false;
  }

  async function addQuestion() {
    if (questions.length >= 100) return toast.error("A set can contain at most 100 questions");
    if (sessionToken) {
      if (!(await loadAllQuestions())) return;
      beginLiveTransaction(
        {
          type: "structure",
          action: "add",
          questionId: currentQuestionId || questions.at(-1)?.id || "00000000-0000-4000-8000-000000000000"
        },
        "Added question"
      );
      socket?.emit("addQuestion", { afterQuestionId: currentQuestionId }, handleStructuralOperation);
      return;
    }
    const question = withId(emptyQuestion());
    const index = currentQuestionIndex < 0 ? questions.length : currentQuestionIndex + 1;
    questions.splice(index, 0, question);
    currentQuestionId = question.id;
  }

  async function duplicateQuestion(question: CollaborativeQuestionValue) {
    if (sessionToken) {
      if (!(await loadAllQuestions())) return;
      beginLiveTransaction({ type: "structure", action: "duplicate", questionId: question.id }, "Duplicated question");
      socket?.emit("duplicateQuestion", { questionId: question.id }, handleStructuralOperation);
      return;
    }
    const copy = { ...cloneDocument(question), id: crypto.randomUUID() };
    const index = questions.findIndex(({ id }) => id === question.id) + 1;
    questions.splice(index, 0, copy);
    currentQuestionId = copy.id;
  }

  async function moveQuestion(question: CollaborativeQuestionValue, direction: -1 | 1) {
    const index = questions.findIndex(({ id }) => id === question.id);
    const toIndex = index + direction;
    if (toIndex < 0 || toIndex >= questions.length) return;
    if (sessionToken) {
      if (!(await loadAllQuestions())) return;
      beginLiveTransaction({ type: "structure", action: "move", questionId: question.id }, "Moved question");
      socket?.emit("moveQuestion", { questionId: question.id, toIndex }, handleStructuralOperation);
      return;
    }
    questions.splice(index, 1);
    questions.splice(toIndex, 0, question);
  }

  function deleteQuestion(question: CollaborativeQuestionValue) {
    pendingDeleteQuestion = question;
  }

  async function confirmDeleteQuestion() {
    const question = pendingDeleteQuestion;
    if (!question) return;
    pendingDeleteQuestion = null;
    if (sessionToken) {
      if (!(await loadAllQuestions())) return;
      beginLiveTransaction({ type: "structure", action: "delete", questionId: question.id }, "Deleted question");
      socket?.emit("deleteQuestion", { questionId: question.id }, handleStructuralOperation);
      return;
    }
    const index = questions.findIndex(({ id }) => id === question.id);
    questions.splice(index, 1);
    if (currentQuestionId === question.id)
      currentQuestionId = questions[Math.min(index, questions.length - 1)]?.id || null;
  }

  function undo() {
    flushHistory();
    if (sessionToken && currentQuestionId && ownedLocks[currentQuestionId]) releaseQuestion(currentQuestionId);
    const entry = [...undoHistory].reverse().find((candidate) => candidate.status === "applied");
    if (!entry) return;
    if (!sessionToken) {
      applySnapshot(entry.before);
      undoHistory = undoHistory.map((candidate) =>
        candidate === entry ? { ...candidate, status: "undone" as const } : candidate
      );
      return;
    }
    const rollback = editorSnapshot();
    applySnapshot(entry.before);
    undoHistory = undoHistory.map((candidate) =>
      candidate === entry ? { ...candidate, status: "undone" as const } : candidate
    );
    socket?.emit(
      "applyClientHistory",
      { target: entry.target, expected: entry.after, desired: entry.before },
      (result) => {
        if (!result.ok) {
          applySnapshot(rollback);
          undoHistory = undoHistory.map((candidate) =>
            candidate === entry ? { ...candidate, status: "applied" as const } : candidate
          );
          return toast.error(result.error);
        }
        liveHistoryBaseline = cloneDocument(entry.before);
        liveTransaction = null;
      }
    );
  }

  function redo() {
    flushHistory();
    if (sessionToken && currentQuestionId && ownedLocks[currentQuestionId]) releaseQuestion(currentQuestionId);
    const entry = undoHistory.find((candidate) => candidate.status === "undone");
    if (!entry) return;
    if (!sessionToken) {
      applySnapshot(entry.after);
      undoHistory = undoHistory.map((candidate) =>
        candidate === entry ? { ...candidate, status: "applied" as const } : candidate
      );
      return;
    }
    const rollback = editorSnapshot();
    applySnapshot(entry.after);
    undoHistory = undoHistory.map((candidate) =>
      candidate === entry ? { ...candidate, status: "applied" as const } : candidate
    );
    socket?.emit(
      "applyClientHistory",
      { target: entry.target, expected: entry.before, desired: entry.after },
      (result) => {
        if (!result.ok) {
          applySnapshot(rollback);
          undoHistory = undoHistory.map((candidate) =>
            candidate === entry ? { ...candidate, status: "undone" as const } : candidate
          );
          return toast.error(result.error);
        }
        liveHistoryBaseline = cloneDocument(entry.after);
        liveTransaction = null;
      }
    );
  }

  function createSession() {
    const name = goLiveName.trim();
    if (name.length < 1 || name.length > 20) return toast.error("Enter a name between 1 and 20 characters");
    if (!socket) return;
    creating = true;
    socket.emit("createSession", { set: plainSet() }, (result) => {
      creating = false;
      if (!result.ok) return toast.error(result.error);
      localStorage.setItem(`mathex-collab-host:${result.sessionToken}`, result.hostToken);
      localStorage.setItem(`mathex-collab-name:${result.sessionToken}`, name);
      goto(`/mathex/app/create/editor/${result.sessionToken}`);
    });
  }

  function importFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const source = Array.isArray(parsed) ? { questions: parsed } : parsed;
        if (!Array.isArray(source.questions) || source.questions.length > 100) throw new Error();
        setName = typeof source.name === "string" ? source.name.slice(0, 120) : "";
        instructions = typeof source.instructions === "string" ? source.instructions : "";
        questions = source.questions.map((question: any) => withId(normalizeQuestion(question)));
        pdfOptions = { ...defaultPdfOptions(), ...(source.pdfOptions || {}) };
        currentQuestionId = questions[0]?.id || null;
        toast.success(`Imported ${questions.length} questions`);
      } catch {
        toast.error("Could not import this set");
      }
    };
    input.click();
  }

  async function downloadJson() {
    if (!(await loadAllQuestions())) return;
    const blob = new Blob([JSON.stringify(plainSet(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${
      setName
        .trim()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "") || "set"
    }.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function validatedSet() {
    if (!(await loadAllQuestions())) return null;
    const result = QuestionSet.safeParse(plainSet());
    if (!result.success) {
      toast.error(`Complete the set first: ${result.error.issues[0]?.message || "invalid content"}`);
      return null;
    }
    return result.data;
  }

  async function exportPdf(answers: boolean) {
    const set = await validatedSet();
    if (!set) return;
    const id = toast.loading(`Creating ${answers ? "answer" : "question"} PDF...`);
    try {
      await (answers ? downloadAnswerSet(set) : downloadQuestionSet(set));
      toast.success("PDF downloaded", { id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create PDF", { id });
    }
  }

  async function previewPdf(answers: boolean) {
    const set = await validatedSet();
    if (!set) return;
    if (!(answers ? previewAnswerSet(set) : previewQuestionSet(set))) toast.error("Allow pop-ups to open the preview");
  }

  async function useInRoom() {
    const set = await validatedSet();
    if (!set) return;
    localStorage.setItem(ROOM_SET_KEY, JSON.stringify(set));
    window.open("/mathex/app/create", "_blank", "noopener");
  }

  async function copySessionLink() {
    try {
      await copyText(sessionUrl);
      toast.success("Editor link copied");
    } catch {
      toast.error("Could not copy the editor link");
    }
  }

  function endSession() {
    if (!confirm("End collaboration and permanently delete this server copy? Everyone will be disconnected.")) return;
    socket?.emit("deleteSession", (result) => {
      if (!result.ok) return toast.error(result.error);
      localStorage.removeItem(`mathex-collab-host:${sessionToken}`);
      toast.success("Collaborative set deleted");
      goto("/mathex/app/create/editor");
    });
  }

  function questionPreview(question: CollaborativeQuestionValue) {
    if (sessionToken && !loadedQuestionIds[question.id]) return "Question not loaded";
    return stripTags(question.contents).trim().slice(0, 44) || "Untitled question";
  }
</script>

{#if sessionToken && !joined}
  <div class="flex min-h-screen items-center justify-center bg-[#f6f7fb] p-5 dark:bg-zinc-950">
    <div class="w-full max-w-md rounded-2xl border bg-background p-7 shadow-xl shadow-slate-900/5">
      {#if deleted}
        <div class="mb-5 flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <Trash2 />
        </div>
        <Header size="h1" class="!mb-2 text-2xl">This collaboration has ended</Header>
        <p class="mb-6 text-sm leading-6 text-muted-foreground">
          The host deleted this collaborative set. Personal browser drafts were not changed.
        </p>
        <Button href="/mathex/app/create/editor">Open a new editor</Button>
      {:else}
        <div class="mb-5 flex size-12 items-center justify-center rounded-2xl bg-blue-600 text-white">
          <UsersRound />
        </div>
        <p class="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Collaborative set</p>
        <Header size="h1" class="!mb-2 text-2xl">Choose how you appear</Header>
        <p class="mb-6 text-sm leading-6 text-muted-foreground">
          Your name is shown while you edit and beside any question you lock.
        </p>
        <label class="grid gap-2 text-sm font-semibold">
          Display name
          <input
            class="h-11 rounded-lg border bg-background px-3 font-normal outline-none ring-blue-500/20 focus:border-blue-500 focus:ring-4"
            bind:value={displayName}
            maxlength="20"
            placeholder="e.g. Raymont"
            onkeydown={(event) => event.key === "Enter" && joinSession()}
          />
        </label>
        <Button class="mt-5 w-full bg-blue-600 hover:bg-blue-700" onclick={() => joinSession()} disabled={joining}
          >{joining ? "Joining..." : "Join editor"}</Button
        >
        <p class="mt-4 text-center text-xs text-muted-foreground">
          Anyone with this link can edit after entering a name.
        </p>
      {/if}
    </div>
  </div>
{:else}
  <div class="flex h-screen flex-col overflow-hidden bg-[#f3f5f9] text-foreground dark:bg-zinc-950">
    <header class="z-30 shrink-0 border-b bg-background/95 shadow-sm backdrop-blur">
      <div class="flex min-h-14 items-center gap-2 px-3 sm:px-4">
        <button
          class="rounded-lg p-2 hover:bg-accent lg:hidden"
          onclick={() => (mobileOutlineOpen = !mobileOutlineOpen)}
          aria-label="Toggle question outline"><Menu class="size-5" /></button
        >
        <a
          href="/mathex/app/create/editor"
          class="mr-1 flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 font-bold text-white shadow-sm"
          >M</a
        >
        <div class="min-w-0 flex-1">
          <input
            class="w-full max-w-xl truncate rounded border border-transparent bg-transparent px-2 py-0.5 text-sm font-semibold outline-none hover:border-border focus:border-blue-500 disabled:opacity-80"
            bind:value={setName}
            maxlength="120"
            placeholder="Untitled question set"
            disabled={!!sessionToken && !isHost}
          />
          <div class="flex items-center gap-2 px-2 text-[0.68rem] text-muted-foreground">
            {#if sessionToken}
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold {connected
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'}"
              >
                {#if connected}<Wifi class="size-3.5" />{:else}<WifiOff class="size-3.5" />{/if}
                {connected ? "Live" : "Disconnected"}
              </span>
              <span>{isHost ? "Host" : "Collaborator"}</span>
            {:else}
              <span class="inline-flex items-center gap-1"
                ><Check class="size-3" /> {localSaved ? "Saved in this browser" : "Saving..."}</span
              >
            {/if}
          </div>
        </div>

        {#if sessionToken}
          <div class="hidden items-center -space-x-2 sm:flex">
            {#each collaborators.slice(0, 5) as collaborator}
              <div
                class="flex size-8 items-center justify-center rounded-full border-2 border-background bg-blue-100 text-xs font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                title={`${collaborator.displayName}${collaborator.isHost ? " (host)" : ""}`}
              >
                {collaborator.displayName.slice(0, 1).toUpperCase()}
              </div>
            {/each}
          </div>
          <Button class="gap-2 bg-blue-600 hover:bg-blue-700" size="sm" onclick={copySessionLink}
            ><Link2 class="size-4" /><span class="hidden sm:inline">Share</span></Button
          >
        {:else}
          <Button class="gap-2 bg-blue-600 hover:bg-blue-700" size="sm" onclick={() => (goLiveOpen = true)}
            ><Radio class="size-4" /><span class="hidden sm:inline">Go live</span></Button
          >
        {/if}
        <div class="relative">
          <button
            class="rounded-lg p-2 hover:bg-accent"
            onclick={() => (exportOpen = !exportOpen)}
            aria-label="More actions"><MoreHorizontal class="size-5" /></button
          >
          {#if exportOpen}
            <button
              class="fixed inset-0 z-30 cursor-default"
              onclick={() => (exportOpen = false)}
              aria-label="Close menu"
            ></button>
            <div class="absolute right-0 z-40 mt-2 w-60 rounded-xl border bg-popover p-1.5 text-sm shadow-xl">
              {#if !sessionToken}<button class="menu-item" onclick={importFile}><Upload /> Import JSON</button>{/if}
              <button class="menu-item" onclick={downloadJson}><FileJson /> Download JSON</button>
              <button class="menu-item" onclick={() => exportPdf(false)}><Download /> Question PDF</button>
              <button class="menu-item" onclick={() => exportPdf(true)}><Download /> Answer PDF</button>
              <button class="menu-item" onclick={() => previewPdf(false)}><FileText /> Preview questions</button>
              <button class="menu-item" onclick={() => previewPdf(true)}><FileText /> Preview answers</button>
              <button class="menu-item" onclick={useInRoom}><UsersRound /> Use in room</button>
              <div class="my-1 border-t"></div>
              <a class="menu-item" href="/mathex/app/create/oldeditor"><ArrowLeft /> Open legacy editor</a>
              {#if sessionToken && isHost}<button class="menu-item text-destructive" onclick={endSession}
                  ><Trash2 /> End and delete</button
                >{/if}
            </div>
          {/if}
        </div>
      </div>
      <div class="flex h-10 items-center gap-1 overflow-x-auto border-t px-3 sm:px-16">
        {#if !sessionToken || isHost}
          <button class="toolbar-button" onclick={addQuestion}><Plus /> Add question</button>
        {/if}
        <button class="toolbar-button" onclick={() => (detailsOpen = !detailsOpen)}
          ><Settings2 /> Set details <ChevronDown /></button
        >
        <span class="mx-1 h-5 border-l"></span>
        <button
          class="toolbar-button"
          onclick={undo}
          disabled={!canUndo || (!!sessionToken && !connected)}
          title="Undo your latest change"
        >
          <Undo2 /> Undo
        </button>
        <button
          class="toolbar-button"
          onclick={redo}
          disabled={!canRedo || (!!sessionToken && !connected)}
          title="Redo your latest undone change"
        >
          <Redo2 /> Redo
        </button>
        <span class="ml-auto text-xs text-muted-foreground">{questions.length}/100 questions</span>
      </div>
    </header>

    <div class="relative flex min-h-0 flex-1">
      <aside
        class="absolute inset-y-0 left-0 z-20 w-72 border-r bg-background p-3 shadow-xl transition-transform lg:static lg:w-64 lg:translate-x-0 lg:shadow-none {mobileOutlineOpen
          ? 'translate-x-0'
          : '-translate-x-full'}"
      >
        <div class="mb-2 flex items-center justify-between px-2">
          <span class="text-xs font-bold uppercase tracking-wider text-muted-foreground">Document outline</span>
          <button class="rounded p-1 hover:bg-accent lg:hidden" onclick={() => (mobileOutlineOpen = false)}
            ><X class="size-4" /></button
          >
        </div>
        <div class="h-[calc(100%-2rem)] space-y-1 overflow-y-auto pr-1">
          {#each questions as question, index (question.id)}
            {@const lock = lockFor(question.id)}
            <div
              class="group rounded-xl border border-transparent {currentQuestionId === question.id
                ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40'
                : 'hover:bg-accent/60'}"
            >
              <button
                class="flex w-full items-start gap-2 px-2.5 py-2.5 text-left"
                onclick={() => selectQuestion(question.id)}
              >
                <span
                  class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-background text-[0.68rem] font-bold shadow-sm"
                  >{index + 1}</span
                >
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-xs font-medium">{questionPreview(question)}</span>
                  {#if lock}<span class="mt-1 flex items-center gap-1 truncate text-[0.65rem] text-blue-600"
                      ><LockKeyhole class="size-3" />
                      {lock.connectionId === socket?.id ? "You are editing" : `${lock.displayName} is editing`}</span
                    >{/if}
                </span>
              </button>
              {#if (!sessionToken || isHost) && currentQuestionId === question.id}
                <div
                  class="flex items-center justify-end gap-0.5 border-t border-blue-100 px-2 py-1 dark:border-blue-900"
                >
                  <button
                    class="outline-action"
                    onclick={() => moveQuestion(question, -1)}
                    disabled={index === 0 || lockedByOther(question.id)}
                    aria-label="Move up"><ArrowUp /></button
                  >
                  <button
                    class="outline-action"
                    onclick={() => moveQuestion(question, 1)}
                    disabled={index === questions.length - 1 || lockedByOther(question.id)}
                    aria-label="Move down"><ArrowDown /></button
                  >
                  <button
                    class="outline-action"
                    onclick={() => duplicateQuestion(question)}
                    disabled={questions.length >= 100 || lockedByOther(question.id)}
                    aria-label="Duplicate"><Copy /></button
                  >
                  <button
                    class="outline-action hover:!text-destructive"
                    onclick={() => deleteQuestion(question)}
                    disabled={lockedByOther(question.id)}
                    aria-label="Delete"><Trash2 /></button
                  >
                </div>
              {/if}
            </div>
          {:else}
            <div class="px-3 py-12 text-center text-xs text-muted-foreground">No questions yet</div>
          {/each}
        </div>
      </aside>
      {#if mobileOutlineOpen}<button
          class="absolute inset-0 z-10 bg-black/20 lg:hidden"
          onclick={() => (mobileOutlineOpen = false)}
          aria-label="Close outline"
        ></button>{/if}

      <main class="min-w-0 flex-1 overflow-y-auto px-3 py-6 sm:px-6 lg:px-10">
        <div class="mx-auto max-w-4xl">
          {#if detailsOpen}
            <section class="mb-5 rounded-2xl border bg-background p-5 shadow-sm">
              <div class="mb-4 flex items-center justify-between">
                <div>
                  <h2 class="font-semibold">Set details</h2>
                  <p class="text-xs text-muted-foreground">Cover instructions and print layout</p>
                </div>
                <button class="rounded-lg p-2 hover:bg-accent" onclick={() => (detailsOpen = false)}
                  ><X class="size-4" /></button
                >
              </div>
              <div class="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
                <div class="grid min-w-0 gap-2">
                  <span class="text-xs font-semibold">Cover instructions</span><Quill
                    bind:html={instructions}
                    disabled={!!sessionToken && !isHost}
                  />
                </div>
                <div class="grid min-w-0 grid-cols-2 content-start gap-3">
                  <label class="setting-field"
                    >Question text <input
                      type="number"
                      min="6"
                      max="18"
                      step="0.5"
                      bind:value={pdfOptions.questionTextSize}
                      disabled={!!sessionToken && !isHost}
                    /></label
                  >
                  <label class="setting-field"
                    >Answer text <input
                      type="number"
                      min="6"
                      max="16"
                      step="0.5"
                      bind:value={pdfOptions.answerTextSize}
                      disabled={!!sessionToken && !isHost}
                    /></label
                  >
                  <label class="setting-field"
                    >Image height <input
                      type="number"
                      min="5"
                      max="35"
                      bind:value={pdfOptions.imageHeight}
                      disabled={!!sessionToken && !isHost}
                    /></label
                  >
                  <label class="setting-field"
                    >Slip height <input
                      type="number"
                      min="1"
                      step="0.5"
                      bind:value={pdfOptions.slipHeight}
                      disabled={!!sessionToken && !isHost}
                    /></label
                  >
                  <label class="setting-field col-span-2"
                    >Cut-off margin <input
                      type="number"
                      min="0"
                      max="80"
                      bind:value={pdfOptions.cutMargin}
                      disabled={!!sessionToken && !isHost}
                    /></label
                  >
                </div>
              </div>
            </section>
          {/if}

          {#if sessionStatus === "ended"}
            <div class="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              This collaboration has ended and is now view-only.
            </div>
          {/if}

          {#if currentQuestion}
            {@const currentLock = lockFor(currentQuestion.id)}
            {@const hasOwnLock = !sessionToken || ownedLocks[currentQuestion.id]}
            {@const readOnly = sessionStatus !== "active" || !hasOwnLock}
            <div class="mb-3 flex items-center gap-3 px-1">
              <div>
                <p class="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">
                  Question {currentQuestionIndex + 1}
                </p>
                <h1 class="text-xl font-semibold">Edit question</h1>
              </div>
              {#if currentLock}
                <div
                  class="ml-auto flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-xs shadow-sm"
                >
                  <span class="size-2 rounded-full bg-blue-500"></span>
                  {currentLock.connectionId === socket?.id
                    ? "You are editing"
                    : `${currentLock.displayName} is editing`}
                </div>
              {/if}
            </div>
            {#if lockedByOther(currentQuestion.id) && currentLock}
              <div
                class="mb-3 flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100"
              >
                <LockKeyhole class="size-4" /><strong>{currentLock.displayName}</strong> has this question. You can watch
                changes live.
              </div>
            {/if}
            <section
              bind:this={activeQuestionCard}
              class="document-page relative"
              onfocusin={() => focusQuestion(currentQuestion!.id)}
            >
              {#if sessionToken && connected && sessionStatus === "active" && !currentLock && !hasOwnLock}
                <button
                  type="button"
                  class="absolute inset-0 z-20 flex cursor-text items-start justify-center rounded-[inherit] bg-background/15 pt-5 backdrop-blur-[1.5px] transition-[backdrop-filter] duration-200 hover:backdrop-blur-[0px]"
                  onclick={() => focusQuestion(currentQuestion!.id)}
                  disabled={acquiringQuestionId === currentQuestion.id}
                  aria-label="Acquire question lock to edit"
                >
                  <span class="rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-sm">
                    {acquiringQuestionId === currentQuestion.id
                      ? "Getting edit access..."
                      : "Click to edit this question"}
                  </span>
                </button>
              {/if}
              {#if currentQuestionLoaded}
                {#key currentQuestion.id}
                  <QuestionEditor question={currentQuestion} disabled={readOnly} />
                {/key}
              {:else}
                <div class="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
                  Loading question...
                </div>
              {/if}
            </section>
            <div class="mt-4 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onclick={() => currentQuestionIndex > 0 && selectQuestion(questions[currentQuestionIndex - 1].id)}
                disabled={currentQuestionIndex <= 0}>Previous</Button
              >
              <span class="text-xs text-muted-foreground"
                >Changes {sessionToken ? "sync while you type" : "save automatically"}</span
              >
              <Button
                variant="outline"
                size="sm"
                onclick={() =>
                  currentQuestionIndex < questions.length - 1 && selectQuestion(questions[currentQuestionIndex + 1].id)}
                disabled={currentQuestionIndex >= questions.length - 1}>Next</Button
              >
            </div>
          {:else}
            <section class="document-page flex min-h-[32rem] flex-col items-center justify-center text-center">
              <div
                class="mb-5 flex size-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950"
              >
                <FileText />
              </div>
              <h1 class="text-2xl font-semibold">Start your question set</h1>
              <p class="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                Add a question to begin. You can go live whenever you are ready for others to join.
              </p>
              {#if !sessionToken || isHost}<Button
                  class="mt-6 gap-2 bg-blue-600 hover:bg-blue-700"
                  onclick={addQuestion}><Plus /> Add first question</Button
                >{/if}
            </section>
          {/if}
        </div>
      </main>

      {#if sessionToken}
        <aside class="hidden w-56 shrink-0 border-l bg-background p-4 xl:block">
          <div class="mb-4 flex items-center gap-2">
            <UsersRound class="size-4 text-blue-600" />
            <h2 class="text-sm font-semibold">In this document</h2>
            <span class="ml-auto rounded-full bg-muted px-2 py-0.5 text-[0.65rem]">{collaborators.length}</span>
          </div>
          <div class="space-y-2">
            {#each collaborators as collaborator}
              {@const collaboratorLock = locks.find((lock) => lock.connectionId === collaborator.connectionId)}
              <div class="flex items-center gap-2.5 rounded-xl p-2 hover:bg-accent/60">
                <div
                  class="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-200"
                >
                  {collaborator.displayName.slice(0, 1).toUpperCase()}
                </div>
                <div class="min-w-0">
                  <p class="truncate text-xs font-semibold">
                    {collaborator.displayName}{collaborator.connectionId === socket?.id ? " (you)" : ""}
                  </p>
                  <p class="truncate text-[0.65rem] text-muted-foreground">
                    {collaboratorLock
                      ? `Editing question ${questions.findIndex(({ id }) => id === collaboratorLock.questionId) + 1}`
                      : collaborator.isHost
                        ? "Host"
                        : "Viewing"}
                  </p>
                </div>
              </div>
            {/each}
          </div>
          <div class="mt-5 rounded-xl border bg-muted/30 p-3">
            <p class="flex items-center gap-1.5 text-xs font-semibold">
              <Wifi class="size-3.5 text-emerald-500" /> Live editing
            </p>
            <p class="mt-1 text-[0.68rem] leading-4 text-muted-foreground">
              Focus a question to reserve it. Everyone else can follow your edits in real time.
            </p>
          </div>
        </aside>
      {/if}
    </div>
  </div>
{/if}

{#if pendingDeleteQuestion}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
    role="presentation"
    onclick={(event) => event.target === event.currentTarget && (pendingDeleteQuestion = null)}
  >
    <div class="w-full max-w-md rounded-2xl border bg-background p-6 shadow-2xl">
      <div class="mb-4 flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <Trash2 />
      </div>
      <h2 class="text-xl font-semibold">
        Delete question {questions.findIndex(({ id }) => id === pendingDeleteQuestion?.id) + 1}?
      </h2>
      <p class="mt-2 text-sm text-muted-foreground">
        “{questionPreview(pendingDeleteQuestion)}” will be removed from this set.
      </p>
      <div class="mt-6 flex justify-end gap-2">
        <Button variant="outline" onclick={() => (pendingDeleteQuestion = null)}>Cancel</Button>
        <Button variant="destructive" onclick={confirmDeleteQuestion}>Delete question</Button>
      </div>
    </div>
  </div>
{/if}

{#if goLiveOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
    role="presentation"
    onclick={(event) => event.target === event.currentTarget && (goLiveOpen = false)}
  >
    <div class="w-full max-w-md rounded-2xl border bg-background p-6 shadow-2xl">
      <div class="mb-5 flex items-start justify-between">
        <div class="flex size-11 items-center justify-center rounded-xl bg-blue-600 text-white"><Radio /></div>
        <button class="rounded-lg p-2 hover:bg-accent" onclick={() => (goLiveOpen = false)}><X class="size-4" /></button
        >
      </div>
      <h2 class="text-xl font-semibold">Start live collaboration</h2>
      <p class="mt-2 text-sm leading-6 text-muted-foreground">
        A separate server copy will be created. Your local draft stays in this browser and anyone with the new link can
        join.
      </p>
      <label class="mt-5 grid gap-2 text-sm font-semibold"
        >Your display name<input
          class="h-11 rounded-lg border bg-background px-3 font-normal outline-none ring-blue-500/20 focus:border-blue-500 focus:ring-4"
          bind:value={goLiveName}
          maxlength="20"
          placeholder="Shown to collaborators"
          onkeydown={(event) => event.key === "Enter" && createSession()}
        /></label
      >
      <div class="mt-6 flex justify-end gap-2">
        <Button variant="outline" onclick={() => (goLiveOpen = false)}>Cancel</Button><Button
          class="gap-2 bg-blue-600 hover:bg-blue-700"
          onclick={createSession}
          disabled={creating}><UsersRound /> {creating ? "Starting..." : "Start and invite"}</Button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  :global(.menu-item) {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 0.65rem;
    border-radius: 0.55rem;
    padding: 0.55rem 0.65rem;
    text-align: left;
  }
  :global(.menu-item:hover) {
    background: var(--accent);
  }
  :global(.menu-item svg) {
    width: 0.95rem;
    height: 0.95rem;
    color: var(--muted-foreground);
  }
  .toolbar-button {
    display: inline-flex;
    height: 2rem;
    align-items: center;
    gap: 0.35rem;
    border-radius: 0.45rem;
    padding: 0 0.55rem;
    font-size: 0.72rem;
    font-weight: 600;
  }
  .toolbar-button:hover {
    background: var(--accent);
  }
  .toolbar-button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
  .toolbar-button :global(svg) {
    width: 0.85rem;
    height: 0.85rem;
  }
  .outline-action {
    display: flex;
    width: 1.65rem;
    height: 1.65rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.4rem;
    color: var(--muted-foreground);
  }
  .outline-action:hover {
    background: var(--background);
    color: var(--foreground);
  }
  .outline-action:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .outline-action :global(svg) {
    width: 0.8rem;
    height: 0.8rem;
  }
  .document-page {
    min-height: 34rem;
    border: 1px solid color-mix(in oklab, var(--border) 85%, transparent);
    border-radius: 0.75rem;
    background: var(--background);
    padding: clamp(1.25rem, 4vw, 3.5rem);
    box-shadow:
      0 2px 4px rgb(15 23 42 / 0.04),
      0 16px 45px rgb(15 23 42 / 0.07);
  }
  .setting-field {
    display: grid;
    min-width: 0;
    gap: 0.35rem;
    color: var(--muted-foreground);
    font-size: 0.68rem;
    font-weight: 600;
  }
  .setting-field input {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    height: 2.25rem;
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--background);
    padding: 0 0.55rem;
    color: var(--foreground);
    font-size: 0.8rem;
    font-weight: 400;
  }
  @media (max-width: 640px) {
    .document-page {
      min-height: 28rem;
      border-radius: 0.65rem;
    }
  }
</style>
