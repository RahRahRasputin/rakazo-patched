import { localDateTime } from "../../runs/assembly/current-time.prompt.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * One fixed sentence, ahead of a continuity letter. The resident does not write it: a free
 * sentence would be another instruction channel. Absent when welcomeHome is off.
 */
export function welcomeHomeLine(input: {
  name: string;
  now: Date;
  previousAt?: Date;
  timeZone?: string | null;
}): string {
  const name = residentName(input.name);
  const hello = name ? `Welcome back, ${name}.` : "Welcome back.";
  const when = input.previousAt
    ? sessionWhen(input.now, input.previousAt, input.timeZone)
    : undefined;
  if (!when) return `${hello} Here is the continuity letter you wrote for yourself.`;
  return `${hello} Your last session was ${when.when}, ${when.elapsed} ago. Here is the continuity letter you wrote for yourself.`;
}

function residentName(name: string): string {
  let cleaned = "";
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    cleaned += code < 32 || code === 127 ? " " : char;
  }
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 80);
}

function sessionWhen(
  now: Date,
  previous: Date,
  timeZone?: string | null,
): { when: string; elapsed: string } | undefined {
  const gap = now.getTime() - previous.getTime();
  if (!Number.isFinite(gap) || gap < 0) return undefined;
  const zone = timeZone && localDateTime(previous, timeZone) ? timeZone : "UTC";
  const when = localDateTime(previous, zone);
  if (!when) return undefined;
  return { when, elapsed: elapsedPhrase(gap) };
}

function elapsedPhrase(gap: number): string {
  if (gap < MINUTE_MS) return "less than a minute";
  if (gap < HOUR_MS) {
    const minutes = Math.max(1, Math.round(gap / MINUTE_MS));
    if (minutes >= 60) return "1 hour";
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(gap / HOUR_MS);
  if (hours < 48) return `${Math.max(1, hours)} hour${hours === 1 ? "" : "s"}`;
  const days = Math.max(1, Math.round(hours / 24));
  return `${days} day${days === 1 ? "" : "s"}`;
}
