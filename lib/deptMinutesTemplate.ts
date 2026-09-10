// 部門会議 議事録テンプレート（会議DX フェーズ2）
// 「各部門会議議事録」メニューの土台。録音 → 文字起こし → このテンプレートに沿って議事録化する。
// ★項目を足す／減らす／言い回しを変えるときは、このファイルだけを直せば
//   AIの出力・画面のヘルプ・会議の質チェックのすべてに反映される。
//   ただし DECISION_HEADING と DECISION_FIELDS の書式は lib/deptDecisions.ts の
//   抽出処理と対になっている。見出し・項目名を変えたら向こうも直すこと。

export type MinutesSection = {
  key: string;
  heading: string; // 議事録に出す見出し（「■ 」は付けない）
  guide: string; // 何を書くか（AIへの指示 兼 画面のヘルプ）
  required: boolean; // 決まっていなくても見出しごと消さない項目
};

// 決定事項の見出しと、1件あたりに書かせる項目。
// ここが「部門間の決め事の見える化」の中身になる（1決定＝スプレッドシート1行）。
export const DECISION_HEADING = '決定事項';

export const DECISION_FIELDS = [
  { key: 'detail', label: '内容', hint: '何をどうすると決めたか。1〜2文で具体的に' },
  { key: 'reason', label: '理由・背景', hint: 'なぜそう決めたか（分からなければ空欄）' },
  { key: 'owner', label: '担当', hint: '実行する人。決まっていなければ空欄' },
  { key: 'due', label: '期限', hint: 'いつまでに。決まっていなければ空欄' },
  { key: 'related', label: '関係部門', hint: '影響が及ぶ他部門。無ければ「自部門のみ」' },
] as const;

export const MINUTES_SECTIONS: MinutesSection[] = [
  {
    key: 'overview',
    heading: '会議名 / 日時 / 場所',
    guide: '入力された会議情報をそのまま書く。不明な項目は【要確認】と書く。',
    required: true,
  },
  {
    key: 'attendees',
    heading: '出席者',
    guide: '入力された出席者を書く。録音から追加で分かった人がいれば加える。',
    required: true,
  },
  {
    key: 'agenda',
    heading: '議題',
    guide:
      '実際に話し合われた議題を、話された順に列挙する。事前に予定された議題が入力されている場合は、'
      + '各議題の末尾に「（予定どおり）」「（予定外）」「（未実施）」のいずれかを付ける。',
    required: true,
  },
  {
    key: 'decisions',
    heading: DECISION_HEADING,
    guide:
      '「決まったこと」だけを書く。検討中・言いっぱなしのものは絶対に入れない（下の継続審議へ）。'
      + '1件ずつ番号を振り、下記の項目を必ずこの順で並べる。',
    required: true,
  },
  {
    key: 'pending',
    heading: '継続審議・保留',
    guide:
      '話し合ったが結論が出なかった論点。「なぜ決まらなかったか（情報不足・要調整・時間切れ 等）」と'
      + '「次にどうするか」を書く。分からなければ【要確認】。',
    required: true,
  },
  {
    key: 'todos',
    heading: 'ToDo（アクション項目）',
    guide:
      '「- [ ] 内容 ／ 担当： ／ 期限：」の形で1行1件。担当・期限が会議で決まっていなければ'
      + '空欄のままにする（勝手に埋めない）。',
    required: true,
  },
  {
    key: 'requests',
    heading: '他部門への依頼・共有事項',
    guide:
      '他部門にお願いしたいこと・伝えるべきことを「宛先部門：内容」の形で書く。無ければ「該当なし」。',
    required: true,
  },
  {
    key: 'reports',
    heading: '報告・連絡事項',
    guide: '決裁も議論も不要な、共有だけの内容。無ければ「該当なし」。',
    required: true,
  },
  {
    key: 'next',
    heading: '次回会議',
    guide: '次回の日時・持ち越す議題・準備事項。分からなければ【要確認】。',
    required: true,
  },
];

// 会議の質チェック（テンプレートに沿わない会議内容を可視化する観点）。
// 議事録の後ろに別ブロックとして出力し、シートにも保存する。
export const QUALITY_CHECKS = [
  '予定議題の消化：予定した議題のうち、話し合えなかったものはあるか',
  '議題外の議論：予定になかった話題にどれくらい時間を使ったか',
  '結論の有無：議論したのに決まらなかった議題はどれか、その原因は何か',
  '担当・期限：担当者または期限が決まっていない決定事項・ToDo はどれか',
  '報告の割合：決定・議論ではなく、報告の読み上げに費やされた割合の体感',
  '発言の偏り：特定の人しか発言していない議題はあったか（人数の偏りのみ。評価はしない）',
];

// 部門ごとに議事録へ足したい観点（無い部門は共通のみ）。
export const DEPT_NOTES: Record<string, string> = {
  小中等部: '生徒数・成績回収・キャンペーンなど数値の話が出たら、決定事項とは分けて「報告・連絡事項」に数値のまま残す。',
  RED個別: 'スタッフ研修・生徒対応・退会防止の決め事は、担当者を必ず確認する（空欄なら【要確認】）。',
  高等部: '受講進捗・面談の実施状況に関する決め事は、対象学年を明記する。',
  LEC: '売上・生徒数に関わる決定は、対象期間（いつからいつまで）を明記する。',
  英検: '受験申込・実施日に関わる決定は、対象の検定回（第○回）を明記する。',
  '総務・人事・支援・管理': '他部門への依頼・全社ルールの変更は「他部門への依頼・共有事項」に必ず切り出す。',
};

// 議事録テンプレートの骨組み（AIへ渡す出力フォーマット）。
export function buildTemplateSkeleton(): string {
  return MINUTES_SECTIONS.map((s) => {
    if (s.key === 'decisions') {
      const fields = DECISION_FIELDS.map((f) => `   ・${f.label}：（${f.hint}）`).join('\n');
      return `■ ${s.heading}\n1. 件名：（決まったことを20字程度で）\n${fields}`;
    }
    if (s.key === 'todos') {
      return `■ ${s.heading}\n- [ ] （内容） ／ 担当： ／ 期限：`;
    }
    return `■ ${s.heading}\n（${s.guide}）`;
  }).join('\n\n');
}

// 画面のヘルプに出す、テンプレートの項目一覧。
export function templateOutline(): { heading: string; guide: string }[] {
  return MINUTES_SECTIONS.map((s) => ({ heading: s.heading, guide: s.guide }));
}
