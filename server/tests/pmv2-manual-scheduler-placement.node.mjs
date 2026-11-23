import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('client/src/pages/pmv2/ScheduledMaintenance.tsx', 'utf8');
const start = source.indexOf('function TasksTab');
const end = source.indexOf('export default function ScheduledMaintenance', start);
const tab = source.slice(start, end);

test('the scheduled task list keeps search, filters, and refresh after removal of the manual scheduler panel', () => {
  assert.ok(start >= 0 && end > start, 'the scheduled tasks tab should exist');
  assert.match(tab, /Label>\{p\("بحث"\)\}/);
  assert.match(tab, /Label>\{p\("الفريق"\)\}/);
  assert.match(tab, /Label>\{p\("من تاريخ"\)\}/);
  assert.match(tab, /Label>\{p\("إلى تاريخ"\)\}/);
  assert.match(tab, /p\("تحديث المهام"\)/);
  assert.doesNotMatch(tab, /تشغيل الجدولة اليدوي للاختبار|trpc\.pmv2\.scheduler\./);
});
