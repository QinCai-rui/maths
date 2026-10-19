<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { DropdownMenu } from "bits-ui";
  import { toggleMode } from "mode-watcher";
  import { renderToString } from "katex";
  import { io, type Socket } from "socket.io-client";
  import { onMount, tick } from "svelte";
  import { toast } from "svelte-sonner";
  import { copyText } from "#lib/utils.js";
  import { QuestionSet } from "#lib/mathex/schemas.js";
  import { pdfOptionIssues, questionIssues } from "#lib/mathex/set-issues.js";
  import type {
    CollaborativeQuestionValue,
    CollaborativeSetClientToServerEvents,
    CollaborativeSetServerToClientEvents,
    CollaborativeSetSnapshot,
    ApplyClientHistoryTarget,
    CollaboratorPresence,
    DraftQuestionValue,
    QuestionLock
  } from "#lib/mathex/collaborative-set.schemas.js";
  import type { SetShareClientToServerEvents, SetShareServerToClientEvents } from "#lib/mathex/set-share.schemas.js";
  import QuestionSheet from "./QuestionSheet.svelte";
  import RichText from "./RichText.svelte";
  import ProofSlip from "./ProofSlip.svelte";
  import Modal from "./Modal.svelte";
  import {
    ArrowDown,
    ArrowUp,
    ChevronLeft,
    ChevronRight,
    CircleAlert,
    CircleCheck,
    Copy,
    Download,
    Eye,
    FileJson,
    FilePlus2,
    GripVertical,
    Link2,
    LockKeyhole,
    Moon,
    PanelLeft,
    Plus,
    Radio,
    Redo2,
    ScrollText,
    Send,
    Sun,
    Trash2,
    TriangleAlert,
    Undo2,
    Upload,
    UsersRound,
    WifiOff,
    X
  } from "@lucide/svelte/icons";

  interface Props {
    sessionToken?: string;
  }

  type HistoryEntry = {
    before: CollaborativeSetSnapshot;
    after: CollaborativeSetSnapshot;
    target: ApplyClientHistoryTarget;
    summary: string;
    status: "applied" | "undone";
  };

  const DRAFT_KEY = "mathex-draft";
  const ROOM_SET_KEY = "mathex-room-set";
  const MAX_QUESTIONS = 100;
  const QUESTION_SEND_DELAY_MS = 300;
  const SETTINGS_SEND_DELAY_MS = 600;
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
  const shareExpiries = [
    { value: 3_600_000, label: "1 hour" },
    { value: 21_600_000, label: "6 hours" },
    { value: 43_200_000, label: "12 hours" },
    { value: 86_400_000, label: "24 hours" }
  ] as const;

  let { sessionToken }: Props = $props();

  // ── Document state ────────────────────────────────────────────────────────
  let socket = $state.raw<Socket<CollaborativeSetServerToClientEvents, CollaborativeSetClientToServerEvents> | null>(
    null
  );
  let questions = $state<CollaborativeQuestionValue[]>([]);
  let setName = $state("");
  let instructions = $state("");
  let pdfOptions = $state(defaultPdfOptions());
  let currentQuestionId = $state<string | null>(null);
  let coverOpen = $state(false);
  let currentQuestion = $derived(coverOpen ? null : questions.find(({ id }) => id === currentQuestionId) || null);
  let currentQuestionIndex = $derived(questions.findIndex(({ id }) => id === currentQuestionId));
  let loadedQuestionIds = $state<Record<string, boolean>>({});
  let questionHash = $state(typeof window === "undefined" ? "" : window.location.hash.slice(1));
  let currentQuestionLoaded = $derived(!!currentQuestion && (!sessionToken || loadedQuestionIds[currentQuestion.id]));

  // ── Live collaboration state ──────────────────────────────────────────────
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
  let draftLoadFailed = $state(false);
  let lastServerMetadata = "";
  let lastServerPdf = "";
  const lastQuestionSent = new Map<string, string>();
  const questionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const questionLoads = new Map<string, Promise<boolean>>();
  let allQuestionsLoad: Promise<boolean> | null = null;
  let settingsTimer: ReturnType<typeof setTimeout> | null = null;
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  let lockHeartbeat: ReturnType<typeof setInterval> | null = null;
  let activeQuestionCard = $state.raw<HTMLElement | null>(null);
  let closingSocket = false;

  // ── UI state ──────────────────────────────────────────────────────────────
  let root = $state<HTMLElement | null>(null);
  let contentsOpen = $state(false);
  let shareOpen = $state(false);
  let shareTab = $state<"live" | "copy">("live");
  let goLiveName = $state("");
  let creating = $state(false);
  let shareExpiryMs = $state<(typeof shareExpiries)[number]["value"]>(86_400_000);
  let shareUrl = $state("");
  let shareExpiresAt = $state<number | null>(null);
  let sharing = $state(false);
  let checksOpen = $state(false);
  let unloadedCount = $state(0);
  let pendingDeleteQuestion = $state<CollaborativeQuestionValue | null>(null);
  let confirmNewSet = $state(false);
  let confirmEndSession = $state(false);
  let dragId = $state<string | null>(null);
  let dropIndex = $state<number | null>(null);

  // ── History ───────────────────────────────────────────────────────────────
  let undoHistory = $state<HistoryEntry[]>([]);
  let historyTimer: ReturnType<typeof setTimeout> | null = null;
  let localBaseline: CollaborativeSetSnapshot | null = null;
  let liveTransaction: { before: CollaborativeSetSnapshot; target: ApplyClientHistoryTarget; summary: string } | null =
    null;
  let applyingLocalHistory = false;

  let isHost = $derived(hostSession);
  let canEditSet = $derived(!sessionToken || (isHost && sessionStatus === "active"));
  let canUndo = $derived(undoHistory.some((entry) => entry.status === "applied"));
  let canRedo = $derived(undoHistory.some((entry) => entry.status === "undone"));
  let historyAvailable = $derived(!sessionToken || connected);
  let lastUndo = $derived([...undoHistory].reverse().find((entry) => entry.status === "applied"));
  let nextRedo = $derived(undoHistory.find((entry) => entry.status === "undone"));
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

  // Svelte state proxies are not always structured-cloneable; documents are JSON by design.
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
        summary: `add question ${index + 1}`
      };
    }
    const removed = before.questions.find(({ id }) => !afterIds.includes(id));
    if (removed) {
      const index = before.questions.findIndex(({ id }) => id === removed.id);
      return {
        target: { type: "structure", action: "delete", questionId: removed.id } as ApplyClientHistoryTarget,
        summary: `delete question ${index + 1}`
      };
    }
    if (!sameValue(beforeIds, afterIds)) {
      const questionId = afterIds.find((id, index) => beforeIds[index] !== id) || afterIds[0];
      return {
        target: { type: "structure", action: "move", questionId } as ApplyClientHistoryTarget,
        summary: "reorder questions"
      };
    }
    const changed = after.questions.find((question, index) => !sameValue(question, before.questions[index]));
    if (changed) {
      const index = after.questions.findIndex(({ id }) => id === changed.id);
      return {
        target: { type: "question", questionId: changed.id } as ApplyClientHistoryTarget,
        summary: `edit question ${index + 1}`
      };
    }
    return { target: { type: "details" } as ApplyClientHistoryTarget, summary: "edit cover and settings" };
  }

  function flushHistory() {
    if (sessionToken) return;
    const baseline = localBaseline;
    if (applyingLocalHistory || !baseline) return;
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = null;
    const after = editorSnapshot();
    if (sameValue(baseline, after)) return;
    const change = localChange(baseline, after);
    undoHistory = [
      ...undoHistory.filter((entry) => entry.status !== "undone"),
      { summary: change.summary, before: baseline, after, target: change.target, status: "applied" as const }
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
    liveTransaction = { before: editorSnapshot(), target, summary };
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
  }

  function applySnapshot(snapshot: CollaborativeSetSnapshot) {
    applyingLocalHistory = true;
    setName = snapshot.name;
    instructions = snapshot.instructions;
    questions = cloneDocument(snapshot.questions);
    pdfOptions = cloneDocument(snapshot.pdfOptions);
    if (!currentQuestionId || !questions.some(({ id }) => id === currentQuestionId)) {
      currentQuestionId = questions[0]?.id || null;
    }
    if (!sessionToken) {
      localBaseline = editorSnapshot();
      localSaved = false;
      if (localTimer) clearTimeout(localTimer);
      localTimer = setTimeout(saveLocalDraft, 500);
    }
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

  function loadSource(source: any) {
    setName = typeof source.name === "string" ? source.name.slice(0, 120) : "";
    instructions = typeof source.instructions === "string" ? source.instructions : "";
    questions = Array.isArray(source.questions)
      ? source.questions.slice(0, MAX_QUESTIONS).map((question: any) => withId(normalizeQuestion(question)))
      : [];
    pdfOptions = { ...defaultPdfOptions(), ...(source.pdfOptions || {}) };
    currentQuestionId = questions[0]?.id || null;
    coverOpen = questions.length === 0;
  }

  function loadLocalDraft() {
    try {
      const parsed = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (parsed !== null && typeof parsed !== "object") throw new Error("Invalid draft");
      loadSource(Array.isArray(parsed) ? { questions: parsed } : parsed || {});
    } catch {
      draftLoadFailed = true;
      toast.error("The local draft could not be loaded");
    }
  }

  function saveLocalDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(plainSet()));
      localSaved = true;
    } catch {
      toast.error("The draft could not be saved in this browser. It may be too large.");
    }
  }

  function applyServerState(state: CollaborativeSetSnapshot) {
    const localQuestions = new Map(questions.map((question) => [question.id, question]));
    const pendingMetadata = joined && isHost && JSON.stringify({ name: setName, instructions }) !== lastServerMetadata;
    const pendingPdf = joined && isHost && JSON.stringify(pdfOptions) !== lastServerPdf;
    if (!pendingMetadata) {
      setName = state.name;
      instructions = state.instructions;
    }
    // Removed IDs must stop being "loaded". Undo may restore the same ID later, at which
    // point a peer must fetch its contents rather than trust an empty structure summary.
    const presentIds = new Set(state.questions.map(({ id }) => id));
    loadedQuestionIds = Object.fromEntries(Object.entries(loadedQuestionIds).filter(([id]) => presentIds.has(id)));
    questions = state.questions.map((question) => {
      if (ownedLocks[question.id] || loadedQuestionIds[question.id]) return localQuestions.get(question.id) || question;
      return question;
    });
    if (!pendingPdf) pdfOptions = state.pdfOptions;
    sessionStatus = state.status;
    lastServerMetadata = JSON.stringify({ name: state.name, instructions: state.instructions });
    lastServerPdf = JSON.stringify(state.pdfOptions);
    let selectId: string | null = null;
    if (liveTransaction?.target.type === "structure") {
      if (liveTransaction.target.action === "add" || liveTransaction.target.action === "duplicate") {
        const before = liveTransaction.before.questions;
        const added = questions.find(({ id }) => !before.some((question) => question.id === id));
        if (added) {
          liveTransaction.target.questionId = added.id;
          selectId = added.id;
        }
      }
      if (selectId) void loadQuestion(selectId).then(() => commitLiveTransaction());
      else commitLiveTransaction();
    }
    currentQuestionId = questionIdFromUrl();
    // Join loads the set in one request. Later structure events only need newly added questions.
    if (joined) {
      for (const question of questions) if (!loadedQuestionIds[question.id]) void loadQuestion(question.id);
    }
    if (selectId) selectQuestion(selectId);
  }

  function loadQuestion(questionId: string): Promise<boolean> {
    if (!questionId || !sessionToken || !socket) return Promise.resolve(false);
    if (loadedQuestionIds[questionId]) return Promise.resolve(true);
    const existing = questionLoads.get(questionId);
    if (existing) return existing;
    const load = new Promise<boolean>((resolve) => {
      socket?.timeout(8_000).emit("getQuestion", { questionId }, (error, result) => {
        questionLoads.delete(questionId);
        if (error || !result?.ok) {
          resolve(false);
          return;
        }
        const index = questions.findIndex(({ id }) => id === questionId);
        if (index >= 0 && !ownedLocks[questionId]) questions[index] = result.question;
        loadedQuestionIds = { ...loadedQuestionIds, [questionId]: true };
        lastQuestionSent.set(questionId, JSON.stringify(plainQuestion(result.question)));
        resolve(true);
      });
    });
    questionLoads.set(questionId, load);
    return load;
  }

  /** Loads every question in one round trip. Structural edits and exports need full content. */
  function loadAllQuestions(): Promise<boolean> {
    if (!sessionToken) return Promise.resolve(true);
    if (questions.every(({ id }) => loadedQuestionIds[id])) return Promise.resolve(true);
    if (allQuestionsLoad) return allQuestionsLoad;
    allQuestionsLoad = new Promise<boolean>((resolve) => {
      if (!socket) return resolve(false);
      socket.timeout(8_000).emit("getQuestions", (error, result) => {
        allQuestionsLoad = null;
        if (error) {
          toast.error("The live set could not be loaded. Check your connection and try again.");
          resolve(false);
          return;
        }
        if (!result.ok) {
          toast.error(result.error);
          resolve(false);
          return;
        }
        const fetched = new Map(result.questions.map((question) => [question.id, question]));
        questions = questions.map((question) =>
          ownedLocks[question.id] ? question : fetched.get(question.id) || question
        );
        const loaded = { ...loadedQuestionIds };
        for (const question of result.questions) {
          loaded[question.id] = true;
          if (!ownedLocks[question.id]) lastQuestionSent.set(question.id, JSON.stringify(plainQuestion(question)));
        }
        loadedQuestionIds = loaded;
        resolve(questions.every(({ id }) => loaded[id]));
      });
    });
    return allQuestionsLoad;
  }

  function questionIdFromUrl(): string | null {
    const questionId = sessionToken ? questionHash : null;
    if (questionId && questions.some(({ id }) => id === questionId)) return questionId;
    if (currentQuestionId && questions.some(({ id }) => id === currentQuestionId)) return currentQuestionId;
    return questions[0]?.id || null;
  }

  function updateQuestionUrl(questionId: string) {
    if (!sessionToken || questionHash === questionId) return;
    const url = new URL(window.location.href);
    url.hash = questionId;
    goto(url, { shallow: true, state: page.state });
    questionHash = questionId;
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
        collaborators = result.state.collaborators;
        locks = result.state.locks;
        hostSession = result.state.collaborators.some(
          (collaborator) => collaborator.connectionId === socket?.id && collaborator.isHost
        );
        if (reconnecting) loadedQuestionIds = {};
        applyServerState(result.state.set);
        coverOpen = questions.length === 0;
        void loadAllQuestions();
        joined = true;
        ready = true;
        if (reconnecting) toast.success("Reconnected to the live editor");
      }
    );
  }

  onMount(() => {
    const syncQuestionHash = () => (questionHash = window.location.hash.slice(1));
    syncQuestionHash();
    window.addEventListener("hashchange", syncQuestionHash);
    window.addEventListener("popstate", syncQuestionHash);

    if (sessionToken) {
      socket = io("/set-collaboration", {
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 10_000
      });
      socket.on("connect", () => {
        const shouldRejoin = joined && !!displayName && !deleted;
        connected = true;
        if (shouldRejoin) joinSession(true);
      });
      socket.on("disconnect", () => {
        connected = false;
        ownedLocks = {};
        locks = [];
        collaborators = [];
        acquiringQuestionId = null;
        if (joined && !deleted && !closingSocket) toast.warning("Disconnected from the live editor. Reconnecting…");
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
      });
      socket.on("sessionDeleted", () => {
        deleted = true;
        joined = false;
      });
      displayName = localStorage.getItem(`mathex-collab-name:${sessionToken}`) || "";
      if (displayName) joinSession();
    } else {
      loadLocalDraft();
      localBaseline = editorSnapshot();
      ready = true;
    }

    const isOutsideEditorControl = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest(
        ".ML__keyboard, .ML__virtual-keyboard-toggle, .ML__menu, [data-dialog-content], [data-menu-content]"
      );
    const releaseOnOutsidePointer = (event: PointerEvent) => {
      if (!currentQuestionId || !activeQuestionCard || !ownedLocks[currentQuestionId]) return;
      if (isOutsideEditorControl(event.target)) return;
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
      if (settingsTimer) clearTimeout(settingsTimer);
      for (const timer of questionTimers.values()) clearTimeout(timer);
      if (localTimer) {
        clearTimeout(localTimer);
        if (!sessionToken && !localSaved) saveLocalDraft();
      }
      window.removeEventListener("hashchange", syncQuestionHash);
      window.removeEventListener("popstate", syncQuestionHash);
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
    if (!ready || applyingLocalHistory || draftLoadFailed) return;
    if (!sessionToken) {
      localSaved = false;
      if (localTimer) clearTimeout(localTimer);
      localTimer = setTimeout(saveLocalDraft, 500);
      scheduleHistory();
      return;
    }
    if (!joined || !isHost) return;
    const metadata = JSON.stringify({ name: setName, instructions });
    const pdf = JSON.stringify(pdfOptions);
    if (metadata === lastServerMetadata && pdf === lastServerPdf) return;
    beginLiveTransaction({ type: "details" }, "edit cover and settings");
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(flushSettings, SETTINGS_SEND_DELAY_MS);
    serialized;
  });

  function flushSettings() {
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = null;
    if (!sessionToken || !joined || !isHost || !connected) return;
    const metadata = JSON.stringify({ name: setName, instructions });
    const pdf = JSON.stringify(pdfOptions);
    if (metadata !== lastServerMetadata) {
      lastServerMetadata = metadata;
      socket?.emit("updateMetadata", { name: setName, instructions }, handleOperation);
    }
    if (pdf !== lastServerPdf) {
      lastServerPdf = pdf;
      socket?.emit("updatePdfOptions", { pdfOptions: cloneDocument(pdfOptions) }, handleOperation);
    }
    if (liveTransaction?.target.type === "details") commitLiveTransaction();
  }

  function finishLiveEdit() {
    if (currentQuestionId && ownedLocks[currentQuestionId]) releaseQuestion(currentQuestionId);
    flushSettings();
  }

  $effect(() => {
    if (!sessionToken || !joined) return;
    const questionId = questionHash && questions.some(({ id }) => id === questionHash) ? questionHash : null;
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
      setTimeout(() => sendQuestion(questionId), QUESTION_SEND_DELAY_MS)
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
      if (!result.ok) {
        lastQuestionSent.delete(questionId);
        toast.error(result.error);
      }
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
      beginLiveTransaction({ type: "question", questionId }, `edit question ${index + 1}`);
    });
  }

  function selectQuestion(questionId: string, updateUrl = true) {
    if (currentQuestionId && currentQuestionId !== questionId && ownedLocks[currentQuestionId]) {
      releaseQuestion(currentQuestionId);
    }
    coverOpen = false;
    currentQuestionId = questionId;
    if (updateUrl) updateQuestionUrl(questionId);
    void loadQuestion(questionId);
    contentsOpen = false;
  }

  function openCover() {
    if (currentQuestionId && ownedLocks[currentQuestionId]) releaseQuestion(currentQuestionId);
    coverOpen = true;
    contentsOpen = false;
  }

  async function addQuestion() {
    if (questions.length >= MAX_QUESTIONS) return toast.error(`A set can contain at most ${MAX_QUESTIONS} questions`);
    const after = coverOpen ? (questions.at(-1)?.id ?? null) : currentQuestionId;
    if (sessionToken) {
      finishLiveEdit();
      if (!(await loadAllQuestions())) return;
      beginLiveTransaction(
        { type: "structure", action: "add", questionId: after || "00000000-0000-4000-8000-000000000000" },
        "add question"
      );
      socket?.emit("addQuestion", { afterQuestionId: after }, handleStructuralOperation);
      return;
    }
    const question = withId(emptyQuestion());
    const index = after ? questions.findIndex(({ id }) => id === after) + 1 : questions.length;
    questions.splice(index, 0, question);
    selectQuestion(question.id);
  }

  async function duplicateQuestion(question: CollaborativeQuestionValue) {
    if (questions.length >= MAX_QUESTIONS) return toast.error(`A set can contain at most ${MAX_QUESTIONS} questions`);
    if (sessionToken) {
      finishLiveEdit();
      if (!(await loadAllQuestions())) return;
      beginLiveTransaction({ type: "structure", action: "duplicate", questionId: question.id }, "duplicate question");
      socket?.emit("duplicateQuestion", { questionId: question.id }, handleStructuralOperation);
      return;
    }
    const copy = { ...cloneDocument(question), id: crypto.randomUUID() };
    questions.splice(questions.findIndex(({ id }) => id === question.id) + 1, 0, copy);
    selectQuestion(copy.id);
  }

  async function moveQuestionTo(question: CollaborativeQuestionValue, toIndex: number) {
    const index = questions.findIndex(({ id }) => id === question.id);
    if (index < 0 || toIndex < 0 || toIndex >= questions.length || toIndex === index) return;
    if (sessionToken) {
      finishLiveEdit();
      if (!(await loadAllQuestions())) return;
      beginLiveTransaction({ type: "structure", action: "move", questionId: question.id }, "move question");
      socket?.emit("moveQuestion", { questionId: question.id, toIndex }, handleStructuralOperation);
      return;
    }
    const [moved] = questions.splice(index, 1);
    questions.splice(toIndex, 0, moved);
  }

  async function confirmDeleteQuestion() {
    const question = pendingDeleteQuestion;
    if (!question) return;
    pendingDeleteQuestion = null;
    if (sessionToken) {
      finishLiveEdit();
      if (!(await loadAllQuestions())) return;
      beginLiveTransaction({ type: "structure", action: "delete", questionId: question.id }, "delete question");
      socket?.emit("deleteQuestion", { questionId: question.id }, handleStructuralOperation);
      return;
    }
    const index = questions.findIndex(({ id }) => id === question.id);
    questions.splice(index, 1);
    if (currentQuestionId === question.id) {
      currentQuestionId = questions[Math.min(index, questions.length - 1)]?.id || null;
      if (!currentQuestionId) coverOpen = true;
    }
    toast.success(`Question ${index + 1} deleted`, {
      action: { label: "Undo", onClick: () => undo() }
    });
  }

  function step(entry: HistoryEntry, direction: "undo" | "redo") {
    const from = direction === "undo" ? entry.after : entry.before;
    const to = direction === "undo" ? entry.before : entry.after;
    const done = direction === "undo" ? ("undone" as const) : ("applied" as const);
    const revert = direction === "undo" ? ("applied" as const) : ("undone" as const);
    const entryIndex = undoHistory.indexOf(entry);
    const mark = (status: HistoryEntry["status"]) =>
      (undoHistory = undoHistory.map((candidate, index) =>
        index === entryIndex ? { ...candidate, status } : candidate
      ));
    if (!sessionToken) {
      applySnapshot(to);
      mark(done);
      return;
    }
    const rollback = editorSnapshot();
    // Apply only the history target. Other co-authors may have edited unrelated sections.
    const next = editorSnapshot();
    if (entry.target.type === "details") {
      next.name = to.name;
      next.instructions = to.instructions;
      next.pdfOptions = cloneDocument(to.pdfOptions);
    } else if (entry.target.type === "question") {
      const questionId = entry.target.questionId;
      const restored = to.questions.find(({ id }) => id === questionId);
      if (restored)
        next.questions = next.questions.map((question) =>
          question.id === restored.id ? cloneDocument(restored) : question
        );
    } else {
      const current = new Map(next.questions.map((question) => [question.id, question]));
      next.questions = to.questions.map((question) => current.get(question.id) || cloneDocument(question));
    }
    questions = cloneDocument(next.questions);
    applySnapshot(next);
    mark(done);
    socket?.emit(
      "applyClientHistory",
      {
        target: entry.target,
        expected: historyTargetSnapshot(from, entry.target),
        desired: historyTargetSnapshot(to, entry.target)
      },
      (result) => {
        if (!result.ok) {
          applySnapshot(rollback);
          mark(revert);
          return toast.error(result.error);
        }
        liveTransaction = null;
      }
    );
  }

  function historyTargetSnapshot(snapshot: CollaborativeSetSnapshot, target: ApplyClientHistoryTarget) {
    // The server compares only the history target. Keep other questions as ID-only summaries
    // so undo never uploads every image in the set twice to a small-board server.
    return {
      ...snapshot,
      instructions: target.type === "details" ? snapshot.instructions : "",
      questions:
        target.type === "details"
          ? []
          : target.type === "question"
            ? snapshot.questions.filter(({ id }) => id === target.questionId)
            : snapshot.questions.map((question) =>
                question.id === target.questionId ? question : { id: question.id, ...emptyQuestion() }
              )
    };
  }

  function undo() {
    flushHistory();
    if (sessionToken) finishLiveEdit();
    const entry = [...undoHistory].reverse().find((candidate) => candidate.status === "applied");
    if (entry) step(entry, "undo");
  }

  function redo() {
    flushHistory();
    if (sessionToken) finishLiveEdit();
    const entry = undoHistory.find((candidate) => candidate.status === "undone");
    if (entry) step(entry, "redo");
  }

  // ── Sharing ───────────────────────────────────────────────────────────────
  function openShare(tab: "live" | "copy" = "live") {
    shareTab = tab;
    shareUrl = "";
    shareExpiresAt = null;
    shareOpen = true;
  }

  function createSession() {
    const name = goLiveName.trim();
    if (name.length < 1 || name.length > 20) return toast.error("Enter a name between 1 and 20 characters");
    creating = true;
    const collab: Socket<CollaborativeSetServerToClientEvents, CollaborativeSetClientToServerEvents> =
      io("/set-collaboration");
    collab.emit("createSession", { set: plainSet() }, (result) => {
      collab.disconnect();
      creating = false;
      if (!result.ok) return toast.error(result.error);
      localStorage.setItem(`mathex-collab-host:${result.sessionToken}`, result.hostToken);
      localStorage.setItem(`mathex-collab-name:${result.sessionToken}`, name);
      shareOpen = false;
      goto(`/mathex/app/create/editor/${result.sessionToken}`);
    });
  }

  async function createShareLink() {
    const set = await validatedSet("share");
    if (!set) return;
    if (set.questions.length === 0) return toast.error("Add at least one question before sharing");
    sharing = true;
    const shareSocket: Socket<SetShareServerToClientEvents, SetShareClientToServerEvents> = io("/set-share");
    shareSocket.emit("createShare", { set, expiresInMs: shareExpiryMs }, (result) => {
      shareSocket.disconnect();
      sharing = false;
      if (!result.ok) return toast.error(result.error);
      shareExpiresAt = result.expiresAt;
      shareUrl = `${window.location.origin}/mathex/app/create/editor/share/${result.token}`;
    });
  }

  async function copy(text: string, what: string) {
    try {
      await copyText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error(`Could not copy the ${what.toLowerCase()}`);
    }
  }

  // ── Import / export ───────────────────────────────────────────────────────
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
        if (!Array.isArray(source.questions) || source.questions.length > MAX_QUESTIONS) throw new Error();
        flushHistory();
        loadSource(source);
        draftLoadFailed = false;
        toast.success(`Imported ${questions.length} questions`, { action: { label: "Undo", onClick: () => undo() } });
      } catch {
        toast.error("This file is not a Mathex set");
      }
    };
    input.click();
  }

  function newBlankSet() {
    flushHistory();
    loadSource({});
    draftLoadFailed = false;
    confirmNewSet = false;
    toast.success("Started a new set", { action: { label: "Undo", onClick: () => undo() } });
  }

  function fileBase() {
    return (
      setName
        .trim()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "") || "mathex-set"
    );
  }

  async function downloadJson() {
    if (!(await loadAllQuestions())) return;
    const contents = draftLoadFailed ? localStorage.getItem(DRAFT_KEY) || "" : JSON.stringify(plainSet(), null, 2);
    const blob = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = draftLoadFailed ? "mathex-draft-recovery.json" : `${fileBase()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function validatedSet(action = "export") {
    if (!(await loadAllQuestions())) {
      toast.error("Some questions could not be loaded. Try again in a moment.");
      return null;
    }
    const result = QuestionSet.safeParse(plainSet());
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue?.path[0] === "questions" ? ` in question ${Number(issue.path[1]) + 1}` : "";
      toast.error(`Fix this before you ${action}: ${issue?.message || "invalid content"}${where}`, {
        action: { label: "Open checks", onClick: () => openChecks() }
      });
      return null;
    }
    return result.data;
  }

  async function exportPdf(answers: boolean) {
    const set = await validatedSet();
    if (!set) return;
    const id = toast.loading(`Typesetting the ${answers ? "answer key" : "question slips"}…`);
    try {
      const print = await import("#lib/mathex/print.js");
      await (answers ? print.downloadAnswerSet(set) : print.downloadQuestionSet(set));
      toast.success("PDF downloaded", { id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the PDF", { id });
    }
  }

  async function previewPdf(answers: boolean) {
    const set = await validatedSet("preview");
    if (!set) return;
    const print = await import("#lib/mathex/print.js");
    if (!(answers ? print.previewAnswerSet(set) : print.previewQuestionSet(set)))
      toast.error("Allow pop-ups to open the print preview");
  }

  async function useInRoom() {
    const set = await validatedSet("use it in a room");
    if (!set) return;
    localStorage.setItem(ROOM_SET_KEY, JSON.stringify(set));
    const opened = window.open("/mathex/app/create", "_blank");
    if (opened) opened.opener = null;
    if (!opened) toast.error("Allow pop-ups to open the room creator, or open /mathex/app/create yourself");
  }

  function endSession() {
    confirmEndSession = false;
    socket?.emit("deleteSession", (result) => {
      if (!result.ok) return toast.error(result.error);
      localStorage.removeItem(`mathex-collab-host:${sessionToken}`);
      toast.success("Live session ended and its server copy deleted");
      goto("/mathex/app/create/editor");
    });
  }

  // ── Derived views ─────────────────────────────────────────────────────────
  function escapeHtml(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /** One-line preview of a question with its maths typeset, for the contents list. */
  function previewHtml(contents: string) {
    const flattened = contents
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<img\b[^>]*>/gi, " [image] ");
    const text = (new DOMParser().parseFromString(flattened, "text/html").body.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
    if (!text) return "";
    let html = "";
    let offset = 0;
    for (const match of text.matchAll(/\$\$(?:\[scale=[\d.]+\])?([\s\S]+?)\$\$/g)) {
      html += escapeHtml(text.slice(offset, match.index));
      html += renderToString(match[1], { throwOnError: false, output: "mathml" });
      offset = (match.index || 0) + match[0].length;
    }
    return html + escapeHtml(text.slice(offset));
  }

  let issuesById = $derived.by(() => {
    const result = new Map<string, { errors: string[]; warnings: string[]; all: string[] }>();
    for (const question of questions) {
      if (sessionToken && !loadedQuestionIds[question.id]) continue;
      const { errors, warnings } = questionIssues(question);
      if (errors.length || warnings.length)
        result.set(question.id, { errors, warnings, all: [...errors, ...warnings] });
    }
    return result;
  });
  let allIssues = $derived(
    questions.flatMap((question, index) => {
      const found = issuesById.get(question.id);
      return found ? [{ id: question.id, number: index + 1, ...found }] : [];
    })
  );
  let printIssues = $derived(pdfOptionIssues(pdfOptions));
  let errorTotal = $derived(allIssues.filter((entry) => entry.errors.length).length + (printIssues.length ? 1 : 0));
  let issueTotal = $derived(allIssues.length + (printIssues.length ? 1 : 0));
  let currentIssues = $derived(currentQuestion ? issuesById.get(currentQuestion.id) : undefined);
  let othersHere = $derived(collaborators.filter((collaborator) => collaborator.connectionId !== socket?.id));

  async function openChecks() {
    const complete = await loadAllQuestions();
    unloadedCount = complete ? 0 : questions.filter(({ id }) => !!sessionToken && !loadedQuestionIds[id]).length;
    checksOpen = true;
  }

  function jumpToQuestion(questionId: string) {
    checksOpen = false;
    selectQuestion(questionId);
  }

  function initials(name: string) {
    return name.trim().slice(0, 1).toUpperCase() || "?";
  }

  // Stable, distinct colours for collaborator markers. They must read on light and dark surfaces.
  const personColours = ["#1f6b57", "#b0472e", "#8b5f04", "#3d5a80", "#6b4c8a", "#2f7a7a"];
  function colourFor(connectionId: string) {
    let hash = 0;
    for (const character of connectionId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
    return personColours[Math.abs(hash) % personColours.length];
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  function anyModalOpen() {
    return checksOpen || shareOpen || !!pendingDeleteQuestion || confirmNewSet || confirmEndSession;
  }

  function onShortcut(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || anyModalOpen()) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (event.altKey && !mod && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const offset = event.key === "ArrowDown" ? 1 : -1;
      event.preventDefault();
      if (coverOpen) {
        if (offset > 0 && questions[0]) selectQuestion(questions[0].id);
      } else if (currentQuestionIndex + offset < 0) openCover();
      else if (questions[currentQuestionIndex + offset]) selectQuestion(questions[currentQuestionIndex + offset].id);
      return;
    }
    if (event.altKey && !mod && key === "n" && canEditSet) {
      event.preventDefault();
      void addQuestion();
      return;
    }
    const inControl = event
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLElement &&
          (node.isContentEditable ||
            /^(INPUT|TEXTAREA|SELECT|MATH-FIELD)$/.test(node.tagName) ||
            node.getAttribute("role") === "combobox" ||
            node.getAttribute("role") === "listbox")
      );
    if (inControl) return;
    if (mod && !event.altKey && (key === "z" || key === "y")) {
      event.preventDefault();
      if (!historyAvailable) return;
      if (key === "y" || event.shiftKey) {
        if (canRedo) redo();
      } else if (canUndo) undo();
    }
  }

  // ── Contents drag and drop ────────────────────────────────────────────────
  function onDragStart(event: DragEvent, question: CollaborativeQuestionValue) {
    if (!canEditSet || lockedByOther(question.id)) return event.preventDefault();
    dragId = question.id;
    event.dataTransfer?.setData("text/plain", question.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(event: DragEvent, index: number) {
    if (!dragId) return;
    event.preventDefault();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropIndex = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    const question = questions.find(({ id }) => id === dragId);
    const from = questions.findIndex(({ id }) => id === dragId);
    if (question && dropIndex !== null) {
      const to = dropIndex > from ? dropIndex - 1 : dropIndex;
      void moveQuestionTo(question, to);
    }
    dragId = null;
    dropIndex = null;
  }

  let isDesktop = $state(true);
  $effect(() => {
    const query = matchMedia("(min-width: 1024px)");
    const update = () => (isDesktop = query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });

  let mainScroller = $state<HTMLElement | null>(null);
  $effect(() => {
    coverOpen;
    currentQuestionId;
    tick().then(() => mainScroller?.scrollTo({ top: 0 }));
  });
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (!sessionToken && !localSaved) event.preventDefault();
  }}
  onkeydown={onShortcut}
/>

{#snippet themeButton()}
  <button
    type="button"
    class="mx-icon"
    onclick={toggleMode}
    title="Toggle light or dark"
    aria-label="Toggle light or dark"
  >
    <Sun class="block dark:hidden" /><Moon class="hidden dark:block" />
  </button>
{/snippet}

{#if sessionToken && !joined}
  <div class="mathex-editor mx-gate" bind:this={root}>
    <div class="mx-gate-card">
      <a class="mx-brand" href="/mathex/app/create/editor"><span class="mark">∑</span> Mathex</a>
      {#if deleted}
        <h1>This live set has ended</h1>
        <p class="lede">The host deleted the server copy. Drafts saved in your browser are unchanged.</p>
        <a class="mx-btn primary" href="/mathex/app/create/editor">Open your own editor</a>
      {:else}
        <h1>Join live set</h1>
        <p class="lede">Others see your name on the question you are editing.</p>
        <form onsubmit={(event) => (event.preventDefault(), joinSession())}>
          <label class="mx-field">
            <span>Your name</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              bind:value={displayName}
              maxlength="20"
              placeholder="e.g. Ms Rangi"
              autofocus
              autocomplete="nickname"
            />
          </label>
          <button class="mx-btn primary wide" type="submit" disabled={joining || !displayName.trim()}>
            {joining ? "Joining…" : "Join"}
          </button>
        </form>
      {/if}
    </div>
    <div class="mx-gate-theme">{@render themeButton()}</div>
  </div>
{:else}
  <div class="mathex-editor mx-shell" bind:this={root}>
    <!-- Masthead -->
    <header class="mx-masthead">
      <button
        type="button"
        class="mx-icon narrow-only"
        onclick={() => (contentsOpen = !contentsOpen)}
        aria-label="Contents"
        aria-expanded={contentsOpen}><PanelLeft /></button
      >
      <a class="mx-brand" href="/mathex/app/create" title="Back to Mathex"
        ><span class="mark">∑</span><span class="hidden sm:inline">Mathex</span></a
      >
      <span class="mx-rule" aria-hidden="true"></span>
      <div class="mx-title">
        {#if !coverOpen}
          <input
            bind:value={setName}
            maxlength="120"
            placeholder="Untitled set"
            disabled={!canEditSet}
            aria-label="Set title"
          />
        {/if}
        <div class="mx-status">
          {#if sessionToken}
            {#if connected}
              <span class="live"><i></i>Live</span>
              <span>{isHost ? "Host" : "Co-author"}</span>
              {#if sessionStatus === "ended"}<span class="warn">Read only</span>{/if}
            {:else}
              <span class="warn"><WifiOff class="size-3" /> Reconnecting…</span>
            {/if}
          {:else}
            <span title="Saved in this browser">{localSaved ? "Saved" : "Saving…"}</span>
          {/if}
        </div>
      </div>

      <div class="mx-actions">
        <div class="mx-history">
          <button
            type="button"
            class="mx-icon"
            onclick={undo}
            disabled={!canUndo || !historyAvailable}
            title={lastUndo ? `Undo ${lastUndo.summary} (Ctrl+Z)` : "Nothing to undo"}
            aria-label="Undo"><Undo2 /></button
          >
          <button
            type="button"
            class="mx-icon"
            onclick={redo}
            disabled={!canRedo || !historyAvailable}
            title={nextRedo ? `Redo ${nextRedo.summary} (Ctrl+Shift+Z)` : "Nothing to redo"}
            aria-label="Redo"><Redo2 /></button
          >
        </div>

        <button
          type="button"
          class="mx-check"
          class:bad={errorTotal > 0}
          class:warn={errorTotal === 0 && issueTotal > 0}
          onclick={openChecks}
          title="Check the set for problems"
        >
          {#if issueTotal === 0}<CircleCheck />{:else if errorTotal}<CircleAlert />{:else}<TriangleAlert />{/if}
          <span class="hidden md:inline">{issueTotal === 0 ? "No issues" : `${issueTotal} to review`}</span>
          {#if issueTotal}<span class="md:hidden">{issueTotal}</span>{/if}
        </button>

        {#if sessionToken && othersHere.length}
          <div class="mx-faces" aria-label="{othersHere.length} other people here">
            {#each othersHere.slice(0, 4) as person (person.connectionId)}
              <span
                style:background={colourFor(person.connectionId)}
                title={person.displayName + (person.isHost ? " · host" : "")}>{initials(person.displayName)}</span
              >
            {/each}
            {#if othersHere.length > 4}<span class="more">+{othersHere.length - 4}</span>{/if}
          </div>
        {/if}

        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="mx-btn">
            <Download class="size-4" /><span class="hidden sm:inline">Export</span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal to={root || "body"}>
            <DropdownMenu.Content class="mx-menu" align="end" sideOffset={6}>
              <DropdownMenu.Group>
                <DropdownMenu.GroupHeading class="mx-menu-heading">Print</DropdownMenu.GroupHeading>
                <DropdownMenu.Item class="mx-menu-item" onSelect={() => previewPdf(false)}
                  ><Eye /> Preview question slips</DropdownMenu.Item
                >
                <DropdownMenu.Item class="mx-menu-item" onSelect={() => previewPdf(true)}
                  ><Eye /> Preview answer key</DropdownMenu.Item
                >
                <DropdownMenu.Item class="mx-menu-item" onSelect={() => exportPdf(false)}
                  ><ScrollText /> Question slips PDF</DropdownMenu.Item
                >
                <DropdownMenu.Item class="mx-menu-item" onSelect={() => exportPdf(true)}
                  ><ScrollText /> Answer key PDF</DropdownMenu.Item
                >
              </DropdownMenu.Group>
              <DropdownMenu.Separator class="mx-menu-sep" />
              <DropdownMenu.Group>
                <DropdownMenu.GroupHeading class="mx-menu-heading">File</DropdownMenu.GroupHeading>
                <DropdownMenu.Item class="mx-menu-item" onSelect={downloadJson}
                  ><FileJson /> Download as JSON</DropdownMenu.Item
                >
                {#if !sessionToken}
                  <DropdownMenu.Item class="mx-menu-item" onSelect={importFile}
                    ><Upload /> Import JSON…</DropdownMenu.Item
                  >
                {/if}
                <DropdownMenu.Item class="mx-menu-item" onSelect={useInRoom}
                  ><UsersRound /> Use in a room</DropdownMenu.Item
                >
                {#if !sessionToken}
                  <DropdownMenu.Item class="mx-menu-item" onSelect={() => (confirmNewSet = true)}
                    ><FilePlus2 /> New blank set…</DropdownMenu.Item
                  >
                {/if}
              </DropdownMenu.Group>
              {#if sessionToken && isHost}
                <DropdownMenu.Separator class="mx-menu-sep" />
                <DropdownMenu.Item class="mx-menu-item danger" onSelect={() => (confirmEndSession = true)}
                  ><Trash2 /> End live session…</DropdownMenu.Item
                >
              {/if}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <button type="button" class="mx-btn primary" onclick={() => openShare("live")}>
          {#if sessionToken}<Link2 class="size-4" /><span class="hidden sm:inline">Invite</span>{:else}<Send
              class="size-4"
            /><span class="hidden sm:inline">Share</span>{/if}
        </button>
        <span class="mx-theme-slot">{@render themeButton()}</span>
      </div>
    </header>

    <div class="mx-body">
      <!-- Contents -->
      <aside class="mx-contents" class:open={contentsOpen} inert={!isDesktop && !contentsOpen} aria-label="Contents">
        <div class="mx-contents-head">
          <span>Questions</span>
          <span class="count" title="{questions.length} of {MAX_QUESTIONS} allowed">{questions.length}</span>
          <button
            type="button"
            class="mx-icon narrow-only"
            onclick={() => (contentsOpen = false)}
            aria-label="Close contents"><X /></button
          >
        </div>
        <nav class="mx-toc">
          <button
            type="button"
            class="mx-toc-cover"
            class:current={coverOpen}
            onclick={openCover}
            aria-current={coverOpen ? "page" : undefined}
          >
            <span class="num"><ScrollText /></span>
            <span class="text"><strong>Cover &amp; print</strong></span>
            {#if printIssues.length}<i class="dot bad" title="Print settings need attention"></i>{/if}
          </button>
          <ol ondragleave={() => (dropIndex = null)}>
            {#each questions as question, index (question.id)}
              {@const lock = lockFor(question.id)}
              {@const issues = issuesById.get(question.id)}
              {@const current = !coverOpen && currentQuestionId === question.id}
              {@const preview = sessionToken && !loadedQuestionIds[question.id] ? null : previewHtml(question.contents)}
              <li
                class:current
                class:dragging={dragId === question.id}
                class:drop-before={dropIndex === index && dragId !== question.id}
                class:drop-after={dropIndex === index + 1 && index === questions.length - 1}
                draggable={canEditSet}
                ondragstart={(event) => onDragStart(event, question)}
                ondragover={(event) => onDragOver(event, index)}
                ondrop={onDrop}
                ondragend={() => ((dragId = null), (dropIndex = null))}
              >
                <button
                  type="button"
                  class="entry"
                  onclick={() => selectQuestion(question.id)}
                  aria-current={current ? "page" : undefined}
                >
                  <span class="num">{index + 1}</span>
                  <span class="text">
                    {#if preview === null}
                      <small class="muted">Loading…</small>
                    {:else if preview}
                      <span class="preview">{@html preview}</span>
                    {:else}
                      <span class="preview empty">Empty</span>
                    {/if}
                    {#if lock}
                      <small class="lock" style:--who={colourFor(lock.connectionId)}>
                        <LockKeyhole class="size-3" />{lock.connectionId === socket?.id ? "You" : lock.displayName}
                      </small>
                    {/if}
                  </span>
                  {#if issues}<i class="dot" class:bad={issues.errors.length} title={issues.all.join(" · ")}></i>{/if}
                </button>
                {#if canEditSet && current}
                  <div class="tools">
                    <span class="grip" title="Drag to reorder" aria-hidden="true"><GripVertical /></span>
                    <button
                      type="button"
                      onclick={() => moveQuestionTo(question, index - 1)}
                      disabled={index === 0 || lockedByOther(question.id)}
                      aria-label="Move up"
                      title="Move up"><ArrowUp /></button
                    >
                    <button
                      type="button"
                      onclick={() => moveQuestionTo(question, index + 1)}
                      disabled={index === questions.length - 1 || lockedByOther(question.id)}
                      aria-label="Move down"
                      title="Move down"><ArrowDown /></button
                    >
                    <button
                      type="button"
                      onclick={() => duplicateQuestion(question)}
                      disabled={questions.length >= MAX_QUESTIONS || lockedByOther(question.id)}
                      aria-label="Duplicate"
                      title="Duplicate"><Copy /></button
                    >
                    <button
                      type="button"
                      class="danger"
                      onclick={() => (pendingDeleteQuestion = question)}
                      disabled={lockedByOther(question.id)}
                      aria-label="Delete"
                      title="Delete"><Trash2 /></button
                    >
                  </div>
                {/if}
              </li>
            {/each}
          </ol>
          {#if canEditSet}
            <button type="button" class="mx-toc-add" onclick={addQuestion} disabled={questions.length >= MAX_QUESTIONS}>
              <Plus /> Add question <kbd>Alt N</kbd>
            </button>
          {/if}
          <div class="mx-mobile-tools">
            {@render themeButton()}
            <span>Theme</span>
            <button
              type="button"
              class="mx-icon"
              onclick={undo}
              disabled={!canUndo || !historyAvailable}
              title="Undo"
              aria-label="Undo"><Undo2 /></button
            >
            <button
              type="button"
              class="mx-icon"
              onclick={redo}
              disabled={!canRedo || !historyAvailable}
              title="Redo"
              aria-label="Redo"><Redo2 /></button
            >
          </div>
        </nav>
      </aside>
      {#if contentsOpen}<button
          type="button"
          class="mx-scrim lg:hidden"
          onclick={() => (contentsOpen = false)}
          aria-label="Close contents"
        ></button>{/if}

      <!-- Manuscript -->
      <main class="mx-desk" bind:this={mainScroller}>
        {#if draftLoadFailed}
          <div class="mx-banner warn">
            Your saved draft could not be read. It has not been overwritten. Import a backup from Export, or
            <button type="button" class="underline" onclick={() => (confirmNewSet = true)}>start a blank set</button>.
          </div>
        {/if}
        {#if sessionStatus === "ended"}
          <div class="mx-banner warn">This live session has ended. The set is read only.</div>
        {/if}

        {#if coverOpen}
          <article class="mx-sheet">
            <div class="mx-sheet-inner">
              <label class="mx-cover-title">
                <span class="mx-label">Title</span>
                <input bind:value={setName} maxlength="120" placeholder="Untitled set" disabled={!canEditSet} />
              </label>
              <section class="mx-cover-section">
                <h2 class="mx-section-head">Instructions</h2>
                <RichText
                  bind:html={instructions}
                  disabled={!canEditSet}
                  label="Cover instructions"
                  placeholder="e.g. Answer every question. Calculators are not allowed."
                />
              </section>
              <section class="mx-cover-section">
                <h2 class="mx-section-head">Print layout</h2>
                <div class="mx-print-grid">
                  <label class="mx-num"
                    ><span>Question text</span>
                    <div>
                      <input
                        type="number"
                        min="6"
                        max="18"
                        step="0.5"
                        bind:value={pdfOptions.questionTextSize}
                        disabled={!canEditSet}
                      /><em>pt</em>
                    </div></label
                  >
                  <label class="mx-num"
                    ><span>Answer key text</span>
                    <div>
                      <input
                        type="number"
                        min="6"
                        max="16"
                        step="0.5"
                        bind:value={pdfOptions.answerTextSize}
                        disabled={!canEditSet}
                      /><em>pt</em>
                    </div></label
                  >
                  <label class="mx-num"
                    ><span>Slip height</span>
                    <div>
                      <input
                        type="number"
                        min="1"
                        max="297"
                        step="0.5"
                        bind:value={pdfOptions.slipHeight}
                        disabled={!canEditSet}
                      /><em>mm</em>
                    </div></label
                  >
                  <label class="mx-num"
                    ><span>Largest image</span>
                    <div>
                      <input
                        type="number"
                        min="5"
                        max="35"
                        bind:value={pdfOptions.imageHeight}
                        disabled={!canEditSet}
                      /><em>mm</em>
                    </div></label
                  >
                  <label class="mx-num" title="Strip on the right of each slip that is trimmed away"
                    ><span>Cut-off strip</span>
                    <div>
                      <input
                        type="number"
                        min="0"
                        max="80"
                        bind:value={pdfOptions.cutMargin}
                        disabled={!canEditSet}
                      /><em>mm</em>
                    </div></label
                  >
                  <p class="mx-print-note">
                    {Math.max(1, Math.floor(297 / (pdfOptions.slipHeight || 297)))} slips per A4 page
                  </p>
                </div>
                {#if printIssues.length}<p class="mx-inline-error">{printIssues.join(" · ")}</p>{/if}
              </section>
            </div>
          </article>
          <div class="mx-pager">
            <span></span>
            {#if questions[0]}
              <button type="button" class="mx-btn" onclick={() => selectQuestion(questions[0].id)}
                >Question 1 <ChevronRight class="size-4" /></button
              >
            {:else if canEditSet}
              <button type="button" class="mx-btn primary" onclick={addQuestion}
                ><Plus class="size-4" /> Add the first question</button
              >
            {/if}
          </div>
        {:else if currentQuestion}
          {@const currentLock = lockFor(currentQuestion.id)}
          {@const hasOwnLock = !sessionToken || ownedLocks[currentQuestion.id]}
          {@const readOnly = sessionStatus !== "active" || !hasOwnLock}
          <article
            class="mx-sheet"
            class:locked={lockedByOther(currentQuestion.id)}
            style:--who={currentLock ? colourFor(currentLock.connectionId) : undefined}
            bind:this={activeQuestionCard}
            onfocusin={() => focusQuestion(currentQuestion!.id)}
          >
            <div class="mx-runninghead">
              <span class="mx-qno">Question {currentQuestionIndex + 1}<small>/ {questions.length}</small></span>
              {#if currentLock}
                <span class="who"
                  ><LockKeyhole class="size-3" />{currentLock.connectionId === socket?.id
                    ? "You are editing"
                    : `${currentLock.displayName} is editing`}</span
                >
              {/if}
            </div>
            <div class="mx-sheet-inner">
              {#if currentQuestionLoaded}
                {#key currentQuestion.id}
                  <QuestionSheet
                    bind:question={
                      () => questions[currentQuestionIndex],
                      (value) => {
                        const question = questions[currentQuestionIndex];
                        if (question) questions[currentQuestionIndex] = { ...value, id: question.id };
                      }
                    }
                    disabled={readOnly}
                  />
                {/key}
              {:else}
                <div class="mx-loading">Loading question…</div>
              {/if}
            </div>
            {#if sessionToken && connected && sessionStatus === "active" && !currentLock && !hasOwnLock && currentQuestionLoaded}
              <button
                type="button"
                class="mx-claim"
                onclick={() => focusQuestion(currentQuestion!.id)}
                disabled={acquiringQuestionId === currentQuestion.id}
              >
                <span>{acquiringQuestionId === currentQuestion.id ? "Reserving…" : "Click to edit"}</span>
              </button>
            {/if}
          </article>
          <div class="mx-pager">
            <button
              type="button"
              class="mx-btn"
              onclick={() =>
                currentQuestionIndex > 0 ? selectQuestion(questions[currentQuestionIndex - 1].id) : openCover()}
            >
              <ChevronLeft class="size-4" />
              {currentQuestionIndex > 0 ? `Question ${currentQuestionIndex}` : "Cover"}
            </button>
            {#if currentQuestionIndex < questions.length - 1}
              <button
                type="button"
                class="mx-btn"
                onclick={() => selectQuestion(questions[currentQuestionIndex + 1].id)}
                >Question {currentQuestionIndex + 2} <ChevronRight class="size-4" /></button
              >
            {:else if canEditSet}
              <button type="button" class="mx-btn" onclick={addQuestion} disabled={questions.length >= MAX_QUESTIONS}
                ><Plus class="size-4" /> New question</button
              >
            {:else}
              <span></span>
            {/if}
          </div>
        {/if}

        <!-- Galley proof at true print size, so authors see line breaks and overflow as printed. -->
        <details class="mx-proof-inline">
          <summary>Print proof</summary>
          {#if coverOpen}
            <ProofSlip
              html={instructions}
              label="Cover · {questions.length} question{questions.length === 1 ? '' : 's'}"
              title={setName}
              {pdfOptions}
            />
          {:else if currentQuestion}
            <ProofSlip html={currentQuestion.contents} label="Question {currentQuestionIndex + 1}" {pdfOptions} />
          {/if}
        </details>
      </main>

      <!-- Margin rail -->
      {#if sessionToken || currentIssues || (coverOpen && issueTotal > 0)}
        <aside class="mx-rail" aria-label="People and checks">
          {#if currentIssues || (coverOpen && issueTotal > 0)}
            <section>
              <h2 class="mx-rail-head">Checks</h2>
              {#if coverOpen}
                <button type="button" class="mx-rail-link" onclick={openChecks}
                  >{issueTotal} item{issueTotal === 1 ? "" : "s"} to review <ChevronRight class="size-3.5" /></button
                >
              {:else if currentIssues}
                <ul class="mx-issues">
                  {#each currentIssues.errors as message}
                    <li class="bad"><CircleAlert class="size-3.5" />{message}</li>
                  {/each}
                  {#each currentIssues.warnings as message}
                    <li><TriangleAlert class="size-3.5" />{message}</li>
                  {/each}
                </ul>
              {/if}
            </section>
          {/if}

          {#if sessionToken}
            <section>
              <h2 class="mx-rail-head">People <span>{collaborators.length}</span></h2>
              <ul class="mx-people">
                {#each collaborators as person (person.connectionId)}
                  {@const holding = locks.find((lock) => lock.connectionId === person.connectionId)}
                  {@const holdingIndex = holding ? questions.findIndex(({ id }) => id === holding.questionId) : -1}
                  <li>
                    <span class="face" style:background={colourFor(person.connectionId)}
                      >{initials(person.displayName)}</span
                    >
                    <span class="who">
                      <strong>{person.displayName}{person.connectionId === socket?.id ? " (you)" : ""}</strong>
                      {#if holding && holdingIndex >= 0}
                        <button type="button" onclick={() => selectQuestion(holding.questionId)}
                          >Editing Q{holdingIndex + 1}</button
                        >
                      {:else}
                        <small>{person.isHost ? "Host" : "Reading"}</small>
                      {/if}
                    </span>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}
        </aside>
      {/if}
    </div>
  </div>
{/if}

<!-- Share -->
<Modal bind:open={shareOpen} portal={root} title={sessionToken ? "Invite co-authors" : "Share this set"} wide>
  <div class="mx-tabs" role="tablist">
    <button
      type="button"
      role="tab"
      aria-selected={shareTab === "live"}
      class:on={shareTab === "live"}
      onclick={() => (shareTab = "live")}
    >
      <Radio class="size-4" />
      {sessionToken ? "Live link" : "Write together"}
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={shareTab === "copy"}
      class:on={shareTab === "copy"}
      onclick={() => ((shareTab = "copy"), (shareUrl = ""))}
    >
      <Send class="size-4" /> Send a copy
    </button>
  </div>
  {#if shareTab === "live"}
    {#if sessionToken}
      <p class="mx-modal-text">Anyone with this link can join. Only the host can add, move or delete questions.</p>
      <div class="mx-copy-row">
        <input
          readonly
          value={sessionUrl}
          aria-label="Live editor link"
          onfocus={(event) => event.currentTarget.select()}
        />
        <button type="button" class="mx-btn primary" onclick={() => copy(sessionUrl, "Link")}
          ><Copy class="size-4" /> Copy</button
        >
      </div>
    {:else}
      <p class="mx-modal-text">
        Edit with others in real time. A copy of this set is stored on the server and you become the host. Your browser
        draft is unchanged.
      </p>
      <form onsubmit={(event) => (event.preventDefault(), createSession())}>
        <label class="mx-field">
          <span>Your name</span>
          <input bind:value={goLiveName} maxlength="20" placeholder="e.g. Mr Chen" autocomplete="nickname" />
        </label>
        <button type="submit" class="mx-btn primary wide" disabled={creating || !goLiveName.trim()}>
          <Radio class="size-4" />
          {creating ? "Starting…" : "Start live session"}
        </button>
      </form>
    {/if}
  {:else}
    <p class="mx-modal-text">A snapshot link. Whoever opens it gets their own copy; later edits are not included.</p>
    {#if shareUrl}
      <div class="mx-copy-row">
        <input readonly value={shareUrl} aria-label="Copy link" onfocus={(event) => event.currentTarget.select()} />
        <button type="button" class="mx-btn primary" onclick={() => copy(shareUrl, "Link")}
          ><Copy class="size-4" /> Copy</button
        >
      </div>
      <p class="mx-modal-small">Expires {shareExpiresAt ? new Date(shareExpiresAt).toLocaleString() : "soon"}.</p>
    {:else}
      <div class="mx-expiry" role="radiogroup" aria-label="Link expires after">
        {#each shareExpiries as option}
          <button
            type="button"
            role="radio"
            aria-checked={shareExpiryMs === option.value}
            class:on={shareExpiryMs === option.value}
            onclick={() => (shareExpiryMs = option.value)}>{option.label}</button
          >
        {/each}
      </div>
      <button type="button" class="mx-btn primary wide" onclick={createShareLink} disabled={sharing}>
        <Link2 class="size-4" />
        {sharing ? "Creating link…" : "Create copy link"}
      </button>
    {/if}
  {/if}
</Modal>

<!-- Checks -->
<Modal
  bind:open={checksOpen}
  portal={root}
  title={issueTotal ? `${issueTotal} item${issueTotal === 1 ? "" : "s"} to review` : "Ready to print"}
  wide
>
  {#if unloadedCount > 0}
    <p class="mx-callout warn">{unloadedCount} questions could not be loaded, so they were not checked.</p>
  {/if}
  {#if printIssues.length}
    <button type="button" class="mx-check-item bad" onclick={() => ((checksOpen = false), openCover())}>
      <strong>Print layout</strong>
      <span>{printIssues.join(" · ")}</span>
    </button>
  {/if}
  {#if issueTotal === 0 && unloadedCount === 0}
    <p class="mx-modal-text">All {questions.length} questions have text and valid answers.</p>
  {:else if allIssues.length}
    <p class="mx-modal-text">Red items block export. Amber items are warnings.</p>
    <div class="mx-check-list">
      {#each allIssues as entry (entry.id)}
        <button
          type="button"
          class="mx-check-item"
          class:bad={entry.errors.length}
          onclick={() => jumpToQuestion(entry.id)}
        >
          <strong>Question {entry.number}</strong>
          <span>
            {#each entry.errors as message}<em class="bad">{message}</em>{/each}
            {#each entry.warnings as message}<em>{message}</em>{/each}
          </span>
        </button>
      {/each}
    </div>
  {/if}
</Modal>

<!-- Confirmations -->
<Modal
  open={!!pendingDeleteQuestion}
  onClose={() => (pendingDeleteQuestion = null)}
  portal={root}
  title="Delete question {questions.findIndex(({ id }) => id === pendingDeleteQuestion?.id) + 1}?"
  description="The question and its answers are removed from the set. You can undo this."
>
  {#snippet children()}{/snippet}
  {#snippet footer()}
    <button type="button" class="mx-btn" onclick={() => (pendingDeleteQuestion = null)}>Cancel</button>
    <button type="button" class="mx-btn danger" onclick={confirmDeleteQuestion}><Trash2 class="size-4" /> Delete</button
    >
  {/snippet}
</Modal>

<Modal
  bind:open={confirmNewSet}
  portal={root}
  title="Start a blank set?"
  description="This replaces the draft saved in this browser. Download it as JSON first if you want to keep a copy. You can undo this while the page is open."
>
  {#snippet children()}{/snippet}
  {#snippet footer()}
    <button type="button" class="mx-btn" onclick={downloadJson}><FileJson class="size-4" /> Download JSON</button>
    <button type="button" class="mx-btn danger" onclick={newBlankSet}>Start blank set</button>
  {/snippet}
</Modal>

<Modal
  bind:open={confirmEndSession}
  portal={root}
  title="End the session for everyone?"
  description="Everyone is disconnected and the server copy is deleted permanently. Download a JSON copy first if you want to keep this version."
>
  {#snippet children()}{/snippet}
  {#snippet footer()}
    <button type="button" class="mx-btn" onclick={downloadJson}><FileJson class="size-4" /> Download JSON</button>
    <button type="button" class="mx-btn danger" onclick={endSession}><Trash2 class="size-4" /> End and delete</button>
  {/snippet}
</Modal>

<style>
  /* ── Shell ─────────────────────────────────────────────────────────── */
  .mx-shell {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    overflow: hidden;
    background: var(--mx-bg);
    color: var(--mx-text);
  }
  .mx-masthead {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    height: 3.25rem;
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--mx-line);
    background: var(--mx-surface);
    flex: none;
  }
  .mx-brand {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--mx-text);
    font-size: 0.92rem;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
  }
  .mx-brand .mark {
    display: inline-grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 5px;
    background: var(--mx-text);
    color: var(--mx-surface);
    font-size: 0.95rem;
    line-height: 1;
  }
  .mx-rule {
    width: 1px;
    height: 1.4rem;
    background: var(--mx-line);
  }
  .mx-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    flex: 1;
  }
  .mx-title input {
    min-width: 0;
    width: 100%;
    max-width: 28rem;
    height: 2rem;
    padding: 0 0.45rem;
    margin-left: -0.15rem;
    border: 1px solid transparent;
    border-radius: var(--mx-radius);
    background: transparent;
    font-size: 0.95rem;
    font-weight: 600;
    text-overflow: ellipsis;
  }
  .mx-title input:hover:not(:disabled) {
    border-color: var(--mx-line);
  }
  .mx-title input:focus {
    outline: none;
    border-color: var(--mx-accent);
    background: var(--mx-surface);
  }
  .mx-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
    color: var(--mx-muted);
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .mx-status .live {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--mx-accent);
    font-weight: 600;
  }
  .mx-status .live i {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: currentColor;
    animation: mx-pulse 2.4s ease-in-out infinite;
  }
  .mx-status .warn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--mx-warn);
  }
  @keyframes mx-pulse {
    50% {
      opacity: 0.35;
    }
  }
  .mx-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .mx-history {
    display: flex;
    padding-right: 0.35rem;
    margin-right: 0.1rem;
    border-right: 1px solid var(--mx-line);
  }
  :global(.mx-icon) {
    display: inline-grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    flex: none;
    border-radius: var(--mx-radius);
    color: var(--mx-text-soft);
  }
  :global(.mx-icon svg) {
    width: 1rem;
    height: 1rem;
  }
  :global(.mx-icon:hover:not(:disabled)) {
    background: var(--mx-subtle);
    color: var(--mx-text);
  }
  :global(.mx-icon:disabled) {
    opacity: 0.35;
    cursor: not-allowed;
  }
  :global(.mx-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    height: 2rem;
    padding: 0 0.75rem;
    border: 1px solid var(--mx-line-strong);
    border-radius: var(--mx-radius);
    background: var(--mx-surface);
    color: var(--mx-text);
    font-size: 0.82rem;
    font-weight: 500;
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
    box-shadow: var(--mx-shadow);
  }
  :global(.mx-btn:hover:not(:disabled)) {
    background: var(--mx-subtle);
  }
  :global(.mx-btn.primary) {
    border-color: var(--mx-accent);
    background: var(--mx-accent);
    color: var(--mx-accent-fg);
  }
  :global(.mx-btn.primary:hover:not(:disabled)) {
    border-color: var(--mx-accent-hover);
    background: var(--mx-accent-hover);
  }
  :global(.mx-btn.danger) {
    border-color: var(--mx-danger);
    background: var(--mx-danger);
    color: var(--mx-danger-fg);
  }
  :global(.mx-btn.danger:hover:not(:disabled)) {
    background: color-mix(in srgb, var(--mx-danger) 88%, black);
  }
  :global(.mx-btn.wide) {
    width: 100%;
    height: 2.4rem;
    margin-top: 0.9rem;
  }
  :global(.mx-btn:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mx-check {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    height: 2rem;
    padding: 0 0.6rem;
    border-radius: var(--mx-radius);
    color: var(--mx-muted);
    font-size: 0.8rem;
    font-weight: 500;
  }
  .mx-check :global(svg) {
    width: 0.95rem;
    height: 0.95rem;
  }
  .mx-check:hover {
    background: var(--mx-subtle);
  }
  .mx-check.warn {
    background: var(--mx-warn-soft);
    color: var(--mx-warn);
  }
  .mx-check.bad {
    background: color-mix(in srgb, var(--mx-danger) 10%, transparent);
    color: var(--mx-danger);
  }
  .mx-faces {
    display: flex;
    padding: 0 0.2rem 0 0.4rem;
  }
  .mx-faces span {
    display: grid;
    place-items: center;
    width: 1.65rem;
    height: 1.65rem;
    margin-left: -0.35rem;
    border: 2px solid var(--mx-surface);
    border-radius: 999px;
    color: #fff;
    font-size: 0.68rem;
    font-weight: 600;
  }
  .mx-faces .more {
    background: var(--mx-subtle);
    color: var(--mx-text);
  }

  /* ── Body grid ─────────────────────────────────────────────────────── */
  .mx-body {
    position: relative;
    display: flex;
    min-height: 0;
    flex: 1;
  }
  .mx-contents {
    display: flex;
    flex-direction: column;
    width: 16rem;
    flex: none;
    border-right: 1px solid var(--mx-line);
    background: var(--mx-surface);
  }
  .mx-contents-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    height: 2.5rem;
    padding: 0 0.5rem 0 0.9rem;
    color: var(--mx-muted);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .mx-contents-head .count {
    margin-right: auto;
    padding: 0 0.4rem;
    border-radius: 999px;
    background: var(--mx-subtle);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
  }
  .mx-toc {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    padding: 0 0.5rem 1.25rem;
    scrollbar-width: thin;
  }
  .mx-toc ol {
    display: grid;
    gap: 1px;
    margin: 0.35rem 0 0;
    padding: 0.35rem 0 0;
    border-top: 1px solid var(--mx-line);
    list-style: none;
  }
  .mx-toc li {
    position: relative;
    border-radius: var(--mx-radius);
  }
  .mx-toc li.dragging {
    opacity: 0.4;
  }
  .mx-toc li.drop-before::before,
  .mx-toc li.drop-after::after {
    content: "";
    position: absolute;
    left: 0.3rem;
    right: 0.3rem;
    height: 2px;
    border-radius: 2px;
    background: var(--mx-accent);
  }
  .mx-toc li.drop-before::before {
    top: -1px;
  }
  .mx-toc li.drop-after::after {
    bottom: -1px;
  }
  .entry,
  .mx-toc-cover {
    display: grid;
    grid-template-columns: 1.5rem minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.4rem;
    width: 100%;
    padding: 0.45rem 0.5rem;
    border-radius: var(--mx-radius);
    text-align: left;
  }
  .mx-toc-cover {
    align-items: center;
  }
  .entry:hover,
  .mx-toc-cover:hover {
    background: var(--mx-subtle);
  }
  .mx-toc li.current,
  .mx-toc-cover.current {
    background: var(--mx-accent-soft);
  }
  .mx-toc li.current .entry:hover {
    background: transparent;
  }
  .num {
    display: inline-flex;
    justify-content: flex-end;
    padding-top: 0.08rem;
    color: var(--mx-muted);
    font-size: 0.75rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .num :global(svg) {
    width: 0.9rem;
    height: 0.9rem;
  }
  .current .num {
    color: var(--mx-accent-text);
    font-weight: 600;
  }
  .text {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
  }
  .text strong {
    font-size: 0.82rem;
    font-weight: 500;
  }
  .current .text strong {
    color: var(--mx-accent-text);
    font-weight: 600;
  }
  .text small {
    overflow: hidden;
    color: var(--mx-muted);
    font-size: 0.72rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .preview {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--mx-text-soft);
    font-size: 0.8rem;
    line-height: 1.4;
  }
  .current .preview {
    color: var(--mx-text);
  }
  .preview :global(math) {
    font-size: 1em;
  }
  .preview.empty,
  .muted {
    color: var(--mx-muted);
    font-style: italic;
  }
  .lock {
    display: inline-flex !important;
    align-items: center;
    gap: 0.25rem;
    color: var(--who) !important;
    font-weight: 600;
  }
  .dot {
    width: 0.45rem;
    height: 0.45rem;
    margin-top: 0.35rem;
    border-radius: 999px;
    background: var(--mx-warn);
  }
  .dot.bad {
    background: var(--mx-danger);
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 0 0.35rem 0.35rem 1.95rem;
  }
  .tools button,
  .tools .grip {
    display: grid;
    place-items: center;
    width: 1.65rem;
    height: 1.55rem;
    border-radius: 4px;
    color: var(--mx-muted);
  }
  .tools .grip {
    cursor: grab;
    margin-right: auto;
  }
  .tools :global(svg) {
    width: 0.85rem;
    height: 0.85rem;
  }
  .tools button:hover:not(:disabled) {
    background: var(--mx-surface);
    color: var(--mx-text);
  }
  .tools button.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--mx-danger) 12%, transparent);
    color: var(--mx-danger);
  }
  .tools button:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .mx-toc-add {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    margin-top: 0.4rem;
    padding: 0.5rem 0.6rem;
    border-radius: var(--mx-radius);
    color: var(--mx-accent-text);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .mx-toc-add :global(svg) {
    width: 0.95rem;
    height: 0.95rem;
  }
  .mx-toc-add:hover:not(:disabled) {
    background: var(--mx-accent-soft);
  }
  .mx-toc-add:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .mx-toc-add kbd {
    margin-left: auto;
    padding: 0.05rem 0.3rem;
    border: 1px solid var(--mx-line);
    border-radius: 4px;
    color: var(--mx-muted);
    font-family: inherit;
    font-size: 0.66rem;
    font-weight: 500;
  }

  /* ── Desk and sheet ────────────────────────────────────────────────── */
  .mx-desk {
    min-width: 0;
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem clamp(0.75rem, 3vw, 2rem) 3rem;
    scroll-padding-top: 1rem;
  }
  .mx-sheet {
    position: relative;
    max-width: 48rem;
    margin: 0 auto;
    border: 1px solid var(--mx-line);
    border-radius: 10px;
    background: var(--mx-surface);
    box-shadow: var(--mx-shadow);
  }
  .mx-sheet.locked {
    border-color: var(--who);
    box-shadow: 0 0 0 1px var(--who);
  }
  .mx-runninghead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.85rem 1.5rem 0;
    color: var(--mx-muted);
    font-size: 0.75rem;
  }
  .mx-qno {
    display: inline-flex;
    align-items: baseline;
    gap: 0.35rem;
    color: var(--mx-text);
    font-size: 0.95rem;
    font-weight: 600;
  }
  .mx-qno small {
    color: var(--mx-muted);
    font-size: 0.78rem;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  .mx-runninghead .who {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    overflow: hidden;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--who, var(--mx-accent)) 12%, transparent);
    color: var(--who, var(--mx-accent));
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mx-sheet-inner {
    padding: 1rem 1.5rem 1.5rem;
  }
  .mx-loading {
    display: grid;
    place-items: center;
    min-height: 16rem;
    color: var(--mx-muted);
    font-size: 0.85rem;
  }
  .mx-claim {
    position: absolute;
    inset: 2.75rem 0 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 1rem;
    border-radius: 0 0 10px 10px;
    background: color-mix(in srgb, var(--mx-surface) 40%, transparent);
    cursor: text;
  }
  .mx-claim span {
    padding: 0.4rem 0.85rem;
    border: 1px solid var(--mx-line-strong);
    border-radius: 999px;
    background: var(--mx-surface);
    font-size: 0.78rem;
    font-weight: 600;
    box-shadow: var(--mx-shadow-pop);
  }
  .mx-claim:hover span {
    border-color: var(--mx-accent);
    color: var(--mx-accent-text);
  }
  .mx-pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    max-width: 48rem;
    margin: 0.75rem auto 0;
  }
  .mx-banner {
    max-width: 48rem;
    margin: 0 auto 0.75rem;
    padding: 0.6rem 0.85rem;
    border: 1px solid color-mix(in srgb, var(--mx-warn) 35%, transparent);
    border-radius: var(--mx-radius);
    background: var(--mx-warn-soft);
    color: var(--mx-warn);
    font-size: 0.82rem;
  }

  /* Cover */
  .mx-label {
    color: var(--mx-muted);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .mx-cover-title {
    display: grid;
    gap: 0.3rem;
    margin-bottom: 1.5rem;
  }
  .mx-cover-title input {
    width: 100%;
    height: 2.75rem;
    padding: 0 0.7rem;
    border: 1px solid var(--mx-line-strong);
    border-radius: var(--mx-radius);
    background: var(--mx-surface);
    font-size: 1.35rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .mx-cover-title input:focus {
    outline: none;
    border-color: var(--mx-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--mx-accent) 18%, transparent);
  }
  .mx-cover-title input:disabled {
    border-color: transparent;
    padding-inline: 0;
  }
  .mx-cover-section + .mx-cover-section {
    margin-top: 1.5rem;
  }
  .mx-section-head {
    margin-bottom: 0.5rem;
    color: var(--mx-text);
    font-size: 0.82rem;
    font-weight: 600;
  }
  .mx-print-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
    gap: 0.75rem;
  }
  .mx-num {
    display: grid;
    gap: 0.3rem;
    color: var(--mx-text-soft);
    font-size: 0.75rem;
    font-weight: 500;
  }
  .mx-num div {
    display: flex;
    align-items: center;
    border: 1px solid var(--mx-line-strong);
    border-radius: var(--mx-radius);
    background: var(--mx-surface);
  }
  .mx-num div:focus-within {
    border-color: var(--mx-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--mx-accent) 18%, transparent);
  }
  .mx-num input {
    width: 100%;
    min-width: 0;
    height: 2.1rem;
    padding: 0 0.6rem;
    border: 0;
    background: transparent;
    font-size: 0.88rem;
    font-variant-numeric: tabular-nums;
    outline: none;
  }
  .mx-num input:disabled {
    color: var(--mx-muted);
  }
  .mx-num em {
    padding: 0 0.6rem;
    color: var(--mx-muted);
    font-size: 0.72rem;
    font-style: normal;
  }
  .mx-print-note {
    grid-column: 1 / -1;
    color: var(--mx-muted);
    font-size: 0.75rem;
  }
  .mx-inline-error {
    margin-top: 0.6rem;
    color: var(--mx-danger);
    font-size: 0.8rem;
  }

  /* ── Rail ──────────────────────────────────────────────────────────── */
  .mx-rail {
    display: none;
    width: 15rem;
    flex: none;
    overflow-y: auto;
    padding: 1rem 0.9rem 2rem;
    border-left: 1px solid var(--mx-line);
    background: var(--mx-surface);
  }
  .mx-rail section + section {
    margin-top: 1.4rem;
  }
  .mx-theme-slot {
    display: contents;
  }
  .mx-mobile-tools {
    display: none;
  }
  :global(.mx-rail-head) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.55rem;
    color: var(--mx-muted);
    font-size: 0.75rem;
    font-weight: 600;
  }
  :global(.mx-rail-head span) {
    padding: 0 0.4rem;
    border-radius: 999px;
    background: var(--mx-subtle);
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
  }
  .mx-proof-inline {
    max-width: 48rem;
    margin: 1.25rem auto 0;
  }
  .mx-proof-inline summary {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.5rem;
    margin-left: -0.5rem;
    border-radius: var(--mx-radius);
    color: var(--mx-muted);
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    list-style: none;
  }
  .mx-proof-inline summary::-webkit-details-marker {
    display: none;
  }
  .mx-proof-inline summary::before {
    content: "";
    width: 0.4rem;
    height: 0.4rem;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(-45deg);
    transition: transform 120ms ease;
  }
  .mx-proof-inline[open] summary::before {
    transform: rotate(45deg);
  }
  .mx-proof-inline summary:hover {
    background: var(--mx-subtle);
    color: var(--mx-text);
  }
  .mx-proof-inline[open] summary {
    margin-bottom: 0.5rem;
  }
  .mx-rail-link {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    color: var(--mx-danger);
    font-size: 0.8rem;
    font-weight: 600;
  }
  .mx-issues {
    display: grid;
    gap: 0.4rem;
    font-size: 0.8rem;
    line-height: 1.4;
  }
  .mx-issues li {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    color: var(--mx-warn);
  }
  .mx-issues li.bad {
    color: var(--mx-danger);
  }
  .mx-issues :global(svg) {
    flex: none;
    margin-top: 0.12rem;
  }
  .mx-people {
    display: grid;
    gap: 0.5rem;
  }
  .mx-people li {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }
  .mx-people .face {
    display: grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    flex: none;
    border-radius: 999px;
    color: #fff;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .mx-people .who {
    display: grid;
    min-width: 0;
  }
  .mx-people strong {
    overflow: hidden;
    font-size: 0.8rem;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mx-people small,
  .mx-people button {
    color: var(--mx-muted);
    font-size: 0.72rem;
    text-align: left;
  }
  .mx-people button {
    color: var(--mx-accent-text);
  }
  .mx-people button:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* ── Menus and dialogs ─────────────────────────────────────────────── */
  :global(.mx-menu) {
    z-index: 70;
    min-width: 14rem;
    padding: 0.3rem;
    border: 1px solid var(--mx-line);
    border-radius: 8px;
    background: var(--mx-surface);
    color: var(--mx-text);
    box-shadow: var(--mx-shadow-pop);
  }
  :global(.mx-menu-heading) {
    padding: 0.4rem 0.55rem 0.2rem;
    color: var(--mx-muted);
    font-size: 0.7rem;
    font-weight: 600;
  }
  :global(.mx-menu-item) {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.55rem;
    border-radius: 5px;
    font-size: 0.84rem;
    cursor: pointer;
    outline: none;
  }
  :global(.mx-menu-item svg) {
    width: 0.95rem;
    height: 0.95rem;
    color: var(--mx-muted);
  }
  :global(.mx-menu-item[data-highlighted]) {
    background: var(--mx-subtle);
    color: var(--mx-text);
  }
  :global(.mx-menu-item.danger),
  :global(.mx-menu-item.danger svg) {
    color: var(--mx-danger);
  }
  :global(.mx-menu-sep) {
    height: 1px;
    margin: 0.3rem 0;
    background: var(--mx-line);
  }
  .mx-tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    margin-bottom: 1rem;
    padding: 3px;
    border-radius: 8px;
    background: var(--mx-subtle);
  }
  .mx-tabs button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    height: 2rem;
    border-radius: 6px;
    color: var(--mx-muted);
    font-size: 0.82rem;
    font-weight: 500;
  }
  .mx-tabs button:hover:not(.on) {
    color: var(--mx-text);
  }
  .mx-tabs button.on {
    background: var(--mx-surface);
    color: var(--mx-text);
    font-weight: 600;
    box-shadow: var(--mx-shadow);
  }
  .mx-modal-text {
    margin-bottom: 0.9rem;
    color: var(--mx-text-soft);
    font-size: 0.86rem;
    line-height: 1.5;
  }
  .mx-modal-small {
    margin-top: 0.5rem;
    color: var(--mx-muted);
    font-size: 0.76rem;
  }
  .mx-copy-row {
    display: flex;
    gap: 0.5rem;
  }
  .mx-copy-row input {
    min-width: 0;
    flex: 1;
    height: 2rem;
    padding: 0 0.6rem;
    border: 1px solid var(--mx-line-strong);
    border-radius: var(--mx-radius);
    background: var(--mx-subtle);
    font-family: ui-monospace, "Spline Sans Mono", monospace;
    font-size: 0.75rem;
  }
  .mx-expiry {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    padding: 3px;
    border-radius: 8px;
    background: var(--mx-subtle);
  }
  .mx-expiry button {
    height: 1.9rem;
    border-radius: 6px;
    color: var(--mx-muted);
    font-size: 0.8rem;
    font-weight: 500;
  }
  .mx-expiry button.on {
    background: var(--mx-surface);
    color: var(--mx-text);
    font-weight: 600;
    box-shadow: var(--mx-shadow);
  }
  :global(.mx-field) {
    display: grid;
    gap: 0.35rem;
    color: var(--mx-text-soft);
    font-size: 0.8rem;
    font-weight: 500;
  }
  :global(.mx-field input) {
    height: 2.4rem;
    padding: 0 0.7rem;
    border: 1px solid var(--mx-line-strong);
    border-radius: var(--mx-radius);
    background: var(--mx-surface);
    color: var(--mx-text);
    font-size: 0.92rem;
    font-weight: 400;
  }
  :global(.mx-field input:focus) {
    outline: none;
    border-color: var(--mx-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--mx-accent) 18%, transparent);
  }
  .mx-callout {
    margin-bottom: 0.8rem;
    padding: 0.6rem 0.8rem;
    border-radius: var(--mx-radius);
    font-size: 0.82rem;
  }
  .mx-callout.warn {
    background: var(--mx-warn-soft);
    color: var(--mx-warn);
  }
  .mx-check-list {
    display: grid;
    gap: 0.35rem;
  }
  .mx-check-item {
    display: grid;
    gap: 0.2rem;
    width: 100%;
    margin-bottom: 0.35rem;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--mx-line);
    border-left: 3px solid var(--mx-warn);
    border-radius: var(--mx-radius);
    text-align: left;
  }
  .mx-check-list .mx-check-item {
    margin-bottom: 0;
  }
  .mx-check-item.bad {
    border-left-color: var(--mx-danger);
  }
  .mx-check-item:hover {
    background: var(--mx-subtle);
  }
  .mx-check-item strong {
    font-size: 0.84rem;
    font-weight: 600;
  }
  .mx-check-item span {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem 0.8rem;
    font-size: 0.76rem;
  }
  .mx-check-item em {
    color: var(--mx-warn);
    font-style: normal;
  }
  .mx-check-item em.bad,
  .mx-check-item.bad > span {
    color: var(--mx-danger);
  }

  /* ── Join gate ─────────────────────────────────────────────────────── */
  .mx-gate {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 100dvh;
    padding: 1.5rem;
    background: var(--mx-bg);
    color: var(--mx-text);
  }
  .mx-gate-card {
    width: min(24rem, 100%);
    padding: 1.75rem;
    border: 1px solid var(--mx-line);
    border-radius: 12px;
    background: var(--mx-surface);
    box-shadow: var(--mx-shadow);
  }
  .mx-gate-card .mx-brand {
    margin-bottom: 1.5rem;
  }
  .mx-gate-card h1 {
    margin: 0 0 0.4rem;
    font-size: 1.3rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .mx-gate-card .lede {
    margin-bottom: 1.25rem;
    color: var(--mx-muted);
    font-size: 0.86rem;
    line-height: 1.5;
  }
  .mx-gate-theme {
    position: absolute;
    top: 1rem;
    right: 1rem;
  }

  /* ── Responsive ────────────────────────────────────────────────────── */
  @media (min-width: 1280px) {
    .mx-rail {
      display: block;
    }
  }
  .narrow-only {
    display: none !important;
  }
  @media (max-width: 1023px) {
    .narrow-only {
      display: inline-grid !important;
    }
    .mx-contents {
      position: absolute;
      inset: 0 auto 0 0;
      z-index: 30;
      width: min(18rem, 86vw);
      transform: translateX(-100%);
      transition: transform 180ms ease;
      box-shadow: var(--mx-shadow-pop);
    }
    .mx-contents.open {
      transform: none;
    }
    .mx-scrim {
      position: absolute;
      inset: 0;
      z-index: 20;
      background: rgb(10 12 16 / 35%);
    }
  }
  @media (max-width: 640px) {
    .mx-mobile-tools {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      margin-top: 1rem;
      padding-top: 0.6rem;
      border-top: 1px solid var(--mx-line);
    }
    .mx-mobile-tools span {
      flex: 1;
      font-size: 0.78rem;
      color: var(--mx-muted);
    }
    .mx-masthead {
      gap: 0.35rem;
      padding: 0 0.5rem;
    }
    .mx-rule,
    .mx-history,
    .mx-faces,
    .mx-theme-slot {
      display: none;
    }
    .mx-title {
      gap: 0.4rem;
    }
    .mx-desk {
      padding: 0.6rem 0.5rem 2.5rem;
    }
    .mx-runninghead {
      padding: 0.75rem 1rem 0;
    }
    .mx-sheet-inner {
      padding: 0.75rem 1rem 1.25rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mx-status .live i {
      animation: none;
    }
    .mx-contents,
    .mx-proof-inline summary::before {
      transition: none;
    }
  }
</style>
