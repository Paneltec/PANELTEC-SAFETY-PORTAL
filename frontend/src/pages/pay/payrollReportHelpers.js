export function divisionRows(rows, assignments, division) {
  return rows.filter(row => division === 'all' || (assignments?.[row.worker_id] || 'unassigned') === division);
}

export function reportTotal(rows, key) {
  if (rows.some(row => row.result[key] == null || !Number.isFinite(Number(row.result[key])))) return null;
  return rows.reduce((total, row) => total + Math.round(Number(row.result[key]) * 100), 0) / 100;
}
