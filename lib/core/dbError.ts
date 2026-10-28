// データベース（Supabase）のエラーを、設定の直し方に言い換える。画面側（ブラウザ）で使う。
// 各アプリの store は失敗を「db_error|コード|文面」の形で返す（キーや接続先そのものは含まれない）。
// 門配管理・適性検査など、Supabase を使うアプリで共通に使う。

export function dbErrorText(code: string, msg: string): string {
  const m = msg.toLowerCase();
  if (code === 'PGRST106' || m.includes('schema must be one of') || m.includes('invalid schema')) {
    return 'データベースの区画が公開されていません。Supabase の Project Settings → Data API → Exposed schemas に chishokan_dev（本番は chishokan_prod）が入っているか確認してください。';
  }
  if (code === 'PGRST125' || m.includes('invalid path')) {
    return 'データベースの接続先URLが正しくありません。Vercel の SUPABASE_URL を「https://（プロジェクトID）.supabase.co」だけにしてください（末尾に /rest/v1 などを付けない）。';
  }
  if (code === 'PGRST205' || code === '42P01' || m.includes('could not find the table') || m.includes('does not exist')) {
    return 'データベースに表が見つかりません。Vercel の SUPABASE_SCHEMA の値と、SQL を実行した区画（chishokan_dev / chishokan_prod）が一致しているか確認してください。';
  }
  if (code === '42501' || m.includes('permission denied')) {
    return 'データベースの権限がありません。supabase/migrations の SQL を、その区画でもう一度実行してください（最後に権限を付ける部分があります）。';
  }
  if (m.includes('invalid api key') || m.includes('jwt') || m.includes('unauthorized')) {
    return 'データベースの鍵が正しくありません。Vercel の SUPABASE_SERVICE_ROLE_KEY が service_role（secret）キーになっているか確認してください。';
  }
  return `データベースの読み書きに失敗しました（${code || 'エラー'}：${msg || '詳細なし'}）。`;
}
