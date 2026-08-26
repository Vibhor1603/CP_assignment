import chalk from "chalk";
import ora from "ora";
import { getTaskById } from "./storage.js";

export function printBanner() {
  console.log("");
  console.log(chalk.cyan("  ▐▛███▜▌"));
  console.log(
    chalk.cyan(" ▝▜█████▛▘") + "  " + chalk.bold.cyan("DEADLINE AGENT")
  );
  console.log(
    chalk.cyan("   ▘▘ ▝▝") +
      "    " +
      chalk.dim("type a message or ask anything · s/sources · exit")
  );
  console.log("");
}

export function createDisplay() {
  let spinner = null;

  return {
    startThinking() {
      stopSpinner(spinner);
      spinner = ora({
        text: chalk.dim("thinking…"),
        color: "cyan",
      }).start();
    },

    toolStart(name, argsPreview) {
      if (spinner) {
        spinner.text = chalk.dim(`tool  ${name}(${argsPreview})`);
      }
    },

    toolEnd(name, summary, ok) {
      stopSpinner(spinner);
      spinner = null;
      const mark = ok ? chalk.green("✓") : chalk.red("✗");
      console.log(`  ${mark} ${chalk.bold(name)}  ${chalk.dim("·")} ${summary}`);
      spinner = ora({
        text: chalk.dim("thinking…"),
        color: "cyan",
      }).start();
    },

    harness(kind, message) {
      stopSpinner(spinner);
      spinner = null;
      const label =
        kind === "refused"
          ? chalk.yellow("⚠ harness refused")
          : chalk.yellow("⚠ harness downgraded");
      console.log(`  ${label}`);
      console.log(chalk.dim(`    ${message}`));
      spinner = ora({
        text: chalk.dim("thinking…"),
        color: "cyan",
      }).start();
    },

    reply(text) {
      stopSpinner(spinner);
      spinner = null;
      console.log("");
      const clean = stripMarkdownForTerminal(text);
      for (const line of clean.split("\n")) {
        console.log(`  ${chalk.white(line)}`);
      }
      console.log("");
    },

    sourcesHint(count) {
      if (!count) return;
      console.log(
        chalk.dim(
          `  ▸ ${count} source${count === 1 ? "" : "s"} · type "sources" or "s" to expand`
        )
      );
      console.log("");
    },

    error(message) {
      stopSpinner(spinner);
      spinner = null;
      console.log(chalk.red(`  ${message}`));
      console.log("");
    },

    stop() {
      stopSpinner(spinner);
      spinner = null;
    },
  };
}

export async function printSourcesPanel(taskId, sources) {
  const task = await getTaskById(taskId);
  const title = task?.title || "task";

  console.log("");
  console.log(chalk.cyan(`  sources for ${title}`));
  console.log(chalk.dim("  ─────────────────────────────"));

  if (!sources || sources.length === 0) {
    console.log(chalk.dim("  (no sources saved yet)"));
  } else {
    sources.forEach((source, index) => {
      const date = source.claimed_due_date || "unknown date";
      const claim = source.claim_type || "statement";
      const channel = source.channel || "unknown";
      console.log(
        chalk.white(
          `  ${index + 1}. ${date} · ${claim} · ${channel}`
        )
      );
      console.log(chalk.dim(`     "${source.raw_message}"`));
      if (index < sources.length - 1) console.log("");
    });
  }

  console.log(chalk.dim("  ─────────────────────────────"));
  console.log("");
}

function stopSpinner(spinner) {
  if (spinner) {
    spinner.stop();
  }
}

/** Terminals don't render markdown — strip it so replies look normal. */
export function stripMarkdownForTerminal(text) {
  return String(text || "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\u2011|\u2012|\u2013|\u2014|\u2212/g, "-") // non-breaking / fancy dashes → -
    .replace(/\u00a0|\u202f|\u2007|\u2009|\u200a/g, " ") // weird spaces → normal
    .replace(/\u2026/g, "...")
    .trim();
}

