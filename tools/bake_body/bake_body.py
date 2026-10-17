"""Bake a compact, browser-ready body model from Anny (https://github.com/naver/anny).

Anny: code Apache-2.0, data CC0 (MakeHuman/MPFB2 assets). We use only the default
"anny" topology, never the non-commercial SMPL-X topology.

Output (public/body/):
  body.json  manifest (offsets into body.bin, labels, skeleton)
  body.bin   little-endian binary blocks:
    mean            float32  (V+J)*3          mean shape: V vertices then J joint heads
    pcaScale        float32  K                per-component int16 scale
    pcaStd          float32  K                std of each component's coefficient
    pca             int16    K*(V+J)*3        components (value = int16 * scale)
    faces           uint16   F*3
    local changes   per label: idx uint16 n, delta int16 n*3 (value = int16 * scale)
    skin            uint8 idx V*S, uint8 weights V*S (weights/255, renormalise on load)

Coordinates are converted to the app frame: cm, x = wearer's left, y up, z front
(Anny: metres, z up, front = -y).

Run:  ANNY_CACHE_DIR=... python bake_body.py --out ../../public/body [--samples 2500 --components 40]
Needs: torch, numpy, and `anny` (pip install anny).
"""
import argparse, json, struct
import numpy as np
import torch
import anny
import anny.skinning.skinning as sk

FACE_PARTS = ("cheek", "chin", "ear", "eyebrows", "eye", "forehead", "mouth", "nose", "head", "hand", "foot")


def to_app(p):  # (..., 3) anny metres -> app cm
    return np.stack([p[..., 0], p[..., 2], -p[..., 1]], axis=-1) * 100.0


def part_of(label):
    parts = label.split("-")
    return parts[1] if parts[0] in ("l", "r") else parts[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--samples", type=int, default=2500)
    ap.add_argument("--components", type=int, default=40)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    model = anny.Anny(phenotypes="all", local_changes="default").to(dtype=torch.float32)
    PL, LL = model.phenotype_labels, model.local_change_labels
    V = model.template_vertices.shape[0]
    J = model.bone_count

    def coeffs(ph, lc=None):
        p = torch.tensor(ph, dtype=torch.float32)
        l = torch.zeros(p.shape[0], len(LL))
        for k, v in (lc or {}).items():
            l[:, LL.index(k)] = v
        f = torch.zeros(p.shape[0], len(model.facial_action_labels))
        return model._get_phenotype_blendshape_coefficients(p, l, f)

    def shape(c):
        v = model.get_rest_vertices(c)
        h = sk.apply_linear_blendshape(model.template_bone_heads, model.bone_heads_blendshapes, c)
        return torch.cat([v, h], dim=1).numpy()  # (B, V+J, 3), anny metres

    def sample_params(n):
        cols = {
            "gender": rng.uniform(0, 1, n),
            "age": rng.uniform(0.75, 0.95, n),  # adults
            "muscle": rng.uniform(0, 1, n),
            "weight": rng.uniform(0, 1, n),
            "height": rng.uniform(0.1, 0.9, n),  # ~133-220 cm
            "proportions": rng.uniform(0, 1, n),
            "cupsize": rng.uniform(0, 1, n),
            "firmness": rng.uniform(0, 1, n),
            "african": rng.uniform(0, 1, n),
            "asian": rng.uniform(0, 1, n),
            "caucasian": rng.uniform(0, 1, n),
        }
        return np.stack([cols[k] for k in PL], axis=1)

    def sample_shapes(n, batch=50):
        out = []
        P = sample_params(n)
        for i in range(0, n, batch):
            out.append(to_app(shape(coeffs(P[i : i + batch]))))
        return np.concatenate(out).astype(np.float32)

    print("sampling", args.samples)
    X = sample_shapes(args.samples).reshape(args.samples, -1)
    mean = X.mean(0)
    Xc = X - mean
    G = (Xc.astype(np.float64) @ Xc.T.astype(np.float64))
    w, U = np.linalg.eigh(G)
    order = np.argsort(w)[::-1][: args.components]
    w, U = w[order], U[:, order]
    comps = (Xc.T.astype(np.float64) @ U) / np.sqrt(np.maximum(w, 1e-12))  # (D, K) unit-norm
    comps = comps.T.astype(np.float32)  # (K, D)
    std = np.sqrt(w / (args.samples - 1)).astype(np.float32)  # coefficient std if coeff = comps @ x
    # Use coefficients in units of std: shape = mean + sum(z_k * std_k * comp_k)
    # Held-out reconstruction error.
    T = sample_shapes(300).reshape(300, -1)
    z = (T - mean) @ comps.T
    rec = mean + z @ comps
    err = np.linalg.norm((rec - T).reshape(300, -1, 3)[:, :V], axis=-1) * 10  # mm
    print(f"K={args.components} held-out vertex error mm: mean {err.mean():.2f} p95 {np.percentile(err,95):.2f} max {err.max():.2f}")
    coef_std_held = z.std(0)

    # Presets: PCA coefficients (in std units) of typical bodies, so the fit's prior is a woman or a
    # man rather than the mixed-gender mean.
    def preset(gender):
        ph = [[{"gender": gender, "age": 0.8}.get(k, 0.5) for k in PL]]
        t = to_app(shape(coeffs(ph))).reshape(1, -1)
        return ((t - mean) @ comps.T)[0] / std

    presets = {"female": preset(1.0).tolist(), "male": preset(0.0).tolist(), "neutral": [0.0] * args.components}

    # Local changes: exact, linear, symmetric -> one delta each at +1.
    base = to_app(shape(coeffs([[0.5] * len(PL)])))[0]
    labels, deltas = [], []
    for lab in LL:
        if part_of(lab) in FACE_PARTS:
            continue
        d = to_app(shape(coeffs([[0.5] * len(PL)], {lab: 1.0})))[0] - base
        nz = np.nonzero(np.abs(d).max(axis=1) > 1e-4)[0]
        if len(nz) == 0:
            continue
        labels.append(lab)
        deltas.append((nz.astype(np.uint16), d[nz]))
    print("local changes kept:", len(labels))

    # Skinning (for posing later): top S influences are already sorted by Anny; keep all 9.
    S = model.vertex_bone_indices.shape[1]
    sidx = model.vertex_bone_indices.numpy().astype(np.uint8)
    sw = (model.vertex_bone_weights.numpy() * 255).round().astype(np.uint8)
    faces = model.faces.numpy().astype(np.uint16)

    # Anny's own waist loop (46 vertices of the base mesh), mapped to our vertex ids.
    from anny.anthropometry import BASE_MESH_WAIST_VERTICES
    base_idx = model.base_mesh_vertex_indices.tolist()
    waist_vertices = [base_idx.index(i) for i in BASE_MESH_WAIST_VERTICES]

    blocks, manifest, pos = [], {}, 0

    def add(name, arr):
        nonlocal pos
        b = np.ascontiguousarray(arr).tobytes()
        manifest[name] = {"offset": pos, "bytes": len(b), "dtype": str(arr.dtype), "shape": list(arr.shape)}
        blocks.append(b)
        pos += len(b)

    add("mean", mean.astype(np.float32))
    pscale = (np.abs(comps).max(axis=1) / 32767).astype(np.float32)
    add("pcaScale", pscale)
    add("pcaStd", std.astype(np.float32))
    add("pca", np.round(comps / pscale[:, None]).astype(np.int16))
    add("faces", faces.reshape(-1))
    lc_meta = []
    for lab, (idx, d) in zip(labels, deltas):
        sc = float(np.abs(d).max() / 32767)
        q = np.round(d / sc).astype(np.int16)
        lc_meta.append({"label": lab, "n": int(len(idx)), "scale": sc})
        add(f"lc.idx.{lab}", idx)
        add(f"lc.d.{lab}", q.reshape(-1))
    add("skinIdx", sidx.reshape(-1))
    add("skinW", sw.reshape(-1))

    out = args.out.rstrip("/")
    with open(f"{out}/body.bin", "wb") as f:
        for b in blocks:
            f.write(b)
    meta = {
        "source": "Anny 0.6 (NAVER, Apache-2.0) with CC0 MakeHuman assets",
        "units": "cm",
        "axes": "x = wearer's left, y = up, z = front",
        "vertexCount": V,
        "jointCount": J,
        "faceCount": int(faces.shape[0]),
        "components": args.components,
        "coefficientStdHeldOut": [float(x) for x in coef_std_held],
        "skinInfluences": S,
        "boneLabels": list(model.bone_labels),
        "boneParents": [int(x) if x is not None else -1 for x in model.bone_parents],
        "presets": presets,
        "localChanges": lc_meta,
        "waistVertices": waist_vertices,
        "blocks": manifest,
        "reconstructionErrorMm": {"mean": float(err.mean()), "p95": float(np.percentile(err, 95)), "max": float(err.max())},
    }
    with open(f"{out}/body.json", "w") as f:
        json.dump(meta, f)
    print("wrote", out, pos / 1e6, "MB")


if __name__ == "__main__":
    main()
