export type ProviderModel = {
  label: string;
  value: string;
};

export type ProviderConfig = {
  id: string;
  label: string;
  default_url: string | null;
  api_key_env: string | null;
  api_key_available: boolean | null;
  requires_api_key: boolean;
  key_optional: boolean;
  models: {
    quick: ProviderModel[];
    deep: ProviderModel[];
  };
};

export type PublicConfig = {
  defaults: {
    llm_provider: string;
    quick_think_llm: string;
    deep_think_llm: string;
    output_language: string;
    research_depth: number;
    checkpoint_enabled: boolean;
  };
  analysts: { id: string; label: string }[];
  asset_types: string[];
  providers: ProviderConfig[];
};

export type AnalysisPayload = {
  ticker: string;
  analysis_date?: string;
  asset_type?: string;
  analysts: string[];
  research_depth: number;
  llm_provider?: string;
  quick_think_llm?: string;
  deep_think_llm?: string;
  backend_url?: string;
  output_language?: string;
  checkpoint_enabled?: boolean;
  demo?: boolean;
};

export type Analysis = {
  id: string;
  ticker: string;
  analysis_date: string;
  asset_type: string;
  status: "pending" | "running" | "completed" | "error";
  config: Record<string, unknown>;
  error?: string | null;
  report_markdown?: string | null;
  stats?: Record<string, unknown> | null;
  summary?: { rating?: string | null; decision?: string | null } | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};

export type AnalysisEvent = {
  id: number;
  analysis_id: string;
  type: string;
  message?: string | null;
  payload: Record<string, any>;
  created_at: string;
};

export type ReportSection = {
  section: string;
  title: string;
  content: string;
  updated_at: string;
};

export type Report = Analysis & {
  sections: ReportSection[];
};
