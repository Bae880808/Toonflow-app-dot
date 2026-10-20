# Built HTTP acceptance integration

The candidate adds one adapter self-check and one real built-server lifecycle test, fixed count 2. Linux Bun 1.3.14: both passed, 143 assertions. The exact generated bundle hash is recorded in verification.log. tests/tsconfig includes the new test and guard under existing strict options; typecheck passed. The 20 existing behavior tests and 33 infrastructure checks remain separate counts. Windows final-candidate execution is still required.

No business behavior is mocked. The child uses an environment allowlist, --no-env-file, temporary HOME/data, loopback listener adaptation, common outbound API guards and redirect rejection. This adapter is not an OS firewall or proof of unmodified startup. The test covers real assets, plugin initialization/metadata, file read/write/revision/exclusive conflicts, malformed inputs, outside-workspace and junction rejection, restart persistence, user material preservation, cleanup and port release. UI and merge gates remain blocked.

Bootstrap existing-behavior protection applies; no fabricated product failure. The command is bun test ./tests/builtServer.test.ts after bun run build:server. Complete public test source defines the actual requests and assertions.

Browser attempt at candidate c3f1b7e: the exact built service started in its isolated execution session, but the separate cloud browser could not reach its loopback endpoint (ERR_CONNECTION_REFUSED). The page never loaded, so no browser steps or screenshots are claimed. The server was stopped. No listener expansion, public deployment or permission changes were made. A separate Windows CI browser test may be proposed using existing dependencies; this record does not claim it exists or passed.
