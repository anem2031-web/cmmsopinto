/** Rollout requires the reviewed PMV2 simplified schema first. */
export function isPmv2SimplifiedEnabled() {
  return process.env.PMV2_SIMPLIFIED_ENABLED === "true";
}
