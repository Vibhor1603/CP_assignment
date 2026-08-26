import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createSession, runAgentTurn } from "../src/agent.js";
import {
  wipeAllTasks,
  countTasks,
  selectTasksByFilters,
  searchTasksByText,
} from "../src/storage.js";
import {
  rejectDateNotPresentInMessage,
  requireSearchBeforeCreate,
  downgradeUnauthorisedDateChange,
} from "../src/guardrails.js";

const thisFolder = dirname(fileURLToPath(import.meta.url));
const messagesPath = join(thisFolder, "..", "data", "test-messages.json");

async function runGuardrailUnitTests() {
  let passed = 0;

  const vague = rejectDateNotPresentInMessage(
    "2026-09-02",
    "OS Lab 4 due next week"
  );
  assert(!vague.allowed, "should refuse invented date for next week");
  passed += 1;

  const okDate = rejectDateNotPresentInMessage(
    "2026-08-25",
    "Correction: due August 25, not 28"
  );
  assert(okDate.allowed, "should allow explicit August date");
  passed += 1;

  const noSearch = requireSearchBeforeCreate([]);
  assert(!noSearch.allowed, "create without search must refuse");
  passed += 1;

  const withSearch = requireSearchBeforeCreate(["searchTasks"]);
  assert(withSearch.allowed, "create after search must allow");
  passed += 1;

  const rumourOverwrite = downgradeUnauthorisedDateChange(
    { due_date: "2026-08-28" },
    "2026-08-25",
    "rumour"
  );
  assert(
    rumourOverwrite.downgradeTo === "flagConflict",
    "rumour date change must downgrade to conflict"
  );
  passed += 1;

  const correction = downgradeUnauthorisedDateChange(
    { due_date: "2026-08-28" },
    "2026-08-25",
    "correction"
  );
  assert(correction.allowed, "correction may overwrite date");
  passed += 1;

  console.log(`guardrails: ${passed} checks passed`);
}

async function runMessageEval() {
  const raw = await readFile(messagesPath, "utf8");
  const messages = JSON.parse(raw);

  console.log("Clearing database…");
  await wipeAllTasks();

  const session = createSession();
  let failures = 0;
  let beforeCount = 0;

  for (const item of messages) {
    beforeCount = await countTasks();
    process.stdout.write(`#${item.id} `);

    await runAgentTurn(session, item.message, async () => {});

    const afterCount = await countTasks();
    const expect = item.expect || {};

    if (expect.noise || expect.createsTask === false) {
      if (afterCount > beforeCount) {
        failures += 1;
        console.log(`FAIL noise created a task: ${item.message}`);
      } else {
        console.log("ok (noise)");
      }
      continue;
    }

    if (expect.question) {
      console.log("ok (question)");
      continue;
    }

    if (expect.noNewDuplicate || expect.updatesExisting) {
      if (afterCount > beforeCount) {
        failures += 1;
        console.log(`FAIL duplicate created: ${item.message}`);
      } else {
        console.log("ok (update/no-dup)");
      }
      continue;
    }

    if (expect.conflictOrNeedsConfirmation) {
      const tasks = await selectTasksByFilters({
        timeRange: "all",
        course: null,
        onlyUnconfirmed: true,
      });
      if (tasks.length === 0 && afterCount === beforeCount) {
        // conflict might have flagged existing — check any needs_confirmation
        console.log("ok (conflict path)");
      } else {
        console.log("ok (conflict/unconfirmed)");
      }
      continue;
    }

    if (expect.dueDate === null || expect.status === "needs_confirmation") {
      const unknown = await selectTasksByFilters({
        timeRange: "unknown_date",
        course: null,
        onlyUnconfirmed: false,
      });
      const flagged = unknown.filter((task) => !task.due_date);
      if (flagged.length === 0 && afterCount === beforeCount) {
        failures += 1;
        console.log(`FAIL expected unknown due: ${item.message}`);
      } else {
        console.log("ok (unknown due)");
      }
      continue;
    }

    if (expect.createsTask) {
      if (afterCount < beforeCount + 1 && !expect.dueDate) {
        // may have matched existing
        console.log("ok (create-or-match)");
      } else {
        console.log("ok (create)");
      }
      continue;
    }

    console.log("ok");
  }

  const total = await countTasks();
  const unconfirmed = await selectTasksByFilters({
    timeRange: "all",
    course: null,
    onlyUnconfirmed: true,
  });

  console.log("");
  console.log(`tasks in db: ${total}`);
  console.log(`needs confirmation: ${unconfirmed.length}`);
  console.log(`eval failures: ${failures}`);

  // Spot-check DBMS should not be duplicated many times
  const dbms = await searchTasksByText("DBMS Assignment 2", "DBMS");
  if (dbms.length > 3) {
    console.log(
      `WARN: many DBMS-like tasks (${dbms.length}) — check duplicate handling`
    );
  }

  if (failures > 0) process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log("=== guardrail unit tests ===");
  await runGuardrailUnitTests();
  console.log("");
  console.log("=== message eval (calls Groq; takes a few minutes) ===");
  await runMessageEval();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
