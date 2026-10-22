import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { scanSourceForAccessibility } from '../src/analyzers/accessibility.js';

const scan = (src: string) => scanSourceForAccessibility(src, 'App.tsx').findings;

test('flags an icon-only Pressable with no label', () => {
  const f = scan(`<Pressable onPress={() => go()}><Icon name="x" /></Pressable>`);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.issue, 'missing-label');
  assert.equal(f[0]!.confidence, 'high');
});

test('a Pressable with visible Text children is labeled (RN derives the label)', () => {
  const f = scan(`<Pressable accessibilityRole="button" onPress={a}><Text>Save</Text></Pressable>`);
  assert.equal(f.length, 0);
});

test('accessibilityLabel / aria-label satisfy the check; missing role is informational', () => {
  assert.equal(scan(`<TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" onPress={a}><Icon/></TouchableOpacity>`).length, 0);
  const f = scan(`<TouchableOpacity aria-label="Close" onPress={a}><Icon/></TouchableOpacity>`);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.issue, 'missing-role');
  assert.equal(f[0]!.severity, 'info');
});

test('an arrow function containing > in props does not end the tag early', () => {
  const f = scan(`<Pressable onPress={() => a > b && go()}><Icon/></Pressable>`);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.issue, 'missing-label');
});

test('Image without alt/label is flagged; accessible={false} opts out', () => {
  assert.equal(scan(`<Image source={logo} />`).length, 1);
  assert.equal(scan(`<Image source={logo} accessible={false} />`).length, 0);
  assert.equal(scan(`<Image source={logo} accessibilityLabel="Logo" />`).length, 0);
});

test('Button with a title and TextInput with a placeholder are treated as labeled', () => {
  assert.equal(scan(`<Button title="Go" onPress={a} />`).length, 0);
  assert.equal(scan(`<TextInput placeholder="Email" />`).length, 0);
  assert.equal(scan(`<TextInput value={v} />`).length, 1);
});

test('a custom component with onPress and no label is reported at low confidence', () => {
  const f = scan(`<IconButton onPress={a} icon="trash" />`);
  assert.equal(f.length, 1);
  assert.equal(f[0]!.confidence, 'low');
});

test('reports line numbers and declared traits', () => {
  const f = scan(`const x = 1;\n\n<Pressable accessibilityRole="button" accessibilityHint="Deletes" onPress={a}><Icon/></Pressable>`);
  assert.equal(f[0]!.line, 3);
  assert.equal(f[0]!.declaredTraits.role, 'button');
});

test('an onPress inside a render prop does not make the parent component interactive', () => {
  const f = scan(`<FlatList data={d} renderItem={({ item }) => <Row onPress={() => go(item)} />} />`);
  assert.equal(f.filter((x) => x.component === 'FlatList').length, 0);
});

test('a template-literal accessibilityLabel containing ${...} is recognised', () => {
  const f = scan('<TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${item.name}`} onPress={a}><Icon/></TouchableOpacity>');
  assert.equal(f.length, 0);
});

test('a11y - a project-local Button with a label prop is not judged by react-native Button\'s title contract', () => {
  const local = `import { Button } from './Button';\nconst a = <Button label="Save" onPress={go} />;`;
  assert.equal(scanSourceForAccessibility(local, 'a.tsx').findings.length, 0);
  const core = `import { Button } from 'react-native';\nconst a = <Button onPress={go} />;`;
  assert.equal(scanSourceForAccessibility(core, 'b.tsx').findings.length, 1);
});
