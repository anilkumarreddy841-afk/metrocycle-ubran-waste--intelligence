/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { apiRequest, getStoredToken, setStoredToken } from './api.ts';
import { Layout } from './components/Layout.tsx';
import { AlertsPage } from './pages/AlertsPage.tsx';
import { AnalyticsReportsPage } from './pages/AnalyticsReportsPage.tsx';
import { AssistantPage } from './pages/AssistantPage.tsx';
import { BinsPage } from './pages/BinsPage.tsx';
import { CollectionPlanningPage } from './pages/CollectionPlanningPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { DatabasePage } from './pages/DatabasePage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { MapPage } from './pages/MapPage.tsx';
import { MonitoringPage } from './pages/MonitoringPage.tsx';
import { PredictionsPage } from './pages/PredictionsPage.tsx';
import { RiskPage } from './pages/RiskPage.tsx';
import { RouteOptimizationPage } from './pages/RouteOptimizationPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { UsersPage } from './pages/UsersPage.tsx';
import { VehiclesPage } from './pages/VehiclesPage.tsx';
import { ZonesPage } from './pages/ZonesPage.tsx';
import type { AuthUser, DashboardSummary, PageId } from './types.ts';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mc_theme') === 'dark';
    } catch {
      return false;
    }
  });
  const [globalSearch, setGlobalSearch] = useState('');
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState(30);
  const [secondsToRefresh, setSecondsToRefresh] = useState(30);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem('mc_theme', darkMode ? 'dark' : 'light');
    } catch {
      // ignore
    }
  }, [darkMode]);

  // Verify existing session on boot
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setCheckingAuth(false);
      return;
    }
    apiRequest<AuthUser>('/auth/me')
      .then((u) => setUser(u))
      .catch(() => {
        setStoredToken(null);
        setUser(null);
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  const refreshMetadata = useCallback(async () => {
    if (!user) return;
    setIsRefreshing(true);
    try {
      const [dash, settingsRes] = await Promise.all([
        apiRequest<DashboardSummary>('/dashboard'),
        apiRequest<{ settings: Record<string, string> }>('/settings'),
      ]);
      setUnreadAlerts(dash.kpis.unreadAlerts);
      const sec = Math.max(10, Number(settingsRes.settings.refresh_interval_seconds || 30));
      setRefreshIntervalSec(sec);
    } catch {
      // ignore transient poll error
    } finally {
      setIsRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      refreshMetadata();
    }
  }, [user, refreshTrigger, refreshMetadata]);

  // Configurable auto-refresh timer
  useEffect(() => {
    if (!user || !autoRefreshEnabled) return;
    setSecondsToRefresh(refreshIntervalSec);
    const timer = window.setInterval(() => {
      setSecondsToRefresh((prev) => {
        if (prev <= 1) {
          setRefreshTrigger((t) => t + 1);
          return refreshIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [user, autoRefreshEnabled, refreshIntervalSec]);

  const handleManualRefresh = () => {
    setSecondsToRefresh(refreshIntervalSec);
    setRefreshTrigger((t) => t + 1);
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setStoredToken(null);
    setUser(null);
    setActivePage('dashboard');
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400 text-sm">
        Initializing MetroCycle Urban Waste Intelligence...
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onLoginSuccess={(u) => {
          setUser(u);
          setActivePage('dashboard');
        }}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
      />
    );
  }

  const triggerSync = () => setRefreshTrigger((t) => t + 1);

  return (
    <Layout
      user={user}
      activePage={activePage}
      onNavigate={setActivePage}
      onLogout={handleLogout}
      darkMode={darkMode}
      onToggleDarkMode={() => setDarkMode((d) => !d)}
      unreadAlerts={unreadAlerts}
      globalSearch={globalSearch}
      onGlobalSearchChange={setGlobalSearch}
      autoRefreshEnabled={autoRefreshEnabled}
      onToggleAutoRefresh={() => setAutoRefreshEnabled((e) => !e)}
      secondsToRefresh={secondsToRefresh}
      onManualRefresh={handleManualRefresh}
      isRefreshing={isRefreshing}
    >
      {activePage === 'dashboard' && (
        <DashboardPage
          darkMode={darkMode}
          refreshTrigger={refreshTrigger}
          onNavigate={setActivePage}
        />
      )}
      {activePage === 'bins' && (
        <BinsPage
          user={user}
          globalSearch={globalSearch}
          refreshTrigger={refreshTrigger}
          onDataChanged={triggerSync}
        />
      )}
      {activePage === 'zones' && (
        <ZonesPage
          user={user}
          refreshTrigger={refreshTrigger}
          onDataChanged={triggerSync}
        />
      )}
      {activePage === 'monitoring' && (
        <MonitoringPage
          darkMode={darkMode}
          refreshTrigger={refreshTrigger}
          onDataChanged={triggerSync}
        />
      )}
      {activePage === 'predictions' && (
        <PredictionsPage
          darkMode={darkMode}
          refreshTrigger={refreshTrigger}
          onDataChanged={triggerSync}
        />
      )}
      {activePage === 'risk' && <RiskPage refreshTrigger={refreshTrigger} />}
      {activePage === 'planning' && (
        <CollectionPlanningPage
          user={user}
          refreshTrigger={refreshTrigger}
          onDataChanged={triggerSync}
        />
      )}
      {activePage === 'vehicles' && (
        <VehiclesPage
          user={user}
          refreshTrigger={refreshTrigger}
          onDataChanged={triggerSync}
        />
      )}
      {activePage === 'routes' && <RouteOptimizationPage refreshTrigger={refreshTrigger} />}
      {activePage === 'map' && <MapPage refreshTrigger={refreshTrigger} />}
      {activePage === 'alerts' && (
        <AlertsPage refreshTrigger={refreshTrigger} onDataChanged={triggerSync} />
      )}
      {activePage === 'assistant' && <AssistantPage />}
      {activePage === 'analytics' && (
        <AnalyticsReportsPage darkMode={darkMode} refreshTrigger={refreshTrigger} />
      )}
      {activePage === 'users' && (
        <UsersPage user={user} onProfileUpdated={(u) => setUser(u)} />
      )}
      {activePage === 'database' && (
        <DatabasePage user={user} onDataChanged={triggerSync} />
      )}
      {activePage === 'settings' && (
        <SettingsPage
          user={user}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
          onSettingsSaved={(sec) => {
            setRefreshIntervalSec(sec);
            setSecondsToRefresh(sec);
          }}
        />
      )}
    </Layout>
  );
}
