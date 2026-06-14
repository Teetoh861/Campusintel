/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
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
}

export default nextConfig
