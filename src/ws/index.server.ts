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
  Question
} from "../lib/mathex/schemas";

import { z } from "zod";

import { randomBytes } from "crypto";
import { create, all } from "mathjs";

const config = {};
const math = create(all, config);

export const createWSServer = (base: ServerInstance) => {
  let rooms: Map<string, Room> = new Map();
  const io = new Server(base, {
    serveClient: false
  });
  const roomCreateNamespace: Namespace<
    RoomCreateClientToServerEvents,
    RoomCreateServerToClientEvents,
    RoomCreateInterServerEvents,
    RoomCreateSocketData
  > = io.of("/rooms");
  roomCreateNamespace.on("connection", (socket) => {
    socket.on("newRoom", (name, questions, runningTimeMs) => {
      const roomName = RoomName.parse(name);
      const roomQuestions = z.array(Question).parse(questions);
      const clampedTime = Math.min(Math.max(runningTimeMs || 16000, 1000), 60000);

      const roomId = randomBytes(4).toString("hex").toUpperCase();
      const runToken = randomBytes(128).toString("hex").toUpperCase();
      rooms.set(roomId, {
        id: roomId,
        name: roomName,
        questions: roomQuestions,
        runToken,
        state: "lobby",
        runningTimeMs: clampedTime
      });
      socket.emit("goto", `/mathex/app/manage?id=${roomId}&runToken=${runToken}`);
      socket.disconnect();
    });
    socket.on("checkRoom", (id, callback) => callback(rooms.has(id)));
  });

  const roomManageNamespace = io.of(/^\/manage\-[0-9A-F]{8}$/) as Namespace<
    RoomManageClientToServerEvents,
    RoomManageServerToClientEvents,
    RoomManageInterServerEvents,
    RoomManageSocketData
  >;
  roomManageNamespace.on("connection", (socket) => {
    const roomId = /[0-9A-F]{8}/gm.exec(socket.nsp.name)?.[0];
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
      socket.emit("playerData", await getPlayers(roomNamespace));
    });
    socket.on("alertAll", async (type, message) => {
      roomNamespace.emit("alert", type, message);
    });
    socket.on("start", async () => {
      room.state = "started";
      roomNamespace.emit("alert", "info", "Game has started!");
      const firstQuestion = room.questions[0];
      for (const playerSocket of await roomNamespace.fetchSockets()) {
        if (!playerSocket.data.name) return;
        playerSocket.emit("gameStart");
        playerSocket.emit("newQuestion", firstQuestion.data.contents, firstQuestion.type);
        playerSocket.data.startingTime = Date.now();
      }
      roomManageNamespace.emit("state", room.state);
      roomManageNamespace.emit("playerData", await getPlayers(roomNamespace));
    });
    socket.on("finish", async () => {
      room.state = "finished";
      roomNamespace.emit("alert", "info", "Game has finished for everyone!");
      const lb = buildLeaderboard(room, roomNamespace);
      for (const playerSocket of await roomNamespace.fetchSockets()) {
        if (!playerSocket.data.finishingTime) {
          playerSocket.data.finishingTime = Date.now();
          playerSocket.emit("gameFinish");
        }
      }
      roomNamespace.emit("leaderboard", lb);
      roomManageNamespace.emit("state", room.state);
      roomManageNamespace.emit("playerData", await getPlayers(roomNamespace));
      roomManageNamespace.emit("leaderboard", lb);
    });
  });

  const roomNamespaces = io.of(/^\/room\-[0-9A-F]{8}$/) as Namespace<
    RoomClientToServerEvents,
    RoomServerToClientEvents,
    RoomInterServerEvents,
    RoomSocketData
  >;
  roomNamespaces.on("connection", (socket): void => {
    const roomId = /[0-9A-F]{8}/gm.exec(socket.nsp.name)?.[0];
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit("alert", "error", "Room does not exist!");
      return;
    }
    socket.data = {
      currentQuestion: 1,
      totalQuestions: room.questions.length,
      startingTime: null,
      finishingTime: null,
      name: null,
      isRunning: false
    };
    socket.on("join", async (name) => {
      if (!name || name.length > 20) return;
      const room = rooms.get(roomId);
      if (!room) {
        socket.disconnect();
        return;
      }
      socket.data.name = name;
      io.of(`/manage-${room.id}`).emit("playerData", await getPlayers(socket.nsp));
      socket.emit("questionCount", room.questions.length);
      if (room.state === "lobby") {
        socket.emit("lobby");
      } else if (room.state === "started") {
        socket.emit("gameStart");
        socket.data.startingTime = Date.now();
        const firstQuestion = room.questions[0];
        socket.emit("newQuestion", firstQuestion.data.contents, firstQuestion.type);
      } else {
        socket.emit("gameFinish");
      }
    });
    socket.on("answer", (answer) => {
      if (socket.data.isRunning) return;

      const currentQuestion = room.questions[socket.data.currentQuestion - 1];
      socket.data.isRunning = true;
      socket.emit("running", room.runningTimeMs);

      const submitLog: LogEntry = {
        timestamp: Date.now(),
        playerName: socket.data.name || "Unknown",
        type: "submitted",
        questionNumber: socket.data.currentQuestion,
        detail: String(answer)
      };
      roomManageNamespace.emit("log", submitLog);

      const isCorrect = checkSolution(answer, currentQuestion);
      setTimeout(async () => {
        if (isCorrect) {
          socket.emit("alert", "success", "Correct!");
          const correctLog: LogEntry = {
            timestamp: Date.now(),
            playerName: socket.data.name || "Unknown",
            type: "correct",
            questionNumber: socket.data.currentQuestion
          };
          roomManageNamespace.emit("log", correctLog);
          if (socket.data.currentQuestion >= room.questions.length) {
            socket.data.finishingTime = Date.now();
            socket.emit("alert", "success", "You have completed the questions!");
            socket.emit("gameFinish");
            socket.emit("confetti");
            socket.nsp.emit("leaderboard", buildLeaderboard(room, socket.nsp));
            roomManageNamespace.emit("alert", "info", `${socket.data.name} has finished all questions!`);
            const finishLog: LogEntry = {
              timestamp: Date.now(),
              playerName: socket.data.name || "Unknown",
              type: "finished",
              questionNumber: socket.data.currentQuestion
            };
            roomManageNamespace.emit("log", finishLog);
            roomManageNamespace.emit("leaderboard", buildLeaderboard(room, socket.nsp));
          } else {
            socket.data.currentQuestion++;
            const nextQuestion = room.questions[socket.data.currentQuestion - 1];
            socket.emit("newQuestion", nextQuestion.data.contents, nextQuestion.type);
          }
          io.of(`/manage-${room.id}`).emit("playerData", await getPlayers(socket.nsp));
        } else {
          socket.emit("alert", "error", "Wrong!");
          const wrongLog: LogEntry = {
            timestamp: Date.now(),
            playerName: socket.data.name || "Unknown",
            type: "wrong",
            questionNumber: socket.data.currentQuestion,
            detail: String(answer)
          };
          roomManageNamespace.emit("log", wrongLog);
        }
        socket.emit("stopRunning");
        socket.data.isRunning = false;
      }, room.runningTimeMs);
    });
    setTimeout(async () => io.of(`/manage-${room.id}`).emit("playerData", await getPlayers(socket.nsp)));
  });

  async function getPlayers(
    ns: Namespace<RoomClientToServerEvents, RoomServerToClientEvents, RoomInterServerEvents, RoomSocketData>
  ) {
    let data: RoomSocketData[] = [];
    for (const playerSocket of await ns.fetchSockets()) {
      data.push(playerSocket.data);
    }
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

  function buildLeaderboard(
    room: Room,
    ns: Namespace<RoomClientToServerEvents, RoomServerToClientEvents, RoomInterServerEvents, RoomSocketData>
  ): LeaderboardEntry[] {
    const players = ns.sockets;
    const entries: LeaderboardEntry[] = [];
    for (const [, playerSocket] of players) {
      const d = playerSocket.data;
      const totalMs = d.finishingTime && d.startingTime ? d.finishingTime - d.startingTime : null;
      entries.push({
        rank: 0,
        name: d.name || "Unknown",
        totalMs,
        questionsCompleted: d.currentQuestion - (d.finishingTime ? 0 : 1),
        totalQuestions: room.questions.length
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

function checkSolution(guess: any, question: z.infer<typeof Question>) {
  const solutions = question.data.solutions;
  for (const solution of solutions) {
    if (solution.type === "number") {
      if (Number(guess) === solution.value) return true;
    } else if (solution.type === "text") {
      if (String(guess).trim() === solution.value) return true;
    } else if (solution.type === "expression") {
      if (question.type === "expression" && !question.data.allowEquivalent) {
        if (String(guess).trim() === solution.value) return true;
      } else {
        try {
          if (math.symbolicEqual(math.parse(solution.value), math.parse(String(guess)))) return true;
        } catch {}
      }
    }
  }
  return false;
}
