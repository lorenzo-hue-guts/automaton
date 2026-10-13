# Builder regression investigation after Lot 5R

This investigation preserves Lots 1–5R. It does not begin Lot 6R and does not
change production behavior, security, budgets, isolation, or execution limits.

## Original failure

`src/__tests__/product-factory/model-builder.test.ts > replans a repeated
architecture failure and persists the revision`

The assertion at line 139 expected
`fake.calls.some(c => c.phase === 'replan')` to be `true`, but received `false`.
The original broad run reported 1,890 passing tests and one failure; this test
took 74.43 seconds. All 25 Builder tests subsequently passed in isolation.
The original assertion did not print the persisted build/attempt state. Its
temporary database was removed by test cleanup, so the original internal cause
cannot be reconstructed from those logs alone.

## Audit and evidence

- Mutable test variables, model calls, failure counter, database, orchestrator,
  policy engine and worker pool are recreated in `beforeEach`.
- SQLite databases and artifact directories use a fresh `mkdtempSync` directory.
  Matching directory prefixes are not directory reuse.
- Every initialization creates a new `HarnessRegistry`. Its role map is an
  instance-owned `Map`; registering a Factory harness does not mutate the shared
  default role map.
- Application fixture architectures/files are constructed anew on model calls.
  Reference provider fixtures are read as data; no model-supplied instruction
  bypasses tool policy in this path.
- The Builder file does not mutate `process.env`, stub globals, or install module
  mocks. Its system clock change is reset in `afterEach`. The workspace test's
  `os.homedir` spy is restored by its own `afterEach`; Vitest file isolation remains
  enabled by default.
- Docker names incorporate the unique build ULID and recovery checks ownership.
  CLI builds publish no ports. HTTP acceptance uses separate network-none
  containers, so the same private port is not a shared host port.
- Worker shutdown, database close, owned artifact cleanup and real timer restore
  remain in the existing teardown. No production cleanup or retries were changed.
- The environment's CPU quota is four cores. Concurrent Docker/compiler work can
  affect timing; that fact alone does not establish the original failure's cause.

The replan counter fingerprints normalized error messages. Equal consecutive
fingerprints trigger replan after two failures. An intervening *different* failure
can reset this counter, but this was not observed for the original failing run.
In particular, numeric tokens are normalized: otherwise identical
`lint command failed (2): ` and `lint command failed (124): ` have the **same**
fingerprint. A mere exit-code difference is insufficient to explain the failure.

## Diagnostic change

The original assertion now prints model call phases and durable model state on
failure. Its predicate and all expected outcomes are unchanged. No production fix
has been applied because the original root cause has not been established.

Changed files for this investigation:

- `src/__tests__/product-factory/model-builder.test.ts`: one diagnostic assertion.
- `docs/product-factory-builder-regression-investigation.md`: this report.
- `docs/product-factory-lot-5r.md`: link to the follow-up investigation.

No migration or dependency changes.

## Attempts excluded from final regression validation

1. The first attempt lacked this turn's write grant for
   `/home/agent/.automaton/workspace`, required by the existing worker tests.
   Workers failed to create their default workspaces. The run was stopped, the
   write grant obtained, and tests restarted. This does not reproduce the original
   failure. Log: `/tmp/lot-5r-builder-investigation-permission-aborted.log`.
2. An instrumented broad run used an external read-only SQLite polling collector
   to observe temporary build state. The original replan test **passed**, taking
   32.363 seconds. It recorded two identical lint errors, then architecture revision
   2. The first two failed attempts took approximately 5.027 and 5.072 seconds.
   However, another test failed in teardown:
   `policy denial prevents a sandbox command from running`,
   `ENOTEMPTY: directory not empty, rmdir '/tmp/factory-build-n0aRVY'`.
   The remaining files were `state.db-shm` and `state.db-wal`. Read-only SQLite
   connections can participate in WAL sidecar creation; the collector raced with
   deletion. The collector was stopped rather than changing production or test
   cleanup. This instrumentation-induced failure is distinct from the original
   assertion failure. The run's 1,895 PASS / 1 FAIL, 311.77 seconds, is recorded
   honestly but is not used to declare the regression suite green.
   Log: `/tmp/lot-5r-builder-investigation-broad.log`.

The final broad run uses only the enhanced assertion, with no external database
reader and no extra resource-load generator.

## Final commands and results

Node/pnpm and proxy/TLS settings reuse the existing onboarding environment; TLS
verification remains enabled.

```sh
export PATH=/workspace/.onboarding-tools/node_modules/.bin:$PATH
export NODE_USE_ENV_PROXY=1
export NODE_OPTIONS=--use-system-ca
pnpm exec vitest run src/__tests__/product-factory/model-builder.test.ts --maxWorkers=1 --minWorkers=1 --sequence.shuffle --sequence.seed=5804
pnpm exec vitest run src/__tests__/product-factory/analytics-*.test.ts --maxWorkers=2 --minWorkers=1
pnpm exec vitest run --exclude '**/context-hardening.test.ts' --maxWorkers=4 --minWorkers=1
pnpm typecheck
pnpm build
git diff --check
```

The shuffled isolated Builder run explicitly exercises a different test order.
The known separate `context-hardening` timeout is excluded as requested; it is not
fixed, weakened or included in a claim that the entire repository suite passes.

| Check | Result |
| --- | --- |
| Isolated Builder, shuffled order / seed 5804 | 25/25 PASS, 253.97 s; replan test PASS, 30.715 s |
| Lot 5R | 41/41 PASS, four files, 7.46 s |
| Clean broad run excluding context-hardening | 1,896/1,896 PASS, 78/78 files, 313.21 s |
| Production typecheck | PASS, exit 0 |
| Runtime and CLI build | PASS, exit 0 |
| git diff --check | PASS |

Logs for the final checks:

- `/tmp/lot-5r-builder-investigation-isolated.log`
- `/tmp/lot-5r-builder-investigation-analytics.log`
- `/tmp/lot-5r-builder-investigation-broad-clean.log`
- `/tmp/lot-5r-builder-investigation-typecheck.log`
- `/tmp/lot-5r-builder-investigation-build.log`

The clean broad run includes all 25 Builder tests (264.525 seconds); the original
replan test passes in 31.461 seconds. It also covers all current Lot 5R tests,
Company OS, previous Product Factory lots, orchestration/workers/harnesses,
policy/security/injection, financial/spend tracking, approvals, resources and
migrations. Its 1,896 tests reflect the current tree including the additional
analytics hardening cases added after the original 1,891-test broad run. No tests
were disabled to obtain this result; the sole exclusion remains the separately
known `context-hardening` timeout.

## Conclusion and invariants

The original root cause remains unestablished. A later successful run does not
prove an intermittent failure has been fixed. No speculative production change
is justified. If it recurs, the enhanced assertion will retain model phases,
command results, failure reasons and budget/iteration state in the failure log.
Shared-state, mock, database, registry, environment and port leakage were not found
in the audit; timing/resource sensitivity remains an unproven risk, not a diagnosis.

Reproduction status: the original assertion failure was **not reproduced** in the
instrumented broad run, shuffled isolated run, or final clean broad run. The clean
run passes without a production fix. This investigation does not establish that
the intermittent failure is eliminated.

Branch: `feature/product-factory`.
HEAD: `d8f816881fd24b6f5e3d616e59edec387a447667`.
Constitution SHA-256:
`d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e`.
No commit, push, merge, PR, public deployment, real payment or commercial action.
Existing dirty working-tree changes are preserved. Lot 6R is not started.
Git status remains 11 tracked files modified, with the existing untracked `docs/`,
`src/__tests__/product-factory/`, `src/product-factory/` directories and
`src/state/factory-tasks.ts`. The investigation's files are included in these
previously untracked directories. No build containers remain active.
