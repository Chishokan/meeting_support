// 相談AI テンプレート定義（P1＝生成型）
//
// ■この仕組みの考え方
//   機能要件定義書の P1（生成型）は 24 業務あるが、AIの動き方は全て同じ：
//     条件をフォームで入力 → AIが文章化 → 定型フォーマットで出力
//   よって業務ごとにコードを書かず、共通エンジン（app/api/consult/route.ts）＋
//   このファイルの「テンプレート定義データ」で表現する。
//   ★業務を増やすときは、このファイルに1件足すだけ。コード変更は不要。
//
// ■まず3業務（1-1 / 6-1 / 11-1）で型を固め、運用を見てから残りを追加する。
//   定義書の Phase1・P1 は 11 業務：
//     1-1 チラシ・DM原稿 ／ 1-3 LP・Web記事 ／ 2-1 問い合わせ一次返信 ／
//     2-2 体験授業後フォロー ／ 2-3 入塾面談の想定問答 ／ 3-2 つまずき対応 ／
//     6-1 案内文・お知らせ ／ 6-6 緊急一斉連絡 ／ 7-4 稟議書・申請書 ／
//     8-1 求人原稿 ／ 11-1 提案書・見積根拠

export type FieldType = 'text' | 'textarea' | 'select';

export type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[]; // type: 'select' のとき使う
  hint?: string;
};

export type ConsultTemplate = {
  id: string; // 機能要件定義書の No（1-1 など）と一致させる
  category: string;
  title: string;
  desc: string;
  fields: TemplateField[];
  outputFormat: string; // AIが返す型（この形を崩させない）
  guidance: string; // この業務固有の作法・注意
};

// 定義書の副パターン P4（参照型＝社内資料の検索）は今回のフェーズでは作らない。
// その代替として、参照させたい資料を職員がその場で貼り付ける欄を置く。
const REFERENCE_FIELD: TemplateField = {
  key: 'reference',
  label: '参考にする既存の資料（あれば貼り付け）',
  type: 'textarea',
  placeholder: '過去の原稿、料金表、規程など。貼り付けると文体・条件をそろえて書きます。',
  hint: '空欄でも作成できますが、貼り付けたほうが智翔館の型に沿った文になります。',
};

export const CONSULT_TEMPLATES: ConsultTemplate[] = [
  // ── 1-1 集客・マーケティング / チラシ・DM原稿 ─────────────────
  {
    id: '1-1',
    category: '集客・マーケティング',
    title: 'チラシ・DM原稿',
    desc: 'キャッチコピーの複数案と本文原稿をつくります。',
    fields: [
      {
        key: 'target',
        label: '訴求したい対象',
        type: 'textarea',
        required: true,
        placeholder: '例：高校受験を控えた中3の保護者。塾は初めてで、集団か個別かで迷っている層。',
      },
      {
        key: 'timing',
        label: '時期・打ち出す機会',
        type: 'text',
        required: true,
        placeholder: '例：2026年 冬期講習（12月上旬〜1月中旬）',
      },
      {
        key: 'strengths',
        label: '押し出したい強み・実績',
        type: 'textarea',
        required: true,
        placeholder: '例：週2回の演習量／担任制の面談／〇〇高校の合格実績',
        hint: '数字は入力したものだけを使います。入力に無い実績は原稿に書きません。',
      },
      {
        key: 'space',
        label: '掲載スペース・体裁',
        type: 'select',
        required: true,
        options: [
          'A4チラシ（片面）',
          'A4チラシ（両面）',
          'B4二つ折り',
          'はがきDM',
          '新聞折込（A4）',
          'A4の半面・記事の一部',
          'その他（下の補足に記載）',
        ],
      },
      {
        key: 'campus',
        label: '対象の校舎・部門',
        type: 'text',
        placeholder: '例：小中等部（本部校・大塔校）',
      },
      {
        key: 'constraints',
        label: '必ず入れる情報／使ってはいけない表現',
        type: 'textarea',
        placeholder: '例：申込期限は11/30。料金は「税込」表記。合格実績の数字は使わない。',
      },
      REFERENCE_FIELD,
    ],
    outputFormat: `【キャッチコピー案】
3案。1案ごとに「コピー本文」と、ねらい（誰の何に効くか）を1行で添える。

【本文原稿】
選ばれた掲載スペースに収まる分量で、次の順に書く。
  見出し → リード（2〜3行） → 本文（強みを具体で） → 申込・問い合わせの導線

【掲載スペースの目安】
想定文字数と、収まらない場合に削るべき順序を1〜2行で。

【入れ忘れ確認】
原稿に必要なのに入力に無かった情報（期日・対象学年・料金・会場・連絡先など）を箇条書きで列挙する。無ければ「なし」。`,
    guidance: `- キャッチコピーは煽らない。不安を突くより「通ったあとの状態」を描く。
- 本文の分量は掲載スペースに厳密に合わせる。A4片面なら本文600〜800字、はがきDMなら200〜300字が目安。
- 料金・日程・会場は入力にあるものだけ書く。無いものは ［要確認：料金］ のように明示する。`,
  },

  // ── 6-1 保護者対応 / 案内文・お知らせ ────────────────────────
  {
    id: '6-1',
    category: '保護者対応',
    title: '案内文・お知らせ',
    desc: '保護者・生徒向けの案内文、お知らせ文面をつくります。',
    fields: [
      {
        key: 'topic',
        label: '案内する内容',
        type: 'textarea',
        required: true,
        placeholder: '例：冬期講習の日程が決まったので申込を案内したい。',
      },
      {
        key: 'audience',
        label: '対象',
        type: 'text',
        required: true,
        placeholder: '例：小中等部 中3の保護者',
      },
      {
        key: 'schedule',
        label: '日程・期間・場所',
        type: 'textarea',
        placeholder: '例：12/23（火）〜1/7（水）／本部校 3F教室',
      },
      {
        key: 'channel',
        label: '配布・送信の方法',
        type: 'select',
        required: true,
        options: [
          '紙で配布（生徒に手渡し）',
          '郵送',
          'LINE WORKS・一斉メール',
          '塾内掲示',
          'ホームページ掲載',
          'その他（下の補足に記載）',
        ],
        hint: '方法によって文の長さと堅さを変えます。',
      },
      {
        key: 'action',
        label: '相手にしてほしいこと・期日',
        type: 'text',
        placeholder: '例：11/30（日）までに申込書を担任へ提出',
      },
      {
        key: 'contact',
        label: '問い合わせ先',
        type: 'text',
        placeholder: '例：智翔館 本部校 0956-XX-XXXX（平日14:00〜21:00）',
      },
      {
        key: 'constraints',
        label: '補足・注意（あれば）',
        type: 'textarea',
        placeholder: '例：昨年から料金が変わったことに触れる。強い依頼口調は避ける。',
      },
      REFERENCE_FIELD,
    ],
    outputFormat: `【件名】
配布・送信の方法に合った件名を1つ。

【本文】
次の順に書く。
  宛名 → 挨拶（媒体に合わせた長さ） → 用件（何のお知らせか1〜2行で先に言い切る）
  → 詳細（日時・場所・対象・持ち物・費用を箇条書き） → お願いしたいことと期日 → 結び

【問い合わせ先】

【入れ忘れ確認】
案内文に必要なのに入力に無かった情報を箇条書きで列挙する。無ければ「なし」。`,
    guidance: `- 用件を先に言い切る。挨拶で数行使って本題が見えない文にしない。
- LINE WORKS・一斉メールなら時候の挨拶は省き、300字以内を目安に短く。紙・郵送なら通常の挨拶を入れる。
- 「してほしいこと」と「期日」は必ず独立した行で目立たせる。
- 日時・費用は入力にあるものだけ書く。無いものは ［要確認：〇〇］ と明示する。`,
  },

  // ── 11-1 NEP事業 / 提案書・見積根拠 ──────────────────────────
  {
    id: '11-1',
    category: 'NEP事業',
    title: '提案書・見積根拠',
    desc: '提案書の構成・本文と、見積の根拠の立て方をまとめます。',
    fields: [
      {
        key: 'client',
        label: '提案先（クライアント）',
        type: 'text',
        required: true,
        placeholder: '例：佐世保市内の私立高校（進路指導部）',
      },
      {
        key: 'overview',
        label: '案件の概要',
        type: 'textarea',
        required: true,
        placeholder: '例：探究学習の年間プログラムを設計・実施してほしいという相談。',
      },
      {
        key: 'issue',
        label: 'クライアントの課題・背景',
        type: 'textarea',
        required: true,
        placeholder: '例：教員の負担が大きく、外部連携の実績づくりも求められている。',
      },
      {
        key: 'scope',
        label: '提供する内容・想定する作業範囲',
        type: 'textarea',
        placeholder: '例：カリキュラム設計、講師派遣（全10回）、教員向け研修1回、成果報告',
      },
      {
        key: 'budget',
        label: '予算感・見積レンジ',
        type: 'text',
        placeholder: '例：先方の想定は年間100万円前後',
        hint: '金額は入力したものだけを使い、AIが単価を創作することはありません。',
      },
      {
        key: 'deadline',
        label: '希望スケジュール・納期',
        type: 'text',
        placeholder: '例：4月開始。提案は2月末までに提出。',
      },
      {
        key: 'decider',
        label: '先方の決裁者・判断のポイント',
        type: 'textarea',
        placeholder: '例：最終決裁は校長。教員の工数が増えないかを最も気にしている。',
      },
      REFERENCE_FIELD,
    ],
    outputFormat: `【提案書の構成】
章立てを箇条書きで。各章に「そこで言うこと」を1行添える。

【本文ドラフト】
各章の本文。課題の再定義 → 提案内容 → 進め方 → 体制 → 期待できる成果 の流れを基本にする。

【見積根拠】
次の列で表にする：作業項目 ／ 想定される作業量の考え方 ／ 金額の置き方
金額そのものは入力にある範囲でしか書かず、無い場合は ［要確認：単価］ と置く。
「なぜその金額になるか」を先方に説明できる形にすることを優先する。

【想定される質問と回答方針】
決裁者が聞いてきそうな質問を3〜5つ、それぞれ回答の方針を添える。

【入れ忘れ確認】
提案書に必要なのに入力に無かった情報を箇条書きで列挙する。無ければ「なし」。`,
    guidance: `- 提案は「先方の課題の言い換え」から始める。こちらのやりたいことから書き出さない。
- 実績・単価・他社事例を創作しない。入力と参考資料にあるものだけを使う。
- 決裁者の判断ポイントが入力されている場合は、その論点を本文の中で必ず1度は正面から扱う。`,
  },
];

// フォーム記入内容を、最初の user メッセージとして送る形に整える。
// 未記入の項目も「（未記入）」と明示する（AIに「情報が無い」ことを伝えるため）。
// UI 側でも使うため、社内ナレッジを含む consultPrompt.ts ではなくこのファイルに置く。
export function buildFormMessage(t: ConsultTemplate, values: Record<string, string>): string {
  const lines = t.fields.map((f) => {
    const v = (values[f.key] ?? '').trim();
    return `■${f.label}\n${v || '（未記入）'}`;
  });
  return `【${t.title}】の原稿をお願いします。\n\n${lines.join('\n\n')}`;
}

export function findTemplate(id: string): ConsultTemplate | undefined {
  return CONSULT_TEMPLATES.find((t) => t.id === id);
}

// 一覧画面用に、定義書の領域（カテゴリ）ごとにまとめる。
export function templatesByCategory(): { category: string; items: ConsultTemplate[] }[] {
  const out: { category: string; items: ConsultTemplate[] }[] = [];
  for (const t of CONSULT_TEMPLATES) {
    const g = out.find((o) => o.category === t.category);
    if (g) g.items.push(t);
    else out.push({ category: t.category, items: [t] });
  }
  return out;
}
