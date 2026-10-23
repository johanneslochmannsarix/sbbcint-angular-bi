/** Row shapes of the /metrics named queries (backend/queries/metrics/, keys normalised by the backend:
 *  Table[col] -> col, [Measure] -> measure). Every measure may be null: BLANK comes back as null
 *  (includeNulls=true) and means "not computable", never 0. */
type N = number | null;
type S = string | null;

export interface DataAsOf { last_collected: S; hours_since_collected: N; collector_errors: N }

export interface AnatomyKpis { act_runs: N; stage_median_min: N; stage_p90_min: N; queue_share: N; payload_share: N }
export interface AnatomyChain { run_id: string; tenant: S; env: S; chain_start: S; chain_end: S; exec_min: N; session_queued_min: N; retries: N }
export interface AnatomyGantt {
  activity_name: S; activity_type: S; stage: S; status: S; activity_start: S; activity_end: S; retry_attempt: N;
  act_runs: N; exec_min: N; session_queued_min: N; session_running_min: N;
}
export interface AnatomySparkStage {
  activity_name: S; name: S; status: S; spark_stages: N; stage_run_min: N; input_gib: N; input_rows: N;
  output_rows: N; shuffle_gib: N; spill_gib: N; peak_exec_mem_mib: N;
}
/** One Spark stage rollup of the chain (name x status): the detail panel and the stage Gantt. The span
 *  first_submission .. last_completion covers every stage of that name, not one stage. */
export interface AnatomySparkDetail {
  activity_name: S; name: S; status: S; spark_stages: N; stage_run_min: N; num_tasks: N; cpu_min: N; gc_min: N;
  input_gib: N; input_rows: N; output_gib: N; output_rows: N; shuffle_read_gib: N; shuffle_write_gib: N;
  spill_mem_gib: N; spill_disk_gib: N; peak_exec_mem_mib: N; first_submission: S; last_completion: S;
}
/** The chain's stage names across the runs in the window (one row per run x activity x stage name). */
export interface AnatomySparkHistory { run_id: string; activity_name: S; name: S; run_start: S; stage_run_min: N; spark_stages: N }
export interface AnatomyStageQueue { stage: S; session_queued_min: N; session_running_min: N }
export interface AnatomyExecutorBusy { activity_name: S; executor_busy_min: N }
export interface AnatomyExecTrend { start_date: S; stage: S; exec_min: N }
export interface AnatomyStageTable { start_date: S; env_key: S; stage: S; act_runs: N; stage_median_min: N; stage_p90_min: N; session_queued_min: N; retries: N }

export interface TrendSizeByEnv { batch_date: S; env: S; size_per_batch_gib: N }
export interface TrendSizeByTenant { batch_date: S; tenant: S; size_per_batch_gib: N }
export interface TrendBatchSize { batch_id: string; delivered_size_gib: N }
export interface TrendBatchTable { batch_id: string; tenant: S; env: S; fidelity: S; delivered_files: N; delivered_size_gib: N; batch_growth: N }

export interface ParetoKpis { top10_ingest: N; top10_silver: N; top10_gold: N; fixed_s_per_file: N; ingest_s_per_mib: N }
export interface ParetoTop20 { key: S; ingest_s_per_file_top20: N; ingest_mib_per_file_top20: N }
export interface ParetoScatter { key: S; ingest_mib_per_file: N; ingest_s_per_file: N }
export interface ParetoSilver { key: S; silver_s_per_run: N }
export interface ParetoGold { key: S; gold_s_per_run: N }

export interface StabilityBox { stage: S; step: S; run_id: S; regime_key: S; regime_label: S; is_current: boolean | null; step_s: N; run_start: S }
export interface StabilityControl { stage: S; step: S; activity_start: S; step_s: N; ctl_median_s: N; ctl_upper_s: N; ctl_lower_s: N }
export interface StabilityCv { step: S; regime_cv: N }
export interface StabilityRegime { stage: S; regime_label: S; regime_from: S; change: S; regime_n: N }
export interface StabilityTable {
  stage: S; step: S; regime: S; regime_n: N; regime_median_s: N; regime_p90_s: N; regime_std_s: N; regime_cv: N;
  regime_slope_s_per_d: N; outlier_runs: N;
}
