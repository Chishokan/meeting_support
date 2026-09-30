// ログインアカウント（Supabase の app_users）の読み書き。サーバ専用。
// テーブルは supabase/migrations/0002_app_users.sql。

import { createHash, randomBytes, randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from './supabase';
import { isRole, type Role } from './roles';

export type AppUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  dept: string;
  classrooms: string[];
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type Row = {
  id: string; email: string; name: string; role: string; dept: string; classrooms: string[] | null;
  password_hash: string; must_change_password: boolean; is_active: boolean;
  failed_count: number; locked_until: string | null; last_login_at: string | null; created_at: string;
};

const PUBLIC_COLS = 'id,email,name,role,dept,classrooms,must_change_password,is_active,last_login_at,created_at';

export const MAX_FAILS = 5;            // この回数続けて間違えたら
export const LOCK_MINUTES = 15;        // この分数ログインできなくする
export const TOKEN_HOURS = 72;         // パスワード変更用URLの有効時間
export const MIN_PASSWORD_LENGTH = 8;

function toUser(r: Omit<Row, 'password_hash' | 'failed_count' | 'locked_until'>): AppUser {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: isRole(r.role) ? r.role : 'teacher',
    dept: r.dept ?? '',
    classrooms: r.classrooms ?? [],
    mustChangePassword: !!r.must_change_password,
    isActive: !!r.is_active,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
  };
}

// メールアドレスは小文字にそろえて保存・照合する（DB の一意制約も lower(email)）。
export function normalizeEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function db() {
  const c = supabaseAdmin();
  if (!c) throw new Error('db_not_configured');
  return c;
}

export function usersConfigured(): boolean {
  return !!supabaseAdmin();
}

// ---- パスワード ------------------------------------------------------------

// ColorHRM（PHP password_hash）の "$2y$" も同じ bcrypt なので、そのまま照合できるように "$2b$" として扱う。
export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 10);
}

export function verifyPassword(pw: string, hash: string): boolean {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(pw, hash.replace(/^\$2y\$/, '$2b$'));
  } catch {
    return false;
  }
}

let dummy = '';
function dummyHash(): string {
  return dummy || (dummy = hashPassword(randomBytes(16).toString('hex')));
}

// 初期パスワード。読み間違えやすい文字（0/O, 1/l/I）を除いた 12 文字。
export function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[randomInt(chars.length)];
  return s;
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`;
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'パスワードは英字と数字を両方含めてください。';
  return null;
}

// ---- 読み取り --------------------------------------------------------------

export async function countUsers(): Promise<number> {
  const { count, error } = await db().from('app_users').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function listUsers(): Promise<AppUser[]> {
  const { data, error } = await db().from('app_users').select(PUBLIC_COLS).order('created_at');
  if (error) throw error;
  return (data ?? []).map(toUser);
}

export async function getUser(id: string): Promise<AppUser | null> {
  const { data, error } = await db().from('app_users').select(PUBLIC_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toUser(data) : null;
}

async function findByEmail(email: string): Promise<AppUser | null> {
  const { data, error } = await db().from('app_users').select(PUBLIC_COLS).eq('email', email).maybeSingle();
  if (error) throw error;
  return data ? toUser(data) : null;
}

// ---- ログイン --------------------------------------------------------------

export type LoginResult =
  | { ok: true; user: AppUser }
  | { ok: false; reason: 'invalid' | 'locked' | 'inactive' };

export async function authenticate(emailRaw: string, password: string): Promise<LoginResult> {
  const email = normalizeEmail(emailRaw);
  const { data, error } = await db().from('app_users').select('*').eq('email', email).maybeSingle();
  if (error) throw error;
  // 存在しないアカウントでも照合と同じくらい時間をかけ、「そのメールアドレスがあるか」を悟らせない。
  if (!data) {
    verifyPassword(password, dummyHash());
    return { ok: false, reason: 'invalid' };
  }
  const r = data as Row;
  if (r.locked_until && new Date(r.locked_until).getTime() > Date.now()) return { ok: false, reason: 'locked' };
  if (!verifyPassword(password, r.password_hash)) {
    const fails = (r.failed_count ?? 0) + 1;
    const patch: Record<string, unknown> = { failed_count: fails };
    if (fails >= MAX_FAILS) {
      patch.failed_count = 0;
      patch.locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
    }
    await db().from('app_users').update(patch).eq('id', r.id);
    return { ok: false, reason: fails >= MAX_FAILS ? 'locked' : 'invalid' };
  }
  if (!r.is_active) return { ok: false, reason: 'inactive' };
  await db().from('app_users')
    .update({ failed_count: 0, locked_until: null, last_login_at: new Date().toISOString() })
    .eq('id', r.id);
  return { ok: true, user: toUser(r) };
}

// ---- 発行・更新 ------------------------------------------------------------

export type UserInput = { email: string; name: string; role: Role; dept: string; classrooms: string[] };

export async function createUser(input: UserInput, createdBy: string): Promise<
  { ok: true; user: AppUser; password: string } | { ok: false; reason: 'duplicate' }
> {
  if (await findByEmail(input.email)) return { ok: false, reason: 'duplicate' };
  const password = generatePassword();
  const { data, error } = await db().from('app_users').insert({
    email: input.email,
    name: input.name,
    role: input.role,
    dept: input.dept,
    classrooms: input.classrooms,
    password_hash: hashPassword(password),
    must_change_password: true,
    created_by: createdBy,
  }).select(PUBLIC_COLS).single();
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'duplicate' };
    throw error;
  }
  return { ok: true, user: toUser(data), password };
}

export async function updateUser(
  id: string,
  patch: Partial<UserInput> & { isActive?: boolean },
): Promise<{ ok: true; user: AppUser } | { ok: false; reason: 'not_found' | 'duplicate' }> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.email !== undefined) {
    const other = await findByEmail(patch.email);
    if (other && other.id !== id) return { ok: false, reason: 'duplicate' };
    row.email = patch.email;
  }
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.role !== undefined) row.role = patch.role;
  if (patch.dept !== undefined) row.dept = patch.dept;
  if (patch.classrooms !== undefined) row.classrooms = patch.classrooms;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  const { data, error } = await db().from('app_users').update(row).eq('id', id).select(PUBLIC_COLS).maybeSingle();
  if (error) {
    if (error.code === '23505') return { ok: false, reason: 'duplicate' };
    throw error;
  }
  return data ? { ok: true, user: toUser(data) } : { ok: false, reason: 'not_found' };
}

/** 初期パスワードを作り直す（再発行）。以前のパスワード変更用URLは使えなくする。 */
export async function resetPassword(id: string): Promise<string> {
  const password = generatePassword();
  const { error } = await db().from('app_users').update({
    password_hash: hashPassword(password),
    must_change_password: true,
    failed_count: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
  await db().from('app_password_tokens').delete().eq('user_id', id);
  return password;
}

export async function setPassword(id: string, password: string): Promise<void> {
  const { error } = await db().from('app_users').update({
    password_hash: hashPassword(password),
    must_change_password: false,
    failed_count: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
  await db().from('app_password_tokens').delete().eq('user_id', id);
}

/** 本人確認（パスワード変更画面で今のパスワードを確かめる）。 */
export async function checkCurrentPassword(id: string, password: string): Promise<boolean> {
  const { data, error } = await db().from('app_users').select('password_hash').eq('id', id).maybeSingle();
  if (error) throw error;
  return !!data && verifyPassword(password, (data as { password_hash: string }).password_hash);
}

// ---- パスワード変更用URLのトークン -----------------------------------------

function hashToken(t: string): string {
  return createHash('sha256').update(t).digest('hex');
}

export async function issuePasswordToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const { error } = await db().from('app_password_tokens').insert({
    token_hash: hashToken(token),
    user_id: userId,
    expires_at: new Date(Date.now() + TOKEN_HOURS * 3600_000).toISOString(),
  });
  if (error) throw error;
  return token;
}

/** トークンが有効ならその利用者を返す（使ってはいない）。 */
export async function peekPasswordToken(token: string): Promise<AppUser | null> {
  if (!token) return null;
  const { data, error } = await db().from('app_password_tokens')
    .select('user_id,expires_at,used_at').eq('token_hash', hashToken(token)).maybeSingle();
  if (error) throw error;
  if (!data || data.used_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  const u = await getUser(data.user_id);
  return u && u.isActive ? u : null;
}

/** トークンでパスワードを設定する（一回限り）。 */
export async function consumePasswordToken(token: string, password: string): Promise<AppUser | null> {
  const u = await peekPasswordToken(token);
  if (!u) return null;
  // 先に「使用済み」にしてから設定する（同じURLの二重使用を防ぐ）
  const { data, error } = await db().from('app_password_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', hashToken(token)).is('used_at', null).select('token_hash');
  if (error) throw error;
  if (!data || data.length === 0) return null;
  await setPassword(u.id, password);
  return { ...u, mustChangePassword: false };
}

// ---- 入力の確認（アカウント発行・編集の画面から来た値） ---------------------

export function parseUserInput(body: Record<string, unknown>, depts: string[], classrooms: string[]):
  { ok: true; input: UserInput } | { ok: false; error: string } {
  const email = normalizeEmail(body.email);
  const name = String(body.name ?? '').trim();
  const role = body.role;
  const dept = String(body.dept ?? '').trim();
  const rooms = Array.isArray(body.classrooms) ? body.classrooms.map(String) : [];
  if (!isEmail(email)) return { ok: false, error: 'メールアドレスの形が正しくありません。' };
  if (!name) return { ok: false, error: '氏名を入力してください。' };
  if (!isRole(role)) return { ok: false, error: 'ロールを選んでください。' };
  if (dept && !depts.includes(dept)) return { ok: false, error: '部門の値が正しくありません。' };
  if (role !== 'teacher' && !dept) return { ok: false, error: '部門を選んでください（会議DXの報告先になります）。' };
  const bad = rooms.find((c) => !classrooms.includes(c));
  if (bad) return { ok: false, error: `担当教室「${bad}」は選択肢にありません。` };
  return { ok: true, input: { email, name, role, dept, classrooms: Array.from(new Set(rooms)) } };
}

/** 削除（初回セットアップでメールが送れなかったときの取り消しにだけ使う。通常は利用停止にする）。 */
export async function deleteUser(id: string): Promise<void> {
  const { error } = await db().from('app_users').delete().eq('id', id);
  if (error) throw error;
}
