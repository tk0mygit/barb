import { expect } from './diagnostics-fixture.js';
import { setup } from './day-night-fixture.js';

// Test-only observation of the production renderer; no game debug API.
export async function observeRenderer(page) {
  await page.addInitScript(() => {
    let devtools;
    Object.defineProperty(window, '__THREE_DEVTOOLS__', { configurable: true,
      get: () => devtools,
      set(value) {
        devtools = value;
        value.addEventListener('observe', ({ detail: renderer }) => {
          if (!renderer.isWebGLRenderer) return;
          const render = renderer.render;
          renderer.render = function(scene, camera) {
            const result = render.call(this, scene, camera);
            const gl = this.getContext();
            window.mobileProbe = {
              viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
              pixelRatio: this.getPixelRatio(), buffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
              pixels: gl.drawingBufferWidth * gl.drawingBufferHeight,
              resources: { calls: this.info.render.calls, triangles: this.info.render.triangles,
                geometries: this.info.memory.geometries, textures: this.info.memory.textures, programs: this.info.programs.length },
              camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), aspect: camera.aspect },
            };
            return result;
          };
        });
      },
    });
  });
}
export const tick = page => page.clock.fastForward(250);
export const phase = page => page.locator('#fishing-panel').getAttribute('data-phase');
export async function enterFishing(page, touch) {
  const button = page.locator('#fish-button');
  if (touch) await button.tap(); else await button.click();
  for (let i = 0; i < 12; i++) await tick(page);
  await expect(page.locator('#fishing-panel')).toHaveAttribute('data-phase', 'ready');
}
export async function fishingInput(page, touch) {
  const cdp = await page.context().newCDPSession(page);
  const point = () => ({ x: Math.round(page.viewportSize().width * 0.6), y: Math.round(page.viewportSize().height * 0.48) });
  return {
    async down(p = point()) {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
      else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
    },
    async move(p) {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
      else await page.mouse.move(p.x, p.y);
    },
    async up() {
      if (touch) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.mouse.up();
    },
    async tap() { await this.down(); await this.up(); },
    async cast() {
      const button = page.locator('#cast-button');
      if (touch) await button.tap(); else await button.click();
      await tick(page);
      const p = point();
      await this.down(p); await this.move({ x: p.x, y: p.y - 150 });
      await tick(page); await this.up();
      for (let i = 0; i < 8 && await phase(page) !== 'lure'; i++) await tick(page);
      expect(await phase(page)).toBe('lure');
    },
    async bite() {
      await this.cast();
      for (let i = 0; i < 120 && await phase(page) !== 'bite'; i++) await tick(page);
      expect(await phase(page)).toBe('bite');
    },
    async hook() { await this.tap(); await page.clock.fastForward(16); expect(await phase(page)).toBe('fight'); },
  };
}
export async function startCapture(page, seconds = 90) {
  await observeRenderer(page);
  await setup(page, seconds);
}
export async function layout(page) {
  return page.evaluate(() => {
    const rect = element => element.getBoundingClientRect().toJSON();
    const panel = document.querySelector('#fishing-panel'), meter = document.querySelector('#line-tension');
    const visible = element => element.getClientRects().length > 0;
    const p = rect(panel);
    return { viewport: { width: innerWidth, height: innerHeight }, phase: panel.dataset.phase,
      panel: p, occupancy: p.width * p.height / (innerWidth * innerHeight) * 100,
      reticle: rect(document.querySelector('#reticle')), meter: rect(meter), tension: meter.value,
      state: document.querySelector('#fishing-state').textContent, warning: document.querySelector('#tension-warning').textContent,
      conditions: document.querySelector('#fishing-conditions').textContent,
      pointerEvents: getComputedStyle(panel).pointerEvents,
      hit: document.elementFromPoint(p.x + p.width / 2, p.y + p.height / 2)?.id,
      buttons: [...document.querySelectorAll('button')].filter(visible).map(element => ({ id: element.id, ...rect(element) })),
      header: rect(document.querySelector('.masthead')),
      notices: [...document.querySelectorAll('#sale-notice, #achievement-notice, #spot-status')].filter(visible).map(rect),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
}
export function separated(a, b, margin = 0) {
  return a.right + margin <= b.left || b.right + margin <= a.left || a.bottom + margin <= b.top || b.bottom + margin <= a.top;
}
export function assertLayout(s, { fight = true, inset = { top: 0, right: 0, bottom: 0, left: 0 } } = {}) {
  const p = s.panel;
  expect(p.left).toBeGreaterThanOrEqual(inset.left + 8); expect(p.top).toBeGreaterThanOrEqual(inset.top + 8);
  expect(p.right).toBeLessThanOrEqual(s.viewport.width - inset.right - 8);
  expect(p.bottom).toBeLessThanOrEqual(s.viewport.height - inset.bottom - 8);
  expect(separated(p, s.reticle, 12)).toBe(true);
  for (const b of [...s.buttons, s.header, ...s.notices]) expect(separated(p, b, 8)).toBe(true);
  expect(s.pointerEvents).toBe('none'); expect(s.hit).toBe('scene');
  expect(s.scrollWidth).toBe(s.viewport.width);
  for (const b of s.buttons) {
    expect(b.left).toBeGreaterThanOrEqual(inset.left); expect(b.top).toBeGreaterThanOrEqual(inset.top);
    expect(b.right).toBeLessThanOrEqual(s.viewport.width - inset.right);
    expect(b.bottom).toBeLessThanOrEqual(s.viewport.height - inset.bottom);
  }
  if (fight) {
    expect(s.state).toBe('ファイト'); expect(s.meter.width).toBeGreaterThanOrEqual(190);
    expect(s.meter.height).toBeGreaterThanOrEqual(18);
    expect(s.warning).toBe(s.tension > 0.78 ? '離して緩める！' : s.tension < 0.18 ? '長押しで巻く！' : 'テンションを保つ');
  }
}
