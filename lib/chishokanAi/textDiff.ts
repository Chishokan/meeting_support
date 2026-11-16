// 2つの文の違い（コンテキストの直し案を「変更前・変更後」で見比べるため）。ほかに依存しない。
//
// 頭とお尻の同じ部分を先に除き、残りを1文字ずつ比べる（長いときは文・行の単位）。
// 日本語は1文字ずつだと「の」「を」だけが偶然一致して細切れになるので、短い一致は変わった所に含めてまとめる。

export type DiffPart = { kind: 'same' | 'del' | 'add'; text: string };

/** 比べる表の大きさの上限（これを超えると、文の単位でも比べず「全部入れ替え」として出す）。 */
const MAX_CELLS = 2_500_000;
/** 変わった所にはさまれた、この長さ以下の一致は、変わった所に含める。 */
const MIN_SAME = 2;

function sentences(s: string): string[] {
  return s.match(/[^。．！？!?\n]*(?:[。．！？!?]+|\n|$)/g)?.filter((x) => x !== '') ?? [s];
}

function lcs(a: string[], b: string[]): DiffPart[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const T = n + 1 < 65_535 && m + 1 < 65_535 ? new Uint16Array((n + 1) * w) : new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      T[i * w + j] = a[i] === b[j] ? T[(i + 1) * w + j + 1] + 1 : Math.max(T[(i + 1) * w + j], T[i * w + j + 1]);
    }
  }
  const out: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (T[(i + 1) * w + j] >= T[i * w + j + 1]) out.push({ kind: 'del', text: a[i++] });
    else out.push({ kind: 'add', text: b[j++] });
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] });
  while (j < m) out.push({ kind: 'add', text: b[j++] });
  return out;
}

/** 同じ種類をつなぎ、変わった所のまとまりは「消した文 → 足した文」の順にそろえる。 */
function tidy(parts: DiffPart[]): DiffPart[] {
  // 短い一致が変わった所にはさまれていたら、変わった所に含める
  const folded: DiffPart[] = [];
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    const prev = parts[k - 1];
    const next = parts[k + 1];
    if (p.kind === 'same' && p.text.length <= MIN_SAME && prev && next && prev.kind !== 'same' && next.kind !== 'same') {
      folded.push({ kind: 'del', text: p.text }, { kind: 'add', text: p.text });
    } else folded.push(p);
  }
  const out: DiffPart[] = [];
  let del = '';
  let add = '';
  const flush = () => {
    if (del) out.push({ kind: 'del', text: del });
    if (add) out.push({ kind: 'add', text: add });
    del = '';
    add = '';
  };
  for (const p of folded) {
    if (p.kind === 'del') del += p.text;
    else if (p.kind === 'add') add += p.text;
    else {
      flush();
      const last = out[out.length - 1];
      if (last?.kind === 'same') last.text += p.text;
      else out.push({ ...p });
    }
  }
  flush();
  return out;
}

export function diffText(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: 'same', text: before }] : [];
  let s = 0;
  const max = Math.min(before.length, after.length);
  while (s < max && before[s] === after[s]) s++;
  let e = 0;
  while (e < max - s && before[before.length - 1 - e] === after[after.length - 1 - e]) e++;
  // 絵文字など2つで1文字のもの（サロゲートペア）の途中で切らない
  const high = (c: number) => c >= 0xd800 && c <= 0xdbff;
  if (s > 0 && high(before.charCodeAt(s - 1))) s--;
  if (e > 0 && high(before.charCodeAt(before.length - 1 - e))) e--;
  const head = before.slice(0, s);
  const tail = e ? before.slice(before.length - e) : '';
  const a = before.slice(s, before.length - e);
  const b = after.slice(s, after.length - e);
  let mid: DiffPart[];
  if (!a || !b) mid = [...(a ? [{ kind: 'del' as const, text: a }] : []), ...(b ? [{ kind: 'add' as const, text: b }] : [])];
  else if (a.length * b.length <= MAX_CELLS) mid = lcs([...a], [...b]);
  else {
    const sa = sentences(a);
    const sb = sentences(b);
    mid = sa.length * sb.length <= MAX_CELLS ? lcs(sa, sb) : [{ kind: 'del', text: a }, { kind: 'add', text: b }];
  }
  return tidy([...(head ? [{ kind: 'same' as const, text: head }] : []), ...mid, ...(tail ? [{ kind: 'same' as const, text: tail }] : [])]);
}

/** 変わった字数（消した分＋足した分）。 */
export function changedChars(parts: DiffPart[]): number {
  return parts.reduce((n, p) => n + (p.kind === 'same' ? 0 : p.text.length), 0);
}
