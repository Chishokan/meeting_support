// つきいち改善の保存・取得。サーバ専用。
//
// 本番：Apps Script（apps_script/Code.gs の listKaizen / saveKaizen / deleteKaizen / saveKaizenVote / setKaizenClose）
//       経由で、会議DXのスプレッドシートの「つきいち改善」「つきいち改善投票」「つきいち改善締切」シートを読み書きする。
//       写真は Apps Script が Drive のフォルダ「会議DX_つきいち改善写真」に置き、URL をシートに書く。
// 開発：APPS_SCRIPT_URL が無いときは .data/kaizen.json に保存する（git には入れない。写真は data URL のまま入る）。
//       Vercel 本番でスクリプト未設定なら not_configured を返し、画面に「未設定」と出す。
//
// 誰が直せるか・投票できるか・何票までかは、ここに来る前に API（app/api/kaizen/）が lib/kaizen/model.ts で確かめる。
// ★列を増やしたら Code.gs の KAIZEN_HEADERS / KAIZEN_VOTE_HEADERS / KAIZEN_CLOSE_HEADERS と合わせること。

import { promises as fs } from 'fs';
import path from 'path';
import { callGas } from '../inquiryStore';
import { normalizeMonth, nowJstText, splitNames, splitUrls, type Kaizen, type KaizenClose, type KaizenVote } from './model';

/** 写真の扱い：そのまま／外す／新しい写真（base64 の JPEG） */
export type PhotoChange = 'keep' | 'remove' | { data: string; mime: string; name: string };
export type PhotoChanges = { before: PhotoChange; after: PhotoChange };

export type KaizenData = { items: Kaizen[]; votes: KaizenVote[]; closes: KaizenClose[]; backend: 'sheet' | 'local' };
export type Fail = { ok: false; reason: string };

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? '' : String(v).trim());

function useLocal(): boolean {
  return !process.env.APPS_SCRIPT_URL && process.env.NODE_ENV !== 'production';
}

// ---- シートの1行 ⇔ 型 -------------------------------------------------------

export function fromSheetRow(r: Row): Kaizen {
  return {
    id: str(r['ID']),
    month: normalizeMonth(str(r['対象月'])),
    submittedAt: str(r['提出日時']),
    members: splitNames(str(r['提出者'])),
    campus: str(r['校舎']),
    title: str(r['改善タイトル']),
    before: str(r['Before（改善前）']),
    after: str(r['After（改善後）']),
    beforePhotos: splitUrls(str(r['Beforeの写真'])),
    afterPhotos: splitUrls(str(r['Afterの写真'])),
    enteredBy: str(r['入力者']),
    enteredDept: str(r['入力者の部門']),
    updatedAt: str(r['更新日時']),
    updatedBy: str(r['更新者']),
    source: str(r['取込元']),
  };
}

export function toSheetRow(k: Kaizen): Row {
  return {
    'ID': k.id,
    '対象月': k.month,
    '提出日時': k.submittedAt,
    '提出者': k.members.join('、'),
    '校舎': k.campus,
    '改善タイトル': k.title,
    'Before（改善前）': k.before,
    'After（改善後）': k.after,
    'Beforeの写真': k.beforePhotos.join('\n'),
    'Afterの写真': k.afterPhotos.join('\n'),
    '入力者': k.enteredBy,
    '入力者の部門': k.enteredDept,
    '更新日時': k.updatedAt,
    '更新者': k.updatedBy,
    '取込元': k.source,
  };
}

function voteFromRow(r: Row): KaizenVote {
  return {
    month: normalizeMonth(str(r['対象月'])),
    voter: str(r['投票者']),
    dept: str(r['投票者の部門']),
    ids: str(r['投票先ID']).split(',').map((s) => s.trim()).filter(Boolean),
    votedAt: str(r['投票日時']),
  };
}

function closeFromRow(r: Row): KaizenClose {
  return { month: normalizeMonth(str(r['対象月'])), closed: str(r['状態']) === '締切', by: str(r['更新者']), at: str(r['更新日時']) };
}

/** Apps Script が古い（つきいち改善の action を知らない）と、未知の action は会話ログ扱いで ok:true だけが返る。
 *  応答に kaizen の印が無ければ apps_script_outdated とし、「保存できた」と誤って出さないようにする。 */
function checkGas(j: { ok?: boolean; reason?: string } & Row): Fail | null {
  if (!j.ok) return { ok: false, reason: j.reason || 'upstream_error' };
  if (!j.kaizen) return { ok: false, reason: 'apps_script_outdated' };
  return null;
}

// ---- 開発用ローカル保存 ------------------------------------------------------

const LOCAL_FILE = path.join(process.cwd(), '.data', 'kaizen.json');
type LocalDb = { items: (Kaizen & { deleted?: boolean })[]; votes: KaizenVote[]; closes: KaizenClose[] };

async function readLocal(): Promise<LocalDb> {
  try {
    const j = JSON.parse(await fs.readFile(LOCAL_FILE, 'utf8'));
    return { items: j.items ?? [], votes: j.votes ?? [], closes: j.closes ?? [] };
  } catch {
    return { items: [], votes: [], closes: [] };
  }
}

async function writeLocal(db: LocalDb): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function applyPhoto(cur: string[], change: PhotoChange): string[] {
  if (change === 'keep') return cur;
  if (change === 'remove') return [];
  return [`data:${change.mime};base64,${change.data}`];
}

// ---- 公開 API ------------------------------------------------------------

export async function loadKaizen(): Promise<({ ok: true } & KaizenData) | Fail> {
  if (useLocal()) {
    const db = await readLocal();
    return { ok: true, items: db.items.filter((k) => !k.deleted), votes: db.votes, closes: db.closes, backend: 'local' };
  }
  const j = (await callGas({ action: 'listKaizen' })) as Row & { ok?: boolean; reason?: string };
  const bad = checkGas(j);
  if (bad) return bad;
  const rows = (v: unknown) => (Array.isArray(v) ? (v as Row[]) : []);
  return {
    ok: true,
    items: rows(j.items).map(fromSheetRow).filter((k) => k.id && k.month),
    votes: rows(j.votes).map(voteFromRow).filter((v) => v.month && v.voter),
    closes: rows(j.closes).map(closeFromRow).filter((c) => c.month),
    backend: 'sheet',
  };
}

/** 新規なら追加、同じ ID があれば上書き。写真は photos の指示どおりに差し替える。 */
export async function saveKaizen(k: Kaizen, photos: PhotoChanges): Promise<{ ok: true; item: Kaizen } | Fail> {
  if (useLocal()) {
    const db = await readLocal();
    const i = db.items.findIndex((x) => x.id === k.id);
    const cur = i >= 0 ? db.items[i] : null;
    const item: Kaizen = {
      ...k,
      beforePhotos: applyPhoto(cur?.beforePhotos ?? [], photos.before),
      afterPhotos: applyPhoto(cur?.afterPhotos ?? [], photos.after),
      updatedAt: nowJstText(),
    };
    if (i >= 0) db.items[i] = item;
    else db.items.push(item);
    await writeLocal(db);
    return { ok: true, item };
  }
  const j = (await callGas({ action: 'saveKaizen', record: toSheetRow(k), photos })) as Row & { ok?: boolean; reason?: string };
  const bad = checkGas(j);
  if (bad) return bad;
  return { ok: true, item: fromSheetRow((j.item as Row) ?? {}) };
}

export async function deleteKaizen(id: string, user: string): Promise<{ ok: true } | Fail> {
  if (useLocal()) {
    const db = await readLocal();
    const k = db.items.find((x) => x.id === id);
    if (!k) return { ok: false, reason: 'not_found' };
    Object.assign(k, { deleted: true, updatedAt: nowJstText(), updatedBy: user });
    await writeLocal(db);
    return { ok: true };
  }
  const j = (await callGas({ action: 'deleteKaizen', id, user })) as Row & { ok?: boolean; reason?: string };
  return checkGas(j) ?? { ok: true };
}

/** 対象月×投票者で1件。ids が空なら、その人のその月の票を消す。labels はシートで読めるように添える。 */
export async function saveVote(v: KaizenVote, labels: string[]): Promise<{ ok: true } | Fail> {
  if (useLocal()) {
    const db = await readLocal();
    db.votes = db.votes.filter((x) => !(x.month === v.month && x.voter === v.voter));
    if (v.ids.length) db.votes.push(v);
    await writeLocal(db);
    return { ok: true };
  }
  const j = (await callGas({ action: 'saveKaizenVote', month: v.month, voter: v.voter, dept: v.dept, ids: v.ids, labels })) as Row & {
    ok?: boolean;
    reason?: string;
  };
  return checkGas(j) ?? { ok: true };
}

export async function setClose(month: string, closed: boolean, user: string): Promise<{ ok: true } | Fail> {
  if (useLocal()) {
    const db = await readLocal();
    db.closes = db.closes.filter((c) => c.month !== month);
    db.closes.push({ month, closed, by: user, at: nowJstText() });
    await writeLocal(db);
    return { ok: true };
  }
  const j = (await callGas({ action: 'setKaizenClose', month, closed, user })) as Row & { ok?: boolean; reason?: string };
  return checkGas(j) ?? { ok: true };
}
