# Tool Schema Study

Same tools, different schemas: which design choices actually make models call tools correctly?

The ten tools from [Aussie Data MCP](https://github.com/dylannnnn111/aussie-data-mcp) (ABS, RBA and Sydney Opal data), written five ways. Each variant changes one thing from the schemas as published:

| Variant | What changes |
|---|---|
| `baseline` | Nothing - full descriptions, enums, flat arguments, helpful errors |
| `terse-descriptions` | One-line tool descriptions, no parameter descriptions |
| `no-enums` | Enums removed from the schema (the server still only accepts the same values) |
| `nested` | Arguments grouped into `select` / `period` / `options` objects |
| `terse-errors` | Error messages say only that the call failed, not why |

The server behind every variant is identical: same validation, same normalising (`"Sydney"` and `"sydney"` both work everywhere), same data. Only what the model sees changes.

40 questions, harder than the MCP's own eval: 14 vague ("Petrol's killing me, how much more am I paying?"), 10 out of scope (Melbourne's Friday gap, Bitcoin, the ASX 200) where the right answer says the data isn't there, and 16 that need two tools or two series combined. Three Claude models, two runs each: 1,200 runs.

Each run is scored on:
- **tools** - called every tool the question needs
- **arguments** - a successful call had the right arguments (e.g. `rents` + `sydney`)
- **answer** - the final answer has the right figures, or declines when it should
- **recovery** - after a rejected or failed call, a later call to that tool worked
- plus rejected calls, tool calls and cost per question

## Fixtures

Every tool call is turned into a canonical call and answered from `fixtures/` if it's been made before, otherwise fetched live and saved. So every variant, model and run sees the same data, the right answers are worked out from that same data, and the whole study can be re-scored or rerun later without hitting the ABS or RBA. `FROZEN=1` forbids live fetches.

## Running it

Node 22.6+, no dependencies. The API key is read from the macOS Keychain (`aussie-data-mcp-anthropic`), never from a file.

```
npm test                    # 16 tests, no key needed
npm run references          # work out every right answer from live data, saved to fixtures/; check runs/references.md
npm run smoke:keychain      # 4 questions x 2 variants x 3 models - checks it all works and measures cost per question
DRY=1 npm run eval          # cells to run and estimated cost
npm run eval:keychain       # the full run (resumable - rerun after an interruption)
npm run analyse             # runs/main/results.md, results.json, hand.md
```

Options: `VARIANTS=`, `MODELS=` (family names or full ids, pinned in the run's manifest on first use), `RUNS=`, `NAME=`, `CONCURRENCY=`, `DATE=`. Questions can be picked by id: `npm run eval -- v02 m14`.

Answers to hand-flagged and out-of-scope questions are collected in `hand.md` and read by hand.

## Layout

```
src/tools.ts       the ten tools in one neutral form (params, groups, enums, published descriptions)
src/variants.ts    schema generation per variant + turning any variant's arguments into a canonical call
src/server.ts      validation + fixture record/replay
src/agent.ts       the question loop (plain fetch to the Messages API, see src/llm.ts)
src/questions.ts   the 40 questions and how each is checked
src/score.ts       scoring one run
src/stats.ts       bootstrap intervals and a sign test, written out
src/data/          copies of Aussie Data MCP's data fetchers
```

MIT licence. Data: ABS (CC BY 4.0), RBA, TfNSW Opal Tap Data via Commute Pulse (CC BY 4.0).
