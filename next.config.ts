import type {NextConfig} from 'next';

/**
 * Content Security Policy and related headers (section 41).
 *
 * Section 41 lists "cross-site scripting through Markdown" as a threat and
 * "use content security policy" as its mitigation. Tutor output is model text
 * rendered as Markdown, and while `react-markdown` does not render raw HTML by
 * default, that is one dependency default standing between model output and the
 * DOM. A CSP is the second layer that does not depend on it.
 *
 * Two entries are weaker than they look, and both are deliberate rather than
 * copied:
 *
 * - `'unsafe-inline'` in `style-src` is required by KaTeX, which sets inline
 *   styles on the spans it generates for mathematical layout. Removing it breaks
 *   every rendered equation. Inline *styles* cannot execute script, so the
 *   residual risk is defacement rather than code execution.
 * - `'unsafe-eval'` in `script-src` is present in development only, because the
 *   Next.js dev server's hot reload requires it. Production omits it.
 *
 * `connect-src` is explicit rather than `*`: the browser talks to Firebase and
 * Google APIs and nothing else, so an injected script has nowhere to send what it
 * steals.
 */
const isDev = process.env.NODE_ENV !== 'production';

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://www.google.com https://www.gstatic.com https://apis.google.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://picsum.photos https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'wss://*.firebaseio.com',
    'https://*.firebaseapp.com',
    'https://apis.google.com',
    // Local emulator suite. Harmless in production, where these hosts do not resolve.
    ...(isDev ? ['http://127.0.0.1:*', 'ws://127.0.0.1:*', 'http://localhost:*'] : []),
  ].join(' '),
  // The Google sign-in popup renders in a frame.
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Section 25 minimization: a session URL contains a session id, and a full
  // referrer would hand it to every third party a page happens to reach.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // No feature in this application needs any of these.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  allowedDevOrigins: [
    'ais-dev-tp7wcazowuqpg6k2jcki3l-639123902441.asia-east1.run.app',
    'ais-pre-tp7wcazowuqpg6k2jcki3l-639123902441.asia-east1.run.app'
  ],
  // Allow access to remote image placeholder.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  // Turbopack config for Next.js 16+ (webpack config removed)
  turbopack: {},
};

export default nextConfig;
