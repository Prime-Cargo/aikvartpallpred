/**
 * CLI wrapper for the retrain job.
 * Usage: bun src/scripts/retrain.ts
 */

import { runRetrain } from "../lib/training";

async function main() {
  console.log("Starting model retraining...\n");
  const start = Date.now();

  const result = await runRetrain();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nRetrain complete in ${elapsed}s`);
  console.log(`  Products:  ${result.total_products}`);
  console.log(`  Trained:   ${result.models_trained}`);
  console.log(`  Failed:    ${result.models_failed}`);
  console.log("");

  for (const d of result.details) {
    if (d.status === "ok") {
      console.log(`  [OK]    ${d.product_id}  R²=${d.r2}`);
    } else {
      console.log(`  [FAIL]  ${d.product_id}  ${d.message}`);
    }
  }
}

main().catch(console.error);
