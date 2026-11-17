/**
 * Parser for Adobe / Resolve `.cube` colour lookup tables (1D and 3D).
 *
 * Shared by the main process (validates a file before copying it into the LUT library) and the
 * renderer (loads the table into a GPU texture). Supports:
 *   TITLE "…"                    optional, quoted or bare
 *   LUT_1D_SIZE n                2..65536
 *   LUT_3D_SIZE n                2..65
 *   DOMAIN_MIN r g b / DOMAIN_MAX r g b
 *   LUT_1D_INPUT_RANGE a b / LUT_3D_INPUT_RANGE a b   (Resolve's scalar form of the domain)
 *   # comments (whole-line and trailing), blank lines, CRLF, a UTF-8 BOM, scientific notation
 * Unknown keywords (e.g. LUT_IN_VIDEO_RANGE) are ignored. Data rows are "r g b" with red changing
 * fastest, then green, then blue (3D).
 */

export type CubeKind = '1d' | '3d';

export interface CubeLut {
  title: string;
  kind: CubeKind;
  /** Entries per axis. */
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** RGB triplets: `size` entries (1D) or `size³` entries (3D, red fastest). */
  data: Float32Array;
}

export const CUBE_MAX_3D = 65;
export const CUBE_MAX_1D = 65536;

export class CubeParseError extends Error {
  constructor(message: string, line?: number) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'CubeParseError';
  }
}

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function parseNums(parts: string[], count: number, line: number, what: string): number[] {
  if (parts.length < count) throw new CubeParseError(`${what} needs ${count} numbers`, line);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!NUM.test(parts[i])) throw new CubeParseError(`${what}: "${parts[i]}" is not a number`, line);
    const v = Number(parts[i]);
    if (!Number.isFinite(v)) throw new CubeParseError(`${what}: value out of range`, line);
    out.push(v);
  }
  return out;
}

/** Parse the text of a .cube file. Throws CubeParseError with a readable message when invalid. */
export function parseCube(text: string): CubeLut {
  if (typeof text !== 'string') throw new CubeParseError('The file is not a text file.');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.indexOf('\u0000') >= 0) throw new CubeParseError('The file is not a text .cube LUT.');

  let title = '';
  let size1 = 0;
  let size3 = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let data: Float32Array | null = null;
  let expected = 0;
  let count = 0;

  const lines = text.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let line = lines[i];
    const hash = line.indexOf('#');
    if (hash >= 0) {
      // A '#' inside a quoted TITLE is part of the title.
      const q1 = line.indexOf('"');
      const q2 = q1 >= 0 ? line.indexOf('"', q1 + 1) : -1;
      if (!(q1 >= 0 && q1 < hash && q2 > hash)) line = line.slice(0, hash);
    }
    line = line.trim();
    if (!line) continue;

    const first = line[0];
    const isData = first === '-' || first === '+' || first === '.' || (first >= '0' && first <= '9');
    if (isData) {
      if (!data) {
        if (!size1 && !size3) throw new CubeParseError('Table data found before LUT_1D_SIZE / LUT_3D_SIZE', lineNo);
        if (size1 && size3) throw new CubeParseError('Files combining a 1D shaper and a 3D table are not supported');
        expected = size3 ? size3 * size3 * size3 : size1;
        data = new Float32Array(expected * 3);
      }
      if (count >= expected) throw new CubeParseError(`More table rows than expected (${expected})`, lineNo);
      const v = parseNums(line.split(/\s+/), 3, lineNo, 'Table row');
      data[count * 3] = v[0];
      data[count * 3 + 1] = v[1];
      data[count * 3 + 2] = v[2];
      count++;
      continue;
    }

    if (data) throw new CubeParseError('Keywords must come before the table data', lineNo);
    const sp = line.search(/\s/);
    const key = (sp < 0 ? line : line.slice(0, sp)).toUpperCase();
    const rest = sp < 0 ? '' : line.slice(sp).trim();
    const parts = rest ? rest.split(/\s+/) : [];
    switch (key) {
      case 'TITLE': {
        const m = /^"(.*)"\s*$/.exec(rest);
        title = (m ? m[1] : rest).trim().slice(0, 120);
        break;
      }
      case 'LUT_1D_SIZE': {
        const [n] = parseNums(parts, 1, lineNo, 'LUT_1D_SIZE');
        if (!Number.isInteger(n) || n < 2 || n > CUBE_MAX_1D) throw new CubeParseError(`LUT_1D_SIZE must be a whole number from 2 to ${CUBE_MAX_1D}`, lineNo);
        size1 = n;
        break;
      }
      case 'LUT_3D_SIZE': {
        const [n] = parseNums(parts, 1, lineNo, 'LUT_3D_SIZE');
        if (!Number.isInteger(n) || n < 2 || n > CUBE_MAX_3D) throw new CubeParseError(`LUT_3D_SIZE must be a whole number from 2 to ${CUBE_MAX_3D}`, lineNo);
        size3 = n;
        break;
      }
      case 'DOMAIN_MIN': {
        const v = parseNums(parts, 3, lineNo, 'DOMAIN_MIN');
        domainMin = [v[0], v[1], v[2]];
        break;
      }
      case 'DOMAIN_MAX': {
        const v = parseNums(parts, 3, lineNo, 'DOMAIN_MAX');
        domainMax = [v[0], v[1], v[2]];
        break;
      }
      case 'LUT_1D_INPUT_RANGE':
      case 'LUT_3D_INPUT_RANGE': {
        const v = parseNums(parts, 2, lineNo, key);
        domainMin = [v[0], v[0], v[0]];
        domainMax = [v[1], v[1], v[1]];
        break;
      }
      default:
        // Unknown keywords are allowed by the format; anything that is not a word is not.
        if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new CubeParseError(`Unexpected line "${line.slice(0, 40)}"`, lineNo);
    }
  }

  if (!size1 && !size3) throw new CubeParseError('The file has no LUT_1D_SIZE or LUT_3D_SIZE.');
  if (!data || count === 0) throw new CubeParseError('The file has no table data.');
  if (count !== expected) throw new CubeParseError(`The table has ${count} rows but ${expected} were expected.`);
  for (let c = 0; c < 3; c++) {
    if (!(domainMax[c] > domainMin[c])) throw new CubeParseError('DOMAIN_MAX must be greater than DOMAIN_MIN.');
  }
  return { title, kind: size3 ? '3d' : '1d', size: size3 || size1, domainMin, domainMax, data };
}

/** Write a LUT back out as .cube text (used for the built-in looks and tests). */
export function formatCube(lut: CubeLut, digits = 6): string {
  const out: string[] = [];
  if (lut.title) out.push(`TITLE "${lut.title.replace(/"/g, "'")}"`);
  out.push(lut.kind === '3d' ? `LUT_3D_SIZE ${lut.size}` : `LUT_1D_SIZE ${lut.size}`);
  const isDefault = lut.domainMin.every((v) => v === 0) && lut.domainMax.every((v) => v === 1);
  if (!isDefault) {
    out.push(`DOMAIN_MIN ${lut.domainMin.join(' ')}`);
    out.push(`DOMAIN_MAX ${lut.domainMax.join(' ')}`);
  }
  const n = lut.data.length / 3;
  for (let i = 0; i < n; i++) out.push(`${lut.data[i * 3].toFixed(digits)} ${lut.data[i * 3 + 1].toFixed(digits)} ${lut.data[i * 3 + 2].toFixed(digits)}`);
  return out.join('\n') + '\n';
}

/**
 * Apply a LUT to one colour on the CPU (trilinear for 3D, linear for 1D), mirroring the GPU path.
 * Used by tests and for LUT thumbnails.
 */
export function sampleCube(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size;
  const norm = (v: number, c: number): number => {
    const t = (v - lut.domainMin[c]) / (lut.domainMax[c] - lut.domainMin[c]);
    return Math.min(1, Math.max(0, t)) * (n - 1);
  };
  const d = lut.data;
  if (lut.kind === '1d') {
    const out: [number, number, number] = [0, 0, 0];
    [r, g, b].forEach((v, c) => {
      const x = norm(v, c);
      const i0 = Math.min(n - 1, Math.floor(x));
      const i1 = Math.min(n - 1, i0 + 1);
      const f = x - i0;
      out[c] = d[i0 * 3 + c] * (1 - f) + d[i1 * 3 + c] * f;
    });
    return out;
  }
  const x = norm(r, 0);
  const y = norm(g, 1);
  const z = norm(b, 2);
  const x0 = Math.min(n - 1, Math.floor(x));
  const y0 = Math.min(n - 1, Math.floor(y));
  const z0 = Math.min(n - 1, Math.floor(z));
  const x1 = Math.min(n - 1, x0 + 1);
  const y1 = Math.min(n - 1, y0 + 1);
  const z1 = Math.min(n - 1, z0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const at = (xi: number, yi: number, zi: number, c: number): number => d[((zi * n + yi) * n + xi) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(x0, y0, z0, c) * (1 - fx) + at(x1, y0, z0, c) * fx;
    const c10 = at(x0, y1, z0, c) * (1 - fx) + at(x1, y1, z0, c) * fx;
    const c01 = at(x0, y0, z1, c) * (1 - fx) + at(x1, y0, z1, c) * fx;
    const c11 = at(x0, y1, z1, c) * (1 - fx) + at(x1, y1, z1, c) * fx;
    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    out[c] = c0 * (1 - fz) + c1 * fz;
  }
  return out;
}
