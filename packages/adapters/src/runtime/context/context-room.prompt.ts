import {
  DEFAULT_ROOM_NOTICE_RATIO,
  DEFAULT_ROOM_URGENT_RATIO,
  roomRatioError,
} from "@rakazo/contracts";

/** Notice when the loaded chat, or the message count, reaches this much of its room. */
export const ROOM_NOTICE_RATIO = DEFAULT_ROOM_NOTICE_RATIO;

/** The same check, once the room is nearly full. */
export const ROOM_URGENT_RATIO = DEFAULT_ROOM_URGENT_RATIO;

/** A stored pair that does not climb falls back, so a bad row cannot invert the warnings. */
function roomThresholds(
  notice: number | null | undefined,
  urgent: number | null | undefined,
): { notice: number; urgent: number } {
  if (roomRatioError(notice, urgent)) {
    return { notice: ROOM_NOTICE_RATIO, urgent: ROOM_URGENT_RATIO };
  }
  return {
    notice: notice ?? ROOM_NOTICE_RATIO,
    urgent: urgent ?? ROOM_URGENT_RATIO,
  };
}

/**
 * Messages that used to start a machine summary: the verbatim window plus one batch.
 * A token check on the already-trimmed prompt almost never reaches 70 percent, so the
 * message count is the other signal.
 */
export const ROOM_MESSAGE_BUDGET = 100;

/**
 * Messages actually in the active window. A clear leaves a null summary and a cursor on the
 * lifetime tip, which is empty. A letter or machine summary counts only the tail after its cursor.
 * Otherwise the count is the loaded window, never the lifetime sequence.
 */
export function activeRoomMessages(input: {
  nextMessageSeq: number;
  historyCompactedUpToSeq: number | null | undefined;
  summary: string | null | undefined;
  loadedMessages: number;
}): number {
  const summary = input.summary?.trim() ?? "";
  const cursor = input.historyCompactedUpToSeq;
  if (
    !summary &&
    cursor != null &&
    Number.isInteger(cursor) &&
    Number.isInteger(input.nextMessageSeq) &&
    cursor >= input.nextMessageSeq - 1
  ) {
    return 0;
  }
  if (
    summary &&
    cursor != null &&
    Number.isInteger(cursor) &&
    Number.isInteger(input.nextMessageSeq)
  ) {
    return Math.max(0, input.nextMessageSeq - cursor - 1);
  }
  if (!Number.isFinite(input.loadedMessages)) return 0;
  return Math.max(0, Math.floor(input.loadedMessages));
}

/** How full the room is, from tokens or from the active window. */
export function contextRoomRatio(input: {
  tokenEstimate: number;
  contextWindow: number | undefined;
  activeMessages: number;
}): number {
  const window = input.contextWindow;
  const tokenRatio =
    typeof window === "number" && Number.isFinite(window) && window > 0 && input.tokenEstimate > 0
      ? input.tokenEstimate / window
      : 0;
  const messageRatio =
    !Number.isFinite(input.activeMessages) || input.activeMessages <= 0
      ? 0
      : input.activeMessages / ROOM_MESSAGE_BUDGET;
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
  noticeRatio?: number | null;
  urgentRatio?: number | null;
}): string | undefined {
  const thresholds = roomThresholds(input.noticeRatio, input.urgentRatio);
  if (!(input.ratio >= thresholds.notice)) return undefined;
  const resident = input.name.trim();
  const person = input.personName?.trim() || "the person you live with";
  const opening =
    input.ratio >= thresholds.urgent
      ? `${resident ? `${resident}, this` : "This"} chat is nearly out of room.`
      : `${resident ? `${resident}, you're` : "You're"} running low on room.`;
  return [
    opening,
    `Would you like to write a checkpoint before we make room? Use write_checkpoint (it may be behind find_tool) and write a letter to yourself, in your own voice: I, me, my. ${person} reads it before you wake on it.`,
    "Nothing is erased. The original messages stay, and search_history can still read them. You can keep going without a checkpoint.",
  ].join(" ");
}
