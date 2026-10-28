import ExamUI from '@/components/ExamUI';

export default function ExamPage({ params }: { params: { token: string } }) {
  return <ExamUI token={params.token} />;
}
