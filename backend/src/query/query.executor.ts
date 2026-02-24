/**
 * Query executor for the schema-driven query system.
 * Validates input, builds Prisma queries with user scoping, and executes them.
 */

import type { PrismaClient } from '../../generated/prisma';
import type {
  QueryInput,
  QueryResponse,
  QueryResult,
  QueryError,
  QueryFilter,
  FilterOperator,
  FieldConfig,
  EntityConfig,
  QueryErrorCode,
} from './query.types';
import {
  ENTITY_CONFIG,
  MAX_QUERY_LIMIT,
  DEFAULT_QUERY_LIMIT,
} from './schema.config';
import { getScopeBuilder } from './scope.builders';
import { getLogger } from '../utils/logger';

const logger = getLogger(['query', 'executor']);

type WhereClause = Record<string, unknown>;
type SelectClause = Record<string, boolean>;
type IncludeClause = Record<string, unknown>;
type OrderByClause = Record<string, 'asc' | 'desc'>;

export class QueryExecutor {
  constructor(private prisma: PrismaClient) {}

  /**
   * Execute a query with user scoping.
   * This is the main entry point for all queries.
   */
  async execute(input: QueryInput, userId: string): Promise<QueryResponse> {
    console.log(`[QUERY] Executing: entity=${input.entity}, userId=${userId}, input=${JSON.stringify(input)}`);

    // 1. Validate entity exists in config
    const entityConfig = ENTITY_CONFIG[input.entity];
    if (!entityConfig) {
      return this.error(
        'INVALID_ENTITY',
        `Unknown entity: ${input.entity}. Available: ${Object.keys(ENTITY_CONFIG).join(', ')}`
      );
    }

    // 2. Validate and build filters
    const filterResult = this.buildFilters(input.filters || [], entityConfig);
    if (!filterResult.success) {
      return filterResult.error;
    }

    // 3. Validate select fields
    const selectResult = this.buildSelect(input.select, entityConfig);
    if (!selectResult.success) {
      return selectResult.error;
    }

    // 4. Validate include relations
    const includeResult = this.buildInclude(input.include, entityConfig);
    if (!includeResult.success) {
      return includeResult.error;
    }

    // 5. Validate orderBy
    const orderByResult = this.buildOrderBy(
      input.orderBy,
      input.orderDirection,
      entityConfig
    );
    if (!orderByResult.success) {
      return orderByResult.error;
    }

    // 6. Build user scope (CRITICAL - this enforces authorization)
    const scopeBuilder = getScopeBuilder(entityConfig, this.prisma);
    const scopedWhere = await scopeBuilder(userId, filterResult.where);

    // 7. Clamp limit and offset
    const limit = Math.min(
      Math.max(1, input.limit || DEFAULT_QUERY_LIMIT),
      MAX_QUERY_LIMIT
    );
    const offset = Math.max(0, input.offset || 0);

    // 8. Execute query
    try {
      const modelDelegate = this.getModelDelegate(entityConfig.prismaModel);

      // Build query args - only include defined values
      const queryArgs: Record<string, unknown> = {
        where: scopedWhere,
        take: limit,
        skip: offset,
        orderBy: orderByResult.orderBy,
      };

      // SECURITY: Always use select to limit returned fields
      // When including relations, merge select with relation includes
      if (includeResult.include && Object.keys(includeResult.include).length > 0) {
        // Combine select fields with relation includes
        queryArgs.select = {
          ...selectResult.select,
          ...includeResult.include,
        };
      } else if (selectResult.select && Object.keys(selectResult.select).length > 0) {
        queryArgs.select = selectResult.select;
      }

      const [data, totalCount] = await Promise.all([
        modelDelegate.findMany(queryArgs),
        modelDelegate.count({ where: scopedWhere }),
      ]);

      console.log(`[QUERY] Returned ${data.length} results (total: ${totalCount}), limit=${limit}`);

      return {
        success: true,
        entity: input.entity,
        data: data as Record<string, unknown>[],
        count: data.length,
        total: totalCount,
        limit,
        offset,
        hasMore: offset + data.length < totalCount,
      };
    } catch (err) {
      logger.error`Query execution error: ${err}`;
      return this.error('EXECUTION_ERROR', 'Failed to execute query');
    }
  }

  /**
   * Build Prisma WHERE clause from user filters.
   */
  private buildFilters(
    filters: QueryFilter[],
    entityConfig: EntityConfig
  ):
    | { success: true; where: WhereClause }
    | { success: false; error: QueryError } {
    const conditions: WhereClause[] = [];

    for (const filter of filters) {
      // Validate field exists in allowlist
      const fieldConfig = entityConfig.allowedFields[filter.field];
      if (!fieldConfig) {
        return {
          success: false,
          error: this.error(
            'INVALID_FIELD',
            `Field '${filter.field}' is not allowed for entity '${entityConfig.prismaModel}'. Allowed: ${Object.keys(entityConfig.allowedFields).join(', ')}`
          ),
        };
      }

      // Validate operator is allowed for this field
      if (!fieldConfig.operators.includes(filter.operator)) {
        return {
          success: false,
          error: this.error(
            'INVALID_OPERATOR',
            `Operator '${filter.operator}' is not allowed for field '${filter.field}'. Allowed: ${fieldConfig.operators.join(', ')}`
          ),
        };
      }

      // Validate and convert value
      const valueResult = this.validateAndConvertValue(
        filter.value,
        filter.operator,
        fieldConfig
      );
      if (!valueResult.success) {
        return { success: false, error: valueResult.error };
      }

      // Build Prisma condition
      const condition = this.buildCondition(
        fieldConfig.prismaField,
        filter.operator,
        valueResult.value
      );
      conditions.push(condition);
    }

    return {
      success: true,
      where: conditions.length > 0 ? { AND: conditions } : {},
    };
  }

  /**
   * Validate value type and convert if needed.
   */
  private validateAndConvertValue(
    value: unknown,
    operator: FilterOperator,
    fieldConfig: FieldConfig
  ): { success: true; value: unknown } | { success: false; error: QueryError } {
    const { type, prismaField } = fieldConfig;

    // Handle array operators
    if (operator === 'in' || operator === 'notIn') {
      if (!Array.isArray(value)) {
        return {
          success: false,
          error: this.error(
            'INVALID_FILTER_VALUE',
            `Operator '${operator}' requires an array value for field '${prismaField}'`
          ),
        };
      }
      // Validate each array element
      const convertedArray = value.map((v) => this.convertValue(v, type));
      if (convertedArray.some((v) => v === null)) {
        return {
          success: false,
          error: this.error(
            'INVALID_FILTER_VALUE',
            `Invalid array value type for field '${prismaField}' (expected ${type})`
          ),
        };
      }
      return { success: true, value: convertedArray };
    }

    // Handle scalar operators
    const converted = this.convertValue(value, type);
    if (converted === null && value !== null && value !== undefined) {
      return {
        success: false,
        error: this.error(
          'INVALID_FILTER_VALUE',
          `Invalid value type for field '${prismaField}' (expected ${type})`
        ),
      };
    }

    return { success: true, value: converted };
  }

  /**
   * Convert value to the expected type.
   */
  private convertValue(
    value: unknown,
    type: FieldConfig['type']
  ): unknown {
    if (value === null || value === undefined) return null;

    switch (type) {
      case 'string':
        return typeof value === 'string' ? value : String(value);

      case 'number':
        const num = Number(value);
        return isNaN(num) ? null : num;

      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (value === 'true') return true;
        if (value === 'false') return false;
        return null;

      case 'datetime':
        if (value instanceof Date) return value;
        const date = new Date(value as string);
        return isNaN(date.getTime()) ? null : date;

      default:
        return value;
    }
  }

  /**
   * Build a single Prisma condition.
   */
  private buildCondition(
    field: string,
    operator: FilterOperator,
    value: unknown
  ): WhereClause {
    switch (operator) {
      case 'equals':
        return { [field]: value };
      case 'not':
        return { [field]: { not: value } };
      case 'in':
        return { [field]: { in: value } };
      case 'notIn':
        return { [field]: { notIn: value } };
      case 'contains':
        return { [field]: { contains: value, mode: 'insensitive' } };
      case 'startsWith':
        return { [field]: { startsWith: value, mode: 'insensitive' } };
      case 'endsWith':
        return { [field]: { endsWith: value, mode: 'insensitive' } };
      case 'gt':
        return { [field]: { gt: value } };
      case 'gte':
        return { [field]: { gte: value } };
      case 'lt':
        return { [field]: { lt: value } };
      case 'lte':
        return { [field]: { lte: value } };
      default:
        return { [field]: value };
    }
  }

  /**
   * Build Prisma select clause.
   */
  private buildSelect(
    selectFields: string[] | undefined,
    entityConfig: EntityConfig
  ):
    | { success: true; select: SelectClause | undefined }
    | { success: false; error: QueryError } {
    if (!selectFields || selectFields.length === 0) {
      // Default: select all allowed fields
      const select: SelectClause = {};
      for (const [, config] of Object.entries(entityConfig.allowedFields)) {
        select[config.prismaField] = true;
      }
      return { success: true, select };
    }

    const select: SelectClause = {};
    for (const field of selectFields) {
      const fieldConfig = entityConfig.allowedFields[field];
      if (!fieldConfig) {
        return {
          success: false,
          error: this.error(
            'INVALID_FIELD',
            `Field '${field}' is not allowed for selection. Allowed: ${Object.keys(entityConfig.allowedFields).join(', ')}`
          ),
        };
      }
      select[fieldConfig.prismaField] = true;
    }

    return { success: true, select };
  }

  /**
   * Build Prisma include clause for relations.
   */
  private buildInclude(
    includeRelations: string[] | undefined,
    entityConfig: EntityConfig
  ):
    | { success: true; include: IncludeClause | undefined }
    | { success: false; error: QueryError } {
    if (!includeRelations || includeRelations.length === 0) {
      return { success: true, include: undefined };
    }

    const include: IncludeClause = {};
    for (const relation of includeRelations) {
      const relationConfig = entityConfig.allowedRelations[relation];
      if (!relationConfig) {
        return {
          success: false,
          error: this.error(
            'INVALID_RELATION',
            `Relation '${relation}' is not allowed. Allowed: ${Object.keys(entityConfig.allowedRelations).join(', ') || 'none'}`
          ),
        };
      }

      // Build select for relation fields
      const relationSelect: SelectClause = {};
      for (const field of relationConfig.selectFields) {
        relationSelect[field] = true;
      }

      include[relationConfig.prismaRelation] = {
        select: relationSelect,
      };
    }

    return { success: true, include };
  }

  /**
   * Build Prisma orderBy clause.
   */
  private buildOrderBy(
    orderBy: string | undefined,
    orderDirection: 'asc' | 'desc' | undefined,
    entityConfig: EntityConfig
  ):
    | { success: true; orderBy: OrderByClause }
    | { success: false; error: QueryError } {
    const field = orderBy || entityConfig.defaultSortField;
    const direction = orderDirection || entityConfig.defaultSortOrder;

    const fieldConfig = entityConfig.allowedFields[field];
    if (!fieldConfig) {
      return {
        success: false,
        error: this.error(
          'INVALID_FIELD',
          `Field '${field}' is not valid for ordering. Allowed: ${Object.keys(entityConfig.allowedFields).join(', ')}`
        ),
      };
    }

    if (!fieldConfig.sortable) {
      return {
        success: false,
        error: this.error(
          'INVALID_FIELD',
          `Field '${field}' is not sortable`
        ),
      };
    }

    return {
      success: true,
      orderBy: { [fieldConfig.prismaField]: direction },
    };
  }

  /**
   * Get the Prisma model delegate dynamically.
   */
  private getModelDelegate(modelName: string): {
    findMany: (args: unknown) => Promise<unknown[]>;
    count: (args: unknown) => Promise<number>;
  } {
    // Cast to unknown first to avoid TypeScript overlap error
    const prismaAny = this.prisma as unknown as Record<string, unknown>;
    const delegate = prismaAny[modelName];

    if (!delegate || typeof delegate !== 'object') {
      throw new Error(`Unknown Prisma model: ${modelName}`);
    }

    return delegate as {
      findMany: (args: unknown) => Promise<unknown[]>;
      count: (args: unknown) => Promise<number>;
    };
  }

  /**
   * Create error response.
   */
  private error(code: QueryErrorCode, message: string): QueryError {
    return {
      success: false,
      error: message,
      code,
    };
  }
}
