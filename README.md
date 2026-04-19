# Moth RE

Moth RE is a small Hopper-inspired reverse engineering workbench with two entry points:

- an Electron drag-and-drop app for browsing disassembly, strings, symbols, Objective-C metadata, and heuristic pseudocode
- a `moth` CLI designed for Codex-driven binary exploration

It is intentionally local-first. The first backend uses tools that ship on macOS: `file`, `lipo`, `otool`, `nm`, `objdump`, and `strings`. If `radare2`, Ghidra, or another decompiler is added later, `lib/tooling.mjs` is the place to wire it in.

## Install

```sh
npm install
npm link
```

## Run The App

```sh
npm start
```

Drag a binary into the window. The app creates an analysis database in `.moth/analyses/<binary-hash>/`.

## CLI

Analyze a binary:

```sh
moth analyze /path/to/binary
```

Analyze to a specific directory:

```sh
moth analyze /path/to/binary --out ./analysis
```

Search strings, symbols, Objective-C metadata, and assembly:

```sh
moth search login --db ./analysis
moth search NSWindow --kind objc --db ./analysis
```

List functions:

```sh
moth functions --db ./analysis
```

Show a function with assembly and heuristic pseudocode:

```sh
moth show _main --db ./analysis
```

Ask a feature question. This is retrieval over the analysis database, not magic AI decompilation:

```sh
moth ask "how does update checking work?" --db ./analysis
```

## Codex Skill

The reusable skill lives in `skills/moth-cli/SKILL.md`. To install it for the local Codex harness:

```sh
mkdir -p ~/.codex/skills/moth-cli
cp skills/moth-cli/SKILL.md ~/.codex/skills/moth-cli/SKILL.md
```

After installing, ask Codex to use the `moth-cli` skill when investigating a binary.

## Notes

Moth RE does not claim parity with Hopper, Ghidra, Binary Ninja, or IDA. The current pseudocode is deliberately labeled heuristic: it summarizes stack setup, calls, branches, embedded strings, and Objective-C selectors/classes where the native tools expose them. That is still useful for answering questions like “where is licensing handled?” or “what classes mention downloads?” because Codex can search and inspect the generated analysis.
