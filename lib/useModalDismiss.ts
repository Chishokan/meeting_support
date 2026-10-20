'use client';

import { useEffect, useRef, type MouseEvent } from 'react';

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

/**
 * ポップアップの背景（枠の外）を押したときに閉じるためのハンドラ。背景の div にそのまま渡す。
 * 枠の中で押し始めて枠の外で離したとき（入力欄の文字をなぞって選ぶ・ドラッグ）は閉じない。
 * click は押した所と離した所の共通の親（＝背景）で起きるため、onClick だけだと入力中の内容ごと閉じてしまう。
 */
export function useBackdropClose(onClose: () => void) {
  const downOnBackdrop = useRef(false);
  return {
    onMouseDown: (e: MouseEvent) => { downOnBackdrop.current = e.target === e.currentTarget; },
    onClick: (e: MouseEvent) => {
      const close = downOnBackdrop.current && e.target === e.currentTarget;
      downOnBackdrop.current = false;
      if (close) onClose();
    },
  };
}
