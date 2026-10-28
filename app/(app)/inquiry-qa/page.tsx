import { redirect } from 'next/navigation';

// 問い合わせQAは問合せ管理アプリの「AIに聞く」へ移した。古いリンク・ブックマークはそちらへ送る。
export default function InquiryQaPage() {
  redirect('/inquiry-board/qa');
}
