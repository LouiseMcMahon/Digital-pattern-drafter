# Digital Pattern Drafter — plan

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
0. [done] Spike: procedural torso, LSCM unwrap + edge-length relaxation toward eased targets, demo page.
1. Seam drawing (priority): raycast onto the mesh, snap to landmarks, geodesic/slice paths, stored as face + barycentric so they survive body edits; panel detection from closed seam loops; mesh split along seams.
2. Body: full torso (front + back), more landmarks/measurements (shoulder, neck, bust apex, back length), measurement read-back from the generated mesh. Needed before princess-seam panels make sense on a realistic form.
3. Flattening for arbitrary panels: per-panel grainline, better solver than Gauss-Seidel (ARAP / Gauss-Newton), distortion heatmap.
4. Fit checks and export: paired seam-length comparison, notches, seam allowance, SVG/DXF/tiled PDF at 1:1.
5. Drape preview (optional): cloth sim of sewn panels on the body.
6. Scan import: PLY/OBJ, non-rigid registration of the template.

## Known limitations
- Panels with strong double curvature (e.g. a bust) distort when flattened; seam placement (princess seams) is the intended answer.
- Edge-length relaxation is approximate (reports RMS error).
