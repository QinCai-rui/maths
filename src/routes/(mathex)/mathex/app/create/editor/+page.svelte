<script lang="ts">
  import { z } from "zod";
  import { Button, buttonVariants } from "$lib/components/ui/button";
  import { Header } from "$lib/components/ui/header";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { Question, SolutionItem } from "$lib/mathex/schemas";
  import { stripTags } from "$lib/mathex/content";
  import { toast } from "svelte-sonner";

  import QuestionEditor from "$lib/mathex/editors/QuestionEditor.svelte";

  import Plus from "@lucide/svelte/icons/plus";
  import Copy from "@lucide/svelte/icons/copy";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Upload from "@lucide/svelte/icons/upload";
  import Download from "@lucide/svelte/icons/download";
  import Trash2 from "@lucide/svelte/icons/trash-2";

  const DRAFT_KEY = "mathex-draft";
  const ROOM_SET_KEY = "mathex-room-set";

  let questions: z.infer<typeof Question>[] = $state([]);
  let currentQuestionIdx = $state(0);
  let currentQuestion = $derived(questions[currentQuestionIdx]);
  let isDirty = $state(false);
  let loaded = $state(false);

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
        allowEquivalent: q.data.allowEquivalent ?? true
      };
    }
    // New format: { contents, solutions, allowEquivalent }
    if (q.data) {
      return { ...q.data, allowEquivalent: q.data.allowEquivalent ?? true };
    }
    return {
      contents: q.contents || "",
      solutions: q.solutions ? migrateSolutions(q.solutions) : [],
      allowEquivalent: q.allowEquivalent ?? true
    };
  }

  // --- Draft persistence ---
  function saveDraft() {
    if (!loaded) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(questions));
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
      if (!Array.isArray(parsed) || parsed.length === 0) return false;
      questions = parsed.map(migrateQuestion);
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
    if (loaded && questions.length >= 0) {
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
    questions = [...questions, { contents: "", solutions: [], allowEquivalent: true }];
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
        const migrated = Array.isArray(parsed) ? parsed.map(migrateQuestion) : parsed;
        const result = z.array(Question).safeParse(migrated);
        if (!result.success) {
          toast.error(`Invalid set: ${result.error.issues[0]?.message || "bad format"}`);
          return;
        }
        if (result.data.length > 100) {
          toast.error("Set has more than 100 questions — rejected");
          return;
        }
        questions = result.data;
        currentQuestionIdx = 0;
        clearDraft();
        toast.success(`Imported ${result.data.length} question${result.data.length === 1 ? "" : "s"}`);
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
    const blob = new Blob([JSON.stringify(questions, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `set-${questions.length}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function useInRoom() {
    if (questions.length === 0) {
      toast.error("Add at least one question first");
      return;
    }
    try {
      localStorage.setItem(ROOM_SET_KEY, JSON.stringify(questions));
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
      <Button variant="outline" size="sm" class="gap-1" onclick={exportFile} disabled={questions.length === 0}>
        <Download class="h-3.5 w-3.5" /> Export
      </Button>
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
      {#if questions.length > 0 && currentQuestion}
        <div class="mx-auto max-w-3xl">
          <div class="mb-4 flex items-center gap-3">
            <Header size="h2" class="!m-0">Question {currentQuestionIdx + 1}</Header>
          </div>
          <div class="flex flex-col gap-6 rounded-xl border border-border/60 bg-card p-6 shadow-sm">
            {#key currentQuestionIdx}
              <QuestionEditor question={currentQuestion} />
            {/key}
          </div>
        </div>
      {:else}
        <div
          class="mx-auto flex max-w-3xl flex-col items-center justify-center rounded-xl border border-border/60 bg-card p-12 shadow-sm text-center"
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
