export function liveMotionDuration(duration = 250) {
  return typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? duration : 0;
}
