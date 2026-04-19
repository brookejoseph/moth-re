#!/usr/bin/env node
import {
  analyzeBinary,
  answerQuestion,
  loadAnalysis,
  searchAnalysis,
  showFunction
} from "../lib/analysis.mjs";

const args = process.argv.slice(2);
const command = args.shift();

try {
  switch (command) {
    case "analyze":
      await analyzeCommand(args);
      break;
    case "search":
      await searchCommand(args);
      break;
    case "functions":
      await functionsCommand(args);
      break;
    case "show":
      await showCommand(args);
      break;
    case "ask":
      await askCommand(args);
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(`moth: ${error.message}`);
  process.exitCode = 1;
}

async function analyzeCommand(argv) {
  const options = parseOptions(argv);
  const binary = options.positionals[0];
  if (!binary) throw new Error("Usage: moth analyze <binary> [--out DIR] [--json]");

  const result = analyzeBinary(binary, { outDir: options.out });
  if (options.json) {
    console.log(JSON.stringify(result.index, null, 2));
    return;
  }

  console.log(`Analysis written to ${result.index.outDir}`);
  console.log(`Binary: ${result.index.binary}`);
  console.log(`SHA-256: ${result.index.sha256}`);
  console.log(`Functions: ${result.index.counts.functions}`);
  console.log(`Symbols: ${result.index.counts.symbols}`);
  console.log(`Strings: ${result.index.counts.strings}`);
  console.log(`Objective-C classes: ${result.index.counts.objcClasses}`);
  console.log(`Objective-C methods: ${result.index.counts.objcMethods}`);
}

async function searchCommand(argv) {
  const options = parseOptions(argv);
  const query = options.positionals.join(" ");
  const db = requiredDb(options);
  if (!query) throw new Error("Usage: moth search <query> --db DIR [--kind all|strings|symbols|objc|functions|asm] [--json]");

  const results = searchAnalysis(db, query, {
    kind: options.kind ?? "all",
    limit: Number(options.limit ?? 50)
  });

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const result of results) {
    console.log(formatSearchResult(result));
  }
}

async function functionsCommand(argv) {
  const options = parseOptions(argv);
  const db = requiredDb(options);
  const analysis = loadAnalysis(db);
  const rows = analysis.functions.slice(0, Number(options.limit ?? 500));

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  for (const fn of rows) {
    const address = fn.address ? `${fn.address} ` : "";
    console.log(`${address}${fn.name} (${fn.sizeLines} asm lines, ${fn.calls.length} calls)`);
  }
}

async function showCommand(argv) {
  const options = parseOptions(argv);
  const needle = options.positionals.join(" ");
  const db = requiredDb(options);
  if (!needle) throw new Error("Usage: moth show <function-or-address> --db DIR [--json]");

  const fn = showFunction(db, needle);
  if (!fn) throw new Error(`Function not found: ${needle}`);

  if (options.json) {
    console.log(JSON.stringify(fn, null, 2));
    return;
  }

  console.log(fn.pseudocode.trim());
  console.log("\nAssembly:");
  console.log(fn.assembly.join("\n"));
}

async function askCommand(argv) {
  const options = parseOptions(argv);
  const question = options.positionals.join(" ");
  const db = requiredDb(options);
  if (!question) throw new Error("Usage: moth ask <question> --db DIR [--json]");

  const answer = answerQuestion(db, question);
  if (options.json) {
    console.log(JSON.stringify(answer, null, 2));
    return;
  }
  console.log(answer.answer);
}

function parseOptions(argv) {
  const options = { positionals: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      options.positionals.push(arg);
      continue;
    }

    const key = arg.slice(2);
    if (key === "json") {
      options.json = true;
      continue;
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requiredDb(options) {
  if (!options.db) throw new Error("Missing --db DIR");
  return options.db;
}

function formatSearchResult(result) {
  if (result.kind === "function") {
    const address = result.address ? ` ${result.address}` : "";
    const strings = result.strings?.map((entry) => JSON.stringify(entry.value)).join(", ");
    return `[${result.kind}] score=${result.score}${address} ${result.name}${strings ? ` | strings: ${strings}` : ""}`;
  }
  return `[${result.kind}] score=${result.score} ${result.value ?? result.name ?? result.raw}`;
}

function printHelp() {
  console.log(`moth - local binary analysis for Codex and a small Electron UI

Usage:
  moth analyze <binary> [--out DIR] [--json]
  moth search <query> --db DIR [--kind all|strings|symbols|objc|functions|asm] [--limit N] [--json]
  moth functions --db DIR [--limit N] [--json]
  moth show <function-or-address> --db DIR [--json]
  moth ask <question> --db DIR [--json]
`);
}
