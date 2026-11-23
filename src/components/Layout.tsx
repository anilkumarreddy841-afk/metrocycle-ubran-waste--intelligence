import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  BrainCircuit,
  Database,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Map as MapIcon,
  MapPin,
  Menu,
  Moon,
  RefreshCw,
  Route,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  Trash2,
  Truck,
  Users,
  X,
} from 'lucide-react';
import type { AuthUser, PageId } from '../types.ts';

interface NavItem {
  id: PageId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
  roles?: AuthUser['role'][];
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Overview' },
  { id: 'bins', label: 'Bin Management', icon: Trash2, group: 'Waste Data' },
  { id: 'zones', label: 'Zone Management', icon: MapPin, group: 'Waste Data' },
  { id: 'monitoring', label: 'Fill Level Monitoring', icon: Activity, group: 'Waste Data' },
  { id: 'predictions', label: 'AI Prediction', icon: BrainCircuit, group: 'Intelligence' },
  { id: 'risk', label: 'Risk Assessment', icon: ShieldAlert, group: 'Intelligence' },
  { id: 'planning', label: 'Priority Collection Planning', icon: ListOrdered, group: 'Operations' },
  { id: 'vehicles', label: 'Vehicle Management', icon: Truck, group: 'Operations' },
  { id: 'routes', label: 'Route Optimization', icon: Route, group: 'Operations' },
  { id: 'map', label: 'Interactive Map', icon: MapIcon, group: 'Operations' },
  { id: 'alerts', label: 'Alerts and Notifications', icon: AlertTriangle, group: 'Monitoring' },
  { id: 'assistant', label: 'AI Assistant', icon: Bot, group: 'Monitoring' },
  { id: 'analytics', label: 'Analytics and Reports', icon: BarChart3, group: 'Monitoring' },
  { id: 'users', label: 'User Management', icon: Users, group: 'Administration' },
  { id: 'database', label: 'Database Management', icon: Database, group: 'Administration' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'Administration' },
];

interface LayoutProps {
  user: AuthUser;
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onLogout: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  unreadAlerts: number;
  globalSearch: string;
  onGlobalSearchChange: (val: string) => void;
  autoRefreshEnabled: boolean;
  onToggleAutoRefresh: () => void;
  secondsToRefresh: number;
  onManualRefresh: () => void;
  isRefreshing: boolean;
  children: React.ReactNode;
}

export function Layout({
  user,
  activePage,
  onNavigate,
  onLogout,
  darkMode,
  onToggleDarkMode,
  unreadAlerts,
  globalSearch,
  onGlobalSearchChange,
  autoRefreshEnabled,
  onToggleAutoRefresh,
  secondsToRefresh,
  onManualRefresh,
  isRefreshing,
  children,
}: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const groups = ['Overview', 'Waste Data', 'Intelligence', 'Operations', 'Monitoring', 'Administration'];
  const activeItem = NAV_ITEMS.find((n) => n.id === activePage);

  const handleNav = (id: PageId) => {
    onNavigate(id);
    setMobileOpen(false);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (globalSearch.trim() && activePage !== 'bins') {
      onNavigate('bins');
    }
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between px-5 h-16 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <button
          type="button"
          onClick={() => handleNav('dashboard')}
          className="text-left focus:outline-none"
        >
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            MetroCycle
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close navigation"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {groups.map((grp) => {
          const items = NAV_ITEMS.filter((i) => i.group === grp);
          return (
            <div key={grp}>
              <div className="px-3 mb-1.5 text-[11px] font-semibold tracking-wider text-slate-400 dark:text-slate-500">
                {grp}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = activePage === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleNav(item.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors text-left ${
                        active
                          ? 'bg-teal-700 text-white dark:bg-teal-600 font-medium'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Icon className="w-4 h-4 shrink-0 opacity-85" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.id === 'alerts' && unreadAlerts > 0 && (
                        <span
                          className={`font-mono text-xs tabular-nums ml-2 shrink-0 ${
                            active ? 'text-teal-100' : 'text-red-600 dark:text-red-400 font-semibold'
                          }`}
                        >
                          {unreadAlerts}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-200 dark:border-slate-800 shrink-0 space-y-2">
        <div className="px-2 py-1.5">
          <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
            {user.fullName}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {user.role}
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] h-full z-10">{sidebarContent}</aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 min-w-0">
              <span className="hidden sm:inline whitespace-nowrap">Operations</span>
              <span className="hidden sm:inline" aria-hidden="true">/</span>
              <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                {activeItem?.label || 'Dashboard'}
              </span>
            </div>
          </div>

          <form onSubmit={handleSearchSubmit} className="hidden md:flex items-center flex-1 max-w-sm">
            <div className="relative w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={globalSearch}
                onChange={(e) => onGlobalSearchChange(e.target.value)}
                placeholder="Search bins, zones, or locations..."
                className="w-full pl-9 pr-3 py-1.5 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </form>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleAutoRefresh}
              title="Toggle automatic dashboard refresh"
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <span>{autoRefreshEnabled ? `Auto ${secondsToRefresh}s` : 'Auto Paused'}</span>
            </button>

            <button
              type="button"
              onClick={onManualRefresh}
              title="Refresh data now"
              className="p-2 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Refresh data"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={() => handleNav('alerts')}
              title="View Alerts & Notifications"
              className="relative p-2 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Alerts"
            >
              <AlertTriangle className="w-4 h-4" />
              {unreadAlerts > 0 && (
                <span className="ml-1 font-mono text-xs font-semibold text-red-600 dark:text-red-400 tabular-nums">
                  {unreadAlerts}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onToggleDarkMode}
              title="Toggle light or dark theme"
              className="p-2 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle theme"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
