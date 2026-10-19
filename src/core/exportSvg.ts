import type { Pt } from './allowance';
import type { Sheet } from './sheet';

/** A number to 3 decimals without trailing zeros (and no "-0"). */
const num = (v: number): string => String(+v.toFixed(3));
const points = (p: readonly Pt[]): string => p.map((q) => `${num(q[0])},${num(q[1])}`).join(' ');
const escapeXml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Stroke widths (cm) shared by the SVG and PDF exports. */
export const LINE = { cut: 0.05, seam: 0.03, notch: 0.05 };
/** Dash pattern of the seam line (cm on, cm off). */
export const SEAM_DASH: [number, number] = [0.4, 0.25];
/** Height of label text (cm). */
export const LABEL_SIZE = 0.6;

/**
 * The sheet as an SVG at full size: the page is `width` x `height` in cm and its coordinates are cm, so printing it at
 * 100% (or opening it in a pattern program) gives a 1:1 pattern. Cutting line solid, seam line dashed, notches solid.
 */
export function sheetToSvg(sheet: Sheet): string {
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(sheet.width)}cm" height="${num(sheet.height)}cm" viewBox="0 0 ${num(sheet.width)} ${num(sheet.height)}" font-family="Helvetica, Arial, sans-serif" font-size="${LABEL_SIZE}">`,
  ];
  for (const piece of sheet.pieces) {
    out.push(`<g id="${escapeXml(piece.name.replace(/\s+/g, '-').toLowerCase())}" fill="none" stroke="#000">`);
    if (piece.cutLine) out.push(`<polygon points="${points(piece.cutLine)}" stroke-width="${LINE.cut}"/>`);
    // With no allowance the seam line is the cutting line: solid.
    out.push(`<polygon points="${points(piece.seamLine)}"${piece.cutLine ? ` stroke-width="${LINE.seam}" stroke-dasharray="${SEAM_DASH[0]} ${SEAM_DASH[1]}"` : ` stroke-width="${LINE.cut}"`}/>`);
    for (const n of piece.notches) out.push(`<line x1="${num(n.from[0])}" y1="${num(n.from[1])}" x2="${num(n.to[0])}" y2="${num(n.to[1])}" stroke-width="${LINE.notch}"/>`);
    for (const l of piece.labels) out.push(`<text x="${num(l.at[0])}" y="${num(l.at[1])}" text-anchor="middle" dominant-baseline="middle" fill="#000" stroke="none">${escapeXml(l.text)}</text>`);
    out.push(`<text x="${num(piece.nameAt[0])}" y="${num(piece.nameAt[1])}" text-anchor="middle" font-size="${LABEL_SIZE * 1.6}" fill="#000" stroke="none">${escapeXml(piece.name)}</text>`);
    out.push('</g>');
  }
  const s = sheet.scaleSquare;
  out.push(`<g id="scale-check" fill="none" stroke="#000" stroke-width="${LINE.cut}"><rect x="${num(s.x)}" y="${num(s.y)}" width="${num(s.size)}" height="${num(s.size)}"/><text x="${num(s.x + s.size + 0.4)}" y="${num(s.y + s.size / 2)}" dominant-baseline="middle" fill="#000" stroke="none">${num(s.size)} cm</text></g>`);
  out.push('</svg>');
  return out.join('\n');
}
