import { ChartTokens } from '../../../core/tokens';
import { BLANK } from '../../../core/format';

/** Fixed stage order = fixed colour slot (colour follows the stage, never its rank). */
export const STAGE_ORDER = ['copy', 'ingest', 'silver', 'gold', 'verify'] as const;
export function stageColor(t: ChartTokens, stage: string | null | undefined): string {
  const i = STAGE_ORDER.indexOf((stage ?? '') as (typeof STAGE_ORDER)[number]);
  return i >= 0 ? t.series[i] : t.muted;
}
export function stageRank(stage: string | null | undefined): number {
  const i = STAGE_ORDER.indexOf((stage ?? '') as (typeof STAGE_ORDER)[number]);
  return i >= 0 ? i : STAGE_ORDER.length;
}
export function envColor(t: ChartTokens, env: string): string {
  return env === 'PROD' ? t.series[0] : env === 'QA' ? t.series[1] : t.muted;
}
export function tenantColor(t: ChartTokens, tenant: string): string {
  return tenant === 'RTS' ? t.series[2] : tenant === 'CARGOCONTROL' ? t.series[6] : t.muted;
}

/** First 8 characters of a run id (a technical id, not person data). */
export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : BLANK;
}
/** batch_id starts with YYYYMMDD (collector: batch_date = strptime(batch_id[:8])). */
export function batchDate(batchId: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(batchId);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
