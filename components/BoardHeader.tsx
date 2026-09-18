'use client';

// 問合せ管理（/inquiry-board）専用のヘッダ。会議DXのサイドバーは使わない。

export default function BoardHeader({ name, campus }: { name: string; campus: string }) {
  async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    window.location.href = '/login?next=/inquiry-board';
  }
  return (
    <header className="board-head">
      <div className="board-brand">
        <span className="board-title">智翔館 問合せ管理</span>
        <span className="board-sub">小中等部</span>
      </div>
      <div className="board-who">
        <span className="board-user">{campus}／{name} さん</span>
        <button className="board-logout" onClick={logout}>ログアウト</button>
      </div>
    </header>
  );
}
