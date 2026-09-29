export function diagnosticSummary(row: any) {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    projectId: row.project_id as string,
    status: row.status as "pending" | "complete" | "expired",
    startedAt: new Date(row.started_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    totalBytes: Number(row.summary?.totalBytes ?? 0),
    fileCount: Number(row.summary?.fileCount ?? 0),
    coverage: row.summary?.coverage ?? {},
  };
}
