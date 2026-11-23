import React, { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../api.ts';
import { PageHeader } from '../components/StatusText.tsx';
import type { AuthUser, VehicleItem, ZoneItem } from '../types.ts';

interface VehiclesPageProps {
  user: AuthUser;
  refreshTrigger: number;
  onDataChanged: () => void;
}

export function VehiclesPage({ user, refreshTrigger, onDataChanged }: VehiclesPageProps) {
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [zones, setZones] = useState<ZoneItem[]>([]);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VehicleItem | null>(null);
  const [form, setForm] = useState({
    vehicleNumber: '',
    vehicleType: 'Heavy Compactor Truck',
    capacity: '4500',
    currentLoad: '0',
    availabilityStatus: 'Available',
    assignedZone: '',
  });

  const canModify = user.role === 'Administrator' || user.role === 'Waste Management Officer';

  const loadFleet = async () => {
    const [vRes, zRes] = await Promise.all([
      apiRequest<{ vehicles: VehicleItem[] }>('/vehicles'),
      apiRequest<{ zones: ZoneItem[] }>('/zones'),
    ]);
    setVehicles(vRes.vehicles);
    setZones(zRes.zones);
  };

  useEffect(() => {
    loadFleet().catch(() => {});
  }, [refreshTrigger]);

  const openCreate = () => {
    setEditing(null);
    setForm({
      vehicleNumber: `MC-TRK-0${vehicles.length + 1}`,
      vehicleType: 'Heavy Compactor Truck',
      capacity: '4500',
      currentLoad: '0',
      availabilityStatus: 'Available',
      assignedZone: zones[0] ? String(zones[0].id) : '',
    });
    setModalOpen(true);
  };

  const openEdit = (v: VehicleItem) => {
    setEditing(v);
    setForm({
      vehicleNumber: v.vehicle_number,
      vehicleType: v.vehicle_type,
      capacity: String(v.capacity),
      currentLoad: String(v.current_load),
      availabilityStatus: v.availability_status,
      assignedZone: v.assigned_zone ? String(v.assigned_zone) : '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      const payload = {
        vehicleNumber: form.vehicleNumber.trim(),
        vehicleType: form.vehicleType.trim(),
        capacity: Number(form.capacity),
        currentLoad: Number(form.currentLoad),
        availabilityStatus: form.availabilityStatus,
        assignedZone: form.assignedZone ? Number(form.assignedZone) : null,
      };
      if (editing) {
        await apiRequest(`/vehicles/${editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        setNotice({ type: 'ok', text: `Updated vehicle ${payload.vehicleNumber}.` });
      } else {
        await apiRequest('/vehicles', { method: 'POST', body: JSON.stringify(payload) });
        setNotice({ type: 'ok', text: `Registered fleet unit ${payload.vehicleNumber}.` });
      }
      setModalOpen(false);
      await loadFleet();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    }
  };

  const handleDelete = async (v: VehicleItem) => {
    setNotice(null);
    try {
      await apiRequest(`/vehicles/${v.id}`, { method: 'DELETE' });
      setNotice({ type: 'ok', text: `Removed vehicle ${v.vehicle_number}.` });
      await loadFleet();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Delete failed' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Collection Fleet & Vehicle Management"
        subtitle="Track truck capacity, current payload, zone assignments, and operational availability."
        actions={
          canModify && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>Add Vehicle</span>
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
        {vehicles.map((v) => {
          const pct = Math.min(100, Math.round((v.current_load / Math.max(1, v.capacity)) * 100));
          const statusColor =
            v.availability_status === 'Available'
              ? 'text-emerald-700 dark:text-emerald-400'
              : v.availability_status === 'On Route'
                ? 'text-teal-700 dark:text-teal-400'
                : 'text-red-700 dark:text-red-400';
          return (
            <div
              key={v.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                    {v.vehicle_number}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{v.vehicle_type}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${statusColor}`}>{v.availability_status}</span>
                  {canModify && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(v)}
                        className="p-1 text-slate-400 hover:text-teal-700 dark:hover:text-teal-400"
                        title="Edit vehicle"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(v)}
                        className="p-1 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                        title="Delete vehicle"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-500 dark:text-slate-400">Payload Utilization</span>
                  <span className="font-mono tabular-nums">
                    {v.current_load} / {v.capacity} kg ({pct}%)
                  </span>
                </div>
                <div className="w-full h-2 rounded bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full ${pct >= 85 ? 'bg-red-600' : 'bg-teal-600'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Zone</div>
                  <div className="font-medium truncate">{v.assigned_zone_name || 'City-Wide'}</div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Active Stops</div>
                  <div className="font-mono font-semibold tabular-nums">{v.active_stops ?? 0}</div>
                </div>
                <div>
                  <div className="text-slate-500 dark:text-slate-400">Trips Logged</div>
                  <div className="font-mono font-semibold tabular-nums">{v.completed_trips ?? 0}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold">
              {editing ? `Edit ${editing.vehicle_number}` : 'Register Collection Vehicle'}
            </h2>
            <form onSubmit={handleSave} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Vehicle Number</label>
                  <input
                    required
                    value={form.vehicleNumber}
                    onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Vehicle Type</label>
                  <input
                    required
                    value={form.vehicleType}
                    onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Capacity (kg)</label>
                  <input
                    type="number"
                    min="100"
                    required
                    value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Current Load (kg)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={form.currentLoad}
                    onChange={(e) => setForm({ ...form, currentLoad: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Availability</label>
                  <select
                    value={form.availabilityStatus}
                    onChange={(e) => setForm({ ...form, availabilityStatus: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    {['Available', 'On Route', 'Maintenance', 'Unavailable'].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Assigned Zone</label>
                  <select
                    value={form.assignedZone}
                    onChange={(e) => setForm({ ...form, assignedZone: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                  >
                    <option value="">City-Wide Pool</option>
                    {zones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.zone_name}
                      </option>
                    ))}
                  </select>
                </div>
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
                  Save Vehicle
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
