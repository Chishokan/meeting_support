'use client';

// 適性検査：1回の受検の結果。判定・判定の理由・面接での確認ポイント・尺度のグラフ・他の職種で見た判定。
// グラフは2つ：エゴグラム5尺度（CP/NP/A/FC/AC）は折れ線、ほかの5尺度は閾値の目盛りつきの横棒。
// どちらも1系列なので凡例は置かず、値は下の「得点の一覧」の表でも読めるようにしてある。

import { useState } from 'react';
import { EGOGRAM, ROLES, ROLE_LABEL, type Role, type RoleRule, type Scale, type ScaleCode } from '@/lib/aptitude/model';
import type { SessionView } from '@/lib/aptitude/store';
import { jpDateTime } from '@/lib/aptitude/client';
import { FlagMarks, GradeBadge } from './AptitudeBadges';

type VersionInfo = { name: string; scales: Scale[]; rules: Record<Role, RoleRule> };

export default function AptitudeResult({ session, version }: { session: SessionView; version: VersionInfo }) {
  const r = session.result!;
  const j = r.judgment;
  const rule = version.rules[j.role];
  const scale = (c: ScaleCode) => version.scales.find((s) => s.code === c);
  const score = (c: ScaleCode) => r.scores[c]?.score ?? null;
  const others = version.scales.filter((s) => !EGOGRAM.includes(s.code));

  return (
    <div className="apt-result">
      <div className="apt-result-head">
        <GradeBadge grade={j.grade} reliable={j.reliable} size="lg" />
        <div className="apt-result-score">
          <div className="apt-result-apt"><b>{j.aptitude}</b><span>/ 100　適性スコア</span></div>
          <div className="apt-result-role">{ROLE_LABEL[j.role]}の基準で判定{j.baseGrade !== j.grade && <>（リスクを見る前は {j.baseGrade}）</>}</div>
          <FlagMarks flags={j.flags} reliable={j.reliable} />
        </div>
        <div className="apt-result-meta">
          <div>受検 {jpDateTime(session.completedAt)}（{session.method}{r.avgSeconds != null && `・平均 ${r.avgSeconds}秒/問`}）</div>
          <div>版 {session.versionId}「{version.name}」</div>
          <div>計算 {jpDateTime(r.computedAt)}</div>
        </div>
      </div>

      {!j.reliable && (
        <p className="ib-note apt-ref-note">この結果は<b>参考値</b>です。{j.flags.filter((f) => f.kind === 'lie' || f.kind === 'speed').map((f) => f.text).join('／')}。面接で実像を確かめてください。</p>
      )}

      <div className="apt-result-grid">
        <section className="apt-card">
          <h3 className="apt-h3">判定の理由</h3>
          <ol className="apt-reasons">{j.reasons.map((x, i) => <li key={i}>{x}</li>)}</ol>
        </section>
        <section className="apt-card">
          <h3 className="apt-h3">面接での確認ポイント</h3>
          {j.checkpoints.length ? (
            <ul className="apt-points">
              {j.checkpoints.map((c) => (
                <li key={c.scale}>
                  <span className={`apt-point-tag ${c.level === '高' ? 'hi' : 'lo'}`}>{scale(c.scale)?.name ?? c.scale}が{c.level === '高' ? '高い' : '低い'}</span>
                  {c.text}
                </li>
              ))}
            </ul>
          ) : <p className="apt-muted">目立って高い・低い尺度はありません。</p>}
        </section>
      </div>

      <div className="apt-result-grid">
        <section className="apt-card">
          <h3 className="apt-h3">エゴグラム<small>（交流分析の5尺度・各10点）</small></h3>
          <Egogram scales={EGOGRAM.map((c) => ({ code: c, name: scale(c)?.name ?? c, score: score(c) }))} highAt={rule?.highAt} lowAt={rule?.lowAt} />
        </section>
        <section className="apt-card">
          <h3 className="apt-h3">ストレス耐性・リスク・虚偽<small>（各10点）</small></h3>
          <div className="apt-bars">
            {others.map((s) => {
              const v = score(s.code);
              const sr = rule?.scales[s.code];
              const flag = j.flags.find((f) => f.scale === s.code && (f.kind === 'alert' || f.kind === 'caution' || f.kind === 'lie'));
              const lieAt = s.code === 'L' ? rule?.lieAt : null;
              return (
                <div key={s.code} className="apt-bar-row" title={`${s.name}：${v ?? '—'}点 / 10\n${s.description}`}>
                  <div className="apt-bar-label">{s.name}</div>
                  <div className="apt-bar-track">
                    {v != null && v > 0 && <div className="apt-bar-fill" style={{ width: `${v * 10}%` }} />}
                    {sr?.caution != null && <Tick at={sr.caution} kind="caution" label={`注意${sr.caution}`} />}
                    {sr?.alert != null && <Tick at={sr.alert} kind="alert" label={`要注意${sr.alert}`} />}
                    {lieAt != null && <Tick at={lieAt} kind="ref" label={`参考値${lieAt}`} />}
                  </div>
                  <div className="apt-bar-val">
                    {v ?? '—'}
                    {flag && <span className={`apt-mark ${flag.kind === 'lie' ? 'ref' : flag.kind}`}><b aria-hidden="true">{flag.kind === 'alert' ? '!!' : flag.kind === 'lie' ? '?' : '!'}</b>{flag.kind === 'alert' ? '要注意' : flag.kind === 'lie' ? '参考値' : '注意'}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="apt-legend">ストレス耐性は高いほど良い。情緒不安定・対人回避・未成熟は高いほど注意。目盛りは{ROLE_LABEL[j.role]}の閾値。</p>
        </section>
      </div>

      <section className="apt-card">
        <h3 className="apt-h3">同じ回答を、ほかの職種の基準で見ると</h3>
        <div className="apt-alt">
          {ROLES.filter((role) => r.alt[role]).map((role) => (
            <div key={role} className={`apt-alt-item ${role === j.role ? 'current' : ''}`}>
              <span className="apt-alt-role">{ROLE_LABEL[role]}{role === j.role && <small>（応募職種）</small>}</span>
              <GradeBadge grade={r.alt[role].grade} reliable={r.alt[role].reliable} />
              <span className="apt-alt-score">{r.alt[role].aptitude}</span>
            </div>
          ))}
        </div>
        <p className="apt-legend">職種ごとに重視する尺度と注意の閾値が違うため、同じ回答でも判定が変わることがあります（保存されるのは応募職種の判定だけ）。</p>
      </section>

      <details className="apt-details">
        <summary>得点の一覧（表）</summary>
        <div className="ib-table-wrap apt-plain-wrap">
          <table className="ib-table apt-score-table">
            <thead><tr><th>尺度</th><th className="num">得点</th><th className="num">重み</th><th className="num">注意／要注意</th><th>測っているもの</th></tr></thead>
            <tbody>
              {version.scales.map((s) => {
                const x = r.scores[s.code];
                const sr = rule?.scales[s.code];
                return (
                  <tr key={s.code}>
                    <td><b>{s.name}</b><small className="apt-sub">{s.kind}</small></td>
                    <td className="num">{x?.score ?? '—'}{x && x.max !== 10 && <small className="apt-sub">{x.raw}/{x.max}問</small>}</td>
                    <td className="num">{sr?.weight ? sr.weight : '—'}</td>
                    <td className="num">{sr?.caution ?? '—'}／{sr?.alert ?? '—'}</td>
                    <td className="apt-wrap">{s.description}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Tick({ at, kind, label }: { at: number; kind: 'caution' | 'alert' | 'ref'; label: string }) {
  return (
    <span className={`apt-tick ${kind}`} style={{ left: `${at * 10}%` }}>
      <span className="apt-tick-label">{label}</span>
    </span>
  );
}

// ---- エゴグラム（折れ線） -----------------------------------------------------

const W = 360;
const H = 220;
const PAD = { l: 30, r: 14, t: 14, b: 46 };

function Egogram({ scales, highAt, lowAt }: { scales: { code: ScaleCode; name: string; score: number | null }[]; highAt?: number; lowAt?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (iw * (i + 0.5)) / scales.length;
  const y = (v: number) => PAD.t + ih - (ih * v) / 10;
  const pts = scales.map((s, i) => (s.score == null ? null : { x: x(i), y: y(s.score), s }));
  const path = pts.reduce((d, p, i) => (p ? `${d}${d && pts[i - 1] ? 'L' : 'M'}${p.x},${p.y}` : d), '');
  const h = hover != null ? pts[hover] : null;

  return (
    <div className="apt-ego">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`エゴグラム：${scales.map((s) => `${s.code} ${s.score ?? '—'}点`).join('、')}`}>
        {[0, 2, 4, 6, 8, 10].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="apt-ego-grid" />
            <text x={PAD.l - 8} y={y(v)} className="apt-ego-tick" textAnchor="end" dominantBaseline="middle">{v}</text>
          </g>
        ))}
        {highAt != null && <text x={W - PAD.r} y={y(highAt) - 4} className="apt-ego-ref" textAnchor="end">高い {highAt}〜</text>}
        {lowAt != null && <text x={W - PAD.r} y={y(lowAt) + 12} className="apt-ego-ref" textAnchor="end">低い 〜{lowAt}</text>}
        {highAt != null && <line x1={PAD.l} x2={W - PAD.r} y1={y(highAt)} y2={y(highAt)} className="apt-ego-refline" />}
        {lowAt != null && <line x1={PAD.l} x2={W - PAD.r} y1={y(lowAt)} y2={y(lowAt)} className="apt-ego-refline" />}
        {h && <line x1={h.x} x2={h.x} y1={PAD.t} y2={PAD.t + ih} className="apt-ego-cross" />}
        <path d={path} className="apt-ego-line" />
        {pts.map((p, i) => p && (
          <g key={p.s.code}>
            <circle cx={p.x} cy={p.y} r={5} className="apt-ego-dot" />
            <circle cx={p.x} cy={p.y} r={16} className="apt-ego-hit"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} />
          </g>
        ))}
        {scales.map((s, i) => (
          <g key={s.code}>
            <text x={x(i)} y={H - PAD.b + 18} className="apt-ego-code" textAnchor="middle">{s.code}</text>
            <text x={x(i)} y={H - PAD.b + 34} className="apt-ego-val" textAnchor="middle">{s.score ?? '—'}</text>
          </g>
        ))}
      </svg>
      {h && (
        <div className="apt-tip" style={{ left: `${(h.x / W) * 100}%`, top: `${(h.y / H) * 100}%` }}>
          <b>{h.s.name}</b>
          <span>{h.s.score}点 / 10</span>
        </div>
      )}
    </div>
  );
}
