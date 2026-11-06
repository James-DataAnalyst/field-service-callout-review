import type { ImportKind, ImportReport, ImportRow } from "./imports";
import type { ApprovalResult, ApprovalSnapshot } from "./approvals";

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string };
        Insert: { id?: string; name: string };
        Update: { name?: string };
        Relationships: [];
      };
      organization_admins: {
        Row: { user_id: string; organization_id: string };
        Insert: { user_id: string; organization_id: string };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "organization_admins_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      sites: {
        Row: { id: string; organization_id: string; name: string; site_code: string | null };
        Insert: { id?: string; organization_id: string; name: string; site_code?: string | null };
        Update: { name?: string; site_code?: string | null };
        Relationships: [
          {
            foreignKeyName: "sites_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      site_managers: {
        Row: { user_id: string; site_id: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      callouts: {
        Row: {
          id: string;
          organization_id: string;
          site_id: string;
          dispatch_reference: string;
          occurred_at: string;
          technician_code: string | null;
          import_run_id: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          site_id: string;
          dispatch_reference: string;
          occurred_at: string;
          technician_code?: string | null;
          import_run_id?: string | null;
        };
        Update: { dispatch_reference?: string; occurred_at?: string };
        Relationships: [
          {
            foreignKeyName: "callouts_organization_id_site_id_fkey";
            columns: ["organization_id", "site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      import_runs: {
        Row: {
          id: string;
          organization_id: string;
          imported_by: string | null;
          kind: ImportKind;
          status: ImportReport["status"];
          received_count: number;
          inserted_count: number;
          duplicate_count: number;
          issue_count: number;
          issues: ImportReport["issues"];
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "import_runs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      callout_approvals: {
        Row: ApprovalSnapshot;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      callout_shift_review: {
        Row: {
          id: string;
          organization_id: string;
          site_id: string;
          organization_name: string;
          site_name: string;
          dispatch_reference: string;
          technician_code: string | null;
          occurred_at: string;
          match_status: "missing_technician" | "no_shift" | "matched" | "overlap";
          candidate_count: number;
          matched_shift_id: string | null;
          matched_shift_reference: string | null;
          shift_starts_at: string | null;
          shift_ends_at: string | null;
        };
        Relationships: [];
      };
      callout_approval_totals: {
        Row: { organization_id: string; currency: string; approved_count: number; total_minor: number };
        Relationships: [];
      };
    };
    Functions: {
      import_field_csv: {
        Args: { p_organization_id: string; p_kind: ImportKind; p_rows: ImportRow[] };
        Returns: ImportReport;
      };
      approve_callout: {
        Args: { p_callout_id: string; p_shift_id: string };
        Returns: ApprovalResult;
      };
      get_approved_callout_export: {
        Args: { p_organization_id: string };
        Returns: ApprovalSnapshot[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
