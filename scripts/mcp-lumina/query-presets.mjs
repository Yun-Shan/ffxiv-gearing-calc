// Central field selections used by the production Lumina queries and their
// source records. Keep schema-only capability checks in the query flow: those
// checks intentionally retain the complete describe_sheet field lists.
export const itemReturnFields = [
  "Name",
  "DamagePhys",
  "DamageMag",
  "Delayms",
  "BaseParamValue[0]",
  "BaseParamValue[1]",
  "BaseParamValue[2]",
  "BaseParamValue[3]",
  "BaseParamValue[4]",
  "BaseParamValue[5]",
  "BaseParamValueSpecial[0]",
  "BaseParamValueSpecial[1]",
  "BaseParamValueSpecial[2]",
  "BaseParamValueSpecial[3]",
  "BaseParamValueSpecial[4]",
  "BaseParamValueSpecial[5]",
  "LevelEquip",
  "ClassJobCategory",
  "BaseParam[0]",
  "BaseParam[1]",
  "BaseParam[2]",
  "BaseParam[3]",
  "BaseParam[4]",
  "BaseParam[5]",
  "BaseParamSpecial[0]",
  "BaseParamSpecial[1]",
  "BaseParamSpecial[2]",
  "BaseParamSpecial[3]",
  "BaseParamSpecial[4]",
  "BaseParamSpecial[5]",
  "ItemSpecialBonus",
  "ItemSpecialBonusParam",
  "MateriaSlotCount",
  "IsAdvancedMeldingPermitted",
  "IsUnique",
  "SubStatCategory",
  "LevelItem",
  "EquipSlotCategory",
  "CanBeHq",
  "Icon",
  "Rarity",
  "ItemAction",
];

export const itemLevelReturnFields = [
  "Strength",
  "Dexterity",
  "Vitality",
  "Intelligence",
  "Mind",
  "Piety",
  "GP",
  "CP",
  "Craftsmanship",
  "Control",
  "Gathering",
  "Perception",
  "PhysicalDamage",
  "MagicalDamage",
  "Delay",
  "Tenacity",
  "DirectHitRate",
  "CriticalHit",
  "Determination",
  "SkillSpeed",
  "SpellSpeed",
];

export const itemActionReturnFields = [
  "Data[0]",
  "Data[1]",
  "Data[2]",
  "Data[3]",
  "Data[4]",
  "Data[5]",
  "Data[6]",
  "Data[7]",
  "Data[8]",
];

export const itemFoodReturnFields = [
  "Max[0]",
  "Max[1]",
  "Max[2]",
  "MaxHQ[0]",
  "MaxHQ[1]",
  "MaxHQ[2]",
  "BaseParam[0]",
  "BaseParam[1]",
  "BaseParam[2]",
  "Value[0]",
  "Value[1]",
  "Value[2]",
  "ValueHQ[0]",
  "ValueHQ[1]",
  "ValueHQ[2]",
  "IsRelative[0]",
  "IsRelative[1]",
  "IsRelative[2]",
];

export const mandervilleReturnFields = [
  "Materia[0]",
  "Materia[1]",
  "Materia[2]",
  "Materia[3]",
  "MateriaBigValueIndex[0]",
  "MateriaBigValueIndex[1]",
  "MateriaBigValueIndex[2]",
  "MateriaBigValueIndex[3]",
  "MateriaSmallValueIndex[0]",
  "MateriaSmallValueIndex[1]",
  "MateriaSmallValueIndex[2]",
  "MateriaSmallValueIndex[3]",
];

export const classJobReturnFields = [
  "Name",
  "Abbreviation",
  "ModifierHitPoints",
  "ModifierStrength",
  "ModifierVitality",
  "ModifierDexterity",
  "ModifierIntelligence",
  "ModifierMind",
  "ModifierPiety",
  "IsLimitedJob",
  "CanWearShield",
  "PrimaryStat",
  "JobType",
];

export const resistanceWeaponAdjustReturnFields = [
  "Image",
  "MaxTotalStats",
  "MaxEachStat",
  "BaseParam[0]",
  "BaseParam[1]",
  "BaseParam[2]",
  "BaseParam[3]",
  "Unknown0",
];

export const itemSpecialBonusReturnFields = ["Name", "RequirementText"];
export const classJobSearchReturnFields = ["Name", "Abbreviation"];
export const classJobSearchTextFields = ["Abbreviation"];
export const paramGrowReturnFields = ["ItemLevelSync"];
export const contentFinderConditionReturnFields = [
  "Name",
  "ItemLevelSync",
  "ClassJobLevelSync",
  "JournalGenre",
  "ContentType",
  "ContentUICategory",
  "HighEndDuty",
  "AllowUndersized",
  "ContentLinkType",
];
export const contentTypeReturnFields = ["Name"];
export const contentUICategoryReturnFields = ["Name"];
export const materiaReturnFields = [
  ...Array.from({ length: 16 }, (_, index) => `Value[${index}]`),
  "BaseParam",
];
export const foodItemSourceFields = ["Name", "LevelItem", "ItemAction", "Icon"];

export function classJobCategoryReturnFields(supportedJobs) {
  return [...supportedJobs];
}
