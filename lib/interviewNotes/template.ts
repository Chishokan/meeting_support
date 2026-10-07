// 面談記録のテンプレート（面談記録アプリ /interview-notes）
// 面談を録音 → 文字起こし → このテンプレートに沿って面談記録にまとめる。
// ★項目を足す／減らす／言い回しを変えるときは、このファイルだけを直せば
//   AIの出力・画面のヘルプのすべてに反映される。

export type InterviewSection = {
  key: string;
  heading: string; // 面談記録に出す見出し（「■ 」は付けない）
  guide: string; // 何を書くか（AIへの指示 兼 画面のヘルプ）
};

// 面談の種類（画面のプルダウン）。AI にも渡して、まとめ方の重みづけに使う。
export const INTERVIEW_KINDS = ['生徒面談', '保護者面談', '三者面談', '入塾面談', '退塾・休塾の相談', 'その他'] as const;

// 学年（画面のプルダウン）。問合せ管理と同じ並び。
export const GRADES = ['未就学', '小1', '小2', '小3', '小4', '小5', '小6', '中1', '中2', '中3', '高1', '高2', '高3', '既卒', 'その他'] as const;

export const INTERVIEW_SECTIONS: InterviewSection[] = [
  {
    key: 'overview',
    heading: '面談の概要',
    guide: '生徒名・学年・面談の種類・日時・場所・面談者・同席者を、入力された情報のとおりに書く。不明な項目は【要確認】。',
  },
  {
    key: 'purpose',
    heading: '面談の目的',
    guide: '何のための面談か。入力された目的・事前メモと、実際の会話の冒頭から1〜2行で書く。',
  },
  {
    key: 'summary',
    heading: '話した内容（要点）',
    guide: '話題ごとに見出しを立て、話された順に要点を箇条書きにする。発言の羅列ではなく、要点にまとめる。',
  },
  {
    key: 'status',
    heading: '生徒の現状',
    guide: '学習状況・成績・模試や定期テストの結果・学習習慣・生活面など、面談で分かった現状。数字は発言のとおり。',
  },
  {
    key: 'voice',
    heading: '生徒・保護者の要望・不安',
    guide: '生徒本人・保護者それぞれが口にした希望・悩み・不安。誰の発言かが分かるように「生徒：」「保護者：」を付ける。',
  },
  {
    key: 'advice',
    heading: '塾からの提案・助言',
    guide: '講師・教室長が提案・助言したこと（講座・学習方法・志望校・受講の継続など）。',
  },
  {
    key: 'agreed',
    heading: '合意したこと',
    guide:
      '面談の場で「そうします」「お願いします」と合意した内容だけを書く。提案しただけ・検討すると言っただけのものは入れず、'
      + '「（検討中）」として末尾に分けて書く。',
  },
  {
    key: 'todos',
    heading: '次回までの対応（ToDo）',
    guide:
      '「- [ ] 内容 ／ 担当： ／ 期限：」の形で1行1件。担当は「塾（○○先生）」「生徒」「保護者」など。'
      + '担当・期限が面談で決まっていなければ空欄のままにする（勝手に埋めない）。',
  },
  {
    key: 'handover',
    heading: '申し送り',
    guide:
      '他の講師・教室長・事務に伝えておくべきこと（配慮が必要な点、連絡の注意、請求・手続きの話など）。無ければ「該当なし」。',
  },
  {
    key: 'next',
    heading: '次回面談',
    guide: '次回の時期・テーマ。決まっていなければ【要確認】。',
  },
];

// 面談記録の後ろに出す「確認してほしいこと」の観点。
// 記録者が保存前に見直すためのもの（面談の良し悪しの評価はしない）。
export const FOLLOWUP_CHECKS = [
  '聞き漏れ：面談の目的・事前メモに挙げていたのに、話に出てこなかった項目',
  '担当・期限：担当者または期限が決まっていない ToDo',
  '聞き取り：数字・日付・学校名・志望校など、聞き取りが怪しく記録者に確かめてほしい箇所',
  '要対応：保護者・生徒から返事や連絡を求められていて、まだ対応が決まっていないこと',
];

// 面談記録テンプレートの骨組み（AIへ渡す出力フォーマット）。
export function buildInterviewSkeleton(): string {
  return INTERVIEW_SECTIONS.map((s) => {
    if (s.key === 'todos') {
      return `■ ${s.heading}\n- [ ] （内容） ／ 担当： ／ 期限：`;
    }
    return `■ ${s.heading}\n（${s.guide}）`;
  }).join('\n\n');
}

// 画面のヘルプに出す、テンプレートの項目一覧。
export function interviewOutline(): { heading: string; guide: string }[] {
  return INTERVIEW_SECTIONS.map((s) => ({ heading: s.heading, guide: s.guide }));
}
