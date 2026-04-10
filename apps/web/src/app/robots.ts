import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard/', '/onboarding/', '/api/'],
    },
    sitemap: 'https://thecodesheriff.com/sitemap.xml',
  };
}
