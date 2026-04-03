import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

import type { DistributionMemberPoint } from "../lib/distribution.js";
import { formatPercent } from "../lib/format.js";

type ExplorePageProps = {
  members: DistributionMemberPoint[];
  assemblyLabel: string;
  onSelectMember: (memberId: string) => void;
};

const PARTY_COLORS: Record<string, number> = {
  "더불어민주당": 0x3b82f6,
  "국민의힘": 0xef4444,
  "조국혁신당": 0x60a5fa,
  "개혁신당": 0xfb923c,
  "진보당": 0xf43f5e,
  "사회민주당": 0xa78bfa,
  "기본소득당": 0x34d399,
  "무소속": 0x94a3b8
};
const PARTY_COLORS_HEX: Record<string, string> = {
  "더불어민주당": "#3b82f6",
  "국민의힘": "#ef4444",
  "조국혁신당": "#60a5fa",
  "개혁신당": "#fb923c",
  "진보당": "#f43f5e",
  "사회민주당": "#a78bfa",
  "기본소득당": "#34d399",
  "무소속": "#94a3b8"
};
const FALLBACK_COLOR = 0x94a3b8;

type Particle = {
  member: DistributionMemberPoint;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  targetPosition: THREE.Vector3;
  baseSize: number;
  phase: number;
  risk: number;
};

function computeRisk(m: DistributionMemberPoint): number {
  return Math.min(1, m.absentRate * 1.5 + m.negativeRate * 0.5 + (m.currentNegativeOrAbsentStreak / 30) * 0.8);
}

function buildPartyClusterCenters(members: DistributionMemberPoint[]): Map<string, THREE.Vector3> {
  const parties = [...new Set(members.map((m) => m.party))];
  const centers = new Map<string, THREE.Vector3>();
  const radius = 6;
  parties.forEach((party, i) => {
    const angle = (i / parties.length) * Math.PI * 2;
    centers.set(party, new THREE.Vector3(
      Math.cos(angle) * radius,
      (Math.random() - 0.5) * 2,
      Math.sin(angle) * radius
    ));
  });
  return centers;
}

type HoveredMember = {
  member: DistributionMemberPoint;
  screenX: number;
  screenY: number;
};

export function ExplorePage({ members, assemblyLabel, onSelectMember }: ExplorePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    composer: EffectComposer;
    particles: Particle[];
    points: THREE.Points;
    linesMesh: THREE.LineSegments;
    ringMeshes: THREE.Mesh[];
    clock: THREE.Clock;
    frame: number;
    isDragging: boolean;
    prevMouse: { x: number; y: number };
    cameraAngle: { theta: number; phi: number; radius: number };
    targetAngle: { theta: number; phi: number; radius: number };
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
    selectedIndex: number | null;
  } | null>(null);

  const [hovered, setHovered] = useState<HoveredMember | null>(null);
  const [selected, setSelected] = useState<DistributionMemberPoint | null>(null);

  const initScene = useCallback(() => {
    const container = containerRef.current;
    if (!container || members.length === 0) return;

    // Clean up previous
    if (stateRef.current) {
      cancelAnimationFrame(stateRef.current.frame);
      stateRef.current.renderer.dispose();
      stateRef.current.composer.dispose();
      const oldCanvas = stateRef.current.renderer.domElement;
      if (container.contains(oldCanvas)) container.removeChild(oldCanvas);
      stateRef.current = null;
    }

    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#06060c");

    // Camera
    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 200);
    const initAngle = { theta: 0.4, phi: 1.2, radius: 18 };

    // Post-processing
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 1.8, 0.6, 0.15);
    composer.addPass(bloom);

    // Background stars
    const starCount = 2000;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 120;
      starPos[i * 3 + 1] = (Math.random() - 0.5) * 120;
      starPos[i * 3 + 2] = (Math.random() - 0.5) * 120;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x334155, size: 0.08, sizeAttenuation: true });
    scene.add(new THREE.Points(starGeo, starMat));

    // Party cluster centers
    const clusterCenters = buildPartyClusterCenters(members);

    // Build particles
    const particles: Particle[] = members.map((m) => {
      const center = clusterCenters.get(m.party) ?? new THREE.Vector3();
      const risk = computeRisk(m);
      const spread = 2.5 + risk * 1.5;
      const target = new THREE.Vector3(
        center.x + (Math.random() - 0.5) * spread,
        center.y + (Math.random() - 0.5) * spread + risk * 2,
        center.z + (Math.random() - 0.5) * spread
      );
      return {
        member: m,
        position: new THREE.Vector3(
          (Math.random() - 0.5) * 30,
          (Math.random() - 0.5) * 30,
          (Math.random() - 0.5) * 30
        ),
        velocity: new THREE.Vector3(),
        targetPosition: target,
        baseSize: 0.12 + risk * 0.35,
        phase: Math.random() * Math.PI * 2,
        risk
      };
    });

    // Points geometry
    const count = particles.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const color = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const p = particles[i]!;
      positions[i * 3] = p.position.x;
      positions[i * 3 + 1] = p.position.y;
      positions[i * 3 + 2] = p.position.z;
      color.set(PARTY_COLORS[p.member.party] ?? FALLBACK_COLOR);
      const brightness = 0.6 + p.risk * 0.4;
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;
      sizes[i] = p.baseSize;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

    const pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: dpr }
      },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        varying float vSize;
        uniform float uTime;
        uniform float uPixelRatio;
        void main() {
          vColor = color;
          vSize = size;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uPixelRatio * (280.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vSize;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.0, d);
          float glow = exp(-d * 3.5) * 0.6;
          float halo = exp(-d * 1.2) * 0.15;
          vec3 c = vColor * (core * 1.8 + glow + halo);
          float alpha = core * 0.95 + glow * 0.7 + halo * 0.3;
          gl_FragColor = vec4(c, alpha);
        }
      `,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geo, pointsMat);
    scene.add(points);

    // Connection lines (similar voting pattern)
    const linePositions: number[] = [];
    const lineColors: number[] = [];
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = particles[i]!;
        const b = particles[j]!;
        const dist = Math.abs(a.member.attendanceRate - b.member.attendanceRate) +
          Math.abs(a.member.negativeRate - b.member.negativeRate);
        if (dist < 0.05 && a.member.party === b.member.party) {
          linePositions.push(
            a.targetPosition.x, a.targetPosition.y, a.targetPosition.z,
            b.targetPosition.x, b.targetPosition.y, b.targetPosition.z
          );
          color.set(PARTY_COLORS[a.member.party] ?? FALLBACK_COLOR);
          lineColors.push(color.r * 0.15, color.g * 0.15, color.b * 0.15);
          lineColors.push(color.r * 0.15, color.g * 0.15, color.b * 0.15);
        }
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
    lineGeo.setAttribute("color", new THREE.Float32BufferAttribute(lineColors, 3));
    const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending });
    const linesMesh = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(linesMesh);

    // Party orbit rings
    const ringMeshes: THREE.Mesh[] = [];
    for (const [party, center] of clusterCenters) {
      const ringGeo = new THREE.TorusGeometry(3.2, 0.008, 8, 96);
      color.set(PARTY_COLORS[party] ?? FALLBACK_COLOR);
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(center);
      ring.rotation.x = Math.PI * 0.5 + (Math.random() - 0.5) * 0.3;
      ring.rotation.z = (Math.random() - 0.5) * 0.4;
      scene.add(ring);
      ringMeshes.push(ring);
    }

    const clock = new THREE.Clock();

    const state = {
      renderer,
      scene,
      camera,
      composer,
      particles,
      points,
      linesMesh,
      ringMeshes,
      clock,
      frame: 0,
      isDragging: false,
      prevMouse: { x: 0, y: 0 },
      cameraAngle: { ...initAngle },
      targetAngle: { ...initAngle },
      raycaster: new THREE.Raycaster(),
      mouse: new THREE.Vector2(-999, -999),
      selectedIndex: null as number | null
    };
    stateRef.current = state;

    // Animation loop
    const animate = () => {
      state.frame = requestAnimationFrame(animate);
      const t = state.clock.getElapsedTime();
      const dt = Math.min(state.clock.getDelta(), 0.05);

      // Camera smooth orbit
      const ca = state.cameraAngle;
      const ta = state.targetAngle;
      ca.theta += (ta.theta - ca.theta) * 0.06;
      ca.phi += (ta.phi - ca.phi) * 0.06;
      ca.radius += (ta.radius - ca.radius) * 0.06;
      if (!state.isDragging) ta.theta += 0.0015;

      camera.position.x = ca.radius * Math.sin(ca.phi) * Math.cos(ca.theta);
      camera.position.y = ca.radius * Math.cos(ca.phi);
      camera.position.z = ca.radius * Math.sin(ca.phi) * Math.sin(ca.theta);
      camera.lookAt(0, 0, 0);

      // Physics: spring toward target + damping
      const posAttr = points.geometry.attributes.position as THREE.BufferAttribute;
      const sizeAttr = points.geometry.attributes.size as THREE.BufferAttribute;

      for (let i = 0; i < count; i++) {
        const p = particles[i]!;
        const dx = p.targetPosition.x - p.position.x;
        const dy = p.targetPosition.y - p.position.y;
        const dz = p.targetPosition.z - p.position.z;
        const spring = 1.8;
        const damping = 0.92;

        p.velocity.x = (p.velocity.x + dx * spring * dt) * damping;
        p.velocity.y = (p.velocity.y + dy * spring * dt) * damping;
        p.velocity.z = (p.velocity.z + dz * spring * dt) * damping;
        p.position.x += p.velocity.x * dt * 2;
        p.position.y += p.velocity.y * dt * 2;
        p.position.z += p.velocity.z * dt * 2;

        posAttr.array[i * 3] = p.position.x;
        posAttr.array[i * 3 + 1] = p.position.y;
        posAttr.array[i * 3 + 2] = p.position.z;

        // Pulsating size for high-risk members
        const pulse = p.risk > 0.3
          ? Math.sin(t * (2 + p.risk * 3) + p.phase) * 0.08 * p.risk
          : 0;
        const isSelected = state.selectedIndex === i;
        sizeAttr.array[i] = p.baseSize + pulse + (isSelected ? 0.15 : 0);
      }
      posAttr.needsUpdate = true;
      sizeAttr.needsUpdate = true;

      // Rotate rings slowly
      for (const ring of ringMeshes) {
        ring.rotation.z += 0.002;
      }

      (pointsMat.uniforms.uTime as { value: number }).value = t;
      state.composer.render();
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      composer.setSize(nw, nh);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(state.frame);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      composer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [members]);

  useEffect(() => {
    const cleanup = initScene();
    return cleanup;
  }, [initScene]);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    const s = stateRef.current;
    const container = containerRef.current;
    if (!s || !container) return;

    const rect = container.getBoundingClientRect();

    if (s.isDragging) {
      const dx = event.clientX - s.prevMouse.x;
      const dy = event.clientY - s.prevMouse.y;
      s.targetAngle.theta -= dx * 0.005;
      s.targetAngle.phi = Math.max(0.3, Math.min(Math.PI - 0.3, s.targetAngle.phi + dy * 0.005));
      s.prevMouse = { x: event.clientX, y: event.clientY };
      setHovered(null);
      return;
    }

    s.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    s.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    s.raycaster.setFromCamera(s.mouse, s.camera);
    s.raycaster.params.Points = { threshold: 0.4 };
    const intersects = s.raycaster.intersectObject(s.points);

    if (intersects.length > 0 && intersects[0]!.index !== undefined) {
      const p = s.particles[intersects[0]!.index];
      if (p) {
        setHovered({
          member: p.member,
          screenX: event.clientX - rect.left,
          screenY: event.clientY - rect.top
        });
        container.style.cursor = "pointer";
        return;
      }
    }
    setHovered(null);
    container.style.cursor = "grab";
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (stateRef.current) {
      stateRef.current.isDragging = true;
      stateRef.current.prevMouse = { x: event.clientX, y: event.clientY };
    }
    if (containerRef.current) containerRef.current.style.cursor = "grabbing";
  }, []);

  const handlePointerUp = useCallback(() => {
    if (stateRef.current) stateRef.current.isDragging = false;
    if (containerRef.current) containerRef.current.style.cursor = "grab";
  }, []);

  const handleClick = useCallback(() => {
    if (hovered && stateRef.current) {
      setSelected(hovered.member);
      const idx = stateRef.current.particles.findIndex((p) => p.member.memberId === hovered.member.memberId);
      stateRef.current.selectedIndex = idx >= 0 ? idx : null;
    }
  }, [hovered]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (stateRef.current) {
      stateRef.current.targetAngle.radius = Math.max(6, Math.min(35, stateRef.current.targetAngle.radius + event.deltaY * 0.012));
    }
  }, []);

  const handleClose = useCallback(() => {
    setSelected(null);
    if (stateRef.current) stateRef.current.selectedIndex = null;
  }, []);

  return (
    <div className="explore-page">
      <div className="explore-page__hud">
        <div className="explore-page__title">
          <h1>의원 활동 3D 시각화</h1>
          <p>{assemblyLabel} · {members.length}명</p>
        </div>
        <div className="explore-page__axes">
          <span>정당별 클러스터 · 위험도 = 크기 + 맥동</span>
        </div>
      </div>

      <div className="explore-page__legend">
        {Object.entries(PARTY_COLORS_HEX).map(([party, hex]) => (
          <span key={party} className="explore-page__legend-item">
            <i style={{ background: hex }} />
            {party}
          </span>
        ))}
      </div>

      {hovered ? (
        <div
          className="explore-page__tooltip"
          style={{ left: hovered.screenX + 16, top: hovered.screenY - 8 }}
        >
          <strong>{hovered.member.name}</strong>
          <span>{hovered.member.party}{hovered.member.district ? ` · ${hovered.member.district}` : ""}</span>
          <span>출석률 {formatPercent(hovered.member.attendanceRate)} · 불참 {formatPercent(hovered.member.absentRate)}</span>
          {hovered.member.currentNegativeOrAbsentStreak >= 3 ? (
            <span className="explore-page__tooltip-alert">연속 패턴 {hovered.member.currentNegativeOrAbsentStreak}일</span>
          ) : null}
        </div>
      ) : null}

      {selected ? (
        <div className="explore-page__detail">
          <button type="button" className="explore-page__detail-close" onClick={handleClose}>×</button>
          <strong>{selected.name}</strong>
          <span className="explore-page__detail-party">{selected.party}</span>
          {selected.district ? <span className="explore-page__detail-district">{selected.district}</span> : null}
          <div className="explore-page__detail-grid">
            <div><span>출석률</span><strong>{formatPercent(selected.attendanceRate)}</strong></div>
            <div><span>불참</span><strong>{formatPercent(selected.absentRate)}</strong></div>
            <div><span>반대·기권</span><strong>{formatPercent(selected.negativeRate)}</strong></div>
            <div><span>연속 패턴</span><strong>{selected.currentNegativeOrAbsentStreak}일</strong></div>
          </div>
          <div className="explore-page__detail-bar">
            <div style={{ width: `${selected.yesRate * 100}%`, background: "#34d399" }} />
            <div style={{ width: `${selected.noRate * 100}%`, background: "#ef4444" }} />
            <div style={{ width: `${selected.abstainRate * 100}%`, background: "#fb923c" }} />
            <div style={{ width: `${selected.absentRate * 100}%`, background: "#94a3b8" }} />
          </div>
          <button type="button" className="explore-page__detail-action" onClick={() => onSelectMember(selected.memberId)}>
            활동 캘린더 열기
          </button>
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="explore-page__canvas"
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onClick={handleClick}
        onWheel={handleWheel}
      />

      <p className="explore-page__hint">
        드래그로 회전 · 스크롤로 확대/축소 · 클릭으로 의원 선택
      </p>
    </div>
  );
}
