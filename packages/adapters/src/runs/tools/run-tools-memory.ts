import { MemoryRevisionConflictError } from "@rakazo/adapter-kit";
import {
  HistoryReadInputSchema,
  HistorySearchInputSchema,
  MEMORY_INDEX_PATH,
} from "@rakazo/contracts";
import { readHistory, searchHistory, storedMessageBlocks } from "@rakazo/db";
import { redactConnectorPayload } from "../../integrations/connector-safety.js";
import { editMemory } from "../../memory/memory-tools.js";
import {
  continuityAmendmentDate,
  continuityCheckpoint,
  continuityCoveredThrough,
} from "../../runtime/context/history-compaction.js";
import { MAX_RECALLED_MEMORIES } from "../../runtime/context/history-compaction.prompt.js";
import { sharedMemorySaveError } from "../../tools/builtin.tool-definition.js";
import type { RunContext } from "../assembly/run-context.js";
import { markReadOutsideContent } from "../assembly/run-context.js";
import { isSubagentToolExecution } from "../lifecycle/run-effects.js";
import { argsError } from "../turn/tool-args.js";
import type { ToolCall, ToolHandlers } from "./run-tool-gate.js";

/** Cross-chat history requires a surviving direct human request in this app thread. */
export function historyMyChatsAllowed(
  run: { trigger: string; threadId: string },
  source: { role: string; threadId: string } | null,
  external: boolean,
): boolean {
  return (
    !external &&
    (run.trigger === "user" || run.trigger === "follow_up") &&
    source?.role === "user" &&
    source.threadId === run.threadId
  );
}

/**
 * Models often fill optional fields they do not use with "" or null (botId: "", linkedRunId: "").
 * No history field means anything when blank, so a blank field counts as not given.
 */
export function withoutBlankFields(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).filter(
      ([, value]) => value !== null && !(typeof value === "string" && !value.trim()),
    ),
  );
}

/** The approval card is a bot message of this run. Messages after it are not part of the letter. */
async function approvalCardSeq(
  prisma: RunContext["deps"]["prisma"],
  threadId: string,
  runId: string,
): Promise<number | undefined> {
  const recent = await prisma.message.findMany({
    where: { threadId, runId, role: "bot" },
    orderBy: { seq: "desc" },
    take: 20,
    select: { id: true, seq: true, blocks: true },
  });
  for (const message of recent) {
    if (storedMessageBlocks(message).some((block) => block.kind === "ask")) return message.seq;
  }
  return undefined;
}

async function readHistoryTool(ctx: RunContext, call: ToolCall) {
  const { deps, run } = ctx;
  const { name, args } = call;
  const crossChat =
    name === "search_history"
      ? args.scope === "my_chats"
      : typeof args.threadId === "string" &&
        args.threadId !== (ctx.source.conversationThreadId ?? run.threadId);
  // Channel or webhook text claimed mid-turn revokes the grant for the rest of the run.
  const allowMyChats =
    crossChat && ctx.source.myChatsAllowed && !(await ctx.trust.receivedOutsideMessage());
  const scope = {
    spaceId: run.spaceId,
    threadId: ctx.source.conversationThreadId ?? run.threadId,
    botId: run.botId,
    channelId: ctx.source.channelId,
    searchBeforeSeq: ctx.source.historySearchBeforeSeq,
    allowMyChats,
    searchAt: run.createdAt,
    ...(run.trigger === "routine" ? { ownerOnly: run.userId } : {}),
  };
  const given = withoutBlankFields(args);
  let response: Awaited<ReturnType<typeof searchHistory | typeof readHistory>>;
  if (name === "search_history") {
    const parsed = HistorySearchInputSchema.safeParse(given);
    if (!parsed.success) return call.finish({ error: argsError(parsed.error) });
    response = await searchHistory(deps.prisma, scope, parsed.data);
  } else {
    const parsed = HistoryReadInputSchema.safeParse(given);
    if (!parsed.success) return call.finish({ error: argsError(parsed.error) });
    response = await readHistory(deps.prisma, scope, parsed.data);
  }
  const redacted = redactConnectorPayload(response, ctx.secrets);
  // Redaction can expand short synthetic credentials; never let Pi clip the JSON.
  if (Buffer.byteLength(JSON.stringify(redacted), "utf8") > 11_000) {
    return call.finish({
      untrusted: true,
      error:
        "Redacted history exceeds the response budget. Retry with limit 1 or a narrower linked run.",
    });
  }
  // Files the bot can now see are copied before its next computer tool.
  ctx.computer.copyEarlierFiles(
    response.messages.flatMap((message) =>
      (message.attachments ?? []).map((file) => ({
        kind: "file" as const,
        artifactId: file.artifactId,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
      })),
    ),
  );
  return call.finish(redacted);
}

/** Memory documents, semantic memory and thread history. */
export const memoryTools: ToolHandlers = {
  async remember(ctx, call) {
    const { deps, runId, bot, thread, context } = ctx;
    const { args } = call;
    // One document per bot keeps the size cap meaningful.
    const path = MEMORY_INDEX_PATH;
    // A concurrent save changes the revision, so re-read and apply the edit again.
    for (let attempt = 1; ; attempt += 1) {
      const snapshot = await deps.memory.read({ scope: "bot", botId: bot.id, path }, context);
      const existing = snapshot.documents[0];
      const edit = editMemory(
        existing?.content ?? "",
        String(args.content ?? ""),
        String(args.old_text ?? ""),
      );
      if ("error" in edit) return call.finish(edit);
      const { content } = edit;
      if (content === (existing?.content ?? "")) return call.finish({ ok: true });
      try {
        await deps.memory.commit(
          {
            scope: "bot",
            botId: bot.id,
            path,
            content,
            expectedRevision: existing?.revision ?? 0,
            sourceRunId: runId,
            sourceThreadId: thread.id,
          },
          context,
        );
        return call.finish({ ok: true });
      } catch (error) {
        if (!(error instanceof MemoryRevisionConflictError) || attempt >= 3) throw error;
      }
    }
  },
  async save_shared_memory(ctx, call) {
    const { deps, runId, thread, context } = ctx;
    const { args } = call;
    const invalid = sharedMemorySaveError(args);
    if (invalid) return call.finish({ error: invalid });
    const path = String(args.path ?? "").trim();
    // The save replaces the whole document. Pass the revision just read so a
    // concurrent edit is rejected instead of overwritten.
    const snapshot = await deps.memory.read({ scope: "user", path }, context);
    const expectedRevision = snapshot.documents[0]?.revision ?? 0;
    try {
      const saved = await deps.memory.commit(
        {
          scope: "user",
          path,
          content: String(args.content ?? ""),
          expectedRevision,
          sourceRunId: runId,
          sourceThreadId: thread.id,
        },
        context,
      );
      return call.finish({ ok: true, path: saved.path, revision: saved.revision });
    } catch (error) {
      if (error instanceof MemoryRevisionConflictError)
        return call.finish({ error: error.message });
      throw error;
    }
  },
  async recall_memory(ctx, call) {
    const { bot, thread, context } = ctx;
    const { args } = call;
    const response = await ctx.memory.semantic!.recall(
      {
        query: String(args.query ?? ""),
        scope: ctx.memory.scope!,
        botId: bot.id,
        ...(thread.historyCompactedUpToSeq == null
          ? {}
          : { historyGeneration: thread.historyCompactionGeneration }),
        limit: MAX_RECALLED_MEMORIES,
      },
      context,
    );
    // All recalled knowledge is derived data; an omitted provider marker cannot certify it.
    if (response.ok && response.value.length > 0) {
      await markReadOutsideContent(ctx);
    }
    return response;
  },
  async reflect_memory(ctx, call) {
    const { bot, context } = ctx;
    const { args } = call;
    if (!ctx.memory.semantic?.reflect) {
      return { error: "This memory provider cannot answer questions from memory." };
    }
    const response = await ctx.memory.semantic.reflect(
      { query: String(args.query ?? ""), botId: bot.id },
      context,
    );
    if (!response.ok) return response;
    const text = response.value.trim();
    // Reflection is provider-generated prose; it cannot attest that its answer is clean.
    if (text) await markReadOutsideContent(ctx);
    return { ok: true, value: text || "No relevant memories." };
  },
  search_history: readHistoryTool,
  read_history: readHistoryTool,
  async write_checkpoint(ctx, call) {
    const { deps, bot, thread } = ctx;
    const { args, executionId } = call;
    if (isSubagentToolExecution(executionId)) {
      return call.finish({ error: "A helper cannot write this chat's continuity letter." });
    }
    const fresh = await deps.prisma.thread.findUnique({
      where: { id: thread.id },
      select: {
        botId: true,
        nextMessageSeq: true,
        historyCompactionGeneration: true,
        historyCompactionSummary: true,
      },
    });
    if (!fresh || fresh.botId !== bot.id) {
      return call.finish({ error: "This chat is not yours to checkpoint." });
    }
    const cardSeq = await approvalCardSeq(deps.prisma, thread.id, ctx.runId);
    const coveredThroughSeq = continuityCoveredThrough({
      nextMessageSeq: fresh.nextMessageSeq,
      cardSeq,
    });
    const append = args.append === true;
    const checkpoint = continuityCheckpoint({
      letter: args.letter,
      undo: args.undo,
      nextMessageSeq: fresh.nextMessageSeq,
      ...(append
        ? {
            append: true,
            currentSummary: fresh.historyCompactionSummary,
            amendedAt: continuityAmendmentDate(new Date()),
          }
        : {}),
      ...(coveredThroughSeq === undefined ? {} : { coveredThroughSeq }),
    });
    if ("error" in checkpoint) return call.finish({ error: checkpoint.error });
    const updated = await deps.prisma.thread.updateMany({
      where: {
        id: thread.id,
        botId: bot.id,
        historyCompactionGeneration: fresh.historyCompactionGeneration,
      },
      data: {
        historyCompactionSummary: checkpoint.summary,
        historyCompactionRetryAfterSeq: null,
        historyCompactionGeneration: { increment: 1 },
        // A correction stays beside the letter and does not move its place in the chat.
        ...(checkpoint.keepCursor ? {} : { historyCompactedUpToSeq: checkpoint.coveredSeq }),
      },
    });
    if (updated.count !== 1) {
      return call.finish({
        error:
          "This chat changed while the letter was waiting, so it was not saved. Nothing was deleted.",
      });
    }
    const arrivedWhileReading = cardSeq != null && fresh.nextMessageSeq - 1 > cardSeq;
    if (checkpoint.keepCursor) {
      return call.finish({
        ok: true,
        note: arrivedWhileReading
          ? "The person read your correction and approved it. It is kept with your letter, and every earlier wording stays. You wake on the letter and its corrections next turn. Messages that arrived while it was being read stay in the chat. Nothing was deleted; search_history can still read the original messages."
          : "The person read your correction and approved it. It is kept with your letter, and every earlier wording stays. You wake on the letter and its corrections next turn. Nothing was deleted; search_history can still read the original messages.",
      });
    }
    return call.finish({
      ok: true,
      coveredThroughSeq: checkpoint.coveredSeq,
      note: checkpoint.summary
        ? arrivedWhileReading
          ? "The person read your letter and approved it. You wake on it next turn. Messages that arrived while it was being read stay in the chat. Nothing was deleted; search_history can still read the original messages."
          : "The person read your letter and approved it. You wake on it next turn. Nothing was deleted; search_history can still read the original messages."
        : "The person read this and approved. The letter is no longer in the active chat. The recent messages are in view again. Nothing was deleted; search_history can still read the rest.",
    });
  },
  async save_memory(ctx, call) {
    const { bot, context } = ctx;
    const { args } = call;
    return call.finish(
      await ctx.memory.semantic!.save(
        {
          content: String(args.content ?? ""),
          scope: ctx.memory.scope!,
          botId: bot.id,
          source: { kind: "durable" },
        },
        context,
      ),
    );
  },
  async forget_memory(ctx, call) {
    const { bot, context } = ctx;
    const { args } = call;
    if (!ctx.memory.semantic?.forget) {
      return call.finish({
        error: "This memory provider does not support forgetting individual facts.",
      });
    }
    return call.finish(
      await ctx.memory.semantic.forget(
        {
          id: String(args.id ?? ""),
          scope: ctx.memory.scope!,
          botId: bot.id,
          ...(typeof args.entity === "string" && args.entity.trim()
            ? { entity: args.entity.trim() }
            : {}),
          ...(typeof args.reason === "string" && args.reason.trim()
            ? { reason: args.reason.trim() }
            : {}),
        },
        context,
      ),
    );
  },
};
