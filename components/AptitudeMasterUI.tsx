'use client';

// 適性検査：設問・尺度・判定基準の版管理。
//   公開中・終了した版は読み取り専用（その版で受けた結果が、その版の設問・基準で計算されているため）。
//   直すときは「コピーして下書きを作る」→ 下書きを編集 → 「公開する」。公開すると、それ以降に発行する
//   受検URL・紙回答の入力はその版で採点する。すでに受けた結果は受けたときの版のまま。

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ROLES, ROLE_LABEL, SCALE_KINDS,
  type Question, type Role, type RoleRule, type Scale, type ScaleCode, type Version, type VersionDetail,
} from '@/lib/aptitude/model';
import { api, failText, jpDateTime } from '@/lib/aptitude/client';

type Tab = 'questions' | 'scales' | 'rules';

const VERSION_CLASS: Record<string, string> = { 公開: 'done', 下書き: 'doing', 終了: 'off' };

export default function AptitudeMasterUI() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [sel, setSel] = useState('');
  const [v, setV] = useState<VersionDetail | null>(null);
  const [used, setUsed] = useState(0);
  const [tab, setTab] = useState<Tab>('questions');
  const [msg, setMsg] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // 下書きの編集中の値
  const [head, setHead] = useState({ name: '', note: '' });
  const [qs, setQs] = useState<Question[]>([]);
  const [scs, setScs] = useState<Scale[]>([]);
  const [rules, setRules] = useState<Partial<Record<Role, RoleRule>>>({});
  const [dirty, setDirty] = useState<Record<string, boolean>>({});

  const loadList = useCallback(async (pickId?: string) => {
    const r = await api<{ versions: Version[] }>('/api/aptitude/master');
    if (!r.ok) return setMsg(failText(r));
    setVersions(r.versions);
    setSel((cur) => pickId || cur || r.versions.find((x) => x.status === '公開')?.id || r.versions[0]?.id || '');
  }, []);

  const loadOne = useCallback(async (id: string) => {
    const r = await api<{ version: VersionDetail; used: number }>(`/api/aptitude/master?id=${encodeURIComponent(id)}`);
    if (!r.ok) return setMsg(failText(r));
    setV(r.version);
    setUsed(r.used);
    setHead({ name: r.version.name, note: r.version.note });
    setQs(r.version.questions);
    setScs(r.version.scales);
    setRules(r.version.rules);
    setDirty({});
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (sel) loadOne(sel); }, [sel, loadOne]);

  const draft = v?.status === '下書き';
  const anyDirty = Object.values(dirty).some(Boolean);

  async function post(body: Record<string, unknown>, done: string, after?: (j: Record<string, unknown>) => void) {
    setBusy(true);
    setMsg('');
    setOk('');
    const r = await api<Record<string, unknown>>('/api/aptitude/master', { body });
    setBusy(false);
    if (!r.ok) { setMsg(failText(r)); return false; }
    setOk(done);
    after?.(r);
    return true;
  }

  async function save() {
    if (!v) return;
    const body: Record<string, unknown> = { action: 'save', id: v.id };
    if (dirty.head) Object.assign(body, head);
    if (dirty.questions) body.questions = qs;
    if (dirty.scales) body.scales = scs;
    if (dirty.rules) body.rules = rules;
    if (await post(body, '下書きを保存しました。')) { await loadOne(v.id); await loadList(v.id); }
  }

  function guard(next: () => void) {
    if (anyDirty && !confirm('保存していない変更があります。捨てて進みますか？')) return;
    next();
  }

  const nameOf = (c: ScaleCode) => scs.find((s) => s.code === c)?.name ?? c;

  return (
    <div className="ib apt">
      <div className="apt-titlebar"><h1 className="apt-h1">設問・判定基準</h1></div>
      <p className="ib-note">判定基準（重み・閾値）は<b>暫定</b>です。過去の判定・入社後の評価（校正用CSV）と突き合わせて見直してください。見直すまでは、判定は参考情報として扱います。</p>
      {msg && <p className="ib-note ib-note-err" role="alert">{msg}</p>}
      {ok && <p className="ib-note ib-note-dev" role="status">{ok}</p>}

      <div className="apt-versions">
        {versions.map((x) => (
          <button key={x.id} className={`apt-version ${x.id === sel ? 'active' : ''}`} onClick={() => guard(() => setSel(x.id))}>
            <span className="apt-version-id">{x.id}</span>
            <span className={`apt-state ${VERSION_CLASS[x.status]}`}>{x.status}</span>
            <span className="apt-version-name">{x.name}</span>
          </button>
        ))}
      </div>

      {v && (
        <section className="apt-card">
          <div className="apt-sec-head">
            <div>
              {draft ? (
                <input className="apt-version-title" value={head.name} onChange={(e) => { setHead({ ...head, name: e.target.value }); setDirty({ ...dirty, head: true }); }} aria-label="版の名前" />
              ) : <h2 className="apt-h2">{v.id}「{v.name}」</h2>}
              <div className="apt-legend">
                {v.status === '公開' && `公開 ${jpDateTime(v.publishedAt)}・`}作成 {jpDateTime(v.createdAt)}（{v.createdBy}）・この版で受けた受検 {used}件
              </div>
            </div>
            <div className="apt-actions">
              <button className="ib-ghost" disabled={busy} onClick={() => guard(() => post({ action: 'copy', from: v.id }, `${v.id} をコピーして下書きを作りました。`, (j) => {
                const nv = j.version as Version;
                loadList(nv.id);
                setSel(nv.id);
              }))}>コピーして下書きを作る</button>
              {draft && <button className="ib-primary" disabled={busy || !anyDirty} onClick={save}>下書きを保存</button>}
              {draft && (
                <button className="ib-primary apt-publish" disabled={busy || anyDirty} title={anyDirty ? '先に保存してください' : ''}
                  onClick={() => confirm(`${v.id} を公開しますか？\nこれ以降に発行する受検URL・紙回答はこの版で採点します（すでに受けた結果は変わりません）。いま公開中の版は「終了」になります。`)
                    && post({ action: 'publish', id: v.id }, `${v.id} を公開しました。`, () => { loadList(v.id); loadOne(v.id); })}>公開する</button>
              )}
              {draft && used === 0 && (
                <button className="ib-delete" disabled={busy}
                  onClick={() => confirm(`下書き ${v.id} を削除しますか？`) && post({ action: 'delete', id: v.id }, `${v.id} を削除しました。`, () => { setSel(''); setV(null); loadList(); })}>削除</button>
              )}
            </div>
          </div>
          {draft ? (
            <textarea className="apt-version-note" value={head.note} onChange={(e) => { setHead({ ...head, note: e.target.value }); setDirty({ ...dirty, head: true }); }} placeholder="この版で変えたこと・理由" />
          ) : v.note && <p className="apt-memo">{v.note}</p>}
          {!draft && <p className="apt-legend">この版は{v.status === '公開' ? '公開中' : '終了'}のため変えられません。直すときは［コピーして下書きを作る］から。</p>}

          <div className="ib-views apt-tabs">
            {([['questions', `設問（${qs.filter((q) => q.active).length}問）`], ['scales', '尺度'], ['rules', '判定基準']] as [Tab, string][]).map(([k, label]) => (
              <button key={k} className={`ib-view ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}{dirty[k] && ' ●'}</button>
            ))}
          </div>

          {tab === 'questions' && <QuestionsEditor qs={qs} scales={scs} editable={draft} onChange={(x) => { setQs(x); setDirty({ ...dirty, questions: true }); }} />}
          {tab === 'scales' && <ScalesEditor scs={scs} editable={draft} onChange={(x) => { setScs(x); setDirty({ ...dirty, scales: true }); }} />}
          {tab === 'rules' && <RulesEditor rules={rules} nameOf={nameOf} scales={scs} editable={draft} onChange={(x) => { setRules(x); setDirty({ ...dirty, rules: true }); }} />}
        </section>
      )}
    </div>
  );
}

// ---- 設問 -------------------------------------------------------------------

function QuestionsEditor({ qs, scales, editable, onChange }: { qs: Question[]; scales: Scale[]; editable: boolean; onChange: (q: Question[]) => void }) {
  const [scale, setScale] = useState('');
  const [onlyNote, setOnlyNote] = useState(false);
  const shown = useMemo(() => qs.filter((q) => (!scale || q.scale === scale) && (!onlyNote || q.note.includes('要確認'))), [qs, scale, onlyNote]);
  const set = (no: number, patch: Partial<Question>) => onChange(qs.map((q) => (q.no === no ? { ...q, ...patch } : q)));

  return (
    <>
      <div className="ib-toolbar">
        <select value={scale} onChange={(e) => setScale(e.target.value)} aria-label="尺度で絞り込み">
          <option value="">尺度：すべて</option>
          {scales.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
        <label className="apt-check"><input type="checkbox" checked={onlyNote} onChange={(e) => setOnlyNote(e.target.checked)} />要確認の設問だけ</label>
        <span className="apt-legend">反転＝「いいえ」で1点。使わない設問は採点から外し、尺度の満点を減らして10点満点に換算します（受検画面にも出しません）。</span>
      </div>
      <div className="ib-table-wrap apt-plain-wrap">
        <table className="ib-table apt-master-table">
          <thead><tr><th className="num">番号</th><th>本文</th><th>尺度</th><th>反転</th><th>使う</th><th>備考（受検者には出ない）</th></tr></thead>
          <tbody>
            {shown.map((q) => (
              <tr key={q.no} className={q.active ? '' : 'apt-inactive'}>
                <td className="num">{q.no}{q.note.includes('要確認') && <span className="apt-warn" title={q.note}>⚠</span>}</td>
                <td className="apt-wrap">{editable ? <input value={q.text} onChange={(e) => set(q.no, { text: e.target.value })} /> : q.text}</td>
                <td>{editable ? (
                  <select value={q.scale} onChange={(e) => set(q.no, { scale: e.target.value as ScaleCode })}>
                    {scales.map((s) => <option key={s.code} value={s.code}>{s.code}</option>)}
                  </select>
                ) : q.scale}</td>
                <td className="apt-c"><input type="checkbox" checked={q.reverse} disabled={!editable} onChange={(e) => set(q.no, { reverse: e.target.checked })} aria-label={`${q.no}番 反転`} /></td>
                <td className="apt-c"><input type="checkbox" checked={q.active} disabled={!editable} onChange={(e) => set(q.no, { active: e.target.checked })} aria-label={`${q.no}番 使う`} /></td>
                <td className="apt-wrap apt-note-cell">{editable ? <input value={q.note} onChange={(e) => set(q.no, { note: e.target.value })} /> : q.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- 尺度 -------------------------------------------------------------------

function ScalesEditor({ scs, editable, onChange }: { scs: Scale[]; editable: boolean; onChange: (s: Scale[]) => void }) {
  const set = (code: ScaleCode, patch: Partial<Scale>) => onChange(scs.map((s) => (s.code === code ? { ...s, ...patch } : s)));
  return (
    <div className="ib-table-wrap apt-plain-wrap">
      <table className="ib-table apt-master-table">
        <thead><tr><th>コード</th><th>名前</th><th>種別</th><th>測っているもの（結果の画面に出る）</th></tr></thead>
        <tbody>
          {scs.map((s) => (
            <tr key={s.code}>
              <td><b>{s.code}</b></td>
              <td>{editable ? <input value={s.name} onChange={(e) => set(s.code, { name: e.target.value })} /> : s.name}</td>
              <td>{editable ? (
                <select value={s.kind} onChange={(e) => set(s.code, { kind: e.target.value as Scale['kind'] })}>
                  {SCALE_KINDS.map((k) => <option key={k}>{k}</option>)}
                </select>
              ) : s.kind}</td>
              <td className="apt-wrap">{editable ? <input value={s.description} onChange={(e) => set(s.code, { description: e.target.value })} /> : s.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="apt-legend">コードは採点の仕組みに使うので変えられません。虚偽（L）は「参考値」の判定に、エゴグラム5尺度（CP・NP・A・FC・AC）は折れ線のグラフに使います。</p>
    </div>
  );
}

// ---- 判定基準 ---------------------------------------------------------------

const HEAD_FIELDS: [keyof RoleRule, string, string][] = [
  ['gradeA', 'A の基準', '適性スコアがこれ以上で A'],
  ['gradeB', 'B の基準', 'これ以上で B、未満は C'],
  ['lieAt', '虚偽の閾値', '虚偽がこれ以上なら参考値'],
  ['minAvgSec', '回答秒数の下限', '平均がこれ未満なら参考値（Web のみ）'],
  ['highAt', '「高い」とみる点', 'これ以上で確認ポイントを出す'],
  ['lowAt', '「低い」とみる点', 'これ以下で確認ポイントを出す'],
];

function RulesEditor({
  rules, scales, nameOf, editable, onChange,
}: { rules: Partial<Record<Role, RoleRule>>; scales: Scale[]; nameOf: (c: ScaleCode) => string; editable: boolean; onChange: (r: Partial<Record<Role, RoleRule>>) => void }) {
  const [role, setRole] = useState<Role>('講師');
  const r = rules[role];
  if (!r) return <p className="apt-muted">この職種の判定基準がありません。</p>;

  const setHead = (k: keyof RoleRule, val: string) => onChange({ ...rules, [role]: { ...r, [k]: Number(val) } });
  const setScale = (c: ScaleCode, k: string, val: string | number | null) =>
    onChange({ ...rules, [role]: { ...r, scales: { ...r.scales, [c]: { ...r.scales[c], [k]: val } } } });
  const numOrNull = (s: string) => (s === '' ? null : Number(s));
  const weightSum = scales.reduce((a, s) => a + (r.scales[s.code]?.weight ?? 0), 0);

  return (
    <>
      <div className="apt-role-pick">
        <span>職種</span>
        <div className="ib-views">
          {ROLES.map((x) => <button key={x} className={`ib-view ${x === role ? 'active' : ''}`} onClick={() => setRole(x)}>{ROLE_LABEL[x]}</button>)}
        </div>
      </div>
      <p className="apt-legend">
        適性スコア＝Σ（重み×尺度得点）÷ Σ（重み×10）× 100。重み0の尺度はスコアに入りません（いまの重みの合計 {weightSum}）。
        尺度が「注意」以上なら判定は B まで、「要注意」以上なら C。虚偽・回答の速さは判定を変えず「参考値」にします。
      </p>
      <div className="apt-rule-head">
        {HEAD_FIELDS.map(([k, label, hint]) => (
          <label key={k}>{label}
            <input type="number" step={k === 'minAvgSec' ? 0.1 : 1} value={String(r[k])} disabled={!editable} onChange={(e) => setHead(k, e.target.value)} />
            <small>{hint}</small>
          </label>
        ))}
      </div>
      <div className="ib-table-wrap apt-plain-wrap">
        <table className="ib-table apt-master-table apt-rule-table">
          <thead><tr><th>尺度</th><th className="num">重み</th><th className="num">注意</th><th className="num">要注意</th><th>高いときの確認ポイント</th><th>低いときの確認ポイント</th></tr></thead>
          <tbody>
            {scales.map((s) => {
              const x = r.scales[s.code];
              return (
                <tr key={s.code}>
                  <td><b>{nameOf(s.code)}</b><small className="apt-sub">{s.kind}</small></td>
                  <td className="num"><input type="number" min={0} max={10} step={0.5} value={x.weight} disabled={!editable} onChange={(e) => setScale(s.code, 'weight', Number(e.target.value))} /></td>
                  <td className="num"><input type="number" min={0} max={10} value={x.caution ?? ''} placeholder="—" disabled={!editable} onChange={(e) => setScale(s.code, 'caution', numOrNull(e.target.value))} /></td>
                  <td className="num"><input type="number" min={0} max={10} value={x.alert ?? ''} placeholder="—" disabled={!editable} onChange={(e) => setScale(s.code, 'alert', numOrNull(e.target.value))} /></td>
                  <td className="apt-wrap">{editable ? <textarea value={x.highNote} onChange={(e) => setScale(s.code, 'highNote', e.target.value)} /> : x.highNote}</td>
                  <td className="apt-wrap">{editable ? <textarea value={x.lowNote} onChange={(e) => setScale(s.code, 'lowNote', e.target.value)} /> : x.lowNote}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
