import { describe, expect, test } from "bun:test";
import { hashMarkerPin, verifyMarkerPin } from "./physical.server";

describe("marker PIN hashing", () => {
  test("verifies the matching PIN and rejects another", async () => {
    const hash = await hashMarkerPin("1234");
    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(await verifyMarkerPin("1234", hash)).toBe(true);
    expect(await verifyMarkerPin("0000", hash)).toBe(false);
  });

  test("rejects malformed stored hashes", async () => {
    expect(await verifyMarkerPin("1234", "")).toBe(false);
    expect(await verifyMarkerPin("1234", "not-a-hash")).toBe(false);
    expect(await verifyMarkerPin("1234", "00:00:00")).toBe(false);
  });
});
