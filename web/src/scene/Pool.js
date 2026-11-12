import * as THREE from 'three';

const MAX_RIPPLES = 12;
const MAX_CELLS = 16;

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uTide;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  uniform mat4 uReflectMatrix;
  varying vec3 vWorld;
  varying vec4 vRefl;

  float ripples(vec2 p, float t) {
    float h = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 r = uRipples[i];
      float age = t - r.z;
      if (r.w <= 0.0 || age < 0.0 || age > 7.0) continue;
      float d = distance(p, r.xy);
      float front = age * 2.1;
      float env = exp(-pow((d - front) / 0.95, 2.0)) * exp(-age * 0.5) * r.w;
      h += env * 0.16 * sin((d - front) * 5.2);
    }
    return h;
  }

  float heightAt(vec2 p, float t) {
    float h = 0.022 * uTide * sin(p.x * 0.55 + t * 0.6)
            + 0.018 * uTide * sin(p.y * 0.75 - t * 0.5)
            + 0.010 * sin((p.x + p.y) * 1.6 + t * 1.2);
    return h + ripples(p, t);
  }

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    world.y += heightAt(world.xz, uTime);
    vWorld = world.xyz;
    vRefl = uReflectMatrix * vec4(world.x, 0.0, world.z, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uTide;
  uniform float uFade;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  uniform vec3 uRippleColors[${MAX_RIPPLES}];
  uniform vec4 uCells[${MAX_CELLS}];
  uniform vec3 uCellColors[${MAX_CELLS}];
  uniform int uCellCount;
  uniform vec4 uSelected;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSheen;
  uniform vec3 uShadow;
  uniform vec3 uSky;
  uniform vec3 uAccent;
  uniform vec3 uLightDir;
  uniform sampler2D tReflect;
  uniform float uReflectivity;
  varying vec3 vWorld;
  varying vec4 vRefl;

  float rippleField(vec2 p, float t, out vec3 tint, out float tintAmt) {
    float h = 0.0;
    tint = vec3(0.0);
    tintAmt = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 r = uRipples[i];
      float age = t - r.z;
      if (r.w <= 0.0 || age < 0.0 || age > 7.0) continue;
      float d = distance(p, r.xy);
      float front = age * 2.1;
      float env = exp(-pow((d - front) / 0.95, 2.0)) * exp(-age * 0.5) * r.w;
      h += env * 0.16 * sin((d - front) * 5.2);
      float glow = env * (0.6 + 0.4 * exp(-age));
      tint += uRippleColors[i] * glow;
      tintAmt += glow;
    }
    return h;
  }

  float heightAt(vec2 p, float t) {
    vec3 tint; float amt;
    return 0.022 * uTide * sin(p.x * 0.55 + t * 0.6)
         + 0.018 * uTide * sin(p.y * 0.75 - t * 0.5)
         + 0.010 * sin((p.x + p.y) * 1.6 + t * 1.2)
         + rippleField(p, t, tint, amt);
  }

  void main() {
    vec2 p = vWorld.xz;
    float e = 0.06;
    float h0 = heightAt(p, uTime);
    float hx = heightAt(p + vec2(e, 0.0), uTime);
    float hz = heightAt(p + vec2(0.0, e), uTime);
    vec3 n = normalize(vec3(-(hx - h0) / e, 1.0, -(hz - h0) / e));

    vec3 v = normalize(cameraPosition - vWorld);
    vec3 l = normalize(uLightDir);
    float dist = length(p);

    vec3 base = mix(uShallow, uDeep, smoothstep(2.0, uFade * 0.9, dist) * 0.55 + 0.15);
    float diff = 0.78 + 0.22 * max(dot(n, l), 0.0);
    vec3 col = base * diff;

    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col = mix(col, uSky, fres * 0.45);
    vec3 hv = normalize(l + v);
    float spec = pow(max(dot(n, hv), 0.0), 140.0);
    col += uSheen * spec * 0.55;

    // Soft contact shadows under each trade cell.
    float shade = 0.0;
    for (int i = 0; i < ${MAX_CELLS}; i++) {
      if (i >= uCellCount) break;
      vec4 c = uCells[i];
      float lift = max(c.w, 0.0);
      float spread = c.z * (1.15 + lift * 0.55);
      float d = distance(p, c.xy);
      shade += exp(-(d * d) / (spread * spread)) * (0.42 / (1.0 + lift * 0.9));
      // Coloured bounce light from the liquid above.
      float bounce = exp(-(d * d) / (c.z * c.z * 3.2)) * (0.16 / (1.0 + lift * 0.7));
      col = mix(col, uCellColors[i], bounce);
      // Meniscus highlight where the liquid touches the pool.
      float touch = exp(-pow((d - c.z * 0.95) / 0.12, 2.0)) * smoothstep(0.6, 0.0, lift);
      col += uSheen * touch * 0.12;
    }
    col = mix(col, uShadow, clamp(shade, 0.0, 0.6) * 0.55);

    // Mirror image of the liquid above, wobbled by the surface normal.
    vec2 ruv = vRefl.xy / vRefl.w + n.xz * 0.045;
    vec4 refl = texture2D(tReflect, ruv);
    float edge = smoothstep(0.0, 0.04, ruv.x) * smoothstep(1.0, 0.96, ruv.x) * smoothstep(0.0, 0.04, ruv.y) * smoothstep(1.0, 0.96, ruv.y);
    col = mix(col, min(refl.rgb, vec3(1.2)), clamp(refl.a * edge * (uReflectivity + 0.35 * fres), 0.0, 0.85));

    vec3 tint; float tintAmt;
    rippleField(p, uTime, tint, tintAmt);
    if (tintAmt > 0.0) col = mix(col, tint / tintAmt, clamp(tintAmt * 0.55, 0.0, 0.5));

    if (uSelected.w > 0.0) {
      float d = distance(p, uSelected.xy);
      float ringR = uSelected.z * 1.45 + 0.08 * sin(uTime * 2.4);
      float ring = exp(-pow((d - ringR) / 0.07, 2.0));
      float halo = exp(-pow((d - ringR) / 0.45, 2.0)) * 0.25;
      col = mix(col, uAccent, clamp((ring * 0.75 + halo) * uSelected.w, 0.0, 0.85));
    }

    float alpha = 1.0 - smoothstep(uFade * 0.42, uFade, dist);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

export class Pool {
  constructor() {
    this.ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0));
    this.rippleColors = Array.from({ length: MAX_RIPPLES }, () => new THREE.Color());
    this.cells = Array.from({ length: MAX_CELLS }, () => new THREE.Vector4());
    this.cellColors = Array.from({ length: MAX_CELLS }, () => new THREE.Color());
    this.nextRipple = 0;
    this.uniforms = {
      uTime: { value: 0 },
      uTide: { value: 1 },
      uFade: { value: 24 },
      uRipples: { value: this.ripples },
      uRippleColors: { value: this.rippleColors },
      uCells: { value: this.cells },
      uCellColors: { value: this.cellColors },
      uCellCount: { value: 0 },
      uSelected: { value: new THREE.Vector4(0, 0, 1, 0) },
      uDeep: { value: new THREE.Color() },
      uShallow: { value: new THREE.Color() },
      uSheen: { value: new THREE.Color() },
      uShadow: { value: new THREE.Color() },
      uSky: { value: new THREE.Color() },
      uAccent: { value: new THREE.Color() },
      uLightDir: { value: new THREE.Vector3(0.5, 1, 0.35) },
      tReflect: { value: null },
      uReflectMatrix: { value: new THREE.Matrix4() },
      uReflectivity: { value: 0.3 },
    };
    const geometry = new THREE.PlaneGeometry(56, 56, 240, 240);
    geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.renderOrder = 2;
    this.selectedTarget = 0;
  }

  /**
   * Sample a Reflector's render target. The matrix is refreshed right before
   * the pool draws, after the reflector has rendered this frame.
   */
  useReflector(reflector) {
    const inv = new THREE.Matrix4();
    this.uniforms.tReflect.value = reflector.getRenderTarget().texture;
    const texMatrix = reflector.material.uniforms.textureMatrix.value;
    this.mesh.onBeforeRender = () => {
      inv.copy(reflector.matrixWorld).invert();
      this.uniforms.uReflectMatrix.value.multiplyMatrices(texMatrix, inv);
    };
  }

  setPalette(p) {
    const u = this.uniforms;
    u.uDeep.value.set(p.deep);
    u.uShallow.value.set(p.shallow);
    u.uSheen.value.set(p.sheen);
    u.uShadow.value.set(p.shadow);
    u.uSky.value.set(p.sky);
    u.uAccent.value.set(p.accent);
  }

  ripple(x, z, rgb, strength = 1) {
    const i = this.nextRipple++ % MAX_RIPPLES;
    this.ripples[i].set(x, z, this.uniforms.uTime.value, strength);
    this.rippleColors[i].setRGB(rgb[0], rgb[1], rgb[2]);
  }

  setCells(list) {
    const n = Math.min(list.length, MAX_CELLS);
    for (let i = 0; i < n; i++) {
      const c = list[i];
      this.cells[i].set(c.x, c.z, c.r, c.lift);
      if (c.color) this.cellColors[i].setRGB(c.color[0], c.color[1], c.color[2], THREE.SRGBColorSpace);
    }
    this.uniforms.uCellCount.value = n;
  }

  setSelected(pos, radius) {
    if (pos) {
      this.uniforms.uSelected.value.x = pos.x;
      this.uniforms.uSelected.value.y = pos.z;
      this.uniforms.uSelected.value.z = radius;
      this.selectedTarget = 1;
    } else this.selectedTarget = 0;
  }

  tick(t, dt) {
    this.uniforms.uTime.value = t;
    const s = this.uniforms.uSelected.value;
    s.w += (this.selectedTarget - s.w) * Math.min(1, dt * 4);
  }
}
