'use client';

// 「音声を取り込む」欄（その場で録音／録音ファイルを添付／文字起こしを貼り付け＋進み具合）。
// 「部門会議議事録」と「面談記録」の両方で使う。録音・送信の仕組みは lib/useAudioTranscriber.ts。
// ★文言の「会議」「面談」は subject で切り替える。

import { useEffect, useState } from 'react';
import { SEGMENT_SECONDS, fmtDuration } from '@/lib/audioChunk';
import { PHASE_LABEL, REC_SEGMENT_SECONDS, type AudioTranscriber } from '@/lib/useAudioTranscriber';

type Source = 'record' | 'file' | 'paste';

// 添付できる音声。スマホの標準録音アプリが書き出す形式を拡張子でも並べておく
//（MIME だけだと、端末によっては .m4a などが選べない状態で表示されるため）。
// AMR（.amr / .3gp）はブラウザで読めないが、選べないと理由が分からないので、選ばせてから案内を出す。
const ACCEPT = [
  'audio/*', 'video/*',
  '.m4a', '.mp3', '.wav', '.aac', '.caf', '.mp4', '.ogg', '.opus', '.flac', '.webm', '.amr', '.3gp', '.3gpp',
].join(',');

type Device = 'ios' | 'android' | 'other';

function detectDevice(): Device {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  // iPadOS の Safari は Mac として名乗るので、タッチの有無で見分ける。
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  return 'other';
}

export default function AudioCapture({
  t,
  transcript,
  setTranscript,
  subject,
  recordHint,
}: {
  t: AudioTranscriber;
  transcript: string;
  setTranscript: (s: string) => void;
  subject: string; // 「会議」「面談」
  recordHint?: string; // 録音タブの下に足す一言（録音の了承を取る、など）
}) {
  const [source, setSource] = useState<Source>('record');
  // 文字起こしは普段は隠しておく（必要なときだけ開く）。
  const [showTranscript, setShowTranscript] = useState(false);
  const { recording, configured, phase, lastRun } = t;
  // 使っている端末の手順を先に開いて見せる（サーバ側では分からないので、表示後に判定する）。
  const [device, setDevice] = useState<Device>('other');
  useEffect(() => setDevice(detectDevice()), []);
  const mobile = device !== 'other';

  return (
    <>
      {configured === false && (
        <p className="dm-warn">
          音声の自動文字起こしが未設定です。管理者に環境変数 <code>GEMINI_API_KEY</code>（Google AI Studio のAPIキー）
          の設定を依頼してください。設定までは「文字起こしを貼り付け」をご利用いただけます。
        </p>
      )}

      <div className="dm-check">
        <button onClick={() => void t.checkSetup()} disabled={t.checking || recording}>
          文字起こしの接続テスト
        </button>
        {t.checkMsg && <span className={`dm-check-msg ${t.checkOk ? 'ok' : ''}`}>{t.checkMsg}</span>}
      </div>

      <div className="dm-tabs">
        <button
          className={`dm-tab ${source === 'record' ? 'active' : ''}`}
          onClick={() => setSource('record')}
          disabled={recording}
        >
          その場で録音
        </button>
        <button
          className={`dm-tab ${source === 'file' ? 'active' : ''}`}
          onClick={() => setSource('file')}
          disabled={recording}
        >
          録音ファイルを添付
        </button>
        <button
          className={`dm-tab ${source === 'paste' ? 'active' : ''}`}
          onClick={() => setSource('paste')}
          disabled={recording}
        >
          文字起こしを貼り付け
        </button>
      </div>

      {source === 'record' && (
        <div className="dm-source">
          <div className="dm-rec">
            {!recording ? (
              <button className="dm-rec-btn" onClick={() => void t.startRecording()} disabled={configured === false}>
                ● 録音を開始
              </button>
            ) : (
              <button className="dm-rec-btn stop" onClick={t.stopRecording}>
                ■ 録音を終了
              </button>
            )}
            {recording && <span className="dm-rec-time">録音中 {fmtDuration(t.elapsed)}</span>}
          </div>
          {recording && (
            <p className="dm-note warn ac-keep">
              録音中は画面を消したり、他のアプリに切り替えたりしないでください（その間は録音されません）。
            </p>
          )}
          {!recording && t.interrupted && (
            <p className="dm-note warn">
              録音中に画面が消えたか、他のアプリに切り替わりました。その間の音声は入っていない可能性があります。
              足りないところは下のメモに書き足してください。
            </p>
          )}
          <p className="dm-hint">
            録音は{REC_SEGMENT_SECONDS / 60}分ごとに区切って、{subject}中から順に文字にしていきます。
            {subject}が終わるころには文字起こしもほぼ終わっています。画面を閉じると録音は止まります。
            {mobile && (
              <>
                <br />
                スマホでは、録音中に画面が消えたり他のアプリを開いたりすると録音が止まります。
                画面を開いたままにできないときは、スマホの録音アプリ（ボイスメモ・レコーダー）で録音して、
                あとから「録音ファイルを添付」で取り込んでください。
              </>
            )}
            {recordHint && <><br />{recordHint}</>}
          </p>
        </div>
      )}

      {source === 'file' && (
        <div className="dm-source">
          {/* スマホでは標準の「ファイルを選択」が小さく押しにくいので、ボタンの形にして入力欄は隠す */}
          <label className={`ac-pick ${configured === false || phase !== 'idle' ? 'disabled' : ''}`}>
            <input
              type="file"
              accept={ACCEPT}
              onChange={(e) => void t.onPickFile(e)}
              disabled={configured === false || phase !== 'idle'}
            />
            <span>録音ファイルを選ぶ</span>
          </label>
          {t.picked && (
            <p className="ac-picked">
              選んだファイル：<b>{t.picked.name}</b>（{t.picked.size}）
            </p>
          )}
          <p className="dm-hint">
            スマートフォンの録音アプリ等で録った音声（m4a / mp3 / wav など）を選んでください。
            長い{subject}は自動で{SEGMENT_SECONDS}秒ずつに分けて処理します。
            取り込みが終わるまで、この画面を開いたままにしてください（画面が消えると止まります）。
          </p>

          <details className="ac-guide" open={device === 'ios'} key={`ios-${device}`}>
            <summary>iPhone の「ボイスメモ」から取り込む</summary>
            <ol>
              <li>「ボイスメモ」で取り込みたい録音を開き、<b>「…」</b>（その他）を押す</li>
              <li><b>「"ファイル"に保存」</b>を選び、保存先（「このiPhone内」など）を選んで<b>「保存」</b></li>
              <li>この画面で<b>「録音ファイルを選ぶ」</b>→<b>「ファイルを選択」</b>→ 2で保存した場所から録音を選ぶ</li>
            </ol>
            <p>
              ボイスメモの録音は「ファイル」アプリに保存してからでないと選べません。
              録音の名前を {subject}の日付・生徒名などに変えておくと、選ぶときに迷いません。
            </p>
          </details>

          <details className="ac-guide" open={device === 'android'} key={`android-${device}`}>
            <summary>Android の録音アプリから取り込む</summary>
            <ol>
              <li>この画面で<b>「録音ファイルを選ぶ」</b>を押す</li>
              <li>
                出てきた画面で<b>「音声」</b>、または<b>「Recordings」</b>（Galaxy は「Recordings」→「Voice Recorder」）の
                フォルダを開き、録音を選ぶ
              </li>
            </ol>
            <p>
              Pixel の「レコーダー」など、録音がアプリの中にしか保存されない機種では、
              録音を開いて<b>「共有」</b>→ 音声ファイルとして「ファイル」アプリや Google ドライブに保存してから選んでください。
              録音アプリの保存形式が「AMR」「3GP」になっていると読み込めません。設定で「M4A」「MP3」などに変えてください。
            </p>
          </details>
        </div>
      )}

      {source === 'paste' && (
        <div className="dm-source">
          <p className="dm-hint">
            他のアプリで文字起こし済みのテキストがあれば、下の欄に直接貼り付けてください。
          </p>
        </div>
      )}

      {/* 文字起こしは画面に出さず内部で保持する。
          40〜60分の録音では数万字になり、直すのはAIがまとめた文章の方なので普段は見せない。
          ただし「貼り付け」は入力欄そのものなので、そのときだけ常に表示する。 */}
      {source === 'paste' ? (
        <label className="dm-transcript">
          <span>文字起こしを貼り付け（{transcript.length.toLocaleString()}字）</span>
          <textarea
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="他のアプリで文字起こししたテキストをここに貼り付けてください。"
          />
        </label>
      ) : (
        <>
          {t.busy ? (
            /* いま何をしているか（読み込み／アップロード／解析）と、どこまで進んだかを出す */
            <div className="dm-work">
              <div className="dm-work-head">
                <span className="dm-spinner" aria-hidden="true" />
                <span className="dm-work-phase">
                  {phase === 'idle' ? '処理中' : PHASE_LABEL[phase]}
                  {phase === 'uploading' && ` ${t.uploadPct}%`}
                  {phase === 'waiting' && t.waitLeft > 0 && `（あと${t.waitLeft}秒で送り直します）`}
                </span>
                {/* 読み込みが終わるまで区間数は決まらないので、決まってから出す */}
                {t.fileProgress.total > 0 ? (
                  <span className="dm-work-count">
                    {t.fileProgress.done} / {t.fileProgress.total} 区間
                  </span>
                ) : t.queued > 0 ? (
                  <span className="dm-work-count">残り {t.queued} 区間</span>
                ) : null}
              </div>
              <div className="dm-bar">
                <div
                  className={`dm-bar-fill ${t.fileProgress.total > 0 ? '' : 'indet'}`}
                  style={
                    t.fileProgress.total > 0
                      ? { width: `${Math.round((t.fileProgress.done / t.fileProgress.total) * 100)}%` }
                      : undefined
                  }
                />
              </div>
              <p className="dm-work-note">
                {transcript.trim()
                  ? `ここまでに ${transcript.length.toLocaleString()} 字を文字にしました。`
                  : '最初の区間の結果が出るまで少しお待ちください。'}
                {phase === 'analyzing' && ' 画面を閉じずにお待ちください。'}
                {/* 途中の取りこぼしは件数だけ控えめに出す。詳しい案内は終わってから1行で出す */}
                {t.failedSegs > 0 && ` 取りこぼし ${t.failedSegs} 区間（このまま続けます）。`}
              </p>
            </div>
          ) : (
            <div className={`dm-tstatus ${lastRun && lastRun.ok === 0 ? 'bad' : ''}`}>
              <span>
                {transcript.trim()
                  ? `文字起こし完了（${transcript.length.toLocaleString()}字）`
                    + (lastRun && lastRun.failed > 0 ? `／${lastRun.failed}区間は取りこぼし` : '')
                  : lastRun && lastRun.ok === 0
                    ? '文字起こしできませんでした（下の赤い案内をご確認ください）'
                    : '音声を取り込むと、ここで文字起こしが進みます'}
              </span>
              {transcript.trim() && (
                <button className="dm-tlink" onClick={() => setShowTranscript((v) => !v)}>
                  {showTranscript ? '閉じる' : '文字起こしを確認'}
                </button>
              )}
            </div>
          )}
          {showTranscript && (
            <label className="dm-transcript">
              <span>文字起こし（通常は直す必要はありません。まとめた文章は次の欄で直せます）</span>
              <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} />
            </label>
          )}
        </>
      )}
    </>
  );
}
