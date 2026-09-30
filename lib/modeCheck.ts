// 会議AIの3つのモード（画面上部のタブ）の確認。
// 報告者が違うタブのまま始めてしまわないよう、各プロンプトの最初の発話で「いまどのタブか」を伝え、
// 話の途中で別の種類の報告だと分かったら、タブの切り替えを案内させる。
// ★タブの名前は components/ChatUI.tsx の MODES の label と揃えること。

export type ChatMode = 'meeting' | 'monthly' | 'season';

const MODES: { id: ChatMode; label: string; what: string }[] = [
  { id: 'meeting', label: '事前報告', what: '会議前の共有・相談・決裁' },
  { id: 'monthly', label: '月次報告', what: '通常期の毎月の結果報告' },
  { id: 'season', label: '講習の結果報告', what: '春期・夏期・冬期の講習会の結果報告' },
];

// 最初の発話に入れる一文（「」の中にそのまま差し込む）。
export function modeCheckLine(mode: ChatMode): string {
  const cur = MODES.find((m) => m.id === mode)!;
  const others = MODES.filter((m) => m.id !== mode)
    .map((m) => `${m.what}なら「${m.label}」`)
    .join('、');
  return `いま選ばれているのは「${cur.label}」（${cur.what}）です。${others}のタブを画面上部で選び直してください。`;
}

// プロンプトに入れる守りのルール。
export function modeCheckRule(mode: ChatMode): string {
  const cur = MODES.find((m) => m.id === mode)!;
  const list = MODES.map((m) => `「${m.label}」＝${m.what}`).join('／');
  return `【報告の種類（タブ）の確認】画面上部のタブは3つある：${list}。いまは「${cur.label}」。
- 最初の発話で、いまのタブと他のタブの使い分けを必ず伝える（下の【最初の発話】のとおり）。
- 報告者が「間違えた」「別の報告だった」と言った場合や、答えの内容が明らかに別の種類の報告に当たる場合は、このモードのまま進めず、
  「画面上部の『（該当するタブ名）』タブに切り替えてから始めてください。」と一度だけ案内する。
  報告者がこのまま続けたいと言えば、そのまま進めてよい。`;
}
