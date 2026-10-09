// 適性検査：設問・尺度・判定基準の版。管理部門のみ。
//   GET  … 版の一覧
//   GET  ?id=v1 … 版の中身（尺度・設問・職種ごとの判定基準）と、その版で受けた受検の数
//   POST { action:'copy', from }   … 版をコピーして下書きを作る
//   POST { action:'save', id, name?, note?, scales?, questions?, rules? } … 下書きを書き換える
//   POST { action:'publish', id }  … 下書きを公開する（それまでの公開は「終了」）
//   POST { action:'delete', id }   … 誰も受けていない下書きを消す
import { copyVersion, deleteDraft, getVersion, listVersions, publishVersion, saveDraft, type DraftPatch } from '@/lib/aptitude/store';
import { ROLES, validateQuestions, validateRule, validateScales, type Role, type RoleRule } from '@/lib/aptitude/model';
import { badRequest, invalid, reply, staffGate } from '@/lib/aptitude/api';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = staffGate();
  if (g.res) return g.res;
  const id = new URL(req.url).searchParams.get('id');
  return reply(id ? await getVersion(id) : await listVersions());
}

export async function POST(req: Request) {
  const g = staffGate();
  if (g.res) return g.res;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(b.id ?? '');
  switch (b.action) {
    case 'copy':
      return b.from ? reply(await copyVersion(String(b.from), g.actor)) : badRequest();
    case 'publish':
      return id ? reply(await publishVersion(id, g.actor)) : badRequest();
    case 'delete':
      return id ? reply(await deleteDraft(id, g.actor)) : badRequest();
    case 'save': {
      if (!id) return badRequest();
      const patch: DraftPatch = {};
      const errors: string[] = [];
      if (b.name != null) patch.name = String(b.name).trim().slice(0, 80) || '名前なし';
      if (b.note != null) patch.note = String(b.note).trim().slice(0, 1000);
      if (b.scales != null) {
        const v = validateScales(b.scales);
        if (v.ok) patch.scales = v.value; else errors.push(...v.errors);
      }
      if (b.questions != null) {
        const v = validateQuestions(b.questions);
        if (v.ok) patch.questions = v.value; else errors.push(...v.errors);
      }
      if (b.rules != null) {
        const rules: Partial<Record<Role, RoleRule>> = {};
        for (const role of ROLES) {
          const src = (b.rules as Record<string, unknown>)[role];
          if (src == null) continue;
          const v = validateRule(src);
          if (v.ok) rules[role] = v.value; else errors.push(...v.errors.map((e) => `${role}：${e}`));
        }
        patch.rules = rules;
      }
      if (errors.length) return invalid(errors);
      return reply(await saveDraft(id, patch, g.actor));
    }
    default:
      return badRequest();
  }
}
