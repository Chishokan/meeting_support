// 適性検査の保存・取得。サーバ専用（API ルートからだけ使う）。
// 保存先（Supabase／手元の JSON）の切り替えは tables.ts。ここは「表の行 ↔ 型」の読み替えと手順だけを持つ。
//
// ★列を増やしたら、SQL（supabase/migrations/）・下の読み替え（toXxx / xxxRow）・model.ts の型をそろえること。

import { randomBytes, randomInt, randomUUID } from 'crypto';
import { TableError, tables, type Row, type Tables } from './tables';
import { SEED_QUESTIONS, SEED_RULES, SEED_SCALES, SEED_VERSION } from './seed';
import { averageSeconds, judge, scoreScales } from './scoring';
import {
  RETENTION, ROLES, TOKEN_DAYS, sessionState,
  type Answer, type AnswerValue, type Candidate, type CandidateInput, type ExamProfile, type Grade, type HireInput, type Judgment,
  type Question, type Result, type Role, type RoleRule, type Scale, type ScaleCode, type Session, type SessionState,
  type Version, type VersionDetail,
} from './model';

type Fail = { ok: false; reason: string };
type Res<T> = ({ ok: true } & T) | Fail;
export type Actor = { name: string; campus: string };

// 関数宣言にしておくと、bad() の後ろで TypeScript が「ここには来ない」とみなしてくれる
function bad(reason: string): never {
  throw new TableError(reason);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** id の形が違えば「見つからない」にする（Supabase の uuid 列に別の形を渡すと、見つからないではなくエラーになるため）。 */
function needId(id: string): void {
  if (!UUID.test(id)) bad('not_found');
}

async function run<T extends object>(fn: (t: Tables) => Promise<T>): Promise<Res<T>> {
  const t = tables();
  if (!t) return { ok: false, reason: 'not_configured' };
  try {
    return { ok: true, ...(await fn(t)) };
  } catch (e) {
    if (e instanceof TableError) return { ok: false, reason: e.reason };
    console.log('[aptitude] unexpected', e);
    return { ok: false, reason: 'unknown_error' };
  }
}

export function backendKind(): 'db' | 'local' | null {
  return tables()?.kind ?? null;
}

// ---- 行 ↔ 型 -----------------------------------------------------------------

const s = (v: unknown) => (v == null ? '' : String(v));
const nowIso = () => new Date().toISOString();
function iso(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}
const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));

const toVersion = (r: Row): Version => ({
  id: s(r.id), name: s(r.name), status: s(r.status) as Version['status'], note: s(r.note),
  publishedAt: iso(r.published_at), createdAt: iso(r.created_at), createdBy: s(r.created_by),
});
const versionRow = (v: Version): Row => ({
  id: v.id, name: v.name, status: v.status, note: v.note,
  published_at: v.publishedAt || null, created_at: v.createdAt || nowIso(), created_by: v.createdBy,
});

const toScale = (r: Row): Scale => ({
  code: s(r.code) as ScaleCode, name: s(r.name), kind: s(r.kind) as Scale['kind'], description: s(r.description), order: Number(r.sort_order) || 0,
});
const scaleRow = (versionId: string, x: Scale): Row => ({
  version_id: versionId, code: x.code, name: x.name, kind: x.kind, description: x.description, sort_order: x.order,
});

const toQuestion = (r: Row): Question => ({
  no: Number(r.no), text: s(r.text), scale: s(r.scale_code) as ScaleCode, reverse: !!r.reverse, active: r.active !== false, note: s(r.note),
});
const questionRow = (versionId: string, q: Question): Row => ({
  version_id: versionId, no: q.no, text: q.text, scale_code: q.scale, reverse: q.reverse, active: q.active, note: q.note,
});

const toCandidate = (r: Row): Candidate => ({
  id: s(r.id), name: s(r.name), kana: s(r.kana), gender: s(r.gender), birthDate: s(r.birth_date).slice(0, 10),
  phone: s(r.phone), email: s(r.email), role: s(r.role) as Role, base: s(r.base),
  hireStatus: s(r.hire_status) as Candidate['hireStatus'], hireStatusAt: iso(r.hire_status_at),
  postEval: numOrNull(r.post_eval), postEvalNote: s(r.post_eval_note), memo: s(r.memo),
  createdAt: iso(r.created_at), createdBy: s(r.created_by), updatedAt: iso(r.updated_at), updatedBy: s(r.updated_by),
});
const candidateFields = (c: CandidateInput): Row => ({
  name: c.name, kana: c.kana, gender: c.gender, birth_date: c.birthDate || null, phone: c.phone, email: c.email,
  role: c.role, base: c.base, hire_status: c.hireStatus, post_eval: c.postEval, post_eval_note: c.postEvalNote, memo: c.memo,
});

const toSession = (r: Row): Session => ({
  id: s(r.id), candidateId: s(r.candidate_id), versionId: s(r.version_id), role: s(r.role) as Role, base: s(r.base),
  token: s(r.token), expiresAt: iso(r.expires_at), method: s(r.method) as Session['method'], status: s(r.status) as Session['status'],
  questionOrder: Array.isArray(r.question_order) ? (r.question_order as unknown[]).map(Number) : [],
  consentAt: iso(r.consent_at), startedAt: iso(r.started_at), completedAt: iso(r.completed_at),
  createdAt: iso(r.created_at), createdBy: s(r.created_by),
});

const toAnswer = (r: Row): Answer => ({
  no: Number(r.question_no), answer: s(r.answer) as AnswerValue, seconds: numOrNull(r.seconds),
});

const toResult = (r: Row): Result => ({
  sessionId: s(r.session_id), versionId: s(r.version_id),
  scores: (r.scores ?? {}) as Result['scores'],
  avgSeconds: numOrNull(r.avg_seconds),
  judgment: r.judgment as Judgment,
  computedAt: iso(r.computed_at),
});

// ---- 版 ---------------------------------------------------------------------

/** 版が1件も無ければ、初期の版（seed.ts）を書き込む。何度呼んでも壊れない。 */
async function ensureSeeded(t: Tables): Promise<void> {
  if ((await t.select('apt_versions')).length) return;
  await t.upsert('apt_versions', [versionRow(SEED_VERSION)], ['id']);
  await t.upsert('apt_scales', SEED_SCALES.map((x) => scaleRow(SEED_VERSION.id, x)), ['version_id', 'code']);
  await t.upsert('apt_questions', SEED_QUESTIONS.map((q) => questionRow(SEED_VERSION.id, q)), ['version_id', 'no']);
  await t.upsert('apt_rules', ROLES.map((role) => ({ version_id: SEED_VERSION.id, role, rule: SEED_RULES[role] })), ['version_id', 'role']);
}

async function loadVersions(t: Tables): Promise<Version[]> {
  await ensureSeeded(t);
  return (await t.select('apt_versions')).map(toVersion).sort((a, b) => versionNo(a.id) - versionNo(b.id));
}

const versionNo = (id: string) => Number(id.replace(/^v/, '')) || 0;

async function loadVersion(t: Tables, id: string): Promise<VersionDetail> {
  const [v] = await t.select('apt_versions', { id });
  if (!v) bad('version_not_found');
  const [sc, qs, rs] = await Promise.all([
    t.select('apt_scales', { version_id: id }),
    t.select('apt_questions', { version_id: id }),
    t.select('apt_rules', { version_id: id }),
  ]);
  const rules = {} as Record<Role, RoleRule>;
  for (const r of rs) rules[s(r.role) as Role] = r.rule as RoleRule;
  return {
    ...toVersion(v),
    scales: sc.map(toScale).sort((a, b) => a.order - b.order),
    questions: qs.map(toQuestion).sort((a, b) => a.no - b.no),
    rules,
  };
}

async function publishedVersion(t: Tables): Promise<VersionDetail> {
  const v = (await loadVersions(t)).find((x) => x.status === '公開');
  if (!v) bad('no_published_version');
  return loadVersion(t, v!.id);
}

export const listVersions = () => run(async (t) => ({ versions: await loadVersions(t) }));

export const getVersion = (id: string) =>
  run(async (t) => {
    await ensureSeeded(t);
    const version = await loadVersion(t, id);
    const used = (await t.select('apt_sessions', { version_id: id })).length;
    return { version, used };
  });

/** 版をコピーして下書きを作る（次の番号の版になる）。 */
export const copyVersion = (fromId: string, actor: Actor) =>
  run(async (t) => {
    const all = await loadVersions(t);
    const from = await loadVersion(t, fromId);
    const id = `v${Math.max(0, ...all.map((v) => versionNo(v.id))) + 1}`;
    const v: Version = {
      id, name: `${from.name.replace(/（改訂案）$/, '')}（改訂案）`, status: '下書き', note: from.note,
      publishedAt: '', createdAt: nowIso(), createdBy: actor.name,
    };
    await t.insert('apt_versions', [versionRow(v)]);
    await t.insert('apt_scales', from.scales.map((x) => scaleRow(id, x)));
    await t.insert('apt_questions', from.questions.map((q) => questionRow(id, q)));
    await t.insert('apt_rules', ROLES.filter((r) => from.rules[r]).map((role) => ({ version_id: id, role, rule: from.rules[role] })));
    await addLog(t, actor, '版のコピー', { detail: `${fromId} → ${id}` });
    return { version: v };
  });

export type DraftPatch = {
  name?: string;
  note?: string;
  scales?: Scale[];
  questions?: Question[];
  rules?: Partial<Record<Role, RoleRule>>;
};

/** 下書きの版を書き換える（公開中・終了した版は変えられない。結果がその版を指しているため）。 */
export const saveDraft = (id: string, patch: DraftPatch, actor: Actor) =>
  run(async (t) => {
    const [v] = await t.select('apt_versions', { id });
    if (!v) bad('version_not_found');
    if (s(v.status) !== '下書き') bad('version_locked');
    const head: Row = {};
    if (patch.name != null) head.name = patch.name;
    if (patch.note != null) head.note = patch.note;
    if (Object.keys(head).length) await t.update('apt_versions', { id }, head);
    if (patch.scales) await t.upsert('apt_scales', patch.scales.map((x) => scaleRow(id, x)), ['version_id', 'code']);
    if (patch.questions) {
      const keep = new Set(patch.questions.map((q) => q.no));
      const gone = (await t.select('apt_questions', { version_id: id })).map((r) => Number(r.no)).filter((no) => !keep.has(no));
      if (gone.length) await t.remove('apt_questions', { version_id: id, no: gone });
      await t.upsert('apt_questions', patch.questions.map((q) => questionRow(id, q)), ['version_id', 'no']);
    }
    if (patch.rules) {
      const rows = ROLES.filter((r) => patch.rules![r]).map((role) => ({ version_id: id, role, rule: patch.rules![role] }));
      await t.upsert('apt_rules', rows, ['version_id', 'role']);
    }
    await addLog(t, actor, '版の編集', { detail: id });
    return { version: await loadVersion(t, id) };
  });

/** 下書きを公開する。それまで公開中だった版は「終了」になる（その版で受けた結果はそのまま残る）。 */
export const publishVersion = (id: string, actor: Actor) =>
  run(async (t) => {
    const v = await loadVersion(t, id);
    if (v.status !== '下書き') bad('version_locked');
    if (!v.questions.some((q) => q.active)) bad('no_active_questions');
    if (ROLES.some((r) => !v.rules[r])) bad('rules_missing');
    // 公開中は1つだけ（SQL の一意制約）なので、先に今の公開を終了にする。
    // 新しい版の公開に失敗したら、元の版を公開に戻す（公開中の版が無いと受検URLを発行できなくなるため）
    const prev = (await t.select('apt_versions', { status: '公開' })).map((r) => s(r.id));
    await t.update('apt_versions', { status: '公開' }, { status: '終了' });
    try {
      await t.update('apt_versions', { id }, { status: '公開', published_at: nowIso() });
    } catch (e) {
      if (prev[0]) await t.update('apt_versions', { id: prev[0] }, { status: '公開' }).catch(() => {});
      throw e;
    }
    await addLog(t, actor, '版の公開', { detail: id });
    return { version: await loadVersion(t, id) };
  });

/** まだ誰も受けていない下書きを消す。 */
export const deleteDraft = (id: string, actor: Actor) =>
  run(async (t) => {
    const [v] = await t.select('apt_versions', { id });
    if (!v) bad('version_not_found');
    if (s(v.status) !== '下書き') bad('version_locked');
    if ((await t.select('apt_sessions', { version_id: id })).length) bad('version_in_use');
    await t.remove('apt_rules', { version_id: id });
    await t.remove('apt_questions', { version_id: id });
    await t.remove('apt_scales', { version_id: id });
    await t.remove('apt_versions', { id });
    await addLog(t, actor, '版の削除', { detail: id });
    return {};
  });

// ---- 受検者 -------------------------------------------------------------------

export type ResultBrief = {
  sessionId: string;
  role: Role;
  grade: Grade;
  aptitude: number;
  reliable: boolean;
  flags: Judgment['flags'];
  completedAt: string;
};

export type CandidateSummary = Candidate & {
  sessionCount: number;
  latest: { id: string; state: SessionState; method: Session['method']; createdAt: string; completedAt: string } | null;
  result: ResultBrief | null; // いちばん新しい完了した受検の結果
};

async function liveCandidates(t: Tables): Promise<Candidate[]> {
  return (await t.select('apt_candidates', { deleted_at: null })).map(toCandidate);
}

function briefOf(sess: Session, r: Result): ResultBrief {
  return {
    sessionId: sess.id, role: r.judgment.role, grade: r.judgment.grade, aptitude: r.judgment.aptitude,
    reliable: r.judgment.reliable, flags: r.judgment.flags, completedAt: sess.completedAt,
  };
}

/** 一覧：受検者ごとに、いちばん新しい受検の状態と、いちばん新しい結果を添える。 */
export const listCandidates = () =>
  run(async (t) => {
    const [cands, sessRows, resRows] = await Promise.all([liveCandidates(t), t.select('apt_sessions'), t.select('apt_results')]);
    const sessions = sessRows.map(toSession);
    const results = new Map(resRows.map((r) => [s(r.session_id), toResult(r)]));
    const now = new Date();
    const items: CandidateSummary[] = cands.map((c) => {
      const mine = sessions.filter((x) => x.candidateId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = mine[0];
      const done = mine.filter((x) => x.status === '完了' && results.has(x.id)).sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];
      return {
        ...c,
        sessionCount: mine.length,
        latest: latest ? { id: latest.id, state: sessionState(latest, now), method: latest.method, createdAt: latest.createdAt, completedAt: latest.completedAt } : null,
        result: done ? briefOf(done, results.get(done.id)!) : null,
      };
    });
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items };
  });

export type HistoryRow = {
  sessionId: string;
  candidateId: string;
  name: string;
  kana: string;
  gender: string;
  role: Role;
  base: string;
  method: Session['method'];
  state: SessionState;
  createdAt: string;
  completedAt: string;
  versionId: string;
  grade: Grade | null;
  deleted: boolean;
};

/** 受検履歴：受検1回＝1行。削除した受検者の分も「削除」として出す（完全に消えるまで）。 */
export const listHistory = () =>
  run(async (t) => {
    const [candRows, sessRows, resRows] = await Promise.all([t.select('apt_candidates'), t.select('apt_sessions'), t.select('apt_results')]);
    const cands = new Map(candRows.map((r) => [s(r.id), { c: toCandidate(r), deleted: r.deleted_at != null }]));
    const grades = new Map(resRows.map((r) => [s(r.session_id), s(r.grade) as Grade]));
    const now = new Date();
    const items: HistoryRow[] = sessRows.map(toSession).flatMap((x) => {
      const c = cands.get(x.candidateId);
      if (!c) return [];
      return [{
        sessionId: x.id, candidateId: x.candidateId, name: c.c.name, kana: c.c.kana, gender: c.c.gender,
        role: x.role, base: x.base, method: x.method, state: sessionState(x, now),
        createdAt: x.createdAt, completedAt: x.completedAt, versionId: x.versionId,
        grade: grades.get(x.id) ?? null, deleted: c.deleted,
      }];
    });
    items.sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt));
    return { items };
  });

export type SessionView = Session & {
  state: SessionState;
  answered: number;
  total: number;
  result: (Result & { alt: Record<Role, { grade: Grade; aptitude: number; reliable: boolean }> }) | null;
};

export type LogRow = { at: string; actor: string; actorCampus: string; action: string; detail: string };

// 同じ人が同じ受検者の詳細を何度も読み直しても、この間は「結果閲覧」を1件にまとめる
const VIEW_LOG_WINDOW_MS = 10 * 60 * 1000;

/** 詳細：受検者・受検（結果つき）・結果を描くための尺度・閲覧ログ。結果があれば「結果閲覧」を記録する。 */
export const getCandidate = (id: string, actor: Actor) =>
  run(async (t) => {
    needId(id);
    const [row] = await t.select('apt_candidates', { id });
    if (!row || row.deleted_at != null) bad('not_found');
    const candidate = toCandidate(row);
    const sessions = (await t.select('apt_sessions', { candidate_id: id })).map(toSession).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const ids = sessions.map((x) => x.id);
    const [ansRows, resRows] = ids.length
      ? await Promise.all([t.select('apt_answers', { session_id: ids }), t.select('apt_results', { session_id: ids })])
      : [[], []];
    const results = new Map(resRows.map((r) => [s(r.session_id), toResult(r)]));
    const versions = new Map<string, VersionDetail>();
    const versionOf = async (vid: string) => {
      if (!versions.has(vid)) versions.set(vid, await loadVersion(t, vid));
      return versions.get(vid)!;
    };
    const now = new Date();
    const out: SessionView[] = [];
    for (const x of sessions) {
      const v = await versionOf(x.versionId);
      const r = results.get(x.id) ?? null;
      let result: SessionView['result'] = null;
      if (r) {
        // 同じ得点を、ほかの職種の基準で見た判定（保存はしない）
        const alt = {} as Record<Role, { grade: Grade; aptitude: number; reliable: boolean }>;
        for (const role of ROLES) {
          if (!v.rules[role]) continue;
          const j = role === r.judgment.role ? r.judgment : judge(role, r.scores, v.rules[role], v.scales, r.avgSeconds);
          alt[role] = { grade: j.grade, aptitude: j.aptitude, reliable: j.reliable };
        }
        result = { ...r, alt };
      }
      out.push({
        ...x,
        state: sessionState(x, now),
        answered: ansRows.filter((a) => s(a.session_id) === x.id).length,
        total: x.questionOrder.length || v.questions.filter((q) => q.active).length,
        result,
      });
    }
    let logRows = await t.select('apt_logs', { candidate_id: id });
    if (results.size) {
      const since = Date.now() - VIEW_LOG_WINDOW_MS;
      const seen = logRows.some((r) => s(r.action) === '結果閲覧' && s(r.actor) === actor.name && new Date(s(r.at)).getTime() > since);
      if (!seen) {
        await addLog(t, actor, '結果閲覧', { candidateId: id });
        logRows = await t.select('apt_logs', { candidate_id: id });
      }
    }
    // 結果を描くのに使う、版ごとの尺度と判定基準（閾値の目盛りを出すため）
    const versionInfo: Record<string, { name: string; scales: Scale[]; rules: Record<Role, RoleRule> }> = {};
    versions.forEach((v, vid) => { versionInfo[vid] = { name: v.name, scales: v.scales, rules: v.rules }; });
    const logs: LogRow[] = logRows
      .sort((a, b) => s(b.at).localeCompare(s(a.at)))
      .slice(0, 100)
      .map((r) => ({ at: iso(r.at), actor: s(r.actor), actorCampus: s(r.actor_campus), action: s(r.action), detail: s(r.detail) }));
    return { candidate, sessions: out, versions: versionInfo, logs };
  });

export const createCandidate = (input: CandidateInput, actor: Actor) =>
  run(async (t) => {
    const id = randomUUID();
    const now = nowIso();
    await t.insert('apt_candidates', [{
      id, ...candidateFields(input), hire_status_at: now,
      created_at: now, created_by: actor.name, updated_at: now, updated_by: actor.name, deleted_at: null,
    }]);
    await addLog(t, actor, '受検者の登録', { candidateId: id });
    const [row] = await t.select('apt_candidates', { id });
    return { item: toCandidate(row) };
  });

export const updateCandidate = (id: string, input: CandidateInput, actor: Actor) =>
  run(async (t) => {
    needId(id);
    const [row] = await t.select('apt_candidates', { id });
    if (!row || row.deleted_at != null) bad('not_found');
    const now = nowIso();
    const patch: Row = { ...candidateFields(input), updated_at: now, updated_by: actor.name };
    const before = toCandidate(row);
    if (before.hireStatus !== input.hireStatus) patch.hire_status_at = now;
    await t.update('apt_candidates', { id }, patch);
    const changed = before.hireStatus !== input.hireStatus ? `採用結果：${before.hireStatus} → ${input.hireStatus}` : '';
    await addLog(t, actor, '受検者の更新', { candidateId: id, detail: changed });
    const [after] = await t.select('apt_candidates', { id });
    return { item: toCandidate(after) };
  });

/** 採用結果・入社後の評価だけを変える。ほかの項目は触らない（受検者が同意の画面で入れた連絡先などを古い値で上書きしないため）。 */
export const updateHire = (id: string, input: HireInput, actor: Actor) =>
  run(async (t) => {
    needId(id);
    const [row] = await t.select('apt_candidates', { id });
    if (!row || row.deleted_at != null) bad('not_found');
    const before = toCandidate(row);
    const now = nowIso();
    const patch: Row = {
      hire_status: input.hireStatus, post_eval: input.postEval, post_eval_note: input.postEvalNote,
      updated_at: now, updated_by: actor.name,
    };
    if (before.hireStatus !== input.hireStatus) patch.hire_status_at = now;
    await t.update('apt_candidates', { id }, patch);
    const changed = before.hireStatus !== input.hireStatus ? `採用結果：${before.hireStatus} → ${input.hireStatus}` : '';
    await addLog(t, actor, '採用結果・評価の更新', { candidateId: id, detail: changed });
    const [after] = await t.select('apt_candidates', { id });
    return { item: toCandidate(after) };
  });

/** 削除は印を付けるだけ（一覧から消える）。未完了の受検URLは使えなくする。RETENTION.deletedDays 後に完全に消す。 */
export const deleteCandidate = (id: string, actor: Actor) =>
  run(async (t) => {
    needId(id);
    const [row] = await t.select('apt_candidates', { id });
    if (!row || row.deleted_at != null) bad('not_found');
    await t.update('apt_candidates', { id }, { deleted_at: nowIso(), updated_by: actor.name });
    await t.update('apt_sessions', { candidate_id: id, status: ['未受検', '受検中'] }, { status: '取消' });
    await addLog(t, actor, '受検者の削除', { candidateId: id });
    return {};
  });

// ---- 受検（職員側） -----------------------------------------------------------

function shuffled(list: number[]): number[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const newToken = () => randomBytes(24).toString('base64url');
const daysLater = (n: number, from = new Date()) => new Date(from.getTime() + n * 86400000).toISOString();

async function liveCandidate(t: Tables, id: string): Promise<Candidate> {
  needId(id);
  const [row] = await t.select('apt_candidates', { id });
  if (!row || row.deleted_at != null) bad('not_found');
  return toCandidate(row);
}

/** Web 受検の URL を発行する。同じ人の未完了の受検は取り消す（使える URL を1本にする）。 */
export const issueSession = (candidateId: string, actor: Actor) =>
  run(async (t) => {
    const c = await liveCandidate(t, candidateId);
    const v = await publishedVersion(t);
    await t.update('apt_sessions', { candidate_id: candidateId, method: 'Web', status: ['未受検', '受検中'] }, { status: '取消' });
    const id = randomUUID();
    const now = nowIso();
    await t.insert('apt_sessions', [{
      id, candidate_id: candidateId, version_id: v.id, role: c.role, base: c.base, token: newToken(),
      expires_at: daysLater(TOKEN_DAYS), method: 'Web', status: '未受検',
      question_order: shuffled(v.questions.filter((q) => q.active).map((q) => q.no)),
      consent_at: null, started_at: null, completed_at: null, created_at: now, created_by: actor.name,
    }]);
    await addLog(t, actor, '受検URLの発行', { candidateId, sessionId: id });
    return { id };
  });

async function openSession(t: Tables, id: string): Promise<Session> {
  needId(id);
  const [row] = await t.select('apt_sessions', { id });
  if (!row) bad('not_found');
  const x = toSession(row);
  if (x.status === '完了') bad('already_done');
  return x;
}

export const revokeSession = (id: string, actor: Actor) =>
  run(async (t) => {
    const x = await openSession(t, id);
    await t.update('apt_sessions', { id }, { status: '取消' });
    await addLog(t, actor, '受検URLの取消', { candidateId: x.candidateId, sessionId: id });
    return {};
  });

/** 有効期限を今日から TOKEN_DAYS 日後に延ばす。取り消した受検は延ばせない。 */
export const extendSession = (id: string, actor: Actor) =>
  run(async (t) => {
    const x = await openSession(t, id);
    if (x.status === '取消') bad('revoked');
    const expiresAt = daysLater(TOKEN_DAYS);
    await t.update('apt_sessions', { id }, { expires_at: expiresAt });
    await addLog(t, actor, '受検URLの延長', { candidateId: x.candidateId, sessionId: id });
    return { expiresAt };
  });

/** 紙で受けた回答を職員が代理入力する（使う設問すべての ○× が必要）。すぐに採点する。 */
export const savePaperSession = (candidateId: string, answers: Record<number, AnswerValue>, actor: Actor) =>
  run(async (t) => {
    const c = await liveCandidate(t, candidateId);
    const v = await publishedVersion(t);
    const active = v.questions.filter((q) => q.active);
    const missing = active.filter((q) => answers[q.no] !== 'Y' && answers[q.no] !== 'N').map((q) => q.no);
    if (missing.length) bad(`unanswered|${missing.join(',')}`);
    // 紙で受けたので、未完了の Web 受検の URL は使えなくする（2つめの結果が「最新」にならないように）
    await t.update('apt_sessions', { candidate_id: candidateId, method: 'Web', status: ['未受検', '受検中'] }, { status: '取消' });
    const id = randomUUID();
    const now = nowIso();
    const session: Row = {
      id, candidate_id: candidateId, version_id: v.id, role: c.role, base: c.base, token: newToken(),
      expires_at: now, method: '紙', status: '完了', question_order: active.map((q) => q.no),
      consent_at: null, started_at: now, completed_at: now, created_at: now, created_by: actor.name,
    };
    await t.insert('apt_sessions', [session]);
    const list: Answer[] = active.map((q) => ({ no: q.no, answer: answers[q.no], seconds: null }));
    await t.insert('apt_answers', list.map((a) => ({ session_id: id, question_no: a.no, answer: a.answer, seconds: null, answered_at: now })));
    await saveResult(t, toSession(session), v, list);
    await addLog(t, actor, '紙回答の入力', { candidateId, sessionId: id });
    return { id };
  });

async function saveResult(t: Tables, x: Session, v: VersionDetail, answers: Answer[]): Promise<Result> {
  const rule = v.rules[x.role];
  if (!rule) bad('rules_missing');
  const scores = scoreScales(v.questions, answers);
  const avg = x.method === 'Web' ? averageSeconds(answers) : null;
  const judgment = judge(x.role, scores, rule, v.scales, avg);
  const computedAt = nowIso();
  await t.upsert('apt_results', [{
    session_id: x.id, version_id: v.id, role: x.role, scores, aptitude: judgment.aptitude, grade: judgment.grade,
    judgment, avg_seconds: avg, computed_at: computedAt,
  }], ['session_id']);
  return { sessionId: x.id, versionId: v.id, scores, avgSeconds: avg, judgment, computedAt };
}

// ---- 受検（受検者側。受検URLのトークンだけで開く） ----------------------------

/** 受検画面に出す状態。ready＝同意前、answering＝回答中、done＝完了、expired／revoked／not_found は受けられない。 */
export type ExamState = 'ready' | 'answering' | 'done' | 'expired' | 'revoked' | 'not_found';

async function byToken(t: Tables, token: string): Promise<{ x: Session; c: Candidate | null; deleted: boolean } | null> {
  if (!token || token.length < 20) return null;
  const [row] = await t.select('apt_sessions', { token });
  if (!row) return null;
  const x = toSession(row);
  if (x.method !== 'Web') return null;
  const [crow] = await t.select('apt_candidates', { id: x.candidateId });
  return { x, c: crow ? toCandidate(crow) : null, deleted: !crow || crow.deleted_at != null };
}

function examStateOf(x: Session, deleted: boolean): ExamState {
  if (deleted) return 'revoked';
  const st = sessionState(x);
  if (st === '完了') return 'done';
  if (st === '取消') return 'revoked';
  if (st === '期限切れ') return 'expired';
  return x.consentAt ? 'answering' : 'ready';
}

export type ExamView = {
  state: ExamState;
  name?: string;
  profile?: ExamProfile;
  expiresAt?: string;
  items?: { pos: number; text: string }[]; // 受検画面に出す順。設問番号は渡さない（尺度を推測されないため）
  answers?: Record<number, AnswerValue>; // pos → 回答（途中から再開するため）
};

export const examView = (token: string) =>
  run(async (t): Promise<{ view: ExamView }> => {
    const f = await byToken(t, token);
    if (!f) return { view: { state: 'not_found' } };
    const state = examStateOf(f.x, f.deleted);
    if (state !== 'ready' && state !== 'answering') return { view: { state } };
    const c = f.c!;
    // 連絡先・生年月日は、確認の欄に出す同意の前（ready）だけ返す（URL を知っている人に余計に見せない）
    const view: ExamView = { state, name: c.name, expiresAt: f.x.expiresAt };
    if (state === 'ready') view.profile = { kana: c.kana, birthDate: c.birthDate, phone: c.phone, email: c.email };
    if (state === 'answering') {
      const v = await loadVersion(t, f.x.versionId);
      const text = new Map(v.questions.map((q) => [q.no, q.text]));
      view.items = f.x.questionOrder.map((no, pos) => ({ pos, text: text.get(no) ?? '' }));
      const posOf = new Map(f.x.questionOrder.map((no, pos) => [no, pos]));
      view.answers = {};
      for (const a of (await t.select('apt_answers', { session_id: f.x.id })).map(toAnswer)) {
        const pos = posOf.get(a.no);
        if (pos != null) view.answers[pos] = a.answer;
      }
    }
    return { view };
  });

async function answerable(t: Tables, token: string, needConsent: boolean) {
  const f = await byToken(t, token);
  if (!f) bad('not_found');
  const state = examStateOf(f!.x, f!.deleted);
  if (state === 'done') bad('already_done');
  if (state === 'expired') bad('expired');
  if (state === 'revoked') bad('revoked');
  if (needConsent && state !== 'answering') bad('no_consent');
  return f!;
}

/** 同意とプロフィールの確認。受検者が入れた値で受検者の情報を埋める（空欄で送られた項目は変えない）。 */
export const examConsent = (token: string, profile: ExamProfile) =>
  run(async (t) => {
    const f = await answerable(t, token, false);
    const now = nowIso();
    const patch: Row = { kana: profile.kana, updated_at: now, updated_by: '受検者' };
    if (profile.birthDate) patch.birth_date = profile.birthDate;
    if (profile.phone) patch.phone = profile.phone;
    if (profile.email) patch.email = profile.email;
    await t.update('apt_candidates', { id: f.x.candidateId }, patch);
    if (!f.x.consentAt) await t.update('apt_sessions', { id: f.x.id }, { consent_at: now, started_at: now, status: '受検中' });
    return {};
  });

export type ExamAnswerInput = { pos: number; answer: AnswerValue; seconds: number | null };

/** 回答の途中保存（1ページ分ずつ）。同じ設問は上書き。 */
export const examSaveAnswers = (token: string, items: ExamAnswerInput[]) =>
  run(async (t) => {
    const f = await answerable(t, token, true);
    const order = f.x.questionOrder;
    const now = nowIso();
    // 同じ設問が1回の送信に2つあれば最後の1つ（Supabase は1回の upsert で同じ行を2度書けない）
    const byPos = new Map<number, ExamAnswerInput>();
    for (const a of items) {
      if (Number.isInteger(a.pos) && a.pos >= 0 && a.pos < order.length && (a.answer === 'Y' || a.answer === 'N')) byPos.set(a.pos, a);
    }
    // 秒数が無い回答（再開後に答え直した設問など）は、保存済みの秒数を消さない
    const saved = new Map((await t.select('apt_answers', { session_id: f.x.id })).map((r) => [Number(r.question_no), numOrNull(r.seconds)]));
    const rows = [...byPos.values()].map((a) => {
      const no = order[a.pos];
      const sec = a.seconds != null && Number.isFinite(a.seconds) && a.seconds >= 0 ? Math.min(Math.round(a.seconds * 10) / 10, 3600) : null;
      return { session_id: f.x.id, question_no: no, answer: a.answer, seconds: sec ?? saved.get(no) ?? null, answered_at: now };
    });
    await t.upsert('apt_answers', rows, ['session_id', 'question_no']);
    return { saved: rows.length };
  });

/** 回答を締めて採点する。全問に答えていなければ、答えていない位置（pos）を返して止める。 */
export const examFinish = (token: string) =>
  run(async (t) => {
    const f = await answerable(t, token, true);
    const v = await loadVersion(t, f.x.versionId);
    const answers = (await t.select('apt_answers', { session_id: f.x.id })).map(toAnswer);
    const got = new Set(answers.map((a) => a.no));
    const missing = f.x.questionOrder.map((no, pos) => (got.has(no) ? -1 : pos)).filter((p) => p >= 0);
    if (missing.length) bad(`unanswered|${missing.join(',')}`);
    const done = { ...f.x, status: '完了' as const, completedAt: nowIso() };
    await saveResult(t, done, v, answers);
    await t.update('apt_sessions', { id: f.x.id }, { status: '完了', completed_at: done.completedAt });
    return {};
  });

// ---- 閲覧・操作の記録 ---------------------------------------------------------

async function addLog(
  t: Tables, actor: Actor | null, action: string,
  o: { candidateId?: string; sessionId?: string; detail?: string } = {},
): Promise<void> {
  await t.insert('apt_logs', [{
    at: nowIso(), actor: actor?.name ?? '', actor_campus: actor?.campus ?? '', action,
    candidate_id: o.candidateId ?? null, session_id: o.sessionId ?? null, detail: o.detail ?? '',
  }]);
}

export const logAction = (actor: Actor | null, action: string, detail = '') =>
  run(async (t) => {
    await addLog(t, actor, action, { detail });
    return {};
  });

// ---- 保存期間 -----------------------------------------------------------------

/** 保存期間を過ぎた受検者を、受検・回答・結果ごと完全に削除する（RETENTION）。 */
export const purgeExpired = (actor: Actor | null, now = new Date()) =>
  run(async (t) => {
    const deniedBefore = now.getTime() - RETENTION.deniedDays * 86400000;
    const deletedBefore = now.getTime() - RETENTION.deletedDays * 86400000;
    const due = (await t.select('apt_candidates')).filter((r) => {
      if (r.deleted_at != null) return new Date(s(r.deleted_at)).getTime() < deletedBefore;
      const hs = s(r.hire_status);
      return (hs === '不採用' || hs === '辞退') && new Date(s(r.hire_status_at)).getTime() < deniedBefore;
    });
    for (const c of due) {
      const id = s(c.id);
      const sids = (await t.select('apt_sessions', { candidate_id: id })).map((r) => s(r.id));
      if (sids.length) {
        await t.remove('apt_answers', { session_id: sids });
        await t.remove('apt_results', { session_id: sids });
        await t.remove('apt_sessions', { candidate_id: id });
      }
      await t.remove('apt_candidates', { id });
    }
    if (due.length) await addLog(t, actor, '保存期間切れの削除', { detail: `${due.length}人` });
    return { purged: due.length };
  });

// ---- 校正用CSV ----------------------------------------------------------------

export type ExportRow = {
  candidateId: string;
  role: Role;
  base: string;
  completedAt: string;
  method: Session['method'];
  versionId: string;
  scores: Record<ScaleCode, number | null>;
  aptitude: number;
  grade: Grade;
  flags: string;
  avgSeconds: number | null;
  hireStatus: string;
  postEval: number | null;
  postEvalNote: string;
};

/** 完了した受検1回＝1行。氏名・連絡先は入れない（校正に要らないため）。 */
export const exportRows = (actor: Actor) =>
  run(async (t) => {
    const [cands, sessRows, resRows] = await Promise.all([liveCandidates(t), t.select('apt_sessions', { status: '完了' }), t.select('apt_results')]);
    const byId = new Map(cands.map((c) => [c.id, c]));
    const results = new Map(resRows.map((r) => [s(r.session_id), toResult(r)]));
    const FLAG: Record<string, string> = { alert: '要注意', caution: '注意', lie: '虚偽', speed: '速すぎ' };
    const rows: ExportRow[] = sessRows.map(toSession).flatMap((x) => {
      const c = byId.get(x.candidateId);
      const r = results.get(x.id);
      if (!c || !r) return [];
      const scores = {} as Record<ScaleCode, number | null>;
      for (const [code, v] of Object.entries(r.scores)) scores[code as ScaleCode] = v.score;
      return [{
        candidateId: c.id, role: r.judgment.role, base: x.base, completedAt: x.completedAt, method: x.method, versionId: r.versionId,
        scores, aptitude: r.judgment.aptitude, grade: r.judgment.grade,
        flags: r.judgment.flags.map((f) => `${FLAG[f.kind]}${f.scale ? `:${f.scale}` : ''}`).join(' '),
        avgSeconds: r.avgSeconds, hireStatus: c.hireStatus, postEval: c.postEval, postEvalNote: c.postEvalNote,
      }];
    });
    rows.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    await addLog(t, actor, 'CSV出力', { detail: `${rows.length}件` });
    return { rows };
  });
