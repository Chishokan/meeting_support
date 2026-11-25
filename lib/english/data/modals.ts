// 助動詞の確認テストの元データ。元はドライブの「中３夏期助動詞確認テスト.xlsx」（問題のシートと解答のシート）。
// 解答のシートを、問題ごとに写したもの。[[ ]] が空欄で、中が答え。直すときは、元のファイルを直してから写し直す。
// 1つの欄で行を変えるところは \n。
// 「（8）の答え」のように前の問題を指すものは ref に元の番号を入れ、出すときの番号に置きかえる。

import type { ModalItem } from './types';

export const MODAL_ITEMS: ModalItem[] = [
  { no: 1, group: 'can', prompt: 'can の意味', body: '①～[[することができる]]【可能】　②～[[してもよい]]【許可】' },
  { no: 2, group: 'can', prompt: 'can の過去形', body: '（[[could]]）＝〖[[was]] / [[were]]〗（[[able]]）（[[to]]）' },
  { no: 3, group: 'can', prompt: 'can の未来形', body: '（[[will]]）（[[be]]）（[[able]]）（[[to]]）' },
  { no: 4, group: 'can', prompt: 'can（現在形）', body: '＝〖[[am]] / [[is]] / [[are]]〗（[[able]]）（[[to]]）' },
  { no: 5, group: 'must', prompt: 'must の意味', body: '①～[[しなければならない]]【義務】　②～[[にちがいない]]【推定】' },
  { no: 6, group: 'must', prompt: 'must の過去形', body: '（[[had]]）（[[to]]）' },
  { no: 7, group: 'must', prompt: 'must の未来形', body: '（[[will]]）（[[have]]）（[[to]]）' },
  { no: 8, group: 'must', prompt: 'must', body: '＝〖[[have]] / [[has]]〗（[[to]]）', note: 'has to は主語が３・単で肯定文のみ使用' },
  { no: 9, group: 'must', prompt: '（{ref}）の答えの否定形と意味', ref: 8, body: '〖[[don\'t]] / [[doesn\'t]]〗（[[have]]）（[[to]]）\n意味：～[[する必要はない]]／～[[しなくてもよい]]' },
  { no: 10, group: 'must', prompt: 'must not の意味', body: '～[[してはいけない]]【禁止】　同じ内容 ⇒（[[Don\'t]]）～.' },
  { no: 11, group: 'may', prompt: 'may の意味', body: '①～[[してもよい]]【許可】　②～[[かもしれない]]【推量】' },
  { no: 12, group: 'will', prompt: 'will の意味', body: '①～[[だろう]]【単純未来】　②～[[するつもりだ]]【意志未来】' },
  { no: 13, group: 'will', prompt: 'will', body: '＝〖[[am]] / [[is]] / [[are]]〗（[[going]]）（[[to]]）' },
  { no: 14, group: 'should', prompt: 'should の意味', body: '①～[[した方がよい]]【助言】　②～[[すべきだ]]【当然】' },
  { no: 15, group: 'should', prompt: 'had better の意味', body: '～[[した方がよい]]【助言】' },
  { no: 16, group: '会話', prompt: 'May I ～? の意味', body: '～[[してもいいですか]]【許可】' },
  { no: 17, group: '会話', prompt: '（{ref}）の答え', ref: 16, body: '（[[Sure]]）.　No, you（[[may]]）（[[not]]）.' },
  { no: 18, group: '会話', prompt: 'Shall I ～? の意味', body: '～[[しましょうか]]【相手に申し出る時】' },
  { no: 19, group: '会話', prompt: '（{ref}）の答え', ref: 18, body: 'Yes,（[[please]]）.　No,（[[thank]]）（[[you]]）.' },
  { no: 20, group: '会話', prompt: 'Shall we ～? の意味', body: '～[[しましょうか]]【相手を誘うとき】　同じ内容 ⇒（[[Let\'s]]）～.' },
  { no: 21, group: '会話', prompt: '（{ref}）の答え', ref: 20, body: 'Yes,（[[let\'s]]）.　No,（[[let\'s]]）（[[not]]）.' },
  { no: 22, group: '会話', prompt: 'Will you ～? の意味①', body: '～[[してくれませんか]]【依頼】　同じ内容 ⇒（[[Please]]）～.' },
  { no: 23, group: '会話', prompt: '（{ref}）の答え', ref: 22, body: '（[[All]]）（[[right]]）. /（[[Sure]]）.\nI\'m（[[sorry]]）, I（[[can\'t]]）.' },
  { no: 24, group: '会話', prompt: 'Will you ～? の意味②', body: '～[[しませんか]]【勧誘】' },
  { no: 25, group: '会話', prompt: '（{ref}）の答え', ref: 24, body: '（[[Sure]]）. / Yes, I（[[will]]）.　No,（[[thank]]）（[[you]]）.' },
];
