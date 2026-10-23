import type { JointMipJob } from "./ring-domain.ts";
import type { JointRingSplit } from "./ring-domain.ts";
import type { prepareExactMipModel } from "./model-preparation.ts";
import type { SharedSlotProjection } from "../types.ts";
import type { EquipInfo } from "../types.ts";
import type { FoodInfo } from "../types.ts";
import type { ExactMipResult } from "./types.ts";
import type { LinearMipProgress } from "../linear-mip.ts";
import type { HighsCallbackTrace } from "../linear-mip.ts";

export type JointPreparedJob = {
  /** 仅供联合求解使用的槽位布局；公开结果会根据 originalJob 重建。 */
  job: JointMipJob;
  originalJob: JointMipJob;
  ringSplit?: JointRingSplit;
  prepared: NonNullable<Awaited<ReturnType<typeof prepareExactMipModel>>>;
};

export type JointSearchOptions = {
  jobs: readonly JointMipJob[];
  commonSlots: readonly string[];
  commonSlotProjections?: readonly SharedSlotProjection[];
  sharedFood: boolean;
  equipmentIdentity: (equipment: EquipInfo) => string;
  foodIdentity: (food: FoodInfo) => string;
  objective: "damage" | "dps";
  /** 完全共享且未强制指定的戒指对所用的内部对称性破除策略。 */
  canonicalSharedRingPair?: boolean;
  /** 默认为当前精确松弛；禁用时跳过可选的配对上界约束行。 */
  ratioUpperPairPolicy?: "default" | "disabled";
  /** 精确优化器内部路径；仅添加严格且替换安全的首饰对支配约束行。 */
  sharedAccessoryPairDominance?: boolean;
  initialResults?: readonly ExactMipResult[];
  maxSearchMs?: number;
  onProgress?: (message: string) => void;
  onSolverProgress?: (event: LinearMipProgress) => void;
  onSolverCallback?: (event: HighsCallbackTrace) => void;
  isCancelled?: () => boolean;
};

export type ExactRatio = { numerator: bigint; denominator: bigint };
