// 「部門会議議事録」画面の編集中の内容を端末に保持するための置き場。
// ダッシュボードから［修正］を押したときも、ここへ書いてから画面を開く。
// ★保存キー・形を変えるときは components/DeptMinutesUI.tsx の読み書きも合わせること。

import {
  MINUTES_OPEN,
  MINUTES_CLOSE,
  QUALITY_OPEN,
  QUALITY_CLOSE,
} from '@/lib/deptMinutesPrompt';
import type { MinutesRow } from '@/app/api/dept-minutes/list/route';

export const DRAFT_KEY = 'chishokan_dept_minutes_v1';

export type MinutesDraft = {
  meta: { title: string; date: string; place: string; attendees: string; agenda: string };
  transcript: string;
  memo: string;
  draft: string;
  editingId: string;
};

// 保存済みの議事録を、編集画面がそのまま読める形に戻す。
// 本文と会議の質チェックは保存時に分けてあるので、区切りを付け直して1つの文章にする
//（この区切りが無いと、保存し直したときに質チェックが落ちる）。
export function draftFromRow(row: MinutesRow): MinutesDraft {
  const body = row.minutes.trim();
  const quality = row.quality.trim();
  const draft = [
    MINUTES_OPEN,
    body,
    MINUTES_CLOSE,
    ...(quality ? ['', QUALITY_OPEN, quality, QUALITY_CLOSE] : []),
  ].join('\n');

  return {
    meta: {
      title: row.title,
      date: row.date,
      place: row.place,
      attendees: row.attendees,
      agenda: row.agenda,
    },
    // 録音の文字起こしは保存していないので空。議事録本文が修正の材料になる。
    transcript: '',
    memo: '',
    draft,
    editingId: row.id,
  };
}

/** ダッシュボードなど別の画面から［修正］したときの受け渡し。 */
export function stashDraft(draft: MinutesDraft): boolean {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
