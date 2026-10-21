import { NextResponse } from 'next/server';
import { STAFF_COOKIE } from '@/lib/monpai/staffSession';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
