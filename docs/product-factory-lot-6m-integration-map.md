# Lot 6M — repository and environment audit

This is the pre-implementation 6M0 audit, not an acceptance or capability promotion.
Parts 1–4 were received, but phases 6M61–6M65 and the ending after
`compilation != runtime` remain missing. Substantial implementation awaits those
requirements. No application, policy, dependency or schema changes accompany this audit.

## Preservation baseline

- Branch: `feature/product-factory`.
- HEAD: `d8f816881fd24b6f5e3d616e59edec387a447667`.
- Schema: V16; Company records V15 and analytics V16 already exist.
- Existing Lots 1–6R are uncommitted: 11 tracked modified paths and four untracked
  top-level entries (`docs/`, Factory tests, Factory modules, `state/factory-tasks.ts`).
  They must be preserved, including untracked contents.
- Constitution SHA-256: `d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e`.
- Last reported 6R regression: 1,935 passing tests in 81 files excluding the known
  context-hardening timeout. These tests were not rerun during this audit. The
  separate context-hardening run previously exceeded its 20-second external deadline.

## Integration map

| Area | Existing implementation and extension boundary |
| --- | --- |
| Shared lifecycle / planning | `build-engine.ts`, `build-planner.ts`, `model-builder.ts`: existing Goal/DAG and architecture, implementation, test, packaging, validation and private deployment workflow; preserve revision/replan guards |
| Model generation | `model-build-model.ts`: configured `WorkerInferenceProductBuildModel` uses existing inference client, structured responses, trusted cost envelope, bounded files and explicit unavailable state; no deterministic production fallback |
| Architecture / repair | `model-build-types.ts`, `model-build-resume.ts`, `BuildStore`: architecture revisions, attempts, diagnostics, files, budgets, repeated failures and bounded replan; new interaction findings should feed these paths |
| Worker integration | `ModelBuildHarness`, `FactoryBuildHarness`, `BuildEngine.registerHarness` use existing HarnessRegistry and LocalWorkerPool hooks; tools enter existing `executeTool` PolicyEngine |
| Task Graph / resources | Existing orchestration Task Graph, factory metadata and ResourceManager reserve/start/complete/fail/cancel/reconcile; live ownership/lease checks, terminal release and retries remain authoritative |
| Company Contract | `CompanyOperatingSystem.contractBrief`, `company-guards.ts`: exact approved Contract/version/hash, GREENLIGHT and assumption bindings; no substitute economic decisions inside adapters |
| Surface decision | `product-surfaces.ts`, optimization services/types: strategic long-term and validation surfaces, current exact surface decision and conservative evidence registry; retain unsupported recommendations |
| Quality | `BuildValidator`, `assertCompanyQuality`, Company quality results and PublicLaunchGate: structured task/receipt checks and relevant Contract quality; public launch still requires creator approval |
| Artifacts | `local-artifacts.ts`, `build-store.ts`, `build-validator.ts`: bounded paths, source/compiled inspection, SHA-256 and task receipt identity; new acceptance must bind exact artifact and plan |
| HTTP acceptance | `application-acceptance.ts` and ModelBuilder run private loopback readiness/probes inside the sandbox; HTTP is not browser interaction |
| Browser boundary | `browser-acceptance.ts` has dormant SandboxChromiumAcceptance using sandbox Chromium/CDP with fill/click/text assertions. It has no demonstrated browser receipts, richer immutable plans, responsive/visual/accessibility evidence or full semantic actions |
| Persistence | Existing creator-scoped CompanyStore append-only revisions, hash checks, transactions, optimistic concurrency and identical-input idempotency; extend supported record kinds if needed rather than add a parallel store |
| Private experiment reuse | `optimization-execution.ts`: existing harness/tool admission, creator-scoped dispatch, leases, bounded private artifact probes and immutable outcome references; no external executor |
| Heartbeat | Existing Factory heartbeat adapter; no new scheduler/timer is needed for surface acceptance |

## Environment observations

Read-only checks were run in this instance. Package presence is not execution acceptance.

| Component | Observed state | Classification |
| --- | --- | --- |
| Host | Linux x86_64, kernel 6.18.44 | AVAILABLE_NOW |
| Node | Default PATH v24.19.0; preserved onboarding Node v22.23.3 | AVAILABLE_NOW |
| pnpm | 10.28.1; repository pin matches | AVAILABLE_NOW |
| Docker | Server 28.4.0; installed `automaton-product-builder:local` | AVAILABLE_NOW |
| Builder image | Digest `sha256:dfb6c57b264abf31816985bf7f7c74bead7c683052a597bb3d825f7a54945165`, user 10000:10000, workdir `/work`; scratch-based local Node/toolchain image | AVAILABLE_NOW for existing Node path |
| Chromium | Host `/usr/bin/chromium`, 151.0.7922.173 | AVAILABLE_NOW on host; isolated launch NOT DEMONSTRATED |
| Playwright Core | Existing runtime package `/opt/codex/runtimes/cua/lib/node_modules/playwright-core`, 1.57.0; not a repository dependency | AVAILABLE_WITH_EXISTING_DEPENDENCY; isolated integration NOT_IMPLEMENTED |
| Chrome / Firefox | Not found on PATH | NOT_IMPLEMENTED in audited path |
| Java | OpenJDK runtime 21.0.12.1 present; javac not found on PATH | AVAILABLE_NOW runtime; full build toolchain not established |
| Gradle / Android SDK / build-tools | No executable found on PATH or SDK in checked `/opt/android-sdk`, `/usr/lib/android-sdk`, `/workspace/android-sdk` | NOT_IMPLEMENTED; installation feasibility unverified |
| adb / emulator / system images | No executable found; no system image demonstrated | NOT_IMPLEMENTED |
| KVM | `/dev/kvm` absent | BLOCKED_BY_ENVIRONMENT for KVM acceleration; software emulation feasibility unverified |
| macOS / Xcode | Linux host, no xcodebuild | BLOCKED_BY_ENVIRONMENT |
| React Native / Expo / Capacitor / Tauri | No declared integration found in repository manifest/lockfile | ARCHITECTURALLY_POSSIBLE, NOT_IMPLEMENTED |
| Browser accessibility tooling | No repository-integrated engine demonstrated | NOT_IMPLEMENTED |
| Network / installation | Existing host development network capability differs from product sandbox network; no new download or dependency installation attempted | Installation feasibility not yet verified |

## Security and implementation implications

DockerProductSandbox requires an installed immutable image digest, denies pulls,
host mounts and published ports, uses network-none, read-only root, non-root UID,
cap-drop ALL, no-new-privileges, 64 PID limit, 256 MiB memory, one CPU and bounded
tmpfs. Its execution API permits isolated Node/toolchain execution only. These
limits cannot be silently weakened for Chromium or Android.

The existing image is not a browser or Android runner. Host Chromium presence
cannot certify that image. A browser integration must first establish a bounded
compatible image/runtime arrangement with private communication and tested
origin/process/filesystem boundaries. Browser installation, sandbox compatibility
and resource sizing are not yet demonstrated.

Android framework selection is deferred until the full specification and actual
toolchain feasibility checks. Native Android, Capacitor and React Native/Expo are
candidate approaches, not installed capabilities. No Android source/build/APK,
emulator/device journey, signing or store readiness was demonstrated by this audit.
An authorized future macOS runner must use the same Task Graph, workers, resources
and policy interfaces; Linux cannot provide Xcode acceptance.

New versioned profiles/plans/receipts should reuse CompanyStore and existing artifact
hashing. Required bindings include product, exact Contract/surface revisions,
architecture, artifact and acceptance plan. Failed/history evidence must remain
immutable; model or screenshot opinion cannot override deterministic failure.

No capability is promoted. Existing API/Web statuses remain partially supported,
other surfaces not implemented, and no real external-model generalization or real
browser/device journey is claimed. No migrations, commits, pushes, merges, PRs,
public deployment, financial/commercial action or Lots 7R/8R work occurred.

## Implementation completion note

The final continuation explicitly authorized implementation. The historical audit
above remains the starting observation. Final implementation, actual toolchain
stages, environment blocks and validation are documented in
[the Lot 6M report](product-factory-lot-6m.md). Android SDK build/package capability
was subsequently established; Chromium interaction and all mobile/Apple runtime
capabilities were not falsely promoted. Schema remains V16.
