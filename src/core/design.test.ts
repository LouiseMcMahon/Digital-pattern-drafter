import { describe, expect, it } from 'vitest';
import { type Design, DESIGN_VERSION, cloneDesign, parseDesign, serializeDesign } from './design';

const design = (): Design => ({
  seams: [
    { points: [{ tri: 0, bary: [1, 0, 0] }, { tri: 3, bary: [0.2, 0.3, 0.5] }, { tri: 9, bary: [0, 0.5, 0.5] }], closed: true },
    { points: [{ tri: 4, bary: [0.25, 0.25, 0.5] }], closed: false },
  ],
  panels: [{ seed: { tri: 2, bary: [0.1, 0.2, 0.7] }, horizontal: -5, vertical: 2.5 }],
});
const N = 10;
const text = (mutate?: (o: any) => void) => {
  const o = JSON.parse(serializeDesign(design(), N));
  mutate?.(o);
  return JSON.stringify(o);
};

describe('cloneDesign', () => {
  it('copies everything and shares nothing', () => {
    const d = design();
    const c = cloneDesign(d);
    expect(c).toEqual(d);
    c.seams[0].points[0].bary[0] = 0.5;
    c.seams[0].points.pop();
    c.seams[0].closed = false;
    c.panels[0].seed.tri = 7;
    c.panels[0].horizontal = 1;
    c.panels[0].vertical = 1;
    expect(d).toEqual(design());
  });
});

describe('serializeDesign and parseDesign', () => {
  it('round-trips seams and panels exactly', () => {
    expect(parseDesign(serializeDesign(design(), N), N)).toEqual(design());
  });
  it('round-trips an empty design', () => {
    expect(parseDesign(serializeDesign({ seams: [], panels: [] }, N), N)).toEqual({ seams: [], panels: [] });
  });
  it('writes the format, version and mesh size', () => {
    const o = JSON.parse(serializeDesign(design(), N));
    expect(o.format).toBe('digital-pattern-drafter-design');
    expect(o.version).toBe(DESIGN_VERSION);
    expect(o.triangleCount).toBe(N);
  });
  it('does not save anything but the design (no hidden references to the live objects)', () => {
    const d = design();
    const o = JSON.parse(serializeDesign(d, N));
    expect(Object.keys(o).sort()).toEqual(['format', 'panels', 'seams', 'triangleCount', 'version']);
    expect(o.seams[0].points[0]).toEqual({ tri: 0, bary: [1, 0, 0] });
  });
  it('accepts weights that are off by rounding in a saved file', () => {
    const o = (v: number) => text((x) => { x.seams[1].points[0].bary = [0.25 + v, 0.25, 0.5]; });
    expect(() => parseDesign(o(5e-7), N)).not.toThrow();
    expect(() => parseDesign(o(2e-6), N)).toThrow(/add up to 1/);
    expect(() => parseDesign(text((x) => { x.seams[1].points[0].bary = [-5e-7, 0.5, 0.5000005]; }), N)).not.toThrow();
    expect(() => parseDesign(text((x) => { x.seams[1].points[0].bary = [-2e-6, 0.5, 0.500002]; }), N)).toThrow(/invalid weights/);
  });

  const bad: [string, string, RegExp][] = [
    ['text that is not JSON', 'nope {', /not valid JSON/],
    ['JSON null', 'null', /not a design saved by this app/],
    ['a JSON number', '7', /not a design saved by this app/],
    ['a different format', text((o) => { o.format = 'something-else'; }), /not a design saved by this app/],
    ['another version', text((o) => { o.version = 2; }), /version 2/],
    ['another mesh', text((o) => { o.triangleCount = N + 1; }), /different body mesh/],
    ['no seams list', text((o) => { delete o.seams; }), /no seams or panels list/],
    ['no panels list', text((o) => { delete o.panels; }), /no seams or panels list/],
    ['a seam that is not an object', text((o) => { o.seams[0] = 5; }), /seam 1 has no points/],
    ['a null seam', text((o) => { o.seams[0] = null; }), /seam 1 has no points/],
    ['a seam without points', text((o) => { delete o.seams[1].points; }), /seam 2 has no points/],
    ['a seam without closed', text((o) => { delete o.seams[0].closed; }), /seam 1 does not say/],
    ['a closed seam with two points', text((o) => { o.seams[0].points.pop(); }), /closed but has fewer than 3/],
    ['a point that is not an object', text((o) => { o.seams[0].points[1] = 'x'; }), /seam 1 point 2 is not a point/],
    ['a null point', text((o) => { o.seams[0].points[1] = null; }), /seam 1 point 2 is not a point/],
    ['a triangle that is too high', text((o) => { o.seams[0].points[2].tri = N; }), /seam 1 point 3 is on a triangle the body does not have/],
    ['a negative triangle', text((o) => { o.seams[0].points[2].tri = -1; }), /triangle the body does not have/],
    ['a fractional triangle', text((o) => { o.seams[0].points[2].tri = 1.5; }), /triangle the body does not have/],
    ['a triangle that is text', text((o) => { o.seams[0].points[2].tri = '1'; }), /triangle the body does not have/],
    ['weights that are not a list', text((o) => { o.seams[0].points[0].bary = 1; }), /invalid weights/],
    ['two weights', text((o) => { o.seams[0].points[0].bary = [0.5, 0.5]; }), /invalid weights/],
    ['four weights', text((o) => { o.seams[0].points[0].bary = [0.25, 0.25, 0.25, 0.25]; }), /invalid weights/],
    ['a weight that is text', text((o) => { o.seams[0].points[0].bary = ['1', 0, 0]; }), /invalid weights/],
    ['a NaN weight', '{"format":"digital-pattern-drafter-design","version":1,"triangleCount":10,"seams":[{"closed":false,"points":[{"tri":0,"bary":[1,0,null]}]}],"panels":[]}', /invalid weights/],
    ['a negative weight', text((o) => { o.seams[0].points[0].bary = [1.5, -0.5, 0]; }), /invalid weights/],
    ['weights that do not sum to 1', text((o) => { o.seams[0].points[0].bary = [0.5, 0.2, 0.2]; }), /add up to 1/],
    ['a panel that is not an object', text((o) => { o.panels[0] = 3; }), /panel 1 is not an object/],
    ['a null panel', text((o) => { o.panels[0] = null; }), /panel 1 is not an object/],
    ['a panel without horizontal ease', text((o) => { delete o.panels[0].horizontal; }), /panel 1 has no valid ease/],
    ['a panel without vertical ease', text((o) => { delete o.panels[0].vertical; }), /panel 1 has no valid ease/],
    ['ease that is text', text((o) => { o.panels[0].vertical = '2'; }), /no valid ease/],
    ['a panel seed off the mesh', text((o) => { o.panels[0].seed.tri = 99; }), /panel 1 seed is on a triangle/],
  ];
  it.each(bad)('rejects %s, saying what is wrong', (_, input, message) => {
    expect(() => parseDesign(input, N)).toThrow(message);
    expect(() => parseDesign(input, N)).toThrow(/^Not a usable design file: /);
  });

  it('rejects infinite ease (JSON cannot hold it, so a huge number stands in)', () => {
    expect(() => parseDesign(text().replace('"horizontal":-5', '"horizontal":1e999'), N)).toThrow(/no valid ease/);
  });
});

describe('hanging panels', () => {
  const withHang = (): Design => ({ ...design(), panels: [{ ...design().panels[0], hang: { seam: 1, length: 60, flare: 30 } }] });
  it('are copied, saved and read back', () => {
    const d = withHang();
    const c = cloneDesign(d);
    expect(c).toEqual(d);
    c.panels[0].hang!.length = 5;
    expect(d.panels[0].hang!.length).toBe(60);
    expect(parseDesign(serializeDesign(d, N), N)).toEqual(d);
  });
  it('are refused when the seam, length or flare is unusable', () => {
    const bad = (hang: unknown) => text((x) => { x.panels[0].hang = hang; });
    expect(() => parseDesign(bad({ seam: 2, length: 60, flare: 0 }), N)).toThrow(/seam that does not exist/);
    expect(() => parseDesign(bad({ seam: -1, length: 60, flare: 0 }), N)).toThrow(/seam that does not exist/);
    expect(() => parseDesign(bad(null), N)).toThrow(/seam that does not exist/);
    expect(() => parseDesign(bad({ seam: 0, length: 0, flare: 0 }), N)).toThrow(/valid length or flare/);
    expect(() => parseDesign(bad({ seam: 0, length: 5, flare: 'x' }), N)).toThrow(/valid length or flare/);
    expect(() => parseDesign(bad({ seam: 0, length: 5, flare: 0 }), N)).not.toThrow();
    expect(() => parseDesign(bad({ seam: 0, length: 5, flare: 0, fitted: 'yes' }), N)).toThrow(/whether it is fitted/);
    expect(parseDesign(bad({ seam: 0, length: 5, flare: 0, fitted: true }), N).panels[0].hang!.fitted).toBe(true);
  });
});
