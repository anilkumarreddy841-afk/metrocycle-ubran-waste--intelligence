import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { WasteBinItem } from '../types.ts';

export interface RouteOverlay {
  vehicleId: number;
  vehicleNumber: string;
  color: string;
  coordinates: [number, number][];
  depot?: { lat: number; lng: number };
  orderedStops?: {
    binId: number;
    binCode: string;
    latitude: number;
    longitude: number;
    routeOrder: number;
    location: string;
    riskLevel: string;
  }[];
}

interface LeafletMapProps {
  bins: WasteBinItem[];
  routes?: RouteOverlay[];
  height?: string;
  highlightCritical?: boolean;
  onSelectBin?: (bin: WasteBinItem) => void;
}

const RISK_COLORS: Record<string, string> = {
  CRITICAL: '#dc2626',
  HIGH: '#ea580c',
  MEDIUM: '#d97706',
  LOW: '#16a34a',
};

export function LeafletMap({
  bins,
  routes = [],
  height = '440px',
  highlightCritical = true,
  onSelectBin,
}: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: [12.9716, 77.5946],
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const boundsPoints: [number, number][] = [];

    for (const bin of bins) {
      const risk = bin.risk_level || 'LOW';
      const color = RISK_COLORS[risk] || RISK_COLORS.LOW;
      const isCrit = risk === 'CRITICAL';
      boundsPoints.push([bin.latitude, bin.longitude]);

      if (highlightCritical && isCrit) {
        L.circleMarker([bin.latitude, bin.longitude], {
          radius: 15,
          color: '#dc2626',
          weight: 2,
          opacity: 0.55,
          fillColor: '#dc2626',
          fillOpacity: 0.14,
          interactive: false,
        }).addTo(group);
      }

      const marker = L.circleMarker([bin.latitude, bin.longitude], {
        radius: isCrit ? 9 : 7,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 0.92,
      });

      const overflowText =
        bin.estimated_overflow_hours !== null && bin.estimated_overflow_hours !== undefined
          ? `${Number(bin.estimated_overflow_hours).toFixed(1)}h`
          : 'Stable';

      const popupHtml = `
        <div style="min-width:210px;font-family:Public Sans,sans-serif;font-size:12px;line-height:1.45;">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px;">${bin.bin_code} · ${bin.location}</div>
          <div style="color:#64748b;margin-bottom:6px;">${bin.zone_name} · ${bin.waste_type}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <div>Fill: <strong>${bin.current_fill_level}%</strong></div>
            <div>Risk: <strong style="color:${color}">${risk} (${bin.risk_score ?? '-'})</strong></div>
            <div>Pred: <strong>${bin.predicted_fill_level ?? '-'}%</strong></div>
            <div>Overflow: <strong>${overflowText}</strong></div>
          </div>
          <div style="margin-top:6px;font-size:11px;color:#64748b;">Source: ${bin.reading_source}</div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      if (onSelectBin) {
        marker.on('click', () => onSelectBin(bin));
      }
      marker.addTo(group);
    }

    for (const route of routes) {
      if (route.coordinates.length >= 2) {
        L.polyline(route.coordinates, {
          color: route.color,
          weight: 4,
          opacity: 0.85,
          dashArray: '8 4',
        }).addTo(group);

        for (const pt of route.coordinates) {
          boundsPoints.push(pt);
        }
      }

      if (route.depot) {
        const depotIcon = L.divIcon({
          className: '',
          html: `<div style="background:#0f172a;color:#fff;border:2px solid #fff;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.35);">DEPOT ${route.vehicleNumber}</div>`,
          iconSize: [90, 22],
          iconAnchor: [45, 11],
        });
        L.marker([route.depot.lat, route.depot.lng], { icon: depotIcon }).addTo(group);
      }

      if (route.orderedStops) {
        for (const stop of route.orderedStops) {
          const numIcon = L.divIcon({
            className: '',
            html: `<div style="background:${route.color};color:#fff;border:2px solid #fff;width:22px;height:22px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,0.35);">${stop.routeOrder}</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });
          L.marker([stop.latitude, stop.longitude], { icon: numIcon })
            .bindPopup(
              `<div style="font-size:12px;"><strong>Stop #${stop.routeOrder}: ${stop.binCode}</strong><br/>${stop.location}<br/>Vehicle: ${route.vehicleNumber}</div>`
            )
            .addTo(group);
        }
      }
    }

    if (boundsPoints.length > 0) {
      const bounds = L.latLngBounds(boundsPoints);
      map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
    }
  }, [bins, routes, highlightCritical, onSelectBin]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-100 dark:bg-slate-900"
    />
  );
}
