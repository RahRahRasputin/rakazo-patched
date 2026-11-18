import { describe, expect, it } from "vitest";
import { contextRoomNote, contextRoomRatio } from "./context-room.prompt.js";

describe("contextRoomRatio", () => {
  it("uses whichever of the token fill and the message count is higher", () => {
    expect(
      contextRoomRatio({
        tokenEstimate: 0,
        contextWindow: 1000,
        nextMessageSeq: 69,
        letterInstalled: false,
      }),
    ).toBeCloseTo(0.69);
    expect(
      contextRoomRatio({
        tokenEstimate: 0,
        contextWindow: 1000,
        nextMessageSeq: 70,
        letterInstalled: false,
      }),
    ).toBeCloseTo(0.7);
    expect(
      contextRoomRatio({
        tokenEstimate: 850,
        contextWindow: 1000,
        nextMessageSeq: 0,
        letterInstalled: false,
      }),
    ).toBeCloseTo(0.85);
  });

  it("does not nag about message count once a letter is already in place", () => {
    expect(
      contextRoomRatio({
        tokenEstimate: 0,
        contextWindow: 1000,
        nextMessageSeq: 90,
        letterInstalled: true,
      }),
    ).toBe(0);
  });
});

describe("contextRoomNote", () => {
  it("stays quiet under 70 percent", () => {
    expect(
      contextRoomNote({ name: "Prometheus", personName: "Brad", ratio: 0.69 }),
    ).toBeUndefined();
  });

  it("offers a checkpoint by name at 70 percent, and says the room is nearly full at 85", () => {
    const notice = contextRoomNote({ name: "Prometheus", personName: "Brad", ratio: 0.7 });
    expect(notice).toContain("Prometheus, you're running low on room.");
    expect(notice).toContain("write_checkpoint");
    expect(notice).toContain("Brad");
    expect(notice).toContain("Nothing is erased.");
    expect(notice).not.toMatch(/\bthe user\b/i);
    expect(notice).not.toMatch(/reference only/i);
    expect(notice).not.toMatch(/summarization/i);

    const urgent = contextRoomNote({ name: "Prometheus", personName: "  ", ratio: 0.85 });
    expect(urgent).toContain("Prometheus, this chat is nearly out of room.");
    expect(urgent).toContain("the person you live with");
    expect(urgent).not.toMatch(/\bthe user\b/i);
  });
});
