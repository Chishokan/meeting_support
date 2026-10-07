// 音声ファイルをブラウザ側で WAV に変換・分割するユーティリティ（会議DX フェーズ2）
// -------------------------------------------------------------------------
// この処理には2つの役目がある。
//
// 1) 形式をそろえる：文字起こしに使う Gemini が受け付ける音声は
//    WAV / MP3 / AIFF / AAC / OGG / FLAC で、ブラウザ録音の webm は受け付けない。
//    そこで録音・添付ファイルのどちらも、いったん 16kHz モノラルの WAV に変換してから送る。
// 2) 大きさを抑える：1時間の会議をそのまま送ると、サーバ関数の実行時間・
//    リクエストサイズの上限に引っかかる。SEGMENT_SECONDS ごとに切り出して順番に送る。
//
// 16kHz モノラル 16bit = 32KB/秒。SEGMENT_SECONDS=90 なら1区間およそ2.9MB。
// ★区間の長さを変えるときは、サーバ側（app/api/dept-minutes/transcribe/route.ts）の
//   実行時間上限に収まるかを必ず確認すること。

export const SEGMENT_SECONDS = 90;

// これより短い末尾の区間は捨てる（1秒未満に意味のある発言は入らないので、
// 文字起こしAPIを1回無駄に呼ばないため）。区間が1つしか無い場合は捨てない。
const MIN_TAIL_SECONDS = 1;

const TARGET_RATE = 16000; // 音声認識に十分なサンプリングレート（話し声は 8kHz までに収まる）

type AudioCtor = typeof AudioContext;
type OfflineCtor = typeof OfflineAudioContext;

function audioContext(): AudioContext {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext || w.webkitAudioContext;
  if (!Ctor) throw new Error('audio_unsupported');
  return new Ctor();
}

// 古い Safari の decodeAudioData は Promise を返さずコールバックだけを呼ぶので、両方に対応する。
function decodeWith(ctx: BaseAudioContext, raw: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    try {
      const p = ctx.decodeAudioData(raw, resolve, reject);
      if (p && typeof (p as Promise<AudioBuffer>).then === 'function') {
        (p as Promise<AudioBuffer>).then(resolve, reject);
      }
    } catch (e) {
      reject(e);
    }
  });
}

// 音声を読み込む（デコードする）。
// ★スマホ対策：まず 16kHz の OfflineAudioContext で読む。こうするとブラウザが読み込みと同時に
//   16kHz へ落とすので、1時間のモノラル録音でも中身はおよそ230MBで済む
//   （ふつうの AudioContext は 44.1/48kHz で読むため、同じ録音が約700MB〜1.4GB になり、
//    iPhone の Safari では途中でページごと落ちることがある）。
//   16kHz を受け付けないブラウザ（古い Safari など）だけ、従来どおり AudioContext で読む。
async function decodeAudio(file: Blob): Promise<AudioBuffer> {
  const w = window as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  const Offline = w.OfflineAudioContext || w.webkitOfflineAudioContext;
  if (Offline) {
    let offline: OfflineAudioContext | null = null;
    try {
      offline = new Offline(1, 1, TARGET_RATE);
    } catch {
      offline = null;
    }
    if (offline) {
      try {
        // decodeAudioData は渡した ArrayBuffer を使えなくするので、失敗に備えて読み直せるよう毎回 file から取る。
        return await decodeWith(offline, await file.arrayBuffer());
      } catch {
        // 下の AudioContext で読み直す（形式が読めない場合は、そちらも失敗して呼び出し側へ伝わる）。
      }
    }
  }
  const ctx = audioContext();
  try {
    return await decodeWith(ctx, await file.arrayBuffer());
  } finally {
    // 端末のオーディオリソースを掴んだままにしない。
    try {
      await ctx.close();
    } catch {}
  }
}

// 読み込んだ音声の [from, to)（16kHz 換算のサンプル位置）だけを、モノラル 16kHz にして取り出す。
// 全体をまとめて変換すると同じ大きさの配列がもう1本できてしまうので、区間ごとに作っては捨てる。
// 全チャンネルの平均でモノラル化し、16kHz でなければ線形補間で落とす
//（OfflineAudioContext は 16kHz を拒否するブラウザがあるため、自前でも計算できるようにしてある）。
function monoSlice16k(buf: AudioBuffer, from: number, to: number): Float32Array {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  const ratio = buf.sampleRate / TARGET_RATE;
  const out = new Float32Array(Math.max(0, to - from));
  for (let i = 0; i < out.length; i++) {
    const pos = (from + i) * ratio;
    const i0 = Math.min(Math.floor(pos), buf.length - 1);
    const i1 = Math.min(i0 + 1, buf.length - 1);
    const t = pos - Math.floor(pos);
    let sum = 0;
    for (const ch of channels) sum += ratio === 1 ? ch[i0] : ch[i0] * (1 - t) + ch[i1] * t;
    out[i] = sum / channels.length;
  }
  return out;
}

// Float32（-1〜1）の並びを 16bit PCM の WAV ファイルにする。
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt チャンクの長さ
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // モノラル
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // バイト/秒
  view.setUint16(32, 2, true); // ブロックサイズ
  view.setUint16(34, 16, true); // ビット深度
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export type AudioSegments = {
  segments: Blob[];
  durationSec: number;
};

// 音声ファイル（mp3 / m4a / wav / webm など、ブラウザが再生できる形式）を
// SEGMENT_SECONDS ごとの 16kHz モノラル WAV に切り分ける。
// 読めない形式（AMR など）や壊れたファイルは例外になる。理由の見分けは audioFileProblem() を使う。
export async function splitAudioFile(file: Blob): Promise<AudioSegments> {
  const decoded = await decodeAudio(file);
  const total = Math.max(1, Math.floor(decoded.duration * TARGET_RATE));
  const per = SEGMENT_SECONDS * TARGET_RATE;
  const segments: Blob[] = [];
  for (let start = 0; start < total; start += per) {
    const end = Math.min(start + per, total);
    // 末尾に1秒未満の切れ端が出たら捨てる（ただし全体がそれしか無い場合は残す）。
    if (start > 0 && end - start < MIN_TAIL_SECONDS * TARGET_RATE) break;
    segments.push(encodeWav(monoSlice16k(decoded, start, end), TARGET_RATE));
  }
  return { segments, durationSec: decoded.duration };
}

// スマホの録音アプリが書き出すファイルのうち、ブラウザでは読めないと分かっている形式。
// 古い Android の標準レコーダーや通話録音は AMR（.amr / .3gp）で保存することがあり、
// iPhone・Android どちらのブラウザも AMR を読めない。読み込みに失敗したとき、案内を出し分けるのに使う。
export function audioFileProblem(file: { name?: string; type?: string }): 'amr' | null {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (/\.(amr|3gp|3gpp|3ga|awb)$/.test(name) || /amr|3gpp/.test(type)) return 'amr';
  return null;
}

// ファイルの大きさを「12.3MB」のように表示する。
export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

// 秒数を「1時間03分」「12分30秒」のように表示する。
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}時間${String(m).padStart(2, '0')}分`;
  if (m > 0) return `${m}分${String(r).padStart(2, '0')}秒`;
  return `${r}秒`;
}
