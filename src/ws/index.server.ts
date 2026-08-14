import { Server, type Namespace, type Socket } from "socket.io";

import { Server as httpServer } from "http";
import { Server as HTTPSServer } from "https";
import type { Http2SecureServer, Http2Server } from "http2";
type ServerInstance = httpServer | HTTPSServer | Http2SecureServer | Http2Server;

import {
  type RoomClientToServerEvents,
  type RoomServerToClientEvents,
  type RoomInterServerEvents,
  type RoomSocketData,
  type RoomCreateClientToServerEvents,
  type RoomCreateServerToClientEvents,
  type RoomCreateInterServerEvents,
  type RoomCreateSocketData,
  type RoomManageClientToServerEvents,
  type RoomManageServerToClientEvents,
  type RoomManageInterServerEvents,
  type RoomManageSocketData,
  type Room,
  type LogEntry,
  type LeaderboardEntry,
  RoomName,
  Question,
  SolutionType
} from "../lib/mathex/schemas";

import { z } from "zod";

import { randomBytes, randomInt } from "crypto";
import { create, all } from "mathjs";
import { RoomStore } from "../lib/mathex/rooms.server";
import { registerPhysicalCompetitionServer } from "./physical.server";
import { registerSetShareServer } from "./set-share.server";
import { registerCollaborativeSetServer } from "./collaborative-set.server";

const config = {};
const math = create(all, config);

export const createWSServer = (base: ServerInstance) => {
  const roomStore = new RoomStore();
  const rooms = roomStore.loadRooms();
  const saveRoom = (room: Room) => roomStore.save(room);
  const io = new Server(base, {
    serveClient: false,
    // Question images are embedded as data URLs in the portable question set.
    maxHttpBufferSize: 10 * 1024 * 1024
  });
  registerPhysicalCompetitionServer(io);
  registerSetShareServer(io);
  registerCollaborativeSetServer(io);
  const roomCreateNamespace: Namespace<
    RoomCreateClientToServerEvents,
    RoomCreateServerToClientEvents,
    RoomCreateInterServerEvents,
    RoomCreateSocketData
  > = io.of("/rooms");
  roomCreateNamespace.on("connection", (socket) => {
    socket.on("newRoom", (name, questions, runningTimeMs, visibilityTracking) => {
      const roomName = RoomName.parse(name);
      const roomQuestions = z.array(Question).parse(questions);
      const clampedTime = Math.min(Math.max(runningTimeMs || 16000, 1000), 60000);

      let roomId = "";
      do {
        roomId = randomInt(1_000_000).toString().padStart(6, "0");
      } while (rooms.has(roomId));
      const runToken = randomBytes(128).toString("hex").toUpperCase();
      const room: Room = {
        id: roomId,
        name: roomName,
        questions: roomQuestions,
        runToken,
        state: "lobby",
        runningTimeMs: clampedTime,
        visibilityTracking,
        players: new Map(),
        logs: []
      };
      rooms.set(roomId, room);
      saveRoom(room);
      socket.emit("goto", `/mathex/app/manage?id=${roomId}&runToken=${runToken}`);
      socket.disconnect();
    });
    socket.on("checkRoom", (id, callback) => callback(rooms.has(id)));
  });

  const roomManageNamespace = io.of(/^\/manage\-\d{6}$/) as Namespace<
    RoomManageClientToServerEvents,
    RoomManageServerToClientEvents,
    RoomManageInterServerEvents,
    RoomManageSocketData
  >;
  roomManageNamespace.on("connection", (socket) => {
    const roomId = /\d{6}/.exec(socket.nsp.name)?.[0];
    if (!roomId) throw Error("No room ID!");
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("alert", "error", "Room does not exist!");
      socket.disconnect();
      return;
    }
    const runToken = socket.handshake.query.runToken;
    if (!runToken || runToken !== rooms.get(roomId)?.runToken) {
      socket.disconnect();
      return;
    }
    const roomNamespace = io.of(`/room-${roomId}`) as Namespace<
      RoomClientToServerEvents,
      RoomServerToClientEvents,
      RoomInterServerEvents,
      RoomSocketData
    >;
    setTimeout(async () => {
      socket.emit("state", room.state);
      socket.emit("playerData", getPlayers(room));
      socket.emit("logs", room.logs);
      if (room.state === "finished") socket.emit("leaderboard", buildLeaderboard(room));
    });
    socket.on("alertAll", async (type, message) => {
      roomNamespace.emit("alert", type, message);
    });
    socket.on("start", async () => {
      if (room.state !== "lobby") return;
      room.state = "started";
      roomNamespace.emit("alert", "info", "Game has started!");
      const startedAt = Date.now();
      const firstQuestion = room.questions[0];
      for (const player of room.players.values()) {
        player.currentQuestion = 1;
        player.startingTime = startedAt;
        player.finishingTime = null;
        player.isRunning = false;
        player.runningUntil = null;
      }
      for (const playerSocket of await roomNamespace.fetchSockets()) {
        if (!playerSocket.data.name) continue;
        playerSocket.emit("gameStart", startedAt);
        playerSocket.emit(
          "newQuestion",
          firstQuestion.contents,
          answerGroups(firstQuestion),
          firstQuestion.requireAllSolutionGroups,
          firstQuestion.solutionOrderMatters,
          1
        );
      }
      saveRoom(room);
      roomManageNamespace.emit("state", room.state);
      roomManageNamespace.emit("playerData", getPlayers(room));
    });
    socket.on("finish", async () => {
      if (room.state !== "started") return;
      room.state = "finished";
      roomNamespace.emit("alert", "info", "Game has finished for everyone!");
      const finishedAt = Date.now();
      for (const player of room.players.values()) {
        if (!player.finishingTime) player.finishingTime = finishedAt;
      }
      saveRoom(room);
      const lb = buildLeaderboard(room);
      for (const playerSocket of await roomNamespace.fetchSockets()) {
        playerSocket.emit("gameFinish");
      }
      roomNamespace.emit("leaderboard", lb);
      roomManageNamespace.emit("state", room.state);
      roomManageNamespace.emit("playerData", getPlayers(room));
      roomManageNamespace.emit("leaderboard", lb);
    });
  });

  const roomNamespaces = io.of(/^\/room\-\d{6}$/) as Namespace<
    RoomClientToServerEvents,
    RoomServerToClientEvents,
    RoomInterServerEvents,
    RoomSocketData
  >;
  roomNamespaces.on("connection", (socket): void => {
    const roomId = /\d{6}/.exec(socket.nsp.name)?.[0];
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("alert", "error", "Room does not exist!");
      return;
    }
    socket.data = {
      playerId: null,
      currentQuestion: 1,
      totalQuestions: room.questions.length,
      startingTime: null,
      finishingTime: null,
      name: null,
      isRunning: false,
      runningUntil: null,
      awaySince: null,
      visibilityFlags: 0
    };
    socket.on("join", async (name, playerId) => {
      const playerName = name.trim();
      if (!playerName || playerName.length > 20 || !playerId || playerId.length > 128) return;
      const room = rooms.get(roomId);
      if (!room) {
        socket.disconnect();
        return;
      }
      const existingPlayer = room.players.get(playerId);
      if (existingPlayer) {
        socket.data = existingPlayer;
      } else {
        const duplicateName = [...room.players.values()].some(
          (player) => player.name?.toLowerCase() === playerName.toLowerCase()
        );
        if (duplicateName) {
          socket.emit("alert", "error", "That username is already in use");
          return;
        }
        socket.data.playerId = playerId;
        socket.data.name = playerName;
        room.players.set(playerId, socket.data);
        saveRoom(room);
      }
      io.of(`/manage-${room.id}`).emit("playerData", getPlayers(room));
      socket.emit("joined", socket.data.name!);
      socket.emit("questionCount", room.questions.length);
      if (room.state === "lobby") {
        socket.emit("lobby");
      } else if (room.state === "started") {
        if (socket.data.finishingTime) {
          socket.emit("gameFinish");
          socket.emit("leaderboard", buildLeaderboard(room));
          return;
        }
        const question = room.questions[socket.data.currentQuestion - 1];
        socket.emit("gameStart", socket.data.startingTime || Date.now());
        socket.emit(
          "newQuestion",
          question.contents,
          answerGroups(question),
          question.requireAllSolutionGroups,
          question.solutionOrderMatters,
          socket.data.currentQuestion
        );
        if (socket.data.runningUntil && socket.data.runningUntil > Date.now()) {
          socket.emit("running", socket.data.runningUntil - Date.now());
        }
      } else {
        socket.emit("gameFinish");
        socket.emit("leaderboard", buildLeaderboard(room));
      }
    });
    socket.on("answer", (answer) => {
      if (!socket.data.name || room.state !== "started" || socket.data.isRunning) return;

      const currentQuestion = room.questions[socket.data.currentQuestion - 1];
      socket.data.isRunning = true;
      socket.data.runningUntil = Date.now() + room.runningTimeMs;
      socket.emit("running", room.runningTimeMs);

      const submitLog: LogEntry = {
        timestamp: Date.now(),
        playerName: socket.data.name || "Unknown",
        type: "submitted",
        questionNumber: socket.data.currentQuestion,
        detail: String(answer)
      };
      room.logs.push(submitLog);
      saveRoom(room);
      roomManageNamespace.emit("log", submitLog);

      const isCorrect = checkSolution(answer, currentQuestion);
      setTimeout(async () => {
        socket.emit("answerResult", isCorrect);
        socket.data.runningUntil = Date.now() + 900;

        // Let the player see the outcome before presenting the next action.
        setTimeout(() => {
          if (isCorrect) {
            socket.emit("alert", "success", "Correct!");
            const correctLog: LogEntry = {
              timestamp: Date.now(),
              playerName: socket.data.name || "Unknown",
              type: "correct",
              questionNumber: socket.data.currentQuestion
            };
            room.logs.push(correctLog);
            saveRoom(room);
            roomManageNamespace.emit("log", correctLog);
            if (socket.data.currentQuestion >= room.questions.length) {
              socket.data.finishingTime = Date.now();
              socket.emit("alert", "success", "You have completed the questions!");
              socket.emit("gameFinish");
              socket.emit("confetti");
              socket.nsp.emit("leaderboard", buildLeaderboard(room));
              roomManageNamespace.emit("alert", "info", `${socket.data.name} has finished all questions!`);
              const finishLog: LogEntry = {
                timestamp: Date.now(),
                playerName: socket.data.name || "Unknown",
                type: "finished",
                questionNumber: socket.data.currentQuestion
              };
              room.logs.push(finishLog);
              saveRoom(room);
              roomManageNamespace.emit("log", finishLog);
              roomManageNamespace.emit("leaderboard", buildLeaderboard(room));
            } else {
              socket.data.currentQuestion++;
              saveRoom(room);
              const nextQuestion = room.questions[socket.data.currentQuestion - 1];
              socket.emit(
                "newQuestion",
                nextQuestion.contents,
                answerGroups(nextQuestion),
                nextQuestion.requireAllSolutionGroups,
                nextQuestion.solutionOrderMatters,
                socket.data.currentQuestion
              );
            }
            io.of(`/manage-${room.id}`).emit("playerData", getPlayers(room));
          } else {
            socket.emit("alert", "error", "Wrong!");
            const wrongLog: LogEntry = {
              timestamp: Date.now(),
              playerName: socket.data.name || "Unknown",
              type: "wrong",
              questionNumber: socket.data.currentQuestion,
              detail: String(answer)
            };
            room.logs.push(wrongLog);
            saveRoom(room);
            roomManageNamespace.emit("log", wrongLog);
          }
          socket.emit("stopRunning");
          socket.data.isRunning = false;
          socket.data.runningUntil = null;
          saveRoom(room);
        }, 900);
      }, room.runningTimeMs);
    });
    socket.on("visibilityChange", async (hidden) => {
      if (!room.visibilityTracking || room.state !== "started" || !socket.data.name) return;

      if (hidden && !socket.data.awaySince) {
        socket.data.awaySince = Date.now();
        socket.data.visibilityFlags++;
        const log: LogEntry = {
          timestamp: socket.data.awaySince,
          playerName: socket.data.name,
          type: "visibility",
          questionNumber: socket.data.currentQuestion,
          detail: "left the game tab"
        };
        room.logs.push(log);
        saveRoom(room);
        roomManageNamespace.emit("log", log);
        roomManageNamespace.emit("playerData", getPlayers(room));
      } else if (!hidden && socket.data.awaySince) {
        const awayMs = Date.now() - socket.data.awaySince;
        socket.data.awaySince = null;
        const log: LogEntry = {
          timestamp: Date.now(),
          playerName: socket.data.name,
          type: "visibility",
          questionNumber: socket.data.currentQuestion,
          detail: `returned after ${Math.ceil(awayMs / 1000)}s away`
        };
        room.logs.push(log);
        saveRoom(room);
        roomManageNamespace.emit("log", log);
        socket.emit(
          "alert",
          "info",
          "You left the competition tab. Your return was recorded and the host was notified."
        );
      }
    });
    setTimeout(() => io.of(`/manage-${room.id}`).emit("playerData", getPlayers(room)));
  });

  function getPlayers(room: Room) {
    const data = [...room.players.values()];
    data.sort((a, b) => {
      if (!a.startingTime && !b.startingTime) return 0;
      if (!a.startingTime) return 1;
      if (!b.startingTime) return -1;
      if (a.finishingTime && !b.finishingTime) return -1;
      if (b.finishingTime && !a.finishingTime) return 1;
      if (a.finishingTime && b.finishingTime)
        return a.finishingTime - a.startingTime - (b.finishingTime - b.startingTime);
      return b.currentQuestion - a.currentQuestion;
    });
    return data;
  }

  function buildLeaderboard(room: Room): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];
    for (const d of room.players.values()) {
      const totalMs = d.finishingTime && d.startingTime ? d.finishingTime - d.startingTime : null;
      entries.push({
        rank: 0,
        name: d.name || "Unknown",
        totalMs,
        questionsCompleted: d.currentQuestion - (d.finishingTime ? 0 : 1),
        totalQuestions: room.questions.length,
        visibilityFlags: d.visibilityFlags
      });
    }
    entries.sort((a, b) => {
      if (a.totalMs !== null && b.totalMs !== null) return a.totalMs - b.totalMs;
      if (a.totalMs !== null) return -1;
      if (b.totalMs !== null) return 1;
      return b.questionsCompleted - a.questionsCompleted;
    });
    entries.forEach((e, i) => (e.rank = i + 1));
    return entries;
  }

  return io;
};

function answerGroups(question: z.infer<typeof Question>): SolutionType[][] {
  if (!question.requireAllSolutionGroups) return [[...new Set(question.solutions.map((solution) => solution.type))]];
  const groups = new Map<number, SolutionType[]>();
  for (const solution of question.solutions) {
    const group = solution.group ?? 0;
    groups.set(group, [...new Set([...(groups.get(group) || []), solution.type])]);
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, types]) => types);
}

function matchesSolution(
  guess: string | number,
  solution: z.infer<typeof Question>["solutions"][number],
  question: z.infer<typeof Question>
) {
  if (solution.type === "number") return Number(guess) === solution.value;
  if (solution.type === "text") return String(guess).trim() === solution.value;
  if (!question.allowEquivalent) return String(guess).trim() === solution.value;
  try {
    return math.symbolicEqual(math.parse(solution.value), math.parse(String(guess)));
  } catch {
    return false;
  }
}

function checkSolution(guess: string | number | (string | number)[], question: z.infer<typeof Question>) {
  if (!question.requireAllSolutionGroups) {
    const answer = Array.isArray(guess) ? guess[0] : guess;
    return question.solutions.some((solution) => matchesSolution(answer, solution, question));
  }

  const grouped = new Map<number, z.infer<typeof Question>["solutions"]>();
  for (const solution of question.solutions) {
    const group = solution.group ?? 0;
    grouped.set(group, [...(grouped.get(group) || []), solution]);
  }
  const groups = [...grouped.entries()].sort(([a], [b]) => a - b).map(([, solutions]) => solutions);
  const answers = Array.isArray(guess) ? guess : [guess];
  if (answers.length !== groups.length || answers.some((answer) => String(answer).trim() === "")) return false;
  if (question.solutionOrderMatters) {
    return groups.every((solutions, index) =>
      solutions.some((solution) => matchesSolution(answers[index], solution, question))
    );
  }

  const usedGroups = new Set<number>();
  function matchAnswer(index: number): boolean {
    if (index === answers.length) return true;
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      if (usedGroups.has(groupIndex)) continue;
      if (!groups[groupIndex].some((solution) => matchesSolution(answers[index], solution, question))) continue;
      usedGroups.add(groupIndex);
      if (matchAnswer(index + 1)) return true;
      usedGroups.delete(groupIndex);
    }
    return false;
  }
  return matchAnswer(0);
}
