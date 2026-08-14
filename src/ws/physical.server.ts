import { randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { Namespace, Server } from "socket.io";

import {
  AddPhysicalTeamInput,
  ConfigurePhysicalCompetitionInput,
  CreatePhysicalCompetitionInput,
  EditPhysicalTeamInput,
  PhysicalCode,
  PhysicalMarkerActionInput,
  ReplacePhysicalTeamsInput,
  PhysicalTeamId,
  PhysicalUndoInput,
  type PhysicalCompetition,
  type PhysicalCreateClientToServerEvents,
  type PhysicalCreateServerToClientEvents,
  type PhysicalHostClientToServerEvents,
  type PhysicalHostServerToClientEvents,
  type PhysicalInterServerEvents,
  type PhysicalMarkerClientToServerEvents,
  type PhysicalMarkerServerToClientEvents,
  type PhysicalOperationResult,
  type PhysicalQuestionSnapshot,
  type PhysicalScoreboardClientToServerEvents,
  type PhysicalScoreboardServerToClientEvents,
  type PhysicalScoreboardSnapshot,
  type PhysicalSocketData,
  type PhysicalTeamSnapshot
} from "../lib/mathex/physical.schemas";
import { hashMarkerPin, PhysicalCompetitionStore, verifyMarkerPin } from "../lib/mathex/physical.server";

type AnyServer = Server<any, any, any, any>;
type OperationAck = ((result: PhysicalOperationResult) => void) | undefined;

const CREATE_NAMESPACE = "/physical";
const HOST_PATH = "/mathex/app/live/host";

export function registerPhysicalCompetitionServer(io: AnyServer): void {
  const store = new PhysicalCompetitionStore();
  const competitions = store.load();
  const registered = new Set<string>();

  const createNamespace: Namespace<
    PhysicalCreateClientToServerEvents,
    PhysicalCreateServerToClientEvents,
    PhysicalInterServerEvents,
    PhysicalSocketData
  > = io.of(CREATE_NAMESPACE);

  createNamespace.on("connection", (socket) => {
    socket.on("checkCompetition", (rawCode, callback) => {
      const code = PhysicalCode.safeParse(rawCode);
      callback?.(code.success && competitions.has(code.data));
    });

    socket.on("createCompetition", (rawInput, callback) => {
      const parsed = CreatePhysicalCompetitionInput.safeParse(rawInput);
      if (!parsed.success) {
        const error = parsed.error.issues[0]?.message || "Invalid competition settings";
        callback?.({ ok: false, error });
        socket.emit("error", error);
        return;
      }

      let code: string;
      do code = randomInt(1_000_000).toString().padStart(6, "0");
      while (competitions.has(code));

      const hostToken = randomBytes(32).toString("hex");
      const duplicateNames = new Set<string>();
      for (const team of parsed.data.teams) {
        const key = team.name.toLocaleLowerCase();
        if (duplicateNames.has(key)) {
          const error = "Team names must be unique";
          callback?.({ ok: false, error });
          socket.emit("error", error);
          return;
        }
        duplicateNames.add(key);
      }
      const teams = new Map(
        parsed.data.teams.map((team) => {
          const id = randomUUID();
          return [id, { id, ...team }];
        })
      );
      const competition: PhysicalCompetition = {
        code,
        name: parsed.data.name,
        hostToken,
        markerPinHash: hashMarkerPin(parsed.data.markerPin),
        questionCount: parsed.data.questionCount,
        countdownDurationMs: parsed.data.countdownDurationMs,
        state: "lobby",
        startedAt: null,
        runningSince: null,
        elapsedBeforeRunMs: 0,
        nextActionSequence: 1,
        teams,
        actions: []
      };
      competitions.set(code, competition);
      store.save(competition);
      registerCompetition(competition);

      const hostPath = `${HOST_PATH}?id=${code}&hostToken=${encodeURIComponent(hostToken)}`;
      callback?.({ ok: true, code, hostToken, hostPath });
      socket.emit("goto", hostPath);
    });
  });

  function registerCompetition(competition: PhysicalCompetition): void {
    if (registered.has(competition.code)) return;
    registered.add(competition.code);

    const hostNamespace: Namespace<
      PhysicalHostClientToServerEvents,
      PhysicalHostServerToClientEvents,
      PhysicalInterServerEvents,
      PhysicalSocketData
    > = io.of(`/physical-host-${competition.code}`);
    const markerNamespace: Namespace<
      PhysicalMarkerClientToServerEvents,
      PhysicalMarkerServerToClientEvents,
      PhysicalInterServerEvents,
      PhysicalSocketData
    > = io.of(`/physical-marker-${competition.code}`);
    const scoreboardNamespace: Namespace<
      PhysicalScoreboardClientToServerEvents,
      PhysicalScoreboardServerToClientEvents,
      PhysicalInterServerEvents,
      PhysicalSocketData
    > = io.of(`/physical-scoreboard-${competition.code}`);

    hostNamespace.use((socket, next) => {
      const token = typeof socket.handshake.auth.token === "string" ? socket.handshake.auth.token : "";
      next(safeTokenEqual(token, competition.hostToken) ? undefined : new Error("Unauthorized"));
    });
    markerNamespace.use((socket, next) => {
      const auth = socket.handshake.auth;
      const validCode = PhysicalCode.safeParse(auth.code);
      const pin = typeof auth.pin === "string" ? auth.pin : "";
      const authenticated =
        validCode.success && validCode.data === competition.code && verifyMarkerPin(pin, competition.markerPinHash);
      next(authenticated ? undefined : new Error("Unauthorized"));
    });

    const emitSnapshots = (): void => {
      const snapshot = buildSnapshot(competition);
      hostNamespace.emit("snapshot", snapshot);
      markerNamespace.emit("snapshot", snapshot);
      scoreboardNamespace.emit("snapshot", snapshot);
    };
    const commit = (): void => {
      store.save(competition);
      emitSnapshots();
    };
    const reject = (ack: OperationAck, error: string): void => ack?.({ ok: false, error });
    const accept = (ack: OperationAck): void => ack?.({ ok: true });

    hostNamespace.on("connection", (socket) => {
      socket.emit("snapshot", buildSnapshot(competition));

      socket.on("start", (ack) => {
        if (competition.state !== "lobby") return reject(ack, "Competition is not in the lobby");
        const now = Date.now();
        competition.state = "running";
        competition.startedAt = now;
        competition.runningSince = now;
        competition.elapsedBeforeRunMs = 0;
        commit();
        accept(ack);
      });
      socket.on("pause", (ack) => {
        if (competition.state !== "running") return reject(ack, "Competition is not running");
        competition.elapsedBeforeRunMs = elapsedMs(competition);
        competition.runningSince = null;
        competition.state = "paused";
        commit();
        accept(ack);
      });
      socket.on("resume", (ack) => {
        if (competition.state !== "paused") return reject(ack, "Competition is not paused");
        competition.runningSince = Date.now();
        competition.state = "running";
        commit();
        accept(ack);
      });
      socket.on("finish", (ack) => {
        if (competition.state !== "running" && competition.state !== "paused") {
          return reject(ack, "Competition has not started or is already finished");
        }
        competition.elapsedBeforeRunMs = elapsedMs(competition);
        competition.runningSince = null;
        competition.state = "finished";
        commit();
        accept(ack);
      });
      socket.on("configure", (rawInput, ack) => {
        const input = ConfigurePhysicalCompetitionInput.safeParse(rawInput);
        if (!input.success) return reject(ack, input.error.issues[0]?.message || "Invalid settings");
        if (
          competition.state !== "lobby" &&
          (input.data.questionCount !== undefined || input.data.countdownDurationMs !== undefined)
        ) {
          return reject(ack, "Question count and countdown can only be changed in the lobby");
        }
        if (input.data.name !== undefined) competition.name = input.data.name;
        if (input.data.questionCount !== undefined) competition.questionCount = input.data.questionCount;
        if (input.data.countdownDurationMs !== undefined)
          competition.countdownDurationMs = input.data.countdownDurationMs;
        if (input.data.markerPin !== undefined) competition.markerPinHash = hashMarkerPin(input.data.markerPin);
        commit();
        if (input.data.markerPin !== undefined) markerNamespace.disconnectSockets(true);
        accept(ack);
      });
      socket.on("addTeam", (rawInput, ack) => {
        const input = AddPhysicalTeamInput.safeParse(rawInput);
        if (!input.success) return reject(ack, input.error.issues[0]?.message || "Invalid team");
        const duplicate = [...competition.teams.values()].some(
          (team) => team.name.localeCompare(input.data.name, undefined, { sensitivity: "accent" }) === 0
        );
        if (duplicate) return reject(ack, "Team names must be unique");
        const id = randomUUID();
        competition.teams.set(id, { id, ...input.data });
        commit();
        accept(ack);
      });
      socket.on("editTeam", (rawInput, ack) => {
        const input = EditPhysicalTeamInput.safeParse(rawInput);
        if (!input.success) return reject(ack, input.error.issues[0]?.message || "Invalid team");
        if (!competition.teams.has(input.data.id)) return reject(ack, "Team does not exist");
        const duplicate = [...competition.teams.values()].some(
          (team) =>
            team.id !== input.data.id &&
            team.name.localeCompare(input.data.name, undefined, { sensitivity: "accent" }) === 0
        );
        if (duplicate) return reject(ack, "Team names must be unique");
        competition.teams.set(input.data.id, input.data);
        commit();
        accept(ack);
      });
      socket.on("removeTeam", (rawTeamId, ack) => {
        const teamId = PhysicalTeamId.safeParse(rawTeamId);
        if (!teamId.success || !competition.teams.has(teamId.data)) return reject(ack, "Team does not exist");
        if (competition.teams.size <= 1) return reject(ack, "A competition must have at least one team");
        competition.teams.delete(teamId.data);
        competition.actions = competition.actions.filter((action) => action.teamId !== teamId.data);
        commit();
        accept(ack);
      });
      socket.on("updateTeams", (rawInput, ack) => {
        const input = ReplacePhysicalTeamsInput.safeParse(rawInput);
        if (!input.success) return reject(ack, input.error.issues[0]?.message || "Invalid teams");
        const names = input.data.map((team) => team.name.toLocaleLowerCase());
        if (new Set(names).size !== names.length) return reject(ack, "Team names must be unique");

        const nextTeams = new Map(
          input.data.map((team) => {
            const id = team.id && competition.teams.has(team.id) ? team.id : randomUUID();
            return [id, { id, name: team.name, group: team.group }];
          })
        );
        competition.teams = nextTeams;
        competition.actions = competition.actions.filter((action) => nextTeams.has(action.teamId));
        commit();
        accept(ack);
      });
    });

    markerNamespace.on("connection", (socket) => {
      socket.emit("snapshot", buildSnapshot(competition));
      socket.on("mark", (rawInput, ack) => {
        const input = PhysicalMarkerActionInput.safeParse(rawInput);
        if (!input.success) return reject(ack, input.error.issues[0]?.message || "Invalid marker action");
        if (competition.state !== "running") return reject(ack, "Competition is not running");
        if (!competition.teams.has(input.data.teamId)) return reject(ack, "Team does not exist");
        const teamState = buildTeamSnapshot(competition, input.data.teamId);
        if (input.data.expectedQuestion !== teamState.currentQuestion) {
          return reject(ack, `Team is now on question ${teamState.currentQuestion}`);
        }
        if (input.data.expectedLastActionId !== teamState.lastActionId) {
          return reject(ack, "This team was just updated by another marker. Check its latest result and try again.");
        }
        if (teamState.currentQuestion > competition.questionCount)
          return reject(ack, "Team has completed all questions");

        competition.actions.push({
          id: randomUUID(),
          sequence: competition.nextActionSequence++,
          teamId: input.data.teamId,
          questionNumber: teamState.currentQuestion,
          action: input.data.action,
          elapsedMs: elapsedMs(competition),
          timestamp: Date.now()
        });
        commit();
        accept(ack);
      });
      socket.on("undo", (rawInput, ack) => {
        const input = PhysicalUndoInput.safeParse(rawInput);
        if (!input.success || !competition.teams.has(input.data.teamId)) return reject(ack, "Team does not exist");
        if (competition.state !== "running" && competition.state !== "paused")
          return reject(ack, "Competition is not active");
        const index = competition.actions.findLastIndex((action) => action.teamId === input.data.teamId);
        if (index < 0) return reject(ack, "Team has no action to undo");
        if (competition.actions[index].id !== input.data.actionId) {
          return reject(ack, "This team was updated by another marker. Check its latest result before undoing.");
        }
        competition.actions.splice(index, 1);
        commit();
        accept(ack);
      });
    });

    scoreboardNamespace.on("connection", (socket) => socket.emit("snapshot", buildSnapshot(competition)));
  }

  for (const competition of competitions.values()) registerCompetition(competition);
}

function elapsedMs(competition: PhysicalCompetition, now = Date.now()): number {
  if (competition.state === "running" && competition.runningSince !== null) {
    return competition.elapsedBeforeRunMs + Math.max(0, now - competition.runningSince);
  }
  return competition.elapsedBeforeRunMs;
}

function buildSnapshot(competition: PhysicalCompetition): PhysicalScoreboardSnapshot {
  const serverNow = Date.now();
  const elapsed = elapsedMs(competition, serverNow);
  const teams = [...competition.teams.keys()].map((teamId) => buildTeamSnapshot(competition, teamId));
  teams.sort((a, b) => {
    const groupOrder = (a.group || "Ungrouped").localeCompare(b.group || "Ungrouped", undefined, {
      sensitivity: "base"
    });
    return (
      groupOrder ||
      b.correct - a.correct ||
      a.correctReachedAtMs - b.correctReachedAtMs ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.id.localeCompare(b.id)
    );
  });
  const ranks = new Map<string, number>();
  for (const team of teams) {
    const group = team.group || "Ungrouped";
    const rank = (ranks.get(group) || 0) + 1;
    ranks.set(group, rank);
    team.rank = rank;
  }
  return {
    code: competition.code,
    name: competition.name,
    state: competition.state,
    questionCount: competition.questionCount,
    countdownDurationMs: competition.countdownDurationMs,
    countdownRemainingMs: competition.countdownDurationMs === null ? null : competition.countdownDurationMs - elapsed,
    elapsedMs: elapsed,
    serverNow,
    teams
  };
}

function buildTeamSnapshot(competition: PhysicalCompetition, teamId: string): PhysicalTeamSnapshot {
  const team = competition.teams.get(teamId)!;
  const actions = competition.actions
    .filter((action) => action.teamId === teamId)
    .sort((a, b) => a.sequence - b.sequence);
  const questions: PhysicalQuestionSnapshot[] = Array.from({ length: competition.questionCount }, (_, index) => ({
    questionNumber: index + 1,
    outcome: "pending",
    incorrect: 0,
    history: []
  }));
  let currentQuestion = 1;
  let correct = 0;
  let incorrect = 0;
  let skipped = 0;
  let correctReachedAtMs = 0;

  for (const action of actions) {
    const question = questions[action.questionNumber - 1];
    if (!question) continue;
    question.history.push(action);
    if (action.action === "wrong") {
      question.incorrect++;
      incorrect++;
    } else if (action.action === "correct") {
      question.outcome = "correct";
      correct++;
      correctReachedAtMs = action.elapsedMs;
      currentQuestion = Math.max(currentQuestion, action.questionNumber + 1);
    } else {
      question.outcome = "skipped";
      skipped++;
      currentQuestion = Math.max(currentQuestion, action.questionNumber + 1);
    }
  }
  return {
    ...team,
    rank: 0,
    currentQuestion,
    correct,
    incorrect,
    skipped,
    correctReachedAtMs,
    lastResult: actions.at(-1)?.action ?? null,
    lastActionId: actions.at(-1)?.id ?? null,
    canUndo: actions.length > 0,
    questions
  };
}

function safeTokenEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
