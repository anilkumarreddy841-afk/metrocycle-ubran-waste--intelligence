import React, { useEffect, useState } from 'react';
import { CheckCircle2, Play, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../api.ts';
import { PageHeader, RiskLabel } from '../components/StatusText.tsx';
import type { AuthUser, CollectionPlanItem, PriorityBinItem, VehicleItem } from '../types.ts';

interface CollectionPlanningPageProps {
  user: AuthUser;
  refreshTrigger: number;
  onDataChanged: () => void;
}

export function CollectionPlanningPage({
  user,
  refreshTrigger,
  onDataChanged,
}: CollectionPlanningPageProps) {
  const [queue, setQueue] = useState<PriorityBinItem[]>([]);
  const [plans, setPlans] = useState<CollectionPlanItem[]>([]);
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [assignModal, setAssignModal] = useState(false);
  const [assignBinId, setAssignBinId] = useState('');
  const [assignVehicleId, setAssignVehicleId] = useState('');

  const canPlan = user.role === 'Administrator' || user.role === 'Waste Management Officer';

  const loadAll = async () => {
    const [qRes, pRes, vRes] = await Promise.all([
      apiRequest<{ queue: PriorityBinItem[] }>('/priority-queue'),
      apiRequest<{ plans: CollectionPlanItem[] }>('/collection-plans'),
      apiRequest<{ vehicles: VehicleItem[] }>('/vehicles'),
    ]);
    setQueue(qRes.queue);
    setPlans(pRes.plans);
    setVehicles(vRes.vehicles);
  };

  useEffect(() => {
    loadAll().catch(() => {});
  }, [refreshTrigger]);

  const handleGenerateSchedule = async () => {
    setNotice(null);
    try {
      const res = await apiRequest<{
        createdPlans: number;
        skippedAlreadyAssigned: number;
        unassignedDueToCapacityOrFleet: number;
      }>('/collection-plans/generate', {
        method: 'POST',
        body: JSON.stringify({ minRiskScore: 31 }),
      });
      setNotice({
        type: 'ok',
        text: `Priority Queue scheduled ${res.createdPlans} new stop(s) across available vehicles (${res.skippedAlreadyAssigned} already assigned, ${res.unassignedDueToCapacityOrFleet} held due to capacity/fleet limits).`,
      });
      await loadAll();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Schedule generation failed' });
    }
  };

  const handleManualAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    try {
      await apiRequest('/collection-plans', {
        method: 'POST',
        body: JSON.stringify({
          binId: Number(assignBinId),
          vehicleId: Number(assignVehicleId),
        }),
      });
      setAssignModal(false);
      setNotice({ type: 'ok', text: 'Manual collection assignment verified & created.' });
      await loadAll();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Assignment failed' });
    }
  };

  const handleUpdateStatus = async (planId: number, routeStatus: string) => {
    setNotice(null);
    try {
      await apiRequest(`/collection-plans/${planId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ routeStatus }),
      });
      setNotice({
        type: 'ok',
        text:
          routeStatus === 'Completed'
            ? 'Marked collected: bin emptied (4%), collection record saved, vehicle load updated, and risk recalculated.'
            : `Updated collection status to ${routeStatus}.`,
      });
      await loadAll();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Update failed' });
    }
  };

  const handleDeletePlan = async (planId: number) => {
    try {
      await apiRequest(`/collection-plans/${planId}`, { method: 'DELETE' });
      await loadAll();
      onDataChanged();
    } catch (err) {
      setNotice({ type: 'err', text: err instanceof Error ? err.message : 'Remove failed' });
    }
  };

  const availableVehicles = vehicles.filter((v) => v.availability_status === 'Available');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Priority-Based Collection Planning"
        subtitle="Min-Heap priority queue ranks bins by risk score, population density, overflow horizon, and collection age while enforcing vehicle capacity and availability."
        actions={
          canPlan && (
            <>
              <button
                type="button"
                onClick={() => {
                  const unassigned = queue.find((b) => !b.hasActiveAssignment);
                  setAssignBinId(unassigned ? String(unassigned.binId) : String(queue[0]?.binId || ''));
                  setAssignVehicleId(availableVehicles[0] ? String(availableVehicles[0].id) : '');
                  setAssignModal(true);
                }}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Manual Assign</span>
              </button>
              <button
                type="button"
                onClick={handleGenerateSchedule}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium whitespace-nowrap"
              >
                <Play className="w-4 h-4" />
                <span>Generate Priority Schedule</span>
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

      {/* Active Collection Plans */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Scheduled &amp; Active Vehicle Collection Plans</h2>
          <span className="text-xs font-mono text-slate-500">{plans.length} plan item(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40">
                <th className="py-2.5 px-3 text-left font-medium">Vehicle</th>
                <th className="py-2.5 px-3 text-right font-medium">Stop #</th>
                <th className="py-2.5 px-3 text-left font-medium">Bin &amp; Zone</th>
                <th className="py-2.5 px-3 text-right font-medium">Priority</th>
                <th className="py-2.5 px-3 text-left font-medium">Risk</th>
                <th className="py-2.5 px-3 text-left font-medium">Scheduled</th>
                <th className="py-2.5 px-3 text-left font-medium">Status</th>
                <th className="py-2.5 px-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {plans.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-500">
                    No active collection plans. Click &ldquo;Generate Priority Schedule&rdquo; to dispatch.
                  </td>
                </tr>
              ) : (
                plans.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3">
                      <div className="font-mono text-xs font-semibold">{p.vehicle_number}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{p.vehicle_type}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums">
                      #{p.route_order}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-mono text-xs font-semibold">{p.bin_code}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {p.location} · {p.zone_name} ({p.current_fill_level}%)
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold tabular-nums">
                      {p.priority}
                    </td>
                    <td className="py-2.5 px-3">
                      <RiskLabel level={p.risk_level} score={p.risk_score} />
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-slate-500 whitespace-nowrap">
                      {new Date(p.scheduled_time).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-3">
                      <select
                        value={p.route_status}
                        onChange={(e) => handleUpdateStatus(p.id, e.target.value)}
                        className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        {['Scheduled', 'In Progress', 'Completed', 'Delayed', 'Cancelled'].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      {p.route_status !== 'Completed' && (
                        <button
                          type="button"
                          onClick={() => handleUpdateStatus(p.id, 'Completed')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium"
                          title="Mark bin as collected"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Collect</span>
                        </button>
                      )}
                      {canPlan && (
                        <button
                          type="button"
                          onClick={() => handleDeletePlan(p.id)}
                          className="p-1 text-slate-400 hover:text-red-600 ml-2"
                          title="Remove plan"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full Priority Queue Ranking */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-semibold">Heap Priority Queue Ranking (Highest to Lowest Urgency)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/40">
                <th className="py-2.5 px-3 text-left font-medium">Urgency</th>
                <th className="py-2.5 px-3 text-left font-medium">Bin</th>
                <th className="py-2.5 px-3 text-left font-medium">Zone</th>
                <th className="py-2.5 px-3 text-right font-medium">Fill %</th>
                <th className="py-2.5 px-3 text-right font-medium">Est. Waste</th>
                <th className="py-2.5 px-3 text-right font-medium">Overflow ETA</th>
                <th className="py-2.5 px-3 text-left font-medium">Risk</th>
                <th className="py-2.5 px-3 text-right font-medium">Priority Score</th>
                <th className="py-2.5 px-3 text-left font-medium">Dispatch State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {queue.map((b) => (
                <tr key={b.binId} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2 px-3 font-mono text-xs font-semibold tabular-nums">
                    #{b.urgencyRank}
                  </td>
                  <td className="py-2 px-3">
                    <div className="font-mono text-xs font-semibold">{b.binCode}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{b.location}</div>
                  </td>
                  <td className="py-2 px-3 text-xs">{b.zoneName}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs tabular-nums">
                    {b.currentFillLevel}%
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs tabular-nums">
                    {b.estimatedWasteKg} kg
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs tabular-nums">
                    {b.estimatedOverflowHours !== null ? `${b.estimatedOverflowHours}h` : 'Stable'}
                  </td>
                  <td className="py-2 px-3">
                    <RiskLabel level={b.riskLevel} score={b.riskScore} />
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs font-semibold tabular-nums">
                    {b.priorityScore}
                  </td>
                  <td className="py-2 px-3 text-xs">
                    {b.hasActiveAssignment ? (
                      <span className="text-teal-700 dark:text-teal-400 font-medium">Active Plan</span>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">Unassigned</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Assignment Modal */}
      {assignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold">Manual Priority Assignment</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Validates vehicle availability, remaining capacity, and duplicate active assignments.
            </p>
            <form onSubmit={handleManualAssign} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Target Bin</label>
                <select
                  required
                  value={assignBinId}
                  onChange={(e) => setAssignBinId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  {queue.map((b) => (
                    <option key={b.binId} value={b.binId}>
                      #{b.urgencyRank} {b.binCode} ({b.estimatedWasteKg} kg · {b.riskLevel})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Available Vehicle</label>
                <select
                  required
                  value={assignVehicleId}
                  onChange={(e) => setAssignVehicleId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.vehicle_number} ({v.availability_status} · {v.capacity - v.current_load} kg free)
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setAssignModal(false)}
                  className="px-4 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm rounded-md bg-teal-700 hover:bg-teal-800 text-white font-medium"
                >
                  Assign Stop
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
