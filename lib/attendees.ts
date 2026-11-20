// 会議の出席者（「安東瑞輝、太田暁」のように「、」で区切った文字列）の扱い。
// 出席者は、部門を選んで名前にチェックを入れて決める（components/AttendeePicker.tsx）。
// 保存する形は、これまでどおり1本の文字列（スプレッドシートの「出席者」列）。
// ★画面・API・テストのどこからでも読めるよう、ここには import を置かない（型と計算だけ）。

/** 出席者の文字列を、名前ごとに分ける（区切りは「、」「,」「;」「／」改行。重複は1つにする）。 */
export function splitAttendees(text: string | undefined | null): string[] {
  const out: string[] = [];
  for (const piece of String(text ?? '').split(/[、,，;；／/\n]+/)) {
    const name = piece.trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

export function joinAttendees(names: string[]): string {
  return splitAttendees(names.join('、')).join('、');
}

/** 名前にチェックを入れる／外す。ほかの名前の並びは変えない。 */
export function toggleAttendee(text: string, name: string, on: boolean): string {
  const names = splitAttendees(text).filter((n) => n !== name);
  if (on) names.push(name);
  return names.join('、');
}

// 出席者の欄に書かれた名前が、その人を指しているか。
// いまは職員の一覧から選ぶのでフルネームが入るが、前は手入力で「安東」のように名字だけのことが多かった。
// そのため、2文字以上で名前の先頭に一致すれば同じ人とみなす。
function sameName(written: string, fullName: string): boolean {
  return written === fullName || (written.length >= 2 && fullName.startsWith(written));
}

/** その人が出席者に入っているか（事前共有の「確認しました」を付けられる人か）。 */
export function isAttendee(name: string, attendees: string | undefined | null): boolean {
  if (!name) return false;
  return splitAttendees(attendees).some((w) => sameName(w, name));
}

export type ConfirmItem = { name: string; ok: boolean };

/** 出席者ごとに、事前共有を確認したかどうか。confirmed は「確認しました」を付けた人の名前。 */
export function confirmSummary(
  attendees: string | undefined | null,
  confirmed: string[] | undefined | null,
): { total: number; done: number; items: ConfirmItem[] } {
  const items = splitAttendees(attendees).map((w) => ({
    name: w,
    ok: (confirmed ?? []).some((c) => sameName(w, c)),
  }));
  return { total: items.length, done: items.filter((i) => i.ok).length, items };
}
