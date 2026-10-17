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

## R4. Publishable

All code and data must be usable if the app is published. No non-commercial or research-only models or assets (SMPL, SMPL-X, STAR, Anny's SMPL-X topology). Keep third-party licence notices in the repo.

## Status
- R1: met for the fixtures in `src/core/fixtures.ts` (`npm test`), within 0.5 cm and usually < 0.1 cm. Definitions still need calibration against real people (see PLAN.md).
- R2: tall (188 cm) average/broad/narrow, petite and plus-size fixtures pass. Implausible proportions are flagged as warnings; measurements that cannot be met are listed, not hidden.
- R4: Anny code is Apache-2.0 and its data CC0; see THIRD_PARTY_NOTICES.md.
