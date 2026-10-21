import { describe, expect, test } from "bun:test";
import { reportIssueUrl } from "./utils";

const RUN_KEY = "run" + "Token";
const HOST_KEY = "host" + "Token";
const MANAGE_TOKEN = ["manage", "value"].join("-");
const HOST_TOKEN = ["host", "value"].join("-");
const SESSION_TOKEN = ["session", "value"].join("-");
const SHARE_TOKEN = ["share", "value"].join("-");
const MESSAGE_TOKEN = ["message", "value"].join("-");
const OTHER_TOKEN = ["other", "value"].join("-");

function issueText(url: string) {
  const params = new URL(url).searchParams;
  return `${params.get("title")}\n${params.get("body")}`;
}

describe("reportIssueUrl", () => {
  test("drops management query tokens", () => {
    const url = reportIssueUrl(500, `https://maths.example/mathex/app/manage?id=123456&${RUN_KEY}=${MANAGE_TOKEN}`);
    const text = issueText(url);
    expect(text).not.toContain(MANAGE_TOKEN);
    expect(text).not.toContain(`${RUN_KEY}=`);
    expect(text).toContain("https://maths.example/mathex/app/manage");
  });

  test("drops physical host tokens", () => {
    const url = reportIssueUrl(500, `https://maths.example/mathex/app/live/host?id=123456&${HOST_KEY}=${HOST_TOKEN}`);
    const text = issueText(url);
    expect(text).not.toContain(HOST_TOKEN);
    expect(text).toContain("https://maths.example/mathex/app/live/host");
  });

  test("redacts collaborative and share path tokens", () => {
    const editor = issueText(
      reportIssueUrl(500, `https://maths.example/mathex/app/create/editor/${SESSION_TOKEN}`)
    );
    expect(editor).not.toContain(SESSION_TOKEN);
    expect(editor).toContain("/mathex/app/create/editor/[token]");

    const share = issueText(
      reportIssueUrl(500, `https://maths.example/mathex/app/create/editor/share/${SHARE_TOKEN}`)
    );
    expect(share).not.toContain(SHARE_TOKEN);
    expect(share).toContain("/mathex/app/create/editor/share/[token]");
  });

  test("redacts tokens quoted in error messages", () => {
    const url = reportIssueUrl(
      500,
      "https://maths.example/mathex/app",
      `Failed with ${RUN_KEY}=${MESSAGE_TOKEN} and ${HOST_KEY}=${OTHER_TOKEN}`
    );
    const text = issueText(url);
    expect(text).not.toContain(MESSAGE_TOKEN);
    expect(text).not.toContain(OTHER_TOKEN);
  });
});
