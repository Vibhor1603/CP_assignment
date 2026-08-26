import { wipeAllTasks } from "../src/storage.js";

async function main() {
  await wipeAllTasks();
  console.log("Database cleared. Ready for a clean demo.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
