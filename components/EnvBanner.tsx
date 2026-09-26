// 本番以外（dev 環境・作業ブランチのプレビュー・手元の開発）で「テスト環境」と画面上部に出す。
// 本番と取り違えて、試しのデータを入れたり本番の画面で試したりしないようにするため。
//
// VERCEL_ENV は Vercel が自動で設定する（production / preview / development）。
// 本番（production）では何も出さない。
//
// 画面の配置（固定のサイドバー・入力欄など）を崩さないよう、帯は重ねて表示し、
// クリックは下の画面に素通しする（pointer-events: none）。

function envLabel(): string | null {
  const env = process.env.VERCEL_ENV;
  if (env === 'production') return null;
  if (env === 'preview') return 'テスト環境（本番とは別のデータです）';
  if (env === 'development' || process.env.NODE_ENV === 'development') return '開発環境（手元）';
  return null;
}

export default function EnvBanner() {
  const label = envLabel();
  if (!label) return null;
  return (
    <div className="env-banner" aria-hidden="true">
      <span className="env-banner-label">{label}</span>
    </div>
  );
}
