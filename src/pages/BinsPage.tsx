import React, { useEffect, useState } from 'react';
import { Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { apiRequest } from '../api.ts';
import { BinStatusLabel, PageHeader, RiskLabel, SourceNotice } from '../components/StatusText.tsx';
import type { AuthUser, WasteBinItem, ZoneItem } from '../types.ts';

interface BinsPageProps {
  user: AuthUser;
  globalSearch: string;
  refreshTrigger: number;
  onDataChanged: () => void;
}

const WASTE_TYPES = ['Organic', 'Recyclable', 'General', 'Hazardous', 'E-Waste'];

export function BinsPage({ user, globalSearch, refreshTrigger, onDataChanged }: BinsPageProps) {
  const [bins, setBins] = useState<WasteBinItem[]>([]);
  const [zones, setZones] = useState<ZoneItem[]>([]);
  const [search, setSearch] = useState(globalSearch);
  const [zoneFilter, setZoneFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBin, setEditingBin] = useState<WasteBinItem | null>(null);
  const [form, setForm] = useState({
    binCode: '',
    location: '',
    latitude: '12.9716',
    longitude: '77.5946',
    zoneId: '',
    capacity: '660',
    wasteType: 'General',
    currentFillLevel: '25',
  });

  const canModify = user.role === 'Administrator' || user.role === 'Waste Management Officer';

  useEffect(() => {
    setSearch(globalSearch);
  }, [globalSearch]);

  const loadData = async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (zoneFilter) params.set('zone_id', zoneFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (riskFilter) params.set('risk_level', riskFilter);

      const [binsRes, zonesRes] = await Promise.all([
        apiRequest<{ bins: WasteBinItem[] }>(`/bins?${params.toString()}`),
        apiRequest<{ zones: ZoneItem[] }>('/zones'),
      ]);
      setBins(binsRes.bins);
      setZones(zonesRes.zones);
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Failed to load bins' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, zoneFilter, statusFilter, riskFilter, refreshTrigger]);

  const openCreateModal = () => {
    setEditingBin(null);
    setForm({
      binCode: `BIN-NEW-${Math.floor(100 + Math.random() * 899)}`,
      location: '',
      latitude: '12.9720',
      longitude: '77.5950',
      zoneId: zones[0] ? String(zones[0].id) : '',
      capacity: '660',
      wasteType: 'General',
      currentFillLevel: '15',
    });
    setModalOpen(true);
  };

  const openEditModal = (bin: WasteBinItem) => {
    setEditingBin(bin);
    setForm({
      binCode: bin.bin_code,
      location: bin.location,
      latitude: String(bin.latitude),
      longitude: String(bin.longitude),
      zoneId: String(bin.zone_id),
      capacity: String(bin.capacity),
      wasteType: bin.waste_type,
      currentFillLevel: String(bin.current_fill_level),
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      const payload = {
        binCode: form.binCode.trim(),
        location: form.location.trim(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        zoneId: Number(form.zoneId),
        capacity: Number(form.capacity),
        wasteType: form.wasteType,
        currentFillLevel: Number(form.currentFillLevel),
        readingSource: 'manual',
      };
      if (editingBin) {
        await apiRequest(`/bins/${editingBin.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        setNotice({ type: 'ok', text: `Updated bin ${payload.binCode} and refreshed ML predictions.` });
      } else {
        await apiRequest('/bins', { method: 'POST', body: JSON.stringify(payload) });
        setNotice({ type: 'ok', text: `Registered bin ${payload.binCode} in SQLite.` });
      }
      setModalOpen(false);
      await loadData();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  const handleDelete = async (bin: WasteBinItem) => {
    try {
      await apiRequest(`/bins/${bin.id}`, { method: 'DELETE' });
      setNotice({ type: 'ok', text: `Deleted bin ${bin.bin_code}.` });
      await loadData();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Delete failed' });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const res = await apiRequest<{ inserted: number; updated: number; skipped: number }>('/bins/import', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
      setNotice({
        type: 'ok',
        text: `Import complete: ${res.inserted} new bins, ${res.updated} updated readings, ${res.skipped} skipped.`,
      });
      await loadData();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Waste Bin Registry & Management"
        subtitle="Create, edit, search, and import municipal bins with GPS coordinates, capacity, waste streams, and reading provenance."
        actions={
          canModify && (
            <>
              <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap">
                <Upload className="w-4 h-4" />
                <span>Import CSV/Excel</span>
                <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
              </label>
              <button
                type="button"
                onClick={openCreateModal}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 text-white text-sm font-medium whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Add Waste Bin</span>
              </button>
            </>
          )
        }
      />

      {notice && (
        <div
          className={`p-3 rounded-md border text-sm ${
            notice.type === 'ok'
              ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
              : 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by Bin ID, location, type..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
        </div>
        <select
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
        >
          <option value="">All Zones</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.zone_name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
        >
          <option value="">All Bin Statuses</option>
          {['Empty', 'Normal', 'Filling', 'Nearly Full', 'Overflowing'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
        >
          <option value="">All Risk Levels</option>
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Bins Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40">
                <th className="py-3 px-3 text-left font-medium">Bin Code</th>
                <th className="py-3 px-3 text-left font-medium">Location &amp; GPS</th>
                <th className="py-3 px-3 text-left font-medium">Zone</th>
                <th className="py-3 px-3 text-left font-medium">Stream</th>
                <th className="py-3 px-3 text-right font-medium">Capacity</th>
                <th className="py-3 px-3 text-right font-medium">Fill</th>
                <th className="py-3 px-3 text-left font-medium">Status</th>
                <th className="py-3 px-3 text-left font-medium">Risk</th>
                <th className="py-3 px-3 text-left font-medium">Reading Source</th>
                {canModify && <th className="py-3 px-3 text-right font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    Loading waste bin registry...
                  </td>
                </tr>
              ) : bins.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-500">
                    No waste bins match the current filters.
                  </td>
                </tr>
              ) : (
                bins.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {b.bin_code}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="text-slate-900 dark:text-slate-100 font-medium">{b.location}</div>
                      <div className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {b.latitude.toFixed(4)}, {b.longitude.toFixed(4)}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-slate-700 dark:text-slate-300">{b.zone_name}</td>
                    <td className="py-2.5 px-3 text-xs text-slate-600 dark:text-slate-400">{b.waste_type}</td>
                    <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">{b.capacity} L</td>
                    <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold tabular-nums">
                      {b.current_fill_level}%
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <BinStatusLabel status={b.status} />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <RiskLabel level={b.risk_level} score={b.risk_score} />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <SourceNotice source={b.reading_source} />
                    </td>
                    {canModify && (
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEditModal(b)}
                          className="p-1.5 text-slate-500 hover:text-teal-700 dark:hover:text-teal-400"
                          title="Edit bin"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(b)}
                          className="p-1.5 text-slate-500 hover:text-red-600 dark:hover:text-red-400 ml-1"
                          title="Delete bin"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {editingBin ? `Edit Bin ${editingBin.bin_code}` : 'Register New Waste Bin'}
            </h2>
            <form onSubmit={handleSave} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Bin ID Code</label>
                  <input
                    required
                    value={form.binCode}
                    onChange={(e) => setForm({ ...form, binCode: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Assigned Zone</label>
                  <select
                    required
                    value={form.zoneId}
                    onChange={(e) => setForm({ ...form, zoneId: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.zone_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Street / Landmark Location</label>
                <input
                  required
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Latitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={form.latitude}
                    onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Longitude</label>
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={form.longitude}
                    onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Waste Type</label>
                  <select
                    value={form.wasteType}
                    onChange={(e) => setForm({ ...form, wasteType: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {WASTE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Capacity (L)</label>
                  <input
                    type="number"
                    min="10"
                    required
                    value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Fill Level (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    required
                    value={form.currentFillLevel}
                    onChange={(e) => setForm({ ...form, currentFillLevel: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm rounded-md bg-teal-700 hover:bg-teal-800 text-white font-medium"
                >
                  {editingBin ? 'Save Changes' : 'Register Bin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
