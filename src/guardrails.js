import { coursesMatch } from "./courseFromText.js";

/**
 * Tool harness — runs INSIDE tool execution after the LLM chooses a tool.
 * The agent is free to call tools; these checks decide allow / refuse / downgrade.
 */

const WEEKDAY_WORDS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

const VAGUE_PHRASES = [
  "next week",
  "this week",
  "soon",
  "later",
  "tbd",
  "to be decided",
  "to be confirmed",
  "sometime",
  "after midterms",
  "after exams",
  "coming week",
  "upcoming week",
];

export function rejectDateNotPresentInMessage(dueDate, sourceMessage) {
  if (!dueDate) {
    return { allowed: true };
  }

  const message = String(sourceMessage || "").toLowerCase();
  if (!message.trim()) {
    return {
      allowed: false,
      refusalMessage:
        "No source message provided. Pass the user's original message as sourceMessage, and use dueDate null if the date is unclear.",
    };
  }

  if (messageHasSpecificDateSignal(message, dueDate)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    refusalMessage:
      "The message does not contain a specific calendar date for the due date you proposed. " +
      "Create or update the task with dueDate set to null instead, and mark it needs confirmation. Do not invent a date.",
  };
}

export function requireSearchBeforeCreate(toolCallHistoryThisTurn) {
  const searched = (toolCallHistoryThisTurn || []).some(
    (name) => name === "searchTasks"
  );

  if (searched) {
    return { allowed: true };
  }

  return {
    allowed: false,
    refusalMessage:
      "You must call searchTasks before createTask in the same turn, to avoid duplicates. Search first, then create only if nothing matching exists.",
  };
}

export function downgradeUnauthorisedDateChange(
  existingTask,
  newDate,
  claimType
) {
  if (!existingTask) {
    return { allowed: true };
  }

  const storedDate = existingTask.due_date || null;
  if (!newDate || !storedDate) {
    return { allowed: true };
  }

  if (storedDate === newDate) {
    return { allowed: true };
  }

  if (claimType === "correction") {
    return { allowed: true };
  }

  return {
    allowed: false,
    downgradeTo: "flagConflict",
    reason:
      "Incoming date differs from the stored date, but claimType is not correction. " +
      "Treating this as a conflict instead of overwriting. Call flagConflict (or accept this downgrade).",
  };
}

export function warnAboutLikelyDuplicate(candidateTasks, proposedTitle, course) {
  const sameCourse = (candidateTasks || []).filter((task) => {
    if (!course || !task.course) return true;
    return coursesMatch(course, task.course);
  });

  const close = sameCourse.find((task) => (task.similarity || 0) >= 0.72);
  if (!close) {
    return { allowed: true };
  }

  return {
    allowed: true,
    warning:
      `A similar task already exists: "${close.title}" (id ${close.id}, similarity ${close.similarity.toFixed(2)}). ` +
      `If this is the same deliverable, update that task instead of creating a new one. Proposed title was "${proposedTitle}".`,
  };
}

function messageHasSpecificDateSignal(message, dueDate) {
  for (const phrase of VAGUE_PHRASES) {
    if (message.includes(phrase) && !hasExplicitCalendarHint(message, dueDate)) {
      return false;
    }
  }

  if (hasExplicitCalendarHint(message, dueDate)) {
    return true;
  }

  for (const day of WEEKDAY_WORDS) {
    if (new RegExp(`\\b${day}\\b`, "i").test(message)) {
      return true;
    }
  }

  if (/\b(today|tomorrow|tonight)\b/i.test(message)) {
    return true;
  }

  return false;
}

function hasExplicitCalendarHint(message, dueDate) {
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(message)) return true;
  if (/\b\d{1,2}[\/.\-]\d{1,2}([\/.\-]\d{2,4})?\b/.test(message)) return true;

  const months =
    "january|february|march|april|may|june|july|august|september|october|november|december|" +
    "jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

  if (new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)?\\s+(${months})\\b`, "i").test(message)) {
    return true;
  }
  if (new RegExp(`\\b(${months})\\s+(\\d{1,2})(st|nd|rd|th)?\\b`, "i").test(message)) {
    return true;
  }

  if (dueDate) {
    const [, month, day] = String(dueDate).split("-");
    const dayNum = String(Number(day));
    if (message.includes(dueDate)) return true;
    if (new RegExp(`\\b${dayNum}(st|nd|rd|th)?\\b`).test(message) && month) {
      return true;
    }
  }

  return false;
}
