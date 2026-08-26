import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseServiceKey } from "./config.js";
import {
  canonicalCourse,
  coursesMatch,
  similarityScore,
} from "./courseFromText.js";

const database = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export function normaliseText(value) {
  if (!value) return "";
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function searchTasksByText(searchText, course = null) {
  // Fetch recent tasks, then match in JS so course aliases work
  // (DBMS ↔ Database Management System) and titles can synonym-match.
  const { data, error } = await database
    .from("tasks")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(80);

  if (error) throw new Error(`searchTasks failed: ${error.message}`);

  const wantedCourse = course ? canonicalCourse(course) : null;

  const scored = (data || [])
    .map((task) => {
      let score = similarityScore(searchText, task.title);
      if (wantedCourse && coursesMatch(wantedCourse, task.course)) {
        score = Math.min(1, score + 0.2);
      } else if (wantedCourse && task.course && !coursesMatch(wantedCourse, task.course)) {
        score *= 0.35;
      }
      return { ...task, similarity: score };
    })
    .filter((task) => task.similarity >= 0.22)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, 8);

  return scored;
}

export async function insertTask({
  title,
  course,
  dueDate,
  weightage,
  status,
}) {
  const { data, error } = await database
    .from("tasks")
    .insert({
      title,
      course: course ? canonicalCourse(course) : null,
      due_date: dueDate || null,
      weightage: weightage || null,
      status: status || "confirmed",
    })
    .select("*")
    .single();

  if (error) throw new Error(`insertTask failed: ${error.message}`);
  return data;
}

export async function applyTaskUpdate(taskId, fields) {
  const patch = { updated_at: new Date().toISOString() };

  if (fields.title !== undefined) patch.title = fields.title;
  if (fields.course !== undefined) {
    patch.course = fields.course ? canonicalCourse(fields.course) : null;
  }
  if (fields.dueDate !== undefined) patch.due_date = fields.dueDate;
  if (fields.weightage !== undefined) patch.weightage = fields.weightage;
  if (fields.status !== undefined) patch.status = fields.status;

  const { data, error } = await database
    .from("tasks")
    .update(patch)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error) throw new Error(`applyTaskUpdate failed: ${error.message}`);
  return data;
}

export async function getTaskById(taskId) {
  const { data, error } = await database
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();

  if (error) throw new Error(`getTaskById failed: ${error.message}`);
  return data;
}

export async function insertTaskSource({
  taskId,
  rawMessage,
  claimedDueDate,
  claimType,
  channel,
}) {
  const { data, error } = await database
    .from("task_sources")
    .insert({
      task_id: taskId,
      raw_message: rawMessage,
      claimed_due_date: claimedDueDate || null,
      claim_type: claimType || "statement",
      channel: channel || "unknown",
    })
    .select("*")
    .single();

  if (error) throw new Error(`insertTaskSource failed: ${error.message}`);
  return data;
}

export async function selectTaskSources(taskId) {
  const { data, error } = await database
    .from("task_sources")
    .select("*")
    .eq("task_id", taskId)
    .order("received_at", { ascending: true });

  if (error) throw new Error(`selectTaskSources failed: ${error.message}`);
  return data || [];
}

export async function selectTasksByFilters({
  timeRange,
  course,
  onlyUnconfirmed,
}) {
  let query = database.from("tasks").select("*");

  if (onlyUnconfirmed) {
    query = query.eq("status", "needs_confirmation");
  }

  const { data, error } = await query.order("due_date", {
    ascending: true,
    nullsFirst: false,
  });

  if (error) throw new Error(`selectTasksByFilters failed: ${error.message}`);

  let rows = data || [];

  if (course) {
    rows = rows.filter((task) => coursesMatch(course, task.course));
  }

  const today = startOfDay(new Date());

  if (!timeRange || timeRange === "all") return rows;

  if (timeRange === "unknown_date") {
    return rows.filter((task) => !task.due_date);
  }

  if (timeRange === "today") {
    const iso = toIsoDate(today);
    return rows.filter((task) => task.due_date === iso);
  }

  if (timeRange === "overdue") {
    const iso = toIsoDate(today);
    return rows.filter(
      (task) => task.due_date && task.due_date < iso && task.status !== "cancelled"
    );
  }

  if (timeRange === "this_week") {
    const weekStart = startOfWeek(today);
    const weekEnd = addDays(weekStart, 7);
    return rows.filter((task) => {
      if (!task.due_date) return false;
      return task.due_date >= toIsoDate(weekStart) && task.due_date < toIsoDate(weekEnd);
    });
  }

  if (timeRange === "next_week") {
    const weekStart = addDays(startOfWeek(today), 7);
    const weekEnd = addDays(weekStart, 7);
    return rows.filter((task) => {
      if (!task.due_date) return false;
      return task.due_date >= toIsoDate(weekStart) && task.due_date < toIsoDate(weekEnd);
    });
  }

  return rows;
}

export async function countTasks() {
  const { count, error } = await database
    .from("tasks")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(`countTasks failed: ${error.message}`);
  return count || 0;
}

export async function wipeAllTasks() {
  const { error: sourcesError } = await database
    .from("task_sources")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (sourcesError) {
    throw new Error(`wipe sources failed: ${sourcesError.message}`);
  }

  const { error: tasksError } = await database
    .from("tasks")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (tasksError) {
    throw new Error(`wipe tasks failed: ${tasksError.message}`);
  }
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date) {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(startOfDay(date), diff);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
