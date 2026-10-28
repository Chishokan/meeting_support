import { redirect } from 'next/navigation';

// ご意見・不具合の報告はヘルプデスクへ移した。古いリンク・ブックマークはそちらへ送る。
export default function InquiryPage() {
  redirect('/helpdesk/feedback');
}
