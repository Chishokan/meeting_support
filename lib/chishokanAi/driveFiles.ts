// 智翔館AI：職員が貼った Google ドライブのリンクから、ファイルの中身を読む。サーバ専用。
//
// 読むのは Apps Script（apps_script/Code.gs の readDriveFile_）。Apps Script は持ち主の権限で動くので、
// 読んでよいフォルダ（AI_READ_FOLDER_IDS）の中のファイルだけを返す決まりにしてある。
// Google 形式は Apps Script で文字にして返り、Word・Excel・PowerPoint はここで文字にする。PDF はそのまま AI に渡す。

import type Anthropic from '@anthropic-ai/sdk';
import { officeToText, type OfficeKind } from './officeText';
import { driveIdFrom, extractDriveFolderIds, extractDriveIds, MAX_LINKS, reasonText } from './driveLinks';
import { callGas, type GasResult } from './gas';

export { MAX_LINKS } from './driveLinks';

type DriveGasResult = GasResult & { name?: string; kind?: string; text?: string; base64?: string };

export type DriveRead = { id: string; name: string; ok: boolean; note: string };

const KIND_LABEL: Record<string, string> = {
  doc: 'Googleドキュメント', sheet: 'Googleスプレッドシート', slides: 'Googleスライド',
  docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', pdf: 'PDF',
};

type FolderItem = { id: string; name: string; kind: string; updated: string; folder: boolean };
type FolderGasResult = GasResult & { name?: string; items?: FolderItem[]; more?: boolean };

/** ファイル1件を読み、AIに渡すブロックと結果を返す。pdfAsDocument=false のときは PDF を文字にできないので案内だけ返す。 */
async function readOne(id: string, pdfAsDocument = true): Promise<{ blocks: Anthropic.ContentBlockParam[]; read: DriveRead }> {
  const j = (await callGas({ action: 'readDriveFile', id })) as DriveGasResult;
  const name = j.name || 'ファイル';
  // 再デプロイ前の Apps Script は未知の action に ok だけ返すので、kind が無ければ未対応とみなす。
  if (j.ok && !j.kind) j.reason = 'not_deployed';
  if (!j.ok || !j.kind) {
    const why = reasonText(j.reason);
    return {
      blocks: [{ type: 'text', text: `【リンクのファイル：${name}】読めませんでした（${why}）。職員にそのことを伝え、必要ならファイルを添付してもらう。` }],
      read: { id, name, ok: false, note: why },
    };
  }
  const label = KIND_LABEL[j.kind] ?? j.kind;
  try {
    if (j.kind === 'pdf') {
      if (pdfAsDocument && j.base64) {
        return {
          blocks: [
            { type: 'text', text: `【リンクのファイル：${name}（${label}）】` },
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: j.base64 } },
          ],
          read: { id, name, ok: true, note: label },
        };
      }
      return {
        blocks: [{ type: 'text', text: `【リンクのファイル：${name}（PDF）】この道具では PDF の中身を読めません。PDF のリンクを質問に貼るか、添付してもらう。` }],
        read: { id, name, ok: false, note: 'PDF（道具では読めない）' },
      };
    }
    const body = j.base64 && (j.kind === 'docx' || j.kind === 'xlsx' || j.kind === 'pptx')
      ? await officeToText(j.kind as OfficeKind, Buffer.from(j.base64, 'base64'))
      : j.text ?? '';
    return {
      blocks: [{ type: 'text', text: `【リンクのファイル：${name}（${label}）】\n${body || '（文字が見つかりませんでした）'}` }],
      read: { id, name, ok: true, note: label },
    };
  } catch {
    return { blocks: [{ type: 'text', text: `【リンクのファイル：${name}】読み取りに失敗しました。` }], read: { id, name, ok: false, note: '読み取りに失敗しました' } };
  }
}

/** フォルダの中身を一覧し、AIに渡す文と結果を返す。 */
async function listOne(id: string): Promise<{ text: string; read: DriveRead }> {
  const j = (await callGas({ action: 'listDriveFolder', id })) as FolderGasResult;
  const name = j.name || 'フォルダ';
  if (j.ok && !Array.isArray(j.items)) j.reason = 'not_deployed';
  if (!j.ok || !Array.isArray(j.items)) {
    const why = reasonText(j.reason);
    return { text: `【リンクのフォルダ：${name}】開けませんでした（${why}）。職員にそのことを伝える。`, read: { id, name, ok: false, note: why } };
  }
  const lines = j.items.map((it) => `- ${it.folder ? '📁 ' : ''}${it.name}｜${it.kind}｜更新 ${it.updated}｜id: ${it.id}`);
  const more = j.more ? '\n（多いため途中までです）' : '';
  return {
    text: `【リンクのフォルダ：${name}】中身（${j.items.length}件）。必要なファイルは read_drive_file に id を渡して読む。中のフォルダは list_drive_folder で開く。\n${lines.join('\n') || '（空）'}${more}`,
    read: { id, name, ok: true, note: 'フォルダ一覧' },
  };
}

/** 質問に貼られたリンク（ファイル・フォルダ）を読み、AIに渡すブロックと、ログ用の結果を返す。合わせて3件まで。 */
export async function readDriveLinks(text: string): Promise<{ blocks: Anthropic.ContentBlockParam[]; reads: DriveRead[] }> {
  const fileIds = extractDriveIds(text);
  const folderIds = extractDriveFolderIds(text).slice(0, Math.max(0, MAX_LINKS - fileIds.length));
  const [files, folders] = await Promise.all([
    Promise.all(fileIds.map((id) => readOne(id))),
    Promise.all(folderIds.map((id) => listOne(id))),
  ]);
  return {
    blocks: [...files.flatMap((f) => f.blocks), ...folders.map((f) => ({ type: 'text' as const, text: f.text }))],
    reads: [...files.map((f) => f.read), ...folders.map((f) => f.read)],
  };
}

/** AI が呼んだ list_drive_folder / read_drive_file を実行し、ツールの結果（文字）を返す。 */
export async function runDriveTool(name: string, input: Record<string, unknown>): Promise<{ text: string; read: DriveRead | null }> {
  const id = driveIdFrom(name === 'list_drive_folder' ? input?.folder : input?.file);
  if (!id) return { text: 'URLかIDの形が正しくありません。', read: null };
  if (name === 'list_drive_folder') {
    const r = await listOne(id);
    return { text: r.text, read: r.read };
  }
  const r = await readOne(id, false);
  // フォルダのIDを read_drive_file に渡すと「見つからない」になる。その場合はフォルダとして一覧を返す。
  if (!r.read.ok) {
    const asFolder = await listOne(id);
    if (asFolder.read.ok) return { text: `（これはフォルダでした。中身の一覧です）\n${asFolder.text}`, read: asFolder.read };
  }
  const text = r.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
  return { text, read: r.read };
}
