import { configure, getConsoleSink, getLogger as getLogTapeLogger, type LogRecord } from "@logtape/logtape";

// Parse LOG_LEVEL from environment with proper filtering

let LOG_LEVEL = typeof process !== 'undefined' ? process?.env?.LOG_LEVEL : undefined;
let LOG_MODE = typeof process !== 'undefined' ? process?.env?.LOG_MODE : undefined;
let LOG_CATEGORIES = typeof process !== 'undefined' ? process?.env?.LOG_CATEGORIES?.split(",").map(c => c.trim()).filter(c => c !== "") : undefined as string[] | undefined;

if (!LOG_LEVEL) {
  console.warn("LOG_LEVEL is required");
  LOG_LEVEL = "info";
}
if (!LOG_MODE) {
  console.warn("LOG_MODE is required");
  LOG_MODE = "include";
}
if (!["include", "exclude"].includes(LOG_MODE)) {
  console.warn("LOG_MODE must be either 'include' or 'exclude'");
}
if (!LOG_CATEGORIES) {
  console.warn("No LOG_CATEGORIES specified, all categories will be logged");
  LOG_CATEGORIES = [] as string[];
}

// Custom filter for category-based filtering
function categoryFilter(record: LogRecord): boolean {
  const categoryStr = record.category.join(".");
  
  if (!LOG_CATEGORIES || LOG_CATEGORIES.length === 0) {
    return true; // No filtering if no categories specified
  }
  
  if (LOG_MODE === "include") {
    const result = LOG_CATEGORIES.some(cat => categoryStr.startsWith(cat));
    return result;
  } else {
    const result = !LOG_CATEGORIES.some(cat => categoryStr.startsWith(cat));
    return result;
  }
}

const CATEGORIES = [
  "server",
  "agent",
  'agents',
  'push',
  "auth",
  'user',
  "github",
  "fly",
  "db",
  "api",
  "version",
  "permissions",
  "types",
  "sync",
  "limits",
  "machinePool",
  "snapshot",
  "service",
  "ws",
  "websocket"
];

// Configure LogTape
export async function configureLogging() {
  await configure({
    sinks: {
      console: getConsoleSink({
        formatter: (record: LogRecord) => {
          const timestamp = new Date(record.timestamp).toISOString();
          const category = record.category.join(".");
          const level = record.level.toUpperCase().padEnd(5);
          const message = record.message.map((part: any) => 
            typeof part === "string" ? part : JSON.stringify(part)
          ).join("");
          
          // Return array for console methods
          return [`[${timestamp}] [${category}] ${level} ${message}`];
        }
      }),
    },
    filters: {
      categoryFilter,
    },
    loggers: CATEGORIES.map(category => ({
      category: [category],
      lowestLevel: LOG_LEVEL as "trace" | "debug" | "info" | "warning" | "error" | "fatal" | null | undefined,
      sinks: ["console"],
      filters: ["categoryFilter"]
    })),
  });
}

// Re-export getLogger for convenience
export function getLogger(category: string[]) {
  return getLogTapeLogger(category);
}