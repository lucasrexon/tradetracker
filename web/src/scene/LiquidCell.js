import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { scoreRGB, orient } from '../theme.js';

const ISO = 80;
const SUBTRACT = 16;
/**
 * The field is laid out in units of the core radius `u`: the core has radius
 * 1u and the cube spans ±HALF·u. Position size only changes the mesh scale,
 * so droplets always cover enough voxels to stay round.
 */
const HALF = 2.15;
const N = (units) => units / (2 * HALF); // core-radius units → normalised field units
const strengthFor = (r) => r * r * (ISO + SUBTRACT);

const tmp = new THREE.Color();

/**
 * One trade rendered as liquid: a wobbling core (colour = how well
 * fundamentals support the position) with five orbiting droplets, one per
 * fundamental pillar, that keep fusing into and pinching off the core. News
 * arrives as droplets falling in from above.
 */
export class LiquidCell {
  constructor({ material, resolution = 40, closed = false, onImpact }) {
    this.closed = closed;
    this.onImpact = onImpact;
    this.group = new THREE.Group();
    this.mc = new MarchingCubes(resolution, material, false, true, 40000);
    this.mc.isolation = ISO;
    this.mc.frustumCulled = false;
    this.group.add(this.mc);
    this.weights = new Float32Array(this.mc.size3);

    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    hit.userData.cell = this;
    this.hit = hit;
    this.group.add(hit);

    this.labelEl = document.createElement('button');
    this.labelEl.type = 'button';
    this.labelEl.className = 'cell-label';
    this.label = new CSS2DObject(this.labelEl);
    this.group.add(this.label);

    this.phase = Math.random() * 100;
    this.state = {
      radius: 0.7,
      y: 1.2,
      color: [0.8, 0.7, 0.6],
      pillars: Array.from({ length: 5 }, () => ({ r: 0.2, color: [0.7, 0.7, 0.7] })),
      turbulence: 1,
    };
    this.target = structuredClone(this.state);
    this.drops = [];
    this.dirty = true;
    // Stagger rebuilds so cells don't all re-mesh on the same frame.
    this.accum = Math.random() / 30;
    this.pulse = 0;
  }

  /** Map evaluated trade data onto visual targets. */
  setTrade(trade, { position, size }) {
    this.trade = trade;
    this.group.position.x = position.x;
    this.group.position.z = position.z;
    const pnl = trade.pnl?.pct ?? 0;
    const tgt = this.target;
    tgt.radius = size;
    tgt.y = this.closed ? size * 0.55 : 1.25 + Math.max(-0.25, Math.min(0.25, pnl)) * 3.4;
    tgt.color = this.tint(scoreRGB(trade.alignment));
    tgt.pillars = (trade.pillars || []).slice(0, 5).map((p) => {
      const s = orient(p.score, trade.direction);
      return { r: p.score == null ? 0.15 : 0.17 + 0.15 * (s / 100), color: this.tint(scoreRGB(s)) };
    });
    while (tgt.pillars.length < 5) tgt.pillars.push({ r: 0.15, color: this.tint(scoreRGB(null)) });
    const activity = Math.min(trade.activity || 0, 10) / 10;
    const vol = Math.min(trade.volatility || 0.3, 0.9);
    tgt.turbulence = 0.7 + activity * 0.9 + vol * 0.8;
    this.dirty = true;
    this.renderLabel();
  }

  tint(rgb) {
    if (!this.closed) return rgb;
    // Past trades "solidify": desaturate towards warm stone.
    const stone = [0.76, 0.72, 0.66];
    return rgb.map((v, i) => v * 0.4 + stone[i] * 0.6);
  }

  renderLabel() {
    const t = this.trade;
    const pnl = t.pnl?.pct;
    const cls = pnl == null ? '' : pnl >= 0 ? 'up' : 'down';
    const pnlText = pnl == null ? (t.price?.awaiting ? 'new' : '…') : `${pnl >= 0 ? '+' : '−'}${Math.abs(pnl * 100).toFixed(1)}%`;
    const flagged = !this.closed && (t.verdict?.code === 'stop' || t.verdict?.code === 'broken');
    this.labelEl.className = `cell-label ${this.closed ? 'closed' : ''} ${this.selected ? 'selected' : ''}`;
    this.labelEl.dataset.id = t.id;
    this.labelEl.setAttribute('aria-label', `${t.ticker} ${t.direction} ${t.status} ${pnlText}`);
    this.labelEl.innerHTML = `<span class="t">${t.ticker}</span><span class="p ${cls}">${pnlText}</span>${
      flagged ? '<span class="flag" aria-hidden="true"></span>' : ''
    }`;
  }

  setSelected(on) {
    this.selected = on;
    if (this.trade) this.renderLabel();
  }

  dropNews(sentimentRGB) {
    this.drops.push({
      x: 0.5 + (Math.random() - 0.5) * 0.06,
      z: 0.5 + (Math.random() - 0.5) * 0.06,
      y: 0.95,
      vy: 0,
      r: N(0.24),
      color: sentimentRGB,
      absorbed: false,
      life: 1,
    });
    this.dirty = true;
  }

  get worldPosition() {
    return new THREE.Vector3(this.group.position.x, this.group.position.y, this.group.position.z);
  }

  tick(dt, t) {
    const s = this.state;
    const g = this.target;
    const k = Math.min(1, dt * 2.2);
    s.radius += (g.radius - s.radius) * k;
    s.y += (g.y - s.y) * k;
    s.turbulence += (g.turbulence - s.turbulence) * k;
    for (let i = 0; i < 3; i++) s.color[i] += (g.color[i] - s.color[i]) * k;
    g.pillars.forEach((p, i) => {
      const cur = s.pillars[i];
      cur.r += (p.r - cur.r) * k;
      for (let j = 0; j < 3; j++) cur.color[j] += (p.color[j] - cur.color[j]) * k;
    });
    this.group.position.y = s.y;
    this.mc.scale.setScalar(HALF * s.radius);
    this.hit.scale.setScalar(s.radius * 1.5);
    this.label.position.set(0, s.radius * (this.closed ? 1.2 : 1.45) + 0.35, 0);
    this.pulse = Math.max(0, this.pulse - dt * 1.5);
    this.labelEl.style.setProperty('--pulse', this.pulse.toFixed(3));

    const settling = Math.abs(g.radius - s.radius) > 0.002 || s.color.some((c, i) => Math.abs(c - g.color[i]) > 0.002);
    if (this.closed && !this.dirty && !this.drops.length && !settling) return;
    // Rebuild the field at ~30 fps; it's the expensive part.
    this.accum += dt;
    if (this.accum < 1 / 30) return;
    this.accum = 0;
    this.dirty = false;
    this.build(t, dt);
  }

  build(t) {
    const mc = this.mc;
    const s = this.state;
    mc.reset();
    this.weights.fill(0);
    const time = this.closed ? 0 : t + this.phase;
    const turb = this.closed ? 0 : s.turbulence;
    const step = 1 / 30;

    // Core plus two small lobes drifting just under the surface → a lumpy, breathing blob.
    this.addBall(0.5, 0.5, 0.5, N(0.93), s.color);
    for (let i = 0; i < 2; i++) {
      const a = time * (0.5 + i * 0.27) + i * 2.4;
      const off = N(0.46 + 0.07 * turb);
      this.addBall(
        0.5 + Math.cos(a) * off,
        0.5 + Math.sin(a * 1.4 + i) * off * 0.6,
        0.5 + Math.sin(a) * off,
        N(0.36),
        s.color,
      );
    }

    // Five pillar droplets orbit, repeatedly fusing with the core and pinching off.
    const spin = time * 0.2 * (0.6 + turb * 0.4);
    s.pillars.forEach((p, i) => {
      const theta = spin + (i * Math.PI * 2) / 5;
      const gap = this.closed ? -0.12 : 0.05 + 0.2 * Math.sin(time * 0.55 + i * 1.7);
      const orbit = N(1 + p.r + gap);
      const bob = this.closed ? -N(0.25) : N(0.1) * Math.sin(time * 0.8 + i * 1.3);
      this.addBall(0.5 + Math.cos(theta) * orbit, 0.5 + bob, 0.5 + Math.sin(theta) * orbit, N(p.r), p.color);
    });

    // Incoming news droplets fall and merge.
    for (const d of this.drops) {
      if (!d.absorbed) {
        d.vy -= 1.3 * step;
        d.y += d.vy * step;
        if (d.y <= 0.5 + N(0.85)) {
          d.absorbed = true;
          this.pulse = 1;
          this.onImpact?.(this, d.color);
        }
      } else {
        d.life -= step * 1.2;
        d.y += (0.5 - d.y) * 0.08;
      }
      this.addBall(d.x, d.y, d.z, d.r * Math.max(d.life, 0), d.color);
    }
    this.drops = this.drops.filter((d) => d.life > 0);
    if (this.drops.length) this.dirty = true;

    // Normalise blended colours so overlaps mix instead of saturating.
    const pal = mc.palette;
    const w = this.weights;
    for (let i = 0; i < w.length; i++) {
      const wi = w[i];
      if (wi > 0) {
        pal[i * 3] /= wi;
        pal[i * 3 + 1] /= wi;
        pal[i * 3 + 2] /= wi;
      }
    }
    mc.update();
  }

  /** Same field as MarchingCubes.addBall, but also accumulates colour weights. */
  addBall(bx, by, bz, radius, rgb) {
    if (radius <= 0.002) return;
    const mc = this.mc;
    const strength = strengthFor(radius);
    const size = mc.size;
    const size2 = mc.size2;
    const field = mc.field;
    const pal = mc.palette;
    const w = this.weights;
    tmp.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
    const cr = tmp.r;
    const cg = tmp.g;
    const cb = tmp.b;
    const reach = size * Math.sqrt(strength / SUBTRACT);
    const xs = bx * size;
    const ys = by * size;
    const zs = bz * size;
    const minZ = Math.max(1, Math.floor(zs - reach));
    const maxZ = Math.min(size - 1, Math.floor(zs + reach));
    const minY = Math.max(1, Math.floor(ys - reach));
    const maxY = Math.min(size - 1, Math.floor(ys + reach));
    const minX = Math.max(1, Math.floor(xs - reach));
    const maxX = Math.min(size - 1, Math.floor(xs + reach));
    for (let z = minZ; z < maxZ; z++) {
      const zo = size2 * z;
      const fz = z / size - bz;
      const fz2 = fz * fz;
      for (let y = minY; y < maxY; y++) {
        const yo = zo + size * y;
        const fy = y / size - by;
        const fy2 = fy * fy;
        for (let x = minX; x < maxX; x++) {
          const fx = x / size - bx;
          const val = strength / (0.000001 + fx * fx + fy2 + fz2) - SUBTRACT;
          if (val > 0) {
            const i = yo + x;
            field[i] += val;
            // Weight colour by squared influence so each droplet keeps its hue
            // until it is genuinely merged.
            const cw = val * val;
            pal[i * 3] += cr * cw;
            pal[i * 3 + 1] += cg * cw;
            pal[i * 3 + 2] += cb * cw;
            w[i] += cw;
          }
        }
      }
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.label.element.remove();
    this.mc.geometry.dispose();
    this.hit.geometry.dispose();
    this.hit.material.dispose();
  }
}
