/* <Glitter /> — the glitter powder as a React component.

   It renders one <canvas> that fills its parent box (give the parent a size).
   Props are the engine's options (see README.md); change them any time.
   A ref gives you the actions: ref.current.blow(), pour(), clear(),
   clearGlue(), reveal().

   Written without JSX so it runs as-is, with no build step. */
import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createGlitter } from './engine.js';

// Props that are just passed through to the engine as options
const OPTION_KEYS = ['color', 'shimmer', 'paper', 'word', 'tool', 'glueWidth', 'brushSize', 'amount',
  'blowOnLongPress', 'interactive', 'onReveal', 'onReady'];
// Props that only matter when it starts
const START_KEYS = ['heap', 'autoBlow', 'loadFont', 'onError'];

export const Glitter = forwardRef(function Glitter(props, ref) {
  const canvasRef = useRef(null);
  const engine = useRef(null);
  const latest = useRef(props);
  latest.current = props;

  // Start once, stop on unmount (the engine only runs in the browser)
  useEffect(() => {
    const p = latest.current, o = {};
    for (const k of [...OPTION_KEYS, ...START_KEYS]) if (p[k] !== undefined) o[k] = p[k];
    // callbacks always call the newest prop, so changing them needs no restart
    o.onReveal = () => latest.current.onReveal?.();
    o.onReady = () => latest.current.onReady?.();
    o.onError = (e) => latest.current.onError?.(e);
    engine.current = createGlitter(canvasRef.current, o);
    return () => { engine.current?.destroy(); engine.current = null; };
  }, []);

  // Pass changed options straight through
  const deps = OPTION_KEYS.filter((k) => !k.startsWith('on')).map((k) => props[k]);
  useEffect(() => {
    if (!engine.current) return;
    const o = {};
    for (const k of OPTION_KEYS) if (!k.startsWith('on') && props[k] !== undefined) o[k] = props[k];
    engine.current.set(o);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    blow: () => engine.current?.blow(),
    pour: () => engine.current?.pour(),
    clear: () => engine.current?.clear(),
    clearGlue: () => engine.current?.clearGlue(),
    reveal: () => engine.current?.reveal(),
  }), []);

  const rest = {};
  for (const k in props) if (!OPTION_KEYS.includes(k) && !START_KEYS.includes(k)) rest[k] = props[k];
  return createElement('canvas', {
    ...rest,
    ref: canvasRef,
    role: rest.role ?? 'img',
    'aria-label': rest['aria-label'] ?? 'Glitter you can draw in, pour, push around and blow away',
    style: { display: 'block', width: '100%', height: '100%', touchAction: 'none', userSelect: 'none', ...rest.style },
  });
});

export default Glitter;
