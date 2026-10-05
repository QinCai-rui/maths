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
  type SolutionType,
  RoomName,
  Question
} from "../lib/mathex/schemas";

import { z } from "zod";

import { createHash, randomBytes, randomInt } from "crypto";
import { create, all } from "mathjs";
import { RoomStore } from "../lib/mathex/rooms.server";
import { buildLeaderboard, sortedPlayers as getPlayers, sanitizeRoomSettings } from "../lib/mathex/room-state";
import { registerPhysicalCompetitionServer } from "./physical.server";
import { registerSetShareServer } from "./set-share.server";
import { registerCollaborativeSetServer } from "./collaborative-set.server";

const config = {};
const math = create(all, config);

export const createWSServer = (base: ServerInstance) => {
  const roomStore = new RoomStore();
  const rooms = roomStore.loadRooms();
  const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();
  const saveRoom = (room: Room) => {
    const pending = pendingSaves.get(room.id);
    if (pending !== undefined) clearTimeout(pending);
    pendingSaves.delete(room.id);
    roomStore.save(room);
  };
  function saveChatSoon(room: Room) {
    if (pendingSaves.has(room.id)) return;
    pendingSaves.set(
      room.id,
      setTimeout(() => saveRoom(room), 250)
    );
  }
  const endTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const answerTimers = new Set<ReturnType<typeof setTimeout>>();
  const chatRates = new Map<string, number[]>();
  function later(callback: () => void, delay: number) {
    const timer = setTimeout(() => {
      answerTimers.delete(timer);
      callback();
    }, delay);
    answerTimers.add(timer);
  }
  const io = new Server(base, {
    serveClient: false,
    // Leave non-Socket.IO upgrade requests (e.g. Vite's dev WebSocket) alone.
    // Engine.IO otherwise ends them after destroyUpgradeTimeout (1s), which makes
    // `bun run dev` hard-refresh the browser every second.
    destroyUpgrade: false,
    // Question images are embedded as data URLs in the portable question set.
    maxHttpBufferSize: envInteger("MATHEX_MAX_HTTP_BUFFER_BYTES", 10 * 1024 * 1024, 1_048_576, 52_428_800)
  });
  registerPhysicalCompetitionServer(io);
  registerSetShareServer(io);
  const collaborativeSets = registerCollaborativeSetServer(io);
  const roomCreateNamespace: Namespace<
    RoomCreateClientToServerEvents,
    RoomCreateServerToClientEvents,
    RoomCreateInterServerEvents,
    RoomCreateSocketData
  > = io.of("/rooms");
  roomCreateNamespace.on("connection", (socket) => {
    socket.on("newRoom", (name, questions, runningTimeMs, visibilityTracking, settings) => {
      const parsedName = RoomName.safeParse(name);
      const parsedQuestions = z.array(Question).min(1).max(100).safeParse(questions);
      if (!parsedName.success || !parsedQuestions.success) {
        socket.emit("error", "Enter a valid room name and a set of 1 to 100 questions.");
        return;
      }
      const roomName = parsedName.data;
      const roomQuestions = parsedQuestions.data;
      const clampedTime = Number.isFinite(runningTimeMs) ? Math.min(Math.max(runningTimeMs, 1000), 60000) : 16000;

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
        logs: [],
        settings: sanitizeRoomSettings(settings),
        endsAt: null,
        startedAt: null,
        chat: []
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
    const roomManageNamespace = io.of(`/manage-${roomId}`);
    setTimeout(() => {
      socket.emit("state", room.state);
      socket.emit("playerData", getPlayers(room));
      socket.emit("logs", room.logs);
      socket.emit("questionCount", room.questions.length);
      socket.emit("roomSettings", room.settings);
      socket.emit("gameEndsAt", room.endsAt);
      socket.emit("chatHistory", room.chat);
      socket.emit("leaderboard", buildLeaderboard(room));
    });
    socket.on("alertAll", async (type, message) => {
      emitToMembers(room, "alert", type, message);
    });
    socket.on("start", () => {
      if (room.state !== "lobby") return;
      room.state = "started";
      emitToMembers(room, "alert", "info", "Game has started!");
      const startedAt = Date.now();
      room.startedAt = startedAt;
      const firstQuestion = room.questions[0];
      for (const player of room.players.values()) {
        player.currentQuestion = 1;
        player.startingTime = startedAt;
        player.finishingTime = null;
        player.isRunning = false;
        player.runningUntil = null;
        player.correctCount = 0;
        player.questionsCompleted = 0;
        player.correctReachedAtMs = null;
        player.skips = 0;
        player.awaySince = null;
      }
      for (const playerSocket of roomNamespace.sockets.values()) {
        if (!isMember(room, playerSocket.data)) continue;
        playerSocket.emit("gameStart", startedAt);
        playerSocket.emit(
          "newQuestion",
          firstQuestion.contents,
          answerGroups(firstQuestion),
          firstQuestion.requireAllSolutionGroups,
          firstQuestion.solutionOrderMatters,
          1,
          firstQuestion.skippable
        );
      }
      room.endsAt = room.settings.gameTimerMs ? startedAt + room.settings.gameTimerMs : null;
      if (room.endsAt !== null) scheduleEndTimer(room);
      saveRoom(room);
      emitToMembers(room, "roomSettings", room.settings);
      emitToMembers(room, "gameEndsAt", room.endsAt);
      io.of(`/manage-${room.id}`).emit("gameEndsAt", room.endsAt);
      publishLeaderboard(room);
      roomManageNamespace.emit("state", room.state);
      roomManageNamespace.emit("playerData", getPlayers(room));
    });
    socket.on("finish", () => finishRoom(room, "Game has finished for everyone!"));
    socket.on("updateSettings", (partial) => {
      if (!partial || typeof partial !== "object") return;
      const next = { ...room.settings };
      for (const key of [
        "allowLateJoin",
        "showLeaderboard",
        "allowCalculator",
        "allowChat",
        "allowSketch",
        "endOnPerfectScore"
      ] as const) {
        if (typeof partial[key] === "boolean") next[key] = partial[key];
      }
      room.settings = next;
      saveRoom(room);
      emitToMembers(room, "roomSettings", next);
      io.of(`/manage-${room.id}`).emit("roomSettings", next);
      if (next.allowChat) emitToMembers(room, "chatHistory", room.chat);
      publishLeaderboard(room);
      if (next.endOnPerfectScore && room.state === "started") {
        const winner = [...room.players.values()].find((player) => player.correctCount === room.questions.length);
        if (winner) finishRoom(room, `${winner.name} answered every question correctly. The game has finished.`);
      }
    });
    socket.on("setGameTimer", (minutes) => {
      if (minutes !== null && (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0)) return;
      const ms = minutes ? Math.round(Math.min(Math.max(minutes, 0.5), 480) * 60000) : null;
      room.settings.gameTimerMs = ms;
      clearEndTimer(room.id);
      if (room.state === "started") {
        room.endsAt = ms === null ? null : Date.now() + ms;
        if (room.endsAt !== null) scheduleEndTimer(room);
      }
      saveRoom(room);
      emitToMembers(room, "roomSettings", room.settings);
      emitToMembers(room, "gameEndsAt", room.endsAt);
      io.of(`/manage-${room.id}`).emit("roomSettings", room.settings);
      io.of(`/manage-${room.id}`).emit("gameEndsAt", room.endsAt);
    });
    socket.on("kick", (playerId) => {
      const target = room.players.get(playerId);
      if (!target) return;
      room.players.delete(playerId);
      chatRates.delete(`${room.id}:${playerId}`);
      target.isRunning = false;
      target.runningUntil = null;
      appendLog(room, {
        timestamp: Date.now(),
        playerName: target.name || "Unknown",
        playerId,
        type: "kicked",
        questionNumber: target.currentQuestion
      });
      for (const peer of roomNamespace.sockets.values()) {
        if (peer.data.playerId === playerId) {
          peer.emit("kicked");
          peer.disconnect(true);
        }
      }
      publishPlayers(room);
      publishLeaderboard(room);
    });
    socket.on("deleteChat", (id) => {
      if (typeof id !== "string" || !room.chat.some((message) => message.id === id)) return;
      room.chat = room.chat.filter((message) => message.id !== id);
      saveRoom(room);
      emitToMembers(room, "chatDeleted", id);
      io.of(`/manage-${room.id}`).emit("chatDeleted", id);
    });
    socket.on("muteChat", (playerId, muted) => {
      const player = room.players.get(playerId);
      if (!player || typeof muted !== "boolean") return;
      player.chatMuted = muted;
      appendLog(room, {
        timestamp: Date.now(),
        playerName: player.name || "Unknown",
        playerId: player.playerId!,
        type: "moderation",
        questionNumber: player.currentQuestion,
        detail: muted ? "muted in chat" : "unmuted in chat"
      });
      for (const peer of roomNamespace.sockets.values())
        if (peer.data.playerId === playerId) peer.emit("chatMuted", muted);
      publishPlayers(room);
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
      socket.disconnect();
      return;
    }
    const roomManageNamespace = io.of(`/manage-${roomId}`);
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
      visibilityFlags: 0,
      skips: 0,
      correctCount: 0,
      questionsCompleted: 0,
      correctReachedAtMs: null,
      chatMuted: false
    };
    socket.on("join", (name, playerId) => {
      if (typeof name !== "string" || typeof playerId !== "string") return;
      if (socket.data.playerId && socket.data.playerId !== playerId) {
        socket.emit("joinDenied", "You have already joined this room.");
        return;
      }
      const playerName = name.trim();
      if (!playerName || playerName.length > 20 || !playerId || playerId.length > 128) {
        socket.emit("joinDenied", "Choose a name of 1 to 20 characters.");
        return;
      }
      const room = rooms.get(roomId);
      if (!room) {
        socket.disconnect();
        return;
      }
      const existingPlayer = room.players.get(playerId);
      if (existingPlayer) {
        socket.data = existingPlayer;
      } else {
        // Public standings/chat ids are 64-hex hashes, never issued as private
        // reconnect ids (clients generate UUIDs). Reject them as fresh identities.
        if (/^[0-9a-f]{64}$/.test(playerId)) {
          socket.emit("joinDenied", "That ID is not valid for a new player. Rejoin with your original link.");
          return;
        }
        if (room.state !== "lobby" && !room.settings.allowLateJoin) {
          socket.emit("joinDenied", "Late joining is disabled for this game.");
          return;
        }
        const duplicateName = [...room.players.values()].some(
          (player) => player.name?.toLowerCase() === playerName.toLowerCase()
        );
        if (duplicateName) {
          socket.emit("joinDenied", "That username is already in use");
          return;
        }
        socket.data.playerId = playerId;
        socket.data.name = playerName;
        if (room.state === "started") socket.data.startingTime = room.startedAt ?? Date.now();
        room.players.set(playerId, socket.data);
        saveRoom(room);
      }
      io.of(`/manage-${room.id}`).emit("playerData", getPlayers(room));
      socket.emit("joined", socket.data.name!);
      socket.emit("playerIdentity", publicPlayerId(room, socket.data.playerId!));
      socket.emit("questionCount", room.questions.length);
      socket.emit("roomSettings", room.settings);
      socket.emit("gameEndsAt", room.endsAt);
      socket.emit("chatMuted", socket.data.chatMuted);
      if (room.settings.allowChat) socket.emit("chatHistory", room.chat);
      if (room.settings.showLeaderboard || room.state === "finished")
        socket.emit("leaderboard", playerLeaderboard(room));
      publishLeaderboard(room);
      if (room.state === "lobby") {
        socket.emit("lobby");
      } else if (room.state === "started") {
        if (socket.data.finishingTime) {
          socket.emit("gameFinish");
          socket.emit("leaderboard", playerLeaderboard(room));
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
          socket.data.currentQuestion,
          question.skippable
        );
        if (socket.data.runningUntil && socket.data.runningUntil > Date.now()) {
          socket.emit("running", socket.data.runningUntil - Date.now());
        }
      } else {
        socket.emit("gameFinish");
        socket.emit("leaderboard", playerLeaderboard(room));
      }
    });
    socket.on("answer", (answer) => {
      if (!canPlay(room, socket.data)) return;
      if (!(typeof answer === "string" || typeof answer === "number" || Array.isArray(answer))) return;
      if (
        Array.isArray(answer) &&
        (answer.length > 100 || answer.some((value) => typeof value !== "string" && typeof value !== "number"))
      )
        return;
      if (String(answer).length > 10000) return;
      const player = socket.data;
      const questionNumber = player.currentQuestion;
      const attemptValid = () => canFinishAnswer(room, player, questionNumber);

      const currentQuestion = room.questions[socket.data.currentQuestion - 1];
      socket.data.isRunning = true;
      socket.data.runningUntil = Date.now() + room.runningTimeMs;
      emitToPlayer(room, socket.data, "running", room.runningTimeMs);

      const submitLog: LogEntry = {
        timestamp: Date.now(),
        playerName: socket.data.name || "Unknown",
        playerId: socket.data.playerId!,
        type: "submitted",
        questionNumber: socket.data.currentQuestion,
        detail: String(answer)
      };
      room.logs.push(submitLog);
      saveRoom(room);
      roomManageNamespace.emit("log", submitLog);

      const isCorrect = checkSolution(answer, currentQuestion);
      const decidedAt = Date.now();
      later(() => {
        if (!attemptValid()) return;
        emitToPlayer(room, player, "answerResult", isCorrect);
        player.runningUntil = Date.now() + 900;

        // Let the player see the outcome before presenting the next action.
        later(() => {
          if (!attemptValid()) return;
          socket.data = player;
          if (isCorrect) {
            player.correctCount++;
            player.questionsCompleted++;
            player.correctReachedAtMs = decidedAt;
            emitToPlayer(room, player, "alert", "success", "Correct!");
            const correctLog: LogEntry = {
              timestamp: decidedAt,
              playerName: socket.data.name || "Unknown",
              playerId: player.playerId!,
              type: "correct",
              questionNumber: socket.data.currentQuestion
            };
            room.logs.push(correctLog);
            saveRoom(room);
            roomManageNamespace.emit("log", correctLog);
            if (room.settings.endOnPerfectScore && player.correctCount === room.questions.length) {
              emitToPlayer(room, player, "confetti");
              finishRoom(room, `${player.name} answered every question correctly. The game has finished.`);
              return;
            }
            if (socket.data.currentQuestion >= room.questions.length) {
              socket.data.finishingTime = Date.now();
              emitToPlayer(room, player, "alert", "success", "You have completed the questions!");
              emitToPlayer(room, player, "gameFinish");
              emitToPlayer(room, player, "confetti");
              emitToPlayer(room, player, "leaderboard", playerLeaderboard(room));
              publishLeaderboard(room);
              roomManageNamespace.emit("alert", "info", `${socket.data.name} has finished all questions!`);
              const finishLog: LogEntry = {
                timestamp: Date.now(),
                playerName: socket.data.name || "Unknown",
                playerId: player.playerId!,
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
              emitToPlayer(
                room,
                player,
                "newQuestion",
                nextQuestion.contents,
                answerGroups(nextQuestion),
                nextQuestion.requireAllSolutionGroups,
                nextQuestion.solutionOrderMatters,
                socket.data.currentQuestion,
                nextQuestion.skippable
              );
            }
            io.of(`/manage-${room.id}`).emit("playerData", getPlayers(room));
            publishLeaderboard(room);
          } else {
            emitToPlayer(room, player, "alert", "error", "Wrong!");
            const wrongLog: LogEntry = {
              timestamp: Date.now(),
              playerName: socket.data.name || "Unknown",
              playerId: player.playerId!,
              type: "wrong",
              questionNumber: socket.data.currentQuestion,
              detail: String(answer)
            };
            room.logs.push(wrongLog);
            saveRoom(room);
            roomManageNamespace.emit("log", wrongLog);
          }
          emitToPlayer(room, player, "stopRunning");
          socket.data.isRunning = false;
          socket.data.runningUntil = null;
          saveRoom(room);
        }, 900);
      }, room.runningTimeMs);
    });
    socket.on("skip", () => {
      if (!canPlay(room, socket.data)) return;
      if (socket.data.currentQuestion > room.questions.length) return;

      const currentQuestion = room.questions[socket.data.currentQuestion - 1];
      if (!currentQuestion.skippable) return;

      socket.data.skips++;
      socket.data.questionsCompleted++;

      const skipLog: LogEntry = {
        timestamp: Date.now(),
        playerName: socket.data.name || "Unknown",
        playerId: socket.data.playerId!,
        type: "skipped",
        questionNumber: socket.data.currentQuestion
      };
      room.logs.push(skipLog);
      saveRoom(room);
      roomManageNamespace.emit("log", skipLog);

      if (socket.data.currentQuestion >= room.questions.length) {
        socket.data.finishingTime = Date.now();
        emitToPlayer(room, socket.data, "gameFinish");
        emitToPlayer(room, socket.data, "leaderboard", playerLeaderboard(room));
        publishLeaderboard(room);
        roomManageNamespace.emit("alert", "info", `${socket.data.name} has finished (skipped last question)`);
        const finishLog: LogEntry = {
          timestamp: Date.now(),
          playerName: socket.data.name || "Unknown",
          playerId: socket.data.playerId!,
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
        emitToPlayer(room, socket.data, "alert", "info", "Question skipped");
        const nextQuestion = room.questions[socket.data.currentQuestion - 1];
        emitToPlayer(
          room,
          socket.data,
          "newQuestion",
          nextQuestion.contents,
          answerGroups(nextQuestion),
          nextQuestion.requireAllSolutionGroups,
          nextQuestion.solutionOrderMatters,
          socket.data.currentQuestion,
          nextQuestion.skippable
        );
      }
      io.of(`/manage-${room.id}`).emit("playerData", getPlayers(room));
      publishLeaderboard(room);
    });
    socket.on("sendChat", (text) => {
      if (!isMember(room, socket.data) || !room.settings.allowChat || socket.data.chatMuted || typeof text !== "string")
        return;
      const clean = text.trim().slice(0, 500);
      if (!clean) return;
      const key = `${room.id}:${socket.data.playerId}`;
      const now = Date.now();
      const recent = (chatRates.get(key) ?? []).filter((time) => now - time < 10000);
      if (recent.length >= 5) {
        socket.emit("alert", "warning", "Please wait before sending more messages.");
        return;
      }
      chatRates.set(key, [...recent, now]);
      const message = {
        id: randomBytes(8).toString("hex"),
        playerId: publicPlayerId(room, socket.data.playerId!),
        name: socket.data.name!,
        text: clean,
        timestamp: now
      };
      room.chat = [...room.chat, message].slice(-200);
      saveChatSoon(room);
      emitToMembers(room, "chatMessage", message);
      io.of(`/manage-${room.id}`).emit("chatMessage", message);
    });
    socket.on("visibilityChange", (hidden) => {
      if (typeof hidden !== "boolean") return;
      if (!room.visibilityTracking || room.state !== "started" || !isMember(room, socket.data)) return;

      if (hidden && !socket.data.awaySince) {
        socket.data.awaySince = Date.now();
        socket.data.visibilityFlags++;
        const log: LogEntry = {
          timestamp: socket.data.awaySince,
          playerName: socket.data.name || "Unknown",
          playerId: socket.data.playerId!,
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
          playerName: socket.data.name || "Unknown",
          playerId: socket.data.playerId!,
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

  function isMember(room: Room, player: RoomSocketData) {
    return !!player.playerId && room.players.get(player.playerId) === player;
  }

  function canPlay(room: Room, player: RoomSocketData) {
    if (room.state === "started" && room.endsAt !== null && room.endsAt <= Date.now())
      finishRoom(room, "Time is up! The game has finished.");
    return (
      isMember(room, player) &&
      room.state === "started" &&
      !player.isRunning &&
      player.finishingTime === null &&
      player.questionsCompleted < room.questions.length
    );
  }

  function canFinishAnswer(room: Room, player: RoomSocketData, questionNumber: number) {
    if (room.state === "started" && room.endsAt !== null && room.endsAt <= Date.now())
      finishRoom(room, "Time is up! The game has finished.");
    return (
      isMember(room, player) &&
      room.state === "started" &&
      player.isRunning &&
      player.finishingTime === null &&
      player.currentQuestion === questionNumber
    );
  }

  function emitToPlayer<E extends keyof RoomServerToClientEvents>(
    room: Room,
    player: RoomSocketData,
    event: E,
    ...args: Parameters<RoomServerToClientEvents[E]>
  ) {
    const namespace = io.of(`/room-${room.id}`) as Namespace<
      RoomClientToServerEvents,
      RoomServerToClientEvents,
      RoomInterServerEvents,
      RoomSocketData
    >;
    for (const peer of namespace.sockets.values()) {
      if (peer.data.playerId === player.playerId) peer.emit(event, ...args);
    }
  }

  function emitToMembers<E extends keyof RoomServerToClientEvents>(
    room: Room,
    event: E,
    ...args: Parameters<RoomServerToClientEvents[E]>
  ) {
    const namespace = io.of(`/room-${room.id}`) as Namespace<
      RoomClientToServerEvents,
      RoomServerToClientEvents,
      RoomInterServerEvents,
      RoomSocketData
    >;
    for (const peer of namespace.sockets.values()) {
      if (isMember(room, peer.data)) peer.emit(event, ...args);
    }
  }

  function appendLog(room: Room, entry: LogEntry) {
    room.logs.push(entry);
    saveRoom(room);
    io.of(`/manage-${room.id}`).emit("log", entry);
  }

  function publishPlayers(room: Room) {
    io.of(`/manage-${room.id}`).emit("playerData", getPlayers(room));
  }

  function publishLeaderboard(room: Room) {
    const leaderboard = buildLeaderboard(room);
    io.of(`/manage-${room.id}`).emit("leaderboard", leaderboard);
    if (room.settings.showLeaderboard || room.state === "finished")
      emitToMembers(room, "leaderboard", playerLeaderboard(room));
  }

  // Reconnect credentials must never appear in player-visible standings or chat.
  function publicPlayerId(room: Room, playerId: string) {
    return createHash("sha256").update(room.runToken).update(":").update(playerId).digest("hex");
  }

  function playerLeaderboard(room: Room) {
    return buildLeaderboard(room).map((entry) => ({ ...entry, playerId: publicPlayerId(room, entry.playerId) }));
  }

  function clearEndTimer(id: string) {
    const timer = endTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    endTimers.delete(id);
  }

  function scheduleEndTimer(room: Room) {
    clearEndTimer(room.id);
    if (room.endsAt === null) return;
    endTimers.set(
      room.id,
      setTimeout(() => finishRoom(room, "Time is up! The game has finished."), Math.max(0, room.endsAt - Date.now()))
    );
  }

  function finishRoom(room: Room, message: string) {
    if (room.state !== "started") return;
    clearEndTimer(room.id);
    room.state = "finished";
    room.endsAt = null;
    const now = Date.now();
    for (const player of room.players.values()) {
      if (player.startingTime !== null) player.finishingTime ??= now;
      player.isRunning = false;
      player.runningUntil = null;
    }
    saveRoom(room);
    emitToMembers(room, "alert", "info", message);
    emitToMembers(room, "stopRunning");
    emitToMembers(room, "gameFinish");
    emitToMembers(room, "gameEndsAt", null);
    io.of(`/manage-${room.id}`).emit("state", room.state);
    io.of(`/manage-${room.id}`).emit("gameEndsAt", null);
    publishPlayers(room);
    publishLeaderboard(room);
  }

  for (const room of rooms.values()) {
    if (room.state === "started" && room.endsAt !== null) scheduleEndTimer(room);
  }

  return {
    io,
    flush: collaborativeSets.flush,
    dispose: () => {
      for (const id of pendingSaves.keys()) {
        const room = rooms.get(id);
        if (room) saveRoom(room);
      }
      for (const timer of endTimers.values()) clearTimeout(timer);
      for (const timer of answerTimers) clearTimeout(timer);
      endTimers.clear();
      answerTimers.clear();
      chatRates.clear();
    }
  };
};

function envInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

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
  if (solution.type === "text") return String(guess).trim().toLowerCase() === solution.value.trim().toLowerCase();
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
