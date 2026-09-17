'use client';

import { useEffect } from 'react';

/**
 * ポップアップ（議事録・事前共有事項・中間報告の詳細）の共通のふるまい。
 *
 * - Esc で閉じる
 * - 開いているあいだ、後ろのページのスクロールを止める
 *   （スマホで本文をなぞると後ろのページが動いてしまい、閉じたときに
 *     見ていた場所から飛ばされるため）
 */
export function useModalDismiss(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
}
