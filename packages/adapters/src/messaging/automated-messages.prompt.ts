/**
 * Messages that Rakazo, or its model library, adds to a conversation in the transcript
 * role named user are not from the person: screenshots moved out of tool results, nudges
 * to continue, finished background shell output, a helper's task. Models (local ones
 * especially) took them for the person replying, kept going instead of asking, and confused
 * their helpers with the person. Label them plainly.
 */
export const AUTOMATED_MESSAGE_LABEL = "[Automated message from Rakazo, not from the person]";

export function automated(text: string): string {
  return `${AUTOMATED_MESSAGE_LABEL} ${text}`;
}

/** Follows a kept reply in later history, so the model knows that reply is incomplete. */
export const PARTIAL_REPLY_NOTE = automated(
  "This reply was cut off by an error before it was finished.",
);

/** What pi-ai writes before screenshots it moves out of a tool result into a user message. */
export const TOOL_IMAGES_TEXT = "Attached image(s) from tool result:";
export const TOOL_IMAGES_LABEL = automated(
  "Screenshot(s) returned by your last tool call. The person has not replied.",
);
