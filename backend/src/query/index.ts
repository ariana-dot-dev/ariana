/**
 * Schema-driven query system for agent MCP tools.
 *
 * This module provides a generic, secure way to query user data
 * with automatic user scoping and field allowlisting.
 */

export * from './query.types';
export * from './schema.config';
export * from './scope.builders';
export * from './query.executor';
