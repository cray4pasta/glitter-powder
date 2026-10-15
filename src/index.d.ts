import type { CanvasHTMLAttributes, ForwardRefExoticComponent, RefAttributes } from 'react';

export type GlitterTool = 'glue' | 'glitter' | 'push';

export interface GlitterOptions {
  /** Glitter colour (hex). Default '#f2a7c8' */
  color?: string;
  /** How iridescent the flakes are, 0 plain – 1 rainbow. Default 0.55 */
  shimmer?: number;
  /** The paper underneath (hex). Default '#ffffff' */
  paper?: string;
  /** A word written in glue to start with ('' for none). Default '' */
  word?: string;
  /** 'glue' draws glue, 'glitter' sprinkles glitter, 'push' plays with it. Default 'push' */
  tool?: GlitterTool;
  /** Glue line width, CSS px. Default 14 */
  glueWidth?: number;
  /** Glitter sprinkle radius, CSS px. Default 22 */
  brushSize?: number;
  /** How much glitter one sprinkle drops. Default 1.2 */
  amount?: number;
  /** Start with a heap of glitter poured over the glue. Default true */
  heap?: boolean;
  /** Blow it away by itself once it has loaded. Default false */
  autoBlow?: boolean;
  /** Holding still for half a second blows the loose glitter away. Default true */
  blowOnLongPress?: boolean;
  /** Respond to the pointer at all. Default true */
  interactive?: boolean;
  /** Load the glue lettering's font from Google Fonts. Default true */
  loadFont?: boolean;
  /** Called when a blow has finished */
  onReveal?: () => void;
  /** Called once it has drawn its first glitter */
  onReady?: () => void;
  /** Called if it can't run (no WebGL 2) */
  onError?: (error: Error) => void;
}

export interface GlitterHandle {
  /** The breath: blows loose glitter away, leaving what's stuck to the glue */
  blow(): void;
  /** Pour a fresh heap of glitter over the glue */
  pour(): void;
  /** Sweep all glitter off, keeping the glue */
  clear(): void;
  /** Wipe the drawn glue (a word, if any, stays) */
  clearGlue(): void;
  /** Skip to the finished piece */
  reveal(): void;
}

export interface GlitterEngine extends GlitterHandle {
  /** Change any option on the fly */
  set(options: GlitterOptions): void;
  /** Stop everything and free the GPU */
  destroy(): void;
}

export type GlitterProps = GlitterOptions & Omit<CanvasHTMLAttributes<HTMLCanvasElement>, keyof GlitterOptions>;

export declare const Glitter: ForwardRefExoticComponent<GlitterProps & RefAttributes<GlitterHandle>>;
export default Glitter;

/** Run the glitter in any canvas without React. Returns null without WebGL 2. */
export declare function createGlitter(canvas: HTMLCanvasElement, options?: GlitterOptions): GlitterEngine | null;
export declare const DEFAULTS: Required<Omit<GlitterOptions, 'onReveal' | 'onReady' | 'onError'>>;
