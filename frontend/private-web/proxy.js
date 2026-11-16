import { NextResponse } from 'next/server';
import { buildContentSecurityPolicy } from './src/config/securityHeaders.mjs';

export function proxy(request) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const policy = buildContentSecurityPolicy(
    process.env.NEXT_PUBLIC_ELEVANT_API_URL,
    nonce,
    { development: process.env.NODE_ENV === 'development' },
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/|brand/).*)'],
};
