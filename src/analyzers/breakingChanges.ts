import type { DependencyInfo } from '../types/dependency.js';

export interface BreakingChangeIssue {
  package: string;
  version: string;
  severity: 'critical' | 'high' | 'medium';
  changes: string[];
}

const breakingChangeDatabase: Record<string, Array<{
  version: string;
  severity: 'critical' | 'high' | 'medium';
  changes: string[];
}>> = {
  'react-native': [
    {
      version: '0.73',
      severity: 'critical',
      changes: [
        'Removed Flipper support by default',
        'Changed TypeScript configuration requirements',
        'Modified native module linking process',
      ],
    },
    {
      version: '0.72',
      severity: 'high',
      changes: [
        'Removed support for Android API level < 21',
        'Changed Gradle plugin requirements',
        'Modified Hermes compilation flags',
      ],
    },
    {
      version: '0.71',
      severity: 'high',
      changes: [
        'Deprecated useWindowDimensions API',
        'Changed Metro bundler default configuration',
      ],
    },
  ],
  'react-native-reanimated': [
    {
      version: '4.0',
      severity: 'critical',
      changes: [
        'Removed Animated API compatibility',
        'Changed worklet syntax and compilation',
        'Modified gesture handler integration',
      ],
    },
    {
      version: '3.0',
      severity: 'high',
      changes: [
        'Removed layout animation support',
        'Changed animation callback signatures',
      ],
    },
  ],
  'react-native-screens': [
    {
      version: '4.0',
      severity: 'high',
      changes: [
        'Removed deprecated navigation events',
        'Changed screen lifecycle methods',
      ],
    },
  ],
  '@react-navigation/native': [
    {
      version: '7.0',
      severity: 'critical',
      changes: [
        'Removed deprecated navigator props',
        'Changed route params API',
        'Modified listener API signature',
      ],
    },
    {
      version: '6.0',
      severity: 'high',
      changes: [
        'Removed context-based navigation',
        'Changed action dispatching mechanism',
      ],
    },
  ],
  'react-native-vision-camera': [
    {
      version: '4.0',
      severity: 'critical',
      changes: [
        'Removed Camera ref API',
        'Changed format selection API',
        'Modified frame processor signatures',
      ],
    },
  ],
  'react-native-gesture-handler': [
    {
      version: '3.0',
      severity: 'high',
      changes: [
        'Removed GestureHandler.Wrap API',
        'Changed gesture configuration API',
      ],
    },
  ],
};

export function detectBreakingChanges(dep: DependencyInfo): BreakingChangeIssue | null {
  const changes = breakingChangeDatabase[dep.name];

  if (!changes) {
    return null;
  }

  const currentMajor = parseInt(dep.requestedVersion.split('.')[0]);
  const currentMinor = parseInt(dep.requestedVersion.split('.')[1]) || 0;

  for (const change of changes) {
    const changeMajor = parseInt(change.version.split('.')[0]);
    const changeMinor = parseInt(change.version.split('.')[1]) || 0;

    // Check if current version is at or beyond breaking change version
    if (currentMajor > changeMajor ||
        (currentMajor === changeMajor && currentMinor >= changeMinor)) {
      return {
        package: dep.name,
        version: dep.requestedVersion,
        severity: change.severity,
        changes: change.changes,
      };
    }
  }

  return null;
}

export function analyzeBreakingChanges(
  dependencies: DependencyInfo[]
): BreakingChangeIssue[] {
  return dependencies
    .map(dep => detectBreakingChanges(dep))
    .filter((issue): issue is BreakingChangeIssue => issue !== null);
}
