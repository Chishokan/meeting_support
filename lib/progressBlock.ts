// 中間報告の出力ブロックの囲み（UI 側がこの囲みを検知して自動転記する。会議AI の「貼り付け用」とは別物）。
//
// lib/progressPrompt.ts から分けてあるのは、画面（components/ProgressUI.tsx）がこの定数だけを
// 使うため。プロンプト側は withCompanyKnowledge → lib/instructors.ts（node:fs）を通るので、
// 画面から直接 import するとブラウザ用のビルドが壊れる。★画面側は必ずこちらを import すること。
export const PROGRESS_BLOCK_START = '＝＝＝ 中間報告（ここから）＝＝＝';
export const PROGRESS_BLOCK_END = '＝＝＝ 中間報告（ここまで）＝＝＝';
