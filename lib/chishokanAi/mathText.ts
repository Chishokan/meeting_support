// 数学の教材の文（問題文・解説）を、Word に書く部品に分ける。ほかに依存しない（テストしやすいように）。
//
// - $ … $ の中を数式として読む。分数 \frac{a}{b}、根号 \sqrt{a}、累乗 x^2・x^{10}、記号（\times \div \pi \angle \triangle など）
//   $ の外は、ふつうの文字（和文はＭＳ明朝、英数字は Times New Roman）
// - 数式の中の小文字（x, y, a, n …）は太字の斜体、大文字（点の名前 A, B …）は立体。社内の模試の表記に合わせる
// - ＋ － ＝ ＜ ＞ は全角にする（和文の模試の組み方）
// - 分数・根号は Word の数式（OMML）で組む。それ以外はふつうの文字（上付き）で組む

export type Piece =
  | { t: 'text'; v: string; italic?: boolean; bold?: boolean; sup?: boolean; sub?: boolean }
  | { t: 'frac'; num: Piece[]; den: Piece[] }
  | { t: 'sqrt'; body: Piece[] };

const SYMBOLS: Record<string, string> = {
  times: '×', div: '÷', pi: 'π', angle: '∠', triangle: '△', circ: '°', degree: '°', pm: '±', mp: '∓',
  leqq: '≦', geqq: '≧', leq: '≦', geq: '≧', le: '≦', ge: '≧', neq: '≠', ne: '≠', fallingdotseq: '≒', approx: '≒',
  parallel: '∥', perp: '⊥', equiv: '≡', sim: '∽', backsim: '∽', cdots: '…', ldots: '…', cdot: '・',
  infty: '∞', therefore: '∴', because: '∵', square: '□', alpha: 'α', beta: 'β', theta: 'θ',
  // 空白
  ',': ' ', ' ': ' ', quad: '　', qquad: '　　',
};

const WIDE: Record<string, string> = { '+': '＋', '-': '－', '−': '－', '=': '＝', '<': '＜', '>': '＞' };

/** 文（$ … $ を含む）を部品に分ける。 */
export function parseMathText(src: string): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  while (i < src.length) {
    if (src[i] === '\\' && src[i + 1] === '$') {
      buf += '$';
      i += 2;
      continue;
    }
    if (src[i] === '$') {
      const end = src.indexOf('$', i + 1);
      if (end > i) {
        flush();
        out.push(...parseMath(src.slice(i + 1, end)));
        i = end + 1;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return merge(out);
}

/** 数式（$ の中）を部品に分ける。 */
export function parseMath(src: string): Piece[] {
  const p = new MathParser(src);
  return merge(p.list(''));
}

class MathParser {
  i = 0;
  s: string;
  constructor(s: string) {
    this.s = s;
  }

  /** stop の文字（} など）までを読む。 */
  list(stop: string): Piece[] {
    const out: Piece[] = [];
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (stop && c === stop) break;
      const atom = this.atom(out);
      if (atom) out.push(...atom);
    }
    return out;
  }

  /** { … } を読む（無ければ1文字）。 */
  group(): Piece[] {
    this.skipSpace();
    if (this.s[this.i] === '{') {
      this.i++;
      const body = this.list('}');
      this.i++; // }
      return body;
    }
    const a = this.atom([]);
    return a ?? [];
  }

  skipSpace() {
    while (this.s[this.i] === ' ') this.i++;
  }

  atom(prev: Piece[]): Piece[] | null {
    const c = this.s[this.i];
    if (c === ' ') {
      this.i++;
      return null;
    }
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(this.s.slice(this.i));
      const name = m ? m[1] : '';
      this.i += m ? m[0].length : 1;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const num = this.group();
        const den = this.group();
        return [{ t: 'frac', num: merge(num), den: merge(den) }];
      }
      if (name === 'sqrt') return [{ t: 'sqrt', body: merge(this.group()) }];
      if (name === 'text' || name === 'mathrm') return [{ t: 'text', v: flat(this.group()) }];
      if (name === 'left' || name === 'right') return null;
      if (name in SYMBOLS) return [{ t: 'text', v: SYMBOLS[name] }];
      return [{ t: 'text', v: name }];
    }
    if (c === '^' || c === '_') {
      this.i++;
      const g = this.group();
      const sup = c === '^';
      // 角度の ^\circ は ° にする
      return g.map((p) => (p.t === 'text' ? { ...p, v: p.v === '°' ? '°' : p.v, sup: sup && p.v !== '°', sub: !sup } : p));
    }
    if (c === '√') {
      this.i++;
      // √18 √{x+1} √x の形
      this.skipSpace();
      if (this.s[this.i] === '{') return [{ t: 'sqrt', body: merge(this.group()) }];
      const m = /^([0-9.]+|[A-Za-z])/.exec(this.s.slice(this.i));
      if (m) {
        this.i += m[0].length;
        return [{ t: 'sqrt', body: parseMath(m[0]) }];
      }
      return [{ t: 'text', v: '√' }];
    }
    if (c === '{') {
      this.i++;
      const body = this.list('}');
      this.i++;
      return body;
    }
    if (c === '}') {
      this.i++;
      return null;
    }
    this.i++;
    void prev;
    if (/[a-z]/.test(c)) return [{ t: 'text', v: c, italic: true, bold: true }];
    if (c in WIDE) return [{ t: 'text', v: WIDE[c] }];
    return [{ t: 'text', v: c }];
  }
}

function flat(ps: Piece[]): string {
  return ps.map((p) => (p.t === 'text' ? p.v : p.t === 'frac' ? `${flat(p.num)}/${flat(p.den)}` : `√${flat(p.body)}`)).join('');
}

/** 同じ書式で続く文字をまとめる。 */
function merge(ps: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of ps) {
    const last = out[out.length - 1];
    if (p.t === 'text' && last && last.t === 'text' && !!last.italic === !!p.italic && !!last.bold === !!p.bold && !!last.sup === !!p.sup && !!last.sub === !!p.sub) {
      last.v += p.v;
    } else {
      out.push(p.t === 'text' ? { ...p } : p);
    }
  }
  return out;
}

/** 部品を、記号を外した文字にする（ファイル名・ログ・確かめ用）。 */
export function piecesToPlain(ps: Piece[]): string {
  return flat(ps);
}

/** 全角の数字（問１・（１）の番号に使う）。10 以上は半角のまま。 */
export function wideNum(n: number): string {
  return n >= 10 ? String(n) : String(n).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0));
}
