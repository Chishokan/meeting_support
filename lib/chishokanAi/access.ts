// 智翔館AI（/ai）を使える人。試用中は、決めたメンバーだけに開く。
//
// ★メンバーは Vercel の環境変数 CHISHOKAN_AI_MEMBERS に、ログイン名をカンマ区切りで書く
//   （例：安藤純平,冨松太一,太田暁）。「*」と書くと全員に開く。
//   未設定のときは DEFAULT_MEMBERS だけが使える。
// メニューのカード・画面のレイアウト・API のすべてがここを読む。

export const DEFAULT_MEMBERS = ['安藤純平'];

export function aiMembers(env: string | undefined = process.env.CHISHOKAN_AI_MEMBERS): string[] | '*' {
  const v = (env ?? '').trim();
  if (v === '*') return '*';
  const names = v.split(/[,、，\s]+/).map((s) => s.trim()).filter(Boolean);
  return names.length ? names : DEFAULT_MEMBERS;
}

export function canUseChishokanAi(name: string, env?: string): boolean {
  const m = aiMembers(env);
  return m === '*' || m.includes(name);
}
