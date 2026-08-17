import * as THREE from "three";

import type { GraphicTier } from "@/lib/graphics";

const EARTH_RADIUS = 2.28;
const EARTH_SURFACE_TEXTURE =
  "/assets/earth/nasa-blue-marble-topography-2048.jpg";
const EARTH_RELIEF_TEXTURE =
  "/assets/earth/nasa-blue-marble-relief-2048.webp";
const EARTH_CLOUD_TEXTURE =
  "/assets/earth/nasa-blue-marble-clouds-2048.jpg";
const FRAME_INTERVAL_MS = 1000 / 30;
const MOBILE_FRAME_BREAKPOINT_PX = 768;

const MIAMI = { latitude: 25.7959, longitude: -80.287 } as const;
const PUNTA_CANA = { latitude: 18.5674, longitude: -68.3634 } as const;

type HeroFlightEngineOptions = {
  tier: Exclude<GraphicTier, "STATIC">;
  onContextLost: () => void;
};

type DisposableMaterial = THREE.Material & Record<string, unknown>;

function clampProgress(value: number) {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function smoothstep(value: number) {
  const progress = clampProgress(value);
  return progress * progress * (3 - 2 * progress);
}

function latLonToVector(
  latitude: number,
  longitude: number,
  radius = EARTH_RADIUS,
) {
  const latitudeRadians = THREE.MathUtils.degToRad(latitude);
  const longitudeRadians = THREE.MathUtils.degToRad(longitude);

  return new THREE.Vector3(
    radius * Math.cos(latitudeRadians) * Math.sin(longitudeRadians),
    radius * Math.sin(latitudeRadians),
    radius * Math.cos(latitudeRadians) * Math.cos(longitudeRadians),
  );
}

function createFlightCurve() {
  const start = latLonToVector(MIAMI.latitude, MIAMI.longitude, 1).normalize();
  const end = latLonToVector(
    PUNTA_CANA.latitude,
    PUNTA_CANA.longitude,
    1,
  ).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(start, end);
  const identity = new THREE.Quaternion();
  const interpolation = new THREE.Quaternion();
  const points: THREE.Vector3[] = [];

  for (let index = 0; index <= 96; index += 1) {
    const progress = index / 96;
    interpolation.slerpQuaternions(identity, rotation, progress);
    const altitude = Math.sin(progress * Math.PI) * 0.48;
    points.push(
      start
        .clone()
        .applyQuaternion(interpolation)
        .normalize()
        .multiplyScalar(EARTH_RADIUS + 0.075 + altitude),
    );
  }

  return new THREE.CatmullRomCurve3(points, false, "centripetal", 0.45);
}

function createPlanformGeometry(
  coordinates: ReadonlyArray<readonly [number, number]>,
  thickness: number,
) {
  const shape = new THREE.Shape();

  coordinates.forEach(([x, z], index) => {
    if (index === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: Math.min(0.009, thickness * 0.28),
    bevelThickness: Math.min(0.009, thickness * 0.28),
    curveSegments: 2,
    depth: thickness,
    steps: 1,
  });
  geometry.translate(0, 0, -thickness / 2);
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function createVerticalFinGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.28, 0.015);
  shape.lineTo(0.22, 0.27);
  shape.lineTo(0.08, 0.25);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.006,
    bevelThickness: 0.006,
    depth: 0.032,
    steps: 1,
  });
  geometry.translate(0, 0, -0.016);
  geometry.rotateY(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function createAircraft(tier: Exclude<GraphicTier, "STATIC">) {
  const aircraft = new THREE.Group();
  aircraft.name = "elevant-procedural-aircraft";

  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xeefaff,
    clearcoat: 0.7,
    clearcoatRoughness: 0.24,
    metalness: 0.12,
    roughness: 0.3,
  });
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d9be8,
    emissive: 0x071a2d,
    emissiveIntensity: 0.42,
    metalness: 0.28,
    roughness: 0.32,
  });
  const orangeMaterial = new THREE.MeshStandardMaterial({
    color: 0xff641f,
    emissive: 0x3c1204,
    emissiveIntensity: 0.62,
    metalness: 0.16,
    roughness: 0.32,
  });
  const engineMaterial = new THREE.MeshStandardMaterial({
    color: 0x174c8f,
    metalness: 0.54,
    roughness: 0.26,
  });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x07172f,
    emissive: 0x102e4b,
    emissiveIntensity: 0.64,
    metalness: 0.38,
    roughness: 0.14,
  });

  const fuselage = new THREE.Mesh(
    new THREE.SphereGeometry(
      1,
      tier === "FULL" ? 36 : 24,
      tier === "FULL" ? 20 : 14,
    ),
    bodyMaterial,
  );
  fuselage.name = "fuselage";
  fuselage.scale.set(0.105, 0.11, 0.58);
  aircraft.add(fuselage);

  const wings = new THREE.Mesh(
    createPlanformGeometry(
      [
        [0, 0.16],
        [0.12, 0.1],
        [0.63, -0.13],
        [0.59, -0.23],
        [0.12, -0.12],
        [-0.12, -0.12],
        [-0.59, -0.23],
        [-0.63, -0.13],
        [-0.12, 0.1],
      ],
      0.032,
    ),
    wingMaterial,
  );
  wings.name = "swept-wings";
  wings.position.y = -0.012;
  aircraft.add(wings);

  const tailplane = new THREE.Mesh(
    createPlanformGeometry(
      [
        [0, 0.06],
        [0.055, 0.02],
        [0.3, -0.08],
        [0.28, -0.14],
        [0.05, -0.08],
        [-0.05, -0.08],
        [-0.28, -0.14],
        [-0.3, -0.08],
        [-0.055, 0.02],
      ],
      0.022,
    ),
    orangeMaterial,
  );
  tailplane.position.set(0, 0.014, -0.39);
  aircraft.add(tailplane);

  const verticalFin = new THREE.Mesh(
    createVerticalFinGeometry(),
    orangeMaterial,
  );
  verticalFin.position.set(0, 0.055, -0.34);
  aircraft.add(verticalFin);

  [-0.23, 0.23].forEach((x) => {
    const nacelle = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.046,
        0.052,
        0.205,
        tier === "FULL" ? 20 : 12,
        1,
        false,
      ),
      engineMaterial,
    );
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(x, -0.075, -0.045);
    aircraft.add(nacelle);

    const intake = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.039,
        0.039,
        0.012,
        tier === "FULL" ? 20 : 12,
      ),
      glassMaterial,
    );
    intake.rotation.x = Math.PI / 2;
    intake.position.set(x, -0.075, 0.061);
    aircraft.add(intake);
  });

  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(1, tier === "FULL" ? 20 : 12, 10),
    glassMaterial,
  );
  cockpit.scale.set(0.078, 0.035, 0.15);
  cockpit.position.set(0, 0.084, 0.34);
  aircraft.add(cockpit);

  if (tier === "FULL") {
    const windowGeometry = new THREE.SphereGeometry(0.014, 8, 5);
    for (const side of [-1, 1]) {
      for (let index = 0; index < 6; index += 1) {
        const cabinWindow = new THREE.Mesh(windowGeometry, glassMaterial);
        cabinWindow.scale.set(0.32, 0.72, 1);
        cabinWindow.position.set(
          side * 0.103,
          0.025,
          0.19 - index * 0.073,
        );
        aircraft.add(cabinWindow);
      }
    }
  }

  const redLightMaterial = new THREE.MeshBasicMaterial({
    color: 0xff3f34,
    transparent: true,
  });
  const greenLightMaterial = new THREE.MeshBasicMaterial({
    color: 0x63ffc2,
    transparent: true,
  });
  const lightGeometry = new THREE.SphereGeometry(0.018, 8, 6);
  const redLight = new THREE.Mesh(lightGeometry, redLightMaterial);
  redLight.position.set(-0.625, -0.005, -0.145);
  const greenLight = new THREE.Mesh(lightGeometry, greenLightMaterial);
  greenLight.position.set(0.625, -0.005, -0.145);
  aircraft.add(redLight, greenLight);

  aircraft.scale.setScalar(tier === "FULL" ? 0.88 : 0.82);
  aircraft.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = tier === "FULL";
      object.renderOrder = 5;
    }
  });

  return {
    group: aircraft,
    navigationLights: [redLightMaterial, greenLightMaterial] as const,
  };
}

function seededRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function createStars(tier: Exclude<GraphicTier, "STATIC">) {
  const count = tier === "FULL" ? 760 : 280;
  const positions = new Float32Array(count * 3);
  const random = seededRandom(27032026);

  for (let index = 0; index < count; index += 1) {
    const radius = 10 + random() * 14;
    const theta = random() * Math.PI * 2;
    const phi = Math.acos(2 * random() - 1);
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    blending: THREE.AdditiveBlending,
    color: 0xb9eaff,
    depthWrite: false,
    opacity: tier === "FULL" ? 0.68 : 0.5,
    size: tier === "FULL" ? 0.026 : 0.021,
    sizeAttenuation: true,
    transparent: true,
  });

  return new THREE.Points(geometry, material);
}

function createWorldOrientation(curve: THREE.CatmullRomCurve3) {
  const forward = curve.getPointAt(0.5).normalize();
  const north = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(north, forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, right).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, forward);
  return new THREE.Quaternion().setFromRotationMatrix(basis).invert();
}

function createMarker(
  position: THREE.Vector3,
  color: number,
  tier: Exclude<GraphicTier, "STATIC">,
) {
  const marker = new THREE.Group();
  const normal = position.clone().normalize();
  marker.position.copy(position);
  marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.045, 0.074, tier === "FULL" ? 32 : 18),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
  );
  marker.add(ring);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.026, 10, 7),
    new THREE.MeshBasicMaterial({ color }),
  );
  core.position.z = 0.012;
  marker.add(core);

  return marker;
}

function disposeMaterial(material: THREE.Material) {
  Object.values(material as DisposableMaterial).forEach((value) => {
    if (value instanceof THREE.Texture) value.dispose();
  });
  material.dispose();
}

export class HeroFlightEngine {
  readonly canvas: HTMLCanvasElement;

  private readonly tier: Exclude<GraphicTier, "STATIC">;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 60);
  private readonly world = new THREE.Group();
  private readonly earth: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>;
  private readonly clouds: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhongMaterial>;
  private readonly atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly stars: THREE.Points;
  private readonly curve = createFlightCurve();
  private readonly routeProgress: THREE.Line;
  private readonly routePointCount: number;
  private readonly routeNodes: Array<THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>> = [];
  private readonly aircraft: ReturnType<typeof createAircraft>;
  private readonly baseWorldOrientation: THREE.Quaternion;
  private readonly loadedTextures = new Set<THREE.Texture>();
  private readonly onContextLost: () => void;
  private readonly flightPosition = new THREE.Vector3();
  private readonly flightTangent = new THREE.Vector3();
  private readonly flightNormal = new THREE.Vector3();
  private readonly flightRight = new THREE.Vector3();
  private readonly flightLookTarget = new THREE.Vector3();
  private readonly worldDriftRotation = new THREE.Quaternion();
  private readonly worldDriftAxis = new THREE.Vector3(0, 1, 0);
  private frameId = 0;
  private running = false;
  private visible = false;
  private disposed = false;
  private currentProgress = 0;
  private targetProgress = 0;
  private ambientElapsedSeconds = 0;
  private lastFrameTime = 0;
  private throttlesFrameRate = false;
  private width = 0;
  private height = 0;

  constructor({ tier, onContextLost }: HeroFlightEngineOptions) {
    this.tier = tier;
    this.onContextLost = onContextLost;
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: tier === "FULL",
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.canvas = this.renderer.domElement;
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost, {
      passive: false,
    });

    this.renderer.setClearColor(0x020712, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = tier === "FULL";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.fog = new THREE.FogExp2(0x020712, 0.022);
    this.scene.add(this.world);
    this.scene.add(new THREE.HemisphereLight(0x9eeaff, 0x01040c, 1.55));

    const keyLight = new THREE.DirectionalLight(0xf4fbff, 3.3);
    keyLight.position.set(-4.5, 3.8, 6.5);
    keyLight.castShadow = tier === "FULL";
    keyLight.shadow.mapSize.set(512, 512);
    this.scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x2da8ff, 18, 18, 2);
    rimLight.position.set(4.5, 1, 5.5);
    this.scene.add(rimLight);

    const earthGeometry = new THREE.SphereGeometry(
      EARTH_RADIUS,
      tier === "FULL" ? 112 : 56,
      tier === "FULL" ? 72 : 36,
    );
    const earthMaterial = new THREE.MeshPhysicalMaterial({
      clearcoat: tier === "FULL" ? 0.18 : 0,
      clearcoatRoughness: 0.58,
      color: 0x073660,
      emissive: 0x010a18,
      emissiveIntensity: 0.26,
      metalness: 0.03,
      roughness: 0.72,
    });
    this.earth = new THREE.Mesh(earthGeometry, earthMaterial);
    this.earth.receiveShadow = tier === "FULL";
    this.world.add(this.earth);

    const cloudMaterial = new THREE.MeshPhongMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xbbefff,
      depthWrite: false,
      opacity: 0,
      transparent: true,
    });
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(
        EARTH_RADIUS * 1.012,
        tier === "FULL" ? 72 : 40,
        tier === "FULL" ? 48 : 28,
      ),
      cloudMaterial,
    );
    this.world.add(this.clouds);

    const atmosphereMaterial = new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float rim = pow(1.0 - abs(dot(vNormal, vView)), 3.15);
          vec3 cyan = vec3(0.24, 0.79, 1.0);
          vec3 blue = vec3(0.06, 0.26, 0.82);
          gl_FragColor = vec4(mix(blue, cyan, rim), rim * 0.88);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vView = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
    });
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(
        EARTH_RADIUS * 1.075,
        tier === "FULL" ? 72 : 40,
        tier === "FULL" ? 48 : 28,
      ),
      atmosphereMaterial,
    );
    this.world.add(this.atmosphere);

    const routeTube = new THREE.Mesh(
      new THREE.TubeGeometry(
        this.curve,
        tier === "FULL" ? 112 : 58,
        tier === "FULL" ? 0.015 : 0.018,
        tier === "FULL" ? 7 : 4,
        false,
      ),
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: 0x63ddff,
        depthWrite: false,
        opacity: 0.26,
        transparent: true,
      }),
    );
    routeTube.renderOrder = 3;
    this.world.add(routeTube);

    const routePoints = this.curve.getPoints(tier === "FULL" ? 144 : 72);
    this.routePointCount = routePoints.length;
    const routeProgressGeometry = new THREE.BufferGeometry().setFromPoints(
      routePoints,
    );
    routeProgressGeometry.setDrawRange(0, 2);
    this.routeProgress = new THREE.Line(
      routeProgressGeometry,
      new THREE.LineBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: 0xff7a38,
        depthTest: false,
        depthWrite: false,
        opacity: 0.95,
        transparent: true,
      }),
    );
    this.routeProgress.renderOrder = 6;
    this.world.add(this.routeProgress);

    [0.08, 0.29, 0.5, 0.71, 0.92].forEach((routePosition) => {
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: 0x255a86,
        depthWrite: false,
        transparent: true,
        opacity: 0.5,
      });
      const node = new THREE.Mesh(
        new THREE.SphereGeometry(
          tier === "FULL" ? 0.034 : 0.04,
          tier === "FULL" ? 12 : 8,
          tier === "FULL" ? 8 : 6,
        ),
        material,
      );
      node.position.copy(this.curve.getPointAt(routePosition));
      node.userData.routePosition = routePosition;
      node.renderOrder = 6;
      this.routeNodes.push(node);
      this.world.add(node);
    });

    this.world.add(
      createMarker(
        latLonToVector(MIAMI.latitude, MIAMI.longitude, EARTH_RADIUS + 0.035),
        0x63ddff,
        tier,
      ),
      createMarker(
        latLonToVector(
          PUNTA_CANA.latitude,
          PUNTA_CANA.longitude,
          EARTH_RADIUS + 0.04,
        ),
        0xff641f,
        tier,
      ),
    );

    this.aircraft = createAircraft(tier);
    this.world.add(this.aircraft.group);

    this.baseWorldOrientation = createWorldOrientation(this.curve);
    this.world.quaternion.copy(this.baseWorldOrientation);

    this.stars = createStars(tier);
    this.scene.add(this.stars);

    this.loadEarthTextures();
    this.updateFlight(0);
  }

  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.stop();
    this.onContextLost();
  };

  private loadTexture(
    path: string,
    onLoad: (texture: THREE.Texture) => void,
  ) {
    new THREE.TextureLoader().load(
      path,
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }

        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.offset.x = 0.25;
        texture.anisotropy = Math.min(
          this.tier === "FULL" ? 8 : 2,
          this.renderer.capabilities.getMaxAnisotropy(),
        );
        texture.needsUpdate = true;
        this.loadedTextures.add(texture);
        onLoad(texture);
        this.renderOnce();
      },
      undefined,
      () => {
        // The tinted globe remains a complete fallback when an optional map fails.
      },
    );
  }

  private loadEarthTextures() {
    this.loadTexture(EARTH_SURFACE_TEXTURE, (texture) => {
      this.earth.material.map = texture;
      this.earth.material.needsUpdate = true;
    });

    this.loadTexture(EARTH_CLOUD_TEXTURE, (texture) => {
      this.clouds.material.map = texture;
      this.clouds.material.opacity = this.tier === "FULL" ? 0.24 : 0.14;
      this.clouds.material.needsUpdate = true;
    });

    if (this.tier !== "FULL") return;

    this.loadTexture(EARTH_RELIEF_TEXTURE, (texture) => {
      texture.colorSpace = THREE.NoColorSpace;
      this.earth.material.bumpMap = texture;
      this.earth.material.bumpScale = 0.075;
      this.earth.material.displacementMap = texture;
      this.earth.material.displacementBias = -0.012;
      this.earth.material.displacementScale = 0.035;
      this.earth.material.needsUpdate = true;
    });
  }

  resize(width: number, height: number) {
    if (this.disposed || width < 2 || height < 2) return;
    this.width = width;
    this.height = height;
    this.throttlesFrameRate =
      this.tier === "LITE" || window.innerWidth < MOBILE_FRAME_BREAKPOINT_PX;

    const maximumPixelRatio = this.tier === "FULL" ? 1.5 : 1;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, maximumPixelRatio),
    );
    this.renderer.setSize(Math.round(width), Math.round(height), false);

    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.72 ? 43 : aspect < 1.15 ? 40 : 37;
    this.camera.position.set(
      0,
      aspect < 0.72 ? 0.42 : 0.12,
      aspect < 0.72 ? 8.55 : aspect < 1.15 ? 7.8 : 7.05,
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.world.position.set(
      aspect < 0.72 ? 0.34 : aspect < 1.15 ? 0.62 : 1.22,
      aspect < 0.72 ? 0.72 : aspect < 1.15 ? 0.22 : -0.08,
      0,
    );
    this.world.scale.setScalar(aspect < 0.72 ? 0.9 : 1);
    this.renderOnce();
  }

  setProgress(progress: number) {
    this.targetProgress = clampProgress(progress);
    if (!this.visible) {
      this.currentProgress = this.targetProgress;
      this.updateFlight(this.currentProgress);
      return;
    }
    this.start();
  }

  setActive(active: boolean) {
    this.visible = active;
    if (active) this.start();
    else this.stop();
  }

  private start() {
    if (this.disposed || this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this.frameId = window.requestAnimationFrame(this.tick);
  }

  private stop() {
    this.running = false;
    window.cancelAnimationFrame(this.frameId);
    this.frameId = 0;
  }

  private readonly tick = (time: number) => {
    if (!this.running || this.disposed || !this.visible) return;

    const elapsedMilliseconds = time - this.lastFrameTime;
    if (
      this.throttlesFrameRate &&
      elapsedMilliseconds + 1 < FRAME_INTERVAL_MS
    ) {
      this.frameId = window.requestAnimationFrame(this.tick);
      return;
    }

    const deltaSeconds = Math.min(0.05, elapsedMilliseconds / 1000);
    this.lastFrameTime = time;
    this.ambientElapsedSeconds += deltaSeconds;
    const blend = 1 - Math.exp(-deltaSeconds * 8.5);
    this.currentProgress = THREE.MathUtils.lerp(
      this.currentProgress,
      this.targetProgress,
      blend,
    );
    if (Math.abs(this.currentProgress - this.targetProgress) < 0.0004) {
      this.currentProgress = this.targetProgress;
    }
    this.updateFlight(this.currentProgress);
    this.renderer.render(this.scene, this.camera);

    this.frameId = window.requestAnimationFrame(this.tick);
  };

  private updateFlight(progress: number) {
    const easedProgress = smoothstep(progress);
    const routeProgress = 0.025 + easedProgress * 0.95;
    const position = this.curve.getPointAt(routeProgress, this.flightPosition);
    const tangent = this.curve
      .getTangentAt(routeProgress, this.flightTangent)
      .normalize();
    const normal = this.flightNormal.copy(position).normalize();
    const right = this.flightRight.crossVectors(tangent, normal).normalize();
    const ambientTime = this.ambientElapsedSeconds;
    const altitudeDrift = Math.sin(ambientTime * 0.72) * 0.012;
    const lateralDrift = Math.sin(ambientTime * 0.43 + 1.15) * 0.006;

    position
      .addScaledVector(normal, altitudeDrift)
      .addScaledVector(right, lateralDrift);

    this.aircraft.group.position.copy(position);
    this.aircraft.group.up.copy(normal);
    this.aircraft.group.lookAt(
      this.flightLookTarget.copy(position).add(tangent),
    );
    this.aircraft.group.rotateZ(
      Math.sin(easedProgress * Math.PI) * -0.11 +
        Math.sin(ambientTime * 0.58 + 0.4) * 0.014,
    );

    this.routeProgress.geometry.setDrawRange(
      0,
      Math.max(2, Math.ceil(this.routePointCount * routeProgress)),
    );
    this.routeNodes.forEach((node, index) => {
      const active = routeProgress >= Number(node.userData.routePosition);
      const pulse =
        (Math.sin(ambientTime * 1.65 + index * 0.82) + 1) * 0.5;
      node.material.color.setHex(active ? 0xff7a38 : 0x255a86);
      node.material.opacity = active ? 0.88 + pulse * 0.1 : 0.46;
      node.scale.setScalar(active ? 1.14 + pulse * 0.08 : 1);
    });

    this.clouds.rotation.y = easedProgress * 0.045 + ambientTime * 0.0038;
    this.stars.rotation.y = easedProgress * -0.018 - ambientTime * 0.0018;
    this.stars.rotation.x = Math.sin(ambientTime * 0.08) * 0.004;

    const lightBreath = Math.sin(ambientTime * 2.15) * 0.08;
    const strobePhase = (ambientTime % 2.4) / 2.4;
    const strobe = Math.exp(-Math.pow(strobePhase / 0.035, 2)) * 0.28;
    const lightOpacity = THREE.MathUtils.clamp(
      0.66 + lightBreath + strobe,
      0.5,
      1,
    );
    this.aircraft.navigationLights.forEach((material) => {
      material.opacity = lightOpacity;
    });

    const drift = (easedProgress - 0.5) * 0.1;
    this.worldDriftRotation.setFromAxisAngle(this.worldDriftAxis, drift);
    this.world.quaternion
      .copy(this.worldDriftRotation)
      .multiply(this.baseWorldOrientation);
  }

  renderOnce() {
    if (this.disposed || this.width < 2 || this.height < 2) return;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);

    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line)) {
        return;
      }

      object.geometry?.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => disposeMaterial(material));
    });
    this.loadedTextures.forEach((texture) => texture.dispose());
    this.loadedTextures.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
