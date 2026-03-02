/**
 * Pure TypeScript OLS linear regression — no external ML dependencies.
 * Matrix operations: transpose, multiply, inverse (Gauss-Jordan).
 */

export type Matrix = number[][];
export type Vector = number[];

export interface OLSResult {
  coefficients: Vector; // one per feature (excludes intercept)
  intercept: number;
  r2: number;
  rmse: number;
}

// --- Matrix operations ---

export function matTranspose(A: Matrix): Matrix {
  const rows = A.length;
  const cols = A[0]!.length;
  const T: Matrix = Array.from({ length: cols }, () => new Array<number>(rows));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      T[j]![i] = A[i]![j]!;
    }
  }
  return T;
}

export function matMultiply(A: Matrix, B: Matrix): Matrix {
  const aRows = A.length;
  const aCols = A[0]!.length;
  const bCols = B[0]!.length;
  const C: Matrix = Array.from({ length: aRows }, () => new Array<number>(bCols).fill(0));
  for (let i = 0; i < aRows; i++) {
    for (let k = 0; k < aCols; k++) {
      const aik = A[i]![k]!;
      for (let j = 0; j < bCols; j++) {
        C[i]![j]! += aik * B[k]![j]!;
      }
    }
  }
  return C;
}

/** Gauss-Jordan elimination to invert a square matrix. Throws if singular. */
export function matInverse(M: Matrix): Matrix {
  const n = M.length;
  // Augmented matrix [M | I]
  const aug: Matrix = M.map((row, i) => {
    const extended = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j++) extended[j] = row[j]!;
    extended[n + i] = 1;
    return extended;
  });

  for (let col = 0; col < n; col++) {
    // Partial pivoting — find max absolute value in column
    let maxRow = col;
    let maxVal = Math.abs(aug[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(aug[row]![col]!);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) {
      throw new Error("Singular matrix — cannot invert (multicollinearity or insufficient data)");
    }
    // Swap rows
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow]!, aug[col]!];
    }
    // Scale pivot row
    const pivot = aug[col]![col]!;
    for (let j = 0; j < 2 * n; j++) {
      aug[col]![j]! /= pivot;
    }
    // Eliminate column in other rows
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row]![col]!;
      for (let j = 0; j < 2 * n; j++) {
        aug[row]![j]! -= factor * aug[col]![j]!;
      }
    }
  }

  // Extract right half
  return aug.map((row) => row.slice(n));
}

// --- OLS regression ---

/**
 * Ordinary Least Squares: β = (X'X)^-1 X'y
 * Automatically prepends a column of 1s for the intercept.
 */
export function olsFit(X: Matrix, y: Vector): OLSResult {
  const n = X.length;
  const p = X[0]!.length;

  if (n <= p + 1) {
    throw new Error(`Need more samples (${n}) than features (${p + 1} incl. intercept)`);
  }

  // Prepend intercept column
  const Xa: Matrix = X.map((row) => [1, ...row]);

  const Xt = matTranspose(Xa);
  const XtX = matMultiply(Xt, Xa);
  const XtXinv = matInverse(XtX);
  const Xty = matMultiply(Xt, y.map((v) => [v]));
  const beta = matMultiply(XtXinv, Xty).map((row) => row[0]!);

  const intercept = beta[0]!;
  const coefficients = beta.slice(1);

  // Compute R² and RMSE
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yPred = intercept + coefficients.reduce((sum, c, j) => sum + c * X[i]![j]!, 0);
    ssRes += (y[i]! - yPred) ** 2;
    ssTot += (y[i]! - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const rmse = Math.sqrt(ssRes / n);

  return { coefficients, intercept, r2, rmse };
}

/** Predict a single value given features, coefficients, and intercept. */
export function olsPredict(
  features: Vector,
  coefficients: Vector,
  intercept: number
): number {
  return intercept + coefficients.reduce((sum, c, i) => sum + c * (features[i] ?? 0), 0);
}
