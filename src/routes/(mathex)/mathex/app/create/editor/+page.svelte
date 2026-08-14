<script lang="ts">
  import { z } from "zod";
  import { Button, buttonVariants } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { Question, QuestionSet, SolutionItem } from "$lib/mathex/schemas";
  import { stripTags } from "$lib/mathex/content";
  import type { SetShareClientToServerEvents, SetShareServerToClientEvents } from "$lib/mathex/set-share.schemas";
  import { downloadAnswerSet, downloadQuestionSet, previewAnswerSet, previewQuestionSet } from "$lib/mathex/print";
  import { copyText } from "$lib/utils";
  import { toast } from "svelte-sonner";

  import QuestionEditor from "$lib/mathex/editors/QuestionEditor.svelte";
  import Quill from "$lib/components/Quill.svelte";

  import Plus from "@lucide/svelte/icons/plus";
  import Copy from "@lucide/svelte/icons/copy";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Upload from "@lucide/svelte/icons/upload";
  import Download from "@lucide/svelte/icons/download";
  import FileText from "@lucide/svelte/icons/file-text";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Share2 from "@lucide/svelte/icons/share-2";
  import Link2 from "@lucide/svelte/icons/link-2";
  import { io, type Socket } from "socket.io-client";

  const DRAFT_KEY = "mathex-draft";
  const ROOM_SET_KEY = "mathex-room-set";
  const shareSocket: Socket<SetShareServerToClientEvents, SetShareClientToServerEvents> = io("/set-share");

  let questions: z.infer<typeof Question>[] = $state([]);
  let setName = $state("");
  let instructions = $state("");
  let coverResetKey = $state(0);
  let pdfOptions = $state({
    questionTextSize: 11,
    answerTextSize: 11,
    imageHeight: 30,
    slipHeight: 49.4,
    cutMargin: 50
  });
  let currentQuestionIdx = $state(0);
  let currentQuestion = $derived(questions[currentQuestionIdx]);
  let isDirty = $state(false);
  let loaded = $state(false);
  let shareDialogOpen = $state(false);
  let shareExpiryMs = $state<3_600_000 | 21_600_000 | 43_200_000 | 86_400_000>(86_400_000);
  let shareUrl = $state("");
  let shareExpiresAt = $state<number | null>(null);
  let sharing = $state(false);

  // --- Migrate old-format solutions ---
  function migrateSolutions(sol: any[]): z.infer<typeof SolutionItem>[] {
    return sol.map((s) => {
      if (typeof s === "object" && s !== null && "type" in s && "value" in s) return s;
      if (typeof s === "number") return { type: "number", value: s };
      if (typeof s === "string") return { type: "text", value: s };
      return { type: "text", value: String(s) };
    });
  }

  function migrateQuestion(q: any): z.infer<typeof Question> {
    // Old format: { type: "...", data: { contents, solutions, allowEquivalent } }
    if (q.type && q.data) {
      return {
        contents: q.data.contents || "",
        solutions: q.data.solutions ? migrateSolutions(q.data.solutions) : [],
        allowEquivalent: q.data.allowEquivalent ?? true,
        answerComment: q.data.answerComment || ""
      };
    }
    // New format: { contents, solutions, allowEquivalent }
    if (q.data) {
      return { ...q.data, allowEquivalent: q.data.allowEquivalent ?? true, answerComment: q.data.answerComment || "" };
    }
    return {
      contents: q.contents || "",
      solutions: q.solutions ? migrateSolutions(q.solutions) : [],
      allowEquivalent: q.allowEquivalent ?? true,
      answerComment: q.answerComment || ""
    };
  }

  // --- Draft persistence ---
  function saveDraft() {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: setName, instructions, questions, pdfOptions }));
      isDirty = false;
    } catch {}
  }

  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  function scheduleSave() {
    isDirty = true;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveDraft, 500);
  }

  function loadDraft(): boolean {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      const source = Array.isArray(parsed) ? { questions: parsed } : parsed;
      if (!Array.isArray(source.questions) || source.questions.length === 0) return false;
      setName = source.name || "";
      instructions = source.instructions || "";
      pdfOptions = {
        questionTextSize: source.pdfOptions?.questionTextSize ?? 11,
        answerTextSize: source.pdfOptions?.answerTextSize ?? 11,
        imageHeight: source.pdfOptions?.imageHeight ?? 30,
        slipHeight: source.pdfOptions?.slipHeight ?? 49.4,
        cutMargin: source.pdfOptions?.cutMargin ?? 50
      };
      questions = source.questions.map(migrateQuestion);
      currentQuestionIdx = 0;
      return true;
    } catch {
      return false;
    }
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    isDirty = false;
  }

  $effect(() => {
    JSON.stringify({ setName, instructions, questions, pdfOptions });
    if (loaded) {
      scheduleSave();
    }
  });

  $effect(() => {
    if (!loaded) return;
    function handler(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = true;
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  });

  $effect(() => {
    if (loaded) return;
    const restored = loadDraft();
    loaded = true;
    if (restored && questions.length > 0) {
      toast.info(`Draft restored (${questions.length} question${questions.length === 1 ? "" : "s"})`);
    }
  });

  // --- Question CRUD ---
  function newQuestion() {
    if (questions.length >= 100) {
      toast.error("Maximum 100 questions per set");
      return;
    }
    questions = [...questions, { contents: "", solutions: [], allowEquivalent: true, answerComment: "" }];
    currentQuestionIdx = questions.length - 1;
  }

  function removeQuestion(i: number) {
    if (currentQuestionIdx === i) {
      if (currentQuestionIdx === 0 && questions.length > 1) currentQuestionIdx = 1;
      else if (questions.length > 1) currentQuestionIdx--;
    }
    questions = questions.toSpliced(i, 1);
    if (currentQuestionIdx >= questions.length) currentQuestionIdx = Math.max(0, questions.length - 1);
  }

  function duplicateQuestion(i: number) {
    if (questions.length >= 100) {
      toast.error("Maximum 100 questions per set");
      return;
    }
    const copy = structuredClone(questions[i]);
    questions = [...questions.slice(0, i + 1), copy, ...questions.slice(i + 1)];
    currentQuestionIdx = i + 1;
  }

  function moveQuestion(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= questions.length) return;
    const arr = [...questions];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    questions = arr;
    currentQuestionIdx = j;
  }

  // --- Clear ---
  let clearDialogOpen = $state(false);
  function clearAll() {
    questions = [];
    setName = "";
    instructions = "";
    coverResetKey++;
    pdfOptions = { questionTextSize: 11, answerTextSize: 11, imageHeight: 30, slipHeight: 49.4, cutMargin: 50 };
    currentQuestionIdx = 0;
    clearDraft();
    clearDialogOpen = false;
  }

  // --- Import / Export ---
  function importFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const source = Array.isArray(parsed) ? { questions: parsed } : parsed;
        const migrated = {
          name: source.name || "",
          instructions: source.instructions || "",
          questions: Array.isArray(source.questions) ? source.questions.map(migrateQuestion) : [],
          pdfOptions: source.pdfOptions || undefined
        };
        const result = QuestionSet.safeParse(migrated);
        if (!result.success) {
          toast.error(`Invalid set: ${result.error.issues[0]?.message || "bad format"}`);
          return;
        }
        if (result.data.questions.length > 100) {
          toast.error("Set has more than 100 questions — rejected");
          return;
        }
        setName = result.data.name;
        instructions = result.data.instructions;
        questions = result.data.questions;
        pdfOptions = result.data.pdfOptions;
        currentQuestionIdx = 0;
        clearDraft();
        toast.success(
          `Imported ${result.data.questions.length} question${result.data.questions.length === 1 ? "" : "s"}`
        );
      } catch {
        toast.error("Could not parse JSON file");
      }
    };
    input.click();
  }

  function exportFile() {
    if (questions.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const blob = new Blob([JSON.stringify({ name: setName, instructions, questions, pdfOptions }, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${
      setName
        .trim()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "") || "set"
    }.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openShareDialog() {
    shareUrl = "";
    shareExpiresAt = null;
    shareDialogOpen = true;
  }

  function createShareLink() {
    const set = QuestionSet.safeParse({ name: setName, instructions, questions, pdfOptions });
    if (!set.success) {
      const issue = set.error.issues[0];
      toast.error(`Cannot share ${issue.path.join(".") || "set"}: ${issue.message}`);
      return;
    }
    if (set.data.questions.length === 0) {
      toast.error("Add at least one question before sharing");
      return;
    }
    sharing = true;
    shareSocket.emit("createShare", { set: set.data, expiresInMs: shareExpiryMs }, (result) => {
      sharing = false;
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      shareExpiresAt = result.expiresAt;
      shareUrl = `${window.location.origin}/mathex/app/create/editor/share/${result.token}`;
    });
  }

  async function copyShareLink() {
    try {
      await copyText(shareUrl);
      toast.success("Share link copied");
    } catch {
      toast.error("Could not copy share link");
    }
  }

  async function exportQuestions() {
    if (!questions.length) return toast.error("Nothing to export");
    const toastId = toast.loading("Exporting question PDF...");
    try {
      const result = QuestionSet.safeParse({ name: setName, instructions, questions, pdfOptions });
      if (!result.success) throw new Error(result.error.issues[0]?.message || "Invalid PDF settings");
      await downloadQuestionSet(result.data);
      toast.success("Question PDF downloaded", { id: toastId });
    } catch (error) {
      console.error("Question PDF generation failed", error);
      toast.error(`Could not create the question PDF: ${error instanceof Error ? error.message : "unknown error"}`, {
        id: toastId
      });
    }
  }

  async function exportAnswers() {
    if (!questions.length) return toast.error("Nothing to export");
    const toastId = toast.loading("Exporting answer PDF...");
    try {
      const result = QuestionSet.safeParse({ name: setName, instructions, questions, pdfOptions });
      if (!result.success) throw new Error(result.error.issues[0]?.message || "Invalid PDF settings");
      await downloadAnswerSet(result.data);
      toast.success("Answer PDF downloaded", { id: toastId });
    } catch (error) {
      console.error("Answer PDF generation failed", error);
      toast.error(`Could not create the answer PDF: ${error instanceof Error ? error.message : "unknown error"}`, {
        id: toastId
      });
    }
  }

  function previewQuestions() {
    if (!questions.length) return toast.error("Nothing to export");
    const result = QuestionSet.safeParse({ name: setName, instructions, questions, pdfOptions });
    if (!result.success) return toast.error(result.error.issues[0]?.message || "Invalid print settings");
    if (!previewQuestionSet(result.data)) toast.error("Allow pop-ups to open the print preview");
  }

  function previewAnswers() {
    if (!questions.length) return toast.error("Nothing to export");
    const result = QuestionSet.safeParse({ name: setName, instructions, questions, pdfOptions });
    if (!result.success) return toast.error(result.error.issues[0]?.message || "Invalid print settings");
    if (!previewAnswerSet(result.data)) toast.error("Allow pop-ups to open the print preview");
  }

  function useInRoom() {
    if (questions.length === 0) {
      toast.error("Add at least one question first");
      return;
    }
    try {
      localStorage.setItem(ROOM_SET_KEY, JSON.stringify({ name: setName, instructions, questions, pdfOptions }));
    } catch {
      toast.error("Couldn't store set for room creation");
      return;
    }
    window.open("/mathex/app/create", "_blank", "noopener");
  }

  // --- Sidebar helpers ---
  function questionPreview(q: z.infer<typeof Question>): string {
    const text = stripTags(q.contents);
    return text.slice(0, 50) || (text.length === 0 ? "Empty" : "…");
  }
</script>

<AlertDialog.Root bind:open={shareDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Share this question set</AlertDialog.Title>
      <AlertDialog.Description>
        The link contains an immutable snapshot. Anyone with it can save the set to their browser until it expires.
      </AlertDialog.Description>
    </AlertDialog.Header>
    {#if shareUrl}
      <div class="rounded-lg border border-border bg-muted/30 p-3">
        <p class="break-all font-mono text-xs">{shareUrl}</p>
        <p class="mt-2 text-xs text-muted-foreground">
          Expires {shareExpiresAt ? new Date(shareExpiresAt).toLocaleString() : "soon"}
        </p>
      </div>
    {:else}
      <label class="grid gap-2 text-sm font-medium">
        Link expiry
        <select class="h-10 rounded-md border border-input bg-background px-3 text-sm" bind:value={shareExpiryMs}>
          <option value={3_600_000}>1 hour</option>
          <option value={21_600_000}>6 hours</option>
          <option value={43_200_000}>12 hours</option>
          <option value={86_400_000}>24 hours</option>
        </select>
      </label>
    {/if}
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Close</AlertDialog.Cancel>
      {#if shareUrl}
        <AlertDialog.Action onclick={copyShareLink}><Copy /> Copy link</AlertDialog.Action>
      {:else}
        <AlertDialog.Action onclick={createShareLink} disabled={sharing || questions.length === 0}>
          <Link2 />
          {sharing ? "Creating..." : "Create link"}
        </AlertDialog.Action>
      {/if}
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={clearDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Clear entire set?</AlertDialog.Title>
      <AlertDialog.Description>
        This will delete all {questions.length} question{questions.length === 1 ? "" : "s"} permanently. Export first if you
        want to keep this set.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action class={buttonVariants({ variant: "destructive" })} onclick={clearAll}>
        Clear
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<div class="flex h-screen flex-col">
  <!-- Header bar -->
  <div class="flex shrink-0 items-center gap-3 border-b border-border/40 bg-background px-4 py-2">
    <Header size="h3" class="!m-0">Set Editor</Header>
    <span class="ml-1 text-xs text-muted-foreground">{questions.length}/100</span>
    {#if isDirty}
      <span class="text-xs text-muted-foreground italic">Unsaved</span>
    {/if}
    <div class="ml-auto flex items-center gap-1.5">
      <Button variant="outline" size="sm" class="gap-1" onclick={newQuestion}>
        <Plus class="h-3.5 w-3.5" /> New
      </Button>
      <Button variant="outline" size="sm" class="gap-1" onclick={importFile}>
        <Upload class="h-3.5 w-3.5" /> Import
      </Button>
      <Button variant="outline" size="sm" class="gap-1" onclick={openShareDialog} disabled={questions.length === 0}>
        <Share2 class="h-3.5 w-3.5" /> Share
      </Button>
      <details class="relative">
        <summary
          class="inline-flex h-8 cursor-pointer list-none items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent"
        >
          <Download class="h-3.5 w-3.5" /> Export
        </summary>
        <div
          class="absolute right-0 z-10 mt-1 w-96 max-w-[calc(100vw-1rem)] rounded-md border bg-popover p-3 shadow-md"
        >
          <div class="mb-3 grid grid-cols-2 gap-2 border-b pb-3">
            <label
              class="grid gap-1 rounded-md border border-border/70 bg-background/60 p-2 text-[0.7rem] text-muted-foreground"
            >
              Question text
              <input
                class="h-8 rounded border bg-background px-2 text-sm text-foreground"
                type="number"
                min="6"
                max="18"
                step="0.5"
                bind:value={pdfOptions.questionTextSize}
              />
              <span>6-18 pt</span>
            </label>
            <label
              class="grid gap-1 rounded-md border border-border/70 bg-background/60 p-2 text-[0.7rem] text-muted-foreground"
            >
              Answer text
              <input
                class="h-8 rounded border bg-background px-2 text-sm text-foreground"
                type="number"
                min="6"
                max="16"
                step="0.5"
                bind:value={pdfOptions.answerTextSize}
              />
              <span>6-16 pt</span>
            </label>
            <label
              class="grid gap-1 rounded-md border border-border/70 bg-background/60 p-2 text-[0.7rem] text-muted-foreground"
            >
              Image height
              <input
                class="h-8 rounded border bg-background px-2 text-sm text-foreground"
                type="number"
                min="5"
                max="35"
                step="1"
                bind:value={pdfOptions.imageHeight}
              />
              <span>5-35 mm</span>
            </label>
            <label
              class="grid gap-1 rounded-md border border-border/70 bg-background/60 p-2 text-[0.7rem] text-muted-foreground"
            >
              Slip height
              <input
                class="h-8 rounded border bg-background px-2 text-sm text-foreground"
                type="number"
                min="1"
                step="0.5"
                bind:value={pdfOptions.slipHeight}
              />
              <span>Positive height, in mm</span>
            </label>
            <label
              class="grid gap-1 rounded-md border border-border/70 bg-background/60 p-2 text-[0.7rem] text-muted-foreground"
            >
              Cut-off margin
              <input
                class="h-8 rounded border bg-background px-2 text-sm text-foreground"
                type="number"
                min="0"
                max="80"
                step="1"
                bind:value={pdfOptions.cutMargin}
              />
              <span>right, 0-80 mm</span>
            </label>
          </div>
          <p class="mb-2 text-xs leading-4 text-muted-foreground">
            Pages fit as many slips as their chosen height allows. The right cut-off is dashed.
          </p>
          <button
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            onclick={exportFile}>JSON file</button
          >
          <button
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            onclick={exportQuestions}><FileText class="h-3.5 w-3.5" /> Download question PDF</button
          >
          <button
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            onclick={exportAnswers}><FileText class="h-3.5 w-3.5" /> Download answer PDF</button
          >
          <div class="my-1 border-t"></div>
          <button
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            onclick={previewQuestions}><FileText class="h-3.5 w-3.5" /> Preview question print</button
          >
          <button
            class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            onclick={previewAnswers}><FileText class="h-3.5 w-3.5" /> Preview answer print</button
          >
        </div>
      </details>
      <Button variant="outline" size="sm" class="gap-1" onclick={useInRoom} disabled={questions.length === 0}>
        Use in Room
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="gap-1 text-destructive hover:text-destructive"
        onclick={() => (clearDialogOpen = true)}
        disabled={questions.length === 0}
      >
        <Trash2 class="h-3.5 w-3.5" /> Clear
      </Button>
    </div>
  </div>

  <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
    <!-- Main editor area -->
    <div class="min-h-0 flex-1 overflow-auto p-4 lg:p-6">
      <div class="mx-auto max-w-3xl">
        <div class="mb-6 grid gap-4 rounded-xl border border-border/60 bg-card p-5 shadow-sm">
          <div class="grid gap-1.5">
            <label class="text-sm font-medium" for="set-name">Set name</label>
            <input
              id="set-name"
              class="h-9 rounded-md border border-input bg-background px-3 text-sm"
              bind:value={setName}
              maxlength={120}
              placeholder="e.g. Senior Mathex Round 1"
            />
          </div>
          <div class="grid gap-1.5 cover-instructions">
            <span class="text-sm font-medium">Cover instructions</span>
            <p class="text-xs text-muted-foreground">Printed on the first tear-off slip.</p>
            <Quill bind:html={instructions} resetKey={coverResetKey} />
          </div>
        </div>
        {#if questions.length > 0 && currentQuestion}
          <div class="mb-4 flex items-center gap-3">
            <Header size="h2" class="!m-0">Question {currentQuestionIdx + 1}</Header>
          </div>
          <div class="flex flex-col gap-6 rounded-xl border border-border/60 bg-card p-6 shadow-sm">
            {#key currentQuestionIdx}
              <QuestionEditor question={currentQuestion} />
            {/key}
          </div>
        {:else}
          <div
            class="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-card p-12 shadow-sm text-center"
          >
            <div class="mb-6 text-2xl font-semibold text-foreground">Create your first question</div>
            <p class="mb-6 max-w-md text-muted-foreground">
              Start building a question set by adding a question, or import an existing set.
            </p>
            <div class="flex flex-wrap justify-center gap-3">
              <Button variant="outline" size="lg" class="gap-2" onclick={newQuestion}>
                <Plus class="h-4 w-4" /> New Question
              </Button>
            </div>
            <p class="mt-6 text-sm text-muted-foreground">
              or
              <button class="text-primary underline underline-offset-2 hover:text-primary/80" onclick={importFile}>
                import a JSON set
              </button>
            </p>
          </div>
        {/if}
      </div>
    </div>

    <!-- Sidebar -->
    <div class="w-full shrink-0 border-t border-border/40 bg-muted/20 p-3 lg:w-64 lg:border-t-0 lg:border-l">
      <Header size="h3" class="!mb-2">Questions</Header>
      <div class="flex flex-col gap-0.5 max-h-[calc(100vh-140px)] overflow-y-auto scrollbar-thin">
        {#each questions as _, i}
          <div
            class="group flex items-center gap-1 rounded-lg px-1 py-0.5 transition-colors {currentQuestionIdx === i
              ? 'bg-primary/10'
              : 'hover:bg-accent/50'}"
          >
            <button class="min-w-0 flex-1 text-left" onclick={() => (currentQuestionIdx = i)}>
              <div class="flex items-center gap-1.5">
                <span
                  class="truncate text-sm {currentQuestionIdx === i
                    ? 'font-medium text-primary'
                    : 'text-muted-foreground'}"
                >
                  {i + 1}. {questionPreview(questions[i])}
                </span>
              </div>
            </button>
            <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                class="rounded p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30"
                onclick={() => moveQuestion(i, -1)}
                disabled={i === 0}
                aria-label="Move up"
              >
                <ChevronUp class="h-3 w-3" />
              </button>
              <button
                class="rounded p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-30"
                onclick={() => moveQuestion(i, 1)}
                disabled={i === questions.length - 1}
                aria-label="Move down"
              >
                <ChevronDown class="h-3 w-3" />
              </button>
              <button
                class="rounded p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground"
                onclick={() => duplicateQuestion(i)}
                aria-label="Duplicate"
              >
                <Copy class="h-3 w-3" />
              </button>
              <button
                class="rounded p-0.5 hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                onclick={() => removeQuestion(i)}
                aria-label="Remove"
              >
                <Trash2 class="h-3 w-3" />
              </button>
            </div>
          </div>
        {:else}
          <p class="italic text-center text-sm text-muted-foreground py-4">No questions yet</p>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .cover-instructions :global(.ql-container) {
    height: 6rem;
    overflow: hidden;
  }

  .cover-instructions :global(.ql-editor) {
    height: 100%;
    overflow-y: auto;
  }
</style>
