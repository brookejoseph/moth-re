import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { availableTools, runTool } from "./tooling.mjs";

const DEFAULT_ROOT = ".moth/analyses";

export function resolveDefaultOut(binaryPath) {
  const absolute = path.resolve(binaryPath);
  const digest = hashFile(absolute).slice(0, 12);
  const name = path.basename(absolute).replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.resolve(DEFAULT_ROOT, `${name}-${digest}`);
}

export function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

export function analyzeBinary(binaryPath, options = {}) {
  const absolute = path.resolve(binaryPath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Binary not found: ${absolute}`);
  }

  const outDir = path.resolve(options.outDir ?? resolveDefaultOut(absolute));
  fs.mkdirSync(outDir, { recursive: true });

  const tools = availableTools();
  const fileInfo = tools.file ? runTool("file", [absolute]).stdout.trim() : "";
  const archInfo = tools.lipo ? runTool("lipo", ["-info", absolute]).stdout.trim() : "";
  const loadCommands = tools.otool ? runTool("otool", ["-l", absolute]).stdout : "";
  const linkedLibraries = tools.otool ? runTool("otool", ["-L", absolute]).stdout : "";
  const symbolsRaw = tools.nm ? runTool("nm", ["-m", absolute]).stdout : "";
  const stringsRaw = tools.strings ? runTool("strings", ["-a", "-n", "4", absolute]).stdout : "";
  const objcRaw = tools.otool ? runTool("otool", ["-ov", absolute]).stdout : "";
  const assemblyRaw = disassemble(absolute, tools);

  const symbols = parseSymbols(symbolsRaw);
  const strings = parseStrings(stringsRaw);
  const objc = parseObjc(objcRaw);
  const functions = parseFunctions(assemblyRaw, symbols, strings, objc);
  const pseudocode = buildPseudocode(functions);

  const index = {
    schema: 1,
    binary: absolute,
    outDir,
    sha256: hashFile(absolute),
    generatedAt: new Date().toISOString(),
    tools,
    fileInfo,
    archInfo,
    counts: {
      functions: functions.length,
      symbols: symbols.length,
      strings: strings.length,
      objcClasses: objc.classes.length,
      objcMethods: objc.methods.length,
      objcSelectors: objc.selectors.length
    },
    artifacts: {
      assembly: "assembly.txt",
      functions: "functions.json",
      symbols: "symbols.json",
      strings: "strings.json",
      objc: "objc.json",
      pseudocode: "pseudocode.md",
      loadCommands: "load-commands.txt",
      linkedLibraries: "linked-libraries.txt"
    }
  };

  writeJson(path.join(outDir, "index.json"), index);
  writeJson(path.join(outDir, "functions.json"), functions);
  writeJson(path.join(outDir, "symbols.json"), symbols);
  writeJson(path.join(outDir, "strings.json"), strings);
  writeJson(path.join(outDir, "objc.json"), objc);
  fs.writeFileSync(path.join(outDir, "assembly.txt"), assemblyRaw);
  fs.writeFileSync(path.join(outDir, "pseudocode.md"), pseudocode);
  fs.writeFileSync(path.join(outDir, "load-commands.txt"), loadCommands);
  fs.writeFileSync(path.join(outDir, "linked-libraries.txt"), linkedLibraries);

  return { index, functions, symbols, strings, objc, pseudocode };
}

function disassemble(binaryPath, tools) {
  if (tools.objdump) {
    const result = runTool("objdump", ["-d", binaryPath]);
    if (result.ok && result.stdout.trim()) return result.stdout;
  }

  if (tools.otool) {
    const intel = runTool("otool", ["-tvV", binaryPath]);
    if (intel.ok && intel.stdout.trim()) return intel.stdout;
  }

  return "";
}

function parseSymbols(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const defined = trimmed.match(/^([0-9a-fA-F]+)\s+\(([^)]+)\)\s+(?:\[[^\]]+\]\s+)*(?:(?:private\s+)?external|non-external)\s+(.+?)(?:\s+\(from .+\))?$/);
      if (defined) {
        return {
          address: `0x${defined[1]}`,
          section: defined[2],
          name: cleanupSymbolName(defined[3]),
          raw: trimmed
        };
      }

      const undefined = trimmed.match(/^\(([^)]+)\)\s+(?:(?:private\s+)?external|non-external)\s+(.+?)(?:\s+\(from .+\))?$/);
      if (undefined) {
        return {
          address: null,
          section: undefined[1],
          name: cleanupSymbolName(undefined[2]),
          raw: trimmed
        };
      }

      return {
        address: null,
        section: null,
        name: trimmed,
        raw: trimmed
      };
    })
    .filter(Boolean);
}

function cleanupSymbolName(name) {
  return name
    .replace(/^external\s+/i, "")
    .replace(/^non-external\s+/i, "")
    .replace(/^private external\s+/i, "")
    .trim();
}

function parseStrings(raw) {
  return raw
    .split(/\r?\n/)
    .map((value, index) => ({ id: index + 1, value: value.trim() }))
    .filter((entry) => entry.value.length > 0);
}

function parseObjc(raw) {
  const classes = new Set();
  const methods = new Set();
  const selectors = new Set();
  const protocols = new Set();

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    const classMatch = trimmed.match(/(?:class|metaclass)\s+([A-Za-z_][A-Za-z0-9_$]+)/i);
    if (classMatch) classes.add(classMatch[1]);

    const methodMatch = trimmed.match(/[-+]\[[^\]]+\]/);
    if (methodMatch) {
      methods.add(methodMatch[0]);
      const selector = methodMatch[0].replace(/^[-+]\[[^ ]+\s+/, "").replace(/\]$/, "");
      if (selector) selectors.add(selector);
    }

    const nameMatch = trimmed.match(/name\s+0x[0-9a-fA-F]+\s+(.+)$/);
    if (nameMatch) {
      const value = nameMatch[1].trim();
      if (/^[A-Za-z_][A-Za-z0-9_$]+$/.test(value)) classes.add(value);
      if (value.includes(":")) selectors.add(value);
    }

    const protocolMatch = trimmed.match(/protocol\s+([A-Za-z_][A-Za-z0-9_$]+)/i);
    if (protocolMatch) protocols.add(protocolMatch[1]);
  }

  return {
    classes: [...classes].sort(),
    methods: [...methods].sort(),
    selectors: [...selectors].sort(),
    protocols: [...protocols].sort()
  };
}

function parseFunctions(assemblyRaw, symbols, strings, objc) {
  const functions = [];
  let current = null;
  const symbolByAddress = new Map(
    symbols
      .filter((symbol) => symbol.address && symbol.section === "__TEXT,__text")
      .map((symbol) => [symbol.address.toLowerCase(), symbol.name])
  );

  for (const line of assemblyRaw.split(/\r?\n/)) {
    const header = line.match(/^([0-9a-fA-F]+)\s+<([^>]+)>:/) ?? line.match(/^([A-Za-z_.$][^:<>]+):$/);
    if (header) {
      if (current) functions.push(finishFunction(current, strings, objc));
      current = {
        name: header[2] ?? header[1].trim(),
        address: header[2] ? `0x${header[1]}` : null,
        assembly: []
      };
      continue;
    }

    if (current) current.assembly.push(line);
  }

  if (current) functions.push(finishFunction(current, strings, objc));

  if (functions.length <= 2) {
    const stripped = parseStrippedAssembly(assemblyRaw, symbolByAddress, strings, objc);
    if (stripped.length > functions.length) return stripped;
  }

  if (functions.length === 0) {
    return symbols
      .filter((symbol) => symbol.address && symbol.name)
      .slice(0, 5000)
      .map((symbol) => finishFunction({
        name: symbol.name,
        address: symbol.address,
        assembly: []
      }, strings, objc));
  }

  return functions;
}

function parseStrippedAssembly(assemblyRaw, symbolByAddress, strings, objc) {
  const functions = [];
  let current = null;

  for (const line of assemblyRaw.split(/\r?\n/)) {
    const instruction = parseInstructionLine(line);
    if (!instruction) continue;

    const startsFunction = isLikelyFunctionStart(instruction.text);
    if ((startsFunction && current?.assembly.length > 0) || !current) {
      if (current) functions.push(finishFunction(current, strings, objc));
      const address = `0x${instruction.address}`;
      current = {
        name: symbolByAddress.get(address.toLowerCase()) ?? `sub_${instruction.address}`,
        address,
        assembly: []
      };
    }

    current.assembly.push(line);
  }

  if (current) functions.push(finishFunction(current, strings, objc));
  return functions;
}

function parseInstructionLine(line) {
  const match = line.match(/^\s*([0-9a-fA-F]{6,16}):\s+(?:[0-9a-fA-F]{2}\s+)*(.+)$/);
  if (!match) return null;
  return {
    address: match[1],
    text: match[2].trim()
  };
}

function isLikelyFunctionStart(instruction) {
  return (
    /^pushq\s+%rbp\b/i.test(instruction) ||
    /^endbr64\b/i.test(instruction) ||
    /^stp\s+x29,\s*x30,\s*\[sp,/i.test(instruction) ||
    /^pacibsp\b/i.test(instruction)
  );
}

function finishFunction(fn, strings, objc) {
  const text = fn.assembly.join("\n");
  const calls = extractCalls(fn.assembly).slice(0, 80);
  const branches = fn.assembly.filter((line) => /\b(j[a-z]+|b\.[a-z]+|cbz|cbnz|tbz|tbnz)\b/i.test(line)).length;
  const localStrings = strings
    .filter((entry) => entry.value.length >= 5 && text.includes(entry.value))
    .slice(0, 20);
  const objcRefs = {
    classes: objc.classes.filter((value) => text.includes(value)).slice(0, 30),
    selectors: objc.selectors.filter((value) => text.includes(value)).slice(0, 30),
    methods: objc.methods.filter((value) => text.includes(value)).slice(0, 30)
  };

  return {
    name: fn.name,
    address: fn.address,
    sizeLines: fn.assembly.length,
    calls,
    branches,
    strings: localStrings,
    objc: objcRefs,
    assembly: fn.assembly
  };
}

function extractCalls(assemblyLines) {
  const calls = [];
  for (const line of assemblyLines) {
    const stub = line.match(/symbol stub for:\s+([A-Za-z0-9_.$]+)/);
    const instruction = parseInstructionLine(line);
    if (!instruction) continue;

    const call = instruction.text.match(/^(?:callq?|bl|blr|jmpq?)\s+([^#;\n]+)/i);
    if (call) calls.push(call[1].trim());
    if (stub) calls.push(stub[1].trim());
  }

  return [...new Set(calls)];
}

export function buildPseudocode(functions) {
  const chunks = ["# Heuristic Pseudocode", ""];
  for (const fn of functions) {
    chunks.push(`## ${fn.name}`);
    if (fn.address) chunks.push(`address: ${fn.address}`);
    chunks.push("```c");
    chunks.push(`function ${sanitizeName(fn.name)}() {`);
    if (fn.branches > 0) chunks.push(`  // control flow: ${fn.branches} branch instruction(s)`);
    for (const string of fn.strings.slice(0, 8)) {
      chunks.push(`  // string: ${JSON.stringify(string.value)}`);
    }
    for (const className of fn.objc.classes.slice(0, 8)) {
      chunks.push(`  // objc class reference: ${className}`);
    }
    for (const selector of fn.objc.selectors.slice(0, 8)) {
      chunks.push(`  objc_msgSend(..., ${JSON.stringify(selector)}, ...);`);
    }
    for (const call of fn.calls.slice(0, 16)) {
      chunks.push(`  call ${call};`);
    }
    if (fn.calls.length === 0 && fn.strings.length === 0 && fn.objc.classes.length === 0) {
      chunks.push("  // inspect assembly for register and memory operations");
    }
    chunks.push("}");
    chunks.push("```");
    chunks.push("");
  }
  return chunks.join("\n");
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9_$:.[\]-]/g, "_");
}

export function loadAnalysis(dbPath) {
  const outDir = path.resolve(dbPath);
  const index = readJson(path.join(outDir, "index.json"));
  return {
    index,
    outDir,
    functions: readJson(path.join(outDir, index.artifacts.functions)),
    symbols: readJson(path.join(outDir, index.artifacts.symbols)),
    strings: readJson(path.join(outDir, index.artifacts.strings)),
    objc: readJson(path.join(outDir, index.artifacts.objc)),
    assembly: fs.readFileSync(path.join(outDir, index.artifacts.assembly), "utf8"),
    pseudocode: fs.readFileSync(path.join(outDir, index.artifacts.pseudocode), "utf8")
  };
}

export function searchAnalysis(dbPath, query, options = {}) {
  const db = loadAnalysis(dbPath);
  const terms = tokenize(query);
  const kind = options.kind ?? "all";
  const results = [];

  if (kind === "all" || kind === "strings") {
    for (const entry of db.strings) {
      const score = scoreText(entry.value, terms);
      if (score > 0) results.push({ kind: "string", score, value: entry.value });
    }
  }

  if (kind === "all" || kind === "symbols") {
    for (const entry of db.symbols) {
      const text = `${entry.name ?? ""} ${entry.raw ?? ""}`;
      const score = scoreText(text, terms);
      if (score > 0) results.push({ kind: "symbol", score, name: entry.name, address: entry.address, raw: entry.raw });
    }
  }

  if (kind === "all" || kind === "objc") {
    for (const bucket of ["classes", "methods", "selectors", "protocols"]) {
      for (const value of db.objc[bucket] ?? []) {
        const score = scoreText(value, terms);
        if (score > 0) results.push({ kind: `objc.${bucket}`, score, value });
      }
    }
  }

  if (kind === "all" || kind === "functions" || kind === "asm") {
    for (const fn of db.functions) {
      const text = [
        fn.name,
        ...fn.calls,
        ...fn.strings.map((entry) => entry.value),
        ...fn.objc.classes,
        ...fn.objc.selectors,
        fn.assembly.join("\n")
      ].join("\n");
      const score = scoreText(text, terms);
      if (score > 0) {
        results.push({
          kind: "function",
          score,
          name: fn.name,
          address: fn.address,
          sizeLines: fn.sizeLines,
          calls: fn.calls.slice(0, 8),
          strings: fn.strings.slice(0, 8),
          objc: fn.objc
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 50);
}

export function showFunction(dbPath, needle) {
  const db = loadAnalysis(dbPath);
  const normalized = needle.toLowerCase();
  const fn = db.functions.find((item) => (
    item.name.toLowerCase() === normalized ||
    item.name.toLowerCase().includes(normalized) ||
    item.address?.toLowerCase() === normalized
  ));

  if (!fn) return null;
  return {
    ...fn,
    pseudocode: buildPseudocode([fn])
  };
}

export function answerQuestion(dbPath, question) {
  const db = loadAnalysis(dbPath);
  const terms = tokenize(question).filter((term) => !STOP_WORDS.has(term));
  const hits = searchAnalysis(dbPath, terms.join(" "), { kind: "all", limit: 25 });
  const functionHits = hits.filter((hit) => hit.kind === "function").slice(0, 8);
  const evidence = hits.slice(0, 12);

  const lines = [];
  lines.push(`Question: ${question}`);
  lines.push("");
  lines.push("Likely places to inspect:");
  if (functionHits.length === 0) {
    lines.push("- No direct function match. Start with string and symbol evidence below.");
  } else {
    for (const hit of functionHits) {
      lines.push(`- ${hit.name}${hit.address ? ` (${hit.address})` : ""}: score ${hit.score}`);
    }
  }
  lines.push("");
  lines.push("Evidence:");
  for (const hit of evidence) {
    if (hit.kind === "function") {
      const strings = hit.strings?.map((entry) => JSON.stringify(entry.value)).join(", ");
      lines.push(`- function ${hit.name}: calls ${hit.calls?.join(", ") || "none"}${strings ? `; strings ${strings}` : ""}`);
    } else {
      lines.push(`- ${hit.kind}: ${hit.value ?? hit.name ?? hit.raw}`);
    }
  }
  lines.push("");
  lines.push("Next step: run `moth show <function> --db <analysis>` on the strongest function names above and inspect branch/call behavior.");

  return { terms, hits, answer: lines.join("\n") };
}

function tokenize(query) {
  return query.toLowerCase().split(/[^a-z0-9_:+.-]+/).filter(Boolean);
}

const STOP_WORDS = new Set(["a", "an", "and", "are", "does", "for", "how", "is", "it", "of", "the", "to", "what", "where", "works"]);

function scoreText(text, terms) {
  const haystack = String(text ?? "").toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length;
  }
  return score;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
