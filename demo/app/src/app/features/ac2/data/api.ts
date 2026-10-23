/** AC-2's view of the core API (was ac2/app/src/app/core/api.ts): same names, the core does the work. */
export { ENVS, TENANTS, TENANT_LABEL } from '../../../core/api';
export type { ApiError, Env, QueryResult, Role, Tenant } from '../../../core/api';

/** Query-string keys the AC-2 queries whitelist (queries/ac2/**.roles.json). person is a pseudonym, never a name. */
export type ParamKey = 'tenant' | 'env' | 'person' | 'qualification' | 'org' | 'date_from' | 'date_to';
export type QueryParams = Partial<Record<ParamKey, string>>;
