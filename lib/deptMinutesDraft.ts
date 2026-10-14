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
import { metaKey, type PreshareRow } from '@/lib/deptMinutesPreshare';

export const DRAFT_KEY = 'chishokan_dept_minutes_v1';

export type MinutesDraft = {
  meta: { title: string; date: string; place: string; attendees: string; agenda: string };
  transcript: string;
  memo: string;
  draft: string;
  editingId: string;
  // 事前共有した会議なら、その事前共有ID。議事録の保存時に添えて事前共有と結び付ける。
  preshareId?: string;
  // 事前共有したときの会議情報（metaKey）。共有後に手順1を直したかどうかを見分ける。
  preshareSnap?: string;
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

// 事前共有から議事録づくりを始めるときの形。会議情報だけを入れ、録音・議事録は空から始める。
// 事前共有した端末と、会議で録音する端末が違っても、同じ会議として議事録を結び付けられる。
export function draftFromPreshare(row: PreshareRow): MinutesDraft {
  const meta = {
    title: row.title,
    date: row.date,
    place: row.place,
    attendees: row.attendees,
    agenda: row.agenda,
  };
  return {
    meta,
    transcript: '',
    memo: '',
    draft: '',
    editingId: '',
    preshareId: row.id,
    preshareSnap: metaKey(meta),
  };
}

/** この端末に残っている編集中の内容（無ければ null）。 */
export function readDraft(): Partial<MinutesDraft> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<MinutesDraft>) : null;
  } catch {
    return null;
  }
}

/** 消すと取り戻せない入力（文字起こし・メモ・議事録）が残っているか。 */
export function draftHasWork(d: Partial<MinutesDraft> | null): boolean {
  return Boolean(d && (String(d.transcript ?? '').trim() || String(d.memo ?? '').trim() || String(d.draft ?? '').trim()));
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
