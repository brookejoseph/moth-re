# moth-cli

Use this skill when the user asks Codex to reverse engineer, inspect, search, explain, or summarize a compiled binary using the local Moth RE CLI.

## What Moth Does

`moth` creates a local analysis database from a binary. It extracts:

- binary identity and architecture metadata
- disassembly
- symbols
- strings
- Objective-C classes, methods, selectors, and protocols when available
- heuristic pseudocode for functions

The pseudocode is not a full decompiler. Treat it as a navigational summary over assembly, calls, strings, branches, and Objective-C metadata.

## Expected CLI

Prefer the project-local executable when available:

```sh
node /Users/brookejoseph/Documents/New\ project/moth-re/bin/moth.mjs <command>
```

If the package has been linked globally, this is also valid:

```sh
moth <command>
```

## Workflow

1. Analyze the binary first:

```sh
node /Users/brookejoseph/Documents/New\ project/moth-re/bin/moth.mjs analyze /path/to/binary --out /tmp/moth-analysis
```

2. Search broadly for feature words, class names, selectors, UI labels, file paths, URLs, entitlement strings, and framework names:

```sh
node /Users/brookejoseph/Documents/New\ project/moth-re/bin/moth.mjs search login --db /tmp/moth-analysis
node /Users/brookejoseph/Documents/New\ project/moth-re/bin/moth.mjs search NSUserDefaults --kind objc --db /tmp/moth-analysis
node /Users/brookejoseph/Documents/New\ project/moth-re/bin/moth.mjs search "trial" --kind strings --db /tmp/moth-analysis
```

3. List candidate functions:

```sh
node /Users/brookejoseph/Documents/New\ project/moth-re/bin/moth.mjs functions --db /tmp/moth-analysis --limit 200
```

4. Inspect promising functions:

```sh
node /Users/brookejoseph/Documents/New\ project/moth-re/bin/moth.mjs show _main --db /tmp/moth-analysis
```

5. For feature questions, use `ask` as a retrieval starting point, then verify by inspecting the named functions:

```sh
node /Users/brookejoseph/Documents/New\ project/moth-re/bin/moth.mjs ask "how does update checking work?" --db /tmp/moth-analysis
```

## Answering The User

When explaining a binary feature:

- Name the functions, classes, selectors, strings, or imports that led to the conclusion.
- Distinguish direct evidence from inference.
- Quote only short assembly snippets when needed.
- Say when the current backend cannot prove something because full decompilation or cross-reference recovery is missing.
- Suggest the next search terms when the evidence is weak.

## Useful Search Seeds

For macOS and iOS Objective-C binaries, try:

- selectors: `init`, `viewDidLoad`, `applicationDidFinishLaunching`, `URLSession`, `openURL`, `setObject:forKey:`
- storage: `NSUserDefaults`, `Keychain`, `SQLite`, `.plist`, `Application Support`
- network: `http`, `https`, `NSURL`, `URLSession`, `CFNetwork`
- licensing: `trial`, `license`, `receipt`, `subscription`, `purchase`, `StoreKit`
- crypto: `SecKey`, `CommonCrypto`, `CryptoKit`, `encrypt`, `decrypt`, `hash`
- anti-debug: `ptrace`, `sysctl`, `getppid`, `task_for_pid`, `debug`
