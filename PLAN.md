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
0. [done] Spike: LSCM unwrap + relaxation toward eased targets, demo page.
1. [done] Body: full torso (front + back) from bust, underbust, waist, hip, chest, neck, shoulder width, bust apex separation/prominence and ring heights. Circumferences are fitted by reading them back off the mesh. Named landmarks (vertex ids). Panels are sub-meshes with boundary loops. Orbit camera in the demo.
2. Seam drawing (next): raycast onto the mesh, snap to landmarks, geodesic/slice paths, stored as face + barycentric so they survive body edits; panel detection from closed seam loops; mesh split along seams.
3. Flattening for arbitrary panels: per-panel grainline, faster/more exact solver (ARAP / Gauss-Newton), distortion heatmap.
4. Fit checks and export: paired seam-length comparison, notches, seam allowance, SVG/DXF/tiled PDF at 1:1.
5. Drape preview (optional): cloth sim of sewn panels on the body.
6. Scan import: PLY/OBJ, non-rigid registration of the template.

## Known limitations
- Body is a ring loft: no arms/armholes, a plain neck stub, and the bust is a Gaussian bump. It is a dress-form stand-in, not an anatomical model. Depth ratios and shoulder shape are guesses to tune against a real form.
- The flattener is flip-free (moves that would flip a triangle are rejected) but approximate. Panels hem-to-bust fit within ~2% edge error, hem-to-shoulder ~4%; including the neck stub (a saddle) gives ~14% and is not meaningful. Seams (princess seams, neckline, armscye) are the intended way to cut those regions apart.
- The relaxation is a slow Gauss-Seidel sweep (about a second per panel at 600 iterations); the demo uses 250 and shows a small kink at the top corner of the front panel.
