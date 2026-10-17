# Digital Pattern Drafter — plan

Standing rules: REQUIREMENTS.md (R1 measurements match, R2 extremes, R5 standard tailor pose, R6 no drift) and ENGINEERING.md (test layers, golden snapshots, procedure for changing the model).

See REQUIREMENTS.md for the non-negotiables. In particular: the body must match entered sewing measurements within 0.5 cm, including for extreme bodies (first users are 6'2" women).

A web app: enter measurements (later: a 3D scan) → get a 3D body → draw seam
lines on it → get flat sewing patterns with horizontal and vertical ease,
positive or negative, including stretch fabrics (knit, lycra, latex).

## Decisions
- Web app, TypeScript, three.js, Vite, Vitest. Geometry core is plain TS in `src/core` (no DOM) so it can move to a worker/WASM later.
- First garment: bodice.
- Stretch fabrics are supported just by using negative ease. No fabric profiles: the user chooses the percentage.
- Scope: pull panels off a dress form (e.g. princess-seam bodices), not a full design tool. No darts; shaping comes from seam placement.
- Personal tool that may be published: no SMPL/SMPL-X (non-commercial). Body is a procedural loft built from tape measurements; scan import later registers this same template.

## How ease works
Ease is a percentage applied to the body's own lengths when flattening, independently along horizontal (weft) and vertical (warp):
- scale = 1 + percent / 100, so +5 = 5% larger, -10 = 10% smaller (negative ease for stretch fabric)
- horizontal ease is a smooth field interpolated between knots (bust/waist/hip heights); vertical is a single % for now
- "horizontal/vertical" are weft/warp; per-panel grainline rotates the frame (not yet built)

## Milestones
0. [done] Spike: LSCM unwrap + relaxation toward eased targets, demo page.
1. [done] Body: full torso (front + back) from bust, underbust, waist, hip, chest, neck, shoulder width, bust apex separation/prominence and ring heights. Circumferences are fitted by reading them back off the mesh. Named landmarks (vertex ids). Panels are sub-meshes with boundary loops. Orbit camera in the demo.
2. [done, see limitations] Body v2: full body (head, neck, arms, hands, legs, feet) baked from Anny (tools/bake_body, public/body, 5 MB; 40 PCA components reproduce sampled adults to ~0.07 mm mean). 34 sewing measurements (incl. armscye depth, high bust, across back/chest, shoulder length, shoulder to bust, bust height, waist to hip, crotch depth/length, arm segments) with one shared definition (src/core/measure.ts) used for fitting, read-back and tests. Levenberg-Marquardt fit (src/core/fit.ts) in a Web Worker; tests in src/core/fit.test.ts cover the R1/R2 fixtures: 6'2" woman (average/broad/narrow), petite, plus size, sparse input, implausible input. Every fixture matches within 0.5 cm (typically < 0.1 cm).
3. Seam drawing (next, on the baked body): raycast onto the mesh, snap to landmarks, geodesic/slice paths, stored as face + barycentric so they survive body edits; panel detection from closed seam loops; mesh split along seams.
4. Flattening for arbitrary panels: per-panel grainline, faster/more exact solver (ARAP / Gauss-Newton), distortion heatmap.
5. Fit checks and export: paired seam-length comparison, notches, seam allowance, SVG/DXF/tiled PDF at 1:1.
6. Drape preview (optional): cloth sim of sewn panels on the body.
7. Scan import: PLY/OBJ, non-rigid registration of the template.

## Known limitations
- Measurement definitions are mine (documented in measure.ts) and have NOT been calibrated against real tape measurements. Two known proxies: across back/chest use the arm skinning weight at 0.8 (CREASE_WEIGHT), chosen so an average woman lands in published ranges; armscye depth carries a +4 cm CALIBRATION estimated from published means (the mesh underarm is higher than a tailor's ruler level). Real people's numbers (especially shoulder width, underbust, nape-to-waist, front length) may differ systematically from these definitions. Next step: measure a real person and compare.
- Not yet measurable: armscye circumference (the mesh has no arm/torso boundary line to measure around), sitting crotch depth, outseam along the surface, back/front neck drop, and separate left/right limbs (L/R are averaged).
- The tailor pose (R5) is arms 10 degrees from vertical with straight elbows, vertical legs and flat feet; head and spine are left as the model has them. Other poses (seated, arms raised for sleeve checks) are not implemented.
- Fixtures are plausible invented measurement sets, not real people. Replace/add real sets as they become available.
- The fit uses only local controls that change size and proportion (FIT_CONTROL in src/core/fit.ts); posture-like morphs are excluded because they hit numbers by distorting the body.
- The earlier ring-loft torso (src/core/body.ts and the flatten tests that use it) is superseded by the baked body and will be removed once flattening runs on the new mesh. The demo page no longer shows panels/ease; that returns with seam drawing.
- Flattening: panels with strong double curvature distort; the flattener is flip-free but approximate.
- A fit takes a few seconds in a worker; the Jacobian is finite-difference.
- Landmark detection (shoulder point, neck point, axilla, ...) runs once on the mean body and can move by 1-2 cm when the upstream geometry shifts slightly. Golden tests catch it; see ENGINEERING.md.
- No real-person measurement data yet: everything is checked against published ranges and against itself.
- High bust vs bust: in this model the chest above the breast is nearly as wide as at the apex, so an average woman's high bust is only ~2 cm under her bust (published data: 5-7 cm). Entering a large bust/high-bust difference may leave one of the two unmet. Needs real-person data to confirm and then a better breast/chest shape or ring height.
- Underbust is defined as a fixed fraction below the bust apex. On a large, overhanging bust the plane can slip into the lower breast and the girth jumps (seen: 109 -> 125 cm at an extreme control value). A definition that finds the inframammary fold would be better; it needs real data to validate.
- Arms hang a fixed 10 degrees from vertical. On wide bodies the arms can touch or pass through the trunk at the waist and hip, which merges loops in the ring slices; the trunk-ring code falls back to a torso-only slice when that happens. A pose that guarantees clearance (angle chosen per body) would be more robust.
