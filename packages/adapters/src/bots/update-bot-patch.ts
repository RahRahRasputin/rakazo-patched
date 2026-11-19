import type { VoiceTone } from "@rakazo/contracts";
import { BOT_DESCRIPTION_MAX_LENGTH, BOT_NAME_MAX_LENGTH, roomRatioError } from "@rakazo/contracts";

export type UpdateBotPatch = {
  name?: string;
  description?: string;
  color?: string;
  notifyOnFinish?: boolean;
  dailyCheckIns?: boolean;
  voiceTone?: VoiceTone | null;
  welcomeHome?: boolean;
  roomNoticeRatio?: number | null;
  roomUrgentRatio?: number | null;
};

const EMPTY_UPDATE =
  "Provide at least one of name, description, notifyOnFinish, color, artifact_id, use_attached_image, voiceTone, welcomeHome, roomNoticeRatio, or roomUrgentRatio.";

function hasUpdateBotAvatarArgs(args: Record<string, unknown>): boolean {
  return (
    args.color !== undefined || args.artifact_id !== undefined || args.use_attached_image === true
  );
}

export function parseUpdateBotPatch(
  args: Record<string, unknown>,
): { error: string } | { patch: UpdateBotPatch } {
  const patch: UpdateBotPatch = {};
  if (args.name !== undefined) patch.name = String(args.name);
  if (args.description !== undefined) patch.description = String(args.description);
  if (args.dailyCheckIns !== undefined) {
    if (typeof args.dailyCheckIns !== "boolean")
      return { error: "dailyCheckIns must be true or false." };
    patch.dailyCheckIns = args.dailyCheckIns;
  }
  const notifyRaw = args.notifyOnFinish !== undefined ? args.notifyOnFinish : args.notify_on_finish;
  if (notifyRaw !== undefined) {
    if (typeof notifyRaw !== "boolean") {
      return { error: "notifyOnFinish must be true or false." };
    }
    patch.notifyOnFinish = notifyRaw;
  }
  if (args.voiceTone !== undefined) {
    const tone = parseVoiceTone(args.voiceTone);
    if ("error" in tone) return tone;
    patch.voiceTone = tone.tone;
  }
  if (args.welcomeHome !== undefined) {
    if (typeof args.welcomeHome !== "boolean") {
      return { error: "welcomeHome must be true or false." };
    }
    patch.welcomeHome = args.welcomeHome;
  }
  if (args.roomNoticeRatio !== undefined) {
    const ratio = parseRoomRatio("roomNoticeRatio", args.roomNoticeRatio);
    if ("error" in ratio) return ratio;
    patch.roomNoticeRatio = ratio.ratio;
  }
  if (args.roomUrgentRatio !== undefined) {
    const ratio = parseRoomRatio("roomUrgentRatio", args.roomUrgentRatio);
    if ("error" in ratio) return ratio;
    patch.roomUrgentRatio = ratio.ratio;
  }
  if (patch.roomNoticeRatio !== undefined && patch.roomUrgentRatio !== undefined) {
    const ratio = roomRatioError(patch.roomNoticeRatio, patch.roomUrgentRatio);
    if (ratio) return { error: ratio };
  }
  if (Object.keys(patch).length === 0 && !hasUpdateBotAvatarArgs(args)) {
    return { error: EMPTY_UPDATE };
  }
  if (patch.name !== undefined) {
    const nextName = patch.name.trim();
    if (!nextName) return { error: "name cannot be empty." };
    if (nextName.length > BOT_NAME_MAX_LENGTH) {
      return { error: `name must be at most ${BOT_NAME_MAX_LENGTH} characters.` };
    }
    patch.name = nextName;
  }
  if (patch.description !== undefined) {
    const nextDescription = patch.description.trim();
    if (nextDescription.length > BOT_DESCRIPTION_MAX_LENGTH) {
      return { error: `description must be at most ${BOT_DESCRIPTION_MAX_LENGTH} characters.` };
    }
    patch.description = nextDescription;
  }
  return { patch };
}

function parseVoiceTone(value: unknown): { error: string } | { tone: VoiceTone | null } {
  if (value === null) return { tone: null };
  const tone = typeof value === "string" ? value.trim() : value;
  if (tone === "natural" || tone === "river-time") return { tone };
  return { error: "voiceTone must be natural or river-time." };
}

function parseRoomRatio(
  name: string,
  value: unknown,
): { error: string } | { ratio: number | null } {
  if (value === null) return { ratio: null };
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;
  if (Number.isFinite(number) && number > 0 && number <= 1) return { ratio: number };
  return { error: `${name} must be above 0 and at most 1, or null to use the default.` };
}

/**
 * A ratio sent on its own is checked against the one already stored. An omitted ratio keeps
 * the default, so a notice of 0.60 with no urgent still sits under 0.85.
 */
export function roomRatioPatchError(
  patch: { roomNoticeRatio?: number | null; roomUrgentRatio?: number | null },
  current: { roomNoticeRatio?: number | null; roomUrgentRatio?: number | null },
): string | undefined {
  if (patch.roomNoticeRatio === undefined && patch.roomUrgentRatio === undefined) return undefined;
  return roomRatioError(
    patch.roomNoticeRatio !== undefined ? patch.roomNoticeRatio : current.roomNoticeRatio,
    patch.roomUrgentRatio !== undefined ? patch.roomUrgentRatio : current.roomUrgentRatio,
  );
}

/** The bot's current values that an own `update_bot` call can repeat. */
export type OwnBotCurrentValues = {
  name: string;
  description: string | null;
  instructions: string;
  color: string;
  notifyOnFinish: boolean;
  dailyCheckIns: boolean;
  thinkingLevel: string | null;
  autoSpeak: boolean;
  voiceId: string | null;
  voiceTone?: string | null;
  welcomeHome?: boolean;
  roomNoticeRatio?: number | null;
  roomUrgentRatio?: number | null;
};

/**
 * Some models fill in every field of a tool call, repeating current values and `false` for
 * switches they mean to leave alone. A value the bot already has is not a change, so drop it:
 * otherwise a plain read looks like a write and is refused or held.
 */
export function dropUnchangedOwnBotArgs(
  args: Record<string, unknown>,
  current: OwnBotCurrentValues,
  /** Every way the model the bot runs on is written: its id, provider/id and its read label. */
  currentModelNames: string[] = [],
  /** The thinking level this run uses, which a bot on the default level reports as its own. */
  runningThinkingLevel?: string | null,
): Record<string, unknown> {
  const same: Record<string, unknown[]> = {
    name: [current.name],
    description: [current.description ?? ""],
    instructions: [current.instructions],
    color: [current.color],
    notifyOnFinish: [current.notifyOnFinish],
    notify_on_finish: [current.notifyOnFinish],
    dailyCheckIns: [current.dailyCheckIns],
    // Null and natural are the same fallback, so echoing "natural" is not a write.
    voiceTone: [current.voiceTone ?? "natural"],
    welcomeHome: [current.welcomeHome ?? false],
    roomNoticeRatio: current.roomNoticeRatio == null ? [] : [current.roomNoticeRatio],
    roomUrgentRatio: current.roomUrgentRatio == null ? [] : [current.roomUrgentRatio],
    model: currentModelNames.map((name) => name.toLowerCase()),
    thinkingLevel: current.thinkingLevel
      ? [current.thinkingLevel]
      : ["default", ...(runningThinkingLevel ? [runningThinkingLevel] : [])],
    readAloud: [current.autoSpeak],
    voice: [current.voiceId ?? "default"],
    use_attached_image: [false],
    // Reading from the start is the default, not a request to page.
    instructions_offset: [0],
    instructionsOffset: [0],
  };
  const kept: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(args)) {
    const values = same[key] ?? [];
    // Switches sometimes arrive as the text "true" or "false".
    const value =
      typeof values[0] === "boolean" && (raw === "true" || raw === "false") ? raw === "true" : raw;
    const compared =
      typeof value !== "string"
        ? value
        : key === "model"
          ? value.trim().toLowerCase()
          : value.trim();
    const repeated = values.some((known) =>
      typeof known === "string" ? known.trim() === compared : known === compared,
    );
    if (!repeated) kept[key] = value;
  }
  return kept;
}

/** How many ignored fields a paged read names, and how much of each value it shows. */
const IGNORED_FIELDS_SHOWN = 8;
const IGNORED_VALUE_PREVIEW = 60;

/** The fields a paged read did not apply, bounded so the read keeps its own size budget. */
export function ignoredFieldsNote(fields: Record<string, unknown>): string | undefined {
  const given = Object.entries(fields).filter(([, value]) => argumentGiven(value));
  if (!given.length) return undefined;
  const shown = given.slice(0, IGNORED_FIELDS_SHOWN).map(([key, value]) => {
    const json = JSON.stringify(value) ?? "";
    return `${key}=${json.length > IGNORED_VALUE_PREVIEW ? `${json.slice(0, IGNORED_VALUE_PREVIEW)}…` : json}`;
  });
  const more = given.length - shown.length;
  return `This was a read, so these were not applied: ${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}. To change one, call update_bot with just that field and no instructions_offset.`;
}

/** Providers send omitted optional fields as null or blank; only anything else counts as given. */
export function argumentGiven(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.trim().length > 0;
}
