/**
 * Type definitions for the schema-driven query system
 */


export type FilterOperator =
  | 'equals'
  | 'not'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte';

export type FieldType = 'string' | 'number' | 'boolean' | 'datetime';


export interface FieldConfig {
  /** Prisma field name */
  prismaField: string;
  /** Type for validation */
  type: FieldType;
  /** Human-readable description */
  description: string;
  /** Allowed filter operators */
  operators: FilterOperator[];
  /** Is this field sortable? */
  sortable: boolean;
}

export interface RelationConfig {
  /** Relation name in Prisma schema */
  prismaRelation: string;
  /** Target entity name */
  targetEntity: string;
  /** Description for schema */
  description: string;
  /** Fields to select from relation */
  selectFields: string[];
}

export type ScopeType = 'direct_user' | 'project_member' | 'via_agent';

export interface EntityConfig {
  /** Prisma model name (camelCase for delegate access) */
  prismaModel: string;
  /** Human-readable description */
  description: string;
  /** Allowed fields for selection and filtering */
  allowedFields: Record<string, FieldConfig>;
  /** Allowed relations to include */
  allowedRelations: Record<string, RelationConfig>;
  /** Scope type determines how user access is enforced */
  scopeType: ScopeType;
  /** For via_agent scope: field that references agent */
  agentIdField?: string;
  /** Default sort field */
  defaultSortField: string;
  /** Default sort order */
  defaultSortOrder: 'asc' | 'desc';
}


export interface QueryFilter {
  field: string;
  operator: FilterOperator;
  value: string | number | boolean | string[] | number[];
}

export interface QueryInput {
  entity: string;
  filters?: QueryFilter[];
  include?: string[];
  select?: string[];
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}


export interface QueryResult {
  success: true;
  entity: string;
  data: Record<string, unknown>[];
  count: number;
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export type QueryErrorCode =
  | 'INVALID_ENTITY'
  | 'INVALID_FIELD'
  | 'INVALID_OPERATOR'
  | 'INVALID_RELATION'
  | 'INVALID_FILTER_VALUE'
  | 'EXECUTION_ERROR';

export interface QueryError {
  success: false;
  error: string;
  code: QueryErrorCode;
}

export type QueryResponse = QueryResult | QueryError;


export interface SchemaFieldInfo {
  name: string;
  type: FieldType;
  description: string;
  operators: FilterOperator[];
  sortable: boolean;
}

export interface SchemaRelationInfo {
  name: string;
  targetEntity: string;
  description: string;
  fields: string[];
}

export interface SchemaEntityInfo {
  name: string;
  description: string;
  fields: SchemaFieldInfo[];
  relations: SchemaRelationInfo[];
}

export interface SchemaResponse {
  entities: SchemaEntityInfo[];
}
