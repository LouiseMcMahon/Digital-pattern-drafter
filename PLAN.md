# Digital Pattern Drafter — plan

A web app: enter measurements (later: a 3D scan) → get a 3D body → draw seam
lines on it → get flat sewing patterns with horizontal and vertical ease,
positive or negative, including stretch fabrics (knit, lycra, latex).

## Decisions
- Web app, TypeScript, three.js, Vite, Vitest. Geometry core is plain TS in `src/core` (no DOM) so it can move to a worker/WASM later.
- First garment: bodice.
- Fabrics: woven and stretch. Each fabric has max stretch along weft (horizontal) and warp (vertical).
- Personal tool that may be published: no SMPL/SMPL-X (non-commercial). Body is a procedural loft built from tape measurements; scan import later registers this same template.

## How ease works
Ease is a target scale on the body's own lengths when flattening:
- horizontal scale = (C + e) / C, e = total circumference ease (cm), C = body circumference there
- vertical scale   = 1 + fraction of length
- scale < 1 = negative ease; fabric must stretch by 1/scale − 1 (checked against the fabric profile)
- ease is a smooth field interpolated between knots (bust/waist/hip heights), not one global number
- "horizontal/vertical" are weft/warp; per-panel grainline rotates the frame (not yet built)

## Milestones
0. [done] Spike: procedural torso, LSCM unwrap + edge-length relaxation toward eased targets, stretch-demand check vs fabric, demo page.
1. Body: more landmarks/measurements (shoulder, neck, bust apex, back length), full torso (front + back), asymmetric/shaped cross-sections, measurement read-back (verify tape measurements on the generated mesh).
2. Seam drawing: raycast onto the mesh, snap to landmarks, geodesic/slice paths, stored as face + barycentric so they survive body edits; panel detection from closed seam loops; mesh split along seams.
3. Flattening for arbitrary panels: grainline per panel, darts (wedges that absorb curvature; auto-suggest), better solver than Gauss-Seidel (ARAP / Gauss-Newton), distortion heatmap.
4. Fit checks: paired seam-length comparison (ease-in), notches, seam allowance, SVG/DXF/tiled PDF export at 1:1.
5. Drape preview: cloth sim (XPBD) of sewn panels on the body.
6. Scan import: PLY/OBJ, non-rigid registration of the template.

## Known limitations of the spike
- Single front panel, no darts: waist/hip shaping shows up as stretch demand and wavy edges. Darts (M3) are the fix.
- Ease is applied only in the weft/warp frame derived from the up axis; no bias grain.
- Edge-length relaxation is approximate (reports RMS error); fine for a spike.
