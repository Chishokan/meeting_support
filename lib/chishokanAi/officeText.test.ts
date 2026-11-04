// Office ファイルの文字取り出し（officeText.ts）のテスト。  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { colIndex, isLegacyOffice, officeKind, officeToText } from './officeText.ts';

async function zip(files: Record<string, string>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [p, c] of Object.entries(files)) z.file(p, c);
  return z.generateAsync({ type: 'uint8array' });
}

test('officeKind・isLegacyOffice：拡張子で判定する', () => {
  assert.equal(officeKind('計画.DOCX'), 'docx');
  assert.equal(officeKind('a.xlsx'), 'xlsx');
  assert.equal(officeKind('a.pptx'), 'pptx');
  assert.equal(officeKind('a.pdf'), null);
  assert.equal(isLegacyOffice('古い.xls'), true);
  assert.equal(isLegacyOffice('新しい.xlsx'), false);
  assert.equal(colIndex('A1'), 0);
  assert.equal(colIndex('AB12'), 27);
});

test('docx：段落・改行・表・実体参照', async () => {
  const xml = '<w:document><w:body>'
    + '<w:p><w:r><w:t>冬期講習の計画</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t xml:space="preserve">目標 </w:t></w:r><w:r><w:t>&lt;20名&gt; &amp; 継続</w:t></w:r></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>校舎</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>人数</w:t></w:r></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:r><w:t>日野校</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>12</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '</w:body></w:document>';
  const text = await officeToText('docx', await zip({ 'word/document.xml': xml }));
  assert.match(text, /冬期講習の計画\n目標 <20名> & 継続/);
  assert.match(text, /校舎 \| 人数\n日野校 \| 12/);
});

test('pptx：スライドを番号順に、ノートも添える', async () => {
  const s = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
  const text = await officeToText('pptx', await zip({
    'ppt/slides/slide10.xml': s('最後'),
    'ppt/slides/slide2.xml': s('二枚目'),
    'ppt/slides/slide1.xml': s('表紙'),
    'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Id="rId2" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
    'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:r><a:t>最初に挨拶する</a:t></a:r></a:p><a:p><a:r><a:t>1</a:t></a:r></a:p></p:notes>',
  }));
  assert.ok(text.indexOf('表紙') < text.indexOf('二枚目') && text.indexOf('二枚目') < text.indexOf('最後'));
  assert.match(text, /## スライド 1\n表紙\n（ノート）最初に挨拶する/);
  assert.match(text, /## スライド 3\n最後/);
});

test('xlsx：シート名・共有文字列・数値・空セル・ふりがな', async () => {
  const text = await officeToText('xlsx', await zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="9月" sheetId="1" r:id="rId1"/><sheet name="空" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>校舎</t></si><si><t>在籍</t></si><si><r><t>日野</t></r><r><t>校</t></r><rPh><t>ヒノ</t></rPh></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData>'
      + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2"><v>56</v></c><c r="D2" t="inlineStr"><is><t>メモ</t></is></c></row>'
      + '</sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
  }));
  assert.match(text, /## シート「9月」\n校舎\t在籍\n日野校\t\t56\tメモ/);
  assert.doesNotMatch(text, /ヒノ/);
  assert.match(text, /## シート「空」\n（空）/);
});

test('壊れたファイルは例外にする（呼び出し側で案内を出す）', async () => {
  await assert.rejects(() => officeToText('docx', new TextEncoder().encode('not a zip')));
});
