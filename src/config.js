import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const thisFolder = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(thisFolder, "..");

loadEnv({ path: join(projectRoot, ".env.local") });

function requireEnv(name) {
  const value = process.env[name];
  if (!value || value.includes("your_") || value.includes("your-")) {
    console.error(
      `\nMissing or placeholder value for ${name}.\n` +
        `Open .env.local and set a real value. See .env.example.\n`
    );
    process.exit(1);
  }
  return value;
}

export const groqApiKey = requireEnv("GROQ_API_KEY");
export const groqBaseUrl =
  process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
export const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

export const supabaseUrl = requireEnv("SUPABASE_URL");
export const supabaseServiceKey = requireEnv("SUPABASE_SERVICE_KEY");

export const maxToolRounds = 6;
export const maxHistoryTurns = 10;
export const maxToolResultChars = 2000;

export const projectRootPath = projectRoot;
