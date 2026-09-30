// ロールと担当教室の定義（ColorHRM の users.role / classrooms に合わせてある）。
// ブラウザ・サーバの両方から読む。

export const ROLES = ['admin', 'staff', 'employee', 'teacher'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: '管理者',
  staff: '教室長',
  employee: '社員',
  teacher: '講師',
};

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

// 担当教室の選択肢。アカウント発行画面のチェックボックスに並ぶ。
// ★教室を増やすときはここに足す（ColorHRM の classrooms テーブルと同じ表記にそろえる）。
export const CLASSROOMS: string[] = [
  '日野校',
  '駅前校',
  '大野校',
  '日宇校',
  '県中',
  'オンライン',
];
