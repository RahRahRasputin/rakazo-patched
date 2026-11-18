import { describe, expect, it } from "vitest";
import { routineRunInstruction } from "./routine-run.prompt.js";

describe("routineRunInstruction", () => {
  it("keeps the opening sentence, and treats earlier results as this routine's own runs", () => {
    const named = routineRunInstruction("Inbox sweep", true);
    expect(
      named.startsWith(
        'This is one scheduled run of your routine "Inbox sweep": do the work now, and do not schedule it again.',
      ),
    ).toBe(true);
    expect(named).toContain("your own previous runs of this routine");
    expect(named).toContain("continue in your own voice");
    expect(routineRunInstruction(undefined, false)).toBe(
      "This is one scheduled run of your routine: do the work now, and do not schedule it again.",
    );
  });
});
