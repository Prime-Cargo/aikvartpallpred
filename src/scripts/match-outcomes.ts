/**
 * Daily script: match actual order quantities to predictions.
 * Usage: bun src/scripts/match-outcomes.ts [YYYY-MM-DD]
 */

import { runMatchOutcomes } from "../lib/jobs";

const targetDate = process.argv[2] ?? undefined;

runMatchOutcomes(targetDate)
  .then((result) => {
    console.log(`Matching outcomes for ${result.target_date}`);
    console.log(`  Predictions: ${result.total_predictions}`);
    console.log(`  Matched:     ${result.matched}`);
    console.log(`  Unmatched:   ${result.unmatched}`);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
