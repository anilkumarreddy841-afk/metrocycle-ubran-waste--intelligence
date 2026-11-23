export type UserRole = 'Administrator' | 'Waste Management Officer' | 'Collection Staff';

export type PageId =
  | 'login'
  | 'dashboard'
  | 'bins'
  | 'zones'
  | 'monitoring'
  | 'predictions'
  | 'risk'
  | 'planning'
  | 'vehicles'
  | 'routes'
  | 'map'
  | 'alerts'
  | 'assistant'
  | 'analytics'
  | 'users'
  | 'database'
  | 'settings';

export interface AuthUser {
  id: number;
  fullName: string;
  email: string;
  role: UserRole;
  createdAt?: string;
}

export interface ZoneItem {
  id: number;
  zone_name: string;
  population_density: number;
  area: number;
  description: string;
  bin_count?: number;
  avg_fill_level?: number;
  avg_risk_score?: number;
}

export interface WasteBinItem {
  id: number;
  bin_code: string;
  latitude: number;
  longitude: number;
  location: string;
  zone_id: number;
  zone_name: string;
  population_density: number;
  capacity: number;
  waste_type: string;
  current_fill_level: number;
  last_collection_date: string;
  status: 'Empty' | 'Normal' | 'Filling' | 'Nearly Full' | 'Overflowing';
  reading_source: 'manual' | 'simulated' | 'csv_import';
  created_at: string;
  predicted_fill_level: number | null;
  estimated_overflow_hours: number | null;
  fill_rate_per_hour: number | null;
  risk_score: number | null;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  model_name: string | null;
  confidence: string | null;
  mae: number | null;
  rmse: number | null;
  lr_mae: number | null;
  lr_rmse: number | null;
  rf_mae: number | null;
  rf_rmse: number | null;
  is_fallback: number | null;
  prediction_date: string | null;
  reading_count?: number;
}

export interface PriorityBinItem {
  binId: number;
  binCode: string;
  location: string;
  latitude: number;
  longitude: number;
  zoneId: number;
  zoneName: string;
  populationDensity: number;
  capacityLiters: number;
  currentFillLevel: number;
  estimatedWasteKg: number;
  lastCollectionDate: string;
  hoursSinceLastCollection: number;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  estimatedOverflowHours: number | null;
  priorityScore: number;
  urgencyRank: number;
  hasActiveAssignment: boolean;
}

export interface VehicleItem {
  id: number;
  vehicle_number: string;
  vehicle_type: string;
  capacity: number;
  current_load: number;
  availability_status: 'Available' | 'On Route' | 'Maintenance' | 'Unavailable';
  assigned_zone: number | null;
  assigned_zone_name: string | null;
  depot_lat: number;
  depot_lng: number;
  active_stops?: number;
  completed_trips?: number;
}

export interface CollectionPlanItem {
  id: number;
  vehicle_id: number;
  bin_id: number;
  priority: number;
  route_order: number;
  estimated_distance_km: number;
  scheduled_time: string;
  route_status: 'Scheduled' | 'In Progress' | 'Completed' | 'Delayed' | 'Cancelled';
  vehicle_number: string;
  vehicle_type: string;
  vehicle_capacity: number;
  vehicle_current_load: number;
  availability_status: string;
  bin_code: string;
  location: string;
  current_fill_level: number;
  bin_capacity: number;
  zone_name: string;
  risk_score: number;
  risk_level: string;
}

export interface AlertItem {
  id: number;
  bin_id: number | null;
  bin_code: string | null;
  location: string | null;
  alert_type: string;
  message: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  is_read: number;
  created_at: string;
}

export interface DashboardSummary {
  kpis: {
    totalBins: number;
    normalBins: number;
    highRiskBins: number;
    criticalBins: number;
    predictedOverflowToday: number;
    availableVehicles: number;
    collectionsCompleted: number;
    totalWasteCollectedKg: number;
    unreadAlerts: number;
  };
  riskDistribution: {
    LOW: number;
    MEDIUM: number;
    HIGH: number;
    CRITICAL: number;
  };
  topPriorityBins: PriorityBinItem[];
}
