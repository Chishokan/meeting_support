// 英語の単語テストの元データの形。元はドライブ「15_AI利用データ/英語」のフォレスタ英語の画像（問題編・赤字の答え入り）。
// 画像から読み取って、ここに書き写した（読み取りの決まりと、確かめた範囲は knowledge/37_教材制作/英語/00_使い方.md）。

/** Key Words 表の1語。 */
export type Word = {
  /** 英語（語句・表現も1行） */
  en: string;
  /** 日本語の意味（表のまま。［ ］の補足も含む） */
  ja: string;
  /** 発音（カナ） */
  pron: string;
  /** ☆の印（よく出る語） */
  star: boolean;
};

/** 巻末の Key Words TEST（KWT）の1問。英文の答えの部分を [[ ]] で囲む（例：[[It]] is a [[large]] [[country]].）。 */
export type KwtItem = {
  /** 巻末での番号 */
  no: number;
  ja: string;
  en: string;
  /** 欄外の注意（例：shirt は複数形にする。） */
  note?: string;
};

/** Unit の中の区分（教材のページの見出しごと。Part1・Part3, T&S・教科書本文・Let's Talk1 など）。 */
export type Section = {
  /** 範囲を選ぶときの名前（Unit の中で重ならない。例：Part1、Let's Talk1） */
  id: string;
  /** 教科書のページ（教材の見出しのまま。例：P43〜P45） */
  textbook: string;
  /** 教材の印刷のページ（Key Words の表があるページ） */
  page: number;
  words: Word[];
  /** 巻末 KWT のうち、この区分の問題 */
  kwt: KwtItem[];
};

export type Unit = {
  /** 例：4、Let's Read1 */
  unit: string;
  title: string;
  sections: Section[];
};

export type Book = {
  grade: '中1' | '中2' | '中3';
  /** 教材の記号（ファイル名の F38_BS1 の BS1） */
  book: string;
  units: Unit[];
};

/** 基本単語の学年の目安（元の一覧のまま）。 */
export type BasicLevel = '小学校' | '中1' | '中2';

/** 基本単語の一覧（英単語一覧_中2まで.xlsx の「単語一覧」）の1語。 */
export type BasicWord = {
  /** 元の一覧の番号 */
  no: number;
  en: string;
  /** 品詞（名詞・動詞・形容詞・副詞・熟語・数 など） */
  pos: string;
  ja: string;
  /** 動詞の過去形・過去分詞（無い語は省く） */
  past?: string;
  pp?: string;
  /** 動詞の変化（規則・不規則・助動詞） */
  conj?: string;
  level: BasicLevel;
  /** 元の一覧の分類（人・家族、時・曜日・月、基数 など） */
  category: string;
  note?: string;
};

/** 不規則動詞の一覧（同じファイルの「不規則動詞」）の1語。 */
export type IrregularVerb = {
  no: number;
  base: string;
  past: string;
  pp: string;
  ja: string;
  level: BasicLevel;
  note?: string;
};
