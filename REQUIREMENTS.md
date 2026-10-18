# Requirements

These are the non-negotiables. If a design or library choice conflicts with one of them, the choice changes, not the requirement.

## R1. The body must match the user's sewing measurements (or very close)

The user types in ordinary sewing measurements and gets a 3D body that reproduces them. Measuring the generated body the way a tailor would must give back the numbers that were entered.

**Acceptance**
- Circumferences (bust, underbust, waist, high hip, hip, neck, upper arm, wrist, thigh, knee, calf, ankle, and so on) read back within **0.5 cm** (and within 0.5%).
- Lengths (height, nape to waist, front waist length, shoulder width, bust point separation, arm length, inseam, and so on) read back within **0.5 cm**.
- If a measurement can't be met, the app says which one and by how much. It never silently returns a body that is "close".
- The measurement code used for fitting is the same code used for read-back and tests, so there is one definition of each measurement.

Measurement list (initial; extend as needed): height; neck; shoulder width; chest width; back width; bust; underbust; waist; high hip; hip; nape to waist (back length); front waist length (shoulder to waist over bust); bust point to bust point; shoulder to bust point; armscye depth; upper arm; elbow; wrist; arm length (shoulder to wrist); shoulder to elbow; thigh; knee; calf; ankle; inseam; outseam; crotch depth / rise.

## R2. It must work for people at the extremes, not just near the average

Pattern making for bodies that off-the-shelf patterns don't fit is a core purpose of the tool. The two first users are **women who are 6'2" (188 cm)**, so tall bodies with long torsos, long limbs and their own proportions are a primary case, not an edge case. Small, large, narrow, broad and asymmetric-ish bodies must also work.

**Consequences for the design**
- The body is driven by **measurements**, not by demographic sliders (age/gender/weight). A base model supplies plausible anatomy; a measurement-driven correction guarantees R1 on top of it, even where the base model's training data is sparse (for example a very tall woman).
- The solver must not clamp to the base model's usual ranges. It extrapolates, and then corrects locally (per-region scaling/deformation) to hit the numbers.
- Plausibility: warn on measurement sets that conflict with each other (for example a 188 cm height with a 35 cm inseam) instead of producing a distorted body.
- Segment lengths (torso, arm, leg) are separate controls, so a tall body is not just a uniformly scaled average one.

**Acceptance**
- Test fixtures include at least: a 188 cm woman, a 188 cm woman with a different build (broader and narrower), a short/petite body, and a plus-size body. Each must meet R1.
- The fixtures live in the repo and run in CI (`npm test`).

## R3. Patterns come from the body, with ease as a percentage

Panels are pulled off the 3D form along seams the user draws. Ease is a plain percentage, horizontal and vertical, positive or negative. Stretch fabrics are handled by choosing negative ease. See PLAN.md.

## R7. A pattern piece must lie flat: no stretching

Most fabrics do not stretch, so a piece that only flattens by being stretched or squeezed is useless: cut in real fabric it will not fit the body. Stretch fabrics are handled by the user's ease percentage (R3), never by hiding distortion.

- A flat piece must match the body: every edge within **0.5%** of its length on the body (times the ease the user asked for). 0.5% is the allowance for the numerics of the flattener; it is not a design margin.
- Seams are never stretched at all: a seam shared by two pieces is the same length on both (within 0.1 cm), so the pieces fit together.
- A curved surface (the bust, the shoulder, a hip) cannot be flattened. When a piece the user has drawn cannot meet the 0.5% limit, the app **says so**: it names the worst stretch, shows where (red = stretched, blue = squeezed, on the body and on the flat piece), and tells the user to add a dart or more seam lines. It does not present the piece as a finished pattern.
- Tests: `flatten.test.ts` (`worstStrain`: developable surfaces within the limit, a sphere patch over it), `panels.integration.test.ts` (shared seams), the browser smoke test (a piece over the bust is reported as unable to lie flat).

## R4. Publishable

All code and data must be usable if the app is published. No non-commercial or research-only models or assets (SMPL, SMPL-X, STAR, Anny's SMPL-X topology). Keep third-party licence notices in the repo.

## R5. Everything is measured and shown in the standard tailor pose

Measurements are only comparable between people, and with a tape measure, if the body stands the same way. The body model's native rest pose (arms out and forward, elbows bent, legs splayed) is **not** used for anything the user sees or any measurement. The default pose of the body everywhere (viewer, measurements, fitting, flattening, seam drawing) is the **standard tailor pose**:

- Standing upright, weight even, looking straight ahead (head level).
- **Arms are held out from the sides, straight at the elbow, 45 degrees from vertical (an A-pose), in the coronal plane**, so there is clear air under the arm and the underarm and armscye can be measured. Hands hang naturally (palms toward the body).
- **Legs vertical and straight** (thigh and shank both vertical), feet hip-width apart, as wide as the hips stand. Feet flat on the floor.
- Soles on y = 0.

The pose is defined in one place (`src/core/pose.ts`, `TAILOR_POSE` and `TailorPoseRig`) and applied inside `BodyModel.evaluate`. `evaluate(..., { pose: 'rest' })` still gives the native rest pose for debugging and for the baking tool, but nothing user-facing may use it.

**Acceptance (tested in `src/core/pose.test.ts`)**
- Upper arm and forearm directions are within 0.5 degrees of 45 degrees from vertical, in the coronal plane, for every body in the fixtures.
- Thigh and shank are within 0.5 degrees of vertical.
- The soles are on y = 0 and the feet keep their flat orientation (toes and ankle heights unchanged by the pose).
- Posing does not change bone lengths (shoulder-to-elbow, elbow-to-wrist, hip-to-knee, knee-to-ankle) by more than 0.1 cm.
- The posed body is left/right symmetric when the parameters are symmetric.
- Measurement definitions are taken in this pose; a change to the pose is a change to every measurement, and must update the golden files (R6).

## R6. Measurements must not drift

A change to the baked body, the pose, a measurement definition, a calibration offset or the fit must never silently change what a body measures. Golden snapshots (all measurements of eight reference bodies within 0.005 cm, geometry within 0.01 cm, SHA-256 of the baked data), pose tests, measurement invariants, a smoothness scan and the R1/R2 acceptance fixtures enforce this. `ENGINEERING.md` says how they are updated: deliberately, by script, with a drift report, in a separate commit.

## Status
- R1: met for the fixtures in `src/core/fixtures.ts` (`npm test`), within 0.5 cm and usually < 0.1 cm. Definitions still need calibration against real people (see PLAN.md).
- R2: tall (188 cm) average/broad/narrow, petite and plus-size fixtures pass. Implausible proportions are flagged as warnings; measurements that cannot be met are listed, not hidden.
- Measurement set: now 34 measurements including armscye depth, high bust, across back, across chest, shoulder length, shoulder to bust point, bust point height, waist to hip, crotch depth and length, shoulder to elbow, elbow to wrist and underarm to wrist. Conflicting inputs (arm length vs its two segments; crotch depth vs waist height minus inside leg) are flagged.
- R7: implemented. `flatten()` reports `worstStrain` (98th percentile of edge stretch, limit `FLATTEN_TOLERANCE` = 0.5%) and a per-vertex strain; the viewer warns and shows the strain map for a piece over the limit. Not yet: suggesting where a dart or seam would fix it.
- R5: implemented (`src/core/pose.ts`), default for all evaluation.
- R6: golden measurement snapshots, pinned body-data hash, pose and measurement invariants, see ENGINEERING.md.
- R4: Anny code is Apache-2.0 and its data CC0; see THIRD_PARTY_NOTICES.md.
