// セッション Cookie の名前だけを置く。middleware（Edge で動く）からも読めるよう、
// Node の機能（crypto など）を使う auth.ts とは分けている。
export const SESSION_COOKIE = 'chishokan_session';
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12時間
