const PREFIX = "/mathex/app/api";

export const AGENT_API_DOCS = (origin: string) => `# Mathex set editor API

Edit a live Mathex question set over HTTP. A person creates a token in the set editor
(Invite > Agent access) and gives it to you. The token works on that one set only, carries the
person's permissions (editor or host), and expires after 15 minutes to 24 hours.

Base URL: ${origin}${PREFIX}
Auth: send \`Authorization: Bearer mxa_...\` on every request except this file and /openapi.json.
Bodies and responses are JSON. Errors look like {"error": "message"}.
Machine-readable spec: ${origin}${PREFIX}/openapi.json

People may be editing at the same time. Each write applies at once and they see it live.
You appear in their people list under the token's label.

## Permissions
- editor token: read the set, edit existing questions, run checks, export JSON.
- host token: everything an editor can do, plus set title, instructions and print settings;
  add, duplicate, move and delete questions; replace the whole set (import); end the session.

## Endpoints
GET    /set                         Whole set: name, instructions, pdfOptions, status, questions (with ids and
                                    issues), printIssues, and your token's label, level and expiry.
GET    /set/export                  Portable set JSON (no ids), the same as the editor's "Download as JSON".
GET    /set/checks                  The editor's Checks panel: {ready, questions:[{number,id,errors,warnings}], printIssues}.
PATCH  /set                         host. Any of {name, instructions, pdfOptions}.
PUT    /set                         host. Replace everything, like "Import JSON" or "New blank set" ({"questions": []}).
                                    Body: {name?, instructions?, pdfOptions?, questions: [...]} or a bare array of questions.
POST   /set/end                     host. End the live session for everyone. All agent tokens stop working.
GET    /questions                   All questions, in order.
POST   /questions                   host. {question?, afterQuestionId?}. Omit afterQuestionId to append; null inserts first.
GET    /questions/{id}              One question.
PUT    /questions/{id}              Replace one question's content (a full question object, see below).
DELETE /questions/{id}              host. Delete a question.
POST   /questions/{id}/duplicate    host. {afterQuestionId?}. Defaults to right after the original.
POST   /questions/{id}/move         host. {toIndex} (0-based).
DELETE /token                       Revoke your own token when you are done.

## Question format
{
  "contents": "<p>Solve $$2x+5=17$$.</p>",
  "solutions": [{"type": "number", "value": 6, "group": 0}],
  "allowEquivalent": true,
  "answerComment": "",
  "requireAllSolutionGroups": false,
  "solutionOrderMatters": false,
  "skippable": true
}

- contents, instructions: HTML from the editor (Quill). Use <p>, <strong>, <em>, <u>, <s>, <sub>, <sup>,
  <ol>/<ul> with <li>, <a href>, <br>, and <img src="data:image/..."> for images.
  Write maths as $$LaTeX$$ inside the text, for example $$\\frac{3}{4}$$. Add [scale=1.5] after the opening $$ to
  resize an equation: $$[scale=1.5]x^2$$. Escape backslashes in JSON ("\\\\frac").
- solutions: accepted answers. type is "number" (value is a number), "text" (a string) or
  "expression" (a maths expression string such as "2x+1"; allowEquivalent accepts equivalent forms).
- Several answers in the same group are alternatives: any one is accepted.
- requireAllSolutionGroups: true makes it a multi-part question. Each group (0, 1, 2, ...) is a part and every
  part must be answered. solutionOrderMatters: the parts must be answered in order.
- answerComment: notes printed with the answer key (up to 2000 characters).
- skippable: whether players may skip the question.
- Every question response includes "issues": {errors, warnings}, the same messages as the editor's Checks panel.
  Errors block PDF export and rooms, so fix them.

pdfOptions (all millimetres except text sizes, which are points):
{"questionTextSize": 6-18, "answerTextSize": 6-16, "imageHeight": 5-35, "slipHeight": 1-297, "cutMargin": 0-80}

## Status codes
400 invalid body. 401 bad, expired or revoked token, or the session has ended. 403 needs a host token.
404 not found. 409 a person is editing that question (Retry-After given), or the set is full (100 questions).
413 body over 10 MB. 429 rate limited: wait Retry-After seconds.

## Limits
60 requests a minute per token, 120 a minute per IP address, 10 failed token checks a minute per IP address.
At most 100 questions per set.

## Not available over the API
PDFs, print previews, share links, starting a game room, undo and redo, and deleting the set.
For PDFs or a room, ask the person to open the set editor in their browser and use Export or Use in a room.
To undo a change, write the old value back (read it first with GET).

## Example
curl -H "Authorization: Bearer $TOKEN" ${origin}${PREFIX}/set
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\
  -d '{"question":{"contents":"<p>What is $$7\\\\times 8$$?</p>","solutions":[{"type":"number","value":56,"group":0}],"allowEquivalent":true}}' \\
  ${origin}${PREFIX}/questions
`;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const body = (schema: object) => ({ required: true, content: { "application/json": { schema } } });
const ok = (schema: object = { type: "object" }) => ({
  description: "OK",
  content: { "application/json": { schema } }
});
const idParam = [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }];

export const AGENT_API_OPENAPI = (origin: string) => ({
  openapi: "3.1.0",
  info: {
    title: "Mathex set editor API",
    version: "1",
    description: `Edit one live Mathex set with a short-lived agent token. Full guide: ${origin}${PREFIX}/llms.txt`
  },
  servers: [{ url: `${origin}${PREFIX}` }],
  security: [{ bearer: [] }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    schemas: {
      Solution: {
        type: "object",
        required: ["type", "value"],
        properties: {
          type: { enum: ["number", "text", "expression"] },
          value: { type: ["number", "string"] },
          group: { type: "integer", minimum: 0, maximum: 99, default: 0 }
        }
      },
      Question: {
        type: "object",
        required: ["contents", "solutions", "allowEquivalent"],
        properties: {
          contents: { type: "string", description: "Quill HTML with $$LaTeX$$ maths" },
          solutions: { type: "array", items: ref("Solution") },
          allowEquivalent: { type: "boolean" },
          answerComment: { type: "string", maxLength: 2000, default: "" },
          requireAllSolutionGroups: { type: "boolean", default: false },
          solutionOrderMatters: { type: "boolean", default: false },
          skippable: { type: "boolean", default: true }
        }
      },
      PdfOptions: {
        type: "object",
        required: ["questionTextSize", "answerTextSize", "imageHeight", "slipHeight", "cutMargin"],
        properties: {
          questionTextSize: { type: "number", minimum: 6, maximum: 18 },
          answerTextSize: { type: "number", minimum: 6, maximum: 16 },
          imageHeight: { type: "number", minimum: 5, maximum: 35 },
          slipHeight: { type: "number", minimum: 1, maximum: 297 },
          cutMargin: { type: "number", minimum: 0, maximum: 80 }
        }
      },
      SetDraft: {
        type: "object",
        required: ["questions"],
        properties: {
          name: { type: "string", maxLength: 120 },
          instructions: { type: "string" },
          pdfOptions: ref("PdfOptions"),
          questions: { type: "array", maxItems: 100, items: ref("Question") }
        }
      }
    }
  },
  paths: {
    "/set": {
      get: { summary: "Read the whole set", responses: { 200: ok() } },
      patch: {
        summary: "Host: update title, instructions or print settings",
        requestBody: body({
          type: "object",
          properties: { name: { type: "string" }, instructions: { type: "string" }, pdfOptions: ref("PdfOptions") }
        }),
        responses: { 200: ok() }
      },
      put: {
        summary: "Host: replace the whole set (import)",
        requestBody: body(ref("SetDraft")),
        responses: { 200: ok() }
      }
    },
    "/set/export": { get: { summary: "Portable set JSON", responses: { 200: ok(ref("SetDraft")) } } },
    "/set/checks": { get: { summary: "Errors and warnings, as in the Checks panel", responses: { 200: ok() } } },
    "/set/end": { post: { summary: "Host: end the live session", responses: { 200: ok() } } },
    "/questions": {
      get: { summary: "List questions", responses: { 200: ok({ type: "array" }) } },
      post: {
        summary: "Host: add a question",
        requestBody: body({
          type: "object",
          properties: {
            question: ref("Question"),
            afterQuestionId: { type: ["string", "null"], format: "uuid" }
          }
        }),
        responses: { 201: ok() }
      }
    },
    "/questions/{id}": {
      parameters: idParam,
      get: { summary: "Read a question", responses: { 200: ok() } },
      put: { summary: "Replace a question's content", requestBody: body(ref("Question")), responses: { 200: ok() } },
      delete: { summary: "Host: delete a question", responses: { 200: ok() } }
    },
    "/questions/{id}/duplicate": {
      parameters: idParam,
      post: {
        summary: "Host: duplicate a question",
        requestBody: body({ type: "object", properties: { afterQuestionId: { type: ["string", "null"] } } }),
        responses: { 201: ok() }
      }
    },
    "/questions/{id}/move": {
      parameters: idParam,
      post: {
        summary: "Host: move a question",
        requestBody: body({ type: "object", required: ["toIndex"], properties: { toIndex: { type: "integer" } } }),
        responses: { 200: ok() }
      }
    },
    "/token": { delete: { summary: "Revoke this token", responses: { 200: ok() } } }
  }
});
