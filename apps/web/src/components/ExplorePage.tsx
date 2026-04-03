import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

import type { DistributionMemberPoint } from "../lib/distribution.js";
import { formatPercent } from "../lib/format.js";

type ExplorePageProps = {
  members: DistributionMemberPoint[];
  assemblyLabel: string;
  onSelectMember: (memberId: string) => void;
};

const PARTY_COLORS: Record<string, string> = {
  "더불어민주당": "#1a56db",
  "국민의힘": "#dc2626",
  "조국혁신당": "#2563eb",
  "개혁신당": "#f97316",
  "진보당": "#e11d48",
  "사회민주당": "#7c3aed",
  "기본소득당": "#059669",
  "무소속": "#71717a"
};

const FALLBACK_COLOR = "#71717a";

function getPartyColor(party: string): string {
  return PARTY_COLORS[party] ?? FALLBACK_COLOR;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

type HoveredMember = {
  member: DistributionMemberPoint;
  screenX: number;
  screenY: number;
};

export function ExplorePage({ members, assemblyLabel, onSelectMember }: ExplorePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const particlesRef = useRef<THREE.Points | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2(-999, -999));
  const frameRef = useRef(0);
  const memberIndexMapRef = useRef<DistributionMemberPoint[]>([]);
  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef({ x: 0, y: 0 });
  const cameraAngleRef = useRef({ theta: Math.PI * 0.25, phi: Math.PI * 0.35, radius: 14 });
  const targetAngleRef = useRef({ theta: Math.PI * 0.25, phi: Math.PI * 0.35, radius: 14 });

  const [hovered, setHovered] = useState<HoveredMember | null>(null);
  const [selected, setSelected] = useState<DistributionMemberPoint | null>(null);
  const [metric, setMetric] = useState<"attendance" | "disruption" | "streak">("attendance");

  const buildParticles = useCallback(
    (scene: THREE.Scene) => {
      if (particlesRef.current) {
        scene.remove(particlesRef.current);
        particlesRef.current.geometry.dispose();
        (particlesRef.current.material as THREE.PointsMaterial).dispose();
      }

      const count = members.length;
      if (count === 0) return;

      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      const color = new THREE.Color();

      memberIndexMapRef.current = [];

      for (let i = 0; i < count; i++) {
        const m = members[i]!;
        memberIndexMapRef.current.push(m);

        let x: number, y: number, z: number;
        if (metric === "attendance") {
          x = (m.attendanceRate - 0.5) * 10;
          y = (m.negativeRate) * 10 - 2;
          z = (m.absentRate) * 10 - 2;
        } else if (metric === "disruption") {
          x = (m.disruptionRate) * 10 - 3;
          y = (m.currentNegativeOrAbsentStreak / 40) * 10 - 2;
          z = (m.absentRate) * 10 - 2;
        } else {
          x = (m.currentNegativeOrAbsentStreak / 40) * 10 - 3;
          y = (m.longestNegativeOrAbsentStreak / 40) * 10 - 2;
          z = (m.negativeRate) * 10 - 2;
        }

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        color.set(getPartyColor(m.party));
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;

        const baseSize = 0.18;
        const absentBonus = m.absentRate * 0.4;
        const streakBonus = Math.min(m.currentNegativeOrAbsentStreak / 20, 0.3);
        sizes[i] = baseSize + absentBonus + streakBonus;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
        },
        vertexShader: `
          attribute float size;
          varying vec3 vColor;
          uniform float uPixelRatio;
          void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * uPixelRatio * (180.0 / -mvPosition.z);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          void main() {
            float d = length(gl_PointCoord - vec2(0.5));
            if (d > 0.5) discard;
            float alpha = 1.0 - smoothstep(0.35, 0.5, d);
            float glow = exp(-d * 4.0) * 0.3;
            gl_FragColor = vec4(vColor + glow, alpha * 0.92);
          }
        `,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });

      const points = new THREE.Points(geometry, material);
      scene.add(points);
      particlesRef.current = points;
    },
    [members, metric]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0a0a0f");
    scene.fog = new THREE.FogExp2("#0a0a0f", 0.035);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Grid helper
    const gridSize = 12;
    const gridGeo = new THREE.BufferGeometry();
    const gridPositions: number[] = [];
    for (let i = -gridSize; i <= gridSize; i += 2) {
      gridPositions.push(-gridSize, -3, i, gridSize, -3, i);
      gridPositions.push(i, -3, -gridSize, i, -3, gridSize);
    }
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPositions, 3));
    const gridMat = new THREE.LineBasicMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.4 });
    scene.add(new THREE.LineSegments(gridGeo, gridMat));

    // Axis lines
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute("position", new THREE.Float32BufferAttribute([
      -6, -3, -6, 6, -3, -6,  // X
      -6, -3, -6, -6, 6, -6,  // Y
      -6, -3, -6, -6, -3, 6   // Z
    ], 3));
    const axisMat = new THREE.LineBasicMaterial({ color: 0x3730a3, transparent: true, opacity: 0.5 });
    scene.add(new THREE.LineSegments(axisGeo, axisMat));

    buildParticles(scene);

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);

      const angle = cameraAngleRef.current;
      const target = targetAngleRef.current;
      angle.theta = lerp(angle.theta, target.theta, 0.08);
      angle.phi = lerp(angle.phi, target.phi, 0.08);
      angle.radius = lerp(angle.radius, target.radius, 0.08);

      if (!isDraggingRef.current) {
        target.theta += 0.001;
      }

      camera.position.x = angle.radius * Math.sin(angle.phi) * Math.cos(angle.theta);
      camera.position.y = angle.radius * Math.cos(angle.phi);
      camera.position.z = angle.radius * Math.sin(angle.phi) * Math.sin(angle.theta);
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(frameRef.current);
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    buildParticles(scene);
  }, [buildParticles]);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      const particles = particlesRef.current;
      if (!container || !camera || !particles) return;

      const rect = container.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      if (isDraggingRef.current) {
        const dx = event.clientX - prevMouseRef.current.x;
        const dy = event.clientY - prevMouseRef.current.y;
        targetAngleRef.current.theta -= dx * 0.005;
        targetAngleRef.current.phi = Math.max(0.2, Math.min(Math.PI - 0.2, targetAngleRef.current.phi + dy * 0.005));
        prevMouseRef.current = { x: event.clientX, y: event.clientY };
        setHovered(null);
        return;
      }

      raycasterRef.current.setFromCamera(mouseRef.current, camera);
      raycasterRef.current.params.Points = { threshold: 0.35 };
      const intersects = raycasterRef.current.intersectObject(particles);

      if (intersects.length > 0 && intersects[0]!.index !== undefined) {
        const member = memberIndexMapRef.current[intersects[0]!.index];
        if (member) {
          setHovered({ member, screenX: event.clientX - rect.left, screenY: event.clientY - rect.top });
          container.style.cursor = "pointer";
          return;
        }
      }

      setHovered(null);
      container.style.cursor = isDraggingRef.current ? "grabbing" : "grab";
    },
    []
  );

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    isDraggingRef.current = true;
    prevMouseRef.current = { x: event.clientX, y: event.clientY };
    if (containerRef.current) containerRef.current.style.cursor = "grabbing";
  }, []);

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
    if (containerRef.current) containerRef.current.style.cursor = "grab";
  }, []);

  const handleClick = useCallback(() => {
    if (hovered) {
      setSelected(hovered.member);
    }
  }, [hovered]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    targetAngleRef.current.radius = Math.max(5, Math.min(30, targetAngleRef.current.radius + event.deltaY * 0.01));
  }, []);

  const metricLabels = {
    attendance: { x: "출석률", y: "반대·기권 비중", z: "불참 비중" },
    disruption: { x: "이탈률", y: "연속 패턴", z: "불참 비중" },
    streak: { x: "현재 연속", y: "최장 연속", z: "반대·기권 비중" }
  };
  const currentLabels = metricLabels[metric];

  return (
    <div className="explore-page">
      <div className="explore-page__hud">
        <div className="explore-page__title">
          <h1>의원 활동 3D 시각화</h1>
          <p>{members.length}명 시각화</p>
        </div>
        <div className="explore-page__controls">
          <button
            type="button"
            className={metric === "attendance" ? "explore-page__tab is-active" : "explore-page__tab"}
            onClick={() => setMetric("attendance")}
          >
            출석 기반
          </button>
          <button
            type="button"
            className={metric === "disruption" ? "explore-page__tab is-active" : "explore-page__tab"}
            onClick={() => setMetric("disruption")}
          >
            이탈 기반
          </button>
          <button
            type="button"
            className={metric === "streak" ? "explore-page__tab is-active" : "explore-page__tab"}
            onClick={() => setMetric("streak")}
          >
            연속 패턴
          </button>
        </div>
        <div className="explore-page__axes">
          <span>X: {currentLabels.x}</span>
          <span>Y: {currentLabels.y}</span>
          <span>Z: {currentLabels.z}</span>
        </div>
      </div>

      <div className="explore-page__legend">
        {Object.entries(PARTY_COLORS).map(([party, hex]) => (
          <span key={party} className="explore-page__legend-item">
            <i style={{ background: hex }} />
            {party}
          </span>
        ))}
      </div>

      {hovered && !isDraggingRef.current ? (
        <div
          className="explore-page__tooltip"
          style={{ left: hovered.screenX + 16, top: hovered.screenY - 8 }}
        >
          <strong>{hovered.member.name}</strong>
          <span>{hovered.member.party}</span>
          <span>출석률 {formatPercent(hovered.member.attendanceRate)}</span>
          <span>불참 {formatPercent(hovered.member.absentRate)}</span>
        </div>
      ) : null}

      {selected ? (
        <div className="explore-page__detail">
          <button
            type="button"
            className="explore-page__detail-close"
            onClick={() => setSelected(null)}
          >
            ×
          </button>
          <strong>{selected.name}</strong>
          <span className="explore-page__detail-party">{selected.party}</span>
          {selected.district ? <span>{selected.district}</span> : null}
          <div className="explore-page__detail-grid">
            <div>
              <span>출석률</span>
              <strong>{formatPercent(selected.attendanceRate)}</strong>
            </div>
            <div>
              <span>불참</span>
              <strong>{formatPercent(selected.absentRate)}</strong>
            </div>
            <div>
              <span>반대·기권</span>
              <strong>{formatPercent(selected.negativeRate)}</strong>
            </div>
            <div>
              <span>연속 패턴</span>
              <strong>{selected.currentNegativeOrAbsentStreak}일</strong>
            </div>
          </div>
          <button
            type="button"
            className="explore-page__detail-action"
            onClick={() => onSelectMember(selected.memberId)}
          >
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
