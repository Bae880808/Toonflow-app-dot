# Candidate 60675efa evidence

Candidate: 60675efa5e0ec8225dff20c34018703fc6ac9daf. Tree: 5e17f23a09f48bdb1d15a5826ee0d7f753eef700.

Windows x64 / Bun 1.3.14: 37 core workspace typechecks plus providers and test types passed; all 17 behavior tests passed (6 provider fixtures, 6 real filesystem, 5 plugin initialization). Full build:server and expected artifact checks passed. Node infrastructure tests: 29 passed, not counted as business tests.

Full gate exit 2: not verified. Build changed the candidate worktree, but this version suppressed path details. Additional diagnostics are required. Symlink, HTTP boundary, timeout, built-server/browser persistence coverage and human impact review remain incomplete in this candidate. No automatic merge.

Linux independent diagnostics: the same tree was tested locally at commit 9875a39c46bd7e2ff1654476d463b5e42dd3a12b before publishing the equivalent candidate. All 17 behavior tests and build:server passed. These are not the formal Windows gate or UI/runtime verification. Isolated temporary data was used; provider transports were fixtures, not real generation.

Bootstrap exception: existing behavior protection may pass on the original implementation. These results do not claim a repaired product bug or a fabricated old-code failure.

Linux commands: Bun 1.3.14 test from tests/ for each listed file; then bun run build:server from repository root with NODE_ENV=production and dedicated temporary TOONFLOW_DATA_DIR. Complete outputs: linuxBehavior.json and linuxBuild.log.

Windows full commands/results: https://github.com/Bae880808/Toonflow-app-dot/actions/runs/39415868784/job/118604602381

Published build output removes trailing whitespace only; no diagnostic lines are omitted.
