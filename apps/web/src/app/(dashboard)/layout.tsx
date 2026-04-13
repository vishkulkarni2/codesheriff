/**
 * Authenticated dashboard shell layout.
 * All routes under (dashboard)/* are protected by Clerk via middleware.ts.
 * SidebarNav is extracted as a client component for usePathname() active-route highlighting.
 */

import { UserButton } from '@clerk/nextjs';
import { LogoIcon } from '@/components/shared/logo';
import { SidebarNav } from '@/components/shared/sidebar-nav';
import { SupportChat } from '@/components/shared/support-chat';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col border-r bg-card">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
          <LogoIcon size={20} className="text-primary" />
          CodeSheriff
        </div>

        {/* Nav — client component for active-route highlighting */}
        <SidebarNav />

        {/* User */}
        <div className="flex items-center gap-2 border-t p-3">
          <UserButton afterSignOutUrl="/" />
          <span className="text-sm text-muted-foreground">Account</span>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-y-auto">
        {children}
      </main>

      {/* Floating support chat widget */}
      <SupportChat />
    </div>
  );
}
