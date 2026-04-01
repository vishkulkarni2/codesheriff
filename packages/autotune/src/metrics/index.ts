export interface DetectionResult {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
}

export function calcPrecision(tp: number, fp: number): number {
  if (tp + fp === 0) return 0;
  return tp / (tp + fp);
}

export function calcRecall(tp: number, fn: number): number {
  if (tp + fn === 0) return 0;
  return tp / (tp + fn);
}

export function calcF1(tp: number, fp: number, fn: number): number {
  const precision = calcPrecision(tp, fp);
  const recall = calcRecall(tp, fn);
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

export function buildResult(
  tp: number,
  fp: number,
  fn: number,
  tn: number
): DetectionResult {
  return {
    tp,
    fp,
    fn,
    tn,
    precision: calcPrecision(tp, fp),
    recall: calcRecall(tp, fn),
    f1: calcF1(tp, fp, fn),
  };
}
