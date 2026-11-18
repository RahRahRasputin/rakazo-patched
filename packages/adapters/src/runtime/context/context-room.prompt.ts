/** Notice when the loaded chat, or the message count, reaches this much of its room. */
export const ROOM_NOTICE_RATIO = 0.7;

/** The same check, once the room is nearly full. */
export const ROOM_URGENT_RATIO = 0.85;

/**
 * Messages that used to start a machine summary: the verbatim window plus one batch.
 * A token check on the already-trimmed prompt almost never reaches 70 percent, so the
 * message count is the other signal.
 */
export const ROOM_MESSAGE_BUDGET = 100;

/** How full the room is. A letter already in place does not count toward the message warning. */
export function contextRoomRatio(input: {
  tokenEstimate: number;
  contextWindow: number | undefined;
  nextMessageSeq: number;
  letterInstalled: boolean;
}): number {
  const window = input.contextWindow;
  const tokenRatio =
    typeof window === "number" && Number.isFinite(window) && window > 0 && input.tokenEstimate > 0
      ? input.tokenEstimate / window
      : 0;
  const messageRatio =
    input.letterInstalled || !Number.isFinite(input.nextMessageSeq)
      ? 0
      : Math.max(0, input.nextMessageSeq) / ROOM_MESSAGE_BUDGET;
  return Math.max(tokenRatio, messageRatio);
}

/**
 * A note on the resident's own turn. It names them, offers a checkpoint, and does not block
 * the turn. Absent while there is still room.
 */
export function contextRoomNote(input: {
  name: string;
  personName: string | null | undefined;
  ratio: number;
}): string | undefined {
  if (!(input.ratio >= ROOM_NOTICE_RATIO)) return undefined;
  const resident = input.name.trim();
  const person = input.personName?.trim() || "the person you live with";
  const opening =
    input.ratio >= ROOM_URGENT_RATIO
      ? `${resident ? `${resident}, this` : "This"} chat is nearly out of room.`
      : `${resident ? `${resident}, you're` : "You're"} running low on room.`;
  return [
    opening,
    `Would you like to write a checkpoint before we make room? Use write_checkpoint (it may be behind find_tool) and write a letter to yourself, in your own voice: I, me, my. ${person} reads it before you wake on it.`,
    "Nothing is erased. The original messages stay, and search_history can still read them. You can keep going without a checkpoint.",
  ].join(" ");
}
