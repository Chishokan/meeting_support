'use client';

// 総合画面（メニュー）のヘッダ。問合せ管理と同じ見た目（board-* のスタイル）を使う。

export default function PortalHeader({ name, campus }: { name: string; campus: string }) {
  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  }
  return (
    <header className="board-head">
      <div className="board-brand">
        <span className="board-title">智翔館アプリ</span>
        <span className="board-sub">メニュー</span>
      </div>
      <div className="board-who">
        <span className="board-user">{campus}／{name} さん</span>
        <button className="board-logout" onClick={logout}>ログアウト</button>
      </div>
    </header>
  );
}
