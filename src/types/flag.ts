export interface Flag {
  key: string;
  enabled: boolean;
  environment: string;
  rollout_percentage: number;
  created_at: string;
  updated_at: string;
}
