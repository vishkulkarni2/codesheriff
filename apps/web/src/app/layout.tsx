/**
 * Root layout — applies Clerk auth provider, global styles, and
 * the shared sidebar shell for authenticated routes.
 */

import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'CodeSheriff',
    template: '%s | CodeSheriff',
  },
  description: 'AI-generated code security & quality gate',
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
