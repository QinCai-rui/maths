import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import {
  CollaborativeQuestionId,
  CollaborativeSetDraft,
  CollaborativeSetSnapshotSchema,
  DraftPdfOptions,
  DraftQuestion,
  type CollaborativeQuestionValue,
  type DraftQuestionValue,
  type QuestionLock
} from "../lib/mathex/collaborative-set.schemas";
import type { StoredAgentToken, StoredCollaborativeSet } from "../lib/mathex/collaborative-set.server";
import { pdfOptionIssues, questionIssues } from "../lib/mathex/set-issues";
import { AGENT_API_DOCS, AGENT_API_OPENAPI } from "./agent-api.docs";

/** How long an agent stays in the people rail after its last request. */
export const AGENT_PRESENCE_MS = 2 * 60_000;
export const AGENT_API_PREFIX = "/mathex/app/api";

const TOKEN_LIMIT = 60;
const IP_LIMIT = 120;
const FAILED_AUTH_LIMIT = 10;
const WINDOW_MS = 60_000;

export const newAgentSecret = () => `mxa_${randomBytes(32).toString("base64url")}`;
export const hashAgentToken = (secret: string) => createHash("sha256").update(secret).digest("hex");

export type AgentApiHandler = (request: Request, clientIp: string) => Promise<Response>;

interface AgentApiContext {
  sessions: Map<string, StoredCollaborativeSet>;
  agentTokens: Map<string, StoredAgentToken>;
  agentSeen: Map<string, number>;
  /** The first lock held on any of these questions, if one exists. */
  lockHolder(sessionToken: string, questionIds: string[]): { lock: QuestionLock } | null;
  emitPresence(sessionToken: string): void;
  emitQuestion(session: StoredCollaborativeSet, question: CollaborativeQuestionValue): void;
  saveAndEmit(session: StoredCollaborativeSet): void;
  end(session: StoredCollaborativeSet): void;
  revoke(agent: StoredAgentToken): void;
  emptyQuestion(): DraftQuestionValue;
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public headers: Record<string, string> = {}
  ) {
    super(message);
  }
}

/** Fixed one-minute windows. In memory, so limits reset on restart. */
class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  hit(key: string, limit: number, now = Date.now()): number | null {
    let window = this.windows.get(key);
    if (!window || now - window.start >= WINDOW_MS) {
      if (this.windows.size > 10_000) this.sweep(now);
      window = { start: now, count: 0 };
      this.windows.set(key, window);
    }
    window.count++;
    return window.count > limit ? Math.ceil((window.start + WINDOW_MS - now) / 1000) : null;
  }
  peek(key: string, limit: number, now = Date.now()): number | null {
    const window = this.windows.get(key);
    if (!window || now - window.start >= WINDOW_MS) return null;
    return window.count >= limit ? Math.ceil((window.start + WINDOW_MS - now) / 1000) : null;
  }
  private sweep(now: number) {
    for (const [key, window] of this.windows) if (now - window.start >= WINDOW_MS) this.windows.delete(key);
  }
}

const PatchSetInput = z
  .object({ name: z.string().max(120), instructions: z.string(), pdfOptions: DraftPdfOptions })
  .partial()
  .strict();
const AddQuestionInput = z
  .object({ question: DraftQuestion.optional(), afterQuestionId: CollaborativeQuestionId.nullable().optional() })
  .strict();
const DuplicateInput = z.object({ afterQuestionId: CollaborativeQuestionId.nullable().optional() }).strict();
const MoveInput = z.object({ toIndex: z.number().int().min(0).max(99) }).strict();
const ReplaceSetInput = z.union([
  CollaborativeSetDraft.partial().extend({ questions: CollaborativeSetDraft.shape.questions }),
  CollaborativeSetDraft.shape.questions
]);

export function createAgentApi(context: AgentApiContext): AgentApiHandler {
  const limiter = new RateLimiter();

  function authenticate(request: Request, clientIp: string) {
    const failedKey = `fail:${clientIp}`;
    const lockedOut = limiter.peek(failedKey, FAILED_AUTH_LIMIT);
    if (lockedOut) throw tooMany(lockedOut, "Too many invalid tokens. Try again later.");
    const secret = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1];
    const agent = secret ? context.agentTokens.get(hashAgentToken(secret)) : undefined;
    const session = agent && context.sessions.get(agent.sessionToken);
    if (!agent || !session || agent.expiresAt <= Date.now() || session.set.status !== "active") {
      limiter.hit(failedKey, FAILED_AUTH_LIMIT);
      throw new ApiError(401, secret ? "This token is invalid, expired or revoked" : "Missing bearer token", {
        "WWW-Authenticate": "Bearer"
      });
    }
    const retry = limiter.hit(`token:${agent.hash}`, TOKEN_LIMIT);
    if (retry) throw tooMany(retry, "Rate limit: 60 requests a minute per token");
    const now = Date.now();
    const seen = context.agentSeen.get(agent.hash);
    context.agentSeen.set(agent.hash, now);
    if (!seen || now - seen > AGENT_PRESENCE_MS) context.emitPresence(agent.sessionToken);
    return { agent, session };
  }

  function requireHost(agent: StoredAgentToken) {
    if (agent.level !== "host") throw new ApiError(403, "This needs a host-level token");
  }

  function questionAt(session: StoredCollaborativeSet, id: string) {
    const index = session.set.questions.findIndex((question) => question.id === id);
    if (index < 0) throw new ApiError(404, "Question not found");
    return index;
  }

  function assertUnlocked(session: StoredCollaborativeSet, ids: string[]) {
    const held = context.lockHolder(session.set.sessionToken, ids);
    if (!held) return;
    const number = session.set.questions.findIndex(({ id }) => id === held.lock.questionId) + 1;
    throw new ApiError(409, `${held.lock.displayName} is editing Q${number}. Try again shortly.`, {
      "Retry-After": "10"
    });
  }

  const withIssues = (question: CollaborativeQuestionValue, number: number) => ({
    number,
    ...question,
    issues: questionIssues(question)
  });

  function summary(session: StoredCollaborativeSet, agent: StoredAgentToken) {
    const { set } = session;
    return {
      name: set.name,
      instructions: set.instructions,
      pdfOptions: set.pdfOptions,
      status: set.status,
      updatedAt: set.updatedAt,
      questions: set.questions.map((question, index) => withIssues(question, index + 1)),
      printIssues: pdfOptionIssues(set.pdfOptions),
      token: { label: agent.label, level: agent.level, expiresAt: agent.expiresAt }
    };
  }

  async function route(request: Request, clientIp: string): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice(AGENT_API_PREFIX.length).replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();

    if (method === "GET" && (path === "/" || path === "/llms.txt"))
      return new Response(AGENT_API_DOCS(url.origin), {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" }
      });
    if (method === "GET" && path === "/openapi.json") return json(AGENT_API_OPENAPI(url.origin));

    const { agent, session } = authenticate(request, clientIp);
    const { set } = session;
    const body = async <T>(schema: z.ZodType<T>): Promise<T> => {
      let raw: unknown = {};
      const text = await request.text();
      if (text.trim()) {
        try {
          raw = JSON.parse(text);
        } catch {
          throw new ApiError(400, "Body must be JSON");
        }
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ApiError(400, `${issue?.path.join(".") || "body"}: ${issue?.message || "invalid"}`);
      }
      return parsed.data;
    };

    if (path === "/set") {
      if (method === "GET") return json(summary(session, agent));
      if (method === "PATCH") {
        requireHost(agent);
        const patch = await body(PatchSetInput);
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.instructions !== undefined) set.instructions = patch.instructions;
        if (patch.pdfOptions !== undefined) set.pdfOptions = patch.pdfOptions;
        context.saveAndEmit(session);
        return json(summary(session, agent));
      }
      if (method === "PUT") {
        requireHost(agent);
        const input = await body(ReplaceSetInput);
        const source = Array.isArray(input) ? { questions: input } : input;
        assertUnlocked(
          session,
          set.questions.map(({ id }) => id)
        );
        const next = CollaborativeSetSnapshotSchema.parse({
          ...set,
          name: source.name ?? "",
          instructions: source.instructions ?? "",
          pdfOptions: source.pdfOptions ?? set.pdfOptions,
          questions: source.questions.map((question) => ({ id: randomUUID(), ...question }))
        });
        Object.assign(set, next);
        context.saveAndEmit(session);
        return json(summary(session, agent));
      }
    }
    if (method === "GET" && path === "/set/export") {
      const { name, instructions, pdfOptions } = set;
      const questions = set.questions.map(({ id: _id, ...question }) => question);
      return json({ name, instructions, questions, pdfOptions });
    }
    if (method === "GET" && path === "/set/checks") {
      const questions = set.questions.flatMap((question, index) => {
        const issues = questionIssues(question);
        return issues.errors.length || issues.warnings.length
          ? [{ number: index + 1, id: question.id, ...issues }]
          : [];
      });
      const printIssues = pdfOptionIssues(set.pdfOptions);
      return json({
        ready: !questions.some((entry) => entry.errors.length) && !printIssues.length,
        questions,
        printIssues
      });
    }
    if (method === "POST" && path === "/set/end") {
      requireHost(agent);
      assertUnlocked(
        session,
        set.questions.map(({ id }) => id)
      );
      context.end(session);
      return json({ ok: true, status: "ended" });
    }
    if (method === "DELETE" && path === "/token") {
      context.revoke(agent);
      context.emitPresence(agent.sessionToken);
      return json({ ok: true });
    }

    if (path === "/questions") {
      if (method === "GET") return json(set.questions.map((question, index) => withIssues(question, index + 1)));
      if (method === "POST") {
        requireHost(agent);
        const input = await body(AddQuestionInput);
        if (set.questions.length >= 100) throw new ApiError(409, "A set can contain at most 100 questions");
        const at =
          input.afterQuestionId === null
            ? 0
            : input.afterQuestionId === undefined
              ? set.questions.length
              : questionAt(session, input.afterQuestionId) + 1;
        const question = { id: randomUUID(), ...(input.question || context.emptyQuestion()) };
        set.questions.splice(at, 0, question);
        context.saveAndEmit(session);
        return json(withIssues(question, at + 1), 201);
      }
    }

    const match = /^\/questions\/([^/]+)(\/duplicate|\/move)?$/.exec(path);
    if (match) {
      const id = match[1];
      const index = questionAt(session, id);
      const action = match[2];
      if (!action && method === "GET") return json(withIssues(set.questions[index], index + 1));
      if (!action && method === "PUT") {
        const draft = await body(DraftQuestion);
        assertUnlocked(session, [id]);
        const question = { id, ...draft };
        if (!isDeepStrictEqual(set.questions[index], question)) {
          set.questions[index] = question;
          set.updatedAt = Date.now();
          context.emitQuestion(session, question);
        }
        return json(withIssues(question, index + 1));
      }
      if (!action && method === "DELETE") {
        requireHost(agent);
        assertUnlocked(session, [id]);
        set.questions.splice(index, 1);
        context.saveAndEmit(session);
        return json({ ok: true });
      }
      if (action === "/duplicate" && method === "POST") {
        requireHost(agent);
        const input = await body(DuplicateInput);
        if (set.questions.length >= 100) throw new ApiError(409, "A set can contain at most 100 questions");
        assertUnlocked(session, [id]);
        const after = input.afterQuestionId === undefined ? id : input.afterQuestionId;
        const at = after === null ? 0 : questionAt(session, after) + 1;
        const copy = { ...structuredClone(set.questions[index]), id: randomUUID() };
        set.questions.splice(at, 0, copy);
        context.saveAndEmit(session);
        return json(withIssues(copy, at + 1), 201);
      }
      if (action === "/move" && method === "POST") {
        requireHost(agent);
        const { toIndex } = await body(MoveInput);
        if (toIndex >= set.questions.length) throw new ApiError(400, "toIndex is out of range");
        assertUnlocked(session, [id]);
        const [question] = set.questions.splice(index, 1);
        set.questions.splice(toIndex, 0, question);
        context.saveAndEmit(session);
        return json(withIssues(question, toIndex + 1));
      }
    }
    throw new ApiError(404, `No endpoint for ${method} ${path}. See ${AGENT_API_PREFIX}/llms.txt`);
  }

  return async (request, clientIp) => {
    try {
      const retry = limiter.hit(`ip:${clientIp}`, IP_LIMIT);
      if (retry) throw tooMany(retry, "Rate limit: 120 requests a minute per IP address");
      return await route(request, clientIp);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status, error.headers);
      console.error("agent api error", error);
      return json({ error: "Internal error" }, 500);
    }
  };
}

function tooMany(seconds: number, message: string) {
  return new ApiError(429, message, { "Retry-After": String(seconds) });
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers }
  });
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Adapts the fetch-style handler to Node's http request and response, for Express and Vite dev. */
export async function serveAgentApi(
  handler: AgentApiHandler,
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse
): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      response.writeHead(413, { "Content-Type": "application/json" }).end('{"error":"Body is larger than 10 MB"}');
      return;
    }
    chunks.push(chunk);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers))
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  const method = request.method || "GET";
  const result = await handler(
    new Request(`http://${request.headers.host || "localhost"}${request.url}`, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks)
    }),
    String(request.headers["cf-connecting-ip"] || request.socket.remoteAddress || "unknown")
  );
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(Buffer.from(await result.arrayBuffer()));
}
