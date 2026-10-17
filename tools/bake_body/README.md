# Baking the body model

`bake_body.py` turns Anny (https://github.com/naver/anny, Apache-2.0 code, CC0 data) into the small
browser-ready model in `public/body/` (see the docstring for the file layout). The baked output is
committed, so you only need to re-run this when changing the sampling or what gets baked.

```bash
python -m venv venv && . venv/bin/activate
pip install numpy torch anny   # torch CPU is fine
ANNY_CACHE_DIR=./anny_cache python tools/bake_body/bake_body.py --out public/body
```

First run builds Anny's cache (about a minute). Only the default "anny" topology is used; never
the SMPL-X topology (non-commercial).
