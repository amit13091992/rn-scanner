export interface OutdatedPackage {
  name: string;
  current: string;
  latest: string;
  type: 'major' | 'minor' | 'patch';
}
