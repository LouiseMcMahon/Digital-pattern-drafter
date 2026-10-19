import type { Pt } from './allowance';
import { LABEL_SIZE, LINE, SEAM_DASH } from './exportSvg';
import type { Sheet } from './sheet';

const CM = 72 / 2.54; // PDF units (points) per cm
export const A4 = { width: 21, height: 29.7 };
export const LETTER = { width: 21.59, height: 27.94 };

export interface PdfOptions {
  /** Paper size (cm). */
  page?: { width: number; height: number };
  /** Blank border on every page (cm), where the page label goes. */
  margin?: number;
  /** How much neighbouring pages repeat of each other (cm), so they can be lined up and taped. */
  overlap?: number;
}

/** One printed page: which part of the sheet it shows. */
export interface Tile { row: number; column: number; x: number; y: number; width: number; height: number }

/** The pages needed to print the sheet at full size, row by row. Pages that would be blank are left out. */
export function tiles(sheet: Sheet, options: PdfOptions = {}): { tiles: Tile[]; rows: number; columns: number } {
  const { page = A4, margin = 1.5, overlap = 1 } = options;
  const [w, h] = [page.width - 2 * margin, page.height - 2 * margin];
  if (!(w > overlap) || !(h > overlap)) throw new Error('The page is too small for that margin and overlap.');
  const [columns, rows] = [Math.max(1, Math.ceil((sheet.width - overlap) / (w - overlap))), Math.max(1, Math.ceil((sheet.height - overlap) / (h - overlap)))];
  const boxes = [
    ...sheet.pieces.map((p) => bounds(p.cutLine ?? p.seamLine)),
    { x0: sheet.scaleSquare.x, y0: sheet.scaleSquare.y, x1: sheet.scaleSquare.x + sheet.scaleSquare.size + 3, y1: sheet.scaleSquare.y + sheet.scaleSquare.size },
  ];
  const out: Tile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const t = { row, column, x: column * (w - overlap), y: row * (h - overlap), width: w, height: h };
      if (boxes.some((b) => b.x0 < t.x + w && b.x1 > t.x && b.y0 < t.y + h && b.y1 > t.y)) out.push(t);
    }
  }
  return { tiles: out, rows, columns };
}
const bounds = (p: readonly Pt[]) => ({ x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) });

const n = (v: number): string => v.toFixed(2);
const ascii = (s: string): string => s.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, (c) => `\\${c}`);

/**
 * The sheet as a PDF of pages to print at 100% and tape together: each page shows one part of the sheet at full size with
 * crop marks at the corners of the printable area, neighbouring pages overlapping by `overlap` cm, and a label "row-column"
 * so the grid can be put back together. Cutting line solid, seam line dashed, notches solid; a 5 cm square on the page
 * that holds it checks that the print was not scaled.
 */
export function sheetToPdf(sheet: Sheet, options: PdfOptions = {}): Uint8Array<ArrayBuffer> {
  const { page = A4, margin = 1.5 } = options;
  const { tiles: pages, rows, columns } = tiles(sheet, options);
  const objects: string[] = []; // object k (1-based) is objects[k - 1]
  const add = (body: string): number => objects.push(body);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // the page tree, filled in below
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (const t of pages) {
    const stream = tileContent(sheet, t, page, margin, rows, columns);
    const contents = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width * CM)} ${n(page.height * CM)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contents} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = pdf.length; pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(pdf, (ch) => ch.charCodeAt(0)); // all ASCII
}

function tileContent(sheet: Sheet, t: Tile, page: { width: number; height: number }, margin: number, rows: number, columns: number): string {
  const c: string[] = [];
  const px = (x: number) => n((margin + x - t.x) * CM);
  const py = (y: number) => n((page.height - margin - (y - t.y)) * CM);
  const text = (s: string, x: number, y: number, size: number, centred: boolean) => {
    const half = centred ? 0.25 * size * s.length : 0; // half the width of the text (Helvetica is about 0.5 em per character)
    c.push(`BT /F1 ${n(size * CM)} Tf ${n((x - half) * CM)} ${n(y * CM)} Td (${ascii(s)}) Tj ET`);
  };
  const path = (p: readonly Pt[], close: boolean) => `${p.map((q, i) => `${px(q[0])} ${py(q[1])} ${i ? 'l' : 'm'}`).join(' ')}${close ? ' h' : ''} S`;
  // Crop marks at the corners of the printable area.
  c.push('0 G 0.5 w');
  const mark = 0.5;
  for (const [mx, my] of [[0, 0], [t.width, 0], [0, t.height], [t.width, t.height]]) {
    const [x, y] = [margin + mx, page.height - margin - my];
    c.push(`${n((x - mark) * CM)} ${n(y * CM)} m ${n((x + mark) * CM)} ${n(y * CM)} l S ${n(x * CM)} ${n((y - mark) * CM)} m ${n(x * CM)} ${n((y + mark) * CM)} l S`);
  }
  text(`Page ${t.row + 1}-${t.column + 1}: row ${t.row + 1} of ${rows}, column ${t.column + 1} of ${columns}`, margin, margin / 2, 0.35, false);
  // Everything on the sheet, clipped to the printable area.
  c.push(`q ${n(margin * CM)} ${n((page.height - margin - t.height) * CM)} ${n(t.width * CM)} ${n(t.height * CM)} re W n`);
  for (const piece of sheet.pieces) {
    if (piece.cutLine) c.push(`${n(LINE.cut * CM)} w [] 0 d ${path(piece.cutLine, true)}`);
    c.push(piece.cutLine ? `${n(LINE.seam * CM)} w [${n(SEAM_DASH[0] * CM)} ${n(SEAM_DASH[1] * CM)}] 0 d ${path(piece.seamLine, true)}` : `${n(LINE.cut * CM)} w [] 0 d ${path(piece.seamLine, true)}`);
    c.push(`${n(LINE.notch * CM)} w [] 0 d`);
    for (const k of piece.notches) c.push(path([k.from, k.to], false));
    for (const l of piece.labels) text(l.text, margin + l.at[0] - t.x, page.height - margin - (l.at[1] - t.y) - LABEL_SIZE / 3, LABEL_SIZE, true);
    text(piece.name, margin + piece.nameAt[0] - t.x, page.height - margin - (piece.nameAt[1] - t.y), LABEL_SIZE * 1.6, true);
  }
  const s = sheet.scaleSquare;
  c.push(`${n(LINE.cut * CM)} w [] 0 d ${px(s.x)} ${py(s.y + s.size)} ${n(s.size * CM)} ${n(s.size * CM)} re S`);
  text(`${s.size} cm`, margin + s.x + s.size + 0.4 - t.x, page.height - margin - (s.y + s.size / 2 - t.y) - LABEL_SIZE / 3, LABEL_SIZE, false);
  c.push('Q');
  return c.join('\n');
}
