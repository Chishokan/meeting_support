// 適性検査の一覧・詳細・履歴で使う小さな表示（判定・受検の状態・注意の印）。
// 色だけで区別しないよう、どれも文字（A/B/C・「注意」など）を添える。

import { GRADE_LABEL, type Flag, type Grade, type SessionState } from '@/lib/aptitude/model';

export function GradeBadge({ grade, reliable = true, size = 'sm' }: { grade: Grade | null | undefined; reliable?: boolean; size?: 'sm' | 'lg' }) {
  if (!grade) return <span className="apt-muted">—</span>;
  return (
    <span className={`apt-grade apt-grade-${grade} ${size === 'lg' ? 'lg' : ''}`} title={`${grade}：${GRADE_LABEL[grade]}${reliable ? '' : '（参考値）'}`}>
      {grade}
      {size === 'lg' && <small>{GRADE_LABEL[grade]}</small>}
    </span>
  );
}

const STATE_CLASS: Record<SessionState, string> = {
  未受検: 'wait', 受検中: 'doing', 完了: 'done', 取消: 'off', 期限切れ: 'late',
};

export function StateBadge({ state }: { state: SessionState | null | undefined }) {
  if (!state) return <span className="apt-state none">未発行</span>;
  return <span className={`apt-state ${STATE_CLASS[state]}`}>{state}</span>;
}

/** 注意の印。要注意＞注意＞参考値 の順に、それぞれ1つだけ出す。 */
export function FlagMarks({ flags, reliable }: { flags: Flag[]; reliable: boolean }) {
  const alert = flags.filter((f) => f.kind === 'alert');
  const caution = flags.filter((f) => f.kind === 'caution');
  const why = (list: Flag[]) => list.map((f) => f.text).join('\n');
  return (
    <span className="apt-marks">
      {alert.length > 0 && <span className="apt-mark alert" title={why(alert)}><b aria-hidden="true">!!</b>要注意</span>}
      {caution.length > 0 && <span className="apt-mark caution" title={why(caution)}><b aria-hidden="true">!</b>注意</span>}
      {!reliable && <span className="apt-mark ref" title={why(flags.filter((f) => f.kind === 'lie' || f.kind === 'speed'))}><b aria-hidden="true">?</b>参考値</span>}
    </span>
  );
}
