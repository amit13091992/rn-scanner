import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { Profiler } from '../src/utils/profiler.js';

test('Profiler - disabled profiler runs the step and records nothing', async () => {
  const profiler = new Profiler(false);
  const result = await profiler.time('step', () => 42);

  assert.equal(result, 42);
  assert.deepEqual(profiler.report(), []);
  assert.equal(profiler.totalMs(), 0);
});

test('Profiler - enabled profiler records each step with its own label', async () => {
  const profiler = new Profiler(true);
  await profiler.time('first', () => 1);
  await profiler.time('second', async () => 2);

  const report = profiler.report();
  assert.equal(report.length, 2);
  assert.deepEqual(report.map((e) => e.label).sort(), ['first', 'second']);
  report.forEach((e) => assert.ok(e.durationMs >= 0));
});

test('Profiler - report() is sorted slowest first', async () => {
  const profiler = new Profiler(true);
  await profiler.time('fast', () => {});
  await profiler.time('slow', async () => {
    await new Promise((r) => setTimeout(r, 15));
  });

  const [first, second] = profiler.report();
  assert.equal(first!.label, 'slow');
  assert.equal(second!.label, 'fast');
});

test('Profiler - totalMs sums every recorded step', async () => {
  const profiler = new Profiler(true);
  await profiler.time('a', () => {});
  await profiler.time('b', () => {});

  const total = profiler.report().reduce((sum, e) => sum + e.durationMs, 0);
  assert.equal(profiler.totalMs(), total);
});

test('Profiler - propagates a thrown error from the timed step', async () => {
  const profiler = new Profiler(true);
  await assert.rejects(
    profiler.time('failing', () => {
      throw new Error('boom');
    }),
    /boom/
  );
});
