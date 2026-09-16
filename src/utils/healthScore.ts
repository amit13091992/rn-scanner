export interface HealthScoreInput {
  compatible: number;
  warnings: number;
  errors: number;
  notChecked: number;
  total: number;
}

export interface HealthScoreResult {
  score: number;
  analyzed: number;
  total: number;
  /** True when few enough dependencies were analyzed that the score shouldn't be read as an all-clear. */
  lowCoverage: boolean;
}

const LOW_COVERAGE_THRESHOLD = 0.2;

export function computeHealthScore(breakdown: HealthScoreInput): HealthScoreResult {
  const analyzed = breakdown.total - breakdown.notChecked;
  let score = 100;

  if (analyzed > 0) {
    const good = breakdown.compatible;
    const bad = breakdown.warnings + breakdown.errors;
    score = Math.round((good / (good + bad)) * 100);
  } else if (breakdown.total > 0) {
    score = 0;
  }

  const lowCoverage = breakdown.total > 0 && analyzed / breakdown.total < LOW_COVERAGE_THRESHOLD;

  return { score, analyzed, total: breakdown.total, lowCoverage };
}
