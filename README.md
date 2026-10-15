# Glitter powder

A glitter powder you can actually play with, as a React component. Draw in glue, pour glitter over it, push it around, then blow: the loose glitter flies away and your drawing is left behind, glittering.

![Drawing "hi" in glue, pouring glitter, pushing it, and blowing it away](docs/demo.gif)

It's a small physics simulation running on the GPU (WebGL2): the powder heaps up and slides like real glitter, flakes catch the light as you move, fast flicks throw glitter into the air, and the breath comes in uneven gusts.

## Try it

```bash
npx serve .
```

Then open `http://localhost:3000/demo/` (any static server works; it just can't be opened as a file).

## Install

```bash
npm install glitter-powder
```

React 17 or newer. No other dependencies, no build step needed.

## Use

The component fills its parent, so give the parent a size.

```jsx
import { useRef, useState } from 'react';
import { Glitter } from 'glitter-powder';

export default function GlitterArt() {
  const glitter = useRef(null);
  const [tool, setTool] = useState('glue');

  return (
    <div style={{ width: 600, height: 400 }}>
      <Glitter ref={glitter} tool={tool} color="#c9a7f2" heap={false} />

      <button onClick={() => setTool('glue')}>Glue</button>
      <button onClick={() => setTool('push')}>Push</button>
      <button onClick={() => glitter.current.pour()}>Pour</button>
      <button onClick={() => glitter.current.blow()}>Blow</button>
    </div>
  );
}
```

Or start with a word already written in glue, and have it blow away on its own:

```jsx
<Glitter word="hello" autoBlow />
```

## How people play

| | |
|---|---|
| **Glue** tool | Drag to draw glue. It shows as a clear, wet line. |
| **Glitter** tool | Drag to sprinkle glitter by hand. |
| **Push** tool | Drag to plough through the glitter; flick fast to throw it in the air. |
| **Hold still** (any tool) | Hold for half a second and the breath blows the loose glitter away. |

Glitter that lands on glue sticks to it. Everything else blows away.

## Props

All optional. Change any of them while it's running.

| Prop | Default | |
|---|---|---|
| `color` | `'#f2a7c8'` | Glitter colour |
| `shimmer` | `0.55` | How iridescent the flakes are, `0` plain to `1` rainbow |
| `paper` | `'#ffffff'` | The paper underneath |
| `tool` | `'push'` | `'glue'`, `'glitter'` or `'push'` |
| `word` | `''` | A word written in glue to start with |
| `glueWidth` | `14` | Glue line width, px |
| `brushSize` | `22` | Glitter sprinkle radius, px |
| `amount` | `1.2` | How much glitter one sprinkle drops |
| `blowOnLongPress` | `true` | Holding still blows the glitter away |
| `interactive` | `true` | Respond to the pointer at all |
| `onReveal` | | Called when a blow has finished |
| `onReady` | | Called once the first glitter is drawn |
| `onError` | | Called if it can't run (no WebGL2) |

These only matter when it starts:

| Prop | Default | |
|---|---|---|
| `heap` | `true` | Start with a heap of glitter poured over the glue |
| `autoBlow` | `false` | Blow it away by itself once loaded |
| `loadFont` | `true` | Load the glue lettering's font (Qwitcher Grypen) from Google Fonts. Set `false` if you load it yourself or don't use `word` |

Any other props (`className`, `style`, `aria-label`, …) go to the `<canvas>`.

## Actions

Through a ref:

| | |
|---|---|
| `blow()` | The breath: blows the loose glitter away, leaving what's stuck to the glue |
| `pour()` | Pour a fresh heap of glitter over the glue |
| `clear()` | Sweep all the glitter off, keeping the glue |
| `clearGlue()` | Wipe the drawn glue (a `word`, if any, stays) |
| `reveal()` | Skip straight to the finished piece |

## Without React

The engine works on any `<canvas>`:

```js
import { createGlitter } from 'glitter-powder/engine';

const glitter = createGlitter(document.querySelector('canvas'), { tool: 'glue', heap: false });
glitter.set({ color: '#9fd4f2' });
glitter.pour();
glitter.blow();
glitter.destroy(); // when you're done
```

## Notes

- Needs WebGL2 (all current browsers). Without it, nothing is drawn and `onError` is called.
- Respects `prefers-reduced-motion`: blowing skips straight to the finished piece.
- Pauses itself when scrolled off screen, and frees the GPU when unmounted.
- One colour at a time: changing `color` recolours all the glitter on the paper.

## License

MIT © Prerna Kashyap
