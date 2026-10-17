# Digital Pattern Drafter

Enter ordinary sewing measurements, get a 3D body that matches them (within 0.5 cm, usually much closer), then pull flat pattern panels off it along seams you draw, with ease as a percentage in each direction.

Status: body from measurements works (34 measurements, standard tailor pose). Seam drawing has started (click the body to draw seams, with lengths); panel detection and flattening on the new body are next. See `PLAN.md`.

## Read these first

- `REQUIREMENTS.md`: what must stay true (R1 measurements match, R2 extremes work, R5 tailor pose, R6 no drift).
- `ENGINEERING.md`: how we keep it true (tests, golden snapshots, the procedure for changing the model).
- `PLAN.md`: milestones and known limitations.

## Commands

```bash
npm install
npm run dev          # the app
npm run test:fast    # quick loop
npm run check        # typecheck + all tests + coverage thresholds + build (run before committing)
npm run build && npm run e2e   # real-browser smoke test (set CHROMIUM_PATH if needed)
```

The body model is baked from Anny (Apache-2.0 code, CC0 data) by `tools/bake_body`; see `THIRD_PARTY_NOTICES.md`.
