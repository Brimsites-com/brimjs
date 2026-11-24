/**
 * A block is a ready-made component with settings the owner can change.
 * Its settings are described by a schema: the inspector builds its form from it
 * and the server checks saved values against it.
 */
export interface BlockDefinition {
  type: string;
  label: string;
  description: string;
  schema: BlockSchema;
  /** The settings a new block starts with. */
  defaults: Record<string, unknown>;
}

export interface BlockSchema {
  /** Sections of the inspector, in order. A property listed in no fieldset is not shown. */
  fieldsets: Fieldset[];
  properties: Record<string, SchemaProperty>;
  required?: string[];
}

export interface Fieldset {
  id: string;
  title: string;
  fields: string[];
  [extra: string]: unknown;
}

export interface SchemaOption {
  value: unknown;
  label: string;
  [extra: string]: unknown;
}

/** One setting. `widget` picks the control; without it the control follows `type`. */
export interface SchemaProperty {
  title?: string;
  description?: string;
  type?: string;
  widget?: string;
  default?: unknown;
  options?: readonly SchemaOption[];
  /** Bounds of a number. BrimCMS wrote them both ways; `min`/`max` are the common one. */
  min?: number;
  max?: number;
  minimum?: number;
  maximum?: number;
  step?: number;
  /** Shown only while these other settings have these values. */
  showWhen?: Record<string, unknown>;
  [extra: string]: unknown;
}
