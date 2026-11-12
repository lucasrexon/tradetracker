import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { LiquidCell } from './LiquidCell.js';
import { Pool } from './Pool.js';
import { PALETTES, SENTIMENT } from '../theme.js';

const OVERVIEW = { pos: new THREE.Vector3(0, 9.2, 19), target: new THREE.Vector3(0, 0.7, 0) };

export class World {
  constructor(container, { onSelect, onHover, theme }) {
    this.container = container;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.cells = new Map();
    this.selectedId = null;
    this.timer = new THREE.Timer();
    this.focus = null;
    this.insets = { left: 0, right: 0 };
    this.shift = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'scene-canvas';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const labels = new CSS2DRenderer();
    labels.domElement.className = 'scene-labels';
    container.appendChild(labels.domElement);
    this.labels = labels;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    this.camera.position.copy(OVERVIEW.pos);

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.38;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.85);
    this.key = new THREE.DirectionalLight(0xffffff, 2.1);
    this.key.position.set(6, 11, 5);
    this.rim = new THREE.DirectionalLight(0xffffff, 0.9);
    this.rim.position.set(-7, 4, -8);
    this.scene.add(this.hemi, this.key, this.rim);

    this.liquid = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.3,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      sheen: 0.18,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color('#ffe9d6'),
      iridescence: 0.12,
      iridescenceIOR: 1.25,
    });
    this.stone = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0,
      clearcoat: 0.2,
      clearcoatRoughness: 0.5,
      sheen: 0.15,
      sheenColor: new THREE.Color('#fff4ea'),
    });

    this.pool = new Pool();
    this.scene.add(this.pool.mesh);

    // Renders the scene mirrored in the pool surface; never draws itself.
    this.reflector = new Reflector(new THREE.PlaneGeometry(56, 56), { textureWidth: 1024, textureHeight: 1024, clipBias: 0.003, multisample: 4 });
    this.reflector.rotateX(-Math.PI / 2);
    this.reflector.material.colorWrite = false;
    this.reflector.material.depthWrite = false;
    this.reflector.renderOrder = -1;
    this.scene.add(this.reflector);
    this.reflector.updateMatrixWorld();
    this.pool.useReflector(this.reflector);
    // The pool samples the reflection, so it must sit out the reflection pass.
    const renderReflection = this.reflector.onBeforeRender;
    this.reflector.onBeforeRender = (...args) => {
      this.pool.mesh.visible = false;
      renderReflection.apply(this.reflector, args);
      this.pool.mesh.visible = true;
    };
    this.bubbles = this.makeBubbles();
    this.scene.add(this.bubbles);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.target.copy(OVERVIEW.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 5;
    controls.maxDistance = 38;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.autoRotate = !this.reducedMotion;
    controls.autoRotateSpeed = 0.28;
    controls.addEventListener('start', () => {
      this.userMoved = true;
      this.focus = null;
      controls.autoRotate = false;
      clearTimeout(this.resumeTimer);
    });
    controls.addEventListener('end', () => {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = setTimeout(() => {
        if (!this.selectedId && !this.reducedMotion) controls.autoRotate = true;
      }, 6000);
    });
    this.controls = controls;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bindPointer();
    this.setTheme(theme);

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.loop = this.loop.bind(this);
    renderer.setAnimationLoop(this.loop);
  }

  makeBubbles() {
    const count = 40;
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshPhysicalMaterial({ roughness: 0.1, clearcoat: 1, transparent: true, opacity: 0.4, depthWrite: false }),
      count,
    );
    this.bubbleData = Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 26,
      z: (Math.random() - 0.5) * 26,
      y: Math.random() * 7,
      s: 0.025 + Math.random() * 0.045,
      v: 0.08 + Math.random() * 0.22,
      p: Math.random() * 10,
    }));
    mesh.frustumCulled = false;
    return mesh;
  }

  setTheme(name) {
    const p = PALETTES[name] || PALETTES.light;
    this.pool.setPalette(p.pool);
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.key.color.set(p.key);
    this.rim.color.set(p.rim);
    this.renderer.toneMappingExposure = p.exposure;
    this.pool.uniforms.uReflectivity.value = name === 'dark' ? 0.4 : 0.2;
    this.bubbles.material.color.set(p.bubble);
    this.pool.uniforms.uLightDir.value.copy(this.key.position).normalize();
  }

  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const cell = this.pick(e);
      this.onSelect?.(cell ? cell.trade.id : null);
    });
    el.addEventListener('pointermove', (e) => {
      const cell = this.pick(e);
      el.style.cursor = cell ? 'pointer' : '';
      if (cell?.trade.id !== this.hoverId) {
        this.hoverId = cell?.trade.id ?? null;
        this.onHover?.(this.hoverId);
      }
    });
    this.labels.domElement.addEventListener('click', (e) => {
      const label = e.target.closest('.cell-label');
      if (label) this.onSelect?.(label.dataset.id);
    });
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.cells.values()].map((c) => c.hit), false);
    return hits[0]?.object.userData.cell || null;
  }

  /** Lay out open trades on an inner ring and past trades on an outer ring. */
  layout(trades) {
    const open = trades.filter((t) => t.status === 'open');
    const closed = trades.filter((t) => t.status === 'closed');
    const maxValue = Math.max(1, ...open.map((t) => t.positionValue || 0));
    const out = new Map();
    const rOpen = open.length <= 1 ? 0 : Math.max(3.9, open.length * 1.15);
    open.forEach((t, i) => {
      const a = Math.PI / 2 + (i / open.length) * Math.PI * 2;
      const size = 0.58 + 0.38 * Math.sqrt((t.positionValue || 0) / maxValue);
      out.set(t.id, { position: { x: Math.cos(a) * rOpen, z: Math.sin(a) * rOpen }, size });
    });
    const rClosed = (open.length ? rOpen : 0) + 3.3;
    closed.forEach((t, i) => {
      const a = Math.PI / 2 + Math.PI / Math.max(open.length, 1) + (i / closed.length) * Math.PI * 2;
      out.set(t.id, { position: { x: Math.cos(a) * rClosed, z: Math.sin(a) * rClosed }, size: 0.42 });
    });
    return out;
  }

  update(state) {
    const trades = state.trades || [];
    const layout = this.layout(trades);
    for (const [id, cell] of this.cells) {
      const t = trades.find((x) => x.id === id);
      if (!t || (t.status === 'closed') !== cell.closed) {
        cell.dispose();
        this.cells.delete(id);
      }
    }
    for (const t of trades) {
      let cell = this.cells.get(t.id);
      if (!cell) {
        const closed = t.status === 'closed';
        const openCount = trades.filter((x) => x.status === 'open').length;
        cell = new LiquidCell({
          material: closed ? this.stone : this.liquid,
          // Keep re-meshing affordable as the portfolio grows.
          resolution: closed ? 28 : openCount <= 4 ? 40 : openCount <= 8 ? 34 : 28,
          closed,
          onImpact: (c, rgb) => {
            const p = c.worldPosition;
            this.pool.ripple(p.x, p.z, rgb, 1);
          },
        });
        this.cells.set(t.id, cell);
        this.scene.add(cell.group);
      }
      cell.setTrade(t, layout.get(t.id));
      cell.setSelected(t.id === this.selectedId);
    }
    const macro = state.macro;
    this.pool.uniforms.uTide.value = 1 + Math.min(Math.abs(macro?.y10Change30d || 0), 60) / 60;
    if (this.selectedId && !this.cells.has(this.selectedId)) this.select(null);
    else if (this.selectedId) this.select(this.selectedId, { fly: false });
  }

  select(id, { fly = true } = {}) {
    const prev = this.selectedId;
    this.selectedId = id;
    for (const [cid, cell] of this.cells) cell.setSelected(cid === id);
    const cell = id ? this.cells.get(id) : null;
    if (cell) {
      this.pool.setSelected(cell.group.position, cell.target.radius);
      this.controls.autoRotate = false;
      if (fly && prev !== id) {
        const p = cell.worldPosition;
        const target = new THREE.Vector3(p.x, cell.target.y + 0.2, p.z);
        const dir = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
        const pos = target.clone().addScaledVector(dir, 9).setY(target.y + 4.4);
        this.focus = { target, pos };
      }
    } else {
      this.pool.setSelected(null);
      if (prev && fly) {
        const pos = this.camera.position.clone().sub(this.controls.target).setLength(this.overviewDistance()).add(OVERVIEW.target);
        this.focus = { target: OVERVIEW.target.clone(), pos };
      }
      clearTimeout(this.resumeTimer);
      this.resumeTimer = setTimeout(() => {
        if (!this.selectedId && !this.reducedMotion) this.controls.autoRotate = true;
      }, 3000);
    }
  }

  dropNews(ticker, article) {
    const rgb = (SENTIMENT[article.sentiment] || SENTIMENT.null).rgb;
    let dropped = false;
    for (const cell of this.cells.values()) {
      if (cell.trade?.ticker === ticker && !cell.closed) {
        cell.dropNews(rgb);
        dropped = true;
      }
    }
    if (!dropped) {
      for (const cell of this.cells.values()) if (cell.trade?.ticker === ticker) cell.dropNews(rgb);
    }
  }

  /** Pull back on portrait screens so the ring of trades fits horizontally. */
  overviewDistance() {
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    const base = OVERVIEW.pos.distanceTo(OVERVIEW.target);
    return aspect >= 1 ? base : Math.min(36, base * aspect ** -0.8);
  }

  /** Screen space covered by side panels, so the scene centres in what's left. */
  setInsets({ left = 0, right = 0 }) {
    this.insets = { left, right };
  }

  applyShift(dt) {
    const target = (this.insets.left - this.insets.right) / 2;
    if (Math.abs(target - this.shift) < 0.5 && this.shiftApplied === target) return;
    this.shift += (target - this.shift) * Math.min(1, dt * 5);
    if (Math.abs(target - this.shift) < 0.5) this.shift = target;
    this.shiftApplied = this.shift;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (Math.abs(this.shift) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, -this.shift, 0, w, h);
  }

  resize() {
    this.shiftApplied = null;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h, false);
    this.labels.setSize(w, h);
    const dpr = this.renderer.getPixelRatio();
    this.reflector.getRenderTarget().setSize(Math.round((w * dpr) / 2), Math.round((h * dpr) / 2));
    this.camera.aspect = w / h;
    // Pull back on narrow screens so the whole ring stays in view.
    this.camera.fov = w < 700 ? 46 : 36;
    this.camera.updateProjectionMatrix();
    if (!this.userMoved && !this.selectedId) {
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(OVERVIEW.target).addScaledVector(dir, this.overviewDistance());
    }
  }

  loop(timestamp) {
    this.timer.update(timestamp);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    const t = this.timer.getElapsed();
    if (this.focus) {
      const k = Math.min(1, dt * 2.6);
      this.controls.target.lerp(this.focus.target, k);
      this.camera.position.lerp(this.focus.pos, k);
      if (this.camera.position.distanceTo(this.focus.pos) < 0.02) this.focus = null;
    }
    this.applyShift(dt);
    this.controls.update(dt);
    this.pool.tick(t, dt);
    const shadows = [];
    for (const cell of this.cells.values()) {
      cell.tick(dt, t);
      const p = cell.group.position;
      shadows.push({ x: p.x, z: p.z, r: cell.state.radius, lift: p.y - cell.state.radius, color: cell.state.color });
    }
    this.pool.setCells(shadows);
    this.tickBubbles(dt, t);
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    if ((this.frame = (this.frame || 0) + 1) % 12 === 0) this.declutterLabels();
  }

  /** Fade past-trade labels that collide with an open trade's label. */
  declutterLabels() {
    const cells = [...this.cells.values()];
    const rects = new Map(cells.map((c) => [c, c.labelEl.getBoundingClientRect()]));
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const top = this.container.getBoundingClientRect().top + 64; // keep clear of the top bar
    for (const c of cells) {
      const r = rects.get(c);
      const underBar = r.top < top;
      const crowded = c.closed && !c.selected && cells.some((o) => !o.closed && hit(r, rects.get(o)));
      c.labelEl.classList.toggle('occluded', underBar || crowded);
    }
  }

  tickBubbles(dt, t) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    this.bubbleData.forEach((b, i) => {
      b.y += b.v * dt;
      if (b.y > 7.5) {
        b.y = 0;
        b.x = (Math.random() - 0.5) * 26;
        b.z = (Math.random() - 0.5) * 26;
      }
      const fade = Math.min(1, b.y / 1.2) * Math.min(1, (7.5 - b.y) / 2);
      v.set(b.x + Math.sin(t * 0.5 + b.p) * 0.3, b.y, b.z + Math.cos(t * 0.4 + b.p) * 0.3);
      s.setScalar(b.s * fade);
      m.compose(v, q, s);
      this.bubbles.setMatrixAt(i, m);
    });
    this.bubbles.instanceMatrix.needsUpdate = true;
  }
}
