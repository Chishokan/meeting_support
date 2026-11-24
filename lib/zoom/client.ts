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
  // パーソナルミーティングID（PMI）を使ったミーティングか。
  // PMI は全部の会議で同じ番号・同じ参加URLになり、録画がどの会議のものか見分けられないので使わない。
  usesPmi: boolean;
  // いま開かれているか（'started'）。まだなら 'waiting'。作成・更新の返事には無いことがある。
  status: string;
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

type RawMeeting = {
  id?: number | string; join_url?: string; password?: string; start_url?: string;
  pmi?: number | string; settings?: { use_pmi?: boolean }; status?: string;
};

function toMeeting(r: RawMeeting | null): ZoomMeeting {
  if (!r?.id || !r.join_url) throw new ZoomError('upstream', 'empty');
  // PMI を使ったミーティングは、use_pmi が true になるか、pmi（その番号）が返ってくる。
  const usesPmi = r.settings?.use_pmi === true || (r.pmi != null && String(r.pmi) !== '');
  return {
    id: String(r.id), joinUrl: String(r.join_url), passcode: String(r.password ?? ''),
    startUrl: String(r.start_url ?? ''), usesPmi, status: String(r.status ?? ''),
  };
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
    // use_pmi:false … 会議ごとに別のミーティングIDを作る。
    //   Zoom の設定「ミーティングのスケジュール時にパーソナル ミーティング ID を使用する」がオンのアカウントでは、
    //   指定しないと全部の会議がパーソナルミーティングルーム（同じ番号）になる。
    settings: { auto_recording: 'cloud', use_pmi: false },
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

// ---------------------------------------------------------------------------
// 録画（クラウドレコーディング）
// ---------------------------------------------------------------------------
// 必要なスコープ：cloud_recording:read:list_recording_files:admin

export type RecordingFile = {
  id: string;
  // M4A（音声のみ）/ MP4（動画）/ TRANSCRIPT（Zoom の文字起こし・VTT）/ CHAT など
  type: string;
  size: number; // バイト
  downloadUrl: string;
  status: string; // completed になってから取りに行く
};

export type Recording = {
  uuid: string; // 開催1回ごとの番号（同じミーティングIDで何度開いても別になる）
  meetingId: string;
  topic: string;
  startTime: string; // ISO（UTC）
  durationMin: number;
  files: RecordingFile[];
};

type RawRecording = {
  uuid?: string; id?: number | string; topic?: string; start_time?: string; duration?: number;
  recording_files?: { id?: string; file_type?: string; file_size?: number; download_url?: string; status?: string }[];
};

// UUID に「/」が入っているときは、2回エンコードして渡す決まり。
function meetingPathId(idOrUuid: string): string {
  const once = encodeURIComponent(idOrUuid);
  return idOrUuid.startsWith('/') || idOrUuid.includes('//') ? encodeURIComponent(once) : once;
}

/**
 * ミーティングの録画ファイルの一覧。ミーティングIDを渡すと、いちばん新しい開催回の録画が返る。
 * 録画が無い（まだ処理中・録画していない）ときは not_found になる。
 */
export async function getRecording(id: ZoomAccountId, meetingIdOrUuid: string): Promise<Recording> {
  const r = await call<RawRecording>(account(id), 'GET', `/meetings/${meetingPathId(meetingIdOrUuid)}/recordings`);
  if (!r?.uuid) throw new ZoomError('not_found', 'no recording');
  return {
    uuid: String(r.uuid),
    meetingId: String(r.id ?? ''),
    topic: String(r.topic ?? ''),
    startTime: String(r.start_time ?? ''),
    durationMin: Number(r.duration) || 0,
    files: (r.recording_files ?? []).map((f) => ({
      id: String(f.id ?? ''),
      type: String(f.file_type ?? '').toUpperCase(),
      size: Number(f.file_size) || 0,
      downloadUrl: String(f.download_url ?? ''),
      status: String(f.status ?? ''),
    })),
  };
}

// 録画ファイルのダウンロード先として開いてよいものだけを通す（Zoom のホストだけ）。
function isZoomDownloadUrl(url: string): boolean {
  return /^https:\/\/([a-z0-9-]+\.)*zoom\.us\//i.test(url);
}

/**
 * 録画ファイルを取り出す。大きいファイルがあるので、上限を超えたら too_large で止める。
 * ダウンロード先は別のホストへ転送されることがあり、そのとき Authorization ヘッダは落ちるので、
 * Zoom の決まりどおりアクセストークンを URL に付けて渡す（この URL はログに出さない）。
 */
export async function downloadRecordingFile(
  id: ZoomAccountId,
  file: RecordingFile,
  maxBytes: number,
  timeoutMs = 120000,
): Promise<Uint8Array> {
  if (!isZoomDownloadUrl(file.downloadUrl)) throw new ZoomError('upstream', 'bad download url');
  if (file.size > maxBytes) throw new ZoomError('upstream', 'too_large');
  const token = await accessToken(account(id));
  const url = `${file.downloadUrl}${file.downloadUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new ZoomError('upstream', 'download network');
  }
  if (!res.ok) throw failOf(res.status, null);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new ZoomError('upstream', 'too_large');
  // サインイン画面などの HTML が返ってきたら失敗として扱う（トークンが通っていない）。
  const head = Buffer.from(buf.subarray(0, 15)).toString('latin1').toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) throw new ZoomError('auth', 'download html');
  return buf;
}
