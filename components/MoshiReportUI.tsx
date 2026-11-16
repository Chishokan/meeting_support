'use client';

// 本番レベル模試：成績表・順位表（/moshi/report）。
//   - 順位表：5教科合計の高い順（入力シートの「順位表」タブに当たる）。印刷・CSV
//   - 平均点：全体と校舎ごとの平均点、大問ごとの平均得点率
//   - 個人成績表：生徒を選んで、1人1枚（A4）で印刷する
// 順位・偏差値は智翔館の受験者の中でのもの（lib/moshi/model.ts の computeStats）。

import { useMemo, useState } from 'react';
import {
  SUBJECT_KEYS, SUBJECT_NAMES, SUBJECT_SHORT, byExamNo, campusInfo, computeStats, examMax, historyOf, rankedRows,
  subjectMax, subjectOf, toCsv,
  type ExamStats, type RowStat,
} from '@/lib/moshi/model';
import { schoolName } from '@/lib/moshi/schools';
import {
  ExamCampusBar, PageHead, ReportCard, StateNote, campusLabel, downloadCsv, fmt1, pct, printAfterRender,
  useExamCampus, useMoshiData,
} from './MoshiShared';

type Tab = 'rank' | 'avg' | 'cards';

export default function MoshiReportUI({ name }: { name: string }) {
  const { state, reload } = useMoshiData();
  const exams = state.status === 'ready' ? state.exams : [];
  const results = state.status === 'ready' ? state.results : [];
  const { exam, examId, campus, pickExam, pickCampus } = useExamCampus(exams, { allowAll: true, withData: results });
  const [tab, setTab] = useState<Tab>('rank');
  const statsList = useMemo(() => exams.map((e) => computeStats(e, results)), [exams, results]);
  const stats = statsList.find((s) => s.exam.id === examId) ?? null;

  if (state.status !== 'ready' || !exams.length || !exam || !stats) {
    return (
      <div className="ms">
        <PageHead title="本番レベル模試｜成績表・順位表" desc="順位表・平均点・個人成績表を出します。" name={name} />
        <div className="ms-body"><StateNote state={state} onRetry={reload} /></div>
      </div>
    );
  }

  return (
    <div className="ms">
      <PageHead title="本番レベル模試｜成績表・順位表" desc="順位表・平均点・個人成績表（1人1枚）を画面で見て、印刷やCSVで出します。" name={name} />
      <div className="ms-body">
        <ExamCampusBar exams={exams} examId={examId} campus={campus} onExam={pickExam} onCampus={pickCampus} allowAll />
        <div className="ms-toolbar ms-noprint">
          <div className="ms-seg" role="tablist">
            <button type="button" className={tab === 'rank' ? 'on' : ''} onClick={() => setTab('rank')}>順位表</button>
            <button type="button" className={tab === 'avg' ? 'on' : ''} onClick={() => setTab('avg')}>平均点</button>
            <button type="button" className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>個人成績表</button>
          </div>
          <span className="ms-muted">全校舎の受験者 {stats.entered}人（5教科そろった人 {stats.complete}人）</span>
        </div>
        {tab === 'rank' && <RankTab stats={stats} campus={campus} />}
        {tab === 'avg' && <AvgTab stats={stats} />}
        {tab === 'cards' && <CardsTab stats={stats} statsList={statsList} campus={campus} />}
      </div>
    </div>
  );
}

// ---- 順位表 ----------------------------------------------------------------

function RankTab({ stats, campus }: { stats: ExamStats; campus: string }) {
  const { exam } = stats;
  const rows = rankedRows(stats, campus || undefined);
  const ranked = rows.filter((x) => x.total != null);
  const rest = rows.filter((x) => x.total == null && SUBJECT_KEYS.some((k) => x.sub[k] != null));
  const none = rows.filter((x) => SUBJECT_KEYS.every((k) => x.sub[k] == null));

  function csv() {
    const head = ['順位', '校舎内順位', '校舎', '受験番号', '氏名', ...SUBJECT_KEYS.map((k) => SUBJECT_NAMES[k]), '合計', '偏差値', '第一志望', '第二志望', '第三志望', '第四志望'];
    const body = rows.map((x) => [
      x.rank ?? '', x.campusRank ?? '', x.r.campus, x.r.examNo, x.r.name,
      ...SUBJECT_KEYS.map((k) => x.sub[k] ?? ''), x.total ?? '', x.dev == null ? '' : fmt1(x.dev),
      ...x.r.choices.map(schoolName),
    ]);
    downloadCsv(`${exam.name}_順位表_${campus || '全校舎'}.csv`, toCsv([head, ...body]));
  }

  return (
    <section className="ms-sheet">
      <div className="ms-toolbar ms-noprint">
        <button type="button" className="ms-btn" onClick={() => window.print()}>印刷する</button>
        <button type="button" className="ms-btn ms-btn-sub" onClick={csv} disabled={!rows.length}>CSV で書き出す</button>
      </div>
      <h2 className="ms-print-title">{exam.name}　順位表（{campusLabel(campus)}）</h2>
      {!ranked.length ? <p className="ms-note">5教科すべての得点が入った人がまだいません。</p> : (
        <table className="ms-table ms-rank">
          <thead>
            <tr>
              <th>順位</th><th>校舎内</th><th>校舎</th><th>受験番号</th><th>氏名</th>
              {SUBJECT_KEYS.map((k) => <th key={k}>{SUBJECT_SHORT[k]}</th>)}
              <th>合計</th><th>偏差値</th><th>第一志望</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((x) => (
              <tr key={x.r.id}>
                <td className="num">{x.rank}</td>
                <td className="num">{x.campusRank}</td>
                <td>{x.r.campus}</td>
                <td className="num">{x.r.examNo}</td>
                <td className="ms-name">{x.r.name}</td>
                {SUBJECT_KEYS.map((k) => <td key={k} className="num">{x.sub[k]}</td>)}
                <td className="num"><b>{x.total}</b></td>
                <td className="num">{fmt1(x.dev)}</td>
                <td className="ms-school">{schoolName(x.r.choices[0] ?? '')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={5}>平均（{campusLabel(campus)}・{ranked.length}人）</th>
              {SUBJECT_KEYS.map((k) => <td key={k} className="num">{fmt1((campus ? stats.byCampus[campus] : stats.overall)?.sub[k]?.mean)}</td>)}
              <td className="num">{fmt1((campus ? stats.byCampus[campus] : stats.overall)?.total?.mean)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      )}
      {rest.length > 0 && (
        <>
          <h3 className="ms-h3">5教科がそろっていない人（順位・偏差値なし）</h3>
          <table className="ms-table ms-rank">
            <thead><tr><th>校舎</th><th>受験番号</th><th>氏名</th>{SUBJECT_KEYS.map((k) => <th key={k}>{SUBJECT_SHORT[k]}</th>)}<th>入っていない教科</th></tr></thead>
            <tbody>
              {rest.map((x) => (
                <tr key={x.r.id}>
                  <td>{x.r.campus}</td><td className="num">{x.r.examNo}</td><td className="ms-name">{x.r.name}</td>
                  {SUBJECT_KEYS.map((k) => <td key={k} className="num">{x.sub[k] ?? ''}</td>)}
                  <td>{SUBJECT_KEYS.filter((k) => x.sub[k] == null).map((k) => SUBJECT_NAMES[k]).join('・')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {none.length > 0 && (
        <p className="ms-fine">得点が1つも入っていない人（未受験・未入力）：{none.length}人（{none.map((x) => x.r.name || x.r.examNo).join('、')}）</p>
      )}
      <p className="ms-fine">順位・偏差値は、この回を受けた智翔館の中3生のうち5教科がそろった {stats.complete}人の中でのもの。同点は同じ順位。</p>
    </section>
  );
}

// ---- 平均点 ----------------------------------------------------------------

function AvgTab({ stats }: { stats: ExamStats }) {
  const { exam } = stats;
  const campuses = Object.keys(stats.byCampus).sort((a, b) => (campusInfo(a)?.prefix ?? a).localeCompare(campusInfo(b)?.prefix ?? b));
  const groups = [{ label: '全体', g: stats.overall }, ...campuses.map((c) => ({ label: campusInfo(c)?.label ?? c, g: stats.byCampus[c] }))];
  return (
    <section className="ms-sheet">
      <div className="ms-toolbar ms-noprint">
        <button type="button" className="ms-btn" onClick={() => window.print()}>印刷する</button>
      </div>
      <h2 className="ms-print-title">{exam.name}　平均点</h2>
      <table className="ms-table ms-avg">
        <thead>
          <tr>
            <th></th><th>人数</th>
            {SUBJECT_KEYS.map((k) => <th key={k}>{SUBJECT_NAMES[k]}<small>／{subjectMax(exam, k)}</small></th>)}
            <th>合計<small>／{examMax(exam)}</small></th><th>最高</th><th>最低</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ label, g }) => (
            <tr key={label} className={label === '全体' ? 'ms-sum' : ''}>
              <th>{label}</th>
              <td className="num">{g.total?.n ?? 0}</td>
              {SUBJECT_KEYS.map((k) => <td key={k} className="num">{fmt1(g.sub[k]?.mean)}</td>)}
              <td className="num"><b>{fmt1(g.total?.mean)}</b></td>
              <td className="num">{g.total?.max ?? '—'}</td>
              <td className="num">{g.total?.min ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ms-fine">人数は5教科そろった人。教科の平均は、その教科を受けた人の平均。</p>

      <h3 className="ms-h3">大問ごとの平均得点率</h3>
      <div className="ms-avg-topics">
        {SUBJECT_KEYS.map((k) => (
          <table key={k} className="ms-table ms-avg-q">
            <thead>
              <tr><th colSpan={2}>{SUBJECT_NAMES[k]}</th><th>配点</th><th>全体</th>{campuses.map((c) => <th key={c}>{(campusInfo(c)?.label ?? c).replace('佐世保', '')}</th>)}</tr>
            </thead>
            <tbody>
              {subjectOf(exam, k).questions.map((q, i) => {
                const all = (stats.overall.questionMean[k][i] ?? 0) / q.max;
                return (
                  <tr key={i}>
                    <td className="num">{i + 1}</td>
                    <td>{q.topic || '—'}</td>
                    <td className="num">{q.max}</td>
                    <td className={`num${all < 0.5 ? ' ms-low' : ''}`}>{stats.overall.sub[k] ? pct(all) : '—'}</td>
                    {campuses.map((c) => {
                      const g = stats.byCampus[c];
                      const r = (g.questionMean[k][i] ?? 0) / q.max;
                      return <td key={c} className="num">{g.sub[k] ? pct(r) : '—'}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
      <p className="ms-fine">太字の赤は全体の得点率が50%未満の大問（授業で取り上げる候補）。</p>
    </section>
  );
}

// ---- 個人成績表 -------------------------------------------------------------

function CardsTab({ stats, statsList, campus }: { stats: ExamStats; statsList: ExamStats[]; campus: string }) {
  const list = byExamNo(stats.rows.filter((x) => (!campus || x.r.campus === campus)).map((x) => ({ ...x, examNo: x.r.examNo, name: x.r.name })));
  const takers = list.filter((x) => SUBJECT_KEYS.some((k) => x.sub[k] != null));
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [focus, setFocus] = useState('');
  const [printing, setPrinting] = useState<RowStat[]>([]);
  const sel = checked ?? new Set(takers.map((x) => x.r.id));
  const focusRow = list.find((x) => x.r.id === focus) ?? takers[0] ?? null;

  function toggle(id: string) {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id); else n.add(id);
    setChecked(n);
  }
  function print(rows: RowStat[]) {
    printAfterRender(() => setPrinting(rows));
  }

  return (
    <section className="ms-cards-tab">
      <div className="ms-toolbar ms-noprint">
        <button type="button" className="ms-btn" disabled={!sel.size} onClick={() => print(list.filter((x) => sel.has(x.r.id)))}>選んだ {sel.size}人の成績表を印刷</button>
        <button type="button" className="ms-btn ms-btn-sub" onClick={() => setChecked(new Set(takers.map((x) => x.r.id)))}>すべて選ぶ</button>
        <button type="button" className="ms-btn ms-btn-sub" onClick={() => setChecked(new Set())}>すべて外す</button>
        <span className="ms-muted">1人1枚（A4・縦）。印刷の画面で「背景のグラフィック」を入れると色が出ます。</span>
      </div>
      <div className="ms-split ms-noprint">
        <ul className="ms-pick">
          {list.map((x) => {
            const taken = SUBJECT_KEYS.some((k) => x.sub[k] != null);
            return (
              <li key={x.r.id} className={focusRow?.r.id === x.r.id ? 'on' : ''}>
                <input type="checkbox" checked={sel.has(x.r.id)} disabled={!taken} onChange={() => toggle(x.r.id)} aria-label={`${x.r.name}を印刷に入れる`} />
                <button type="button" onClick={() => setFocus(x.r.id)}>
                  <span className="ms-pick-no">{x.r.examNo}</span>
                  <span className="ms-pick-name">{x.r.name || '（氏名なし）'}</span>
                  <span className="ms-pick-score">{taken ? (x.total ?? '途中') : '未受験'}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="ms-preview">
          {focusRow && SUBJECT_KEYS.some((k) => focusRow.sub[k] != null)
            ? <ReportCard stats={stats} row={focusRow} history={historyOf(statsList, focusRow.r)} />
            : <p className="ms-note">得点が入っている生徒を選ぶと、ここに成績表が出ます。</p>}
        </div>
      </div>
      <div className="ms-print-only">
        {printing.map((x) => (
          <div key={x.r.id} className="ms-page">
            <ReportCard stats={stats} row={x} history={historyOf(statsList, x.r)} />
          </div>
        ))}
      </div>
    </section>
  );
}

