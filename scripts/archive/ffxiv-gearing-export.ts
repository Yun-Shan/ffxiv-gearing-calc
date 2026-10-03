import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { parse } from "@babel/parser";
import type {
  Gearset,
  Job,
  JobLevel,
  MateriaGrade,
  Stat,
  Stats,
} from "../../reference/ffxiv-gearing/src/game.ts";
import type { EquipInfo, ParamInfo } from "./types.ts";

export type FfxivGearingMateria = [Stat, MateriaGrade] | null;

export type FfxivGearingGear = {
  id: number;
  materias: FfxivGearingMateria[];
  customStats?: Stats;
};

export type FfxivGearingGearset = {
  job: Job;
  jobLevel: JobLevel;
  syncLevel?: number;
  gears: FfxivGearingGear[];
};

export type ReverseEquipmentOptions = {
  rawBaseParams: readonly ParamInfo[];
  materiaSlotCount: number;
  advancedMelding: boolean;
  materiaGrade?: MateriaGrade;
  materiaValue: (baseParamId: number, grade: MateriaGrade) => number;
  statForBaseParam: (baseParamId: number) => Stat | undefined;
  customCandidates?: readonly EquipInfo[];
  projectCustomCandidate?: (candidate: EquipInfo) => readonly ParamInfo[];
};

const referenceShareUrl = new URL(
  "../../reference/ffxiv-gearing/src/share.ts",
  import.meta.url,
);
const referenceBase62Url = new URL(
  "../../reference/ffxiv-gearing/src/utils/base62.ts",
  import.meta.url,
);
const transpiledReferenceUrls = new Set([
  referenceShareUrl.href,
  referenceBase62Url.href,
]);

function transformReferenceTypeScript(source: string, url: string): string {
  const program = parse(source, {
    sourceType: "module",
    plugins: ["typescript"],
  }).program;
  const replacements: { start: number; end: number; source: string }[] = [];
  for (const statement of program.body) {
    if (statement.type !== "TSEnumDeclaration") continue;
    if (
      typeof statement.start !== "number" ||
      typeof statement.end !== "number"
    ) {
      throw new Error(`无法定位参考项目枚举：${statement.id.name}`);
    }
    const members = statement.members.map((member) => {
      if (
        member.id.type !== "Identifier" ||
        member.initializer?.type !== "NumericLiteral"
      ) {
        throw new Error(`参考项目枚举 ${statement.id.name} 出现不支持的成员`);
      }
      return `${member.id.name}: ${member.initializer.value}`;
    });
    replacements.push({
      start: statement.start,
      end: statement.end,
      source: `const ${statement.id.name} = Object.freeze({ ${members.join(", ")} });`,
    });
  }
  for (const replacement of replacements.reverse()) {
    source =
      source.slice(0, replacement.start) +
      replacement.source +
      source.slice(replacement.end);
  }
  return stripTypeScriptTypes(source, { mode: "strip", sourceUrl: url });
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL === referenceShareUrl.href &&
      specifier === "./utils/base62"
    ) {
      return { url: referenceBase62Url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!transpiledReferenceUrls.has(url)) return nextLoad(url, context);
    const source = transformReferenceTypeScript(
      readFileSync(new URL(url), "utf8"),
      url,
    );
    return { format: "module", source, shortCircuit: true };
  },
});

const referenceShare =
  await import("../../reference/ffxiv-gearing/src/share.ts");

function attributesById(attributes: readonly ParamInfo[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const attribute of attributes) {
    result.set(
      attribute.baseParamId,
      (result.get(attribute.baseParamId) ?? 0) + attribute.value,
    );
  }
  return result;
}

function sameAttributes(
  first: readonly ParamInfo[],
  second: readonly ParamInfo[],
): boolean {
  const firstById = attributesById(first);
  const secondById = attributesById(second);
  if (firstById.size !== secondById.size) return false;
  for (const [id, value] of firstById) {
    if (secondById.get(id) !== value) return false;
  }
  return true;
}

export function reverseEquipmentForFfxivGearing(
  equipment: EquipInfo,
  options: ReverseEquipmentOptions,
): FfxivGearingGear {
  if (options.customCandidates !== undefined) {
    const project =
      options.projectCustomCandidate ??
      ((candidate: EquipInfo) => candidate.baseParams);
    const matches = options.customCandidates.filter(
      (candidate) =>
        candidate.key === equipment.key &&
        sameAttributes(project(candidate), equipment.baseParams),
    );
    if (matches.length !== 1) {
      throw new Error(
        `自定义参数装备 ${equipment.itemId} 无法唯一反解：匹配 ${matches.length} 个候选`,
      );
    }

    const rawAttributes = attributesById(options.rawBaseParams);
    const selectedAttributes = attributesById(matches[0].baseParams);
    const customStats: Stats = {};
    for (const [baseParamId, value] of selectedAttributes) {
      const difference = value - (rawAttributes.get(baseParamId) ?? 0);
      if (difference < 0) {
        throw new Error(
          `自定义参数装备 ${equipment.itemId} 的属性 ${baseParamId} 低于原始值`,
        );
      }
      if (difference === 0) continue;
      const stat = options.statForBaseParam(baseParamId);
      if (stat === undefined) {
        throw new Error(
          `自定义参数装备 ${equipment.itemId} 包含未知属性 ${baseParamId}`,
        );
      }
      customStats[stat] = difference;
    }
    return { id: equipment.itemId, materias: [], customStats };
  }

  if (options.materiaGrade === undefined) {
    return { id: equipment.itemId, materias: [] };
  }

  const rawAttributes = attributesById(options.rawBaseParams);
  const finalAttributes = attributesById(equipment.baseParams);
  const materias: Exclude<FfxivGearingMateria, null>[] = [];
  for (const [baseParamId, finalValue] of finalAttributes) {
    const difference = finalValue - (rawAttributes.get(baseParamId) ?? 0);
    if (difference < 0) {
      throw new Error(
        `装备 ${equipment.itemId} 的属性 ${baseParamId} 低于原始值`,
      );
    }
    if (difference === 0) continue;

    const stat = options.statForBaseParam(baseParamId);
    if (stat === undefined) {
      throw new Error(
        `装备 ${equipment.itemId} 包含未知镶嵌属性 ${baseParamId}`,
      );
    }
    const materiaValue = options.materiaValue(
      baseParamId,
      options.materiaGrade,
    );
    if (materiaValue <= 0 || difference % materiaValue !== 0) {
      throw new Error(
        `装备 ${equipment.itemId} 的属性 ${baseParamId} 增量 ${difference} 无法按魔晶石值 ${materiaValue} 反解`,
      );
    }
    const count = difference / materiaValue;
    for (let index = 0; index < count; index++) {
      materias.push([stat, options.materiaGrade]);
    }
  }

  const expectedMateriaCount = options.advancedMelding
    ? 5
    : options.materiaSlotCount;
  if (materias.length !== expectedMateriaCount) {
    throw new Error(
      `装备 ${equipment.itemId} 反解出 ${materias.length} 颗魔晶石，预期 ${expectedMateriaCount} 颗`,
    );
  }
  return { id: equipment.itemId, materias };
}

export function stringifyFfxivGearingGearset(
  gearset: FfxivGearingGearset,
): string {
  return referenceShare.stringify(gearset as Gearset);
}

export function parseFfxivGearingGearset(
  encoded: string,
): ReturnType<typeof referenceShare.parse> {
  return referenceShare.parse(encoded);
}

export function createFfxivGearingUrl(gearset: FfxivGearingGearset): string {
  const encoded = stringifyFfxivGearingGearset(gearset);
  if (encoded === "") throw new Error("无法为无装备配装生成链接");
  return `https://asvel.github.io/ffxiv-gearing/?${encoded}`;
}
