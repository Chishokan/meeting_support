// Zoom の参加URL・ミーティングIDの表示用の小さな道具（Zoom連携）。
//
// ★画面・API・テストのどこからでも読めるよう、ここには import を置かない（型と計算だけ）。

/**
 * 参加URLとして開いてよいものだけを返す（それ以外は ''）。
 * 参加URLはスプレッドシートに保存していて、シートは手でも書き換えられる。
 * ボタンのリンク先にするので、Zoom（https://….zoom.us/…）のURLだけを通す。
 */
export function zoomJoinHref(url: string | undefined | null): string {
  const u = String(url ?? '').trim();
  return /^https:\/\/([a-z0-9-]+\.)*zoom\.us\//i.test(u) ? u : '';
}

/** ミーティングIDを読みやすく区切る（例 82345678901 → 823 4567 8901）。数字以外が混じればそのまま返す。 */
export function formatMeetingId(id: string | undefined | null): string {
  const s = String(id ?? '').trim();
  if (!/^\d{9,11}$/.test(s)) return s;
  const head = s.length - 8;
  return `${s.slice(0, head)} ${s.slice(head, head + 4)} ${s.slice(head + 4)}`;
}

// Zoom の失敗の理由（lib/zoom/client.ts の ZoomFail と、事前共有 API が返す理由）を、画面に出す文にする。
export function zoomErrorText(reason: string | undefined | null): string {
  switch (String(reason ?? '')) {
    case 'not_configured':
      return 'Zoom 連携が未設定のため、Zoom ミーティングは作れませんでした。管理者にご連絡ください。';
    case 'bad_date':
      return 'Zoom ミーティングを作るには、開催日時に日付と開始時刻を入れてください（例：2026/11/25 13:00〜14:00）。';
    case 'auth':
      return 'Zoom に接続できませんでした（アプリの設定を確認してください）。管理者にご連絡ください。';
    case 'scope':
      return 'Zoom のアプリに必要な権限（スコープ）が足りません。管理者にご連絡ください。';
    case 'rate_limited':
      return 'Zoom への操作が多すぎます。しばらく待ってからもう一度お試しください。';
    case 'not_found':
      return 'Zoom ミーティングが見つかりません。Zoom 側で削除された可能性があります。事前共有を更新すると作り直します。';
    case 'pmi':
      return 'この会議はパーソナルミーティングルームで作られていたため、Zoom 側は削除していません（ほかの会議でも使われるためです）。';
    case 'forbidden':
      return 'ホストとして開始できるのは、この会議のホスト担当の方だけです（共通ログインで入っているときだけ）。ほかの方は［Zoomに参加］から入ってください。';
    case 'gas_outdated':
      return 'Apps Script が古いため、Zoom ミーティングの情報を保存できませんでした。管理者に Apps Script の更新（再デプロイ）を依頼してください。';
    default:
      return 'Zoom の操作に失敗しました。時間をおいてもう一度お試しください。';
  }
}
