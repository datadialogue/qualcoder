// Sampling config lives beside the algorithm so the two cannot drift apart.
import type { SamplingConfig } from "./sampling";
import type { ImportMapping } from "./starter";
export type { SamplingConfig };

export type Role = "lead" | "coder";
export type RoundStatus = "draft" | "open" | "closed";
export type OverlapMode = "full" | "subset";
export type ProgressStatus = "todo" | "in_progress" | "done";

export interface Coder {
  id: string;
  name: string;
  email: string | null;
  token: string;
  role: Role;
  active: boolean;
  created_at: string;
}

/** Read-only text shown above a unit while coding, e.g. the post a comment replies to. */
export interface ContextItem {
  label: string;
  text: string;
}

export interface StudySettings {
  /** Metadata keys shown as chips above each unit while coding. */
  displayKeys?: string[];
  /** Metadata key holding a URL to the original item, such as a Reddit permalink. */
  linkKey?: string;
  /** How the starter file was mapped, reused as the default for later imports. */
  mapping?: ImportMapping;
}

export type StudyStatus = "active" | "archived";

export interface Study {
  id: string;
  name: string;
  description: string;
  source: string;
  settings: StudySettings;
  status: StudyStatus;
  created_by: string | null;
  created_at: string;
}

export interface Unit {
  id: string;
  study_id: string;
  external_id: string;
  text: string;
  meta: Record<string, string>;
  context: ContextItem[];
}

export interface Theme {
  id: string;
  study_id: string;
  name: string;
  description: string;
  color: string;
  position: number;
}

export interface Code {
  id: string;
  study_id: string;
  theme_id: string | null;
  name: string;
  definition: string;
  inclusion: string;
  exclusion: string;
  example: string;
  color: string;
  position: number;
  archived: boolean;
  /** Set when the code was created from the coding workspace rather than the codebook page. */
  created_by: string | null;
  /** True until the lead has reviewed a code that was added mid-coding. */
  provisional: boolean;
}

export interface Round {
  id: string;
  study_id: string;
  number: number;
  name: string;
  status: RoundStatus;
  sampling: SamplingConfig;
  seed: string;
  overlap_mode: OverlapMode;
  codebook_snapshot: unknown | null;
  created_at: string;
  opened_at: string | null;
  closed_at: string | null;
}

export interface Annotation {
  id: string;
  round_id: string;
  unit_id: string;
  coder_id: string;
  code_id: string;
  /** NULL start/end means the code applies to the whole unit, not a span. */
  start_offset: number | null;
  end_offset: number | null;
  quote: string;
  memo: string;
}
