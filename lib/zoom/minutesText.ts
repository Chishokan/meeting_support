// 録画から作る議事録の下書きの、画面に出す文言（Zoom連携）。
// ★画面・API・テストのどこからでも読めるよう、ここには import を置かない（型と計算だけ）。

export type AttemptLike = { source: string; ok: boolean; reason?: string; detail?: string };

export function sourceLabel(source: string | undefined | null): string {
  switch (String(source ?? '')) {
    case 'openai': return 'OpenAI';
    case 'gemini': return 'Gemini';
    case 'zoom': return 'Zoom の文字起こし（予備）';
    default: return '';
  }
}

function attemptReason(reason: string | undefined): string {
  switch (String(reason ?? '')) {
    case 'not_configured': return '未設定';
    case 'too_large': return '音声が大きすぎる';
    case 'rate_limited': return '利用枠の上限';
    case 'quota': return '残高・利用枠の不足';
    case 'invalid_key': return 'キーが無効';
    case 'model_not_found': return 'モデル名が違う';
    case 'timeout': return '時間切れ';
    case 'truncated': return '長すぎて途中で切れた';
    case 'empty': return '声が入っていない';
    case 'no_transcript': return '文字起こしが無い';
    case 'not_japanese': return '日本語として取れていない';
    case 'no_audio': return '音声ファイルが無い';
    case 'download_failed': return '録画を取り出せなかった';
    case 'upstream_busy': return '相手側が混雑';
    default: return '失敗';
  }
}

/** うまくいかなかった任せ先の一覧（例「OpenAI：音声が大きすぎる ／ Gemini：時間切れ」）。無ければ空。 */
export function failedAttemptsText(attempts: AttemptLike[] | undefined | null): string {
  return (attempts ?? [])
    .filter((a) => !a.ok)
    .map((a) => `${sourceLabel(a.source).replace('（予備）', '') || a.source}：${attemptReason(a.reason)}${a.detail ? `（${a.detail}）` : ''}`)
    .join(' ／ ');
}

/** 下書きを作れなかった理由。 */
export function jobErrorText(reason: string | undefined | null): string {
  switch (String(reason ?? '')) {
    case 'no_recording':
      return 'この会議の録画が Zoom に見つかりません。ホストが開始して録画した会議だけ作れます（録画していない場合は、下の録音・添付をご利用ください）。';
    case 'processing':
      return 'Zoom が録画を処理中です。会議が終わってから数分〜十数分かかります。少し待ってからもう一度押してください。';
    case 'busy':
      return 'いま下書きを作成中です。このまましばらくお待ちください（自動で確認します）。';
    case 'transcribe_failed':
      return '録画の文字起こしができませんでした。少し待ってやり直すか、下の録音ファイルの添付をご利用ください。';
    case 'minutes_failed':
      return '文字起こしはできましたが、議事録の作成に失敗しました。［続きから作る］を押してください。';
    case 'has_minutes':
      return 'この会議は議事録を保存済みです。';
    case 'forbidden':
      return 'この会議の録画から議事録を作れるのは、その部門の方・事前共有した方・管理部門だけです。';
    case 'not_configured':
      return '録画からの議事録づくりが未設定です。管理者にご連絡ください。';
    case 'not_found':
      return 'この会議の Zoom ミーティングが見つかりません。';
    case 'unauthorized':
      return 'ログインが切れました。ログインし直してください。';
    default:
      return '録画から議事録を作れませんでした。少し待ってからもう一度お試しください。';
  }
}
