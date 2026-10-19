import { describe, expect, it } from 'vitest';
import type { Pt } from './allowance';
import { A4, LETTER, sheetToPdf, tiles } from './exportPdf';
import { sheetToSvg } from './exportSvg';
import { type PieceInput, type Sheet, buildSheet } from './sheet';

/** Two pieces sewn along a 4 cm seam. Margin 2 (allowance 1 + half the 2 cm gap), so the first seam line starts at x = 2 and the second at x = 12. */
const tiny = (): Sheet => buildSheet([
  { name: 'A b', loop: [[0, 0], [6, 0], [6, 4], [0, 4]], sides: [{ seam: 2, vertices: [1, 2], points: [[6, 0], [6, 4]] }] },
  { name: 'B', loop: [[6, 0], [9, 0], [9, 4], [6, 4]], sides: [{ seam: 2, vertices: [2, 1], points: [[6, 4], [6, 0]] }] },
], { allowance: 1, gap: 2 });

const rect = (name: string, w: number, h: number): PieceInput => ({
  name,
  loop: [[0, 0], [w, 0], [w, h], [0, h]],
  sides: [{ seam: 0, vertices: [1, 2], points: [[w, 0], [w, h]] satisfies Pt[] }, { seam: undefined, vertices: [2, 3], points: [[w, h], [0, h]] }],
});
const sheetOf = (...p: PieceInput[]): Sheet => buildSheet(p, { allowance: 1 });
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('sheetToSvg', () => {
  const svg = sheetToSvg(sheetOf(rect('Front <bodice> & "back"', 30, 40)));
  it('is a full-size page: its size in cm equals its coordinates', () => {
    const s = sheetOf(rect('A', 30, 40));
    expect(svg).toContain(`width="${s.width.toFixed(3).replace(/\.?0+$/, '')}cm"`);
    expect(svg).toContain(`viewBox="0 0 ${s.width.toFixed(3).replace(/\.?0+$/, '')} ${s.height.toFixed(3).replace(/\.?0+$/, '')}"`);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });
  it('draws a solid cutting line, a dashed seam line, notches, labels and the scale square', () => {
    expect((svg.match(/<polygon/g) ?? []).length).toBe(2);
    expect(svg).toContain('stroke-dasharray="0.4 0.25"');
    expect(svg).toContain('>1: 40.0<');
    expect(svg).toContain('id="scale-check"');
    expect(svg).toContain('width="5" height="5"');
    expect(svg).toContain('>5 cm<');
  });
  it('draws notches on seams shared by two pieces', () => {
    expect(svg).not.toContain('<line');
    expect((sheetToSvg(sheetOf(rect('A', 30, 40), rect('B', 30, 40))).match(/<line/g) ?? []).length).toBe(4);
  });
  it('escapes names', () => {
    expect(svg).toContain('Front &lt;bodice&gt; &amp; &quot;back&quot;');
    expect(svg).not.toContain('<bodice>');
  });
  it('draws only a solid seam line when there is no allowance', () => {
    const plain = sheetToSvg(buildSheet([rect('A', 30, 40)], { allowance: 0 }));
    expect((plain.match(/<polygon/g) ?? []).length).toBe(1);
    expect(plain).not.toContain('stroke-dasharray');
    expect(plain).toContain('stroke-width="0.05"');
  });
  it('writes one group for each piece', () => {
    expect((sheetToSvg(sheetOf(rect('A', 5, 5), rect('B', 5, 5))).match(/<g id="/g) ?? []).length).toBe(3); // two pieces and the scale check
  });
});

describe('tiles', () => {
  it('needs one page for a small sheet', () => {
    const r = tiles(sheetOf(rect('A', 10, 10)));
    expect(r.tiles).toHaveLength(1);
    expect([r.rows, r.columns]).toEqual([1, 1]);
    expect(r.tiles[0]).toMatchObject({ row: 0, column: 0, x: 0, y: 0, width: A4.width - 3, height: A4.height - 3 });
  });
  it('covers the whole sheet, overlapping neighbours by the overlap', () => {
    const sheet = sheetOf(rect('A', 50, 70));
    const r = tiles(sheet, { overlap: 1 });
    expect(r.columns).toBeGreaterThan(1);
    expect(r.rows).toBeGreaterThan(1);
    const [w, h] = [A4.width - 3, A4.height - 3];
    expect(r.columns).toBe(Math.ceil((sheet.width - 1) / (w - 1)));
    expect(r.rows).toBe(Math.ceil((sheet.height - 1) / (h - 1)));
    const second = r.tiles.find((t) => t.column === 1 && t.row === 0)!;
    expect(second.x).toBe(w - 1);
    expect(r.tiles.find((t) => t.row === 1 && t.column === 0)!.y).toBe(h - 1);
    expect(Math.max(...r.tiles.map((t) => t.x + t.width))).toBeGreaterThanOrEqual(sheet.width);
    expect(Math.max(...r.tiles.map((t) => t.y + t.height))).toBeGreaterThanOrEqual(sheet.height);
  });
  it('leaves out pages that would be blank', () => {
    const wide = sheetOf(rect('A', 10, 10), { ...rect('B', 10, 10) });
    const sheet = { ...wide, pieces: [wide.pieces[0], { ...wide.pieces[1], seamLine: wide.pieces[1].seamLine.map(([x, y]) => [x + 60, y] as Pt), cutLine: undefined }], width: 80 };
    const r = tiles(sheet);
    expect(r.columns).toBeGreaterThan(2);
    expect(r.tiles.length).toBeLessThan(r.rows * r.columns);
    expect(r.tiles.some((t) => t.column === 1 && t.row === 0)).toBe(false);
  });
  it('uses the paper size, margin and overlap given', () => {
    const sheet = sheetOf(rect('A', 50, 70));
    const a4 = tiles(sheet);
    const letter = tiles(sheet, { page: LETTER, margin: 2, overlap: 0.5 });
    expect(letter.tiles[0].width).toBe(LETTER.width - 4);
    expect(letter.tiles[0].height).toBe(LETTER.height - 4);
    expect(letter.columns * letter.rows).not.toBe(a4.columns * a4.rows * 0 + 1);
  });
  it('refuses a page smaller than its margins and overlap', () => {
    expect(() => tiles(sheetOf(rect('A', 5, 5)), { margin: 12 })).toThrow('too small');
    expect(() => tiles(sheetOf(rect('A', 5, 5)), { overlap: 30 })).toThrow('too small');
  });
});

describe('sheetToPdf', () => {
  const sheet = sheetOf(rect('Front', 40, 60));
  const pdf = text(sheetToPdf(sheet));
  const pages = tiles(sheet).tiles.length;
  it('is a PDF with one page for each tile', () => {
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect((pdf.match(/\/Type \/Page /g) ?? []).length).toBe(pages);
    expect(pdf).toContain(`/Count ${pages}`);
    expect(pages).toBeGreaterThan(1);
  });
  it('sets the paper size in points', () => {
    expect(pdf).toContain(`/MediaBox [0 0 ${(A4.width * 72 / 2.54).toFixed(2)} ${(A4.height * 72 / 2.54).toFixed(2)}]`);
    expect(text(sheetToPdf(sheet, { page: LETTER }))).toContain(`/MediaBox [0 0 ${(LETTER.width * 72 / 2.54).toFixed(2)}`);
  });
  it('has a cross-reference table whose offsets point at their objects', () => {
    const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(start, start + 4)).toBe('xref');
    const entries = [...pdf.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries.length).toBe((pdf.match(/ 0 obj\n/g) ?? []).length);
    entries.forEach((offset, i) => expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(pdf).toContain(`/Size ${entries.length + 1}`);
  });
  it('states each stream length correctly', () => {
    for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) expect(m[2].length).toBe(Number(m[1]));
  });
  it('labels every page with its place in the grid and draws crop marks, the clip, the lines and the scale square', () => {
    expect(pdf).toContain('(Page 1-1: row 1 of ');
    expect(pdf).toContain(', column 1 of ');
    expect((pdf.match(/ re W n/g) ?? []).length).toBe(pages);
    expect((pdf.match(/ m \d+\.\d\d \d+\.\d\d l S/g) ?? []).length).toBeGreaterThanOrEqual(4 * pages);
    expect(pdf).toContain('[] 0 d');
    expect(pdf).toContain('(5 cm) Tj');
  });
  it('draws the scale square 5 cm (141.73 points) across', () => {
    expect(pdf).toContain(`${(5 * 72 / 2.54).toFixed(2)} ${(5 * 72 / 2.54).toFixed(2)} re S`);
  });
  it('escapes brackets and backslashes in names, and replaces non-ASCII', () => {
    const odd = text(sheetToPdf(sheetOf(rect('Back (left) \\ é', 5, 5))));
    expect(odd).toContain('(Back \\(left\\) \\\\ ?)');
  });
  it('has a dashed seam line only when there is a cutting line', () => {
    expect(pdf).toMatch(/\[\d+\.\d\d \d+\.\d\d\] 0 d/);
    expect(text(sheetToPdf(buildSheet([rect('A', 5, 5)], { allowance: 0 })))).not.toMatch(/\[\d+\.\d\d \d+\.\d\d\] 0 d/);
  });
  it('is ASCII, so byte offsets are character offsets', () => {
    expect([...sheetToPdf(sheet)].every((b) => b < 128)).toBe(true);
  });
});

describe('exact output for a small pattern', () => {
  it('lays the pieces out on a 17 x 17 cm sheet', () => {
    const s = tiny();
    expect([s.width, s.height]).toEqual([17, 17]);
    expect(s.pieces[0].seamLine).toEqual([[2, 6], [8, 6], [8, 2], [2, 2]]);
    expect(s.pieces[0].cutLine).toEqual([[1, 7], [9, 7], [9, 1], [1, 1]]);
    expect(s.pieces[1].seamLine).toEqual([[12, 6], [15, 6], [15, 2], [12, 2]]);
    expect(s.pieces[0].notches).toEqual([{ from: [8, 4], to: [8.5, 4], seam: 2 }]);
    expect(s.pieces[1].notches).toEqual([{ from: [12, 4], to: [11.5, 4], seam: 2 }]);
    expect(s.pieces[0].labels).toEqual([{ at: [8, 4], text: '3: 4.0' }]);
    expect(s.pieces[0].nameAt).toEqual([5, 4]);
    expect(s.pieces[1].nameAt).toEqual([13.5, 4]);
    expect(s.scaleSquare).toEqual({ x: 2, y: 10, size: 5 });
  });
  it('writes this SVG', () => {
    expect(sheetToSvg(tiny())).toBe([
      '<svg xmlns="http://www.w3.org/2000/svg" width="17cm" height="17cm" viewBox="0 0 17 17" font-family="Helvetica, Arial, sans-serif" font-size="0.6">',
      '<g id="a-b" fill="none" stroke="#000">',
      '<polygon points="1,7 9,7 9,1 1,1" stroke-width="0.05"/>',
      '<polygon points="2,6 8,6 8,2 2,2" stroke-width="0.03" stroke-dasharray="0.4 0.25"/>',
      '<line x1="8" y1="4" x2="8.5" y2="4" stroke-width="0.05"/>',
      '<text x="8" y="4" text-anchor="middle" dominant-baseline="middle" fill="#000" stroke="none">3: 4.0</text>',
      '<text x="5" y="4" text-anchor="middle" font-size="0.96" fill="#000" stroke="none">A b</text>',
      '</g>',
      '<g id="b" fill="none" stroke="#000">',
      '<polygon points="11,7 16,7 16,1 11,1" stroke-width="0.05"/>',
      '<polygon points="12,6 15,6 15,2 12,2" stroke-width="0.03" stroke-dasharray="0.4 0.25"/>',
      '<line x1="12" y1="4" x2="11.5" y2="4" stroke-width="0.05"/>',
      '<text x="12" y="4" text-anchor="middle" dominant-baseline="middle" fill="#000" stroke="none">3: 4.0</text>',
      '<text x="13.5" y="4" text-anchor="middle" font-size="0.96" fill="#000" stroke="none">B</text>',
      '</g>',
      '<g id="scale-check" fill="none" stroke="#000" stroke-width="0.05"><rect x="2" y="10" width="5" height="5"/><text x="7.4" y="12.5" dominant-baseline="middle" fill="#000" stroke="none">5 cm</text></g>',
      '</svg>',
    ].join('\n'));
  });
  it('writes numbers without trailing zeros, with 0 for nothing', () => {
    const s = tiny();
    s.pieces[0].cutLine = [[0.1234, -0.0001], [10, 1.5], [0, 0]];
    expect(sheetToSvg(s)).toContain('points="0.123,0 10,1.5 0,0"');
  });
  it('writes this page content (points, y up, the sheet shifted by the margin)', () => {
    const pdf = text(sheetToPdf(tiny()));
    const content = /stream\n([\s\S]*?)\nendstream/.exec(pdf)![1];
    expect(content).toBe([
      '0 G 0.5 w',
      '28.35 799.37 m 56.69 799.37 l S 42.52 785.20 m 42.52 813.54 l S',
      '538.58 799.37 m 566.93 799.37 l S 552.76 785.20 m 552.76 813.54 l S',
      '28.35 42.52 m 56.69 42.52 l S 42.52 28.35 m 42.52 56.69 l S',
      '538.58 42.52 m 566.93 42.52 l S 552.76 28.35 m 552.76 56.69 l S',
      'BT /F1 9.92 Tf 42.52 21.26 Td (Page 1-1: row 1 of 1, column 1 of 1) Tj ET',
      'q 42.52 42.52 510.24 756.85 re W n',
      '1.42 w [] 0 d 70.87 600.94 m 297.64 600.94 l 297.64 771.02 l 70.87 771.02 l h S',
      '0.85 w [11.34 7.09] 0 d 99.21 629.29 m 269.29 629.29 l 269.29 742.68 l 99.21 742.68 l h S',
      '1.42 w [] 0 d',
      '269.29 685.98 m 283.46 685.98 l S',
      'BT /F1 17.01 Tf 243.78 680.31 Td (3: 4.0) Tj ET',
      'BT /F1 27.21 Tf 163.84 685.98 Td (A b) Tj ET',
      '1.42 w [] 0 d 354.33 600.94 m 496.06 600.94 l 496.06 771.02 l 354.33 771.02 l h S',
      '0.85 w [11.34 7.09] 0 d 382.68 629.29 m 467.72 629.29 l 467.72 742.68 l 382.68 742.68 l h S',
      '1.42 w [] 0 d',
      '382.68 685.98 m 368.50 685.98 l S',
      'BT /F1 17.01 Tf 357.17 680.31 Td (3: 4.0) Tj ET',
      'BT /F1 27.21 Tf 418.39 685.98 Td (B) Tj ET',
      '1.42 w [] 0 d 99.21 374.17 141.73 141.73 re S',
      'BT /F1 17.01 Tf 252.28 439.37 Td (5 cm) Tj ET',
      'Q',
    ].join('\n'));
  });
});
