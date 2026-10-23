/** createQuery bound to /api/ac2 (was ac2/app/src/app/core/query.ts; the core holds the implementation). */
import { queryFactory } from '../../../core/query';

export type { QueryState } from '../../../core/query';
export const createQuery = queryFactory('ac2');
