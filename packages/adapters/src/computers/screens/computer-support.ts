import { createHash } from "node:crypto";
import path from "node:path";
import type { ComputerAction, ComputerObservation, ComputerRef } from "@rakazo/adapter-kit";
import type { ComputerMode } from "@rakazo/contracts";

export function toComputerRef(computer: {
  homeKey: string;
  kind: string;
  providerRef: string | null;
}): ComputerRef {
  if (!computer.providerRef) throw new Error("computer provider reference is missing");
  return {
    id: computer.providerRef,
    botId: computer.homeKey,
    kind: computer.kind,
    providerRef: computer.providerRef,
  };
}

const EMPTY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  ),
);

export function computerObservation(
  image: Uint8Array,
  input: Omit<ComputerObservation, "frameId" | "capturedAt" | "image">,
): ComputerObservation {
  return {
    ...input,
    image,
    frameId: createHash("sha256").update(image).digest("hex"),
    capturedAt: new Date().toISOString(),
  };
}

export function placeholderObservation(label = "ready"): ComputerObservation {
  return computerObservation(EMPTY_PNG, {
    mimeType: "image/png",
    width: 1,
    height: 1,
    activeWindow: { id: "placeholder", title: label },
  });
}

export function applyPlaceholderAction(box: { screen: string }, action: ComputerAction): void {
  if (action.kind === "clipboard") box.screen = action.text;
  else if (action.kind === "open") box.screen = `opened ${action.path}`;
  else if (action.kind === "launch") box.screen = `launched ${action.application}`;
  else if (action.kind === "focus") box.screen = `focused ${action.application}`;
  else box.screen = action.kind;
}

export function boundedComputerActions(actions: readonly ComputerAction[]): ComputerAction[] {
  if (actions.length > 24) throw new Error("computer action batch exceeds 24 actions");
  return [...actions];
}

export function clampRounded(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * A path that leaves the folder it must stay in. Not a refusal by itself: the path may be one a
 * provider listed, which is a fault to log. A route that passes a caller's own path answers it.
 */
export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

export function normalizeWorkspacePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  // "." stays where it is, so "." and "./notes" mean the root and notes; only ".." can leave.
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  if (segments.includes("..")) throw new WorkspacePathError("Path escapes the computer workspace");
  return segments.join("/");
}

export function workspacePath(root: string, relative: string): string {
  const normalized = normalizeWorkspacePath(relative);
  return normalized ? path.posix.join(root, normalized) : root;
}

/** The workspace path bots see on every computer. */
const VIRTUAL_HOME = "/home/rakazo";

/**
 * The directory a command runs in. Empty, ".", "/", the workspace root and any home alias
 * mean the root; absolute paths under one of them keep their tail; anything else is taken
 * relative to the root. ".." segments throw, so a cwd cannot leave the workspace.
 */
export function workspaceCwd(
  root: string,
  cwd: string | undefined,
  homes: readonly string[] = [],
): string {
  if (!cwd || cwd === "." || cwd === "/") return root;
  for (const prefix of [root, VIRTUAL_HOME, ...homes]) {
    if (cwd === prefix) return root;
    if (cwd.startsWith(`${prefix}/`)) return workspacePath(root, cwd.slice(prefix.length + 1));
  }
  return workspacePath(root, cwd);
}

export function teamBotWorkspaceDirectory(botId: string): string {
  return path.posix.join("bots", normalizeWorkspacePath(botId));
}

export function resolveBotWorkspacePath(
  scope: ComputerMode,
  botId: string,
  rawPath: string,
): string {
  const requestedPath = expandHomePrefix(rawPath);
  if (scope !== "team") return requestedPath;
  const explicitRootPath = stripVirtualWorkspaceRoot(requestedPath);
  const normalized = normalizeWorkspacePath(explicitRootPath ?? requestedPath);
  if (explicitRootPath !== null || isTeamRootPath(normalized)) return normalized;
  return path.posix.join(teamBotWorkspaceDirectory(botId), normalized);
}

export function resolveBotWorkspaceCwd(
  scope: ComputerMode,
  botId: string,
  requestedCwd: string | undefined,
): string | undefined {
  if (scope !== "team") {
    if (requestedCwd === undefined) return undefined;
    const expanded = expandHomePrefix(requestedCwd);
    if (expanded === requestedCwd) return requestedCwd;
    return stripVirtualWorkspaceRoot(expanded) || undefined;
  }
  if (!requestedCwd || requestedCwd === ".") return teamBotWorkspaceDirectory(botId);
  if (path.posix.isAbsolute(requestedCwd) || path.win32.isAbsolute(requestedCwd))
    return requestedCwd;
  return resolveBotWorkspacePath(scope, botId, requestedCwd);
}

/** Paths a user may write while controlling this bot: its home, or shared/. */
export function resolveBotUploadPath(
  scope: ComputerMode,
  botId: string,
  requestedPath: string,
): string {
  const stored = resolveBotWorkspacePath(scope, botId, requestedPath);
  if (scope !== "team") return normalizeWorkspacePath(stored);
  const normalized = normalizeWorkspacePath(stored);
  const botDirectory = teamBotWorkspaceDirectory(botId);
  if (
    normalized === botDirectory ||
    normalized.startsWith(`${botDirectory}/`) ||
    normalized === "shared" ||
    normalized.startsWith("shared/")
  ) {
    return normalized;
  }
  throw new WorkspacePathError("Path escapes the bot workspace");
}

export function displayBotWorkspacePath(
  scope: ComputerMode,
  botId: string,
  requestedPath: string,
  storedPath: string,
): string {
  if (scope !== "team" || !isBotRelativeRequest(requestedPath)) return storedPath;
  const normalized = normalizeWorkspacePath(storedPath);
  const botDirectory = teamBotWorkspaceDirectory(botId);
  if (normalized === botDirectory) return "";
  return normalized.startsWith(`${botDirectory}/`)
    ? normalized.slice(botDirectory.length + 1)
    : normalized;
}

function isBotRelativeRequest(value: string): boolean {
  if (stripVirtualWorkspaceRoot(expandHomePrefix(value)) !== null) return false;
  return !isTeamRootPath(normalizeWorkspacePath(value));
}

function isTeamRootPath(value: string): boolean {
  return (
    value === "shared" ||
    value.startsWith("shared/") ||
    value === "bots" ||
    value.startsWith("bots/")
  );
}

// A leading ~ or /home/rakazo means the workspace root, the same as a leading /.
function expandHomePrefix(value: string): string {
  return value.replace(
    /^(?:~|[\\/]home[\\/]rakazo)([\\/]|$)/,
    (_, separator: string) => separator || "/",
  );
}

function stripVirtualWorkspaceRoot(value: string): string | null {
  const portable = value.replace(/\\/g, "/");
  if (portable === "/") return "";
  return portable.startsWith("/") ? portable.slice(1) : null;
}

/** A resident's own room on a shared computer. The name is case-sensitive. */
export const PRIVATE_FOLDER_NAME = "PrivateFolder";

export const PRIVATE_FOLDER_REFUSAL =
  "PrivateFolder is that resident's own room. Other residents' tools do not read it, and it is not part of the shared computer.";

export const PRIVATE_FOLDER_SHARE_REFUSAL =
  "PrivateFolder stays on your computer. Nothing was sent.";

/**
 * Collapse "." and ".." before a PrivateFolder decision. normalizeWorkspacePath throws on
 * "..", and treating that throw as allowed is how `bots/bot-1/../bot-2/PrivateFolder` slipped
 * through. A ".." that still remains has left the workspace and is not the actor's home.
 */
function collapseWorkspaceDots(value: string): string {
  const slash = value.replace(/\\/g, "/");
  const absolute = slash.startsWith("/");
  const segments: string[] = [];
  for (const segment of slash.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else if (!absolute) segments.push("..");
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join("/");
  return absolute ? `/${joined}` : joined;
}

/**
 * On a team computer, PrivateFolder is readable only under the acting resident's home.
 * A dedicated computer is that resident's home, so the folder is theirs. This is a dignity
 * boundary for ordinary paths, not a lock against a shell that never names the folder.
 * The path is the one left after resolving "..", not the text that was typed.
 */
export function privateFolderRefusal(
  scope: ComputerMode,
  actorBotId: string,
  storedPath: string,
): string | undefined {
  const segments = collapseWorkspaceDots(storedPath).split("/").filter(Boolean);
  const index = segments.indexOf(PRIVATE_FOLDER_NAME);
  if (index < 0 || scope !== "team") return undefined;
  if (segments.includes("..")) return PRIVATE_FOLDER_REFUSAL;
  const parent = segments.slice(0, index).join("/");
  if (privateFolderParentAllowed(parent, actorBotId)) return undefined;
  return PRIVATE_FOLDER_REFUSAL;
}

/** A file leaving the computer: an attachment, or a copy onto another computer. */
export function privateFolderSendRefusal(storedPath: string): string | undefined {
  const segments = collapseWorkspaceDots(storedPath).split("/").filter(Boolean);
  return segments.includes(PRIVATE_FOLDER_NAME) ? PRIVATE_FOLDER_SHARE_REFUSAL : undefined;
}

function privateFolderParentAllowed(parent: string, actorBotId: string): boolean {
  const own = teamBotWorkspaceDirectory(actorBotId);
  if (parent === own || parent.startsWith(`${own}/`)) return true;
  // An absolute shell cwd keeps a host prefix in front of the bot home.
  return parent.endsWith(`/${own}`) || parent.includes(`/${own}/`);
}

/**
 * Relative names are the resident's own home. A path is resolved against the cwd, including
 * "..", before the folder check. `cat ../bot-2/PrivateFolder/note.md` and
 * `bots/bot-1/../bot-2/PrivateFolder` are the other resident's room. A command that never
 * writes the folder's name is not inspected: obfuscation is outside this boundary.
 */
export function shellPrivateFolderRefusal(
  scope: ComputerMode,
  actorBotId: string,
  command: string,
  cwd?: string,
): string | undefined {
  if (scope !== "team") return undefined;
  if (cwd) {
    const cwdRefusal = privateFolderRefusal(scope, actorBotId, cwd);
    if (cwdRefusal) return cwdRefusal;
  }
  if (!command.includes(PRIVATE_FOLDER_NAME)) return undefined;
  for (const token of privateFolderCommandPaths(command)) {
    const refusal = privateFolderRefusal(scope, actorBotId, resolveCommandPath(token, cwd));
    if (refusal) return refusal;
  }
  return undefined;
}

function privateFolderCommandPaths(command: string): string[] {
  const paths: string[] = [];
  for (const match of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    if (token.includes(PRIVATE_FOLDER_NAME)) paths.push(token);
  }
  return paths;
}

function resolveCommandPath(token: string, cwd?: string): string {
  const cleaned = token.replace(/^[<>|&;]+|[<>|&;]+$/g, "").replace(/\\/g, "/");
  const workspaceRooted =
    cleaned.startsWith("/") ||
    cleaned.startsWith("bots/") ||
    cleaned.startsWith("shared/") ||
    cleaned === "bots" ||
    cleaned === "shared";
  if (workspaceRooted || !cwd) return collapseWorkspaceDots(cleaned);
  const base = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  return collapseWorkspaceDots(`${base}/${cleaned}`);
}

export { shellQuote } from "@rakazo/core/node/desktop-runtime";
