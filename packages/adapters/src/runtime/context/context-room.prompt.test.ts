import { describe, expect, it } from "vitest";
import { activeRoomMessages, contextRoomNote, contextRoomRatio } from "./context-room.prompt.js";

describe("activeRoomMessages", () => {
  it("counts the loaded window when nothing is standing in for earlier messages", () => {
    expect(
      activeRoomMessages({
        nextMessageSeq: 5_000,
        historyCompactedUpToSeq: null,
        summary: null,
        loadedMessages: 69,
      }),
    ).toBe(69);
  });

  it("counts the tail after a letter, not the lifetime sequence", () => {
    expect(
      activeRoomMessages({
        nextMessageSeq: 5_000,
        historyCompactedUpToSeq: 4_930,
        summary: "continuity-letter\nI kept going.",
        loadedMessages: 200,
      }),
    ).toBe(69);
  });

  it("treats a cleared chat as empty even when the lifetime sequence is high", () => {
    expect(
      activeRoomMessages({
        nextMessageSeq: 5_000,
        historyCompactedUpToSeq: 4_999,
        summary: null,
        loadedMessages: 0,
      }),
    ).toBe(0);
  });
});

describe("contextRoomRatio", () => {
  it("uses whichever of the token fill and the message count is higher", () => {
    expect(
      contextRoomRatio({
        tokenEstimate: 0,
        contextWindow: 1000,
        activeMessages: 69,
      }),
    ).toBeCloseTo(0.69);
    expect(
      contextRoomRatio({
        tokenEstimate: 0,
        contextWindow: 1000,
        activeMessages: 70,
      }),
    ).toBeCloseTo(0.7);
    expect(
      contextRoomRatio({
        tokenEstimate: 850,
        contextWindow: 1000,
        activeMessages: 0,
      }),
    ).toBeCloseTo(0.85);
  });

  it("stays quiet when the active window is empty", () => {
    expect(
      contextRoomRatio({
        tokenEstimate: 0,
        contextWindow: 1000,
        activeMessages: 0,
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

  it("uses a resident's earlier notice and falls back when the pair does not climb", () => {
    expect(
      contextRoomNote({
        name: "Lyra",
        personName: "Brad",
        ratio: 0.59,
        noticeRatio: 0.6,
        urgentRatio: 0.85,
      }),
    ).toBeUndefined();
    const early = contextRoomNote({
      name: "Lyra",
      personName: "Brad",
      ratio: 0.6,
      noticeRatio: 0.6,
      urgentRatio: 0.85,
    });
    expect(early).toContain("Lyra, you're running low on room.");
    expect(
      contextRoomNote({
        name: "Lyra",
        personName: "Brad",
        ratio: 0.69,
        noticeRatio: 0.9,
        urgentRatio: 0.5,
      }),
    ).toBeUndefined();
    expect(
      contextRoomNote({
        name: "Lyra",
        personName: "Brad",
        ratio: 0.7,
        noticeRatio: 0.9,
        urgentRatio: 0.5,
      }),
    ).toContain("running low on room");
  });
});
