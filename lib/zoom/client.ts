// Zoom API の呼び出し（Zoom連携）。サーバ専用。
// Server-to-Server OAuth でアクセストークンを取り、ミーティングの作成・更新・取得を行う。
// アカウントは lib/zoom/accounts.ts（公式1・公式2）から選ぶ。
//
// 必要なスコープ（Zoom App Marketplace のアプリ側で付ける）：
//   ミーティングの作成・更新・読み取り・削除（meeting:write:meeting:admin / meeting:update:meeting:admin /
//   meeting:read:meeting:admin / meeting:delete:meeting:admin）

import { zoomAccount, type ZoomAccount, type ZoomAccountId } from './accounts';

const TOKEN_URL = 'https://zoom.us/oauth/token';
const API_BASE = 'https://api.zoom.us/v2';
const TIMEOUT_MS = 15000;

// 失敗の理由。画面の文言（components/DeptMinutesUI.tsx の zoomError）と対になっている。
//   not_configured … そのアカウントの接続情報が未設定
//   auth           … アプリの設定が違う（Client ID／Secret／Account ID、アプリが未有効）
//   scope          … スコープが足りない
//   not_found      … ミーティングが無い（Zoom 側で消された）
//   rate_limited   … 送りすぎ（1日100回の作成上限など）
//   upstream       … Zoom 側の不調・通信エラー
export type ZoomFail = 'not_configured' | 'auth' | 'scope' | 'not_found' | 'rate_limited' | 'upstream';

export class ZoomError extends Error {
  reason: ZoomFail;
  detail: string;
  constructor(reason: ZoomFail, detail = '') {
    super(reason);
    this.reason = reason;
    this.detail = detail;
  }
}

export type ZoomMeeting = {
  id: string; // ミーティングID（数字。桁が多いので文字列で持つ）
  joinUrl: string;
  passcode: string;
  startUrl: string; // ホストとして開始するURL。保存しない（期限があり、持つ人がホストになれるため）
};

export type MeetingInput = {
  topic: string;
  startTime: string; // 日本時間 'YYYY-MM-DDTHH:mm:00'
  durationMin: number;
  agenda?: string;
};

// アクセストークンは1時間有効。関数が生きているあいだは使い回す（期限の1分前に取り直す）。
const tokens = new Map<ZoomAccountId, { token: string; exp: number }>();

async function accessToken(a: ZoomAccount): Promise<string> {
  const hit = tokens.get(a.id);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  let res: Response;
  try {
    res = await fetch(`${TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(a.accountId)}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${a.clientId}:${a.clientSecret}`).toString('base64')}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ZoomError('upstream', 'token');
  }
  const j = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!res.ok || !j?.access_token) throw new ZoomError(res.status >= 500 ? 'upstream' : 'auth', `token ${res.status}`);
  tokens.set(a.id, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}

function failOf(status: number, body: { code?: number; message?: string } | null): ZoomError {
  const msg = String(body?.message ?? '');
  const detail = `HTTP ${status}${body?.code ? ` code ${body.code}` : ''}`;
  if (status === 401) return new ZoomError('auth', detail);
  if (status === 429) return new ZoomError('rate_limited', detail);
  if (status === 404) return new ZoomError('not_found', detail);
  // スコープ不足は 400 または 403 で「does not contain scopes」と返る。
  if (/scope/i.test(msg)) return new ZoomError('scope', detail);
  if (status === 403) return new ZoomError('auth', detail);
  return new ZoomError('upstream', detail);
}

async function call<T>(a: ZoomAccount, method: string, path: string, body?: unknown): Promise<T | null> {
  const token = await accessToken(a);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ZoomError('upstream', 'network');
  }
  if (res.status === 204) return null;
  const j = (await res.json().catch(() => null)) as (T & { code?: number; message?: string }) | null;
  if (!res.ok) {
    // トークンが失効していたら、次の呼び出しで取り直す。
    if (res.status === 401) tokens.delete(a.id);
    throw failOf(res.status, j);
  }
  return j;
}

function account(id: ZoomAccountId): ZoomAccount {
  const a = zoomAccount(id);
  if (!a) throw new ZoomError('not_configured');
  return a;
}

type RawMeeting = { id?: number | string; join_url?: string; password?: string; start_url?: string };

function toMeeting(r: RawMeeting | null): ZoomMeeting {
  if (!r?.id || !r.join_url) throw new ZoomError('upstream', 'empty');
  return { id: String(r.id), joinUrl: String(r.join_url), passcode: String(r.password ?? ''), startUrl: String(r.start_url ?? '') };
}

// Zoom に渡す本文。自動クラウド録画は会議ごとに指定する（アカウント全体の設定に頼らない）。
function meetingBody(m: MeetingInput) {
  return {
    topic: m.topic.slice(0, 200),
    type: 2, // 予定ミーティング
    start_time: m.startTime,
    timezone: 'Asia/Tokyo',
    duration: m.durationMin,
    ...(m.agenda ? { agenda: m.agenda.slice(0, 2000) } : {}),
    settings: { auto_recording: 'cloud' },
  };
}

/** 予定ミーティングを作る。 */
export async function createMeeting(id: ZoomAccountId, m: MeetingInput): Promise<ZoomMeeting> {
  const a = account(id);
  const r = await call<RawMeeting>(a, 'POST', `/users/${encodeURIComponent(a.host)}/meetings`, meetingBody(m));
  return toMeeting(r);
}

/** 会議名・日時を直したときに、同じミーティングを更新する（参加URLは変わらない）。 */
export async function updateMeeting(id: ZoomAccountId, meetingId: string, m: MeetingInput): Promise<void> {
  await call(account(id), 'PATCH', `/meetings/${encodeURIComponent(meetingId)}`, meetingBody(m));
}

/** ミーティングを消す（事前共有を削除したとき）。スコープ meeting:delete:meeting:admin が要る。 */
export async function deleteMeeting(id: ZoomAccountId, meetingId: string): Promise<void> {
  await call(account(id), 'DELETE', `/meetings/${encodeURIComponent(meetingId)}`);
}

/** ミーティングを読む。開始用URLはここで毎回取り直す。 */
export async function getMeeting(id: ZoomAccountId, meetingId: string): Promise<ZoomMeeting> {
  const r = await call<RawMeeting>(account(id), 'GET', `/meetings/${encodeURIComponent(meetingId)}`);
  return toMeeting(r);
}
