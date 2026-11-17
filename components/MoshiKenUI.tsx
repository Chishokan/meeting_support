'use client';

// 県一斉模試の成績表・面談（成績表の画面・面談の画面で「見る模試：県一斉模試」を選んだとき）。
// 取り込んだ県一斉模試の成績だけで出す。氏名は本番レベル模試の名簿から「校舎＋受験番号」で引く（lib/moshi/model.ts の kenNames）。
//   - 成績表：一覧（5教科の高い順。印刷・CSV）と、個人成績表（1人1枚 A4 横。選んだ人をまとめて印刷）
//   - 面談：生徒を1人選んで、業者の成績の画面のような詳しい成績（components/MoshiKenDetail.tsx）を出す。前回の県一斉模試との差。
//     「大きく表示」でほかの生徒の名前を隠す。印刷は個人成績表（A4 横）

import { useEffect, useMemo, useState } from 'react';
import {
  KEN_SLOTS, SUBJECT_KEYS, SUBJECT_SHORT, campusInfo, kenNames, kenStatsOf, toCsv,
  type ExamStats, type KenRow, type KenStats, type KenitsuExam, type KenitsuResult, type MoshiExam, type MoshiResult,
} from '@/lib/moshi/model';
import { FitSheet } from './MoshiReportSheet';
import { KenReportSheet, kenBefore } from './MoshiKenSheet';
import { KenDetail } from './MoshiKenDetail';
import { KenBar, NoKenNote, campusLabel, downloadCsv, fmt1, printLandscape, printPortrait } from './MoshiShared';

type Common = {
  kenitsu: KenitsuResult[];
  kenList: KenitsuExam[];
  kenExam: KenitsuExam | null;
  onKen: (id: string) => void;
  campus: string;
  onCampus: (c: string) => void;
  exams: MoshiExam[];
  results: MoshiResult[];
  statsList: ExamStats[];
};

/** その回の行（校舎で絞る）を、5教科の高い順（同点・未受験は受験番号順）に。 */
function useKenRows({ kenitsu, kenExam, campus, exams, results }: Pick<Common, 'kenitsu' | 'kenExam' | 'campus' | 'exams' | 'results'>) {
  const names = useMemo(() => kenNames(results, exams), [results, exams]);
  const ks = useMemo(() => (kenExam ? kenStatsOf(kenitsu, kenExam.id, names) : null), [kenitsu, kenExam, names]);
  const rows = useMemo(() => {
    if (!ks) return [] as KenRow[];
    return ks.rows
      .filter((x) => !campus || x.k.campus === campus)
      .sort((a, b) => (b.k.stats.k5?.score ?? -1) - (a.k.stats.k5?.score ?? -1) || a.k.campus.localeCompare(b.k.campus) || a.k.examNo.localeCompare(b.k.examNo));
  }, [ks, campus]);
  return { ks, rows };
}

function rowKey(x: KenRow): string {
  return `${x.k.campus}|${x.k.examNo}`;
}

function displayName(x: KenRow): string {
  return x.name || '（名簿に無い）';
}

// ---- 成績表 ------------------------------------------------------------------

export function KenReportView(p: Common) {
  const { ks, rows } = useKenRows(p);
  const [tab, setTab] = useState<'list' | 'cards'>('list');
  if (!p.kenExam || !ks) return <NoKenNote />;
  return (
    <>
      <KenBar kenList={p.kenList} kenId={p.kenExam.id} campus={p.campus} onKen={p.onKen} onCampus={p.onCampus} />
      <div className="ms-toolbar ms-noprint">
        <div className="ms-seg" role="tablist">
          <button type="button" className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>一覧</button>
          <button type="button" className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>個人成績表</button>
        </div>
        <span className="ms-muted">中等部の受験者 {ks.rows.length}人（5教科 {ks.n.k5}人）</span>
      </div>
      {tab === 'list' ? <KenList ks={ks} rows={rows} campus={p.campus} /> : <KenCards ks={ks} rows={rows} kenitsu={p.kenitsu} statsList={p.statsList} />}
    </>
  );
}

function KenList({ ks, rows, campus }: { ks: KenStats; rows: KenRow[]; campus: string }) {
  const { exam } = ks;
  const noName = rows.filter((x) => !x.name).length;
  function csv() {
    const head = ['塾内順位', '校舎', '受験番号', '氏名', '国語', '英語', '数学', '社会', '理科', '3教科', '5教科', '5教科偏差値', '5教科県内順位',
      ...KEN_SLOTS.flatMap((s) => [`${s} 志望校`, `${s} 判定`, `${s} 合格確率`])];
    const body = rows.map((x) => [
      x.inside.k5 ?? '', x.k.campus, x.k.examNo, x.name,
      ...SUBJECT_KEYS.map((k) => x.k.stats[k]?.score ?? ''), x.k.stats.k3?.score ?? '', x.k.stats.k5?.score ?? '',
      x.k.stats.k5?.dev == null ? '' : fmt1(x.k.stats.k5.dev), x.k.stats.k5?.rank ?? '',
      ...x.k.choices.flatMap((c) => [c.name || c.code, c.judge, c.prob]),
    ]);
    downloadCsv(`${exam.name}_一覧_${campus || '全校舎'}.csv`, toCsv([head, ...body]));
  }
  return (
    <section className="ms-sheet">
      <div className="ms-toolbar ms-noprint">
        <button type="button" className="ms-btn" onClick={printPortrait}>印刷する</button>
        <button type="button" className="ms-btn ms-btn-sub" onClick={csv} disabled={!rows.length}>CSV で書き出す</button>
      </div>
      <h2 className="ms-print-title">{exam.name}　一覧（{campusLabel(campus)}）</h2>
      <table className="ms-table ms-rank">
        <thead>
          <tr>
            <th>塾内</th><th>校舎</th><th>受験番号</th><th>氏名</th>
            {SUBJECT_KEYS.map((k) => <th key={k}>{SUBJECT_SHORT[k]}</th>)}
            <th>5教科</th><th>偏差値</th><th>県内順位</th><th>第1志望（公立）</th><th>判定</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={rowKey(x)}>
              <td className="num">{x.inside.k5 ?? ''}</td>
              <td>{x.k.campus}</td>
              <td className="num">{x.k.examNo}</td>
              <td className="ms-name">{x.name || <span className="ms-muted">（名簿に無い）</span>}</td>
              {SUBJECT_KEYS.map((k) => <td key={k} className="num">{x.k.stats[k]?.score ?? ''}</td>)}
              <td className="num"><b>{x.k.stats.k5?.score ?? ''}</b></td>
              <td className="num">{fmt1(x.k.stats.k5?.dev)}</td>
              <td className="num">{x.k.stats.k5?.rank ?? ''}</td>
              <td className="ms-school">{x.k.choices[0]?.name || x.k.choices[0]?.code || ''}</td>
              <td>{x.k.choices[0]?.judge ?? ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={4}>塾内平均（全校舎・{ks.n.k5}人）</th>
            {SUBJECT_KEYS.map((k) => <td key={k} className="num">{fmt1(ks.mean[k])}</td>)}
            <td className="num">{fmt1(ks.mean.k5)}</td>
            <td colSpan={4}></td>
          </tr>
        </tfoot>
      </table>
      <p className="ms-fine">
        得点・偏差値・県内順位・判定は県一斉模試の集計（県全体）の値。塾内順位は、この回を受けた智翔館 中等部の生徒の中での5教科の順位。
        {noName > 0 && `「名簿に無い」${noName}人は、本番レベル模試の名簿に同じ校舎・受験番号の人がいない生徒（「県一斉模試の取り込み」の名簿で入れられます）。`}
      </p>
    </section>
  );
}

function KenCards({ ks, rows, kenitsu, statsList }: { ks: KenStats; rows: KenRow[]; kenitsu: KenitsuResult[]; statsList: ExamStats[] }) {
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [focus, setFocus] = useState('');
  const [printing, setPrinting] = useState<KenRow[]>([]);
  const list = useMemo(() => [...rows].sort((a, b) => a.k.campus.localeCompare(b.k.campus) || a.k.examNo.localeCompare(b.k.examNo)), [rows]);
  const sel = checked ?? new Set(list.map(rowKey));
  const focusRow = list.find((x) => rowKey(x) === focus) ?? list[0] ?? null;
  function toggle(id: string) {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else n.add(id);
    setChecked(n);
  }
  return (
    <section className="ms-cards-tab">
      <div className="ms-toolbar ms-noprint">
        <button type="button" className="ms-btn" disabled={!sel.size} onClick={() => printLandscape(() => setPrinting(list.filter((x) => sel.has(rowKey(x)))))}>選んだ {sel.size}人の成績表を印刷</button>
        <button type="button" className="ms-btn ms-btn-sub" onClick={() => setChecked(new Set(list.map(rowKey)))}>すべて選ぶ</button>
        <button type="button" className="ms-btn ms-btn-sub" onClick={() => setChecked(new Set())}>すべて外す</button>
        <span className="ms-muted">1人1枚（A4・横）。印刷の画面で「背景のグラフィック」を入れると色が出ます。</span>
      </div>
      <div className="ms-split ms-noprint">
        <ul className="ms-pick">
          {list.map((x) => (
            <li key={rowKey(x)} className={focusRow && rowKey(focusRow) === rowKey(x) ? 'on' : ''}>
              <input type="checkbox" checked={sel.has(rowKey(x))} onChange={() => toggle(rowKey(x))} aria-label={`${displayName(x)}を印刷に入れる`} />
              <button type="button" onClick={() => setFocus(rowKey(x))}>
                <span className="ms-pick-no">{x.k.examNo}</span>
                <span className="ms-pick-name">{displayName(x)}</span>
                <span className="ms-pick-score">{x.k.stats.k5?.score ?? '—'}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="ms-preview">
          {focusRow
            ? <FitSheet><KenReportSheet ks={ks} row={focusRow} kenitsu={kenitsu} statsList={statsList} /></FitSheet>
            : <p className="ms-note">生徒を選ぶと、ここに成績表が出ます。</p>}
        </div>
      </div>
      <div className="ms-print-only">
        {printing.map((x) => (
          <div key={rowKey(x)} className="ms-page"><KenReportSheet ks={ks} row={x} kenitsu={kenitsu} statsList={statsList} /></div>
        ))}
      </div>
    </section>
  );
}

// ---- 面談 --------------------------------------------------------------------

export function KenInterviewView(p: Common) {
  const { ks, rows } = useKenRows(p);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState('');
  const [big, setBig] = useState(false);
  const [printing, setPrinting] = useState(false);
  const list = useMemo(() => {
    const k = q.replace(/[\s　]/g, '');
    return [...rows]
      .filter((x) => !k || x.name.replace(/[\s　]/g, '').includes(k) || x.k.examNo.includes(k))
      .sort((a, b) => a.k.campus.localeCompare(b.k.campus) || a.k.examNo.localeCompare(b.k.examNo));
  }, [rows, q]);
  const row = list.find((x) => rowKey(x) === sel) ?? list[0] ?? null;
  const idx = row ? list.findIndex((x) => rowKey(x) === rowKey(row)) : -1;

  useEffect(() => {
    document.body.classList.toggle('ms-focus', big);
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    if (big) window.addEventListener('keydown', h);
    return () => { window.removeEventListener('keydown', h); document.body.classList.remove('ms-focus'); };
  }, [big]);

  if (!p.kenExam || !ks) return <NoKenNote />;
  const before = row ? kenBefore(p.kenitsu, ks, row) : null;

  return (
    <div className={`ms-interview${big ? ' big' : ''}`}>
      {!big && <KenBar kenList={p.kenList} kenId={p.kenExam.id} campus={p.campus} onKen={p.onKen} onCampus={p.onCampus} />}
      <div className="ms-split">
        {!big && (
          <aside className="ms-noprint">
            <input className="ms-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="氏名・受験番号で探す" />
            <ul className="ms-pick">
              {list.map((x) => (
                <li key={rowKey(x)} className={row && rowKey(row) === rowKey(x) ? 'on' : ''}>
                  <button type="button" onClick={() => setSel(rowKey(x))}>
                    <span className="ms-pick-no">{x.k.examNo}</span>
                    <span className="ms-pick-name">{displayName(x)}</span>
                    <span className="ms-pick-score">{x.inside.k5 ? `${x.inside.k5}位` : '—'}</span>
                  </button>
                </li>
              ))}
              {!list.length && <li className="ms-muted">見つかりません</li>}
            </ul>
          </aside>
        )}
        <div className="ms-preview">
          {!row ? <p className="ms-note">この回・校舎の生徒がいません。</p> : (
            <>
              <div className="ms-toolbar ms-noprint">
                <button type="button" className="ms-btn ms-btn-sub" disabled={idx <= 0} onClick={() => setSel(rowKey(list[idx - 1]))}>← 前の生徒</button>
                <button type="button" className="ms-btn ms-btn-sub" disabled={idx < 0 || idx >= list.length - 1} onClick={() => setSel(rowKey(list[idx + 1]))}>次の生徒 →</button>
                <span className="ms-spacer" />
                <button type="button" className="ms-btn ms-btn-sub" onClick={() => setBig((b) => !b)}>{big ? '一覧に戻る（Esc）' : '大きく表示'}</button>
                <button type="button" className="ms-btn" onClick={() => printLandscape(() => setPrinting(true))}>成績表を印刷</button>
              </div>
              {before && <KenCompare before={before} now={row.k} />}
              <div className="ms-noprint">
                <KenDetail ks={ks} row={row} kenitsu={p.kenitsu} statsList={p.statsList} onPickExam={p.onKen} />
              </div>
              {!row.name && (
                <p className="ms-fine ms-noprint">
                  {campusInfo(row.k.campus)?.label} {row.k.examNo} は、本番レベル模試の名簿に同じ校舎・受験番号の人がいないため、氏名が出ていません（「県一斉模試の取り込み」の名簿で入れられます）。
                </p>
              )}
              {printing && (
                <div className="ms-print-only">
                  <div className="ms-page"><KenReportSheet ks={ks} row={row} kenitsu={p.kenitsu} statsList={p.statsList} /></div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function diff(n: number, unit: string, digits = 0): string {
  const v = digits ? Math.round(n * 10) / 10 : Math.round(n);
  if (v === 0) return `±0${unit}`;
  return `${v > 0 ? '+' : ''}${digits ? v.toFixed(1) : v}${unit}`;
}

/** 前回の県一斉模試との差（5教科の得点・偏差値・県内順位）。 */
function KenCompare({ before, now }: { before: KenitsuResult; now: KenitsuResult }) {
  const b = before.stats.k5;
  const n = now.stats.k5;
  if (b?.score == null || n?.score == null) return null;
  const up = n.score - b.score;
  return (
    <div className="ms-compare ms-noprint">
      <span className="ms-compare-h">前回（{before.examName.replace('長崎県一斉模試 ', '')}）との比較</span>
      <span>5教科 <b className={up > 0 ? 'up' : up < 0 ? 'down' : ''}>{diff(up, '点')}</b>（{b.score} → {n.score}）</span>
      {b.dev != null && n.dev != null && <span>偏差値 <b>{diff(n.dev - b.dev, '', 1)}</b>（{fmt1(b.dev)} → {fmt1(n.dev)}）</span>}
      {b.rank != null && n.rank != null && <span>県内順位 {b.rank}位 → <b>{n.rank}位</b></span>}
    </div>
  );
}
