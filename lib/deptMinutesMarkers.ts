// 部門会議議事録の出力ブロックの区切り。lib/deptMinutesPrompt.ts（AIに出させる側）と
// lib/deptMinutesParse.ts（画面が抽出する側）が対になっているので、変更するときは両方を確認する。
//
// lib/deptMinutesPrompt.ts から分けてあるのは、画面（DeptMinutesUI / DashboardUI）が
// deptMinutesParse 経由でこの定数だけを使うため。プロンプト側は講師一覧（lib/instructors.ts、
// node:fs）を読むので、画面から import するとブラウザ用のビルドが壊れる。
// ★画面・パーサ側は必ずこちらを import すること。
export const MINUTES_OPEN = '＝＝＝ 議事録（ここから）＝＝＝';
export const MINUTES_CLOSE = '＝＝＝ 議事録（ここまで）＝＝＝';
export const QUALITY_OPEN = '＝＝＝ 会議の質チェック（ここから）＝＝＝';
export const QUALITY_CLOSE = '＝＝＝ 会議の質チェック（ここまで）＝＝＝';
