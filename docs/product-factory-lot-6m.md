# Lot 6M — multi-surface Builder and interaction acceptance

## Outcome and evidence boundary

The existing Builder now has bounded surface adapters, frozen acceptance plans,
immutable technical receipts, granular capability derivation, exact quality-gate
bindings and an offline native Android compilation/package path.

**Real Chromium interaction was NOT demonstrated.** Chromium was attempted both
on the host and in the private Docker boundary and refused to start without a
usable browser sandbox. No `--no-sandbox`, privileged container, host mount,
public port or network widening was used.

**Real Android compilation and unsigned APK packaging were demonstrated** for
three generated native projects through the existing Builder, workers, Task Graph,
PolicyEngine and ResourceManager. One Java compilation failure was diagnosed and
repaired by a deterministic model double. Android installation, launch and
interaction were NOT executed. iOS execution was NOT executed.

**REAL MODEL GENERALIZATION NOT DEMONSTRATED.** Generation used deterministic
contract-compatible doubles. Browser/emulator automation would be technical
acceptance, not customer demand, willingness to pay, retention or profitability.

## 6M0 integration and environment audit

The historical starting audit is preserved in
[product-factory-lot-6m-integration-map.md](product-factory-lot-6m-integration-map.md).

Existing systems reused:

- CompanyOperatingSystem/CompanyStore: creator-scoped versioned SQLite records,
  hash checks, optimistic concurrency, transactions, decision rights and quality.
- Contract → Brief → BuildPlanner: current approved Contract/surface references,
  GREENLIGHT, creator build approval, existing Goal/DAG and revision/replan guards.
- BuildEngine/ModelBuilder: configured inference bridge, original implementation,
  diagnostics, bounded repair, command execution and persisted verification attempts.
- HarnessRegistry/LocalWorkerPool/Task Graph: existing model-build role, worker
  hooks, product metadata, acknowledgements, failure isolation and retries.
- ResourceManager: existing build slots, owned leases, budgets, compute/time bounds
  and terminal release. No second worker, scheduler, heartbeat or resource manager.
- executeTool/PolicyEngine: sensitive generation/read/write/compile/acceptance actions
  continue through existing tool admission. No second policy or approval system.
- DockerProductSandbox: installed immutable images, offline execution, non-root,
  read-only root, no mounts/public ports, cap-drop ALL/no-new-privileges, 64 PIDs,
  256 MiB memory, one CPU and bounded tmpfs. These protections are unchanged.
- BuildStore/local-artifacts: existing artifact roots, safe paths, symlink rejection,
  SHA-256, source manifests, structured checks and receipts.
- Existing analytics/economic evidence and public-launch approval gates remain intact.

Environment observed:

| Item | Result |
| --- | --- |
| Host | Linux x86_64; not macOS |
| Development Node | Validated onboarding Node 22.23.3; default host Node 24.19.0 |
| pnpm | 10.28.1 |
| Docker | Server 28.4.0 |
| Chromium | 151.0.7922.173 on host and provisioned isolated image; launch BLOCKED |
| Playwright Core | 1.57.0, copied from existing authorized runtime into browser image |
| Java | OpenJDK 21.0.12.1; compiler accessible using `java -m jdk.compiler/com.sun.tools.javac.Main` |
| Android | Platform 35 revision 2; Build Tools 35.0.0; aapt/aapt2/d8 present in offline image |
| Gradle | Not installed or used; narrow native build invokes fixed offline compiler tools |
| adb / emulator / system image | Not installed; no authorized device runner |
| KVM | `/dev/kvm` absent |
| iOS / Xcode / macOS | Unavailable; no Apple runner configured |
| React Native / Expo / Capacitor / Tauri | Not introduced |

Android runtime is **BLOCKED_BY_ENVIRONMENT**, not proven permanently impossible.
Software emulation was not attempted. There is no provisioned emulator/image/device,
no KVM and no verified emulator arrangement within the existing 256 MiB/64-PID
sandbox profile. This lot does not request broader privileges or a larger runner
merely to improve a capability table.

## Exact repository changes

Added:

- `src/product-factory/surface-builder-types.ts`
- `src/product-factory/surface-adapters.ts`
- `src/product-factory/surface-browser.ts`
- `src/product-factory/surface-acceptance.ts`
- `src/product-factory/surface-mobile.ts`
- `src/__tests__/product-factory/surface-builder.test.ts`
- `scripts/product-factory/android-build.cjs`
- `scripts/product-factory/prepare-surface-toolchains.py`
- `docs/product-factory-lot-6m.md`

Modified relative to the saved Lot 6M implementation baseline:

- `src/product-factory/browser-acceptance.ts`
- `src/product-factory/company-guards.ts`
- `src/product-factory/company-os.ts`
- `src/product-factory/company-store.ts`
- `src/product-factory/company-types.ts`
- `src/product-factory/docker-product-sandbox.ts`
- `src/product-factory/index.ts`
- `src/product-factory/local-artifacts.ts`
- `src/product-factory/model-build-types.ts`
- `src/product-factory/model-builder.ts`
- `src/product-factory/optimization-service.ts`
- `src/product-factory/optimization-types.ts`
- `src/product-factory/product-brief.ts`
- `docs/product-factory-lot-6m-integration-map.md` (completion note only)

Earlier dirty files remain preserved; the lists above do not attribute earlier lots
or the initial 6M0 document creation to this implementation.

## Persistence and schema

**Schema remains V16. No migration.** No V1–V16 rewrite.

Eight additive typed record kinds reuse `company_records`:
`surfaceEnvironment`, `surfaceAdapter`, `surfaceProfile`, `surfacePlan`, `surfaceRun`,
`surfaceReceipt`, `surfaceCapability`, `surfaceArtifact`. No parallel database.

Profiles, plans, receipts, artifact catalog records and capability evidence records
reject historical rewriting, including a new revision under the same identity.
New identities/profile versions are required. Ordinary Company record revisioning
and existing decisions are preserved. Generic Company recording cannot manufacture
surface evidence; guarded workflows are required.

Browser receipt/run/capability writes are transactional. Completed identical
receipt processing is idempotent; a running interrupted acceptance cannot silently
execute again outside the existing bounded task retry semantics. Failed receipts
remain failed. Compiler attempts and source snapshots persist through the existing
Builder state. Source revisions and compiled browser-attempt snapshots preserve
old inputs/artifacts alongside hashes rather than replacing failure history.

## Shared lifecycle and adapters

SurfaceAdapterRegistry resolves the requested surface exactly. Resolution is
capability/environment information, **not execution authorization**. Execution
remains in ModelBuilder under approved Brief/Contract, live task/lease, policies
and budgets. Strategy remains with Lot 6R.

Implemented adapter boundaries:

| Adapter | Actual boundary |
| --- | --- |
| API | Reuses existing private HTTP probes; no new HTTP executor |
| Web | Trusted Playwright script through existing sandbox `session.exec`; browser unavailable here |
| Android | Fixed offline native SDK compiler entrypoint; interaction returns BLOCKED |
| iOS | Explicit unavailable authorized-macOS boundary; cannot compile or return simulated runtime success |
| PWA | Web interaction boundary available architecturally; PWA/offline capability not demonstrated |
| Cross-platform / Desktop / Extension / Multi-surface | No fake executable adapter; NOT_IMPLEMENTED |

Unsupported explicit architecture surfaces are blocked. Android architecture must
select the fixed SDK entrypoint and APK output. Surface adapters never choose an
alternative economic surface. No silent Web substitution occurs.

An approved Company Contract may explicitly request `PRIVATE_BUILD_ONLY` native
Android prototyping when the existing registry contains owned real compiler
receipts. This permits the demonstrated compile/package stage; the ModelBuilder
still stops at unavailable native runtime. Normal unsupported-surface blocking
remains the default. This is not release, runtime or public-launch authorization.

## Profiles, plans and exact bindings

Versioned profiles define mandatory capabilities and optional Contract-dependent
persistence, visual/accessibility, permission, signing and store dimensions.
API requires runtime/API behavior; Web requires actual browser navigation and
interaction; mobile requires actual mobile launch and interaction.

Plans derive from the approved Brief/Contract probe, declared architecture and
surface profile. They are stored before execution. They preserve criterion IDs,
exact environment, bounded viewport/action/time/evidence settings and cleanup.

Binding includes product/build/Brief, current Contract revision/hash when managed,
current surface decision revision/hash, architecture revision and artifact digest.
Legacy Brief-only builds retain an explicit null Company Contract; they cannot
certify a Company-managed gate.

Runtime plans bind known compiled bytes. Pre-build Android plans bind source hash
and expected artifact paths, since output bytes do not exist yet; compiler receipts
add the inspected exact output digest and retain the frozen source identity.
Changing a criterion/plan requires a new identity/version. Model output cannot
remove mandatory steps, alter expected outcomes or mark them not applicable.

## Browser execution, inspection and evidence

The provider is IsolatedPlaywrightAcceptance; the old SandboxChromiumAcceptance
export remains compatible. It executes an actual Chromium launch attempt, not an
HTTP client or mocked browser, using sandbox-required Chromium and the provisioned
Playwright Core inside a network-none image.

Each viewport uses an ephemeral browser context. Downloads, popups and service
workers are bounded/blocked. Requests are restricted to the declared private
loopback origin; unexpected destinations become findings. There are no production
cookies, creator credentials, host mounts or public ports.

Bounded actions include semantic role/label/test-ID targeting, navigate, click,
type, select, submit, wait, visibility/text/state/URL assertions, reload, back,
scroll, screenshot and accessible-state capture. Legacy fill/click/text steps
remain supported. No untrusted executable JavaScript is accepted as an action.
Trusted internal layout inspection uses fixed harness code.

The implementation captures, where executable:

- meaningful Contract actions and negative/error states;
- accessible snapshots, route, title and viewport;
- uncaught exceptions, crashes and failed private application requests;
- external network attempts and unwanted download/window events;
- blank render, viewport overflow and critical accessible-name deficiencies;
- bounded JPEG screenshots with hashes, step/route/viewport/time, enclosed by the
  exact run/product/artifact binding;
- declared first-value checkpoint data, with no first-value claim when absent;
- explicitly declared persistence layer and reload/assertion requirements.

Screenshots and observations are bounded; missing mandatory screenshot evidence
cannot silently PASS. First-value and persistence are technical assertions only.
Browser-local persistence is distinct from server/database durability; a reload
alone is not a server-process restart. Full application-database restart testing
continues through existing HTTP runtime restart probes where declared.

These are automated technical heuristics, not a beauty score, full UX verification
or WCAG certification. Mature advanced accessibility/visual review is deferred.
An optional VisualCritic interface requires existing inference/reservation and
tracked cost; its findings are VISUAL_MODEL_CRITIQUE, never objective customer
preference or an execution bypass. No vision model was invoked.

### Actual browser boundary

Host Chromium failed with a SUID sandbox configuration error. A namespace-based
attempt also reported `No usable sandbox`; user namespace mapping was unavailable.
In the private image, Chromium terminated with SIGABRT at the sandbox setup stage.
No page navigation, screenshots, accessibility inspection or interaction occurred.
The isolated Chromium diagnostic was:
`FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc:166: The SUID sandbox helper binary was found, but is not configured correctly`.
The process terminated with SIGABRT; this is not a completed browser launch.
The existing non-root/cap-drop/no-new-privileges boundary was retained.

Reproducible local image identities:

- Node base: `sha256:dfb6c57b264abf31816985bf7f7c74bead7c683052a597bb3d825f7a54945165`.
- Chromium/Playwright image: `sha256:6aeb276613be88d3a52e646b0de631036e91de9a390ba0b8170a68dd35efdf20`.
- Final offline Android SDK image: `sha256:69ba837fc91ded23dd170b31ab0865dbbdea80af6a0b0a8b16a573e2c1fae8ff`.

Therefore:

- REAL BROWSER INTERACTION: **NOT DEMONSTRATED / BLOCKED**.
- Real browser engine launch attempt: **executed, failed before usable browser**.
- Browser journey, visual/responsive/accessibility findings in live browser: **not executed**.
- Genuine browser-detected defect → repair → successful retest: **not executed**.
- Deterministic receipt/repair-history contracts: **tested**, not a real browser run.

## Android technology and real stages

A narrow **native Java/Android SDK** adapter was selected because it fits the
existing Node tool boundary, uses the available Java compiler module, needs no
npm/Gradle dependency network and can produce real APKs on Linux. This is a bounded
prototype compiler, not a universal mobile framework recommendation.

The trusted `android-build.cjs` runs fixed javac/d8/aapt2/jar/aapt commands without
shell or network. It validates identity/version metadata, source paths, manifest,
permissions, dependencies/actions and APK contents. The initial path supports
small offline native-widget applications; external APIs, dangerous permissions,
native libraries and broader frameworks are not silently enabled.

SDK archives were fetched over verified HTTPS from Google and checked against
Google repository checksums. Additional SHA-256 identities:

- Platform: `platform-35_r02.zip`,
  `0988cacad01b38a18a47bac14a0695f246bc76c1b06c0eeb8eb0dc825ab0c8e0`.
- Build tools: `build-tools_r35_linux.zip`,
  `bd3a4966912eb8b30ed0d00b0cda6b6543b949d5ffe00bea54c04c81e1561d88`.

No dependency installation happens inside generated applications. Images are
installed locally, selected by immutable digest and never pulled at runtime.
The reusable local-image preparation script was actually exercised for Android.
No unrelated host configuration, JDK installation or production signing key was changed.

Android build plans/receipts distinguish actual generation, compiler and package
results from unavailable install/launch/interaction. Compiler output and artifact
catalog retain package/version, hashes, size and unsigned status. APKs contain a
compiled manifest and classes.dex. No AAB was produced. No APK was installed.

Signing is **NOT_CONFIGURED** for actual artifacts. TEST_SIGNING_ONLY is tested as
a classification rule, not an executed debug-signing demonstration. Production
signing, signing readiness and Google Play artifact readiness are NOT_IMPLEMENTED.
An unsigned APK is not a Play-ready application. No Play login/upload/submission.
Bit-for-bit APK reproducibility was not demonstrated; archive timestamps can differ.

Mobile action types/runner requirements are interface-ready, covering semantic
interaction, back/restart, UI state, screenshots and explicit grant/deny permissions.
They are not an implemented emulator driver. Mobile persistence, accessibility,
visual quality, crash/ANR, offline recovery and permission behavior remain unvalidated.
A bounded device matrix belongs to the authorized future runner/profile, not a
claim of universal device compatibility.

## iOS and shared product boundaries

IOSSurfaceAdapter rejects compilation and returns unavailable execution without
an authorized macOS/Xcode runner. MacOSSurfaceJob carries creator/product,
Contract/surface/build/source/plan identity, existing task/reservation/approval,
resource bounds, denied network and forbidden production signing/store submission.
The future runner must return verifiable signed receipts. Signature verification,
Apple compilation, simulator/device runtime, archive/IPA, signing and store metadata
are not implemented by this interface.

Android proof cannot certify iOS or complete cross-platform support. Each surface
retains independent bindings and capability evidence under shared product identity.
Lot 6R may preserve long-term Android/mobile and cheaper PWA validation while both
execution limitations remain visible. The new adapters do not mutate that decision.
Existing 6R tests exercise the real surface reasoning; new deterministic scenarios
exercise evidence separation and blocked resolution. A full real multi-surface
application journey was not executed.

Shared-backend behavior uses existing declared architecture/API/HTTP contracts.
No backend is forced onto local products. Schema/auth/error/persistence compatibility
must be covered by Contract probes; no universal shared-backend certification is
claimed. Offline/degraded behavior must be explicitly tested by an authorized future
runner; it is not inferred from source or a responsive Web layout.

## Capability promotion, regression and quality

FactoryOptimization.capabilitiesFromAcceptance extends the **existing Lot 6R
BuilderSurfaceCapability registry** with granular immutable receipt references.
It uses existing policy admission and rejects forged receipts lacking owned build
and plan records. Arbitrary manual granular promotion is refused.

Status derives from evidence strength, exact surface/environment/toolchain and
capability-specific results. Two distinct accepted product/artifact bindings are
required for SUPPORTED capability derivation; overall support requires all mandatory
profile dimensions. Compiler/package success with blocked runtime remains partial.

Toolchain/environment mismatch can stale capability; representative repeated
failure can regress it without changing historical receipts. Product-specific
failure does not erase valid evidence for another product. Earlier Node compiler
capabilities are retained when a later browser failure has no compiler observations.

Browser-required Company quality must provide a current exact immutable browser
receipt. HTTP-only, old-artifact, missing or failed receipts cannot pass. Current
Contract/surface and compiled artifact hashes are rechecked at quality/release time.
Visual/accessibility/first-value dimensions require relevant receipt observations.
Product Health and existing launch approval remain independent constraints.

Recommendation is not approval; a receipt is not public deployment, store
submission, customer evidence or spending authority.

## Benchmarks and real execution results

All generation below used **DETERMINISTIC_CONTRACT_DOUBLE**. The production
implementation contains technical adapters, not a catalogue of these applications.
The benchmark contracts and implementations are test fixtures. Their variety does
not establish arbitrary-product or external-model generalization.

| Web contract | Shape | Generation / compile / private runtime | Browser / journey / final acceptance |
| --- | --- | --- | --- |
| Staff coverage window | Workflow/data management | Demonstrated | BLOCKED / not executed / BLOCKED |
| Laboratory dilution | Analysis/transformation | Demonstrated | BLOCKED / not executed / BLOCKED |
| Maintenance glossary | Knowledge/search | Demonstrated | BLOCKED / not executed / BLOCKED |
| Dispatch packing | Multi-step operational utility | Demonstrated | BLOCKED / not executed / BLOCKED |
| Facilities escalation | Small B2B operations | Demonstrated | BLOCKED / not executed / BLOCKED |

Each used one generation attempt and 10 recorded compute units. Browser attempts
failed at the sandbox boundary. No meaningful browser journey, browser persistence,
negative/error journey, screenshots, real accessibility/visual result or browser
repair was demonstrated. An additional equipment-checkout probe returned an
immutable BLOCKED receipt. Browser repair and retest integrity are tested with
simulated receipts only; that is not the requested genuine browser-level repair.

Android generation, compilation and unsigned APK packaging ran through the actual
Builder execution path. Runtime and interaction remained BLOCKED for every product.

| Native contract | Attempts | APK bytes | APK SHA-256 | Recorded compute | Wall time |
| --- | ---: | ---: | --- | ---: | ---: |
| Field calibration log | 2 | 2727 | `54e2bf3ef967c7f52c2b40437a2fe7e49fbbfc8e522748ba5c66b8c872af7751` | 9 | 30.16 s |
| Museum collection intake | 1 | 2790 | `a8d6dfe2692d0ebfd0994ee819bf7887d85c90196cbbb77d320873807b0a6a59` | 5 | 19.43 s |
| Private shift handover | 1 | 2827 | `3b5b168b5fa32ddd55a4959e2f514ff24434a1eafbc5935978b282afb5827c25` | 5 | 18.51 s |

Field calibration's first Java source failed real compilation. The diagnostic
returned through the existing model repair path, which produced new source and a
new successful compilation. Failed source history remained available. This proves
compiler repair, not emulator or browser repair. These three projects are small
native offline-form prototypes; their compiled widgets were not observed on a device.
Test teardown removed temporary APK binaries after hashing and validation; retained
report summaries/catalog references are not downloadable release artifacts.

The fresh summaries are in `/tmp/lot-6m/android-*.json` and
`/tmp/lot-6m/web-*.json`. Native artifact catalogs bind source/build receipts,
artifact path/hash/size and compiler metadata. No AAB was produced. No signing key
was used. Signing is NOT_CONFIGURED; signing capability and store readiness remain
NOT_IMPLEMENTED. The debug-signing adversarial case is a fixture, not an actually
signed APK. No Google Play or App Store account was accessed.

## Final capability inventory

This inventory describes demonstrated evidence and unavailable stages. It does
not manually promote registry entries. Native registry output records generation,
compilation and PACKAGE as EXPERIMENTAL, runtime/interaction as BLOCKED, and overall
ANDROID as PARTIALLY_SUPPORTED. Granular `acceptanceEvidence` is authoritative for
new dimensions; legacy coarse fields remain for compatibility and may retain an
older NOT_IMPLEMENTED value where no prior proof existed.

| Surface | Overall execution status | Evidence and remaining boundary |
| --- | --- | --- |
| API_SERVICE | PARTIALLY_SUPPORTED | Existing Node generation/compile/test/private runtime/HTTP foundations preserved; no arbitrary-model or universal product certification |
| WEB_APP | PARTIALLY_SUPPORTED | Node compile/private runtime demonstrated; real browser interaction BLOCKED |
| WEB_SAAS | PARTIALLY_SUPPORTED | Existing Web/HTTP foundations preserved; browser BLOCKED, no commerce/customer validation |
| PWA | NOT_IMPLEMENTED | Web adapter boundary available; no offline/install/service-worker acceptance |
| ANDROID | PARTIALLY_SUPPORTED | Experimental native generation/compile/unsigned APK; runtime/interaction BLOCKED |
| IOS | BLOCKED | Architectural adapter only; no authorized Apple runner |
| MOBILE_CROSS_PLATFORM | NOT_IMPLEMENTED | No shared-source framework acceptance; Android cannot certify iOS |
| DESKTOP | NOT_IMPLEMENTED | No execution adapter/proof |
| BROWSER_EXTENSION | NOT_IMPLEMENTED | No extension runtime/packaging proof |
| MULTI_SURFACE | NOT_IMPLEMENTED | Shared identities and independent evidence supported structurally; no complete accepted multi-surface application |
| UNDECIDED | NOT_IMPLEMENTED | Requires a strategic decision; no implicit fallback |

Capability dimensions, individually:

| Dimension | API / existing Web path | Android | iOS | Other unimplemented surfaces |
| --- | --- | --- | --- | --- |
| Generation | PARTIALLY_SUPPORTED, deterministic-double evidence | EXPERIMENTAL | NOT_IMPLEMENTED | NOT_IMPLEMENTED |
| Dependency resolution | Existing bounded Node path; no new universal proof | NOT_IMPLEMENTED (preprovisioned SDK, no application dependency resolver) | BLOCKED | NOT_IMPLEMENTED |
| Compilation | PARTIALLY_SUPPORTED | EXPERIMENTAL | BLOCKED | NOT_IMPLEMENTED |
| Product automated tests | Existing bounded tests preserved | NOT_IMPLEMENTED | BLOCKED | NOT_IMPLEMENTED |
| Runtime | PARTIALLY_SUPPORTED, private Node/HTTP | BLOCKED | BLOCKED | NOT_IMPLEMENTED |
| Browser/device interaction | BLOCKED for Web; API HTTP evidence separately preserved | BLOCKED | BLOCKED | NOT_IMPLEMENTED |
| Visual/accessibility acceptance | NOT_IMPLEMENTED as demonstrated product capability | NOT_IMPLEMENTED | BLOCKED | NOT_IMPLEMENTED |
| Persistence | Existing API/server probes only; browser persistence BLOCKED | BLOCKED | BLOCKED | NOT_IMPLEMENTED |
| Packaging | Existing artifact handling preserved; no new accepted Web distribution package | EXPERIMENTAL, unsigned APK only | BLOCKED | NOT_IMPLEMENTED |
| Signing readiness | NOT_IMPLEMENTED | NOT_IMPLEMENTED | BLOCKED | NOT_IMPLEMENTED |
| Store-artifact readiness | NOT_IMPLEMENTED | NOT_IMPLEMENTED | BLOCKED | NOT_IMPLEMENTED |

No new surface is SUPPORTED. Browser executable presence is not BROWSER_LAUNCH
proof. IOS project generation, compilation, simulator/device launch, interaction,
packaging, signing and App Store artifacts have no executed Apple evidence.
Cross-platform generation/build/runtime/packaging are NOT_IMPLEMENTED.

## Adversarial A–Z results and evidence strength

All named scenarios are covered by the 37 new tests. These deterministic tests
validate independent decision/receipt logic; most intentionally use test doubles
and do not establish actual browser/device behavior.

| Case | Verified outcome | Execution classification |
| --- | --- | --- |
| A | HTTP success cannot excuse unusable mandatory control | Simulated browser failure |
| B | Blank-render finding prevents PASS | Simulated browser failure |
| C | Required narrow viewport failure prevents PASS | Simulated responsive finding |
| D | Model praise cannot override deterministic failure | Governance fixture |
| E | Old artifact receipt rejected | Exact-binding test |
| F | Plan change after start rejected | Store/immutability test |
| G | Mandatory check cannot become skipped success | Anti-gaming test |
| H | Unavailable browser returns BLOCKED | Fixture plus actual sandbox attempt |
| I | Unexpected network is diagnosed, no widening | Structured harness/receipt test; real app request not executed |
| J | Old FAIL immutable; new artifact needs new receipt | Simulated repair contract; genuine browser repair BLOCKED |
| K | In-memory state cannot establish required durability | Persistence validation fixture |
| L | Critical runtime exception defeats visual praise | Runtime diagnostic fixture |
| M | Generated source with failed compile is not support | Fixture plus actual native compiler failure/repair |
| N | Compile retained while missing emulator blocks runtime | Actual native builds |
| O | APK alone cannot establish accepted Android product | Actual native builds and capability derivation |
| P | Launch without journey success does not certify interaction | Mobile receipt fixture |
| Q | Unneeded dangerous permission fails validation | Static validation fixture |
| R | Lost state fails required persistence | Mobile receipt fixture |
| S | Debug signing cannot imply production/store acceptance | Signing-classification fixture |
| T | Android evidence cannot certify iOS/cross-platform | Capability fixture |
| U | Linux without authorized Apple runner blocks iOS | Actual environment plus adapter test |
| V | Blocked Android execution preserves preferred Android | Strategy/resolution fixture and existing 6R regression |
| W | PWA validation and Android long-term remain distinct | Existing 6R reasoning and binding tests |
| X | Restart/completed receipt does not re-execute/promote twice | SQLite persistence/idempotence test |
| Y | One product's failure preserves unrelated valid evidence | Both ordering directions tested |
| Z | Toolchain changes stale evidence; representative failure can regress | Capability history test |

Additional tests reject forged/unowned capability references, arbitrary executable
actions, mismatched screenshot bindings, insufficient quality dimensions, and
HTTP-only satisfaction of browser-required Company gates. Deterministic receipts
cannot be injected through the ordinary production Company record workflow.

## Persistence, resource and failure-isolation results

Plans/profiles/receipts/catalog/evidence persist in existing SQLite CompanyStore.
Restart/reload, immutable failure history and completed-run idempotence pass.
Acceptance remains tied to owned live task/lease and approved current Brief.
Interrupted work uses existing bounded retries rather than a second scheduler.

Failed acceptance consumes recorded compute and wall time. Resource/budget checks,
lease release and existing model cost tracking remain authoritative. Fixture model
cost is zero in its own ledger; real monetary acceptance cost is UNKNOWN/null,
not a fabricated zero-dollar service. CPU/memory limits are bounds, not claims of
measured peak utilization.

Cold SDK container startup initially exceeded the existing ten-second startup
limit. New SDK tests request a bounded thirty-second limit; the normal default stays
ten seconds. Failed sandbox opening now force-removes its owned container. Two
initial orphaned Created containers were removed after the affected runs finished.
Final inspection found no generated acceptance containers left running or retained.
No unrelated production behavior was changed to mask tests.

## Exact validation

Tool environment: onboarding Node/pnpm on PATH, `NODE_USE_ENV_PROXY=1`,
`NODE_OPTIONS=--use-system-ca`. These flags permit existing read-only network tests;
generated product sandboxes remain network-denied. Existing worker fixtures needed
write permission for `/home/agent/.automaton/workspace`; permission was granted,
without modifying their source behavior.

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --exclude '**/context-hardening.test.ts' --maxWorkers=4 --minWorkers=1 --reporter=json --outputFile=/tmp/lot-6m/last-broad.json` | 1,972/1,972 PASS, 82 test files, zero failures |
| `pnpm exec vitest run src/__tests__/product-factory/surface-builder.test.ts src/__tests__/product-factory/model-builder.test.ts src/__tests__/product-factory/company-builder.test.ts src/__tests__/product-factory/company-persistence.test.ts src/__tests__/product-factory/optimization-adversarial.test.ts --maxWorkers=2 --minWorkers=1 --reporter=json --outputFile=/tmp/lot-6m/targeted-final.json` | 104/104 PASS after the final source adjustments |
| Lot 6M within the fresh targeted run | 37/37 PASS |
| Existing ModelBuilder within the fresh targeted run | 25/25 PASS |
| Product Factory within the broad run | 358/358 PASS across 19 files |
| Lot 6R within broad run | 39/39 PASS |
| Lot 5R within broad run | 41/41 PASS |
| Lot R within broad run | 44/44 PASS |
| Lots 1–4C within broad run | 197/197 PASS |
| `pnpm typecheck` | Exit 0 |
| `pnpm exec tsc -p /tmp/lot-6m-test-tsconfig.json` | Exit 0; strict new-test/import typecheck using temporary config |
| `pnpm build` | Exit 0; runtime and CLI build |
| `node dist/index.js --help` | Exit 0; no daemon started |
| `git diff --check` | Exit 0 |

Broad coverage includes Builder, Task Graph, LocalWorkerPool, HarnessRegistry,
ResourceManager, policy/security/injection, approvals, spend/financial, migrations
and persistence. Three earlier broad runs also passed 1,972/1,972. The final full broad run
(`/tmp/lot-6m/last-broad.json`) ran after all source binding/history adjustments and
passed 1,972/1,972; the fresh 104-test targeted run and all type/build checks also passed.

Known context-hardening command:

```sh
timeout --signal=TERM --kill-after=2s 20s pnpm exec vitest run \
  src/__tests__/context-hardening.test.ts --maxWorkers=1 --minWorkers=1 --reporter=verbose
```

**Exit 124** after twenty seconds, with no assertion results. This remains the
separate previously known timeout; it is not a claimed PASS. The broad command
excludes only that known file. No new unexplained broad-suite failure was excluded.
The earlier intermittent Builder failure from the prior investigation did not recur;
that historical failure's root cause is not newly established here.

Detailed local logs: `/tmp/lot-6m/last-broad.json`, `validated.json`, `targeted-final.json`,
`commands-final.json`, `context-hardening.log`, native/Web JSON summaries and Chromium diagnostics. These are local
execution evidence, not remotely hosted or indefinitely retained artifacts.

## Limitations, deferred work and recommended next step

- Real browser journey and genuine browser repair remain BLOCKED by sandbox launch.
  Next: an authorized browser runner with a working Chromium sandbox under equivalent
  product/network/resource isolation. Do not use `--no-sandbox` as a workaround.
- Android is a narrow native Java/offline SDK prototype path. Next: an authorized,
  bounded emulator/device harness attached to existing Task Graph/worker/lease
  contracts, then real launch/navigation/persistence/error/permission/interaction
  acceptance before promotion. Gradle/general application dependencies, AAB,
  signing readiness and store checks need separate demonstrated extensions.
- Apple acceptance needs the defined authorized macOS/Xcode runner; its interface is
  ready, but receipt signing verification and actual Apple execution remain future work.
- Full mobile visual inspection, accessibility, offline recovery and device matrices
  are not demonstrated. Model visual critique is an interface, with no model call.
- No real external-model generation or real customer evidence was obtained.
  System-wide real-model acceptance remains required and may follow Lot 8R.
- Exact APK byte reproducibility was not demonstrated; commands/toolchains and hashes
  are recorded, but ZIP metadata can vary.
- The real native build benchmark exercised approved Brief-based compatibility.
  Full Company Contract → Android prototype → runtime E2E was not demonstrated.
- Lot 7R continuous operations/autonomy/resilience and Lot 8R dashboard were not started.

Cloud setup was guided by `cloud-environment-onboarding:setup`. Reusable environment
activation instructions were saved as an unpublished **start_skill draft** for user
review. No environment configuration was published, no secret was added, and no
install script/network allowlist was changed. Toolchain setup scripts and explicit
image identity checks are in this repository; caches/images are local environment
state, not committed product assets.

## Final completion answers and invariants

1. Usable REAL browser engine executed: **No**; executable attempted, sandbox launch failed.
2. Real browser interacted with generated software: **No**.
3. Meaningful real browser journey completed: **No**.
4. Genuine browser defect repaired: **No**, blocked; simulated receipt repair only.
5. Android project generation executed: **Yes**, deterministic generation.
6. Real Android compilation executed: **Yes**, three projects.
7. APK/AAB produced: **Yes APK; no AAB**, unsigned.
8. REAL Android emulator/device executed: **No**.
9. Real Android app interaction executed: **No**.
10. Android blocked capabilities: install/launch/navigation/interaction, runtime
    persistence/network/permission/crash testing; signing/store readiness not implemented.
11. Apple tooling executed: **No**.
12. Unsupported capabilities inferred as support: **No**; contracts/fixtures are separated.
13. Unavailable stages marked honestly: **Yes**, BLOCKED/NOT_IMPLEMENTED.
14. REAL MODEL GENERALIZATION: **Not demonstrated**.
15. Relevant regression results: **Final broad and targeted checks passed**;
    known context case timed out separately.
16. Known context-hardening issue: **Same twenty-second timeout remains**.
17. Constitution unchanged: **Yes**, SHA-256
    `d69f71832ab7c8ba6a827fd2fe988db5f76ff253d727906a95c064fe53408d8e`.
18. Commit/push/merge/PR/public deployment/store submission/payment/campaign/spend:
    **None performed**. No production credentials requested or used.

Creator ownership and product revenue versus operating capital separation are
unchanged. No analytics commercial metric is populated from acceptance fixtures.
Preferred long-term Android plus blocked Android execution remains valid; the
Builder does not rewrite strategy to Web.

The implementation preserves: generated source != working product; compilation !=
runtime; runtime != interaction; interaction != good UX; screenshot != functional
proof; responsive Web != native mobile; APK != accepted Android app; Android != iOS;
debug signing != production signing; store artifact != submission; technical
acceptance != customer validation; customer validation != profitability; simulation
!= real-world evidence.

HEAD: `d8f816881fd24b6f5e3d616e59edec387a447667`.
Branch: `feature/product-factory`. Nothing staged. Working tree remains dirty with
preserved earlier lots: eleven previously tracked modified files, and untracked
`docs/`, `scripts/product-factory/`, `src/__tests__/product-factory/`,
`src/product-factory/`, `src/state/factory-tasks.ts`. The exact Lot 6M contribution
is nine added and fourteen modified files listed above.
