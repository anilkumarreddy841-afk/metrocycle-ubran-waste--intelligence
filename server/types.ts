export type UserRole = 'Administrator' | 'Waste Management Officer' | 'Collection Staff';

export type BinStatus = 'Empty' | 'Normal' | 'Filling' | 'Nearly Full' | 'Overflowing';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ReadingSource = 'manual' | 'simulated' | 'csv_import';
export type VehicleStatus = 'Available' | 'On Route' | 'Maintenance' | 'Unavailable';
export type RouteStatus = 'Scheduled' | 'In Progress' | 'Completed' | 'Delayed' | 'Cancelled';

export interface UserRecord {
  id: number;
  full_name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
}

export interface ZoneRecord {
  id: number;
  zone_name: string;
  population_density: number;
  area: number;
  description: string;
}

export interface WasteBinRecord {
  id: number;
  bin_code: string;
  latitude: number;
  longitude: number;
  location: string;
  zone_id: number;
  capacity: number;
  waste_type: string;
  current_fill_level: number;
  last_collection_date: string;
  status: BinStatus;
  reading_source: ReadingSource;
  created_at: string;
}

export interface FillHistoryRecord {
  id: number;
  bin_id: number;
  fill_percentage: number;
  source: ReadingSource;
  recorded_at: string;
}

export interface PredictionRecord {
  id: number;
  bin_id: number;
  predicted_fill_level: number;
  estimated_overflow_hours: number | null;
  fill_rate_per_hour: number;
  risk_score: number;
  risk_level: RiskLevel;
  model_name: string;
  confidence: string;
  mae: number | null;
  rmse: number | null;
  lr_mae: number | null;
  lr_rmse: number | null;
  rf_mae: number | null;
  rf_rmse: number | null;
  is_fallback: number;
  prediction_date: string;
}

export interface VehicleRecord {
  id: number;
  vehicle_number: string;
  vehicle_type: string;
  capacity: number;
  current_load: number;
  availability_status: VehicleStatus;
  assigned_zone: number | null;
  depot_lat: number;
  depot_lng: number;
}

export interface CollectionPlanRecord {
  id: number;
  vehicle_id: number;
  bin_id: number;
  priority: number;
  route_order: number;
  estimated_distance_km: number;
  scheduled_time: string;
  route_status: RouteStatus;
}

export interface CollectionRecordItem {
  id: number;
  bin_id: number;
  vehicle_id: number;
  collected_quantity: number;
  collection_status: string;
  collection_date: string;
  remarks: string;
}

export interface AlertRecord {
  id: number;
  bin_id: number | null;
  alert_type: string;
  message: string;
  severity: RiskLevel;
  is_read: number;
  created_at: string;
}

export interface SystemSettingRecord {
  id: number;
  setting_name: string;
  setting_value: string;
}

export interface AuditLogRecord {
  id: number;
  user_id: number | null;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}
