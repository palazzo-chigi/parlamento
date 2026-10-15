import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { getTheme, onThemeChange } from './theme.js';

const LAYOUT = { r0: 6, dr: 1.15, spacing: 1.0, span: Math.PI * 0.95, rise: 0.38 };
const ACCENT = new THREE.Color('#38e8ff');

// Palette della scena per ciascuno stile (vedi theme.js)
const PALETTES = {
  hud: {
    bg: '#05080f', fogDensity: 0.012, toneMapping: THREE.ACESFilmicToneMapping, bloom: true, light: 0,
    accent: '#38e8ff', hover: '#ffffff', floor: '#060a13',
    ring: '#0b1220', ringOpacity: 0.85, edge: '#38e8ff', edgeOpacity: 0.35, step: '#0a101c',
    bench: '#0d1526', benchEdge: '#38e8ff', particles: true,
  },
  ep: {
    bg: '#eef1f5', fogDensity: 0.006, toneMapping: THREE.NoToneMapping, bloom: false, light: 1,
    accent: '#003399', hover: '#0b1f4d', floor: '#eef1f5',
    ring: '#dde3eb', ringOpacity: 1, edge: '#003399', edgeOpacity: 0.45, step: '#c3ccd9',
    bench: '#003399', benchEdge: '#ffcc00', particles: false,
  },
};

// Genera n posizioni su archi concentrici, ordinate per angolo (sinistra -> destra).
export function seatLayout(n, opt = LAYOUT) {
  const seats = [];
  let row = 0;
  while (seats.length < n) {
    const R = opt.r0 + row * opt.dr;
    const count = Math.floor((R * opt.span) / opt.spacing);
    let rowSeats = [];
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const theta = Math.PI / 2 - opt.span / 2 + t * opt.span;
      rowSeats.push({ row, theta, x: R * Math.cos(theta), y: row * opt.rise, z: R * Math.sin(theta) });
    }
    const missing = n - seats.length;
    if (count > missing) {
      const start = Math.floor((count - missing) / 2);
      rowSeats = rowSeats.slice(start, start + missing);
    }
    seats.push(...rowSeats);
    row++;
  }
  seats.sort((a, b) => a.theta - b.theta);
  return { seats, rows: row };
}

function seatGeometry() {
  const base = new THREE.BoxGeometry(0.72, 0.28, 0.72).translate(0, 0.14, 0);
  const back = new THREE.BoxGeometry(0.72, 0.6, 0.1).translate(0, 0.58, -0.31);
  return BufferGeometryUtils.mergeGeometries([base, back]);
}

// Seggi olografici: colore per istanza, rim-light di Fresnel, scanline, reveal progressivo.
const seatMaterial = () => new THREE.ShaderMaterial({
  transparent: true,
  uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uLight: { value: 0 } },
  vertexShader: /* glsl */`
    attribute float aOrder;
    uniform float uReveal;
    varying vec3 vN; varying vec3 vV; varying vec3 vColor; varying vec3 vW; varying float vA;
    void main() {
      vColor = instanceColor;
      float r = clamp((uReveal - aOrder) * 6.0, 0.0, 1.0);
      vA = r;
      vec3 p = position;
      p.y += (1.0 - r) * (1.0 - r) * 6.0;
      vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
      vW = w.xyz;
      vec4 mv = viewMatrix * w;
      vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform float uLight;
    varying vec3 vN; varying vec3 vV; varying vec3 vColor; varying vec3 vW; varying float vA;
    void main() {
      if (vA < 0.01) discard;
      float fres = pow(1.0 - max(dot(normalize(vN), normalize(vV)), 0.0), 2.2);
      float scan = 0.5 + 0.5 * sin(vW.y * 28.0 - uTime * 3.0);
      float top = smoothstep(0.2, 0.9, normalize(vN).y);
      // HUD: olografico con rim-light; Europarl: seggio pieno, ombreggiatura morbida
      vec3 holo = vColor * (0.3 + 0.2 * top) + vColor * fres * 1.1 + vColor * scan * 0.06;
      float side = 0.5 + 0.5 * normalize(vN).x;
      vec3 solid = vColor * (0.62 + 0.38 * top + 0.08 * side) + vec3(fres * 0.06);
      vec3 col = mix(holo, solid, uLight);
      float a = mix(0.85 + fres * 0.15, 1.0, uLight) * vA;
      gl_FragColor = vec4(col, a);
    }`,
});

// Pavimento radar: griglia polare luminosa, anelli, sweep rotante.
const floorMaterial = () => new THREE.ShaderMaterial({
  transparent: true,
  side: THREE.DoubleSide,
  depthWrite: false,
  uniforms: { uTime: { value: 0 }, uColor: { value: ACCENT.clone() }, uBase: { value: new THREE.Color('#060a13') }, uRmax: { value: 20 }, uLight: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec3 vW;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform vec3 uColor; uniform vec3 uBase; uniform float uRmax; uniform float uLight;
    varying vec3 vW;
    float line(float v, float w) { float d = abs(fract(v) - 0.5); return smoothstep(0.5 - w - 0.02, 0.5 - w + 0.02, d); }
    void main() {
      float r = length(vW.xz);
      float ang = atan(vW.x, vW.z);
      float rings = line(r, 0.015) * 0.45 + line(r / 5.0, 0.006) * 0.9;
      float spokes = line(ang / (3.14159 / 18.0), 0.015) * smoothstep(1.5, 6.0, r) * 0.3;
      float sweepA = fract((ang + 3.14159) / 6.2832 - uTime * 0.06);
      float sweep = pow(1.0 - sweepA, 12.0) * 0.5 * (1.0 - uLight);
      float fade = 1.0 - smoothstep(uRmax * 0.75, uRmax * 1.05, r);
      float glow = (rings + spokes + sweep) * fade;
      vec3 dark = uBase + uColor * glow * 0.9;
      vec3 light = mix(uBase, uColor, clamp(glow * 0.22, 0.0, 1.0));
      gl_FragColor = vec4(mix(dark, light, uLight), mix(0.95, 1.0, uLight));
    }`,
});

export class Hemicycle {
  constructor(container, { onHover, onClick }) {
    this.container = container;
    this.onHover = onHover;
    this.onClick = onClick;
    this.hovered = -1;
    this.selected = -1;
    this.clock = new THREE.Clock();
    this.buildTime = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05080f, 0.012);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 90;
    this.controls.enablePan = false;
    this.renderer.domElement.addEventListener('pointerdown', () => { this.controls.autoRotate = false; this.flight = null; this.controls.enabled = true; });

    // layer HTML ancorato alla scena (schede e tag sui seggi)
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    container.appendChild(this.labels.domElement);
    this.dossier = new CSS2DObject(document.createElement('div'));
    this.dossier.visible = false;
    this.scene.add(this.dossier);
    this.tag = new CSS2DObject(document.createElement('div'));
    this.tag.visible = false;
    this.scene.add(this.tag);
    this.flight = null;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.4, 0.35);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.static = new THREE.Group();
    this.scene.add(this.static);
    this.seatGeo = seatGeometry();
    this.seatMat = seatMaterial();
    this.floorMat = floorMaterial();
    this.mesh = null;
    this.mats = {
      ring: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
      edge: new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide }),
      step: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      bench: new THREE.MeshBasicMaterial(),
      benchEdge: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 }),
      particles: new THREE.PointsMaterial({ size: 0.06, transparent: true, opacity: 0.55, depthWrite: false }),
    };

    const mkOutline = (size, color, opacity) => {
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(...size).translate(0, size[1] / 2, -0.05));
      const l = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      l.matrixAutoUpdate = false;
      l.visible = false;
      this.scene.add(l);
      return l;
    };
    this.hoverOutline = mkOutline([0.95, 1.0, 0.95], 0xffffff, 0.8);
    this.selectOutline = mkOutline([1.1, 1.15, 1.1], ACCENT.getHex(), 1);
    // anello pulsante sotto il seggio selezionato
    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.75, 48),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false })
    );
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);

    this.setTheme(getTheme());
    onThemeChange((t) => this.setTheme(t));

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.renderer.domElement.addEventListener('pointermove', (e) => this._setHover(this._pick(e)));
    this.renderer.domElement.addEventListener('pointerleave', () => this._setHover(-1));
    this.renderer.domElement.addEventListener('pointerdown', (e) => { this._down = [e.clientX, e.clientY]; });
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!this._down) return;
      const moved = Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]);
      this._down = null;
      if (moved < 5) { const i = this._pick(e); if (i >= 0) this.onClick(i); }
    });
    window.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _frame() {
    const t = this.clock.getElapsedTime();
    this.seatMat.uniforms.uTime.value = t;
    this.floorMat.uniforms.uTime.value = t;
    this.seatMat.uniforms.uReveal.value = Math.min(1.3, (t - this.buildTime) * 0.75);
    if (this.selectRing.visible) {
      const s = 1 + 0.12 * Math.sin(t * 4);
      this.selectRing.scale.set(s, s, s);
      this.selectRing.material.opacity = 0.6 + 0.3 * Math.sin(t * 4);
    }
    if (this.particles) this.particles.rotation.y = t * 0.01;
    this._stepColorAnim();
    if (this.flight) {
      const f = this.flight;
      let k = Math.min(1, (t - f.t0) / 1.1);
      k = k * k * (3 - 2 * k);
      this.camera.position.lerpVectors(f.from, f.to, k);
      this.controls.target.lerpVectors(f.fromT, f.toT, k);
      if (k >= 1) { this.flight = null; this.controls.enabled = true; f.onDone?.(); }
    }
    this.controls.update();
    this.composer.render();
    this.labels.render(this.scene, this.camera);
  }

  // vola davanti al seggio i, guardandolo dal lato della presidenza
  flyTo(i) {
    const s = this.seats[i];
    const d = new THREE.Vector3(s.x, 0, s.z).normalize();
    const to = new THREE.Vector3(s.x, s.y, s.z).addScaledVector(d, -10).add(new THREE.Vector3(0, 5.5, 0));
    this._fly(to, new THREE.Vector3(s.x, s.y + 2.6, s.z));
  }

  // torna alla vista iniziale e riprende la rotazione automatica
  resetView() {
    if (!this.home) return;
    this._fly(this.home.pos, this.home.target, () => { this.controls.autoRotate = true; });
  }

  _fly(to, toT, onDone) {
    this.flight = {
      t0: this.clock.getElapsedTime(),
      from: this.camera.position.clone(), to: to.clone(),
      fromT: this.controls.target.clone(), toT: toT.clone(),
      onDone,
    };
    this.controls.autoRotate = false;
    this.controls.enabled = false;
  }

  showDossier(i, element) {
    const s = this.seats[i];
    this.dossier.element.replaceChildren(element);
    this.dossier.position.set(s.x, s.y + 1.1, s.z);
    this.dossier.visible = true;
    this.tag.visible = false;
  }

  hideDossier() {
    this.dossier.visible = false;
    this.dossier.element.replaceChildren();
  }

  showTag(i, element) {
    if (this.dossier.visible && this.selected === i) { this.tag.visible = false; return; }
    const s = this.seats[i];
    this.tag.element.replaceChildren(element);
    this.tag.position.set(s.x, s.y + 1.0, s.z);
    this.tag.visible = true;
  }

  hideTag() {
    this.tag.visible = false;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  build(n, colors) {
    this.static.clear();
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.dispose(); }
    this._setHover(-1);
    this.select(-1);
    this.hideDossier();
    this.flight = null;
    this.controls.enabled = true;

    const { seats, rows } = seatLayout(n);
    this.seats = seats;
    const rMax = LAYOUT.r0 + (rows - 1) * LAYOUT.dr;
    this.home = { pos: new THREE.Vector3(-rMax * 0.35, rMax * 1.25, -rMax * 1.15), target: new THREE.Vector3(0, 1, rMax * 0.5) };
    this.camera.position.copy(this.home.pos);
    this.controls.target.copy(this.home.target);
    this.controls.autoRotate = true;
    this.controls.update();
    this.floorMat.uniforms.uRmax.value = rMax + 4;
    this.buildTime = this.clock.getElapsedTime();
    this.seatMat.uniforms.uReveal.value = 0;

    const geo = this.seatGeo.clone();
    const order = new Float32Array(n);
    seats.forEach((s, i) => { order[i] = (s.theta - (Math.PI / 2 - LAYOUT.span / 2)) / LAYOUT.span; });
    geo.setAttribute('aOrder', new THREE.InstancedBufferAttribute(order, 1));
    this.mesh = new THREE.InstancedMesh(geo, this.seatMat, n);
    const dummy = new THREE.Object3D();
    seats.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.lookAt(0, s.y, 0);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    });
    this.setColors(colors);
    this.scene.add(this.mesh);

    const t0 = Math.PI / 2 - LAYOUT.span / 2 - 0.04, tl = LAYOUT.span + 0.08;
    for (let r = 0; r < rows; r++) {
      const R = LAYOUT.r0 + r * LAYOUT.dr;
      // gradino scuro traslucido
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(R - LAYOUT.dr / 2, R + LAYOUT.dr / 2, 128, 1, t0, tl),
        this.mats.ring
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = r * LAYOUT.rise - 0.012;
      this.static.add(ring);
      // bordo luminoso sul fronte di ogni fila
      const edge = new THREE.Mesh(
        new THREE.RingGeometry(R - LAYOUT.dr / 2, R - LAYOUT.dr / 2 + 0.05, 128, 1, t0, tl),
        this.mats.edge
      );
      edge.rotation.x = Math.PI / 2;
      edge.position.y = r * LAYOUT.rise - 0.005;
      this.static.add(edge);
      if (r > 0) {
        const step = new THREE.Mesh(
          new THREE.CylinderGeometry(R - LAYOUT.dr / 2, R - LAYOUT.dr / 2, LAYOUT.rise, 128, 1, true, Math.PI / 2 - t0 - tl, tl),
          this.mats.step
        );
        step.position.y = r * LAYOUT.rise - LAYOUT.rise / 2;
        this.static.add(step);
      }
    }

    // pavimento radar (disco pieno sotto tutto)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(rMax + 6, 128), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    this.static.add(floor);

    // banco della presidenza: blocco scuro con spigoli luminosi
    const benchGeo = new THREE.BoxGeometry(5, 0.9, 1.4);
    const bench = new THREE.Mesh(benchGeo, this.mats.bench);
    bench.position.set(0, 0.45, 1.6);
    this.static.add(bench);
    const benchEdges = new THREE.LineSegments(new THREE.EdgesGeometry(benchGeo), this.mats.benchEdge);
    benchEdges.position.copy(bench.position);
    this.static.add(benchEdges);

    // particelle sospese
    const count = 600;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (rMax + 8);
      pos[i * 3] = Math.cos(a) * rr;
      pos[i * 3 + 1] = Math.random() * 14 + 0.5;
      pos[i * 3 + 2] = Math.sin(a) * rr;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(pGeo, this.mats.particles);
    this.particles.visible = this.pal.particles;
    this.static.add(this.particles);
  }

  // applica la palette di uno stile ('hud' | 'ep') a sfondo, pavimento, gradini, banco, contorni e post-processing
  setTheme(name) {
    const p = PALETTES[name] || PALETTES.hud;
    this.pal = p;
    const C = (hex) => new THREE.Color(hex);
    this.renderer.setClearColor(C(p.bg));
    this.renderer.toneMapping = p.toneMapping;
    this.scene.fog.color.set(p.bg);
    this.scene.fog.density = p.fogDensity;
    this.bloom.enabled = p.bloom;
    this.seatMat.uniforms.uLight.value = p.light;
    this.floorMat.uniforms.uLight.value = p.light;
    this.floorMat.uniforms.uColor.value.set(p.accent);
    this.floorMat.uniforms.uBase.value.set(p.floor);
    this.mats.ring.color.set(p.ring); this.mats.ring.opacity = p.ringOpacity;
    this.mats.edge.color.set(p.edge); this.mats.edge.opacity = p.edgeOpacity;
    this.mats.step.color.set(p.step);
    this.mats.bench.color.set(p.bench);
    this.mats.benchEdge.color.set(p.benchEdge);
    this.mats.particles.color.set(p.accent);
    if (this.particles) this.particles.visible = p.particles;
    this.hoverOutline.material.color.set(p.hover);
    this.selectOutline.material.color.set(p.accent);
    this.selectRing.material.color.set(p.accent);
  }

  setColors(colors) {
    this.colors = colors.slice();
    this.colorAnim = null;
    const c = new THREE.Color();
    for (let i = 0; i < this.mesh.count; i++) this.mesh.setColorAt(i, c.set(colors[i]));
    this.mesh.instanceColor.needsUpdate = true;
  }

  // transizione progressiva verso i nuovi colori, un seggio alla volta in ordine casuale; onProgress(k) con k in [0,1]
  animateColors(target, duration = 2200, onProgress) {
    const order = [...Array(this.mesh.count).keys()];
    for (let i = order.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
    this.colorAnim = { target, order, t0: this.clock.getElapsedTime(), duration: duration / 1000, done: 0, onProgress };
  }

  _stepColorAnim() {
    const a = this.colorAnim;
    if (!a) return;
    const k = Math.min(1, (this.clock.getElapsedTime() - a.t0) / a.duration);
    const upto = Math.floor(a.order.length * k);
    const c = new THREE.Color();
    for (let i = a.done; i < upto; i++) {
      const idx = a.order[i];
      this.colors[idx] = a.target[idx];
      this.mesh.setColorAt(idx, c.set(a.target[idx]));
    }
    a.done = upto;
    this.mesh.instanceColor.needsUpdate = true;
    a.onProgress?.(k);
    if (k >= 1) this.colorAnim = null;
  }

  _place(outline, i) {
    if (i < 0 || !this.mesh) { outline.visible = false; return; }
    this.mesh.getMatrixAt(i, outline.matrix);
    outline.visible = true;
  }

  select(i) {
    this.selected = i;
    this._place(this.selectOutline, i);
    if (i >= 0) {
      const s = this.seats[i];
      this.selectRing.position.set(s.x, s.y + 0.02, s.z);
      this.selectRing.visible = true;
    } else {
      this.selectRing.visible = false;
    }
  }

  _setHover(i) {
    if (i === this.hovered) return;
    this.hovered = i;
    this._place(this.hoverOutline, i);
    this.container.classList.toggle('hovering', i >= 0);
    this.onHover(i);
  }

  _pick(e) {
    if (!this.mesh) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.mesh, false)[0];
    return hit ? hit.instanceId : -1;
  }
}
