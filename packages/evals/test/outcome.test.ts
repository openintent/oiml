import { describe, expect, it } from "vitest";
import { outcomeAccepts } from "../src/runner.js";

describe("outcomeAccepts", () => {
  it("takes a valid diff or a decline for ok_or_declined, and fails an answer that never got a valid diff", () => {
    expect(outcomeAccepts("ok_or_declined", "ok")).toBe(true);
    expect(outcomeAccepts("ok_or_declined", "declined")).toBe(true);
    expect(outcomeAccepts("ok_or_declined", "invalid")).toBe(false);
  });

  it("takes everything for any, and only its own status for the others", () => {
    for (const status of ["ok", "invalid", "declined"] as const) expect(outcomeAccepts("any", status)).toBe(true);
    for (const expected of ["ok", "invalid", "declined"] as const)
      for (const status of ["ok", "invalid", "declined"] as const)
        expect(outcomeAccepts(expected, status), `${expected} ${status}`).toBe(expected === status);
  });
});
