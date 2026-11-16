// 智翔館AI：小中等部の校舎の「重要タスク評価」を読む道具（get_task_evaluation）。サーバ専用。
//
// AI壁打ち（/task-coach）と同じ評価シート（重要タスク評価シートの校舎タブ）と、同じ評価の基準（段階0〜5・他部門との連携の線引き・相談相手）を使う。
// 作業「行動計画を作る（AI評価つき）」（knowledge/05_作業/45_行動計画を作る.md）で、行動計画を評価の基準で見直し、
// アドバイスと、アドバイスをもとに直した行動計画案を出すときに使う。
// 評価シートを読めるのは、小中等部と管理部門の人だけ（AI壁打ちと同じく、校舎の評価のため）。それ以外は評価の基準だけを返す。

import { ADMIN_CAMPUS } from '../core/staff';
import { COACH_DEPT, COACH_SCHOOLS, evaluationText } from '../taskCoach';
import { EVALUATION_RULES } from '../taskCoachPrompt';
import { getEvaluation } from '../taskCoachStore';

export const TASK_EVAL_TOOL = {
  name: 'get_task_evaluation',
  description:
    `小中等部の校舎の「重要タスク評価」（いちばん新しい週の評価シートの校舎タブ：合計点・進捗・行動の段階と根拠とアドバイス・良い動き・課題・` +
    `計画へのアドバイス（募集・成績アップ）・募集の数字・定期テストの表・報告と入力の差異）と、` +
    `評価の基準（段階0〜5・他部門との連携の線引き・相談相手）を読む。校舎の行動計画を作る・見直すときに使う（作業「行動計画を作る（AI評価つき）」）。` +
    `校舎は ${COACH_SCHOOLS.join('・')} のどれか。`,
  input_schema: {
    type: 'object',
    properties: { school: { type: 'string', enum: COACH_SCHOOLS, description: '校舎' } },
    required: ['school'],
  },
} as const;

const REASONS: Record<string, string> = {
  not_configured: '評価シートを読む設定がありません',
  not_deployed: 'Apps Script が古いままです（再デプロイが必要）',
  no_evaluation: '評価シートのこの校舎のタブに、まだ評価がありません',
  upstream_error: 'Apps Script との通信に失敗しました',
  network_error: 'Apps Script との通信に失敗しました',
};

/** 道具の結果（AI に返す文）と、ログ用の短い説明。 */
export async function runTaskEvaluation(input: Record<string, unknown>, who: { campus: string }): Promise<{ text: string; note: string }> {
  const rules = `【評価の基準（重要タスク評価・AI壁打ちと同じ）】\n${EVALUATION_RULES}`;
  if (who.campus !== COACH_DEPT && who.campus !== ADMIN_CAMPUS) {
    return {
      text: `校舎の評価シートは、小中等部と管理部門の人だけが読めます（${who.campus}）。評価の基準だけで見直し、「確認してほしいこと」に、評価シートを読んでいないことを書く。\n\n${rules}`,
      note: '評価シートは読めない部門',
    };
  }
  const school = String(input.school ?? '').trim();
  if (!COACH_SCHOOLS.includes(school)) {
    return { text: `校舎は ${COACH_SCHOOLS.join('・')} のどれかです（「${school.slice(0, 20)}」は評価シートにありません）。評価の基準だけで見直すか、校舎を確かめる。\n\n${rules}`, note: '校舎が違う' };
  }
  const r = await getEvaluation(school);
  if (!r.ok) {
    const why = REASONS[r.reason] ?? '評価シートを読めませんでした';
    return { text: `${school}の評価シートを読めませんでした（${why}）。評価の基準だけで見直し、「確認してほしいこと」にそのことを書く。\n\n${rules}`, note: `読めず：${why}` };
  }
  return {
    text:
      `【${school}の重要タスク評価（評価シートのとおり。ここに無い事実・数字は作らない）】\n${evaluationText(r.evaluation, 'all')}\n\n${rules}\n\n` +
      '行動計画の各行動を、この基準で見る（段階2の前提＝対象・数・結果が記録に残ること）。評価の「課題」「アドバイス」と、段階の低い項目に応えているかも見る。',
    note: `${school}（合計${r.evaluation.total}点）`,
  };
}
