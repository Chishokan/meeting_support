// 写真用の架空の事前共有（2026/11/20 を「今日」として撮る）。氏名・会議・議題はすべて架空。
const AGENDA_A = `1. 冬期講習の申込状況（各校の動員率・外部生）
2. 11月 学力テストの結果と、生徒への返し方
3. 12月の面談の進め方（日程・担当の割り振り）
4. その他・連絡事項`;
const AGENDA_B = `1. 12月 授業の振替ルールの確認
2. 講師の採用・研修の予定
3. 保護者会の準備`;
const AGENDA_C = `1. 共通テスト直前講座の時間割
2. 自習室の年末年始の開け方`;

const base = (o) => ({
  ts: '2026/11/18 17:30', editedAt: '', editedBy: '', minutesId: '', confirmed: [], canConfirm: false,
  canHost: false, canDelete: false, canRecord: false, ...o,
});

function rows({ host = false, hostLoginNeeded = false, confirmedA = ['日野 一郎', '大和 さくら'], agendaA = AGENDA_A, editedA } = {}) {
  return [
    base({
      id: 'P-A', campus: '小中等部', user: '日野 一郎', title: '小中等部 定例部門会議',
      date: '2026/11/20 16:00〜17:00', place: 'Zoom（本部会議室からも参加）',
      attendees: '日野 一郎、智翔 花子、大和 さくら、川辺 健太、森山 ゆか',
      agenda: agendaA, confirmed: confirmedA, canConfirm: true, canHost: host, canDelete: true, canRecord: true,
      zoomHost: '日野 一郎', canSetHost: true, hostLoginNeeded,
      zoomAccount: '1', zoomMeetingId: '82345678901', zoomJoinUrl: 'https://us06web.zoom.us/j/82345678901?pwd=example', zoomPasscode: '417305',
      ...(editedA ? { editedAt: editedA.at, editedBy: editedA.by } : {}),
    }),
    base({
      id: 'P-B', campus: 'RED個別', user: '青葉 美咲', title: 'RED個別 部門会議',
      date: '2026/11/25 13:00〜14:00', place: 'Zoom', attendees: '青葉 美咲、佐野 拓也、野田 りな',
      agenda: AGENDA_B, confirmed: ['佐野 拓也'], zoomHost: '青葉 美咲', canSetHost: false,
      zoomAccount: '2', zoomMeetingId: '84567890123', zoomJoinUrl: 'https://us06web.zoom.us/j/84567890123?pwd=example', zoomPasscode: '902118',
    }),
    base({
      id: 'P-C', campus: '高等部', user: '桜井 誠', title: '高等部 部門会議',
      date: '2026/11/27 18:00〜19:00', place: '高等部 2階 会議室', attendees: '桜井 誠、高木 まい、石田 亮',
      agenda: AGENDA_C,
    }),
  ];
}
module.exports = { rows, AGENDA_A };
