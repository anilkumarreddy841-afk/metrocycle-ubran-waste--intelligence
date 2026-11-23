import React, { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../api.ts';
import { PageHeader } from '../components/StatusText.tsx';
import type { AuthUser, ZoneItem } from '../types.ts';

interface ZonesPageProps {
  user: AuthUser;
  refreshTrigger: number;
  onDataChanged: () => void;
}

export function ZonesPage({ user, refreshTrigger, onDataChanged }: ZonesPageProps) {
  const [zones, setZones] = useState<ZoneItem[]>([]);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ZoneItem | null>(null);
  const [form, setForm] = useState({
    zoneName: '',
    populationDensity: '10000',
    area: '5.0',
    description: '',
  });

  const canModify = user.role === 'Administrator' || user.role === 'Waste Management Officer';

  const loadZones = async () => {
    const res = await apiRequest<{ zones: ZoneItem[] }>('/zones');
    setZones(res.zones);
  };

  useEffect(() => {
    loadZones().catch(() => {});
  }, [refreshTrigger]);

  const openCreate = () => {
    setEditing(null);
    setForm({ zoneName: '', populationDensity: '10000', area: '5.0', description: '' });
    setModalOpen(true);
  };

  const openEdit = (z: ZoneItem) => {
    setEditing(z);
    setForm({
      zoneName: z.zone_name,
      populationDensity: String(z.population_density),
      area: String(z.area),
      description: z.description,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      const payload = {
        zoneName: form.zoneName.trim(),
        populationDensity: Number(form.populationDensity),
        area: Number(form.area),
        description: form.description.trim(),
      };
      if (editing) {
        await apiRequest(`/zones/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        setNotice({ type: 'ok', text: `Updated zone ${payload.zoneName}.` });
      } else {
        await apiRequest('/zones', { method: 'POST', body: JSON.stringify(payload) });
        setNotice({ type: 'ok', text: `Created zone ${payload.zoneName}.` });
      }
      setModalOpen(false);
      await loadZones();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  const handleDelete = async (z: ZoneItem) => {
    setNotice(null);
    try {
      await apiRequest(`/zones/${z.id}`, { method: 'DELETE' });
      setNotice({ type: 'ok', text: `Deleted zone ${z.zone_name}.` });
      await loadZones();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Delete failed' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Municipal Zone Management"
        subtitle="Manage urban zones, population density weights used in overflow risk scoring, and service coverage areas."
        actions={
          canModify && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Zone</span>
            </button>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {zones.map((z) => (
          <div
            key={z.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 flex flex-col justify-between space-y-4"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {z.zone_name}
                </h2>
                {canModify && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(z)}
                      className="p-1 text-slate-400 hover:text-teal-700 dark:hover:text-teal-400"
                      title="Edit zone"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(z)}
                      className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                      title="Delete zone"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {z.description || 'No description provided.'}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div>
                <div className="text-slate-500 dark:text-slate-400">Population Density</div>
                <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {z.population_density.toLocaleString()} /km²
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Area</div>
                <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {z.area} km²
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Registered Bins</div>
                <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {z.bin_count ?? 0}
                </div>
              </div>
              <div>
                <div className="text-slate-500 dark:text-slate-400">Avg Fill / Risk</div>
                <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {z.avg_fill_level ?? 0}% · {z.avg_risk_score ?? 0}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold">
              {editing ? `Edit ${editing.zone_name}` : 'Create Municipal Zone'}
            </h2>
            <form onSubmit={handleSave} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Zone Name</label>
                <input
                  required
                  value={form.zoneName}
                  onChange={(e) => setForm({ ...form, zoneName: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Density (/km²)</label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={form.populationDensity}
                    onChange={(e) => setForm({ ...form, populationDensity: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Area (km²)</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    required
                    value={form.area}
                    onChange={(e) => setForm({ ...form, area: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm rounded-md bg-teal-700 hover:bg-teal-800 text-white font-medium"
                >
                  Save Zone
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
