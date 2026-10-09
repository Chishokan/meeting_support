import AptitudeDetailUI from '@/components/AptitudeDetailUI';

export default function AptitudeCandidatePage({ params }: { params: { id: string } }) {
  return <AptitudeDetailUI id={params.id} />;
}
