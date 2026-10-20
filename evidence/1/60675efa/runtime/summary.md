# Harnessed built-server API diagnostic

PASS within the scoped diagnostic: 62 recorded checks, 28 actual HTTP requests, two process starts. These are diagnostic assertions, not a formal test-suite count. No claim of CI, complete core acceptance, unmodified standalone startup, browser UI or platform acceptance is made.

## What actually ran

The generated server bundle ran under existing Bun 1.3.14 on Linux with a fresh temporary data directory, HOME, configuration/cache directories and an explicit minimal environment. The standalone entry hardcodes port 3000 and does not expose a host override. A temporary preload therefore forced HTTP listeners to 127.0.0.1 and rejected non-loopback outbound fetch, Node HTTP, TLS and socket operations. It did not alter authentication, path validation, persistence, plugin initialization or assertions. It is an in-process guard, not an OS firewall.

Both starts reported listeners at 127.0.0.1:3000 and 127.0.0.1:10588. No guarded outbound attempt appeared in either application log. Fresh provider API keys were empty. No provider request or paid service was used. The recorded build hash was unchanged afterward.

## Verified results

- Homepage, JavaScript and CSS returned 200 and matched the built bytes exactly.
- Fresh initialization copied 10 tools, 8 nodes, 5 extensions, 4 providers and 3 skill directories. Node/tool/extension metadata APIs returned every expected entry without load errors. This does not prove plugin execution.
- An API-created workspace accepted and reopened exact UTF-8 bytes, including Chinese text and emoji. Snapshot text, encoding and SHA-256 revision matched.
- Exclusive and stale-revision writes returned 409 and preserved the original bytes. A matching revision allowed an update and returned its new hash.
- Traversal, absolute paths and root mutation returned 400. Symlink escape and outside-workspace writes returned 403. Missing required fields returned 400. The outside canary and saved document remained intact.
- After process termination and restart, the 115-byte document, revision, full settings object, initialization markers, custom materials and a comment-only local modification to an installed tool bundle remained unchanged.
- Both child processes were terminated. Ports 3000 and 10588 were confirmed released.

## Evidence and reproduction

manifest.json pins the candidate, build/preload hashes, exact recorded commands, timestamps, minimal environment and cleanup. checks.json preserves all 62 numbered results and their predicates or linked HTTP records. httpRecords.json preserves the 28 methods, requests, statuses, body hashes/sizes, readable error responses and safe summaries of metadata. startup.json and persistence.json provide listener/restart evidence.

commands.md explains how to run the portable probe with an existing build and runtime. Only environment/path discovery was adjusted for portability after the recorded run. The safety preload is byte-identical to the one executed. The probe never installs dependencies or rebuilds the application.

Private absolute roots are replaced with documented placeholders. Bundled metadata with external references, raw minified response/source bodies and stack dumps are retained privately, not published. Original body/log hashes remain recorded. No error result or failed assertion was removed; all 62 checks passed. Readable negative-response bodies are preserved.

## Unverified boundaries

Browser rendering and node-edit/save/reopen interactions; screenshots and browser console; actual plugin/tool execution; changed-revision synchronization; interrupted startup or concurrent-write failure recovery; authenticated MCP operations; device pairing; provider/model/media generation; desktop/mobile installation; and Windows/macOS/Android behavior were not verified. The listener configuration limitation is an observed fact, not a claimed vulnerability or business-code fix.
