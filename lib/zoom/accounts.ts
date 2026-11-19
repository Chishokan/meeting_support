// Zoom アカウントの接続情報（Zoom連携）。サーバ専用。
// 会社の Zoom アカウントは2つあり、別々のアカウントなので Server-to-Server OAuth アプリも1つずつ作る。
//
// 【環境変数】※未設定でもアプリは壊れない（そのアカウントが選択肢に出ないだけ）
//   ZOOM_1_ACCOUNT_ID / ZOOM_1_CLIENT_ID / ZOOM_1_CLIENT_SECRET … 公式1 の Server-to-Server OAuth アプリの値
//   ZOOM_1_HOST  … ミーティングのホストにする Zoom ユーザーのメールアドレス（そのアカウントのサインインに使うもの）
//                  ★Server-to-Server OAuth では「me」が使えない決まりなので、必ずメールアドレスを入れる
//   ZOOM_1_LABEL … 画面に出す呼び名（任意・既定「公式1」）
//   ZOOM_2_…     … 公式2 も同じ
// ★シークレットはブラウザに渡さない（NEXT_PUBLIC_ を付けない）。
//
// ★画面の選択肢（id・呼び名）と部門ごとの既定は、テストからも読めるよう import を置いていない。

export type ZoomAccountId = '1' | '2';

export type ZoomAccount = {
  id: ZoomAccountId;
  label: string;
  accountId: string;
  clientId: string;
  clientSecret: string;
  host: string; // ミーティングを持つ Zoom ユーザーのメールアドレス
};

export const ZOOM_ACCOUNT_IDS: ZoomAccountId[] = ['1', '2'];

const DEFAULT_LABELS: Record<ZoomAccountId, string> = { '1': '公式1', '2': '公式2' };

// 部門ごとの既定のアカウント。中等部は公式2、その他の部門は公式1。
// 時間が重なるときなどは、事前共有の画面でもう一方を選べる。
const CAMPUS_DEFAULT: Record<string, ZoomAccountId> = { 小中等部: '2' };
const FALLBACK_DEFAULT: ZoomAccountId = '1';

export function isZoomAccountId(v: unknown): v is ZoomAccountId {
  return v === '1' || v === '2';
}

type Env = Record<string, string | undefined>;

/** 接続情報がそろっているアカウントだけを返す（そろっていなければ null）。 */
export function zoomAccount(id: ZoomAccountId, env: Env = process.env): ZoomAccount | null {
  const get = (k: string) => (env[`ZOOM_${id}_${k}`] ?? '').trim();
  const accountId = get('ACCOUNT_ID');
  const clientId = get('CLIENT_ID');
  const clientSecret = get('CLIENT_SECRET');
  const host = get('HOST');
  if (!accountId || !clientId || !clientSecret || !host) return null;
  return {
    id,
    label: get('LABEL') || DEFAULT_LABELS[id],
    accountId,
    clientId,
    clientSecret,
    host,
  };
}

/** 画面の選択肢に出すアカウント（接続情報がそろっているものだけ）。シークレットは含めない。 */
export function zoomAccountOptions(env: Env = process.env): { id: ZoomAccountId; label: string }[] {
  return ZOOM_ACCOUNT_IDS.flatMap((id) => {
    const a = zoomAccount(id, env);
    return a ? [{ id: a.id, label: a.label }] : [];
  });
}

/**
 * その部門が最初に使うアカウント。既定のアカウントが未設定なら、設定済みのもう一方にする。
 * どちらも未設定なら null（Zoom 連携そのものを画面に出さない）。
 */
export function defaultZoomAccount(campus: string, env: Env = process.env): ZoomAccountId | null {
  const options = zoomAccountOptions(env).map((o) => o.id);
  if (options.length === 0) return null;
  const want = CAMPUS_DEFAULT[campus] ?? FALLBACK_DEFAULT;
  return options.includes(want) ? want : options[0];
}
