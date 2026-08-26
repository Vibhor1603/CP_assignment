import OpenAI from "openai";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import {
  groqApiKey,
  groqBaseUrl,
  groqModel,
  maxToolRounds,
  maxHistoryTurns,
  maxToolResultChars,
  projectRootPath,
} from "./config.js";
import { buildSystemPrompt } from "./prompts.js";
import { toolDefinitions, runTool } from "./tools.js";
import { toIsoDate, selectTaskSources } from "./storage.js";

const client = new OpenAI({
  apiKey: groqApiKey,
  baseURL: groqBaseUrl,
});

export function createSession() {
  return {
    messages: [],
    lastTouchedTaskId: null,
    lastSearchResults: [],
    toolCallNamesThisTurn: [],
  };
}

export async function runAgentTurn(session, userText, onEvent = async () => {}) {
  session.toolCallNamesThisTurn = [];
  session.lastSearchResults = [];

  const todayIso = toIsoDate(new Date());
  const systemPrompt = buildSystemPrompt(todayIso);

  session.messages.push({ role: "user", content: userText });
  trimHistory(session);

  await onEvent({ type: "thinking" });

  let rounds = 0;
  const turnTrace = {
    input: userText,
    tools: [],
    reply: null,
    at: new Date().toISOString(),
  };

  while (rounds < maxToolRounds) {
    rounds += 1;

    let response;
    try {
      response = await client.chat.completions.create({
        model: groqModel,
        temperature: 0,
        messages: [{ role: "system", content: systemPrompt }, ...session.messages],
        tools: toolDefinitions,
        tool_choice: "auto",
        // GPT-OSS models: keep reasoning out of the assistant content when tools are used
        include_reasoning: false,
      });
    } catch (error) {
      await onEvent({
        type: "error",
        message: friendlyApiError(error),
      });
      turnTrace.reply = friendlyApiError(error);
      await writeTurnLog(turnTrace);
      return { reply: friendlyApiError(error), lastTouchedTaskId: session.lastTouchedTaskId };
    }

    const choice = response.choices?.[0]?.message;
    if (!choice) {
      const reply = "I got an empty response from the model. Please try again.";
      await onEvent({ type: "error", message: reply });
      return { reply, lastTouchedTaskId: session.lastTouchedTaskId };
    }

    const toolCalls = choice.tool_calls || [];

    if (toolCalls.length === 0) {
      const reply = (choice.content || "").trim() || "Done.";
      session.messages.push({
        role: "assistant",
        content: reply,
      });
      turnTrace.reply = reply;
      await writeTurnLog(turnTrace);
      await onEvent({ type: "reply", text: reply });
      return { reply, lastTouchedTaskId: session.lastTouchedTaskId };
    }

    session.messages.push({
      role: "assistant",
      content: choice.content || null,
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const name = toolCall.function?.name;
      const argText = toolCall.function?.arguments || "{}";

      await onEvent({
        type: "tool_start",
        name,
        argsPreview: shorten(argText, 80),
      });

      let result;
      try {
        result = await runTool(name, argText, session);
      } catch (error) {
        result = { ok: false, error: error.message };
      }

      const harness = result.harness || null;
      if (harness === "refused") {
        await onEvent({
          type: "harness",
          kind: "refused",
          message: result.error,
        });
      } else if (harness === "downgraded") {
        await onEvent({
          type: "harness",
          kind: "downgraded",
          message: result.harnessNote || "Action was safely downgraded.",
        });
      }

      await onEvent({
        type: "tool_end",
        name,
        summary: summariseToolResult(name, result),
        ok: Boolean(result.ok),
      });

      turnTrace.tools.push({ name, result: summariseToolResult(name, result) });

      const payload = truncateJson(result, maxToolResultChars);
      session.messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: payload,
      });
    }
  }

  const reply =
    "I hit my step limit for this turn. Tell me what you'd like me to do next, or ask a clarifying question.";
  await onEvent({ type: "reply", text: reply });
  turnTrace.reply = reply;
  await writeTurnLog(turnTrace);
  return { reply, lastTouchedTaskId: session.lastTouchedTaskId };
}

export async function loadSourcesForLastTask(session) {
  if (!session.lastTouchedTaskId) return null;
  const sources = await selectTaskSources(session.lastTouchedTaskId);
  return {
    taskId: session.lastTouchedTaskId,
    sources,
  };
}

function trimHistory(session) {
  const keep = maxHistoryTurns * 4;
  if (session.messages.length > keep) {
    session.messages = session.messages.slice(-keep);
  }
}

function truncateJson(value, maxChars) {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "…[truncated]";
}

function shorten(text, max) {
  const clean = String(text).replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  return clean.slice(0, max) + "…";
}

function summariseToolResult(name, result) {
  if (!result?.ok) {
    return result?.error || "failed";
  }
  if (name === "searchTasks") {
    return `${result.count} match${result.count === 1 ? "" : "es"}`;
  }
  if (name === "createTask") {
    return `created · ${result.task?.title || "task"}`;
  }
  if (name === "updateTask") {
    return `updated · ${result.task?.title || "task"}`;
  }
  if (name === "flagConflict") {
    return `conflict flagged · ${result.task?.title || "task"}`;
  }
  if (name === "listTasks") {
    return `${(result.tasks || []).length} task(s)`;
  }
  if (name === "getTaskHistory") {
    return `${(result.sources || []).length} source(s)`;
  }
  return "ok";
}

function friendlyApiError(error) {
  const message = error?.message || String(error);
  if (/rate limit/i.test(message)) {
    return "Groq rate limit hit. Wait a few seconds and try again.";
  }
  if (/401|invalid.*api.?key/i.test(message)) {
    return "Groq API key looks invalid. Check GROQ_API_KEY in .env.local.";
  }
  return `Something went wrong talking to the model: ${message}`;
}

async function writeTurnLog(turnTrace) {
  try {
    const folder = join(projectRootPath, "logs");
    await mkdir(folder, { recursive: true });
    await appendFile(
      join(folder, "turns.jsonl"),
      JSON.stringify(turnTrace) + "\n",
      "utf8"
    );
  } catch {
    // Logging is optional; never break the agent for it.
  }
}
