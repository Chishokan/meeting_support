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

const TARGET_RATE = 16000; // Whisper 系の音声認識が想定するサンプリングレート

type AudioCtor = typeof AudioContext;

function audioContext(): AudioContext {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext || w.webkitAudioContext;
  if (!Ctor) throw new Error('audio_unsupported');
  return new Ctor();
}

// 全チャンネルを平均してモノラル化しつつ、線形補間で 16kHz に落とす。
// （OfflineAudioContext は 16kHz を拒否するブラウザがあるため、自前で計算する）
function toMono16k(buf: AudioBuffer): Float32Array {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));

  const ratio = buf.sampleRate / TARGET_RATE;
  const outLength = Math.max(1, Math.floor(buf.length / ratio));
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, buf.length - 1);
    const t = pos - i0;
    let sum = 0;
    for (const ch of channels) sum += ch[i0] * (1 - t) + ch[i1] * t;
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
export async function splitAudioFile(file: Blob): Promise<AudioSegments> {
  const ctx = audioContext();
  try {
    const raw = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(raw);
    const mono = toMono16k(decoded);
    const per = SEGMENT_SECONDS * TARGET_RATE;
    const segments: Blob[] = [];
    for (let start = 0; start < mono.length; start += per) {
      const chunk = mono.subarray(start, Math.min(start + per, mono.length));
      // 末尾に1秒未満の切れ端が出たら捨てる（ただし全体がそれしか無い場合は残す）。
      if (start > 0 && chunk.length < MIN_TAIL_SECONDS * TARGET_RATE) break;
      segments.push(encodeWav(chunk, TARGET_RATE));
    }
    return { segments, durationSec: decoded.duration };
  } finally {
    // 端末のオーディオリソースを掴んだままにしない。
    try {
      await ctx.close();
    } catch {}
  }
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
