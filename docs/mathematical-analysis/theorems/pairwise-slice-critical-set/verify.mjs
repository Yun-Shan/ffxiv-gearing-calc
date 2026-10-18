/**
 * verify.mjs —— pairwise-slice-critical-set 定理文档的验证入口。
 *
 * 说明：pairwise-slice-critical-set 与 pairwise-endpoint-max 共用同一个 canonical 整数模型
 * （docs/mathematical-analysis/verification/canonical-model.mjs）和同一套切片枚举代码；
 * 两个定理的数值证书（反例、关键集等式、平台结构、周期表、O(1) 上界族、canonical evaluator
 * 逐点对照）在本目录的配套脚本 ../pairwise-endpoint-max/verify.mjs 中一次性给出，
 * 以避免重复实现带来的“两份代码互相验证”的假象。本文件只转发执行该脚本。
 *
 * 运行：
 *   node --experimental-strip-types docs/mathematical-analysis/theorems/pairwise-slice-critical-set/verify.mjs
 *
 * 证明作用：有限域证书；反例本身即否证，其余为定理 README §6 代数证明的有限数值旁证。
 */
await import("../pairwise-endpoint-max/verify.mjs");
