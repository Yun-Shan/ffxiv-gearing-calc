// Additional MIP scenarios. Current accepted results are stored in acceptance-baseline.json.

const ALL_NON_WEAPON_SLOTS = [
  "head", "body", "hands", "legs", "feet", "earrings", "necklace", "bracelet", "ring", "ring2",
];

// Preserve the complete candidate restrictions of the original A/B/C/D inputs.
const EXCLUDED_GEAR_IDS = [
  32669, 32670, 32671, 32672, 32673, 32674, 32675, 32676, 32677, 32678,
  32679, 32680, 32681, 32682, 32683, 32684, 32685, 32686,
  33462, 33463, 33464, 33465, 33466, 33467, 33468, 33469, 33470, 33471,
  33472, 33473, 33474, 33475, 33476, 33477, 33478, 33479,
  39920, 39921, 39922, 39923, 39924, 39925, 39926, 39927, 39928, 39929,
  39930, 39931, 39932, 39933, 39934, 39935, 39936, 39937, 39938, 39939,
  40932, 40933, 40934, 40935, 40936, 40937, 40938, 40939, 40940, 40941,
  40942, 40943, 40944, 40945, 40946, 40947, 40948, 40949, 40950, 40951,
  51000, 51001, 51002, 51003, 51004, 51005, 51006, 51007, 51008, 51009,
  51010, 51011, 51012, 51013, 51014, 51015, 51016, 51017, 51018, 51019,
  51020, 51021,
];

function constrainedJobs(gcds) {
  return Object.fromEntries(Object.entries(gcds).map(([job, gcd]) => [job, {
    gcdChoices: [gcd],
    excludedGearIds: [...EXCLUDED_GEAR_IDS],
  }]));
}

export const EXISTING_MIP_CASE_IDS = [
  "single-blm-sync735-730-795-damage",
  "single-brd-unsynced-770-795-dps",
  "vpr-mch-sync735-rings-pair-dps",
  "vpr-mch-sync735-wide715-795-rings-dps",
  "brd-dnc-mch-vpr-sync735-wide715-795-shared-accessories-dps",
  "brd-dnc-mch-nin-vpr-sync735-wide715-795-shared-accessories-dps",
];

export const MIP_CASES = [
  {
    id: "custom-b",
    title: "BLM 单职业 B，同步 530，500–530，GCD 2.45，原装备排除，damage",
    jobs: ["BLM"], minItemLevel: 500, maxItemLevel: 530, syncLevel: 530,
    objective: "damage", metric: "damagePerPotency",
    jobConstraints: constrainedJobs({ BLM: 2.45 }),
    commonSlots: [], foodStrategy: "independent",
    strategyTags: ["mip", "single", "job-count-1", "sync", "gcd-constrained", "objective-damage"],
  },
  {
    id: "custom-c",
    title: "WAR+DRK+GNB 三坦 C，同步 530，500–530，全共享，GCD 2.50，damage",
    jobs: ["WAR", "DRK", "GNB"], minItemLevel: 500, maxItemLevel: 530, syncLevel: 530,
    objective: "damage",
    jobConstraints: constrainedJobs({ WAR: 2.5, DRK: 2.5, GNB: 2.5 }),
    commonSlots: ALL_NON_WEAPON_SLOTS, foodStrategy: "shared",
    strategyTags: ["mip", "joint", "joint-3", "job-count-3", "tank-group", "sync", "shared-equipment", "shared-food", "gcd-constrained", "objective-damage"],
  },
  {
    id: "custom-d",
    title: "WAR+DRK+GNB 三坦 D，无同步，770–780，全共享，各自 GCD，damage",
    jobs: ["WAR", "DRK", "GNB"], minItemLevel: 770, maxItemLevel: 780,
    objective: "damage",
    jobConstraints: constrainedJobs({ WAR: 2.5, DRK: 2.49, GNB: 2.48 }),
    commonSlots: ALL_NON_WEAPON_SLOTS, foodStrategy: "shared",
    strategyTags: ["mip", "joint", "joint-3", "job-count-3", "tank-group", "unsynced", "shared-equipment", "shared-food", "gcd-constrained", "objective-damage"],
  },
  {
    id: "forced-a",
    title: "PLD+WAR+DRK+GNB 四坦 A，无同步，780–785，全共享，GCD 2.50，强制 MIP，damage",
    jobs: ["PLD", "WAR", "DRK", "GNB"], minItemLevel: 780, maxItemLevel: 785,
    objective: "damage",
    jobConstraints: constrainedJobs({ PLD: 2.5, WAR: 2.5, DRK: 2.5, GNB: 2.5 }),
    requiredStrategies: { sharedStateSearch: "off" },
    commonSlots: ALL_NON_WEAPON_SLOTS, foodStrategy: "shared",
    strategyTags: ["mip", "joint", "joint-4", "job-count-4", "tank-group", "unsynced", "shared-equipment", "shared-food", "gcd-constrained", "objective-damage", "stress"],
  },
  {
    id: "holdout-food-independent",
    title: "VPR+MCH 独立食物留出案，同步 735，730–795，共享饰品和戒指对，DPS",
    jobs: ["VPR", "MCH"], minItemLevel: 730, maxItemLevel: 795, syncLevel: 735,
    objective: "dps",
    commonSlots: ["earrings", "necklace", "bracelet", "ring", "ring2"], foodStrategy: "independent",
    strategyTags: ["mip", "joint", "joint-2", "job-count-2", "sync", "shared-equipment", "independent-food", "objective-dps"],
  },
];
