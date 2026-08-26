import {
  searchTasksByText,
  insertTask,
  applyTaskUpdate,
  getTaskById,
  insertTaskSource,
  selectTaskSources,
  selectTasksByFilters,
} from "./storage.js";
import {
  rejectDateNotPresentInMessage,
  requireSearchBeforeCreate,
  downgradeUnauthorisedDateChange,
  warnAboutLikelyDuplicate,
} from "./guardrails.js";
import { resolveCourse, coursesMatch } from "./courseFromText.js";

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "searchTasks",
      description:
        "Search existing tasks before creating anything new. Always call this first when a message might refer to a known assignment. Returns candidate tasks with a similarity score.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["searchText", "course"],
        properties: {
          searchText: {
            type: "string",
            description: "Title or keywords, e.g. 'DBMS Assignment 2'",
          },
          course: {
            type: ["string", "null"],
            description:
              "Course code or name if known (DBMS, OS, CN, SE, AI, …). Prefer a short code. Null only if truly unknown.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getTaskHistory",
      description:
        "Load every source message for one task. Use before deciding update vs conflict, so you can see prior dates and claim types.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["taskId"],
        properties: {
          taskId: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createTask",
      description:
        "Create a NEW task only after searchTasks found no good match. If the message has no specific date (e.g. 'next week'), set dueDate to null and isDateCertain to false.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "course",
          "dueDate",
          "weightage",
          "isDateCertain",
          "claimType",
          "channel",
          "sourceMessage",
        ],
        properties: {
          title: { type: "string" },
          course: {
            type: ["string", "null"],
            description:
              "ALWAYS set when the message names a course or the title contains a course code (DBMS, OS, CN, SE, AI…). Example: 'DBMS Assignment 2' → course 'DBMS'. Null only if truly unknown.",
          },
          dueDate: {
            type: ["string", "null"],
            description: "YYYY-MM-DD, or null if unknown / vague",
          },
          weightage: { type: ["string", "null"] },
          isDateCertain: { type: "boolean" },
          claimType: {
            type: "string",
            enum: ["correction", "rumour", "statement"],
          },
          channel: {
            type: "string",
            enum: ["whatsapp", "email", "class", "unknown"],
          },
          sourceMessage: {
            type: "string",
            description: "The user's original message, verbatim",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "updateTask",
      description:
        "Update an existing task (correction, fill missing fields, change weightage). Use claimType=correction only for authoritative corrections. Never invent a dueDate.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: [
          "taskId",
          "dueDate",
          "weightage",
          "title",
          "course",
          "claimType",
          "channel",
          "sourceMessage",
        ],
        properties: {
          taskId: { type: "string" },
          dueDate: {
            type: ["string", "null"],
            description:
              "YYYY-MM-DD to set, or null to leave the stored date unchanged",
          },
          weightage: {
            type: ["string", "null"],
            description: "New weightage, or null to leave unchanged",
          },
          title: {
            type: ["string", "null"],
            description: "New title, or null to leave unchanged",
          },
          course: {
            type: ["string", "null"],
            description:
              "Course to set if known or missing on the task; null to leave unchanged",
          },
          claimType: {
            type: "string",
            enum: ["correction", "rumour", "statement"],
          },
          channel: {
            type: "string",
            enum: ["whatsapp", "email", "class", "unknown"],
          },
          sourceMessage: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flagConflict",
      description:
        "Mark a task as needs confirmation when sources disagree (e.g. rumour vs stored date). Does not overwrite the current best due date. Always appends the conflicting source.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["taskId", "conflictingDate", "channel", "sourceMessage"],
        properties: {
          taskId: { type: "string" },
          conflictingDate: {
            type: ["string", "null"],
            description: "The disagreeing YYYY-MM-DD, or null if vague",
          },
          channel: {
            type: "string",
            enum: ["whatsapp", "email", "class", "unknown"],
          },
          sourceMessage: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listTasks",
      description:
        "Read tasks from the database to answer questions like 'what is due this week?'. Always use this instead of answering from chat memory.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["timeRange", "course", "onlyUnconfirmed"],
        properties: {
          timeRange: {
            type: "string",
            enum: [
              "today",
              "this_week",
              "next_week",
              "overdue",
              "unknown_date",
              "all",
            ],
          },
          course: { type: ["string", "null"] },
          onlyUnconfirmed: { type: "boolean" },
        },
      },
    },
  },
];

export async function runTool(toolName, rawArgs, session) {
  const args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs || {};

  switch (toolName) {
    case "searchTasks":
      return runSearchTasks(args, session);
    case "getTaskHistory":
      return runGetTaskHistory(args);
    case "createTask":
      return runCreateTask(args, session);
    case "updateTask":
      return runUpdateTask(args, session);
    case "flagConflict":
      return runFlagConflict(args, session);
    case "listTasks":
      return runListTasks(args);
    default:
      return { ok: false, error: `Unknown tool: ${toolName}` };
  }
}

async function runSearchTasks(args, session) {
  const results = await searchTasksByText(args.searchText, args.course);
  session.lastSearchResults = results;
  session.toolCallNamesThisTurn.push("searchTasks");
  return {
    ok: true,
    count: results.length,
    tasks: results.map((task) => ({
      id: task.id,
      title: task.title,
      course: task.course,
      dueDate: task.due_date,
      weightage: task.weightage,
      status: task.status,
      similarity: Number(task.similarity.toFixed(2)),
    })),
  };
}

async function runGetTaskHistory(args) {
  const task = await getTaskById(args.taskId);
  if (!task) {
    return { ok: false, error: "No task with that id." };
  }
  const sources = await selectTaskSources(args.taskId);
  return {
    ok: true,
    task: summariseTask(task),
    sources: sources.map(summariseSource),
  };
}

async function runCreateTask(args, session) {
  const searchGate = requireSearchBeforeCreate(session.toolCallNamesThisTurn);
  if (!searchGate.allowed) {
    return {
      ok: false,
      harness: "refused",
      error: searchGate.refusalMessage,
    };
  }

  const dateGate = rejectDateNotPresentInMessage(
    args.dueDate,
    args.sourceMessage
  );
  if (!dateGate.allowed) {
    return {
      ok: false,
      harness: "refused",
      error: dateGate.refusalMessage,
    };
  }

  const duplicateWarn = warnAboutLikelyDuplicate(
    session.lastSearchResults || [],
    args.title,
    args.course
  );

  let dueDate = args.dueDate || null;
  if (args.isDateCertain === false) {
    dueDate = null;
  }

  const status = dueDate ? "confirmed" : "needs_confirmation";
  const course = resolveCourse(args.course, args.title, args.sourceMessage);

  const task = await insertTask({
    title: args.title,
    course,
    dueDate,
    weightage: args.weightage,
    status,
  });

  await insertTaskSource({
    taskId: task.id,
    rawMessage: args.sourceMessage,
    claimedDueDate: dueDate,
    claimType: args.claimType || "statement",
    channel: args.channel || "unknown",
  });

  session.lastTouchedTaskId = task.id;
  session.toolCallNamesThisTurn.push("createTask");

  return {
    ok: true,
    harness: "allowed",
    warning: duplicateWarn.warning || null,
    task: summariseTask(task),
  };
}

async function runUpdateTask(args, session) {
  const existing = await getTaskById(args.taskId);
  if (!existing) {
    return { ok: false, error: "No task with that id." };
  }

  const dateGate = rejectDateNotPresentInMessage(
    args.dueDate,
    args.sourceMessage
  );
  if (!dateGate.allowed) {
    return {
      ok: false,
      harness: "refused",
      error: dateGate.refusalMessage,
    };
  }

  const downgrade = downgradeUnauthorisedDateChange(
    existing,
    args.dueDate,
    args.claimType
  );

  if (downgrade.downgradeTo === "flagConflict") {
    const conflictResult = await runFlagConflict(
      {
        taskId: args.taskId,
        conflictingDate: args.dueDate,
        channel: args.channel,
        sourceMessage: args.sourceMessage,
      },
      session
    );
    return {
      ...conflictResult,
      harness: "downgraded",
      harnessNote: downgrade.reason,
    };
  }

  const fields = {};
  if (args.title) fields.title = args.title;
  if (args.weightage) fields.weightage = args.weightage;
  if (args.dueDate) {
    fields.dueDate = args.dueDate;
    fields.status = "confirmed";
  }

  const resolvedCourse = resolveCourse(
    args.course,
    args.title,
    args.sourceMessage,
    existing.title
  );
  if (resolvedCourse && !existing.course) {
    fields.course = resolvedCourse;
  } else if (args.course) {
    fields.course = args.course;
  }

  const updated = await applyTaskUpdate(args.taskId, fields);

  await insertTaskSource({
    taskId: args.taskId,
    rawMessage: args.sourceMessage,
    claimedDueDate: args.dueDate || existing.due_date,
    claimType: args.claimType || "statement",
    channel: args.channel || "unknown",
  });

  session.lastTouchedTaskId = args.taskId;
  session.toolCallNamesThisTurn.push("updateTask");

  return {
    ok: true,
    harness: "allowed",
    task: summariseTask(updated),
    previousDueDate: existing.due_date,
  };
}

async function runFlagConflict(args, session) {
  const existing = await getTaskById(args.taskId);
  if (!existing) {
    return { ok: false, error: "No task with that id." };
  }

  const updated = await applyTaskUpdate(args.taskId, {
    status: "needs_confirmation",
  });

  await insertTaskSource({
    taskId: args.taskId,
    rawMessage: args.sourceMessage,
    claimedDueDate: args.conflictingDate || null,
    claimType: "rumour",
    channel: args.channel || "unknown",
  });

  const sources = await selectTaskSources(args.taskId);
  session.lastTouchedTaskId = args.taskId;
  session.toolCallNamesThisTurn.push("flagConflict");

  return {
    ok: true,
    harness: "allowed",
    task: summariseTask(updated),
    sources: sources.map(summariseSource),
  };
}

async function runListTasks(args) {
  const tasks = await selectTasksByFilters({
    timeRange: args.timeRange,
    course: args.course,
    onlyUnconfirmed: Boolean(args.onlyUnconfirmed),
  });

  const unconfirmed = await selectTasksByFilters({
    timeRange: "all",
    course: args.course,
    onlyUnconfirmed: true,
  });

  return {
    ok: true,
    tasks: tasks.map(summariseTask),
    needsConfirmation: unconfirmed.map(summariseTask),
  };
}

function summariseTask(task) {
  return {
    id: task.id,
    title: task.title,
    course: task.course,
    dueDate: task.due_date,
    weightage: task.weightage,
    status: task.status,
  };
}

function summariseSource(source) {
  return {
    claimedDueDate: source.claimed_due_date,
    claimType: source.claim_type,
    channel: source.channel,
    message: source.raw_message,
    receivedAt: source.received_at,
  };
}
