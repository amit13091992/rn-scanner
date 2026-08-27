import { satisfies, gt, lt, eq, valid, coerce } from 'semver';
import type { VersionParseResult, VersionRange, VersionComparisonResult } from '../types/versioning.js';

export function parseVersion(versionString: string): VersionParseResult {
  const original = versionString;
  let normalized = versionString.trim();

  if (normalized.startsWith('v')) {
    normalized = normalized.substring(1);
  }

  normalized = normalized.replace(/^[\^~>=<\s]+/, '').split(/[\s,]/)[0];

  const parsed = valid(coerce(normalized));
  if (!parsed) {
    return {
      major: 0,
      minor: 0,
      patch: 0,
      original,
      normalized,
    };
  }

  const parts = parsed.split('.');
  return {
    major: parseInt(parts[0], 10) || 0,
    minor: parseInt(parts[1], 10) || 0,
    patch: parseInt(parts[2], 10) || 0,
    original,
    normalized: parsed,
  };
}

export function compareVersions(v1: string, v2: string): number {
  try {
    const clean1 = normalizeVersion(v1);
    const clean2 = normalizeVersion(v2);

    if (valid(clean1) && valid(clean2)) {
      if (gt(clean1, clean2)) return 1;
      if (lt(clean1, clean2)) return -1;
      if (eq(clean1, clean2)) return 0;
    }

    const p1 = parseVersion(v1);
    const p2 = parseVersion(v2);

    if (p1.major !== p2.major) return p1.major - p2.major;
    if (p1.minor !== p2.minor) return p1.minor - p2.minor;
    if (p1.patch !== p2.patch) return p1.patch - p2.patch;

    return 0;
  } catch {
    return 0;
  }
}

export function versionInRange(version: string, rangeString: string): boolean {
  try {
    const cleanVersion = normalizeVersion(version);
    const cleanRange = normalizeRange(rangeString);

    if (!cleanVersion || !cleanRange) {
      return false;
    }

    return satisfies(cleanVersion, cleanRange);
  } catch {
    return false;
  }
}

export function normalizeVersion(version: string): string {
  let normalized = version.trim();

  if (normalized.startsWith('v')) {
    normalized = normalized.substring(1);
  }

  normalized = normalized.replace(/^[\s]*/, '').split(/[\s,]/)[0];

  const parsed = valid(coerce(normalized));
  return parsed || '';
}

export function normalizeRange(range: string): string {
  let normalized = range.trim();

  if (normalized.startsWith('v')) {
    normalized = normalized.substring(1);
  }

  if (normalized === '' || normalized === '*') {
    return '*';
  }

  if (normalized.match(/^\d+(\.\d+)?(\.\d+)?$/)) {
    return normalized;
  }

  return normalized;
}

export function parseVersionRange(rangeString: string): VersionRange {
  const normalized = normalizeRange(rangeString);

  if (normalized === '*' || normalized === '') {
    return {
      isInclusive: { min: true, max: true },
      type: 'range',
    };
  }

  const isExact = /^\d+\.\d+\.\d+$/.test(normalized);
  if (isExact) {
    const parsed = parseVersion(normalized);
    return {
      min: parsed,
      max: parsed,
      isInclusive: { min: true, max: true },
      type: 'exact',
    };
  }

  if (normalized.startsWith('^')) {
    const version = normalizeVersion(normalized.substring(1));
    if (version) {
      const parsed = parseVersion(version);
      return {
        min: parsed,
        isInclusive: { min: true, max: false },
        type: 'caret',
      };
    }
  }

  if (normalized.startsWith('~')) {
    const version = normalizeVersion(normalized.substring(1));
    if (version) {
      const parsed = parseVersion(version);
      return {
        min: parsed,
        isInclusive: { min: true, max: false },
        type: 'tilde',
      };
    }
  }

  if (normalized.startsWith('>=')) {
    const parts = normalized.split(/\s+/).filter(p => p.length > 0);
    const minVersion = normalizeVersion(parts[0].substring(2));
    if (minVersion && parts.length === 1) {
      return {
        min: parseVersion(minVersion),
        isInclusive: { min: true, max: true },
        type: 'range',
      };
    }
    if (minVersion && parts.length >= 2) {
      const maxOp = parts[1].substring(0, 1);
      const maxVersion = normalizeVersion(parts[1].substring(1));
      if (maxVersion) {
        return {
          min: parseVersion(minVersion),
          max: parseVersion(maxVersion),
          isInclusive: { min: true, max: maxOp === '<' ? false : true },
          type: 'range',
        };
      }
    }
  }

  if (normalized.startsWith('>')) {
    const version = normalizeVersion(normalized.substring(1));
    if (version) {
      return {
        min: parseVersion(version),
        isInclusive: { min: false, max: true },
        type: 'range',
      };
    }
  }

  if (normalized.startsWith('<=')) {
    const version = normalizeVersion(normalized.substring(2));
    if (version) {
      return {
        max: parseVersion(version),
        isInclusive: { min: true, max: true },
        type: 'range',
      };
    }
  }

  if (normalized.startsWith('<')) {
    const version = normalizeVersion(normalized.substring(1));
    if (version) {
      return {
        max: parseVersion(version),
        isInclusive: { min: true, max: false },
        type: 'range',
      };
    }
  }

  if (normalized.includes('x') || normalized.includes('*')) {
    const parts = normalized.split(/[.x*]/);
    const major = parseInt(parts[0], 10) || 0;
    const minor = parseInt(parts[1], 10) || 0;

    return {
      min: { major, minor, patch: 0, original: normalized, normalized },
      max: { major, minor: minor + 1, patch: 0, original: normalized, normalized },
      isInclusive: { min: true, max: false },
      type: 'wildcard',
    };
  }

  return {
    isInclusive: { min: true, max: true },
    type: 'range',
  };
}

export function versionInRangeObject(
  version: string,
  range: VersionRange
): VersionComparisonResult {
  const parsed = parseVersion(version);
  const cleanVersion = normalizeVersion(version);

  if (!cleanVersion) {
    return {
      isInRange: false,
      reason: 'Invalid version format',
      details: {
        installedVersion: parsed,
        affectedRange: range,
      },
    };
  }

  if (!range.min && !range.max) {
    return {
      isInRange: true,
      reason: 'No bounds specified',
      details: {
        installedVersion: parsed,
        affectedRange: range,
      },
    };
  }

  if (range.min) {
    const comparison = compareVersions(cleanVersion, `${range.min.major}.${range.min.minor}.${range.min.patch}`);
    if (comparison < 0) {
      return {
        isInRange: false,
        reason: `Version below minimum (${range.min.normalized})`,
        details: {
          installedVersion: parsed,
          affectedRange: range,
        },
      };
    }
  }

  if (range.max) {
    const comparison = compareVersions(cleanVersion, `${range.max.major}.${range.max.minor}.${range.max.patch}`);
    if (comparison > 0) {
      return {
        isInRange: false,
        reason: `Version above maximum (${range.max.normalized})`,
        details: {
          installedVersion: parsed,
          affectedRange: range,
        },
      };
    }
    if (comparison === 0 && !range.isInclusive.max) {
      return {
        isInRange: false,
        reason: `Version equals exclusive maximum (${range.max.normalized})`,
        details: {
          installedVersion: parsed,
          affectedRange: range,
        },
      };
    }
  }

  return {
    isInRange: true,
    reason: 'Version is in affected range',
    details: {
      installedVersion: parsed,
      affectedRange: range,
    },
  };
}
