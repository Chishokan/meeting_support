// 智翔館AI：数学の図（図形・関数のグラフ）を、AI が書いた「図の記述（JSON）」から SVG にする。ほかに依存しない。
//
// AI は回答の中に ```図 … ``` の枠で JSON を書く（書き方は knowledge/37_教材制作/数学/30_図の書き方.md）。
// - 画面（チャット）では、この SVG をその場で表示する
// - Google ドキュメントにするときは、サーバで PNG にして（figurePng.ts）、Apps Script が [図:n] の位置に入れる
// 文字は XML として必ずエスケープし、AI が書いた SVG や HTML をそのまま使うことはない（座標と短い文字だけを受け取る）。
// 関数のグラフの式は、自前の小さな構文解析で計算する（eval しない）。

// --- 図の記述の形 ---------------------------------------------------------------

export type Pt = string | [number, number];
type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'none';

export type Shape =
  | { polygon: Pt[]; fill?: boolean; dash?: boolean }
  | { segment: [Pt, Pt]; dash?: boolean }
  | { line: [Pt, Pt]; dash?: boolean }
  | { circle: Pt; r?: number; through?: Pt; dash?: boolean; fill?: boolean }
  | { arc: Pt; r: number; from: number; to: number; dash?: boolean; fill?: boolean }
  | { curve: string; x?: [number, number]; dash?: boolean }
  | { angle: [Pt, Pt, Pt]; label?: string; arcs?: number }
  | { right: [Pt, Pt, Pt] }
  | { equal: [Pt, Pt][]; marks?: number }
  | { length: [Pt, Pt]; label: string; side?: 'left' | 'right' }
  | { text: [number, number]; label: string };

export type FigureSpec = {
  caption?: string;
  /** 数学の座標で [xの最小, yの最小, xの最大, yの最大]（上が y の正） */
  range: [number, number, number, number];
  /** ドキュメントに入れるときの幅（cm の目安）。3〜16 */
  size?: number;
  axes?: boolean;
  grid?: boolean | number;
  points?: Record<string, [number, number]>;
  /** 黒い点を打つ点の名前（辺の上の点など） */
  dots?: string[];
  /** 点の名前を書く向き（省略すると図の中心から外向き）。none で名前を書かない */
  labels?: Record<string, Dir>;
  shapes?: Shape[];
};

const MAX_POINTS = 60;
const MAX_SHAPES = 120;
const MAX_LABEL = 24;

// --- 式（関数のグラフ）の計算：数・x・+ - * / ^・かっこ・sqrt abs・pi ------------------

type Tok = { k: 'num'; v: number } | { k: 'x' } | { k: 'op'; v: string } | { k: 'fn'; v: string } | { k: '(' } | { k: ')' };

function tokenize(src: string): Tok[] {
  const s = src.replace(/\s+/g, '').replace(/[×＊]/g, '*').replace(/[÷／]/g, '/').replace(/[−ー－]/g, '-').replace(/[＋]/g, '+').replace(/²/g, '^2').replace(/³/g, '^3').replace(/√/g, 'sqrt');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (m) { out.push({ k: 'num', v: Number(m[1]) }); i += m[1].length; continue; }
    if (s.startsWith('sqrt', i)) { out.push({ k: 'fn', v: 'sqrt' }); i += 4; continue; }
    if (s.startsWith('abs', i)) { out.push({ k: 'fn', v: 'abs' }); i += 3; continue; }
    if (s.startsWith('pi', i) || c === 'π') { out.push({ k: 'num', v: Math.PI }); i += c === 'π' ? 1 : 2; continue; }
    if (c === 'x' || c === 'X') { out.push({ k: 'x' }); i++; continue; }
    if ('+-*/^'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    if (c === '(') { out.push({ k: '(' }); i++; continue; }
    if (c === ')') { out.push({ k: ')' }); i++; continue; }
    throw new Error(`式に使えない文字「${c}」`);
  }
  // 2x、3(x+1)、x(x-1)、)( のような掛け算の省略を補う
  const fixed: Tok[] = [];
  for (const t of out) {
    const prev = fixed[fixed.length - 1];
    const prevEnds = prev && (prev.k === 'num' || prev.k === 'x' || prev.k === ')');
    const startsValue = t.k === 'num' || t.k === 'x' || t.k === '(' || t.k === 'fn';
    if (prevEnds && startsValue) fixed.push({ k: 'op', v: '*' });
    fixed.push(t);
  }
  return fixed;
}

type Node = (x: number) => number;

/** y = f(x) の式を、x を渡すと値を返す関数にする。読めない式は例外。 */
export function compileExpr(src: string): Node {
  if (typeof src !== 'string' || src.length > 120) throw new Error('式が長すぎます');
  const toks = tokenize(src.replace(/^\s*y\s*=\s*/, ''));
  let p = 0;
  const peek = () => toks[p];
  const expr = (): Node => {
    let left = term();
    while (peek()?.k === 'op' && ((peek() as { v: string }).v === '+' || (peek() as { v: string }).v === '-')) {
      const op = (toks[p++] as { v: string }).v;
      const l = left, r = term();
      left = op === '+' ? (x) => l(x) + r(x) : (x) => l(x) - r(x);
    }
    return left;
  };
  const term = (): Node => {
    let left = unary();
    while (peek()?.k === 'op' && ((peek() as { v: string }).v === '*' || (peek() as { v: string }).v === '/')) {
      const op = (toks[p++] as { v: string }).v;
      const l = left, r = unary();
      left = op === '*' ? (x) => l(x) * r(x) : (x) => l(x) / r(x);
    }
    return left;
  };
  const unary = (): Node => {
    if (peek()?.k === 'op' && (peek() as { v: string }).v === '-') { p++; const u = unary(); return (x) => -u(x); }
    if (peek()?.k === 'op' && (peek() as { v: string }).v === '+') { p++; return unary(); }
    return power();
  };
  const power = (): Node => {
    const base = atom();
    if (peek()?.k === 'op' && (peek() as { v: string }).v === '^') {
      p++;
      const ex = unary();
      return (x) => Math.pow(base(x), ex(x));
    }
    return base;
  };
  const atom = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error('式が途中で終わっています');
    if (t.k === 'num') { const v = t.v; return () => v; }
    if (t.k === 'x') return (x) => x;
    if (t.k === 'fn') {
      if (toks[p++]?.k !== '(') throw new Error(`${t.v} のあとに ( が要ります`);
      const inner = expr();
      if (toks[p++]?.k !== ')') throw new Error(') が足りません');
      return t.v === 'sqrt' ? (x) => Math.sqrt(inner(x)) : (x) => Math.abs(inner(x));
    }
    if (t.k === '(') {
      const inner = expr();
      if (toks[p++]?.k !== ')') throw new Error(') が足りません');
      return inner;
    }
    throw new Error('式の形が正しくありません');
  };
  const f = expr();
  if (p !== toks.length) throw new Error('式の形が正しくありません');
  return f;
}

// --- 記述の確かめ -----------------------------------------------------------------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6;
const isXY = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'none'];

/** AI が書いた図の記述を確かめる。問題があれば、AI と職員に見せる理由を返す。 */
export function parseFigure(raw: unknown): { ok: true; spec: FigureSpec } | { ok: false; error: string } {
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return { ok: false, error: '図の記述が JSON として読めません' }; }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '図の記述がありません' };
  const o = raw as Record<string, unknown>;
  const range = o.range;
  if (!Array.isArray(range) || range.length !== 4 || !range.every(isNum)) return { ok: false, error: 'range は [xの最小, yの最小, xの最大, yの最大] の4つの数' };
  const [x0, y0, x1, y1] = range as number[];
  if (!(x1 > x0) || !(y1 > y0)) return { ok: false, error: 'range の最大は最小より大きくする' };
  const pts: Record<string, [number, number]> = {};
  const rawPts = (o.points && typeof o.points === 'object' ? o.points : {}) as Record<string, unknown>;
  const names = Object.keys(rawPts);
  if (names.length > MAX_POINTS) return { ok: false, error: `点は${MAX_POINTS}個まで` };
  for (const n of names) {
    if (n.length > 8) return { ok: false, error: `点の名前「${n.slice(0, 10)}」が長すぎます` };
    if (!isXY(rawPts[n])) return { ok: false, error: `点 ${n} の座標は [x, y] の2つの数` };
    pts[n] = rawPts[n] as [number, number];
  }
  const shapes = Array.isArray(o.shapes) ? o.shapes : [];
  if (shapes.length > MAX_SHAPES) return { ok: false, error: `図形は${MAX_SHAPES}個まで` };
  const ptOk = (p: unknown) => (typeof p === 'string' ? p in pts : isXY(p));
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i] as Record<string, unknown>;
    const where = `${i + 1}番目の図形`;
    if (!s || typeof s !== 'object') return { ok: false, error: `${where}の形が正しくありません` };
    const listOk = (v: unknown, min: number, max: number) => Array.isArray(v) && v.length >= min && v.length <= max && v.every(ptOk);
    if ('polygon' in s) { if (!listOk(s.polygon, 2, 40)) return { ok: false, error: `${where}（polygon）の点が正しくありません（定義した点の名前か [x, y]）` }; }
    else if ('segment' in s || 'line' in s) { if (!listOk(s.segment ?? s.line, 2, 2)) return { ok: false, error: `${where}（segment / line）は2点` }; }
    else if ('circle' in s) {
      if (!ptOk(s.circle)) return { ok: false, error: `${where}（circle）の中心が正しくありません` };
      if (!(isNum(s.r) && s.r > 0) && !ptOk(s.through)) return { ok: false, error: `${where}（circle）は r か through が要ります` };
    } else if ('arc' in s) {
      if (!ptOk(s.arc) || !(isNum(s.r) && s.r > 0) || !isNum(s.from) || !isNum(s.to)) return { ok: false, error: `${where}（arc）は中心・r・from・to（度）` };
    } else if ('curve' in s) {
      try { compileExpr(String(s.curve)); } catch (e) { return { ok: false, error: `${where}（curve）の式：${(e as Error).message}` }; }
      if (s.x !== undefined && !(Array.isArray(s.x) && s.x.length === 2 && s.x.every(isNum) && (s.x as number[])[1] > (s.x as number[])[0])) return { ok: false, error: `${where}（curve）の x は [最小, 最大]` };
    } else if ('angle' in s || 'right' in s) { if (!listOk(s.angle ?? s.right, 3, 3)) return { ok: false, error: `${where}（angle / right）は3点（真ん中が頂点）` }; }
    else if ('equal' in s) {
      if (!Array.isArray(s.equal) || !s.equal.every((g) => listOk(g, 2, 2))) return { ok: false, error: `${where}（equal）は [[点, 点], [点, 点]…]` };
    } else if ('length' in s) { if (!listOk(s.length, 2, 2) || typeof s.label !== 'string') return { ok: false, error: `${where}（length）は2点と label` }; }
    else if ('text' in s) { if (!isXY(s.text) || typeof s.label !== 'string') return { ok: false, error: `${where}（text）は [x, y] と label` }; }
    else return { ok: false, error: `${where}の種類が分かりません（polygon / segment / line / circle / arc / curve / angle / right / equal / length / text）` };
  }
  const labels: Record<string, Dir> = {};
  for (const [k, v] of Object.entries((o.labels && typeof o.labels === 'object' ? o.labels : {}) as Record<string, unknown>)) {
    if (typeof v === 'string' && DIRS.includes(v)) labels[k] = v as Dir;
  }
  const size = isNum(o.size) ? Math.min(16, Math.max(3, o.size)) : 8;
  const grid = o.grid === true ? 1 : isNum(o.grid) && o.grid > 0 ? o.grid : false;
  return {
    ok: true,
    spec: {
      caption: typeof o.caption === 'string' ? o.caption.slice(0, 40) : undefined,
      range: [x0, y0, x1, y1],
      size,
      axes: o.axes === true,
      grid,
      points: pts,
      dots: Array.isArray(o.dots) ? o.dots.filter((d): d is string => typeof d === 'string' && d in pts) : [],
      labels,
      shapes: shapes as Shape[],
    },
  };
}

// --- SVG にする -------------------------------------------------------------------

const STROKE = '#1a1a1a';
const FILL = '#d6d6d6';
const FONT = "'DejaVu Sans', 'Helvetica Neue', Arial, sans-serif";
const FS = 15;
const W_MAX = 480;
const H_MAX = 420;
const M = 40;

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

/** 図の記述から SVG の文字列と、画像の大きさ（px）を作る。 */
export function renderFigureSvg(spec: FigureSpec): { svg: string; width: number; height: number } {
  const [x0, y0, x1, y1] = spec.range;
  const aspect = (y1 - y0) / (x1 - x0);
  let inner = W_MAX - 2 * M;
  if (inner * aspect > H_MAX - 2 * M) inner = (H_MAX - 2 * M) / aspect;
  const s = inner / (x1 - x0);
  const width = Math.round(inner + 2 * M);
  const height = Math.round(inner * aspect + 2 * M);
  const tx = (x: number) => M + (x - x0) * s;
  const ty = (y: number) => M + (y1 - y) * s;
  const pts = spec.points ?? {};
  const P = (p: Pt): [number, number] => (typeof p === 'string' ? pts[p] : p);
  const SP = (p: Pt): [number, number] => { const [x, y] = P(p); return [tx(x), ty(y)]; };
  const dash = (d?: boolean) => (d ? ' stroke-dasharray="6 4"' : '');
  const back: string[] = [];
  const fills: string[] = [];
  const strokes: string[] = [];
  const marks: string[] = [];
  const texts: string[] = [];
  // 文字の入る範囲（はみ出さないよう、最後に画像の大きさを広げる）
  const boxes: [number, number, number, number][] = [];
  const text = (x: number, y: number, label: string, anchor = 'middle', size = FS) => {
    const t = label.slice(0, MAX_LABEL);
    const w = textWidth(t, size);
    const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    boxes.push([left, y - size * 0.6, left + w, y + size * 0.6]);
    texts.push(`<text x="${f2(x)}" y="${f2(y + size * 0.36)}" font-size="${size}" text-anchor="${anchor}" font-family="${FONT}" fill="${STROKE}">${escapeXml(t)}</text>`);
  };

  // 方眼と座標軸
  if (spec.grid) {
    const step = typeof spec.grid === 'number' ? spec.grid : 1;
    for (let gx = Math.ceil(x0 / step) * step; gx <= x1 + 1e-9; gx += step) back.push(`<line x1="${f2(tx(gx))}" y1="${f2(ty(y0))}" x2="${f2(tx(gx))}" y2="${f2(ty(y1))}" stroke="#c9d3dd" stroke-width="0.8"/>`);
    for (let gy = Math.ceil(y0 / step) * step; gy <= y1 + 1e-9; gy += step) back.push(`<line x1="${f2(tx(x0))}" y1="${f2(ty(gy))}" x2="${f2(tx(x1))}" y2="${f2(ty(gy))}" stroke="#c9d3dd" stroke-width="0.8"/>`);
  }
  if (spec.axes) {
    const arrow = (x: number, y: number, dx: number, dy: number) =>
      `<path d="M${f2(x)},${f2(y)} L${f2(x - dx * 9 - dy * 4)},${f2(y - dy * 9 + dx * 4)} L${f2(x - dx * 9 + dy * 4)},${f2(y - dy * 9 - dx * 4)} Z" fill="${STROKE}"/>`;
    if (y0 <= 0 && 0 <= y1) {
      back.push(`<line x1="${f2(tx(x0))}" y1="${f2(ty(0))}" x2="${f2(tx(x1))}" y2="${f2(ty(0))}" stroke="${STROKE}" stroke-width="1.2"/>`, arrow(tx(x1), ty(0), 1, 0));
      text(tx(x1) - 4, ty(0) + 14, 'x');
    }
    if (x0 <= 0 && 0 <= x1) {
      back.push(`<line x1="${f2(tx(0))}" y1="${f2(ty(y0))}" x2="${f2(tx(0))}" y2="${f2(ty(y1))}" stroke="${STROKE}" stroke-width="1.2"/>`, arrow(tx(0), ty(y1), 0, -1));
      text(tx(0) + 12, ty(y1) + 6, 'y');
    }
    if (x0 <= 0 && 0 <= x1 && y0 <= 0 && 0 <= y1 && !('O' in pts)) text(tx(0) - 10, ty(0) + 13, 'O');
  }

  // 図の中心（点の名前と長さの書き込みを外向きにするため）
  const all = Object.values(pts);
  const cx = all.length ? all.reduce((a, p) => a + p[0], 0) / all.length : (x0 + x1) / 2;
  const cy = all.length ? all.reduce((a, p) => a + p[1], 0) / all.length : (y0 + y1) / 2;

  for (const sh of spec.shapes ?? []) {
    const o = sh as Record<string, unknown>;
    if ('polygon' in o) {
      const d = (o.polygon as Pt[]).map((p, i) => { const [X, Y] = SP(p); return `${i ? 'L' : 'M'}${f2(X)},${f2(Y)}`; }).join(' ') + ((o.polygon as Pt[]).length > 2 ? ' Z' : '');
      if (o.fill) fills.push(`<path d="${d}" fill="${FILL}" stroke="none"/>`);
      strokes.push(`<path d="${d}" fill="none" stroke="${STROKE}" stroke-width="1.6" stroke-linejoin="round"${dash(o.dash as boolean)}/>`);
    } else if ('segment' in o) {
      const [a, b] = (o.segment as Pt[]).map(SP);
      strokes.push(`<line x1="${f2(a[0])}" y1="${f2(a[1])}" x2="${f2(b[0])}" y2="${f2(b[1])}" stroke="${STROKE}" stroke-width="1.6"${dash(o.dash as boolean)}/>`);
    } else if ('line' in o) {
      const [a, b] = (o.line as Pt[]).map(P);
      const seg = clipLine(a, b, [x0, y0, x1, y1]);
      if (seg) strokes.push(`<line x1="${f2(tx(seg[0][0]))}" y1="${f2(ty(seg[0][1]))}" x2="${f2(tx(seg[1][0]))}" y2="${f2(ty(seg[1][1]))}" stroke="${STROKE}" stroke-width="1.6"${dash(o.dash as boolean)}/>`);
    } else if ('circle' in o) {
      const c = P(o.circle as Pt);
      const r = typeof o.r === 'number' ? o.r : Math.hypot(P(o.through as Pt)[0] - c[0], P(o.through as Pt)[1] - c[1]);
      if (o.fill) fills.push(`<circle cx="${f2(tx(c[0]))}" cy="${f2(ty(c[1]))}" r="${f2(r * s)}" fill="${FILL}" stroke="none"/>`);
      strokes.push(`<circle cx="${f2(tx(c[0]))}" cy="${f2(ty(c[1]))}" r="${f2(r * s)}" fill="none" stroke="${STROKE}" stroke-width="1.6"${dash(o.dash as boolean)}/>`);
    } else if ('arc' in o) {
      const c = P(o.arc as Pt);
      const r = o.r as number;
      const a0 = ((o.from as number) * Math.PI) / 180;
      const a1 = ((o.to as number) * Math.PI) / 180;
      const sx = tx(c[0] + r * Math.cos(a0)), sy = ty(c[1] + r * Math.sin(a0));
      const ex = tx(c[0] + r * Math.cos(a1)), ey = ty(c[1] + r * Math.sin(a1));
      let sweepDeg = ((o.to as number) - (o.from as number)) % 360;
      if (sweepDeg <= 0) sweepDeg += 360;
      const large = sweepDeg > 180 ? 1 : 0;
      const arcD = `M${f2(sx)},${f2(sy)} A${f2(r * s)},${f2(r * s)} 0 ${large} 0 ${f2(ex)},${f2(ey)}`;
      if (o.fill) fills.push(`<path d="M${f2(tx(c[0]))},${f2(ty(c[1]))} L${f2(sx)},${f2(sy)} A${f2(r * s)},${f2(r * s)} 0 ${large} 0 ${f2(ex)},${f2(ey)} Z" fill="${FILL}" stroke="none"/>`);
      strokes.push(`<path d="${arcD}" fill="none" stroke="${STROKE}" stroke-width="1.6"${dash(o.dash as boolean)}/>`);
    } else if ('curve' in o) {
      const fn = compileExpr(String(o.curve));
      const [a, b] = (o.x as [number, number] | undefined) ?? [x0, x1];
      const n = 240;
      const pad = (y1 - y0) * 0.5;
      let d = '';
      let pen = false;
      for (let i = 0; i <= n; i++) {
        const x = a + ((b - a) * i) / n;
        const y = fn(x);
        if (!Number.isFinite(y) || y < y0 - pad || y > y1 + pad) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${f2(tx(x))},${f2(ty(y))} `;
        pen = true;
      }
      if (d) strokes.push(`<path d="${d.trim()}" fill="none" stroke="${STROKE}" stroke-width="1.6"${dash(o.dash as boolean)}/>`);
    } else if ('angle' in o) {
      const [A, B, C] = (o.angle as Pt[]).map(SP);
      const a1 = Math.atan2(A[1] - B[1], A[0] - B[0]);
      const a2 = Math.atan2(C[1] - B[1], C[0] - B[0]);
      let diff = a2 - a1;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const arcs = Math.min(3, Math.max(1, Number(o.arcs) || 1));
      for (let k = 0; k < arcs; k++) {
        const r = 16 + k * 4;
        const sx = B[0] + r * Math.cos(a1), sy = B[1] + r * Math.sin(a1);
        const ex = B[0] + r * Math.cos(a1 + diff), ey = B[1] + r * Math.sin(a1 + diff);
        marks.push(`<path d="M${f2(sx)},${f2(sy)} A${r},${r} 0 0 ${diff > 0 ? 1 : 0} ${f2(ex)},${f2(ey)}" fill="none" stroke="${STROKE}" stroke-width="1.2"/>`);
      }
      if (typeof o.label === 'string' && o.label) {
        const mid = a1 + diff / 2;
        text(B[0] + 34 * Math.cos(mid), B[1] + 34 * Math.sin(mid), o.label, 'middle', 13);
      }
    } else if ('right' in o) {
      const [A, B, C] = (o.right as Pt[]).map(SP);
      const u = unit(A[0] - B[0], A[1] - B[1]);
      const v = unit(C[0] - B[0], C[1] - B[1]);
      const k = 11;
      marks.push(`<path d="M${f2(B[0] + u[0] * k)},${f2(B[1] + u[1] * k)} L${f2(B[0] + (u[0] + v[0]) * k)},${f2(B[1] + (u[1] + v[1]) * k)} L${f2(B[0] + v[0] * k)},${f2(B[1] + v[1] * k)}" fill="none" stroke="${STROKE}" stroke-width="1.2"/>`);
    } else if ('equal' in o) {
      const count = Math.min(3, Math.max(1, Number(o.marks) || 1));
      for (const pair of o.equal as [Pt, Pt][]) {
        const [A, B] = pair.map(SP);
        const u = unit(B[0] - A[0], B[1] - A[1]);
        const nrm = [-u[1], u[0]];
        const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
        for (let k = 0; k < count; k++) {
          const off = (k - (count - 1) / 2) * 4;
          const px = mx + u[0] * off, py = my + u[1] * off;
          marks.push(`<line x1="${f2(px - nrm[0] * 6)}" y1="${f2(py - nrm[1] * 6)}" x2="${f2(px + nrm[0] * 6)}" y2="${f2(py + nrm[1] * 6)}" stroke="${STROKE}" stroke-width="1.2"/>`);
        }
      }
    } else if ('length' in o) {
      const [a, b] = (o.length as Pt[]).map(P);
      const [A, B] = [a, b].map((p) => [tx(p[0]), ty(p[1])]);
      const u = unit(B[0] - A[0], B[1] - A[1]);
      let nrm: [number, number] = [-u[1], u[0]];
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
      if (o.side === 'left' || o.side === 'right') {
        if (o.side === 'right') nrm = [u[1], -u[0]];
      } else {
        // 図の中心から遠ざかる側に書く
        const toC = [tx(cx) - mx, ty(cy) - my];
        if (nrm[0] * toC[0] + nrm[1] * toC[1] > 0) nrm = [-nrm[0], -nrm[1]];
      }
      text(mx + nrm[0] * 12, my + nrm[1] * 12, String(o.label), anchorFor(nrm[0]), 13);
    } else if ('text' in o) {
      const [x, y] = o.text as [number, number];
      text(tx(x), ty(y), String(o.label));
    }
  }

  // 点の名前と黒い点
  const OFF: Record<string, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [0.75, -0.75], nw: [-0.75, -0.75], se: [0.75, 0.75], sw: [-0.75, 0.75] };
  for (const [name, [x, y]] of Object.entries(pts)) {
    const dir = spec.labels?.[name];
    if (dir === 'none') continue;
    let d: [number, number];
    if (dir) d = OFF[dir];
    else {
      const vx = x - cx, vy = -(y - cy);
      const len = Math.hypot(vx, vy);
      d = len < 1e-9 ? OFF.ne : [vx / len, vy / len];
    }
    text(tx(x) + d[0] * 11, ty(y) + d[1] * 13, name, anchorFor(d[0]));
  }
  for (const name of spec.dots ?? []) {
    const [x, y] = pts[name];
    marks.push(`<circle cx="${f2(tx(x))}" cy="${f2(ty(y))}" r="3" fill="${STROKE}"/>`);
  }

  // 文字が画像からはみ出すときは、その分だけ画像を広げる
  const pad = 6;
  const minX = Math.floor(Math.min(0, ...boxes.map((b) => b[0] - pad)));
  const minY = Math.floor(Math.min(0, ...boxes.map((b) => b[1] - pad)));
  const maxX = Math.ceil(Math.max(width, ...boxes.map((b) => b[2] + pad)));
  const maxY = Math.ceil(Math.max(height, ...boxes.map((b) => b[3] + pad)));
  const W = maxX - minX;
  const H = maxY - minY;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${minX} ${minY} ${W} ${H}">` +
    `<rect x="${minX}" y="${minY}" width="${W}" height="${H}" fill="#ffffff"/>` +
    [...back, ...fills, ...strokes, ...marks, ...texts].join('') +
    '</svg>';
  return { svg, width: W, height: H };
}

/** 文字の幅の見積もり（半角は字の大きさの0.62倍、全角は1倍）。 */
function textWidth(t: string, size: number): number {
  let w = 0;
  for (const ch of t) w += /[\u0000-\u024f°²³√π]/.test(ch) ? size * 0.62 : size;
  return w;
}

/** 外向きに書く文字の寄せ方（右向きなら左寄せ、左向きなら右寄せ）。 */
function anchorFor(dx: number): string {
  return dx > 0.35 ? 'start' : dx < -0.35 ? 'end' : 'middle';
}

function unit(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}

/** 2点を通る直線を、表示の範囲で切り取った線分にする（範囲に入らなければ null）。 */
export function clipLine(a: [number, number], b: [number, number], [x0, y0, x1, y1]: [number, number, number, number]): [[number, number], [number, number]] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) return null;
  let t0 = -Infinity, t1 = Infinity;
  const edge = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    return true;
  };
  if (!edge(-dx, a[0] - x0) || !edge(dx, x1 - a[0]) || !edge(-dy, a[1] - y0) || !edge(dy, y1 - a[1]) || t0 > t1) return null;
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

// --- 回答の中の ```図 枠 ---------------------------------------------------------------

/** コード枠の種類が図か（```図 / ```figure）。 */
export function isFigureLang(lang: string): boolean {
  return lang === '図' || lang.toLowerCase() === 'figure';
}

/**
 * Markdown の中の ```図 枠を取り出し、[図:n] の行に置きかえる（Google ドキュメントにするとき）。
 * 読めない図は、そのことを書いた行に置きかえ、errors に理由を入れる。
 */
export function extractFigures(md: string): { markdown: string; figures: FigureSpec[]; errors: string[] } {
  const figures: FigureSpec[] = [];
  const errors: string[] = [];
  const markdown = md.replace(/^[ \t]*(```+|~~~+)[ \t]*(図|figure)[ \t]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gim, (_m, _f, _l, body: string) => {
    const r = parseFigure(body);
    if (!r.ok) {
      errors.push(r.error);
      return `〔図を描けませんでした：${r.error}〕`;
    }
    figures.push(r.spec);
    return `[図:${figures.length}]`;
  });
  return { markdown, figures, errors };
}
