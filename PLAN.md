# Digital Pattern Drafter — plan

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
2. [done, see limitations] Body v2: full body (head, neck, arms, hands, legs, feet) baked from Anny (tools/bake_body, public/body, 5 MB; 40 PCA components reproduce sampled adults to ~0.07 mm mean). 21 sewing measurements with one shared definition (src/core/measure.ts) used for fitting, read-back and tests. Levenberg-Marquardt fit (src/core/fit.ts) in a Web Worker; tests in src/core/fit.test.ts cover the R1/R2 fixtures: 6'2" woman (average/broad/narrow), petite, plus size, sparse input, implausible input. Every fixture matches within 0.5 cm (typically < 0.1 cm).
3. Seam drawing (next, on the baked body): raycast onto the mesh, snap to landmarks, geodesic/slice paths, stored as face + barycentric so they survive body edits; panel detection from closed seam loops; mesh split along seams.
4. Flattening for arbitrary panels: per-panel grainline, faster/more exact solver (ARAP / Gauss-Newton), distortion heatmap.
5. Fit checks and export: paired seam-length comparison, notches, seam allowance, SVG/DXF/tiled PDF at 1:1.
6. Drape preview (optional): cloth sim of sewn panels on the body.
7. Scan import: PLY/OBJ, non-rigid registration of the template.

## Known limitations
- Measurement definitions are mine (documented in measure.ts) and have NOT been calibrated against real tape measurements. Real people's numbers (especially shoulder width, underbust, nape-to-waist, front length) may differ systematically from these definitions. Next step: measure a real person and compare.
- Not yet measurable: back width, chest width, armscye depth, crotch depth/rise (sitting), elbow-to-wrist length, separate left/right limbs (L/R are averaged).
- The body is in Anny's rest pose (arms slightly out, A-pose-ish). Posing is not implemented (skinning data is already baked).
- Fixtures are plausible invented measurement sets, not real people. Replace/add real sets as they become available.
- The fit uses only local controls that change size and proportion (FIT_CONTROL in src/core/fit.ts); posture-like morphs are excluded because they hit numbers by distorting the body.
- The earlier ring-loft torso (src/core/body.ts and the flatten tests that use it) is superseded by the baked body and will be removed once flattening runs on the new mesh. The demo page no longer shows panels/ease; that returns with seam drawing.
- Flattening: panels with strong double curvature distort; the flattener is flip-free but approximate.
- A fit takes a few seconds in a worker; the Jacobian is finite-difference.
