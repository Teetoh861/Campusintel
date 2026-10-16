/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  // AI practice parses uploads in a separate Node process (lib/ai-practice/parser-process.ts) that loads these files
  // at run time, outside the bundle, so the upload route's function must ship them.
  outputFileTracingIncludes: {
    '/api/ai-practice': [
      './lib/ai-practice/extract-parser.cjs',
      './lib/ai-practice/word-xml.cjs',
      './node_modules/unpdf/package.json',
      './node_modules/unpdf/dist/pdfjs.mjs',
      './node_modules/fflate/package.json',
      './node_modules/fflate/lib/node.cjs',
    ],
  },
  async redirects() {
    return [
      {
        source: '/courses/bua201-test-compilation',
        destination: '/courses/principles-business-administration',
        permanent: true,
      },
    ]
  },
  async headers() {
    // Students upload AI practice files straight to private Supabase Storage with a signed URL,
    // because hosted functions cap request bodies below the 5 MB file limit.
    let supabaseOrigin = ''
    try { supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin } catch { supabaseOrigin = '' }
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      `connect-src 'self' https://va.vercel-scripts.com${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: csp,
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
      // Keep the API override last; route responses cannot replace configured headers.
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Referrer-Policy',
            value: 'no-referrer',
          },
        ],
      },
    ]
  },
}

export default nextConfig
