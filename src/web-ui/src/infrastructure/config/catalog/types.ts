export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ConfigScopeKind = 'user' | 'workspace' | 'session';

export interface ConfigScope {
  kind: ConfigScopeKind;
  workspaceId?: string;
  sessionId?: string;
}

export type ConfigStoredValue =
  | { kind: 'value'; value: JsonValue }
  | {
      kind: 'secret';
      configured: boolean;
      provider?: string;
      maskedSuffix?: string;
    };

export interface SettingValueSchemaBase {
  nullable?: boolean;
}

export interface BooleanValueSchema extends SettingValueSchemaBase {
  type: 'boolean';
}

export interface StringValueSchema extends SettingValueSchemaBase {
  type: 'string';
  enum?: readonly string[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
}

export interface NumberValueSchema extends SettingValueSchemaBase {
  type: 'number' | 'integer';
  enum?: readonly number[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
}

export interface ArrayValueSchema extends SettingValueSchemaBase {
  type: 'array';
  items: SettingValueSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface ObjectValueSchema extends SettingValueSchemaBase {
  type: 'object';
  properties: Readonly<Record<string, SettingValueSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

export type SettingValueSchema =
  | BooleanValueSchema
  | StringValueSchema
  | NumberValueSchema
  | ArrayValueSchema
  | ObjectValueSchema;

export type SettingControl =
  | 'switch'
  | 'select'
  | 'number'
  | 'text'
  | 'path'
  | 'list'
  | 'object'
  | 'custom';

export type SettingRisk = 'safe' | 'elevated' | 'destructive';
export type SettingSensitivity = 'public' | 'private' | 'secret';
export type SettingMutability = 'writable' | 'readOnly';
export type SettingApplyStrategy = 'reactive' | 'adapter' | 'restartRequired' | 'manualOnly';

export interface SettingPresentationDescriptor {
  categoryId: string;
  tabId: string;
  sectionId: string;
  fieldId: string;
  titleKey: string;
  descriptionKey?: string;
  control: SettingControl;
  order: number;
  hidden: boolean;
}

export interface SettingAiDescriptor {
  aliases: readonly string[];
  tags: readonly string[];
  readable: boolean;
  writable: boolean;
}

export type SettingOptionsProvider =
  | 'enabledAiModels'
  | 'agentModelTargets'
  | 'availableThemes'
  | 'availableTerminalShells';

export interface SettingOptionDescriptor {
  value: string;
  label: string;
}

export interface SettingPolicyDescriptor {
  risk: SettingRisk;
  sensitivity: SettingSensitivity;
  mutability: SettingMutability;
  applyStrategy: SettingApplyStrategy;
}

export type SettingDescriptorSource =
  | { kind: 'core' }
  | { kind: 'productApp'; appId: string; releaseId: string }
  | { kind: 'runtime'; providerId: string };

export type SettingExposure = 'formal' | 'binding';

export interface SettingDescriptor {
  id: string;
  exposure: SettingExposure;
  valueSchema: SettingValueSchema;
  defaultValue: ConfigStoredValue;
  presentation: SettingPresentationDescriptor;
  ai: SettingAiDescriptor;
  optionsProvider?: SettingOptionsProvider;
  resolvedOptions?: readonly SettingOptionDescriptor[];
  policy: SettingPolicyDescriptor;
  source: SettingDescriptorSource;
}

export interface ConfigCatalog {
  version: string;
  settings: readonly SettingDescriptor[];
}

export interface DescribeConfigCatalogRequest {
  scope: ConfigScope;
  query?: string;
}
