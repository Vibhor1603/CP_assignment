/**
 * Canonical course codes + aliases so "DBMS" and
 * "Database Management System" count as the same course.
 */

const COURSE_ALIASES = [
  {
    canonical: "DBMS",
    aliases: [
      "dbms",
      "database management system",
      "database management systems",
      "database systems",
      "database system",
      "databases",
      "database",
      "db",
    ],
  },
  {
    canonical: "OS",
    aliases: [
      "os",
      "operating system",
      "operating systems",
      "opsys",
      "op sys",
    ],
  },
  {
    canonical: "CN",
    aliases: [
      "cn",
      "computer network",
      "computer networks",
      "computer networking",
      "networking",
      "networks",
    ],
  },
  {
    canonical: "SE",
    aliases: [
      "se",
      "software engineering",
      "software engg",
      "soft engg",
    ],
  },
  {
    canonical: "AI",
    aliases: ["ai", "artificial intelligence", "a.i."],
  },
  {
    canonical: "ML",
    aliases: ["ml", "machine learning", "machine-learning"],
  },
  {
    canonical: "DSA",
    aliases: [
      "dsa",
      "data structures",
      "data structure",
      "data structures and algorithms",
      "ds algo",
      "ds and algo",
    ],
  },
  {
    canonical: "Compiler Design",
    aliases: ["compiler design", "compiler", "compilers", "cd"],
  },
  {
    canonical: "Web",
    aliases: [
      "web",
      "web technology",
      "web technologies",
      "web lab",
      "web development",
      "webdev",
    ],
  },
  {
    canonical: "Python",
    aliases: ["python", "python lab", "python programming"],
  },
  {
    canonical: "Maths",
    aliases: [
      "maths",
      "math",
      "mathematics",
      "probability",
      "discrete maths",
      "discrete mathematics",
      "discrete math",
    ],
  },
  {
    canonical: "IoT",
    aliases: ["iot", "internet of things"],
  },
  {
    canonical: "NLP",
    aliases: ["nlp", "natural language processing"],
  },
  {
    canonical: "Security",
    aliases: [
      "security",
      "cyber security",
      "cybersecurity",
      "information security",
      "infosec",
      "cryptography",
    ],
  },
  {
    canonical: "HCI",
    aliases: [
      "hci",
      "ui/ux",
      "uiux",
      "human computer interaction",
      "human-computer interaction",
    ],
  },
  {
    canonical: "Distributed Systems",
    aliases: ["distributed systems", "distributed system", "dist sys"],
  },
  {
    canonical: "Cloud",
    aliases: ["cloud", "cloud computing", "cloud computing lab"],
  },
  {
    canonical: "Graphics",
    aliases: ["graphics", "computer graphics", "cg"],
  },
  {
    canonical: "TOC",
    aliases: [
      "toc",
      "theory of computation",
      "automata",
      "automata theory",
    ],
  },
  {
    canonical: "Digital Logic",
    aliases: ["digital logic", "dld", "digital logic design"],
  },
  {
    canonical: "Microprocessors",
    aliases: ["microprocessors", "microprocessor", "mp", "mpi"],
  },
  {
    canonical: "Data Mining",
    aliases: ["data mining", "dm"],
  },
  {
    canonical: "Parallel Computing",
    aliases: ["parallel computing", "parallel systems"],
  },
];

/** Phrases to expand inside titles before similarity compare */
const TITLE_SYNONYMS = [
  [/database management systems?/gi, "dbms"],
  [/database systems?/gi, "dbms"],
  [/operating systems?/gi, "os"],
  [/computer networks?/gi, "cn"],
  [/software engineering/gi, "se"],
  [/artificial intelligence/gi, "ai"],
  [/machine learning/gi, "ml"],
  [/data structures?(?:\s+and\s+algorithms)?/gi, "dsa"],
  [/assign(?:ment)?s?/gi, "assignment"],
  [/ass+n\.?/gi, "assignment"],
  [/\ba\s*(\d+)\b/gi, "assignment $1"],
  [/\bhw\b/gi, "homework"],
  [/\bhome\s*work\b/gi, "homework"],
  [/\blabs?\b/gi, "lab"],
  [/\bproj(?:ect)?s?\b/gi, "project"],
  [/\breports?\b/gi, "report"],
  [/\bquizzes\b/gi, "quiz"],
  [/\bmids?\b/gi, "midterm"],
  [/\bmiddle\s*term\b/gi, "midterm"],
];

function normaliseKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Map any alias or code to a single canonical course label.
 * "Database Management System" → "DBMS"
 */
export function canonicalCourse(value) {
  if (!value) return null;
  const key = normaliseKey(value);
  if (!key) return null;

  for (const entry of COURSE_ALIASES) {
    if (normaliseKey(entry.canonical) === key) return entry.canonical;
    for (const alias of entry.aliases) {
      if (normaliseKey(alias) === key) return entry.canonical;
    }
  }

  // Partial: value contains a known alias as a phrase
  for (const entry of COURSE_ALIASES) {
    for (const alias of entry.aliases) {
      const aliasKey = normaliseKey(alias);
      if (aliasKey.length >= 3 && key.includes(aliasKey)) {
        return entry.canonical;
      }
    }
  }

  // Title-case unknown courses lightly
  return String(value).trim();
}

export function coursesMatch(left, right) {
  if (!left || !right) return false;
  return canonicalCourse(left) === canonicalCourse(right);
}

export function inferCourseFromText(...parts) {
  const text = normaliseKey(parts.filter(Boolean).join(" "));
  if (!text) return null;

  // Longer aliases first so "database management system" wins over "database"
  const ranked = [];
  for (const entry of COURSE_ALIASES) {
    for (const alias of entry.aliases) {
      ranked.push({
        canonical: entry.canonical,
        alias: normaliseKey(alias),
      });
    }
  }
  ranked.sort((a, b) => b.alias.length - a.alias.length);

  for (const item of ranked) {
    if (!item.alias) continue;
    const pattern = new RegExp(`(^|\\s)${escapeRegex(item.alias)}(\\s|$)`);
    if (pattern.test(` ${text} `)) {
      return item.canonical;
    }
  }
  return null;
}

export function resolveCourse(explicitCourse, ...textParts) {
  if (explicitCourse && String(explicitCourse).trim()) {
    return canonicalCourse(explicitCourse);
  }
  return inferCourseFromText(...textParts);
}

/** Expand synonyms so similarity treats aliases as the same tokens. */
export function expandForMatching(value) {
  let text = String(value || "");
  for (const [pattern, replacement] of TITLE_SYNONYMS) {
    text = text.replace(pattern, replacement);
  }
  return normaliseKey(text);
}

export function similarityScore(left, right) {
  const a = expandForMatching(left);
  const b = expandForMatching(right);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const leftTokens = new Set(a.split(" ").filter(Boolean));
  const rightTokens = new Set(b.split(" ").filter(Boolean));
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const tokenScore = union === 0 ? 0 : overlap / union;

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  const includesBonus = longer.includes(shorter) ? 0.2 : 0;

  // Number match bonus: "assignment 2" vs "a2" / "assignment 2"
  const numA = a.match(/\b(\d+)\b/g) || [];
  const numB = b.match(/\b(\d+)\b/g) || [];
  let numberBonus = 0;
  if (numA.length && numB.length && numA.some((n) => numB.includes(n))) {
    numberBonus = 0.15;
  }

  return Math.min(1, tokenScore + includesBonus + numberBonus);
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
