import readline from "readline";
import chalk from "chalk";
import { createSession, runAgentTurn } from "./agent.js";
import {
  printBanner,
  createDisplay,
  printSourcesPanel,
} from "./display.js";
import { selectTaskSources } from "./storage.js";

async function main() {
  printBanner();

  const session = createSession();
  const display = createDisplay();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("› "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const text = line.trim();

    if (!text) {
      rl.prompt();
      return;
    }

    if (["exit", "quit", "q"].includes(text.toLowerCase())) {
      console.log(chalk.dim("  bye"));
      rl.close();
      process.exit(0);
    }

    if (["s", "sources", "why", "details"].includes(text.toLowerCase())) {
      if (!session.lastTouchedTaskId) {
        console.log(
          chalk.dim("  nothing to show yet — send a task message first")
        );
        console.log("");
        rl.prompt();
        return;
      }
      const sources = await selectTaskSources(session.lastTouchedTaskId);
      await printSourcesPanel(session.lastTouchedTaskId, sources);
      rl.prompt();
      return;
    }

    rl.pause();

    try {
      await runAgentTurn(session, text, async (event) => {
        if (event.type === "thinking") display.startThinking();
        if (event.type === "tool_start") {
          display.toolStart(event.name, event.argsPreview);
        }
        if (event.type === "tool_end") {
          display.toolEnd(event.name, event.summary, event.ok);
        }
        if (event.type === "harness") {
          display.harness(event.kind, event.message);
        }
        if (event.type === "reply") {
          display.reply(event.text);
        }
        if (event.type === "error") {
          display.error(event.message);
        }
      });

      if (session.lastTouchedTaskId) {
        const sources = await selectTaskSources(session.lastTouchedTaskId);
        if (sources.length > 0) {
          display.sourcesHint(sources.length);
        }
      }
    } catch (error) {
      display.error(error.message || String(error));
    }

    rl.resume();
    rl.prompt();
  });

  rl.on("close", () => {
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
