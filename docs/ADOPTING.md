# Adopting research-vault in a code project

The steps, in order, to make a repo cite its research from code, fail CI when a citation goes stale, and draw the result. Every command below is run from the repo root as `node <plugin>/bin/research-vault.mjs` followed by the command; in Claude Code the plugin is installed per the README and the same commands are slash commands.

## 1. Put a vault inside the repo

```text
research-vault init --vault research
research-vault init --project --vault research --code-links 'src/**/*.ts,src/**/*.js'
```

The first command scaffolds `research/` (entries, `taxonomy.json`, a generated `AGENTS.md`, a `.gitignore` for the derived caches). The second writes `.research-vault.json` at the repo root, binding the repo to that vault and naming which files are code. Commit both. Code links need the vault inside the repo; a shared vault elsewhere can still be cited from prose, not from code.

The plugin ships comment and declaration patterns for Lua, the JavaScript and TypeScript family, Python, Go, Rust, Zig, Ruby, shell and C/C++. Another language, or a stricter rule, is two regexes under `code.languages` in that file; see the Reference, "Code links".

## 2. Say where the dependency version lives

Add a `versions` key for each dependency your code is checked against. The pattern's first capture group, matched against the whole file, is the declared version:

```json
"versions": {
  "sdk": { "file": "package-lock.json", "pattern": "\"node_modules/sdk\": \\{\\s*\"version\": \"([^\"]+)\"" }
}
```

A `go.mod` require line, a `build.zig.zon` minimum version, or an addon `.toc` `## Interface:` line all work the same way. Skip this step if nothing in the code depends on a versioned API.

## 3. Capture the research, then cite it above the code

Capture a source, note or snippet the usual way (`capture`, or in Claude Code "capture this page"). Then put its id on a comment line of its own directly above the column-0 declaration that rests on it, with a pin when the call is to a versioned dependency:

```ts
// Retry budget and backoff per 2026-03-03-sdk-retry-semantics@sdk=0.20
export async function withRetry(fn) {
```

Only blank and comment lines may sit between the comment and the declaration. One link per declaration the entry justifies; an indented method is not seen, so cite the enclosing column-0 declaration.

## 4. Check it

```text
research-vault check            # prints every link that is not ok
research-vault check --check    # exits 1 on stale, uncovered or unattached
research-vault check --json     # the rows, for tools
```

`uncovered` means the id names no entry; `stale` means the pinned version no longer matches the file in step 2, or the entry's freshness window lapsed; `unattached` means the comment reached no declaration.

## 5. Fail CI on it

```yaml
research-vault:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22 }
    - run: git clone --depth 1 https://github.com/andrew-brooks-GA/research-vault.git /tmp/research-vault
    - run: node /tmp/research-vault/bin/research-vault.mjs lint --vault research
    - run: node /tmp/research-vault/bin/research-vault.mjs lint --vault research --check
    - run: node /tmp/research-vault/bin/research-vault.mjs check --check
```

The first `lint` builds the manifest the `--check` run compares against.

## 6. Gate the claims, when you want review

A linked symbol can be gated like a document: `gate evidence <file> --changed` lists the changed symbols and their evidence, a fresh `claims-reviewer` agent judges whether the code follows the entries it cites, and `gate record <file> PASS|MERIT "<note>"` stores the verdict keyed to that symbol's text. A later edit to the function reopens only that symbol. The `research-claims-gate` skill runs the whole loop in Claude Code.

## 7. Look at it

```text
research-vault obsidian --vault research
```

writes `research/_obsidian/`, a derived, git-ignored view: one note per entry, one per linked code file, wikilinks for every edge, and a seeded graph configuration (MOC hidden, colours by type, stale in red). Open that folder, not `research/`, as an Obsidian vault and press Ctrl+G.

## 8. Feed your own graph

If the project already has a graph of its code, keep it and add the research as leaf nodes. Two outputs carry everything, both plain JSON: `research/.vault-manifest.json` after `lint`, and `check --json`. The keys are the integration contract in the Reference, "Reading the graph from outside", and `examples/graph-dot.mjs` is the join written out:

```text
node /path/to/research-vault/examples/graph-dot.mjs . > graph.dot
dot -Tsvg graph.dot > graph.svg
```

Rebuild the research outputs whenever the code graph is rebuilt; neither is stored, so they are exactly as fresh as the last run.
