/**
 * Root layout — applies Clerk auth provider, global styles, and
 * the shared sidebar shell for authenticated routes.
 */

import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
  },
  title: {
    default: 'CodeSheriff -- AI Code Review for Security | #1 on Martian Benchmark',
    template: '%s | CodeSheriff',
  },
  description:
    'Automated security review for every PR. Catches SQL injection, XSS, hardcoded secrets, auth bugs, and more across 6 languages. Free to start.',
  metadataBase: new URL('https://thecodesheriff.com'),
  openGraph: {
    type: 'website',
    siteName: 'CodeSheriff',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className="min-h-screen bg-background font-sans antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
