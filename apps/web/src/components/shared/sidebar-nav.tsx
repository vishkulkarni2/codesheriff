'use client';

/**
 * SidebarNav — client component so usePathname() can highlight the active route.
 * Imported by the dashboard layout (server component).
 */

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  GitBranch,
  BookOpen,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/repos',     label: 'Repositories', icon: GitBranch },
  { href: '/rules',     label: 'Rules',         icon: BookOpen },
  { href: '/settings',  label: 'Settings',      icon: Settings },
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-1 p-2">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        // A route is "active" if the pathname starts with its href.
        // Dashboard is an exact match only to avoid matching every route.
        const isActive =
          href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
