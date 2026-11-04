// 智翔館AI：職員が貼った Google ドライブのリンクから、ファイルの中身を読む。サーバ専用。
//
// 読むのは Apps Script（apps_script/Code.gs の readDriveFile_）。Apps Script は持ち主の権限で動くので、
// 読んでよいフォルダ（AI_READ_FOLDER_IDS）の中のファイルだけを返す決まりにしてある。
// Google 形式は Apps Script で文字にして返り、Word・Excel・PowerPoint はここで文字にする。PDF はそのまま AI に渡す。

import type Anthropic from '@anthropic-ai/sdk';
import { officeToText, type OfficeKind } from './officeText';
import { extractDriveIds, reasonText } from './driveLinks';
import { callGas, type GasResult } from './gas';

export { MAX_LINKS } from './driveLinks';

type DriveGasResult = GasResult & { name?: string; kind?: string; text?: string; base64?: string };

export type DriveRead = { id: string; name: string; ok: boolean; note: string };

const KIND_LABEL: Record<string, string> = {
  doc: 'Googleドキュメント', sheet: 'Googleスプレッドシート', slides: 'Googleスライド',
  docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', pdf: 'PDF',
};

/** リンクのファイルを読み、AIに渡すブロックと、ログ・画面用の結果を返す。 */
export async function readDriveLinks(text: string): Promise<{ blocks: Anthropic.ContentBlockParam[]; reads: DriveRead[] }> {
  const ids = extractDriveIds(text);
  const blocks: Anthropic.ContentBlockParam[] = [];
  const reads: DriveRead[] = [];
  const results = (await Promise.all(ids.map((id) => callGas({ action: 'readDriveFile', id })))) as DriveGasResult[];
  for (const [i, j] of results.entries()) {
    const id = ids[i];
    const name = j.name || 'ファイル';
    // 再デプロイ前の Apps Script は未知の action に ok だけ返すので、kind が無ければ未対応とみなす。
    if (j.ok && !j.kind) j.reason = 'not_deployed';
    if (!j.ok || !j.kind) {
      const why = reasonText(j.reason);
      reads.push({ id, name, ok: false, note: why });
      blocks.push({ type: 'text', text: `【リンクのファイル：${name}】読めませんでした（${why}）。職員にそのことを伝え、必要ならファイルを添付してもらう。` });
      continue;
    }
    const label = KIND_LABEL[j.kind] ?? j.kind;
    try {
      if (j.kind === 'pdf' && j.base64) {
        blocks.push({ type: 'text', text: `【リンクのファイル：${name}（${label}）】` });
        blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: j.base64 } });
      } else {
        const body = j.base64 && (j.kind === 'docx' || j.kind === 'xlsx' || j.kind === 'pptx')
          ? await officeToText(j.kind as OfficeKind, Buffer.from(j.base64, 'base64'))
          : j.text ?? '';
        blocks.push({ type: 'text', text: `【リンクのファイル：${name}（${label}）】\n${body || '（文字が見つかりませんでした）'}` });
      }
      reads.push({ id, name, ok: true, note: label });
    } catch {
      reads.push({ id, name, ok: false, note: '読み取りに失敗しました' });
      blocks.push({ type: 'text', text: `【リンクのファイル：${name}】読み取りに失敗しました。` });
    }
  }
  return { blocks, reads };
}
