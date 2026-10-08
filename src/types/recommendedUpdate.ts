export interface RecommendedUpdate {
  package: string;
  current: string;
  latest: string;
  /** The highest version this project's React Native version is actually known to support,
   *  per `data/compatibility.ts` — may be lower than `latest` when a newer major line requires
   *  a React Native version this project hasn't reached yet. Null when no compatible version
   *  could be resolved (no published version found in the matching major line). */
  recommended: string | null;
  reason: string;
}
