// Subtotals for the displayed report rows, grouped by their last-fill date.
// They cover the selected reporting period, not just fills made on that date.
export function summarizeFuelRows(rows) {
  const finite = value => value != null && Number.isFinite(Number(value));
  let litreHundredths = 0, costCents = 0, fills = 0;
  let consumptionSum = 0, consumptionSamples = 0, deltaSum = 0, deltaLitres = 0;
  for (const row of rows) {
    const litres = finite(row.litres) ? Number(row.litres) : 0;
    // Add the two-decimal numbers shown in the table, avoiding floating-point drift.
    litreHundredths += Math.round(Number(litres.toFixed(2)) * 100);
    if (finite(row.total_price)) costCents += Math.round(Number(Number(row.total_price).toFixed(2)) * 100);
    if (finite(row.fills)) fills += Number(row.fills);
    const samples = finite(row.lp100_sample) ? Number(row.lp100_sample) : 0;
    if (finite(row.avg_lp100) && samples > 0) {
      consumptionSum += Number(row.avg_lp100) * samples;
      consumptionSamples += samples;
    }
    if (finite(row.delta_dpl) && litres > 0) {
      deltaSum += Number(row.delta_dpl) * litres;
      deltaLitres += litres;
    }
  }
  const litres = litreHundredths / 100;
  const totalPrice = costCents / 100;
  return {
    rowCount: rows.length, fills, litres, totalPrice,
    avgFill: fills > 0 ? litres / fills : null,
    pricePerLitre: litres > 0 ? totalPrice / litres : null,
    avgLp100: consumptionSamples > 0 ? consumptionSum / consumptionSamples : null,
    consumptionSamples,
    deltaDpl: deltaLitres > 0 ? deltaSum / deltaLitres : null,
  };
}
