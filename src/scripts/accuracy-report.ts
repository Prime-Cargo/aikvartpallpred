/**
 * Weekly accuracy report: MAPE, bias, per-product errors, worst predictions.
 * Usage: bun src/scripts/accuracy-report.ts [days=7]
 */

import { runAccuracyReport } from "../lib/jobs";

const days = parseInt(process.argv[2] ?? "7", 10);

runAccuracyReport(days)
  .then((report) => {
    console.log(`Accuracy report for past ${report.period.days} days\n`);
    console.log(`Total outcomes:  ${report.total_outcomes}`);
    console.log(`MAPE:            ${report.mape}%`);
    console.log(`Bias:            ${report.bias} (positive = under-predicting)`);
    console.log(`Drift alert:     ${report.drift_alert ? "YES — MAPE exceeds 25%" : "No"}`);

    if (report.by_product.length > 0) {
      console.log(`\nPer-product breakdown:`);
      for (const p of report.by_product) {
        console.log(`  ${p.product_id}: MAPE=${p.mape.toFixed(1)}%, bias=${p.bias.toFixed(1)}, n=${p.count}`);
      }
    }

    if (report.worst_predictions.length > 0) {
      console.log(`\nWorst predictions:`);
      for (const w of report.worst_predictions) {
        console.log(`  ${w.prediction_id} (${w.product_id}): error=${w.error}, ${w.error_percent}%, actual=${w.actual_qty}`);
      }
    }

    console.log(`\n--- JSON ---`);
    console.log(JSON.stringify(report, null, 2));

    if (report.drift_alert) process.exit(1);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
