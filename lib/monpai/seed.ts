// 学校マスタの初期値（開発用のローカル保存と、Apps Script の seedMonpaiSchools() の元）。
// 「RED広報関連」スプレッドシートの画面から読み取った値。★運用前に担当者が確認すること。
// 駅前・佐々・西海大島は未入力（スプレッドシートの「学校マスタ」に追加する）。

import type { School } from './model';

export const SEED_SCHOOLS: School[] = [
  { district: '大野', name: '大野中', kind: '中', students: 546, order: 1, note: '' },
  { district: '大野', name: '中里中', kind: '中', students: 376, order: 2, note: '' },
  { district: '大野', name: '柚木中', kind: '中', students: 99, order: 3, note: '' },
  { district: '大野', name: '大野小', kind: '小', students: 638, order: 4, note: '' },
  { district: '大野', name: '中里小', kind: '小', students: 426, order: 5, note: '' },
  { district: '大野', name: '春日小', kind: '小', students: 457, order: 6, note: '' },
  { district: '日野', name: '日野中', kind: '中', students: 380, order: 1, note: '' },
  { district: '日野', name: '相浦中', kind: '中', students: 447, order: 2, note: '' },
  { district: '日野', name: '愛宕中', kind: '中', students: 216, order: 3, note: '' },
  { district: '日野', name: '日野小', kind: '小', students: 479, order: 4, note: '' },
  { district: '日野', name: '相浦小', kind: '小', students: 408, order: 5, note: '' },
  { district: '広田', name: '日宇中', kind: '中', students: 613, order: 1, note: '日宇エリア' },
  { district: '広田', name: '大塔小', kind: '小', students: 617, order: 2, note: '日宇エリア' },
  { district: '広田', name: '黒髪小', kind: '小', students: 462, order: 3, note: '日宇エリア' },
  { district: '広田', name: '日宇小', kind: '小', students: 329, order: 4, note: '日宇エリア' },
];
