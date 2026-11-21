import { redirect } from 'next/navigation';

// 要項QAはなくした（要項についての質問は智翔館AIでできる）。古いリンク・ブックマークはヘルプデスクのマニュアルへ送る。
export default function YokoQaPage() {
  redirect('/helpdesk/manual');
}
