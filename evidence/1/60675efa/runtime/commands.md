# Reproduce the scoped runtime diagnostic

Requirements: Linux, Python 3 standard library, an already installed Bun 1.3.14, and the existing complete standalone build. Do not install anything implicitly. The recorded run used the server-bundle hash in manifest.json. A different bundle is a new run, not evidence for that recorded hash.

Run from the worktree root. The following commands only prepare a new private output directory and execute the diagnostic; they do not build, install, edit application code, publish or invoke a model provider:

```sh
bun --version
sha256sum build/server/index.js
raw_output="$(mktemp -d)"
BUN_BINARY="$(command -v bun)" \
TOONFLOW_PROBE_ROOT="$PWD" \
TOONFLOW_EVIDENCE_DIR="$raw_output" \
python3 evidence/1/60675efa/runtime/probeRuntime.py
```

The exact recorded execution used the same probe logic with fixed private paths. See manifest.json for the two child argv arrays and their explicit minimal environment. The child command is equivalent to:

```text
<BUN> --preload <HARNESS>/loopbackPreload.ts <REPO>/build/server/index.js
```

The probe first verifies port 3000 is unused. It creates fresh synthetic data/home/workspace directories, starts the exact existing bundle with the binding/outbound guard, issues the 28 requests, checks 62 predicates, terminates the first child, repeats startup and persistence checks, and terminates its final child in a finally block. It records every child exit. The main listener is fixed to loopback port 3000; MCP uses its existing loopback port-selection logic beginning at 10588. On normal completion, both listeners are gone. The probe retains synthetic fixtures and raw evidence for review, not for automatic publication.

The safety preload was separately tested before the recorded application launch: a synthetic unspecified-host listener bound to 127.0.0.1, and a non-loopback fetch was rejected before reaching the original fetch. Its SHA-256 in manifest.json identifies the tested guard.

Raw outputs can contain bundled metadata/source references and machine paths. Review and sanitize them before publishing; do not copy the generated raw folder into a public repository. The sanitized committed records preserve original byte hashes even where displayed text uses placeholders. A portable probe rerun is not expected to reproduce timestamp, temporary path or PID-dependent response hashes exactly.
