import { cubicOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

/** Shared timing for the set editor, so motion feels the same everywhere. */
export const EASE = cubicOut;

export const reducedMotion = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A duration in milliseconds, or 0 when the user's system asks for reduced motion. */
export const ms = (duration: number) => (reducedMotion() ? 0 : duration);

/** Slides a sheet in from the side it is coming from: 1 is forward (from the right), -1 is back. */
export function sheetIn(_node: Element, { direction = 1 }: { direction?: number } = {}): TransitionConfig {
  return {
    duration: ms(220),
    easing: EASE,
    css: (t, u) => `opacity: ${t}; transform: translateX(${u * 12 * direction}px)`
  };
}

/** A small drop-and-fade for popovers and pills. */
export function pop(_node: Element, { y = -4 }: { y?: number } = {}): TransitionConfig {
  return {
    duration: ms(150),
    easing: EASE,
    css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px) scale(${0.98 + 0.02 * t})`
  };
}
