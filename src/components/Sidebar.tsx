'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  Settings,
  User,
  LogOut,
  Menu,
  X,
  ChevronDown,
  CreditCard,
  ReceiptText,
  Shield,
  HelpCircle,
} from 'lucide-react';

interface SidebarProps {
  children: React.ReactNode;
}

export default function Sidebar({ children }: SidebarProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileDropdown, setProfileDropdown] = useState(false);
  const [billingOpen, setBillingOpen] = useState(true);

  const { user, role, logout } = useAuth() as {
    user: { email?: string } | null;
    role?: 'admin' | 'client' | 'staff' | string;
    logout: () => Promise<void>;
  };

  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const isActive = (href: string) =>
    href === '/' ? pathname === href : (pathname || '').startsWith(href);

  const Item = ({
    href,
    icon: Icon,
    children,
  }: {
    href: string;
    icon: any;
    children: React.ReactNode;
  }) => (
    <Link
      href={href}
      className={[
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
        isActive(href)
          ? 'bg-white text-black'
          : 'text-neutral-300 hover:text-white hover:bg-neutral-900',
      ].join(' ')}
      onClick={() => setSidebarOpen(false)}
    >
      <Icon className="w-5 h-5" />
      {children}
    </Link>
  );

  const SubItem = ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <Link
      href={href}
      className={[
        'block pl-9 pr-3 py-2 rounded-md text-sm transition-colors',
        isActive(href)
          ? 'bg-neutral-800 text-white'
          : 'text-neutral-300 hover:text-white hover:bg-neutral-900',
      ].join(' ')}
      onClick={() => setSidebarOpen(false)}
    >
      {children}
    </Link>
  );

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-black border-r border-neutral-800
          transform transition-transform duration-300 ease-in-out lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Brand */}
          <div className="flex items-center justify-between h-16 px-6 border-b border-neutral-800">
            <h1 className="font-bold text-xl">Dashboard</h1>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-neutral-400 hover:text-white"
              aria-label="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-6 space-y-1">
            <Item href="/dashboard" icon={LayoutDashboard}>Dashboard</Item>

            {/* Billing group (Invoices only) */}
            <button
              onClick={() => setBillingOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-neutral-300 hover:text-white hover:bg-neutral-900 transition-colors"
              aria-expanded={billingOpen}
              aria-controls="billing-group"
            >
              <span className="flex items-center gap-3">
                <CreditCard className="w-5 h-5" />
                Billing
              </span>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${billingOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {billingOpen && (
              <div id="billing-group" className="space-y-1">
                <SubItem href="/dashboard/invoices">
                  <span className="inline-flex items-center gap-2">
                    <ReceiptText className="w-4 h-4 opacity-70" />
                    Invoices
                  </span>
                </SubItem>
              </div>
            )}

            <Item href="/dashboard/settings" icon={Settings}>Settings</Item>

            {role === 'admin' && (
              <>
                <div className="pt-4 pb-1 px-3 text-xs uppercase tracking-wide text-neutral-500">
                  Admin
                </div>
                <Item href="/admin" icon={Shield}>Admin Overview</Item>
              </>
            )}

            <Item href="/dashboard/help" icon={HelpCircle}>Help & Support</Item>
          </nav>

          {/* Profile */}
          <div className="border-t border-neutral-800 p-4">
            <div className="relative">
              <button
                onClick={() => setProfileDropdown((v) => !v)}
                className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-left text-neutral-300 hover:text-white hover:bg-neutral-900 transition-colors"
              >
                <div className="w-8 h-8 bg-white text-black rounded-full flex items-center justify-center">
                  <User className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {user?.email?.split('@')[0] || 'User'}
                  </p>
                  <p className="text-xs text-neutral-400 truncate">{user?.email}</p>
                </div>
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${profileDropdown ? 'rotate-180' : ''}`}
                />
              </button>

              {profileDropdown && (
                <div className="absolute bottom-full left-0 right-0 mb-2 bg-black border border-neutral-800 rounded-lg shadow-lg py-1">
                  <button
                    onClick={() => {
                      setProfileDropdown(false);
                      router.push('/dashboard/settings');
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-900 transition-colors"
                  >
                    <Settings className="w-4 h-4" />
                    Account Settings
                  </button>
                  <button
                    onClick={() => {
                      setProfileDropdown(false);
                      handleLogout();
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-neutral-900 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="lg:pl-64">
        <div className="lg:hidden flex items-center justify-between h-16 px-4 bg-black border-b border-neutral-800">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-neutral-400 hover:text-white"
            aria-label="Open sidebar"
          >
            <Menu className="w-6 h-6" />
          </button>
          <h1 className="font-semibold">Dashboard</h1>
          <div className="w-6" />
        </div>
        <main className="min-h-screen">{children}</main>
      </div>
    </div>
  );
}
