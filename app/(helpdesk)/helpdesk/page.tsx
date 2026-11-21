import { redirect } from 'next/navigation';

// ヘルプデスクの最初の画面はマニュアル。
// 要項QAは v1.25.0 でなくした（要項についての質問は智翔館AIでできるため）。
export default function HelpdeskPage() {
  redirect('/helpdesk/manual');
}
