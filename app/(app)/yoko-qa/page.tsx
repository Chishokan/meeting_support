import { redirect } from 'next/navigation';

// 要項QAはヘルプデスクへ移した。古いリンク・ブックマークはそちらへ送る。
export default function YokoQaPage() {
  redirect('/helpdesk');
}
