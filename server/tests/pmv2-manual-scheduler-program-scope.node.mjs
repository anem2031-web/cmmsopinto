import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript");
const root = process.cwd();
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pmv2-scheduler-scope-"));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function compile(sourceRel, outName, rewrites = []) {
  let js = ts.transpileModule(read(sourceRel), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [from, to] of rewrites) js = js.replaceAll(from, to);
  fs.writeFileSync(path.join(temp, outName), js);
}

compile("server/pmv2/checklists/schedule-config.ts", "schedule-config.mjs");
compile("server/pmv2/checklists/validation.ts", "validation.mjs", [
  ['"./schedule-config"', '"./schedule-config.mjs"'],
]);
compile("server/pmv2/checklists/recurrence.ts", "recurrence.mjs", [
  ['"./validation"', '"./validation.mjs"'],
  ['"./schedule-config"', '"./schedule-config.mjs"'],
]);
compile("server/pmv2/scheduler/engine.ts", "engine.mjs", [
  ['"../checklists/recurrence"', '"./recurrence.mjs"'],
  ['"../checklists/validation"', '"./validation.mjs"'],
  ['"../checklists/schedule-config"', '"./schedule-config.mjs"'],
]);

const { Pmv2SchedulerEngine } = await import(pathToFileURL(path.join(temp, "engine.mjs")).href);

class FakeRepository {
  programs = [
    { id: 1, title: "برنامج ألف", teamId: 10, checklistId: 101, createdAt: "2026-09-01 08:00:00" },
    { id: 2, title: "برنامج باء", teamId: 20, checklistId: 102, createdAt: "2026-09-01 08:00:00" },
    { id: 3, title: "برنامج مستقبلي", teamId: 30, checklistId: 103, createdAt: "2026-09-13 08:00:00" },
  ];
  items = [
    { id: 11, checklistId: 101, title: "فحص أ", sortOrder: 1, isRequired: 1, isActive: 1, frequency: "daily", frequencyValue: null, weekday: null, monthDay: null, anchorDate: null, scheduleConfigJson: null },
    { id: 21, checklistId: 102, title: "فحص ب", sortOrder: 1, isRequired: 1, isActive: 1, frequency: "daily", frequencyValue: null, weekday: null, monthDay: null, anchorDate: null, scheduleConfigJson: null },
    { id: 31, checklistId: 103, title: "فحص ج", sortOrder: 1, isRequired: 1, isActive: 1, frequency: "daily", frequencyValue: null, weekday: null, monthDay: null, anchorDate: null, scheduleConfigJson: null },
  ];
  taskSeq = 1;
  tasks = [];
  taskItems = [];

  async listActivePrograms() { return this.programs; }
  async listActiveChecklistItems(checklistId) { return this.items.filter((item) => item.checklistId === checklistId); }
  async listProgramTargets(programId) { return [{ id: programId * 100, siteId: programId, sectionId: null, assetId: null }]; }
  async getOrCreateTask(input) {
    const existing = this.tasks.find((task) => task.programId === input.programId && task.programTargetId === input.programTargetId && task.dueDate === input.dueDate);
    if (existing) return { id: existing.id, created: false };
    const task = { id: this.taskSeq++, ...input };
    this.tasks.push(task);
    return { id: task.id, created: true };
  }
  async ensureTaskItem(input) {
    const exists = this.taskItems.some((item) => item.taskId === input.taskId && item.sourceChecklistItemId === input.sourceChecklistItemId && item.scheduledDate === input.scheduledDate);
    if (exists) return false;
    this.taskItems.push(input);
    return true;
  }
}

const targetAdapter = {
  async listSites() { return []; },
  async listSections() { return []; },
  async listAssets() { return []; },
  async validateTarget() { return true; },
};

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await test("due-program picker returns only programs due on the selected date", async () => {
  const engine = new Pmv2SchedulerEngine(new FakeRepository(), targetAdapter);
  const due = await engine.listDueProgramsForDate("2026-09-12");
  assert.deepEqual(due, [
    { id: 1, title: "برنامج ألف" },
    { id: 2, title: "برنامج باء" },
  ]);
});

await test("manual selected-program run does not generate tasks for other due programs", async () => {
  const repo = new FakeRepository();
  const engine = new Pmv2SchedulerEngine(repo, targetAdapter);
  const result = await engine.runForDate("2026-09-12", 2);
  assert.equal(result.createdTasks, 1);
  assert.deepEqual(repo.tasks.map((task) => task.programId), [2]);
});

await test("normal scheduler run still processes all due programs", async () => {
  const repo = new FakeRepository();
  const engine = new Pmv2SchedulerEngine(repo, targetAdapter);
  const result = await engine.runForDate("2026-09-12");
  assert.equal(result.createdTasks, 2);
  assert.deepEqual(repo.tasks.map((task) => task.programId), [1, 2]);
});

await test("router exposes due-only optional program scope", async () => {
  const router = read("server/routers/pmv2/scheduler.ts");
  assert.match(router, /duePrograms:/);
  assert.match(router, /programId: z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
});

console.log(`PM V2 manual scheduler program scope: ${passed}/4 PASS`);
