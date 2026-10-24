import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildGeneratedData, projectRuntimeData, writeRuntimeGeneratedData } from '../update-data.mjs';
import { decodeGeneratedData } from '../../src/data/binary/decode.ts';

const runtimeKeys = new Set(['gearIndexesByMainStat', 'gearLevelByRecordIndex', 'gearMinLevel', 'gearMaxLevel',
  'gearStatNames', 'gearPhysicalGroupRanges', 'getGearAtRecordIndex', 'getGearById']);

function mcpSource(sheet, fields, rowIds, gameVersion) {
  return {
    kind: 'mcp',
    server: 'ffxiv-mcp-lumina',
    sheet,
    fields,
    rowIds,
    gameVersion,
    validatedVersion: gameVersion,
    queriedAt: 'fixture-time',
  };
}

async function sourceRichPayloadFromCurrentBin() {
  const bytes = new Uint8Array(await readFile(new URL('../../src/data/generated-data.bin', import.meta.url)));
  const data = await decodeGeneratedData(bytes);
  const payload = {
    ...Object.fromEntries(Object.entries(data).filter(([key]) => !runtimeKeys.has(key))),
    gears: Array.from(data.gears),
  };
  const version = payload.version;
  const referenceSource = {
    kind: 'reference',
    repository: 'https://example.test/ffxiv-gearing.git',
    commit: 'fixture-commit',
    importedAt: 'fixture-time',
    sourceFiles: ['src/game.ts'],
    note: 'fixture source record',
  };
  const bluDamageSource = {
    ...referenceSource,
    sourceFiles: ['data/out/bluMdmgAdditions.js'],
    note: 'MCP fixture confirms the mapping is not available in this source.',
  };
  payload.provenance = {
    repository: referenceSource.repository,
    commit: referenceSource.commit,
    importedAt: referenceSource.importedAt,
    sourceFiles: ['fixture/data'],
    sources: [
      mcpSource('ContentFinderCondition', [
        'Name', 'ItemLevelSync', 'ClassJobLevelSync', 'JournalGenre', 'ContentType',
        'ContentUICategory', 'HighEndDuty', 'AllowUndersized', 'ContentLinkType',
      ], [1], version),
      mcpSource('ContentType', ['Name'], [1], version),
      mcpSource('ContentUICategory', ['Name'], [1], version),
      mcpSource('ParamGrow', ['ItemLevelSync'], [1], version),
      mcpSource('Item', ['Icon'], [payload.gears[0].id], version),
      bluDamageSource,
    ],
  };
  payload.gears = payload.gears.map((gear) => ({
    ...gear,
    sourceFile: 'fixture/gears.js',
    dataSources: [mcpSource('Item', ['Icon', 'CanBeHq'], [gear.id], version)],
  }));
  payload.foods = payload.foods.map((food) => ({
    ...food,
    sourceFile: 'fixture/foods.js',
    dataSources: [mcpSource('Item', ['Icon'], [food.id], version)],
  }));
  payload.jobSchemas = Object.fromEntries(Object.entries(payload.jobSchemas).map(([jobId, schema]) => [
    jobId,
    {
      ...schema,
      dataSources: [
        mcpSource('ClassJob', ['Name', 'Abbreviation', 'PrimaryStat', 'JobType'], [payload.jobs[jobId].id], version),
        referenceSource,
      ],
    },
  ]));
  return payload;
}

test('query and update modules can be imported without querying or writing production data', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    'await import("./scripts/query-mcp-lumina.mjs"); await import("./scripts/update-data.mjs");'], {
    cwd: new URL('../..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, FFXIV_MCP_LUMINA_COMMAND: 'nonexistent-mcp-test-command' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('runtime projection drops only generation audit fields and preserves the acquisition source', () => {
  const payload = {
    version: 'fixture-version',
    provenance: {
      repository: 'https://example.test/repo.git',
      commit: 'fixture-commit',
      importedAt: 'fixture-time',
      sourceFiles: ['data/out/gears.js'],
      sources: [{ kind: 'reference' }],
      queryEvidence: { queries: [] },
    },
    gears: [{ id: 1, source: '点数/诗学', sourceFile: 'data/out/gears.js', dataSources: [{ kind: 'reference' }] }],
    foods: [{ id: 2, sourceFile: 'data/out/foods.js', dataSources: [{ kind: 'reference' }] }],
    jobSchemas: { PLD: { id: 'PLD', mainStat: 'STR', role: 'tank', dataSources: [{ kind: 'mcp' }] } },
  };

  const runtime = projectRuntimeData(payload);

  assert.deepEqual(runtime.provenance, {
    repository: payload.provenance.repository,
    commit: payload.provenance.commit,
    importedAt: payload.provenance.importedAt,
  });
  assert.equal(runtime.gears[0].source, '点数/诗学');
  assert.equal(Object.hasOwn(runtime.gears[0], 'sourceFile'), false);
  assert.equal(Object.hasOwn(runtime.gears[0], 'dataSources'), false);
  assert.equal(Object.hasOwn(runtime.foods[0], 'sourceFile'), false);
  assert.equal(Object.hasOwn(runtime.foods[0], 'dataSources'), false);
  assert.equal(runtime.jobSchemas.PLD.mainStat, 'STR');
  assert.equal(runtime.jobSchemas.PLD.role, 'tank');
  assert.equal(Object.hasOwn(runtime.jobSchemas.PLD, 'JobType'), false);
  assert.equal(Object.hasOwn(runtime.jobSchemas.PLD, 'attackStat'), false);
  assert.equal(Object.hasOwn(runtime.jobSchemas.PLD, 'dataSources'), false);
});

test('generation entrypoint requires upstream source records before runtime writing', async () => {
  const runtimeOnly = {
    version: 'fixture-version',
    provenance: {
      repository: 'fixture-repository',
      commit: 'fixture-commit',
      importedAt: 'fixture-time',
      sourceFiles: ['fixture.js'],
      sources: [],
    },
    sync: { levels: [{}], groups: [{}] },
  };
  await assert.rejects(buildGeneratedData(runtimeOnly), /provenance 缺少来源记录/);
});

test('source-rich generation validates audit shapes and preserves the output on failure', async () => {
  const payload = await sourceRichPayloadFromCurrentBin();
  const scratch = fileURLToPath(new URL('../../.tmp/data-update-tests/', import.meta.url));
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'update-'));
  const target = join(directory, 'generated.bin');
  const initialBytes = new Uint8Array([4, 5, 6]);
  const invalidCases = [
    ['missing gear sourceFile', (value) => { delete value.gears[0].sourceFile; }, /装备 \d+ 缺少逐件来源记录/],
    ['missing gear dataSources', (value) => { delete value.gears[0].dataSources; }, /装备 \d+ 缺少逐件来源记录/],
    ['empty gear dataSources', (value) => { value.gears[0].dataSources = []; }, /装备 \d+ 缺少逐件来源记录/],
    ['invalid source object', (value) => { value.gears[0].dataSources = [null]; }, /含无效逐件来源记录/],
    ['invalid rowIds', (value) => { value.gears[0].dataSources[0].rowIds = '1'; }, /rowIds 无效/],
    ['missing CanBeHq source field', (value) => { value.gears[0].dataSources[0].fields = ['Icon']; }, /缺少同版本 MCP Item.CanBeHq 来源记录/],
    ['cross-version CanBeHq source', (value) => { value.gears[0].dataSources[0].gameVersion = 'older-fixture'; }, /缺少同版本 MCP Item.CanBeHq 来源记录/],
    ['invalid sourceFiles', (value) => { value.gears[0].dataSources[0].sourceFiles = 'fixture.js'; }, /sourceFiles 无效/],
    ['invalid provenance source', (value) => { value.provenance.sources[0] = []; }, /provenance 来源 0 结构无效/],
    ['missing food dataSources', (value) => { delete value.foods[0].dataSources; }, /食物 \d+ 缺少逐件来源记录/],
    ['invalid job dataSources', (value) => { value.jobSchemas.PLD.dataSources = [null]; }, /职业 PLD 缺少或包含无效字段来源记录/],
    ['missing ClassJob.PrimaryStat source field', (value) => { value.jobSchemas.PLD.dataSources[0].fields = ['Name', 'Abbreviation', 'JobType']; }, /职业 PLD 缺少与 MCP ClassJob.PrimaryStat 对应的同版本来源记录/],
    ['missing ClassJob.JobType source field', (value) => { value.jobSchemas.PLD.dataSources[0].fields = ['Name', 'Abbreviation', 'PrimaryStat']; }, /职业 PLD 缺少与 MCP ClassJob.PrimaryStat 对应的同版本来源记录/],
    ['cross-version ClassJob.PrimaryStat source', (value) => { value.jobSchemas.PLD.dataSources[0].gameVersion = 'older-fixture'; }, /职业 PLD 缺少与 MCP ClassJob.PrimaryStat 对应的同版本来源记录/],
    ['wrong ClassJob.PrimaryStat rowId', (value) => { value.jobSchemas.PLD.dataSources[0].rowIds = [value.jobs.PLD.id + 1]; }, /职业 PLD 缺少与 MCP ClassJob.PrimaryStat 对应的同版本来源记录/],
  ];

  try {
    await writeFile(target, initialBytes);
    for (const [label, mutate, expectedError] of invalidCases) {
      const broken = structuredClone(payload);
      mutate(broken);
      await assert.rejects(buildGeneratedData(broken, { outputPath: target }), expectedError, label);
      assert.deepEqual(new Uint8Array(await readFile(target)), initialBytes, label);
    }

    const generated = await buildGeneratedData(payload, { outputPath: target });
    const result = await decodeGeneratedData(new Uint8Array(await readFile(target)));
    assert.equal(generated.gearCount, payload.gears.length);
    assert.deepEqual(result.provenance, {
      repository: payload.provenance.repository,
      commit: payload.provenance.commit,
      importedAt: payload.provenance.importedAt,
    });
    assert.equal(result.gears.length, payload.gears.length);
    assert.deepEqual(result.gears[0].source, payload.gears[0].source);
    for (const schema of Object.values(result.jobSchemas))
      assert.equal(Object.hasOwn(schema, 'attackStat'), false);
    assert.equal(Object.hasOwn(result.gears[0], 'sourceFile'), false);
    assert.equal(Object.hasOwn(result.gears[0], 'dataSources'), false);
  } finally {
    await unlink(target).catch(() => {});
    await rmdir(directory);
  }
});

test('the runtime writer rejects generation audit fields and preserves an existing file', async () => {
  const scratch = fileURLToPath(new URL('../../.tmp/data-update-tests/', import.meta.url));
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'update-'));
  const target = join(directory, 'generated.bin');
  try {
    const initialBytes = new Uint8Array([1, 2, 3]);
    await writeFile(target, initialBytes);
    const auditPayload = {
      provenance: { sources: [] },
      gears: [{ sourceFile: 'fixture.js' }],
      foods: [],
      jobSchemas: {},
    };
    await assert.rejects(writeRuntimeGeneratedData(auditPayload, { outputPath: target }), /仍包含生成审计字段/);
    assert.deepEqual(new Uint8Array(await readFile(target)), initialBytes);
  } finally {
    await unlink(target).catch(() => {});
    await rmdir(directory);
  }
});

test('the runtime writer verifies current final binary bytes before replacement', async () => {
  const bytes = new Uint8Array(await readFile(new URL('../../src/data/generated-data.bin', import.meta.url)));
  const data = await decodeGeneratedData(bytes);
  const scratch = fileURLToPath(new URL('../../.tmp/data-update-tests/', import.meta.url));
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(scratch, 'update-'));
  const target = join(directory, 'generated.bin');
  try {
    const payload = { ...Object.fromEntries(Object.entries(data).filter(([key]) => !runtimeKeys.has(key))),
      gears: Array.from(data.gears) };
    await writeFile(target, bytes);
    const broken = { ...payload, jobs: {} };
    await assert.rejects(writeRuntimeGeneratedData(broken, { outputPath: target }));
    assert.deepEqual(new Uint8Array(await readFile(target)), bytes);
    const generated = await writeRuntimeGeneratedData(payload, { outputPath: target });
    const result = await decodeGeneratedData(new Uint8Array(await readFile(target)));
    assert.equal(result.gears.length, payload.gears.length);
    assert.deepEqual(result.getGearAtRecordIndex(0), payload.gears[0]);
    assert.deepEqual(result.provenance, data.provenance);
    assert.equal(Object.hasOwn(result.gears[0], 'sourceFile'), false);
    assert.equal(Object.hasOwn(result.gears[0], 'dataSources'), false);
    assert.equal(generated.gearCount, payload.gears.length);
  } finally {
    await unlink(target).catch(() => {});
    await rmdir(directory);
  }
});
