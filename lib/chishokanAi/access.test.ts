// 智翔館AI を使える人（access.ts）のテスト。  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_ADMIN_CAMPUS, canUseChishokanAi } from './access.ts';
import { ADMIN_CAMPUS, STAFF } from '../core/staff.ts';

test('使えるのは太田先生・瀬戸山先生と管理部門の方だけ', () => {
  assert.equal(AI_ADMIN_CAMPUS, ADMIN_CAMPUS);
  assert.ok(canUseChishokanAi({ name: '太田暁', campus: '小中等部' }));
  assert.ok(canUseChishokanAi({ name: '瀬戸山理恵', campus: 'RED個別' }));
  assert.ok(canUseChishokanAi({ name: '太田 暁', campus: '小中等部' })); // 空白があっても同じ人
  for (const n of STAFF.find((g) => g.campus === ADMIN_CAMPUS)!.names) assert.ok(canUseChishokanAi({ name: n, campus: ADMIN_CAMPUS }), n);
  assert.ok(canUseChishokanAi({ name: '大谷朋美', campus: 'LEC' }));
  assert.ok(canUseChishokanAi({ name: '小潟理紗', campus: '小中等部' }));
  assert.ok(canUseChishokanAi({ name: '在津 太郎', campus: '小中等部' })); // 在津先生は名字で
  assert.equal(canUseChishokanAi({ name: '安東瑞輝', campus: '小中等部' }), false);
  assert.equal(canUseChishokanAi({ name: '福元崇恭', campus: 'RED個別' }), false);
  assert.equal(canUseChishokanAi({ name: '', campus: '' }), false);
  assert.equal(canUseChishokanAi(null), false);
});

test('職員マスタに太田先生・瀬戸山先生がいる（名前の書き方がそろっている）', () => {
  const all = STAFF.flatMap((g) => g.names);
  assert.ok(all.includes('太田暁'));
  assert.ok(all.includes('瀬戸山理恵'));
});
