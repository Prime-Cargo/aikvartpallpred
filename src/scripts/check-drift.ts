/**
 * Drift monitor: check rolling MAPE and alert if above threshold.
 * Usage: bun src/scripts/check-drift.ts [days=7] [threshold=25]
 */

import { runCheckDrift } from "../lib/jobs";

const days = parseInt(process.argv[2] ?? "7", 10);
const threshold = parseFloat(process.argv[3] ?? "25");

runCheckDrift(days, threshold)
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "drift") process.exit(1);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
