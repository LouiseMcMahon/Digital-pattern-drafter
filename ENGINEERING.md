# Engineering standards

The product is a body that measures what the user typed in, and patterns cut from it. A change that quietly moves a measurement by a centimetre produces a wrong pattern with no error message. So the standards below are about one thing: **a change to the model or to a measurement must never be silent, and must always be deliberate.**

Read `REQUIREMENTS.md` first (R1 match the measurements, R2 extremes, R5 tailor pose, R6 no drift). This file says how we keep them true.

## The safety net

| Layer | Where | What it stops |
|---|---|---|
| Unit tests | `slice.test.ts`, `bodyModel.test.ts`, `flatten.test.ts`, `body.test.ts` | Geometry helpers (slicing, arcs, loading, flattening) giving wrong answers on shapes with known answers. |
| Pose tests (R5) | `pose.test.ts` | The tailor pose changing: arm angle, vertical legs, flat feet, bone lengths, symmetry. |
| Measurement invariants | `measure.invariants.test.ts` | A definition changing meaning: scale covariance, `armLength = upper + forearm`, `crotchDepth = waistHeight - insideLeg`, each control moving the measurement it is named for. |
| Smoothness | `measure.smoothness.test.ts` | A measurement that jumps (a ring that switches loop, a path that goes the long way round). The fit is gradient-based and stalls on jumps. This found three real bugs. |
| **Golden snapshots (R6)** | `golden.test.ts`, `__golden__/reference-bodies.json` | **Any drift** in the baked data (SHA-256 of `body.bin`/`body.json`), the pose, any measurement (within 0.005 cm) or the geometry (within 0.01 cm) of eight reference bodies. |
| **Landmark stability** | `measure.stability.test.ts` | A measurement depending on which vertex a search happens to pick. Finds the landmarks on a slightly different mean body (arms 1 degree out, shape shifted 0.1 sd) and requires nothing to move more than 0.3 cm; looser bounds for bigger changes; and no measurement may move more than 0.3 cm per degree of arm swing. Born from the mutation check where a 1 degree pose change moved shoulder width 1.8 cm. |
| **Plausibility** | `plausibility.test.ts`, `fixtures.test.ts` | A measurement that was already wrong when the golden file was generated: golden tests only say "nothing changed". These measure each reference body live and require simple anatomy (proportions of height inside loose human bands, wrist < elbow < upper arm, high bust not above bust, ...) and sane fixtures. They use no golden numbers. |
| Acceptance (R1/R2) | `fit.test.ts`, `fixtures.test.ts` | The fit failing to reproduce entered measurements within 0.5 cm for tall, broad, narrow, petite and plus-size bodies; implausible or contradictory inputs not being flagged; the fixtures themselves being nonsense. |
| End to end | `scripts/e2e-smoke.mjs` (`npm run e2e`) | The real page, in a real browser, failing to fit a 6'2" woman to within 0.5 cm, a blank 3D view (the check reads the canvas back and fails if under 1% of it differs from the background), any console error, or a failed fit leaving the page stuck instead of reporting the error. |
| Coverage ratchet | `vitest.config.ts` | Untested code in `src/core` (90% overall, higher floors on `measure`, `pose`, `slice`, `fit`, `bodyModel`). |
| CI | `.github/workflows/ci.yml` | All of the above on every push and pull request. |

Every guard has been checked by breaking the thing it guards (a 0.1 cm calibration offset, a 0.01 crease threshold, a 1 degree pose angle, one byte of `body.bin`, the body missing from the 3D scene, the worker's error report removed): each one failed. When you add a guard, do the same and say so.

## Commands

| Command | Use |
|---|---|
| `npm run test:fast` | Quick loop while editing (skips the slow fit and golden suites). |
| `npm test` | Everything (about 45 s). |
| `npm run coverage` | Everything plus the coverage thresholds (about 2 min). What CI runs. |
| `npm run check` | Typecheck, coverage, build. **Run before every commit.** |
| `npm run mutate -- <module>` | Mutation testing (Stryker) of one module against its own unit tests: `slice`, `pose`, `flatten`, `bodyModel`, or `all`. Minutes per module; not in CI. Report: `reports/mutation/index.html`. |
| `npm run build && npm run e2e` | Browser smoke test. Set `CHROMIUM_PATH` to use a specific browser. |
| `npm run fixtures:regenerate` | Regenerate `src/core/fixtures.ts` from `fixtureSeeds.ts`. |
| `npm run golden:update` | Rewrite the golden file, keeping the stored fixture-body parameters. Prints a drift report. |
| `npm run golden:refit` | As above, and re-fit the fixture bodies (after the fixtures changed). |

## Mutation testing

Coverage says a line ran; mutation testing says a test would notice if it were wrong. Stryker changes the code one small way at a time (`<` to `<=`, `+` to `-`, a branch removed) and re-runs the tests; a mutant that no test fails on is a *survivor* and points at a missing assertion. It is a tool for finding gaps, not a gate: it is **not in CI** and has no threshold.

- Run `npm run mutate -- slice` (see the table above), then open `reports/mutation/index.html` and read the survivors. A module takes minutes (every mutant is a fresh `vitest` run).
- Each mutant re-runs the selected tests, so `scripts/mutate.mjs` maps each module to the test files that exercise it, and `vitest.mutation.config.ts` leaves out the fit, golden, smoothness and stability suites (minutes each).
- **Read scores with that in mind.** A module's score is against its own unit tests only: `pose.ts` is mostly guarded by the golden and measurement suites, which are excluded, so a low `pose.ts` score is a statement about its unit tests, not about the model's protection.
- **The harness uses Stryker's `command` runner on purpose, and checks itself.** The first setup used `@stryker-mutator/vitest-runner`, and it silently ran *zero tests* for most mutants (`perTest` and `all` coverage both; the runner maps mutants to test ids that Vitest 5 does not find, and it sometimes crashed on init with a circular-JSON error). Mutants that run no tests count as "survived", so the first scores (`slice.ts` 28%, `pose.ts` 3%) were mostly the harness failing, not the tests: of 356 mutants only 137 ran any test, and 120 of those were killed (88%). Nothing in the report said so. So: (1) the config uses `testRunner: "command"` (a plain `vitest run` per mutant, in Stryker's sandbox), (2) `scripts/mutate.mjs` fails the run if the report shows mutants that completed no tests, and (3) when you see a score you do not believe, look at `testsCompleted` in `reports/mutation/mutation.json` before writing tests.
- `stryker.config.json` has `tsconfigFile` pointing at a file that does not exist because Stryker's tsconfig rewrite needs the TypeScript JS API, which TypeScript 7 does not ship. Do not switch on `inPlace`: a killed run leaves the working tree full of instrumented files. The config file is a positional argument (`stryker run <file>`); `-c` is `--concurrency`.

## Rules

1. **No behaviour change without a test that would have failed before it.** Fixing a bug means writing the failing test first. Every bug we found by looking at a picture is now a test: say what the test guards in its comment.
2. **Changing the model needs the procedure below.** "The model" means: the baked data in `public/body/`, the pose (`pose.ts`), a measurement definition or calibration offset (`measure.ts`), or which controls the fit may use (`fit.ts`).
3. **Never edit `reference-bodies.json` or `fixtures.ts` by hand.** Both are generated. Never edit a fixture to make a failing acceptance test pass: if R1 fails, the model or the solver is wrong.
4. **Never loosen a tolerance, threshold or exception to get green** without saying why in the commit message *and* at the line. Tolerances are in cm: measurement golden 0.005, geometry golden 0.01, R1 0.5. Coverage thresholds only ratchet up.
5. **A new measurement is not done until** it has: a one-line definition in the header of `measure.ts` (what is measured, where, in which pose); an entry in `MEASUREMENT_NAMES` and `MEASUREMENT_LABELS`; an invariant or analytic test where one exists; a band in `plausibility.test.ts` if it is a proportion of height; a place in the fixtures (it is picked up automatically) and golden file; passing smoothness; and a look at the overlay in the viewer (`show where each ring is measured`) on a tall body and a plus-size body.
6. **Definitions anchor to tracked vertices or joints, not to searches that run on every evaluation.** Landmarks are found once on the mean body and then followed by vertex id so a measurement moves smoothly. Anything that re-searches each time (an argmax, "nearest loop") needs a smoothness test and a size or sanity filter.
7. **Calibration offsets are estimates until real data replaces them.** They live in `CALIBRATION` (`measure.ts`), each with the reason. Changing one is a model change.
8. **Determinism.** No `Math.random`, wall-clock or unseeded sampling in `src/core` or the baking tool. The bake uses a fixed seed. A test that is flaky is a bug in the test or the code, never retried.
9. **Fixtures are not real people.** They are generated from round seed numbers (`fixtureSeeds.ts`) and labelled so. A seed must describe a body the model can produce and a person could have; `fixtures.test.ts` rejects ones that do not. Tied measurements (arm length, rise) are derived from their rounded parts, never rounded independently. When real measurement sets exist, add them as fixtures and golden bodies; do not delete the generated ones.
10. **Keep documents true.** A change to the pose, a definition or a calibration updates `REQUIREMENTS.md` / `PLAN.md` in the same pull request.
11. **CI must be green on the head of a branch before merge.** No skipped tests to get there (the one `skipIf` is the fixture generator, by design).

## Changing the model (the procedure)

1. Make the code change. Run `npm test`. **Golden tests will fail. That is the point.** Read the failure: it names the body, the measurement, the pinned and the new value.
2. Decide whether every reported change is intended. If something moved that you did not mean to move, you have a bug: fix it rather than updating the golden file.
3. If the fixtures' targets no longer describe a feasible body (R1 fixtures fail), run `npm run fixtures:regenerate`.
4. Run `npm run golden:refit` (or `golden:update` when the fixtures did not change). It rewrites `__golden__/reference-bodies.json` and prints a **drift report**: every measurement that moved by more than 0.005 cm, old to new, and whether the data hash changed.
5. Check the picture. Run the app (or `npm run e2e` and open `e2e-out/`), tick the overlay, and look at the landmarks on a tall and a plus-size body. The shoulder and neck points are now computed from the live surface and are stable, but the other landmarks (bust apex, underarm, crotch, hip level, nape) are still vertices found once on the mean body and can move by up to about a vertex spacing (about 1 cm) when upstream geometry shifts, so numbers alone are not enough.
6. Commit the code and tests, then commit the golden and fixture files **separately** with the message starting `golden:`. Paste the drift report into that commit message, and say which changes are the intended ones. The head of the branch must be green.
7. If a definition's *meaning* changed, update the header of `measure.ts` and `REQUIREMENTS.md`.

## Changing the baked data

Only through `tools/bake_body/bake_body.py` (see its README); never edit `public/body/` by hand. A re-bake is a model change: follow the procedure above and state what changed (sampling, components, controls) and the held-out reconstruction error in the commit message. Keep `THIRD_PARTY_NOTICES.md` accurate.

## Definition of done for a change

- [ ] `npm run check` passes (types, all tests, coverage thresholds, build).
- [ ] New behaviour has tests that failed before the change; a bug fix has its regression test.
- [ ] If the model moved: golden/fixtures regenerated by script, drift report in the commit message, landmarks looked at.
- [ ] No tolerance, threshold or fixture loosened silently.
- [ ] Docs updated if a requirement, definition or calibration changed.

## Known gaps (do not forget)

- **No real-person data yet.** Everything is checked against itself and against published ranges, not against a tape measure on a body. The first real measurement set (see PLAN.md) is the most valuable test we can add; it should become a fixture and a golden body.
- **Some landmarks are still tracked vertices.** The shoulder point and neck point are computed from the live surface (a 1 degree pose change used to move shoulder width 1.8 cm; now 0.0). The bust apex, underarm, crotch, hip level and nape are still vertices chosen once on the mean body; `measure.stability.test.ts` bounds how much that matters (0.3 cm for small upstream changes, 1.5 cm for larger ones, where the underarm genuinely moves with the arm), but replacing them with exact surface points would remove the remaining quantisation.
- **Goldens are checked on one platform.** Tolerances (0.005 cm) are far above floating-point noise, but a different CPU or Node version has not been tried.
- **No performance budget** (a fit takes roughly 5 to 15 s in the browser). If it grows, add a loose timing test.
- **No visual regression test.** `npm run e2e` checks the page works and measures correctly, not that it looks right.
