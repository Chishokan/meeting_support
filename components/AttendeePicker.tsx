'use client';

// 会議の出席者を選ぶ欄。部門を選ぶと、その部門の人の名前が出るので、出席する人にチェックを入れる。
// ほかの部門の人も出るときは、部門を切り替えてチェックを足す（入れたチェックは残る）。
// 職員の一覧に無い人（社外の方など）は「そのほか」に書く。
// 保存する形は、これまでどおり「、」区切りの1本の文字列（lib/attendees.ts）。

import { useEffect, useMemo, useState } from 'react';
import { STAFF } from '@/lib/core/staff';
import { joinAttendees, splitAttendees, toggleAttendee } from '@/lib/attendees';

const ALL_NAMES = new Set(STAFF.flatMap((g) => g.names));

export default function AttendeePicker({
  value,
  onChange,
  campus,
}: {
  value: string;
  onChange: (next: string) => void;
  campus: string; // いま見ている人の部門（最初に開く部門）
}) {
  const [dept, setDept] = useState(STAFF.some((g) => g.campus === campus) ? campus : STAFF[0].campus);
  const picked = useMemo(() => splitAttendees(value), [value]);
  const staffPicked = picked.filter((n) => ALL_NAMES.has(n));
  const others = picked.filter((n) => !ALL_NAMES.has(n));
  // 「そのほか」は書いている途中の文字（区切りの「、」など）をそのまま持つ。
  const [othersText, setOthersText] = useState(others.join('、'));
  const othersKey = others.join('、');
  useEffect(() => {
    // 外から出席者が入れ替わったとき（事前共有の読み込みなど）だけ、欄の文字を合わせる。
    setOthersText((cur) => (splitAttendees(cur).join('、') === othersKey ? cur : othersKey));
  }, [othersKey]);

  const names = STAFF.find((g) => g.campus === dept)?.names ?? [];
  const allOn = names.length > 0 && names.every((n) => picked.includes(n));

  function setGroup(on: boolean) {
    let next = value;
    for (const n of names) next = toggleAttendee(next, n, on);
    onChange(next);
  }

  return (
    <div className="dm-att">
      <div className="dm-att-top">
        <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="部門">
          {STAFF.map((g) => {
            const n = g.names.filter((x) => picked.includes(x)).length;
            return (
              <option key={g.campus} value={g.campus}>
                {g.campus}{n > 0 ? `（${n}人）` : ''}
              </option>
            );
          })}
        </select>
        <button type="button" className="dm-att-all" onClick={() => setGroup(!allOn)}>
          {allOn ? 'この部門を外す' : 'この部門の全員'}
        </button>
      </div>
      <div className="dm-att-names">
        {names.map((n) => (
          <label key={n} className={picked.includes(n) ? 'on' : undefined}>
            <input type="checkbox" checked={picked.includes(n)} onChange={(e) => onChange(toggleAttendee(value, n, e.target.checked))} />
            {n}
          </label>
        ))}
      </div>
      <input
        className="dm-att-others"
        value={othersText}
        onChange={(e) => {
          setOthersText(e.target.value);
          onChange(joinAttendees([...staffPicked, ...splitAttendees(e.target.value)]));
        }}
        placeholder="そのほか（一覧に無い方。「、」で区切る）"
        aria-label="そのほかの出席者"
      />
      <p className="dm-att-sum">
        {picked.length > 0 ? `出席者 ${picked.length}人：${picked.join('、')}` : '出席する人にチェックを入れてください。'}
      </p>
    </div>
  );
}
