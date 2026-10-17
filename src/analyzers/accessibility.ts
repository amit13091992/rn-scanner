import { relative } from 'node:path';
import { walkSourceFiles } from '../utils/sourceFiles.js';

export type AccessibilityIssue = 'missing-label' | 'missing-role';

export interface DeclaredTraits {
  role?: string;
  hint?: string;
  state?: string;
  accessible?: string;
}

export interface AccessibilityFinding {
  /** Project-relative path. */
  file: string;
  line: number;
  component: string;
  issue: AccessibilityIssue;
  /** `missing-label` is a warning (a screen reader announces nothing meaningful); `missing-role`
   *  is informational (the element is labeled but its native trait isn't declared). */
  severity: 'warning' | 'info';
  /** `high` for core React Native interactive components; `low` for a custom component that
   *  merely has an `onPress` prop — it may well forward its own children text as the label. */
  confidence: 'high' | 'low';
  /** The accessibility attributes written on this element in source — the static stand-in for
   *  the native accessibility traits the OS would report at runtime. */
  declaredTraits: DeclaredTraits;
}

export interface AccessibilityResult {
  findings: AccessibilityFinding[];
  filesScanned: number;
  elementsChecked: number;
  runtimeInspection: { available: false; reason: string };
}

const TOUCHABLES = new Set(['Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback', 'TouchableNativeFeedback']);
const IMAGES = new Set(['Image', 'ImageBackground']);
const CORE_INTERACTIVE = new Set([...TOUCHABLES, ...IMAGES, 'Switch', 'TextInput', 'Button']);

const LABEL_ATTRS = ['accessibilityLabel', 'aria-label', 'aria-labelledby', 'accessibilityLabelledBy', 'alt'];
const MAX_CHILDREN_SCAN = 8000;

interface ParsedTag {
  name: string;
  attrs: string;
  selfClosing: boolean;
  end: number;
}

/** Reads one JSX opening tag starting at `start` (the `<`), honoring quoted strings and nested
 *  `{...}` expressions so an arrow function containing `>` doesn't end the tag early. */
function parseOpeningTag(src: string, start: number): ParsedTag | null {
  const nameMatch = /^<([A-Z][\w.]*)/.exec(src.slice(start, start + 80));
  if (!nameMatch) return null;
  let i = start + nameMatch[0].length;
  let braces = 0;
  let quote: string | null = null;
  const attrsStart = i;

  for (; i < src.length && i - start < MAX_CHILDREN_SCAN; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (braces === 0 && (ch === '"' || ch === "'")) {
      quote = ch;
      continue;
    }
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '>' && braces === 0) {
      const selfClosing = src[i - 1] === '/';
      return {
        name: nameMatch[1],
        attrs: src.slice(attrsStart, selfClosing ? i - 1 : i),
        selfClosing,
        end: i + 1,
      };
    }
  }
  return null;
}

function childrenText(src: string, tag: ParsedTag): string {
  const open = new RegExp(`<${tag.name.replace('.', '\\.')}(?=[\\s>/])`, 'g');
  const close = `</${tag.name}>`;
  let depth = 1;
  let pos = tag.end;
  const limit = Math.min(src.length, tag.end + MAX_CHILDREN_SCAN);
  while (pos < limit) {
    const nextClose = src.indexOf(close, pos);
    if (nextClose === -1 || nextClose > limit) return src.slice(tag.end, limit);
    open.lastIndex = pos;
    let m: RegExpExecArray | null;
    while ((m = open.exec(src)) && m.index < nextClose) depth++;
    depth--;
    if (depth === 0) return src.slice(tag.end, nextClose);
    pos = nextClose + close.length;
  }
  return src.slice(tag.end, limit);
}

function attrValue(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name.replace('-', '\\-')}(?=[=\\s]|$)`).exec(attrs);
  if (!m) return undefined;
  let i = m.index + m[0].length;
  if (attrs[i] !== '=') return 'true';
  i++;
  const first = attrs[i];
  if (first === '"' || first === "'") {
    const end = attrs.indexOf(first, i + 1);
    return end === -1 ? undefined : attrs.slice(i + 1, end).trim();
  }
  if (first === '{') {
    // Balanced braces, so `${expr}` inside a template literal doesn't end the value early.
    let depth = 0;
    for (let j = i; j < attrs.length; j++) {
      if (attrs[j] === '{') depth++;
      else if (attrs[j] === '}' && --depth === 0) return attrs.slice(i + 1, j).trim();
    }
    return undefined;
  }
  return 'true';
}

/** Blanks out `{...}` and quoted values so a prop name is only matched at the tag's own top level —
 *  an `onPress` inside a `renderItem={...}` arrow function belongs to a different element. */
function topLevelAttrs(attrs: string): string {
  let out = '';
  let depth = 0;
  let quote: string | null = null;
  for (const ch of attrs) {
    if (quote) { if (ch === quote) quote = null; continue; }
    if (depth > 0) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      continue;
    }
    if (ch === '{') { depth = 1; out += '{'; continue; }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    out += ch;
  }
  return out;
}

function hasAnyAttr(attrs: string, names: string[]): boolean {
  return names.some((n) => attrValue(attrs, n) !== undefined);
}

function hiddenFromScreenReader(attrs: string): boolean {
  return (
    attrValue(attrs, 'accessible') === 'false' ||
    attrValue(attrs, 'accessibilityElementsHidden') === 'true' ||
    attrValue(attrs, 'aria-hidden') === 'true' ||
    ['no', 'no-hide-descendants'].includes(attrValue(attrs, 'importantForAccessibility')?.replace(/['"]/g, '') ?? '')
  );
}

function hasVisibleTextChild(children: string): boolean {
  if (/<Text[\s>]/.test(children)) return true;
  const plain = children.replace(/\{[^}]*\}/g, (m) => (/\bt\(|`|['"]/.test(m) ? 'x' : '')).replace(/<[^>]*>/g, '');
  return /\S/.test(plain);
}

function traitsOf(attrs: string): DeclaredTraits {
  const traits: DeclaredTraits = {};
  const role = attrValue(attrs, 'accessibilityRole') ?? attrValue(attrs, 'role');
  const hint = attrValue(attrs, 'accessibilityHint');
  const state = attrValue(attrs, 'accessibilityState') ?? attrValue(attrs, 'aria-checked');
  const accessible = attrValue(attrs, 'accessible');
  if (role !== undefined) traits.role = role;
  if (hint !== undefined) traits.hint = hint;
  if (state !== undefined) traits.state = state;
  if (accessible !== undefined) traits.accessible = accessible;
  return traits;
}

export function scanSourceForAccessibility(src: string, file: string): { findings: AccessibilityFinding[]; checked: number } {
  const findings: AccessibilityFinding[] = [];
  let checked = 0;
  const tagStart = /<([A-Z][\w.]*)/g;
  let m: RegExpExecArray | null;

  while ((m = tagStart.exec(src))) {
    const tag = parseOpeningTag(src, m.index);
    if (!tag) continue;
    const core = CORE_INTERACTIVE.has(tag.name);
    const hasPress = /(?:^|\s)(onPress|onLongPress)(?=[=\s])/.test(topLevelAttrs(tag.attrs));
    if (!core && !hasPress) continue;
    checked++;
    if (hiddenFromScreenReader(tag.attrs)) continue;

    const line = src.slice(0, m.index).split('\n').length;
    const traits = traitsOf(tag.attrs);
    const hasLabel = hasAnyAttr(tag.attrs, LABEL_ATTRS);
    const confidence = core ? 'high' : 'low';
    let labelled = hasLabel;

    if (!labelled) {
      if (tag.name === 'Button') labelled = hasAnyAttr(tag.attrs, ['title']);
      else if (tag.name === 'TextInput') labelled = hasAnyAttr(tag.attrs, ['placeholder']);
      else if (IMAGES.has(tag.name)) labelled = false;
      else if (!tag.selfClosing) labelled = hasVisibleTextChild(childrenText(src, tag));
    }

    if (!labelled) {
      findings.push({ file, line, component: tag.name, issue: 'missing-label', severity: 'warning', confidence, declaredTraits: traits });
    } else if (TOUCHABLES.has(tag.name) && !traits.role) {
      findings.push({ file, line, component: tag.name, issue: 'missing-role', severity: 'info', confidence, declaredTraits: traits });
    }
  }
  return { findings, checked };
}

/**
 * Static scan of project source for interactive elements that a screen reader can't describe.
 * Regex/tag-scanner based (no AST, no new dependency) like `unused`/`legacy-apis` — so it sees
 * what's written in JSX, not what renders: a label passed through a spread (`{...props}`) or a
 * wrapper component is invisible here, which is why custom-component findings are `low`
 * confidence. Native traits and on-screen frames only exist in a running app (iOS
 * UIAccessibility / Android AccessibilityNodeInfo); `declaredTraits` reports what the source
 * declares instead, and `runtimeInspection` says so explicitly rather than implying coverage.
 */
export function analyzeAccessibility(cwd: string): AccessibilityResult {
  const findings: AccessibilityFinding[] = [];
  let elementsChecked = 0;

  const { filesScanned } = walkSourceFiles(cwd, (filePath, content) => {
    if (!/\.(jsx|tsx|js|ts)$/.test(filePath) || !content.includes('<')) return;
    const r = scanSourceForAccessibility(content, relative(cwd, filePath));
    findings.push(...r.findings);
    elementsChecked += r.checked;
  });

  return {
    findings,
    filesScanned,
    elementsChecked,
    runtimeInspection: {
      available: false,
      reason: 'Native accessibility traits and element frames exist only in a running app (UIAccessibility / AccessibilityNodeInfo); this scan reports what the source declares.',
    },
  };
}
