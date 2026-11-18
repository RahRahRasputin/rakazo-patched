import type { TakeoverResumeCheckpoint } from "./takeover-resume.js";

/** Shown when desktop tools are gated because the person still holds the screen. */
export const DESKTOP_HELD_FOR_TAKEOVER_MESSAGE =
  "The person has the screen. File and shell tools still work.";

export function takeoverResumeFromRelease(reason: unknown): {
  checkpoint: TakeoverResumeCheckpoint;
  promptNote: string;
} {
  if (reason === "skipped") {
    return {
      checkpoint: "takeover-skipped",
      promptNote:
        "The person skipped this step. Continue without assuming that step was done. Take a fresh screenshot before acting on the screen. Do not request takeover again for this same step unless you still cannot proceed.",
    };
  }
  return {
    checkpoint: "takeover",
    promptNote:
      "The person finished on the computer. Take a fresh screenshot before acting on the screen. Do not request takeover again for this same step.",
  };
}
