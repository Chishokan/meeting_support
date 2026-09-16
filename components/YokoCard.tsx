'use client';

// 要項1件分のカード。「要項QA」とダッシュボードの両方から使う。
//
// 1つの要項に複数の講座が入っていることが多いので、講座ごとに1行、開始日の早い順に出す。
// 現場で聞かれるのは「どの講座が」「いくらで」「いつから」なので、この3つだけを行に載せる。
// 申込方法・会場・持ち物などは載せない（載せると読む量が増えて、結局チャットで聞く形になる）。
//
// ★見た目を変えるときはここだけを直せば両方に反映される。

export type YokoFeeView = { audience: string; text: string };

export type YokoItemView = {
  name: string;
  when: string;
  startYmd: string | null;
  fees: YokoFeeView[];
};

export type YokoCardData = {
  file: string;
  title: string;
  fullTitle: string;
  grades: string;
  period: string;
  items: YokoItemView[];
  wholeFees: YokoFeeView[];
  kind: '実施中' | '開始間近' | 'テスト表示';
  daysUntilStart: number | null;
};

export function yokoChip(card: YokoCardData): { text: string; cls: string } {
  if (card.kind === '実施中') return { text: '実施中', cls: 'now' };
  if (card.kind === '開始間近') {
    return {
      text: card.daysUntilStart === 0 ? '本日開始' : `あと${card.daysUntilStart}日で開始`,
      cls: 'soon',
    };
  }
  return { text: 'テスト表示', cls: 'test' };
}

export default function YokoCard({ card, compact = false }: { card: YokoCardData; compact?: boolean }) {
  const chip = yokoChip(card);
  // ダッシュボードでは要項が何件も並ぶので、講座の行数を絞る（続きは要項QAで見る）。
  const items = compact ? card.items.slice(0, 3) : card.items;
  const hidden = card.items.length - items.length;

  return (
    <div className="iqa-card yq-card">
      <div className="yq-card-head">
        <span className={`yq-chip ${chip.cls}`}>{chip.text}</span>
        <span className="yq-card-meta">
          {card.grades}　{card.period}
        </span>
      </div>
      <div className="yq-card-title" title={card.fullTitle}>{card.title}</div>

      {/* 要項全体で1つの値段のとき。講座ごとの行にコピーすると、模試だけ別料金といった
          要項で嘘になるので、ここに1回だけ出す。 */}
      {card.wholeFees.length > 0 && (
        <div className="yq-whole">
          <span className="yq-whole-label">受講料</span>
          <span className="yq-whole-fees">
            {card.wholeFees.map((f) => (
              <span key={f.audience + f.text} className="yq-whole-fee">
                <i>{f.audience}</i>
                <b>{f.text}</b>
              </span>
            ))}
          </span>
        </div>
      )}

      {card.items.length === 0 ? (
        <div className="yq-item-empty">講座の内訳が読み取れませんでした。チャットで聞いてください。</div>
      ) : (
        <ul className="yq-items-list">
          {items.map((it) => (
            <li className="yq-item" key={it.name}>
              <div className={`yq-when${it.when === '未定' ? ' undecided' : ''}`}>{it.when}</div>
              <div className="yq-item-body">
                <div className="yq-item-name">{it.name}</div>
                {it.fees.length > 0 && (
                  <div className="yq-item-fees">
                    {it.fees.map((f) => (
                      <span key={f.audience + f.text} className="yq-item-fee">
                        <i>{f.audience}</i>
                        <b>{f.text}</b>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
          {hidden > 0 && <li className="yq-item-more">ほか{hidden}講座</li>}
        </ul>
      )}

      {card.kind === 'テスト表示' && (
        <div className="yq-card-test">画面確認用に出しています。実施期間は過ぎています。</div>
      )}
    </div>
  );
}
