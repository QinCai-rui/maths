<script lang="ts">
  import { goto } from "$app/navigation";
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
    CollaborativeHistoryEntry,
    CollaborativeHistoryTarget,
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
    History,
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
  let settingsTimer: ReturnType<typeof setTimeout> | null = null;
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  let lockHeartbeat: ReturnType<typeof setInterval> | null = null;
  let activeQuestionCard = $state.raw<HTMLElement | null>(null);
  let closingSocket = false;
  let editorId = $state("");
  let history = $state<CollaborativeHistoryEntry[]>([]);
  let historyOpen = $state(false);
  let pendingDeleteQuestion = $state<CollaborativeQuestionValue | null>(null);
  let localHistoryTimer: ReturnType<typeof setTimeout> | null = null;
  let localBaseline: CollaborativeSetSnapshot | null = null;
  let applyingLocalHistory = false;

  let isHost = $derived(hostSession);
  let canUndo = $derived(
    history.some((entry) => entry.editorId === (sessionToken ? editorId : "local") && entry.status === "applied")
  );
  let canRedo = $derived(
    history.some((entry) => entry.editorId === (sessionToken ? editorId : "local") && entry.status === "undone")
  );
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

  function editorSnapshot(): CollaborativeSetSnapshot {
    return {
      ...structuredClone(plainSet()),
      sessionToken: sessionToken || "___________________________________________",
      status: sessionStatus,
      questions: structuredClone(questions),
      updatedAt: 0
    };
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
        target: { type: "structure", action: "add", questionId: added.id } as CollaborativeHistoryTarget,
        summary: `Added question ${index + 1}`
      };
    }
    const deleted = before.questions.find(({ id }) => !afterIds.includes(id));
    if (deleted) {
      const index = before.questions.findIndex(({ id }) => id === deleted.id);
      return {
        target: { type: "structure", action: "delete", questionId: deleted.id } as CollaborativeHistoryTarget,
        summary: `Deleted question ${index + 1}`
      };
    }
    if (!sameValue(beforeIds, afterIds)) {
      const questionId = afterIds.find((id, index) => beforeIds[index] !== id) || afterIds[0];
      return {
        target: { type: "structure", action: "move", questionId } as CollaborativeHistoryTarget,
        summary: "Reordered questions"
      };
    }
    const changedQuestion = after.questions.find((question, index) => !sameValue(question, before.questions[index]));
    if (changedQuestion) {
      const index = after.questions.findIndex(({ id }) => id === changedQuestion.id);
      return {
        target: { type: "question", questionId: changedQuestion.id } as CollaborativeHistoryTarget,
        summary: `Edited question ${index + 1}`
      };
    }
    return { target: { type: "details" } as CollaborativeHistoryTarget, summary: "Edited set details" };
  }

  function flushLocalHistory() {
    if (sessionToken || applyingLocalHistory || !localBaseline) return;
    if (localHistoryTimer) clearTimeout(localHistoryTimer);
    localHistoryTimer = null;
    const after = editorSnapshot();
    if (sameValue(localBaseline, after)) return;
    const before = localBaseline;
    const change = localChange(before, after);
    history = [
      ...history.map((entry) =>
        entry.editorId === "local" && entry.status === "undone" ? { ...entry, status: "invalidated" as const } : entry
      ),
      {
        id: crypto.randomUUID(),
        editorId: "local",
        displayName: "You",
        timestamp: Date.now(),
        summary: change.summary,
        before,
        after,
        target: change.target,
        status: "applied" as const
      }
    ].slice(-100);
    localBaseline = structuredClone(after);
  }

  function scheduleLocalHistory() {
    if (sessionToken || applyingLocalHistory || !localBaseline) return;
    if (localHistoryTimer) clearTimeout(localHistoryTimer);
    localHistoryTimer = setTimeout(flushLocalHistory, 1_000);
  }

  function applyLocalSnapshot(snapshot: CollaborativeSetSnapshot) {
    applyingLocalHistory = true;
    setName = snapshot.name;
    instructions = snapshot.instructions;
    questions = structuredClone(snapshot.questions);
    pdfOptions = structuredClone(snapshot.pdfOptions);
    if (!currentQuestionId || !questions.some(({ id }) => id === currentQuestionId)) {
      currentQuestionId = questions[0]?.id || null;
    }
    localBaseline = editorSnapshot();
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
    questions = state.questions.map((question) =>
      ownedLocks[question.id] ? localQuestions.get(question.id) || question : question
    );
    pdfOptions = state.pdfOptions;
    sessionStatus = state.status;
    if (!currentQuestionId || !questions.some(({ id }) => id === currentQuestionId)) {
      currentQuestionId = questions[0]?.id || null;
    }
    lastServerSettings = JSON.stringify({ setName, instructions, pdfOptions });
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
        editorId,
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
        collaborators = result.state.collaborators;
        locks = result.state.locks;
        hostSession = result.state.collaborators.some(
          (collaborator) => collaborator.connectionId === socket?.id && collaborator.isHost
        );
        joined = true;
        ready = true;
        socket?.emit("getHistory", (historyResult) => {
          if (historyResult.ok) history = historyResult.history;
        });
        if (reconnecting) toast.success("Reconnected to the live editor");
      }
    );
  }

  onMount(() => {
    if (sessionToken) {
      const editorKey = `mathex-collab-editor:${sessionToken}`;
      editorId = sessionStorage.getItem(editorKey) || crypto.randomUUID();
      sessionStorage.setItem(editorKey, editorId);
    }
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
    socket.on("historyChanged", (next) => (history = next));
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
      lastQuestionSent.set(question.id, JSON.stringify(plainQuestion(question)));
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
      if (localHistoryTimer) clearTimeout(localHistoryTimer);
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
    if (!sessionToken) {
      localSaved = false;
      if (localTimer) clearTimeout(localTimer);
      localTimer = setTimeout(saveLocalDraft, 500);
      scheduleLocalHistory();
      return;
    }
    if (!joined || !isHost) return;
    const settings = JSON.stringify({ setName, instructions, pdfOptions });
    if (settings === lastServerSettings) return;
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      lastServerSettings = settings;
      socket?.emit("updateMetadata", { name: setName, instructions }, handleOperation);
      socket?.emit("updatePdfOptions", { pdfOptions }, handleOperation);
    }, 350);
    serialized;
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
    socket?.emit("releaseLock", { questionId });
    ownedLocks = { ...ownedLocks, [questionId]: false };
  }

  function handleOperation(result: { ok: true } | { ok: false; error: string }) {
    if (!result.ok) toast.error(result.error);
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
    });
  }

  function selectQuestion(questionId: string) {
    if (currentQuestionId && ownedLocks[currentQuestionId]) {
      releaseQuestion(currentQuestionId);
    }
    currentQuestionId = questionId;
    mobileOutlineOpen = false;
  }

  function addQuestion() {
    if (questions.length >= 100) return toast.error("A set can contain at most 100 questions");
    if (sessionToken) {
      socket?.emit("addQuestion", { afterQuestionId: currentQuestionId }, handleOperation);
      return;
    }
    const question = withId(emptyQuestion());
    const index = currentQuestionIndex < 0 ? questions.length : currentQuestionIndex + 1;
    questions.splice(index, 0, question);
    currentQuestionId = question.id;
  }

  function duplicateQuestion(question: CollaborativeQuestionValue) {
    if (sessionToken) {
      socket?.emit("duplicateQuestion", { questionId: question.id }, handleOperation);
      return;
    }
    const copy = { ...structuredClone(question), id: crypto.randomUUID() };
    const index = questions.findIndex(({ id }) => id === question.id) + 1;
    questions.splice(index, 0, copy);
    currentQuestionId = copy.id;
  }

  function moveQuestion(question: CollaborativeQuestionValue, direction: -1 | 1) {
    const index = questions.findIndex(({ id }) => id === question.id);
    const toIndex = index + direction;
    if (toIndex < 0 || toIndex >= questions.length) return;
    if (sessionToken) {
      socket?.emit("moveQuestion", { questionId: question.id, toIndex }, handleOperation);
      return;
    }
    questions.splice(index, 1);
    questions.splice(toIndex, 0, question);
  }

  function deleteQuestion(question: CollaborativeQuestionValue) {
    pendingDeleteQuestion = question;
  }

  function confirmDeleteQuestion() {
    const question = pendingDeleteQuestion;
    if (!question) return;
    pendingDeleteQuestion = null;
    if (sessionToken) {
      socket?.emit("deleteQuestion", { questionId: question.id }, handleOperation);
      return;
    }
    const index = questions.findIndex(({ id }) => id === question.id);
    questions.splice(index, 1);
    if (currentQuestionId === question.id)
      currentQuestionId = questions[Math.min(index, questions.length - 1)]?.id || null;
  }

  function undo() {
    if (sessionToken) {
      if (currentQuestionId && ownedLocks[currentQuestionId]) releaseQuestion(currentQuestionId);
      socket?.emit("undo", (result) => {
        if (!result.ok) toast.error(result.error);
      });
      return;
    }
    flushLocalHistory();
    const entry = [...history]
      .reverse()
      .find((candidate) => candidate.editorId === "local" && candidate.status === "applied");
    if (!entry) return;
    applyLocalSnapshot(entry.before);
    history = history.map((candidate) =>
      candidate.id === entry.id ? { ...candidate, status: "undone" as const } : candidate
    );
  }

  function redo() {
    if (sessionToken) {
      if (currentQuestionId && ownedLocks[currentQuestionId]) releaseQuestion(currentQuestionId);
      socket?.emit("redo", (result) => {
        if (!result.ok) toast.error(result.error);
      });
      return;
    }
    flushLocalHistory();
    const entry = history.find((candidate) => candidate.editorId === "local" && candidate.status === "undone");
    if (!entry) return;
    applyLocalSnapshot(entry.after);
    history = history.map((candidate) =>
      candidate.id === entry.id ? { ...candidate, status: "applied" as const } : candidate
    );
  }

  function openHistory() {
    if (!sessionToken) flushLocalHistory();
    else {
      socket?.emit("getHistory", (result) => {
        if (result.ok) history = result.history;
        else toast.error(result.error);
      });
    }
    historyOpen = true;
  }

  function historyQuestion(entry: CollaborativeHistoryEntry) {
    if (entry.target.type === "details") return null;
    const questionId = entry.target.questionId;
    return (
      entry.after.questions.find(({ id }) => id === questionId) ||
      entry.before.questions.find(({ id }) => id === questionId) ||
      null
    );
  }

  function restoreHistoryQuestion(entry: CollaborativeHistoryEntry) {
    const question = historyQuestion(entry);
    if (!question) return;
    if (sessionToken) {
      socket?.emit("restoreQuestion", { historyEntryId: entry.id, questionId: question.id }, handleOperation);
      return;
    }
    flushLocalHistory();
    const currentIndex = questions.findIndex(({ id }) => id === question.id);
    if (currentIndex >= 0) questions[currentIndex] = structuredClone(question);
    else {
      const historicalIndex = Math.max(
        entry.after.questions.findIndex(({ id }) => id === question.id),
        entry.before.questions.findIndex(({ id }) => id === question.id)
      );
      questions.splice(Math.min(Math.max(historicalIndex, 0), questions.length), 0, structuredClone(question));
    }
    currentQuestionId = question.id;
    flushLocalHistory();
    toast.success("Question restored from history");
  }

  function restoreHistoryDetails(entry: CollaborativeHistoryEntry) {
    if (sessionToken) {
      socket?.emit("restoreDetails", { historyEntryId: entry.id }, handleOperation);
      return;
    }
    flushLocalHistory();
    setName = entry.after.name;
    instructions = entry.after.instructions;
    pdfOptions = structuredClone(entry.after.pdfOptions);
    flushLocalHistory();
    toast.success("Set details restored from history");
  }

  function formatHistoryTime(timestamp: number) {
    return new Date(timestamp).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
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

  function downloadJson() {
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

  function validatedSet() {
    const result = QuestionSet.safeParse(plainSet());
    if (!result.success) {
      toast.error(`Complete the set first: ${result.error.issues[0]?.message || "invalid content"}`);
      return null;
    }
    return result.data;
  }

  async function exportPdf(answers: boolean) {
    const set = validatedSet();
    if (!set) return;
    const id = toast.loading(`Creating ${answers ? "answer" : "question"} PDF...`);
    try {
      await (answers ? downloadAnswerSet(set) : downloadQuestionSet(set));
      toast.success("PDF downloaded", { id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create PDF", { id });
    }
  }

  function previewPdf(answers: boolean) {
    const set = validatedSet();
    if (!set) return;
    if (!(answers ? previewAnswerSet(set) : previewQuestionSet(set))) toast.error("Allow pop-ups to open the preview");
  }

  function useInRoom() {
    const set = validatedSet();
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
        <button class="toolbar-button" onclick={openHistory}><History /> History</button>
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
              {#key currentQuestion.id}
                <QuestionEditor question={currentQuestion} disabled={readOnly} />
              {/key}
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
        “{questionPreview(pendingDeleteQuestion)}” will be removed from this set. You can recover it from history.
      </p>
      <div class="mt-6 flex justify-end gap-2">
        <Button variant="outline" onclick={() => (pendingDeleteQuestion = null)}>Cancel</Button>
        <Button variant="destructive" onclick={confirmDeleteQuestion}>Delete question</Button>
      </div>
    </div>
  </div>
{/if}

{#if historyOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm"
    role="presentation"
    onclick={(event) => event.target === event.currentTarget && (historyOpen = false)}
  >
    <div
      class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
    >
      <div class="flex items-start justify-between border-b p-5">
        <div>
          <h2 class="text-xl font-semibold">Version history</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            The latest 100 pause-grouped changes. Restore questions or set details independently.
          </p>
        </div>
        <button class="rounded-lg p-2 hover:bg-accent" onclick={() => (historyOpen = false)} aria-label="Close history"
          ><X class="size-4" /></button
        >
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {#each [...history].reverse() as entry (entry.id)}
          {@const historicalQuestion = historyQuestion(entry)}
          <article class="mb-2 rounded-xl border p-4 {entry.status === 'undone' ? 'opacity-60' : ''}">
            <div class="flex flex-wrap items-start gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-sm font-semibold">{entry.summary}</p>
                  {#if entry.status !== "applied"}<span
                      class="rounded-full bg-muted px-2 py-0.5 text-[0.65rem] uppercase text-muted-foreground"
                      >{entry.status}</span
                    >{/if}
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {formatHistoryTime(entry.timestamp)} · {entry.displayName}
                </p>
                {#if historicalQuestion}<p class="mt-2 truncate text-xs text-muted-foreground">
                    {questionPreview(historicalQuestion)}
                  </p>{/if}
              </div>
              {#if !sessionToken || isHost}
                {#if entry.target.type === "details"}
                  <Button variant="outline" size="sm" onclick={() => restoreHistoryDetails(entry)}
                    >Restore set details</Button
                  >
                {:else if historicalQuestion}
                  <Button variant="outline" size="sm" onclick={() => restoreHistoryQuestion(entry)}
                    >Restore question</Button
                  >
                {/if}
              {/if}
            </div>
          </article>
        {:else}
          <div class="py-16 text-center text-sm text-muted-foreground">
            No history entries yet. Changes appear after a short pause.
          </div>
        {/each}
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
