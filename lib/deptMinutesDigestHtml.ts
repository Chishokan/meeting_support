// 議事録の1枚まとめ（Digest）を、Google ドキュメントに取り込むための HTML にする。
// 週ごとのまとめ（scripts/minutes-digest-files.mjs）で、Google ドライブに Google ドキュメントとして保存するのに使う。
//
// Claude の Google ドライブ連携は PDF・Word をそのまま上げられない（中身を文字として渡すため）。
// そこで同じ内容を短い HTML にして渡し、ドライブ側で Google ドキュメントに変換させる。
// 体裁どおりの PDF・Word はアプリに届ける。ここは飾りを見出し・表・太字・黄色のマーカーに絞り、小さく保つ。
// テスト: lib/deptMinutesDigest.test.ts

import type { Digest } from './deptMinutesDigest';

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 【要確認】は黄色のマーカー
const fmt = (s: string) => esc(s).replace(/【要確認】/g, '<b style="background:#fff2cc">要確認</b>');

function one(d: Digest, no: string): string {
  const out: string[] = [];
  out.push(`<p style="color:#5a6375">${esc(d.dept)}｜部門会議 議事録まとめ${no ? `｜${no}` : ''}${d.revised ? '｜修正版' : ''}</p>`);
  out.push(`<h1>${esc(d.title)}　${esc(d.date)}</h1>`);
  out.push(`<p><b>場所</b> ${fmt(d.place)}　<b>出席者</b> ${fmt(d.attendees)}　<b>記録者</b> ${fmt(d.recorder)}</p>`);
  if (d.purpose) out.push(`<p><b>目的</b> ${fmt(d.purpose)}</p>`);
  out.push(`<p><b>概要</b> ${fmt(d.summary || '（要約なし）')}</p>`);
  if (d.decisions.length) {
    out.push(`<h2>決定事項（${d.decisions.length}件）</h2><ol>`);
    for (const x of d.decisions) {
      const tags = [x.owner && `担当：${x.owner}`, x.due && `期限：${x.due}`].filter(Boolean).join('／');
      out.push(`<li>${x.title ? `<b>${fmt(x.title)}</b>　` : ''}${fmt(x.detail)}${tags ? `　〔${fmt(tags)}〕` : ''}</li>`);
    }
    out.push('</ol>');
  }
  if (d.todos.length) {
    const st = d.todos.some((t) => t.status);
    out.push(`<h2>ToDo（${d.todos.length}件）</h2><table border="1" cellpadding="3" style="border-collapse:collapse">`);
    out.push(`<tr style="background:#f3f5f9">${st ? '<th>状況</th>' : ''}<th>内容</th><th>担当</th><th>期限</th></tr>`);
    for (const t of d.todos) {
      const mark = t.status === 'done' ? '〇' : t.status === 'not_done' ? '×' : '';
      out.push(`<tr>${st ? `<td>${mark}</td>` : ''}<td>${fmt(t.task)}</td><td>${fmt(t.owner || '—')}</td><td>${fmt(t.due || '—')}</td></tr>`);
    }
    out.push('</table>');
  }
  const list = (title: string, items: string[]) => {
    if (items.length) out.push(`<h2>${title}</h2><ul>${items.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul>`);
  };
  list('継続審議・保留', d.pending);
  list('報告・共有', d.reports);
  out.push(`<p><b>次回会議</b> ${fmt(d.next || '【要確認】')}</p>`);
  if (d.checks.length) out.push(`<p style="background:#fffbef"><b>要確認</b></p><ul>${d.checks.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul>`);
  out.push(`<p style="color:#5a6375">出典：会議DX「部門会議議事録」${d.id ? `（議事録ID ${esc(d.id.slice(0, 8))}…）` : ''}　※生徒の氏名は省略　${esc(d.createdAt)} 作成</p>`);
  return out.join('\n');
}

/** 会議ごとに改ページした HTML（1会議目の前には改ページを入れない）。 */
export function digestsHtml(ds: Digest[], title: string): string {
  const body = ds
    .map((d, i) => (i > 0 ? '<br style="page-break-before:always">\n' : '') + one(d, ds.length > 1 ? `No. ${i + 1} / ${ds.length}` : ''))
    .join('\n');
  return `<html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>\n${body}\n</body></html>\n`;
}
