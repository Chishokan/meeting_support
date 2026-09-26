// 本番以外（dev 環境・作業ブランチのプレビュー・手元の開発）で「テスト環境」と画面上部に出す。
// 本番と取り違えて、試しのデータを入れたり本番の画面で試したりしないようにするため。
//
// VERCEL_ENV は Vercel が自動で設定する（production / preview / development）。
// 本番（production）では何も出さない。
//
// 画面の配置（固定のサイドバー・入力欄など）を崩さないよう、帯は重ねて表示し、
// クリックは下の画面に素通しする（pointer-events: none）。

// long は PC 向け、short はスマホ向け（幅が狭いとヘッダの文字に重なるため）。
function envLabel(): { long: string; short: string } | null {
  const env = process.env.VERCEL_ENV;
  if (env === 'production') return null;
  if (env === 'preview') return { long: 'テスト環境（本番とは別のデータです）', short: 'テスト環境' };
  if (env === 'development' || process.env.NODE_ENV === 'development') return { long: '開発環境（手元）', short: '開発環境' };
  return null;
}

export default function EnvBanner() {
  const label = envLabel();
  if (!label) return null;
  return (
    <div className="env-banner" aria-hidden="true">
      <span className="env-banner-label">
        <span className="env-banner-long">{label.long}</span>
        <span className="env-banner-short">{label.short}</span>
      </span>
    </div>
  );
}
