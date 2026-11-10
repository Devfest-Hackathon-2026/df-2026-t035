import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AudienceMember, AvatarHairStyle } from '../types/presentation';
import { isAvatarSpeakingNow } from '../utils/speech';

export interface SneezeEventTrigger {
  avatarId?: string;
  bgIndex?: number;
  row: number;
  timestamp: number;
}

export type AudienceMood =
  | 'important'
  | 'normal'
  | 'slightly_bored'
  | 'very_bored';

interface Audience3DStageProps {
  audience: AudienceMember[];
  totalAudienceCount?: number;
  audienceMood?: AudienceMood;
  raisedHandRatio?: number;
  handRaiseTopicKey?: string;
  isNegativeHandRaise?: boolean;
  sleepingRatio?: number;
  sneezeTrigger?: SneezeEventTrigger | null;
  focusAvatarId?: string | null;
  onAvatarClick?: (avatarId: string) => void;
  className?: string;
}

interface ProjectedLabel {
  id: string;
  name: string;
  roleLabel: string;
  role: string;
  x: number;
  y: number;
  row: number;
  visible: boolean;
}

type AmbientBehaviorType =
  | 'listening'
  | 'take_notes'
  | 'cross_arms'
  | 'touch_hair'
  | 'chat_neighbor';

const BG_CLOTHING_PALETTE = [
  '#1e3a8a',
  '#334155',
  '#065f46',
  '#7c2d12',
  '#4c1d95',
  '#1f2937',
  '#0f766e',
  '#831843',
  '#374151',
  '#1e40af',
];

const BG_HAIR_PALETTE = [
  '#111827',
  '#1f2937',
  '#3f2314',
  '#451a03',
  '#27272a',
];

function createShuffledIndices(length: number): number[] {
  const arr = Array.from({ length }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const Audience3DStage: React.FC<Audience3DStageProps> = ({
  audience,
  totalAudienceCount,
  audienceMood = 'normal',
  raisedHandRatio = 0,
  handRaiseTopicKey = '',
  isNegativeHandRaise = false,
  sleepingRatio = 0,
  sneezeTrigger = null,
  focusAvatarId = null,
  onAvatarClick,
  className = '',
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const audienceRef = useRef<AudienceMember[]>(audience);
  audienceRef.current = audience;

  const audienceMoodRef = useRef<AudienceMood>(audienceMood);
  audienceMoodRef.current = audienceMood;

  const raisedHandRatioRef = useRef<number>(raisedHandRatio);
  raisedHandRatioRef.current = raisedHandRatio;

  const handRaiseTopicKeyRef = useRef<string>(handRaiseTopicKey);
  handRaiseTopicKeyRef.current = handRaiseTopicKey;

  const isNegativeHandRaiseRef = useRef<boolean>(isNegativeHandRaise);
  isNegativeHandRaiseRef.current = isNegativeHandRaise;

  const sleepingRatioRef = useRef<number>(sleepingRatio);
  sleepingRatioRef.current = sleepingRatio;

  const sneezeTriggerRef = useRef<SneezeEventTrigger | null>(sneezeTrigger);
  sneezeTriggerRef.current = sneezeTrigger;

  const focusRef = useRef<string | null>(focusAvatarId);
  focusRef.current = focusAvatarId;

  const onAvatarClickRef = useRef(onAvatarClick);
  onAvatarClickRef.current = onAvatarClick;

  const [projectedLabels, setProjectedLabels] = useState<ProjectedLabel[]>([]);

  const effectiveTotalCount = Math.max(
    audience.length,
    totalAudienceCount || audience.length
  );

  // Signature string for gender/hairStyle changes so 3D avatars rebuild when customized in Setup
  const appearanceSignature = audience
    .map((a) => `${a.id}:${a.gender}:${a.role}:${a.hairStyle || ''}`)
    .join('|');

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let animationFrameId: number;
    const clock = new THREE.Clock();

    // 1. Detect Software WebGL
    const isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Renderer & Scene Setup
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      alpha: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.Fog(0x0f172a, 22, 62);

    // Studio Environment map
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmremGenerator.dispose();

    // Camera
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 90);
    const defaultCamPos = new THREE.Vector3(0, 2.1, 5.2);
    const defaultCamTarget = new THREE.Vector3(0, 1.1, 0);

    // Lighting: Key, Fill, Rim
    const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.2);
    keyLight.position.set(4, 9, 6);
    keyLight.castShadow = !isSoftwareGl;
    if (keyLight.castShadow) {
      keyLight.shadow.mapSize.width = 1024;
      keyLight.shadow.mapSize.height = 1024;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    scene.add(keyLight);

    const fillLight = new THREE.HemisphereLight(0x90caf9, 0x1e293b, 1.35);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 1.5);
    rimLight.position.set(-6, 5, -5);
    scene.add(rimLight);

    // Floor
    const floorGeo = new THREE.PlaneGeometry(60, 60);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.75,
      metalness: 0.15,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = !isSoftwareGl;
    scene.add(floor);

    interface SeatSlot {
      row: number;
      colIndex: number;
      colsInRow: number;
      posX: number;
      posY: number;
      posZ: number;
      interactiveMember?: AudienceMember;
      bgIndex?: number;
    }

    const currentInteractive = audienceRef.current;
    const totalCount = effectiveTotalCount;

    // Build row distribution supporting 1 to 100 people in a tiered university lecture hall
    const rowCounts: number[] = [];
    if (totalCount <= 3) {
      rowCounts.push(totalCount);
    } else if (totalCount <= 6) {
      const frontCount = Math.ceil(totalCount / 2);
      const backCount = totalCount - frontCount;
      rowCounts.push(frontCount, backCount);
    } else if (totalCount <= 30) {
      const maxPerRow = 6;
      let rem = totalCount;
      while (rem > 0) {
        const take = Math.min(maxPerRow, rem);
        rowCounts.push(take);
        rem -= take;
      }
    } else {
      const firstRowCount = Math.min(6, totalCount);
      rowCounts.push(firstRowCount);
      let rem = totalCount - firstRowCount;
      const maxPerBackRow = totalCount <= 60 ? 10 : 12;
      while (rem > 0) {
        const take = Math.min(maxPerBackRow, rem);
        rowCounts.push(take);
        rem -= take;
      }
    }

    const numRows = rowCounts.length;
    const rowStepY = numRows >= 6 ? 0.38 : numRows >= 3 ? 0.36 : 0.32;
    const rowStepZ = numRows >= 6 ? 1.42 : numRows >= 3 ? 1.48 : 1.55;
    const frontRowZ = numRows >= 3 ? 0.65 : 0.25;

    const tableTopMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.35,
      metalness: 0.15,
    });
    const modestyBoardMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.8,
    });
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.2,
    });
    const tierPlatformMat = new THREE.MeshStandardMaterial({
      color: 0x172033,
      roughness: 0.8,
      metalness: 0.1,
    });
    const tierEdgeMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.4,
      metalness: 0.3,
    });
    const notebookCoverMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.5,
    });
    const notebookPenMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.3,
    });

    let maxRowSpanX = 3.2;

    const getRowSeatSpacing = (cols: number) => {
      if (cols <= 1) return 0;
      if (cols <= 3) return 1.38;
      if (cols <= 6) return Math.min(1.24, 6.2 / (cols - 1));
      return Math.min(1.04, 10.8 / (cols - 1));
    };

    for (let r = 0; r < numRows; r++) {
      const cols = rowCounts[r];
      const rowY = r * rowStepY;
      const rowZ = frontRowZ - r * rowStepZ;

      const seatSpacing = getRowSeatSpacing(cols);
      const rowSpan = (cols - 1) * seatSpacing;
      if (rowSpan > maxRowSpanX) {
        maxRowSpanX = rowSpan;
      }

      const deskWidth = Math.max(3.5, rowSpan + 1.5);

      if (r > 0) {
        const tierDepth = rowStepZ + 0.32;
        const tierGeo = new THREE.BoxGeometry(deskWidth + 1.2, rowY, tierDepth);
        const tierMesh = new THREE.Mesh(tierGeo, tierPlatformMat);
        tierMesh.position.set(0, rowY / 2, rowZ - 0.1);
        tierMesh.receiveShadow = !isSoftwareGl && r <= 2;
        scene.add(tierMesh);

        const edgeGeo = new THREE.BoxGeometry(deskWidth + 1.2, 0.025, 0.04);
        const edgeMesh = new THREE.Mesh(edgeGeo, tierEdgeMat);
        edgeMesh.position.set(0, rowY + 0.005, rowZ + tierDepth / 2 - 0.1);
        scene.add(edgeMesh);
      }

      const deskGroup = new THREE.Group();
      deskGroup.position.set(0, rowY, rowZ);

      const topGeo = new THREE.BoxGeometry(deskWidth, 0.1, 0.92);
      const topMesh = new THREE.Mesh(topGeo, tableTopMat);
      topMesh.position.set(0, 0.92, 0.45);
      topMesh.castShadow = !isSoftwareGl && r <= 1;
      topMesh.receiveShadow = !isSoftwareGl && r <= 2;
      deskGroup.add(topMesh);

      const modestyGeo = new THREE.BoxGeometry(deskWidth - 0.15, 0.65, 0.04);
      const modestyMesh = new THREE.Mesh(modestyGeo, modestyBoardMat);
      modestyMesh.position.set(0, 0.52, 0.88);
      deskGroup.add(modestyMesh);

      const legGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.92, 10);
      const halfDesk = deskWidth / 2 - 0.35;
      const legPositions =
        deskWidth > 8.5
          ? [-halfDesk, -halfDesk * 0.35, halfDesk * 0.35, halfDesk]
          : deskWidth > 5.5
          ? [-halfDesk, 0, halfDesk]
          : [-halfDesk, halfDesk];
      legPositions.forEach((lx) => {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(lx, 0.46, 0.45);
        deskGroup.add(leg);
      });

      scene.add(deskGroup);
    }

    const backWallZ = frontRowZ - numRows * rowStepZ - 1.8;
    const wallWidth = Math.max(36, maxRowSpanX + 18);
    const wallGeo = new THREE.PlaneGeometry(wallWidth, 18);
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.85,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(0, 6, backWallZ);
    scene.add(wall);

    const panelGeo = new THREE.BoxGeometry(Math.max(12, maxRowSpanX + 4), 5.0, 0.1);
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x27272a,
      roughness: 0.6,
      metalness: 0.1,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(0, 3.6 + (numRows - 1) * rowStepY * 0.65, backWallZ + 0.06);
    scene.add(panel);

    const seats: SeatSlot[] = [];
    let interactiveAssigned = 0;
    let bgAssigned = 0;

    for (let r = 0; r < numRows; r++) {
      const cols = rowCounts[r];
      const rowY = r * rowStepY;
      const rowZ = frontRowZ - r * rowStepZ;

      const seatSpacing = getRowSeatSpacing(cols);
      const staggerX =
        r > 0 && r % 2 === 1 && rowCounts[r - 1] === cols ? 0.24 : 0;
      const startX = -((cols - 1) * seatSpacing) / 2 + staggerX;

      for (let c = 0; c < cols; c++) {
        const posX = startX + c * seatSpacing;
        if (interactiveAssigned < currentInteractive.length) {
          seats.push({
            row: r,
            colIndex: c,
            colsInRow: cols,
            posX,
            posY: rowY,
            posZ: rowZ,
            interactiveMember: currentInteractive[interactiveAssigned],
          });
          interactiveAssigned++;
        } else {
          seats.push({
            row: r,
            colIndex: c,
            colsInRow: cols,
            posX,
            posY: rowY,
            posZ: rowZ,
            bgIndex: bgAssigned,
          });
          bgAssigned++;
        }
      }
    }

    const updateResponsiveDefaultCamera = (aspect: number) => {
      const vFovRad = THREE.MathUtils.degToRad(camera.fov);
      const hFovHalf = Math.atan(Math.tan(vFovRad / 2) * Math.max(0.55, aspect));

      const frontSpan =
        rowCounts[0] <= 1
          ? 2.2
          : (rowCounts[0] - 1) * getRowSeatSpacing(rowCounts[0]);
      const effectiveSpan = Math.min(maxRowSpanX, Math.max(frontSpan + 1.4, maxRowSpanX * 0.78));
      const desiredHalfWidth = effectiveSpan * 0.5 + 1.15;
      const minDistanceForWidth = desiredHalfWidth / Math.tan(hFovHalf);

      const baseDistance =
        numRows === 1
          ? 4.7
          : numRows === 2
          ? 5.35
          : numRows <= 5
          ? 5.8 + (numRows - 2) * 0.65
          : 7.4 + (numRows - 5) * 0.45;

      const camZ = Math.max(baseDistance, minDistanceForWidth + frontRowZ * 0.45);
      const camY =
        numRows === 1
          ? 1.95
          : numRows === 2
          ? 2.3
          : numRows <= 5
          ? 2.55 + (numRows - 2) * 0.3
          : 3.45 + (numRows - 5) * 0.24;

      const targetY =
        numRows === 1
          ? 1.05
          : numRows === 2
          ? 1.2
          : 1.3 + Math.min(numRows - 2, 6) * 0.16;
      const targetZ =
        numRows === 1 ? 0.1 : -Math.min(numRows - 1, 6) * rowStepZ * 0.32;

      defaultCamPos.set(0, camY, camZ);
      defaultCamTarget.set(0, targetY, targetZ);
    };

    updateResponsiveDefaultCamera(width / height);
    camera.position.copy(defaultCamPos);
    camera.lookAt(defaultCamTarget);
    const currentCamTarget = defaultCamTarget.clone();

    interface AvatarMeshes {
      id: string;
      isInteractive: boolean;
      row: number;
      colIndex: number;
      colsInRow: number;
      bgOrderIndex: number;
      group: THREE.Group;
      torsoMesh: THREE.Mesh;
      headGroup: THREE.Group;
      faceGroup: THREE.Group;
      leftBrow: THREE.Mesh;
      rightBrow: THREE.Mesh;
      leftEyelid: THREE.Mesh;
      rightEyelid: THREE.Mesh;
      mouthMesh: THREE.Mesh;
      rightArmGroup: THREE.Group;
      leftArmGroup: THREE.Group;
      rightForearm: THREE.Group;
      leftForearm: THREE.Group;
      baseX: number;
      baseY: number;
      baseZ: number;
      lastAction: string;
      actionStartTime: number;
      ambientBehavior: AmbientBehaviorType;
      ambientStartTime: number;
      ambientDuration: number;
      nextAmbientSwitchTime: number;
      neighborDir: number;
      personalPhase: number;
      sneezeUntilTime: number;
    }

    const avatarMeshMap: Map<string, AvatarMeshes> = new Map();
    const backgroundAvatars: AvatarMeshes[] = [];
    const allAvatarsByRow: Map<number, AvatarMeshes[]> = new Map();
    const clickableObjects: THREE.Object3D[] = [];

    // Shared High-Detail Geometries (Cached once for 60 FPS up to 100 avatars)
    const seatGeo = new THREE.BoxGeometry(0.66, 0.09, 0.6);
    const backGeo = new THREE.BoxGeometry(0.64, 0.76, 0.08);
    const stemGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.55, 8);

    // Body, Shoulders, Neck & Suit Details
    const torsoGeo = new THREE.CapsuleGeometry(0.225, 0.47, 8, 16);
    const shoulderCapGeo = new THREE.SphereGeometry(0.082, 10, 10);
    const neckGeo = new THREE.CylinderGeometry(0.064, 0.074, 0.14, 12);
    const shirtVZoneGeo = new THREE.ConeGeometry(0.11, 0.25, 3);
    const lapelGeo = new THREE.BoxGeometry(0.048, 0.26, 0.025);
    const tieGeo = new THREE.BoxGeometry(0.056, 0.31, 0.032);
    const tieKnotGeo = new THREE.BoxGeometry(0.068, 0.055, 0.038);

    // Sculpted Head & Realistic Facial Features
    const headGeo = new THREE.SphereGeometry(0.195, 28, 28);
    const jawGeo = new THREE.SphereGeometry(0.152, 20, 18);
    const cheekGeo = new THREE.SphereGeometry(0.048, 12, 12);
    const earGeo = new THREE.SphereGeometry(0.038, 12, 12);
    const noseBridgeGeo = new THREE.CapsuleGeometry(0.014, 0.042, 6, 8);
    const noseTipGeo = new THREE.SphereGeometry(0.019, 12, 12);
    const scleraGeo = new THREE.SphereGeometry(0.031, 14, 14);
    const irisGeo = new THREE.SphereGeometry(0.0185, 14, 14);
    const pupilGeo = new THREE.SphereGeometry(0.011, 12, 12);
    const catchlightGeo = new THREE.SphereGeometry(0.0045, 8, 8);
    const lashGeo = new THREE.TorusGeometry(0.029, 0.0032, 6, 16, Math.PI);
    const eyelidGeo = new THREE.SphereGeometry(
      0.034,
      12,
      10,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.55
    );
    const browGeo = new THREE.CapsuleGeometry(0.0065, 0.044, 4, 8);
    const mouthGeo = new THREE.CapsuleGeometry(0.011, 0.036, 6, 10);
    const collarGeo = new THREE.BoxGeometry(0.065, 0.042, 0.022);

    // Diverse 3D Hair Geometries (Tilted back so front hairline never covers eyebrows/eyes)
    const hairCrownGeo = new THREE.SphereGeometry(
      0.207,
      20,
      16,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.48
    );
    const hairTopQuiffGeo = new THREE.CapsuleGeometry(0.062, 0.13, 8, 12);
    const hairSideSweptBangsGeo = new THREE.CapsuleGeometry(0.028, 0.095, 6, 10);
    const hairSideburnGeo = new THREE.CapsuleGeometry(0.018, 0.085, 6, 8);
    const hairBobSideGeo = new THREE.CapsuleGeometry(0.046, 0.19, 8, 12);
    const hairLongSideGeo = new THREE.CapsuleGeometry(0.05, 0.31, 8, 12);
    const hairBackBobGeo = new THREE.CapsuleGeometry(0.145, 0.14, 8, 12);
    const hairBackLongGeo = new THREE.CapsuleGeometry(0.155, 0.28, 8, 12);

    // Arms, Shirt Cuffs, Sculpted Hands & Notebook
    const upperArmGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.3, 12);
    const forearmGeo = new THREE.CylinderGeometry(0.049, 0.04, 0.25, 12);
    const cuffGeo = new THREE.CylinderGeometry(0.044, 0.042, 0.035, 12);
    const handPalmGeo = new THREE.SphereGeometry(0.043, 12, 12);
    const thumbGeo = new THREE.CapsuleGeometry(0.013, 0.032, 4, 8);
    const notebookGeo = new THREE.BoxGeometry(0.28, 0.014, 0.21);
    const penGeo = new THREE.CylinderGeometry(0.007, 0.005, 0.14, 8);

    // Glasses for professors
    const rimGeo = new THREE.TorusGeometry(0.048, 0.0055, 8, 20);
    const bridgeGeo = new THREE.CylinderGeometry(0.0045, 0.0045, 0.05);

    // Shared PBR Materials
    const seatMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.6,
    });
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xffe1c9,
      roughness: 0.48,
      metalness: 0.02,
    });
    const cheekMat = new THREE.MeshStandardMaterial({
      color: 0xf7bfa8,
      roughness: 0.52,
      metalness: 0.01,
    });
    const eyelidMat = new THREE.MeshStandardMaterial({
      color: 0xf4cfb4,
      roughness: 0.52,
    });
    const scleraMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.18,
    });
    const irisMat = new THREE.MeshStandardMaterial({
      color: 0x3d2314,
      roughness: 0.22,
    });
    const pupilMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.1,
    });
    const catchlightMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
    });
    const lashMat = new THREE.MeshStandardMaterial({
      color: 0x1e1b18,
      roughness: 0.4,
    });
    const mouthMat = new THREE.MeshStandardMaterial({
      color: 0xc45b56,
      roughness: 0.42,
    });
    const whiteShirtMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.42,
    });
    const tieMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      roughness: 0.38,
    });
    const peerTieMat = new THREE.MeshStandardMaterial({
      color: 0x0369a1,
      roughness: 0.4,
    });
    const silverHairMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      roughness: 0.68,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.78,
      roughness: 0.22,
    });

    const clothingMatCache = new Map<string, THREE.MeshStandardMaterial>();
    const hairMatCache = new Map<string, THREE.MeshStandardMaterial>();

    const getClothingMaterial = (hex: string) => {
      let mat = clothingMatCache.get(hex);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(hex),
          roughness: 0.52,
          metalness: 0.06,
        });
        clothingMatCache.set(hex, mat);
      }
      return mat;
    };

    const getHairMaterial = (hex: string) => {
      let mat = hairMatCache.get(hex);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(hex),
          roughness: 0.78,
          metalness: 0.05,
        });
        hairMatCache.set(hex, mat);
      }
      return mat;
    };

    const AMBIENT_POOL: AmbientBehaviorType[] = [
      'listening',
      'listening',
      'listening',
      'take_notes',
      'listening',
      'listening',
    ];

    seats.forEach((slot, seatIdx) => {
      const isInteractive = Boolean(slot.interactiveMember);
      const member = slot.interactiveMember;
      const bgIdx = slot.bgIndex ?? 0;

      const avatarId = member ? member.id : `bg-avatar-${bgIdx}`;
      const gender: 'male' | 'female' = member
        ? member.gender
        : bgIdx % 2 === 0
        ? 'male'
        : 'female';
      const role = member ? member.role : 'peer';
      const hairStyle: AvatarHairStyle =
        member?.hairStyle ||
        (gender === 'female'
          ? seatIdx % 2 === 0
            ? 'bob'
            : 'long'
          : role === 'professor'
          ? 'parted'
          : 'short');

      const clothingHex = member
        ? member.clothingColor
        : BG_CLOTHING_PALETTE[bgIdx % BG_CLOTHING_PALETTE.length];
      const hairHex = member
        ? member.hairColor
        : BG_HAIR_PALETTE[bgIdx % BG_HAIR_PALETTE.length];

      const avatarGroup = new THREE.Group();
      avatarGroup.position.set(slot.posX, slot.posY, slot.posZ);
      avatarGroup.userData = { avatarId };

      // Chair
      const chairGroup = new THREE.Group();
      const seat = new THREE.Mesh(seatGeo, seatMat);
      seat.position.set(0, 0.56, -0.15);
      chairGroup.add(seat);

      const back = new THREE.Mesh(backGeo, seatMat);
      back.position.set(0, 0.96, -0.43);
      chairGroup.add(back);

      const stem = new THREE.Mesh(stemGeo, legMat);
      stem.position.set(0, 0.275, -0.15);
      chairGroup.add(stem);
      avatarGroup.add(chairGroup);

      // Desk Notebook on table
      const notebook = new THREE.Mesh(notebookGeo, notebookCoverMat);
      notebook.position.set(0.06, 0.978, 0.34);
      notebook.rotation.y = (seatIdx % 3 - 1) * 0.08;
      avatarGroup.add(notebook);

      const torsoMat = getClothingMaterial(clothingHex);
      const hairMat = getHairMaterial(hairHex);

      // Torso Group (allows upper-body lean while keeping hips anchored)
      const torso = new THREE.Mesh(torsoGeo, torsoMat);
      torso.position.set(0, 0.93, -0.1);
      torso.scale.set(gender === 'female' ? 0.94 : 1.04, 1.0, 0.92);
      torso.castShadow = !isSoftwareGl && isInteractive;
      avatarGroup.add(torso);

      // Tailored Suit Details attached to torso: Shoulder caps, White Shirt V-Zone, Jacket Lapels, Tie
      const leftShoulderCap = new THREE.Mesh(shoulderCapGeo, torsoMat);
      leftShoulderCap.position.set(-0.23, 0.19, 0.02);
      const rightShoulderCap = new THREE.Mesh(shoulderCapGeo, torsoMat);
      rightShoulderCap.position.set(0.23, 0.19, 0.02);
      torso.add(leftShoulderCap, rightShoulderCap);

      const shirtVZone = new THREE.Mesh(shirtVZoneGeo, whiteShirtMat);
      shirtVZone.position.set(0, 0.17, 0.195);
      shirtVZone.rotation.x = Math.PI;
      shirtVZone.scale.set(1.0, 1.0, 0.35);
      torso.add(shirtVZone);

      const leftLapel = new THREE.Mesh(lapelGeo, torsoMat);
      leftLapel.position.set(-0.068, 0.12, 0.215);
      leftLapel.rotation.z = -0.24;
      const rightLapel = new THREE.Mesh(lapelGeo, torsoMat);
      rightLapel.position.set(0.068, 0.12, 0.215);
      rightLapel.rotation.z = 0.24;
      torso.add(leftLapel, rightLapel);

      if (role === 'professor' || (gender === 'male' && role === 'peer')) {
        const chosenTieMat = role === 'professor' ? tieMat : peerTieMat;
        const tieKnot = new THREE.Mesh(tieKnotGeo, chosenTieMat);
        tieKnot.position.set(0, 0.22, 0.225);
        const tie = new THREE.Mesh(tieGeo, chosenTieMat);
        tie.position.set(0, 0.07, 0.225);
        torso.add(tieKnot, tie);
      }

      // Sculpted Neck & Crisp White Shirt Collar
      const neckMesh = new THREE.Mesh(neckGeo, skinMat);
      neckMesh.position.set(0, 0.33, 0.03);
      const leftCollar = new THREE.Mesh(collarGeo, whiteShirtMat);
      leftCollar.position.set(-0.046, 0.265, 0.165);
      leftCollar.rotation.set(0.25, 0.35, -0.28);
      const rightCollar = new THREE.Mesh(collarGeo, whiteShirtMat);
      rightCollar.position.set(0.046, 0.265, 0.165);
      rightCollar.rotation.set(0.25, -0.35, 0.28);
      torso.add(neckMesh, leftCollar, rightCollar);

      // High-Detail Head Group
      const headGroup = new THREE.Group();
      headGroup.position.set(0, 1.44, -0.05);

      const headMesh = new THREE.Mesh(headGeo, skinMat);
      headMesh.scale.set(
        gender === 'female' ? 0.91 : 0.95,
        1.06,
        0.97
      );
      headMesh.castShadow = !isSoftwareGl && isInteractive;
      headGroup.add(headMesh);

      // Sculpted Jawline / Chin & Subtle Cheek Contours for Realistic Facial Proportions
      const jawMesh = new THREE.Mesh(jawGeo, skinMat);
      jawMesh.position.set(0, -0.055, 0.022);
      jawMesh.scale.set(
        gender === 'female' ? 0.86 : 0.94,
        0.92,
        0.88
      );
      const leftCheek = new THREE.Mesh(cheekGeo, cheekMat);
      leftCheek.position.set(-0.095, -0.025, 0.142);
      leftCheek.scale.set(1.1, 0.75, 0.55);
      const rightCheek = new THREE.Mesh(cheekGeo, cheekMat);
      rightCheek.position.set(0.095, -0.025, 0.142);
      rightCheek.scale.set(1.1, 0.75, 0.55);
      headGroup.add(jawMesh, leftCheek, rightCheek);

      // 3D Ears
      const leftEar = new THREE.Mesh(earGeo, skinMat);
      leftEar.position.set(-0.178, -0.005, -0.01);
      leftEar.scale.set(0.45, 1.1, 0.75);
      const rightEar = new THREE.Mesh(earGeo, skinMat);
      rightEar.position.set(0.178, -0.005, -0.01);
      rightEar.scale.set(0.45, 1.1, 0.75);
      headGroup.add(leftEar, rightEar);

      // 3D Hair Group: Crown tilted backward so front hairline sits high on forehead (NEVER covers eyebrows or eyes!)
      const hairGroup = new THREE.Group();
      const crownMesh = new THREE.Mesh(hairCrownGeo, hairMat);
      crownMesh.position.set(0, 0.048, -0.028);
      crownMesh.rotation.x = -0.44;
      crownMesh.scale.set(0.98, 1.04, 1.02);
      hairGroup.add(crownMesh);

      if (hairStyle === 'bob') {
        // Female / stylish bob cut with high side-parted front hair (clear of eyebrows/eyes)
        const leftFrontBangs = new THREE.Mesh(hairSideSweptBangsGeo, hairMat);
        leftFrontBangs.position.set(-0.088, 0.158, 0.142);
        leftFrontBangs.rotation.set(0.28, -0.25, 0.95);

        const rightFrontBangs = new THREE.Mesh(hairSideSweptBangsGeo, hairMat);
        rightFrontBangs.position.set(0.088, 0.158, 0.142);
        rightFrontBangs.rotation.set(0.28, 0.25, -0.95);

        const leftBob = new THREE.Mesh(hairBobSideGeo, hairMat);
        leftBob.position.set(-0.168, -0.035, -0.01);
        leftBob.rotation.z = 0.06;

        const rightBob = new THREE.Mesh(hairBobSideGeo, hairMat);
        rightBob.position.set(0.168, -0.035, -0.01);
        rightBob.rotation.z = -0.06;

        const backBob = new THREE.Mesh(hairBackBobGeo, hairMat);
        backBob.position.set(0, -0.04, -0.14);

        hairGroup.add(leftFrontBangs, rightFrontBangs, leftBob, rightBob, backBob);
      } else if (hairStyle === 'long') {
        // Flowing shoulder-length long hair with high swept bangs (clear of eyebrows/eyes)
        const leftFrontBangs = new THREE.Mesh(hairSideSweptBangsGeo, hairMat);
        leftFrontBangs.position.set(-0.085, 0.162, 0.142);
        leftFrontBangs.rotation.set(0.26, -0.22, 0.98);

        const rightFrontBangs = new THREE.Mesh(hairSideSweptBangsGeo, hairMat);
        rightFrontBangs.position.set(0.085, 0.162, 0.142);
        rightFrontBangs.rotation.set(0.26, 0.22, -0.98);

        const leftLong = new THREE.Mesh(hairLongSideGeo, hairMat);
        leftLong.position.set(-0.172, -0.11, -0.015);
        leftLong.rotation.z = 0.05;

        const rightLong = new THREE.Mesh(hairLongSideGeo, hairMat);
        rightLong.position.set(0.172, -0.11, -0.015);
        rightLong.rotation.z = -0.05;

        const backLong = new THREE.Mesh(hairBackLongGeo, hairMat);
        backLong.position.set(0, -0.12, -0.15);

        hairGroup.add(leftFrontBangs, rightFrontBangs, leftLong, rightLong, backLong);
      } else if (hairStyle === 'parted') {
        // Professor / formal parted hairstyle with neat high hairline & temple gray accents
        const topParted = new THREE.Mesh(hairTopQuiffGeo, hairMat);
        topParted.position.set(0.025, 0.188, 0.065);
        topParted.rotation.z = Math.PI / 2 - 0.12;
        topParted.rotation.x = -0.25;
        topParted.scale.set(0.82, 1.12, 0.88);

        const templeMat = role === 'professor' ? silverHairMat : hairMat;
        const leftSideburn = new THREE.Mesh(hairSideburnGeo, templeMat);
        leftSideburn.position.set(-0.172, 0.05, 0.015);
        const rightSideburn = new THREE.Mesh(hairSideburnGeo, templeMat);
        rightSideburn.position.set(0.172, 0.05, 0.015);

        hairGroup.add(topParted, leftSideburn, rightSideburn);
      } else {
        // 'short': Textured modern short crop swept upward above the forehead
        const topQuiff = new THREE.Mesh(hairTopQuiffGeo, hairMat);
        topQuiff.position.set(0, 0.192, 0.072);
        topQuiff.rotation.z = Math.PI / 2;
        topQuiff.rotation.x = -0.32;
        topQuiff.scale.set(0.85, 1.1, 0.88);

        const leftSideburn = new THREE.Mesh(hairSideburnGeo, hairMat);
        leftSideburn.position.set(-0.172, 0.055, 0.015);
        const rightSideburn = new THREE.Mesh(hairSideburnGeo, hairMat);
        rightSideburn.position.set(0.172, 0.055, 0.015);

        hairGroup.add(topQuiff, leftSideburn, rightSideburn);
      }

      headGroup.add(hairGroup);

      // Glasses for professors
      if (role === 'professor') {
        const leftRim = new THREE.Mesh(rimGeo, frameMat);
        leftRim.position.set(-0.068, 0.024, 0.188);
        const rightRim = new THREE.Mesh(rimGeo, frameMat);
        rightRim.position.set(0.068, 0.024, 0.188);
        const bridge = new THREE.Mesh(bridgeGeo, frameMat);
        bridge.rotation.z = Math.PI / 2;
        bridge.position.set(0, 0.026, 0.194);
        headGroup.add(leftRim, rightRim, bridge);
      }

      // Expressive Realistic Face Group: Sclera + Iris + Pupil + Catchlight + Lash + Eyelids + Brows + Nose + Mouth
      const faceGroup = new THREE.Group();

      // Sculpted 3D Nose Bridge & Rounded Tip
      const noseBridge = new THREE.Mesh(noseBridgeGeo, skinMat);
      noseBridge.position.set(0, -0.002, 0.186);
      noseBridge.rotation.x = -0.22;
      const noseTip = new THREE.Mesh(noseTipGeo, skinMat);
      noseTip.position.set(0, -0.024, 0.198);
      noseTip.scale.set(1.05, 0.88, 0.95);
      faceGroup.add(noseBridge, noseTip);

      // Left Eye (Sclera + Colored Iris + Dark Pupil + White Corneal Catchlight + Lash Line)
      const leftSclera = new THREE.Mesh(scleraGeo, scleraMat);
      leftSclera.position.set(-0.066, 0.024, 0.166);
      leftSclera.scale.set(1.15, 0.95, 0.62);
      const leftIris = new THREE.Mesh(irisGeo, irisMat);
      leftIris.position.set(-0.066, 0.024, 0.179);
      leftIris.scale.set(1.0, 1.0, 0.45);
      const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
      leftPupil.position.set(-0.066, 0.024, 0.185);
      leftPupil.scale.set(1.0, 1.0, 0.4);
      const leftCatchlight = new THREE.Mesh(catchlightGeo, catchlightMat);
      leftCatchlight.position.set(-0.06, 0.03, 0.19);
      const leftLash = new THREE.Mesh(lashGeo, lashMat);
      leftLash.position.set(-0.066, 0.026, 0.181);
      leftLash.scale.set(1.12, 0.92, 0.7);

      // Right Eye (Sclera + Colored Iris + Dark Pupil + White Corneal Catchlight + Lash Line)
      const rightSclera = new THREE.Mesh(scleraGeo, scleraMat);
      rightSclera.position.set(0.066, 0.024, 0.166);
      rightSclera.scale.set(1.15, 0.95, 0.62);
      const rightIris = new THREE.Mesh(irisGeo, irisMat);
      rightIris.position.set(0.066, 0.024, 0.179);
      rightIris.scale.set(1.0, 1.0, 0.45);
      const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
      rightPupil.position.set(0.066, 0.024, 0.185);
      rightPupil.scale.set(1.0, 1.0, 0.4);
      const rightCatchlight = new THREE.Mesh(catchlightGeo, catchlightMat);
      rightCatchlight.position.set(0.072, 0.03, 0.19);
      const rightLash = new THREE.Mesh(lashGeo, lashMat);
      rightLash.position.set(0.066, 0.026, 0.181);
      rightLash.scale.set(1.12, 0.92, 0.7);

      const leftEyelid = new THREE.Mesh(eyelidGeo, eyelidMat);
      leftEyelid.position.set(-0.066, 0.026, 0.171);
      leftEyelid.scale.set(1.18, 0.12, 0.72);

      const rightEyelid = new THREE.Mesh(eyelidGeo, eyelidMat);
      rightEyelid.position.set(0.066, 0.026, 0.171);
      rightEyelid.scale.set(1.18, 0.12, 0.72);

      // Expressive Eyebrows (Arched capsules rotated horizontally, clear of hair)
      const leftBrow = new THREE.Mesh(browGeo, hairMat);
      leftBrow.position.set(-0.066, 0.074, 0.181);
      leftBrow.rotation.z = Math.PI / 2;
      const rightBrow = new THREE.Mesh(browGeo, hairMat);
      rightBrow.position.set(0.066, 0.074, 0.181);
      rightBrow.rotation.z = Math.PI / 2;

      // Lip-Sync Mouth (Rotated horizontally; scale.x opens mouth vertically!)
      const mouthMesh = new THREE.Mesh(mouthGeo, mouthMat);
      mouthMesh.position.set(0, -0.074, 0.179);
      mouthMesh.rotation.z = Math.PI / 2;
      mouthMesh.scale.set(0.42, 1.0, 0.65);

      faceGroup.add(
        leftSclera,
        leftIris,
        leftPupil,
        leftCatchlight,
        leftLash,
        rightSclera,
        rightIris,
        rightPupil,
        rightCatchlight,
        rightLash,
        leftEyelid,
        rightEyelid,
        leftBrow,
        rightBrow,
        mouthMesh
      );
      headGroup.add(faceGroup);
      avatarGroup.add(headGroup);

      // Right Arm + White Shirt Cuff + Sculpted Hand
      const rightArmGroup = new THREE.Group();
      rightArmGroup.position.set(0.27, 1.13, -0.05);
      const rightUpper = new THREE.Mesh(upperArmGeo, torsoMat);
      rightUpper.position.set(0, -0.15, 0);
      rightArmGroup.add(rightUpper);

      const rightForearm = new THREE.Group();
      rightForearm.position.set(0, -0.3, 0);
      const rightForearmMesh = new THREE.Mesh(forearmGeo, torsoMat);
      rightForearmMesh.position.set(0, -0.12, 0);
      const rightCuff = new THREE.Mesh(cuffGeo, whiteShirtMat);
      rightCuff.position.set(0, -0.245, 0);
      const rightPalm = new THREE.Mesh(handPalmGeo, skinMat);
      rightPalm.position.set(0, -0.285, 0.01);
      rightPalm.scale.set(0.75, 1.15, 0.95);
      const rightThumb = new THREE.Mesh(thumbGeo, skinMat);
      rightThumb.position.set(-0.028, -0.275, 0.035);
      rightThumb.rotation.x = 0.5;
      rightForearm.add(rightForearmMesh, rightCuff, rightPalm, rightThumb);

      // Pen resting neatly beside notebook on the desk
      const penMesh = new THREE.Mesh(penGeo, notebookPenMat);
      penMesh.position.set(0.23, 0.976, 0.34);
      penMesh.rotation.x = Math.PI / 2;
      penMesh.rotation.z = 0.15;
      avatarGroup.add(penMesh);

      rightArmGroup.add(rightForearm);

      // Left Arm + White Shirt Cuff + Sculpted Hand
      const leftArmGroup = new THREE.Group();
      leftArmGroup.position.set(-0.27, 1.13, -0.05);
      const leftUpper = new THREE.Mesh(upperArmGeo, torsoMat);
      leftUpper.position.set(0, -0.15, 0);
      leftArmGroup.add(leftUpper);

      const leftForearm = new THREE.Group();
      leftForearm.position.set(0, -0.3, 0);
      const leftForearmMesh = new THREE.Mesh(forearmGeo, torsoMat);
      leftForearmMesh.position.set(0, -0.12, 0);
      const leftCuff = new THREE.Mesh(cuffGeo, whiteShirtMat);
      leftCuff.position.set(0, -0.245, 0);
      const leftPalm = new THREE.Mesh(handPalmGeo, skinMat);
      leftPalm.position.set(0, -0.285, 0.01);
      leftPalm.scale.set(0.75, 1.15, 0.95);
      const leftThumb = new THREE.Mesh(thumbGeo, skinMat);
      leftThumb.position.set(0.028, -0.275, 0.035);
      leftThumb.rotation.x = 0.5;
      leftForearm.add(leftForearmMesh, leftCuff, leftPalm, leftThumb);
      leftArmGroup.add(leftForearm);

      avatarGroup.add(rightArmGroup, leftArmGroup);

      if (isInteractive && member) {
        const hitBoxGeo = new THREE.BoxGeometry(0.85, 1.75, 0.85);
        const hitBoxMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitBox = new THREE.Mesh(hitBoxGeo, hitBoxMat);
        hitBox.position.set(0, 1.0, 0);
        hitBox.userData = { avatarId: member.id };
        avatarGroup.add(hitBox);
        clickableObjects.push(hitBox);
      }

      scene.add(avatarGroup);

      const initialAmbient = AMBIENT_POOL[seatIdx % AMBIENT_POOL.length];
      const neighborDir =
        slot.colIndex < slot.colsInRow - 1
          ? 1
          : slot.colIndex > 0
          ? -1
          : 0;

      const meshRecord: AvatarMeshes = {
        id: avatarId,
        isInteractive,
        row: slot.row,
        colIndex: slot.colIndex,
        colsInRow: slot.colsInRow,
        bgOrderIndex: bgIdx,
        group: avatarGroup,
        torsoMesh: torso,
        headGroup,
        faceGroup,
        leftBrow,
        rightBrow,
        leftEyelid,
        rightEyelid,
        mouthMesh,
        rightArmGroup,
        leftArmGroup,
        rightForearm,
        leftForearm,
        baseX: slot.posX,
        baseY: slot.posY,
        baseZ: slot.posZ,
        lastAction: member?.currentAction || 'idle',
        actionStartTime: 0,
        ambientBehavior: initialAmbient,
        ambientStartTime: 0,
        ambientDuration: 4 + (seatIdx % 5) * 1.2,
        nextAmbientSwitchTime: 2.5 + (seatIdx % 7) * 1.1,
        neighborDir,
        personalPhase: seatIdx * 1.73,
        sneezeUntilTime: 0,
      };

      if (isInteractive && member) {
        avatarMeshMap.set(member.id, meshRecord);
      } else {
        backgroundAvatars.push(meshRecord);
      }

      const rowList = allAvatarsByRow.get(slot.row) || [];
      rowList.push(meshRecord);
      allAvatarsByRow.set(slot.row, rowList);
    });

    // Pointer Raycasting for clicks
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handlePointerDown = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(clickableObjects, true);

      if (intersects.length > 0) {
        const hit = intersects[0].object;
        const targetId = hit.userData?.avatarId;
        if (targetId && onAvatarClickRef.current) {
          onAvatarClickRef.current(targetId);
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 500;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      updateResponsiveDefaultCamera(w / h);
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    const projVec = new THREE.Vector3();
    let frameCounter = 0;
    let lastHandledSneezeTimestamp = 0;
    let lastAppliedMood: AudienceMood = audienceMoodRef.current;

    // Shuffled ranks for background avatars so hand-raising and sleeping happen at random positions across the hall
    const bgCount = backgroundAvatars.length;
    let activeBgHandRanks: number[] = createShuffledIndices(bgCount);
    const bgSleepRanks: number[] = createShuffledIndices(bgCount);
    const topicBgRankCache = new Map<string, number[]>();
    let wasRaisingHands = false;
    let lastActiveTopicKey = '';

    const updateAmbientBehaviorIfNeeded = (
      meshes: AvatarMeshes,
      elapsed: number
    ) => {
      if (elapsed < meshes.nextAmbientSwitchTime) return;

      const mood = audienceMoodRef.current;
      const roll = Math.random();
      let nextBehavior: AmbientBehaviorType = 'listening';
      let duration = 4.0 + Math.random() * 3.5;

      if (mood === 'important') {
        if (roll < 0.78) {
          nextBehavior = 'take_notes';
          duration = 4.2 + Math.random() * 3.5;
        } else {
          nextBehavior = 'listening';
          duration = 3.0 + Math.random() * 2.5;
        }
      } else if (mood === 'slightly_bored') {
        if (roll < 0.36) {
          nextBehavior = 'cross_arms';
          duration = 4.5 + Math.random() * 4.0;
        } else if (roll < 0.66) {
          nextBehavior = 'touch_hair';
          duration = 2.6 + Math.random() * 2.0;
        } else if (roll < 0.92 && meshes.colsInRow >= 2) {
          const rowAvatars = allAvatarsByRow.get(meshes.row) || [];
          const myIdx = rowAvatars.indexOf(meshes);
          const rightNeighbor =
            myIdx >= 0 && myIdx + 1 < rowAvatars.length
              ? rowAvatars[myIdx + 1]
              : null;
          const leftNeighbor = myIdx > 0 ? rowAvatars[myIdx - 1] : null;
          const partner =
            rightNeighbor && rightNeighbor.lastAction === 'idle'
              ? rightNeighbor
              : leftNeighbor && leftNeighbor.lastAction === 'idle'
              ? leftNeighbor
              : null;

          if (partner) {
            const dir = partner.colIndex > meshes.colIndex ? 1 : -1;
            nextBehavior = 'chat_neighbor';
            duration = 3.0 + Math.random() * 1.8;
            meshes.neighborDir = dir;

            partner.ambientBehavior = 'chat_neighbor';
            partner.ambientStartTime = elapsed;
            partner.ambientDuration = duration;
            partner.nextAmbientSwitchTime = elapsed + duration;
            partner.neighborDir = -dir;
          } else {
            nextBehavior = 'cross_arms';
          }
        } else {
          nextBehavior = 'listening';
          duration = 3.0 + Math.random() * 2.5;
        }
      } else {
        if (roll < 0.16) {
          nextBehavior = 'take_notes';
          duration = 3.0 + Math.random() * 2.5;
        } else {
          nextBehavior = 'listening';
          duration = 4.0 + Math.random() * 4.0;
        }
      }

      meshes.ambientBehavior = nextBehavior;
      meshes.ambientStartTime = elapsed;
      meshes.ambientDuration = duration;
      meshes.nextAmbientSwitchTime = elapsed + duration;
    };

    // Helper to animate a single avatar mesh record including facial expressions & lip-sync
    const animateAvatarRecord = (
      meshes: AvatarMeshes,
      rawAction: string,
      emotion: string,
      elapsed: number,
      delta: number
    ) => {
      const action =
        elapsed < meshes.sneezeUntilTime ? 'sneeze' : rawAction;

      if (action !== meshes.lastAction) {
        meshes.lastAction = action;
        meshes.actionStartTime = elapsed;
      }
      const actionElapsed = elapsed - meshes.actionStartTime;
      const p = meshes.personalPhase;

      meshes.group.position.y = meshes.baseY;

      let targetTorsoRotX = 0;
      let targetTorsoRotZ = 0;

      let targetHeadRotX = 0;
      let targetHeadRotY = 0;
      let targetHeadRotZ = 0;

      let targetRightArmX = 0.4;
      let targetRightArmZ = 0.1;
      let targetRightForearmX = -0.8;
      let targetRightForearmZ = 0;

      let targetLeftArmX = 0.4;
      let targetLeftArmZ = -0.1;
      let targetLeftForearmX = -0.8;
      let targetLeftForearmZ = 0;

      if (action === 'nod') {
        const nodDuration = 1.5;
        if (actionElapsed < nodDuration) {
          const progress = actionElapsed / nodDuration;
          const cycle = Math.sin(actionElapsed * 7.5);
          const envelope = Math.cos(progress * (Math.PI * 0.5));
          targetHeadRotX =
            Math.max(-0.02, cycle * 0.16) * envelope + 0.04 * envelope;
        }
      } else if (action === 'tilt_head') {
        const tiltDuration = 2.0;
        if (actionElapsed < tiltDuration) {
          const envelope = Math.sin((actionElapsed / tiltDuration) * Math.PI);
          targetHeadRotZ = 0.18 * envelope;
          targetHeadRotX = -0.04 * envelope;
        }
      } else if (action === 'sneeze') {
        if (actionElapsed < 0.22) {
          targetTorsoRotX = -0.08;
          targetHeadRotX = -0.26;
          targetRightArmX = -0.85;
          targetRightForearmX = -1.35;
        } else if (actionElapsed < 0.68) {
          targetTorsoRotX = 0.14;
          targetHeadRotX = 0.42;
          targetRightArmX = -1.2;
          targetRightArmZ = -0.35;
          targetRightForearmX = -1.6;
        } else {
          targetHeadRotX = 0.08;
        }
      } else if (action === 'sleep') {
        const dozeNod = Math.sin(elapsed * 1.6 + p) * 0.07;
        targetTorsoRotX = 0.06;
        targetHeadRotX = 0.46 + dozeNod;
        targetHeadRotZ = 0.12;
        targetRightArmX = 0.2;
        targetRightForearmX = -0.4;
        targetLeftArmX = 0.2;
        targetLeftForearmX = -0.4;
      } else if (action === 'clap') {
        // Energetic clapping clearly ABOVE the desk in front of the upper chest/collarbone
        const clapOpen = Math.abs(Math.sin(elapsed * 14.5 + p));
        targetTorsoRotX = -0.03;
        targetHeadRotX = -0.03 + Math.sin(elapsed * 14.5 + p) * 0.035;

        targetRightArmX = -1.08 - (1 - clapOpen) * 0.08;
        targetRightArmZ = -0.46 + clapOpen * 0.34;
        targetRightForearmX = -1.24;
        targetRightForearmZ = -0.26 + clapOpen * 0.30;

        targetLeftArmX = -1.08 - (1 - clapOpen) * 0.08;
        targetLeftArmZ = 0.46 - clapOpen * 0.34;
        targetLeftForearmX = -1.24;
        targetLeftForearmZ = 0.26 - clapOpen * 0.30;
      } else if (action === 'raised_hand') {
        targetRightArmX = -2.85;
        targetRightArmZ = 0.18;
        targetRightForearmX = -0.08;
        targetHeadRotX = -0.08;
      } else if (action === 'hesitate_hand') {
        // Subtle, natural Japanese-style reaction: gently glancing left & right at neighbors
        // while slightly lifting the right hand partway
        const lookWave = Math.sin(elapsed * 3.1 + p * 1.9);
        const subLook = Math.cos(elapsed * 2.3 + p * 1.1);
        targetTorsoRotX = 0.015;
        targetTorsoRotZ = lookWave * 0.015;
        targetHeadRotY = lookWave * 0.14;
        targetHeadRotZ = subLook * 0.025;
        targetHeadRotX = 0.02 + Math.sin(elapsed * 3.5 + p) * 0.015;

        const handTentative = Math.sin(elapsed * 3.4 + p * 1.4) * 0.05;
        targetRightArmX = -0.78 + handTentative;
        targetRightArmZ = 0.10;
        targetRightForearmX = -0.95 - handTentative * 0.35;
        targetRightForearmZ = -0.05;

        targetLeftArmX = 0.44;
        targetLeftArmZ = -0.08;
        targetLeftForearmX = -0.84;
      } else {
        updateAmbientBehaviorIfNeeded(meshes, elapsed);
        const amb = meshes.ambientBehavior;

        const breath = Math.sin(elapsed * 1.8 + p) * 0.015;
        const slowGazeY = Math.sin(elapsed * 0.65 + p * 1.3) * 0.07;

        if (amb === 'take_notes') {
          const writeStroke = Math.sin(elapsed * 13.5 + p) * 0.09;
          const lineShift = Math.cos(elapsed * 2.4 + p) * 0.04;
          targetTorsoRotX = 0.07;
          targetHeadRotX = 0.28 + Math.sin(elapsed * 2.0 + p) * 0.025;
          targetHeadRotY = -0.06 + lineShift;

          targetRightArmX = 0.78 + lineShift * 0.4;
          targetRightArmZ = -0.14 + writeStroke;
          targetRightForearmX = -1.05;
          targetRightForearmZ = writeStroke * 1.2;

          targetLeftArmX = 0.66;
          targetLeftArmZ = 0.12;
          targetLeftForearmX = -0.95;
        } else if (amb === 'cross_arms') {
          targetTorsoRotX = -0.05 + breath;
          targetHeadRotX = 0.05 + Math.sin(elapsed * 1.4 + p) * 0.025;
          targetHeadRotY = slowGazeY * 0.8;
          targetHeadRotZ = 0.06;

          targetRightArmX = 0.68;
          targetRightArmZ = -0.48;
          targetRightForearmX = -1.42;
          targetRightForearmZ = -0.35;

          targetLeftArmX = 0.68;
          targetLeftArmZ = 0.48;
          targetLeftForearmX = -1.42;
          targetLeftForearmZ = 0.35;
        } else if (amb === 'touch_hair') {
          const stroke = Math.sin(elapsed * 5.2 + p) * 0.08;
          targetTorsoRotX = breath;
          targetHeadRotZ = -0.09;
          targetHeadRotX = 0.03;
          targetHeadRotY = 0.06;

          targetRightArmX = -1.95 + stroke;
          targetRightArmZ = -0.32;
          targetRightForearmX = -1.85 - stroke * 0.8;
          targetRightForearmZ = -0.22;

          targetLeftArmX = 0.42;
          targetLeftArmZ = -0.1;
          targetLeftForearmX = -0.82;
        } else if (amb === 'chat_neighbor' && meshes.neighborDir !== 0) {
          const dir = meshes.neighborDir;
          const chatNod = Math.sin(elapsed * 7.8 + p) * 0.055;
          const gesture = Math.sin(elapsed * 5.5 + p) * 0.08;

          targetTorsoRotZ = -dir * 0.055;
          targetTorsoRotX = 0.03;
          targetHeadRotY = dir * 0.48 + Math.sin(elapsed * 2.2 + p) * 0.04;
          targetHeadRotX = 0.04 + chatNod;
          targetHeadRotZ = -dir * 0.06;

          if (dir > 0) {
            targetRightArmX = 0.65 + gesture;
            targetRightArmZ = -0.18;
            targetRightForearmX = -1.1 + gesture;
          } else {
            targetLeftArmX = 0.65 + gesture;
            targetLeftArmZ = 0.18;
            targetLeftForearmX = -1.1 + gesture;
          }
        } else {
          const microNod =
            Math.sin(elapsed * 1.1 + p * 2.1) > 0.88
              ? Math.sin(elapsed * 6.0) * 0.04
              : 0;
          targetTorsoRotX = breath;
          targetHeadRotX = microNod;
          targetHeadRotY = slowGazeY;
          targetHeadRotZ = Math.sin(elapsed * 0.45 + p) * 0.025;

          targetRightArmX = 0.44 + breath;
          targetRightArmZ = 0.08;
          targetRightForearmX = -0.84;

          targetLeftArmX = 0.44 + breath;
          targetLeftArmZ = -0.08;
          targetLeftForearmX = -0.84;
        }
      }

      // --- Facial Expressions: Eyelids (Blinking / Sleeping), Eyebrows & Lip-Sync Mouth ---
      // 1. Eyelids: natural periodic blink every ~4.2s, half-droop when slightly bored, closed when sleeping or sneezing
      const blinkCycle = (elapsed * 0.24 + p * 0.37) % 1.0;
      const isNaturalBlink = blinkCycle > 0.96;
      const mood = audienceMoodRef.current;

      let targetEyelidScaleY = 0.15;
      if (action === 'sleep' || action === 'sneeze') {
        targetEyelidScaleY = 1.12; // Eyes closed
      } else if (isNaturalBlink) {
        targetEyelidScaleY = 1.12;
      } else if (mood === 'slightly_bored' || emotion === 'Bored') {
        targetEyelidScaleY = 0.55; // Half-drooped bored eyes
      }

      meshes.leftEyelid.scale.y = THREE.MathUtils.damp(
        meshes.leftEyelid.scale.y,
        targetEyelidScaleY,
        18,
        delta
      );
      meshes.rightEyelid.scale.y = meshes.leftEyelid.scale.y;

      // 2. Eyebrows: angle & height reflect emotion/action (base rotation.z is Math.PI / 2)
      let targetLeftBrowY = 0.074;
      let targetRightBrowY = 0.074;
      let targetLeftBrowZ = Math.PI / 2;
      let targetRightBrowZ = Math.PI / 2;

      if (action === 'tilt_head' || action === 'hesitate_hand' || emotion === 'Confused') {
        // Questioning / Confused / Hesitating: one brow raised, one furrowed
        targetLeftBrowY = 0.068;
        targetRightBrowY = 0.084;
        targetLeftBrowZ = Math.PI / 2 - 0.18;
        targetRightBrowZ = Math.PI / 2 + 0.16;
      } else if (
        action === 'clap' ||
        action === 'nod' ||
        emotion === 'Impressed'
      ) {
        // Impressed / Interested: raised attentive eyebrows
        targetLeftBrowY = 0.082;
        targetRightBrowY = 0.082;
        targetLeftBrowZ = Math.PI / 2 + 0.06;
        targetRightBrowZ = Math.PI / 2 - 0.06;
      } else if (
        action === 'sleep' ||
        mood === 'slightly_bored' ||
        emotion === 'Bored'
      ) {
        // Bored / Sleepy: drooped outer brows
        targetLeftBrowY = 0.069;
        targetRightBrowY = 0.069;
        targetLeftBrowZ = Math.PI / 2 + 0.12;
        targetRightBrowZ = Math.PI / 2 - 0.12;
      }

      meshes.leftBrow.position.y = THREE.MathUtils.damp(
        meshes.leftBrow.position.y,
        targetLeftBrowY,
        10,
        delta
      );
      meshes.rightBrow.position.y = THREE.MathUtils.damp(
        meshes.rightBrow.position.y,
        targetRightBrowY,
        10,
        delta
      );
      meshes.leftBrow.rotation.z = THREE.MathUtils.damp(
        meshes.leftBrow.rotation.z,
        targetLeftBrowZ,
        10,
        delta
      );
      meshes.rightBrow.rotation.z = THREE.MathUtils.damp(
        meshes.rightBrow.rotation.z,
        targetRightBrowZ,
        10,
        delta
      );

      // 3. Real-Time Lip-Sync Mouth ('口パク'):
      // Opens and closes rhythmically when speaking via Gemini TTS / Web Speech, or during neighbor whisper
      const isSpeaking =
        meshes.isInteractive && isAvatarSpeakingNow(meshes.id);
      const isWhispering =
        action === 'idle' && meshes.ambientBehavior === 'chat_neighbor';

      let targetMouthOpen = 0.42; // Closed neutral mouth
      if (isSpeaking) {
        const syllableWave =
          Math.abs(Math.sin(elapsed * 16.5 + p)) * 0.65 +
          Math.abs(Math.cos(elapsed * 25.0 + p * 0.5)) * 0.45;
        targetMouthOpen = 0.55 + syllableWave * 1.45;
        // Add subtle natural speaking head micro-movement
        targetHeadRotX += Math.sin(elapsed * 9.0 + p) * 0.035;
      } else if (action === 'sneeze' && actionElapsed < 0.65) {
        targetMouthOpen = 1.65;
      } else if (isWhispering) {
        targetMouthOpen =
          0.45 + Math.abs(Math.sin(elapsed * 12.0 + p)) * 0.55;
      }

      meshes.mouthMesh.scale.x = THREE.MathUtils.damp(
        meshes.mouthMesh.scale.x,
        targetMouthOpen,
        20,
        delta
      );

      // Apply damped body & limb rotations
      meshes.torsoMesh.rotation.x = THREE.MathUtils.damp(
        meshes.torsoMesh.rotation.x,
        targetTorsoRotX,
        7,
        delta
      );
      meshes.torsoMesh.rotation.z = THREE.MathUtils.damp(
        meshes.torsoMesh.rotation.z,
        targetTorsoRotZ,
        7,
        delta
      );

      meshes.headGroup.rotation.x = THREE.MathUtils.damp(
        meshes.headGroup.rotation.x,
        targetHeadRotX,
        8,
        delta
      );
      meshes.headGroup.rotation.y = THREE.MathUtils.damp(
        meshes.headGroup.rotation.y,
        targetHeadRotY,
        8,
        delta
      );
      meshes.headGroup.rotation.z = THREE.MathUtils.damp(
        meshes.headGroup.rotation.z,
        targetHeadRotZ,
        8,
        delta
      );

      const armDamp = action === 'clap' ? 24 : action === 'hesitate_hand' ? 11 : 8;

      meshes.rightArmGroup.rotation.x = THREE.MathUtils.damp(
        meshes.rightArmGroup.rotation.x,
        targetRightArmX,
        armDamp,
        delta
      );
      meshes.rightArmGroup.rotation.z = THREE.MathUtils.damp(
        meshes.rightArmGroup.rotation.z,
        targetRightArmZ,
        armDamp,
        delta
      );
      meshes.rightForearm.rotation.x = THREE.MathUtils.damp(
        meshes.rightForearm.rotation.x,
        targetRightForearmX,
        armDamp,
        delta
      );
      meshes.rightForearm.rotation.z = THREE.MathUtils.damp(
        meshes.rightForearm.rotation.z,
        targetRightForearmZ,
        armDamp,
        delta
      );

      meshes.leftArmGroup.rotation.x = THREE.MathUtils.damp(
        meshes.leftArmGroup.rotation.x,
        targetLeftArmX,
        armDamp,
        delta
      );
      meshes.leftArmGroup.rotation.z = THREE.MathUtils.damp(
        meshes.leftArmGroup.rotation.z,
        targetLeftArmZ,
        armDamp,
        delta
      );
      meshes.leftForearm.rotation.x = THREE.MathUtils.damp(
        meshes.leftForearm.rotation.x,
        targetLeftForearmX,
        armDamp,
        delta
      );
      meshes.leftForearm.rotation.z = THREE.MathUtils.damp(
        meshes.leftForearm.rotation.z,
        targetLeftForearmZ,
        armDamp,
        delta
      );
    };

    // 3. Animation Loop
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();
      frameCounter++;

      const currentSneeze = sneezeTriggerRef.current;
      if (
        currentSneeze &&
        currentSneeze.timestamp !== lastHandledSneezeTimestamp
      ) {
        lastHandledSneezeTimestamp = currentSneeze.timestamp;
        if (currentSneeze.avatarId && avatarMeshMap.has(currentSneeze.avatarId)) {
          const m = avatarMeshMap.get(currentSneeze.avatarId)!;
          m.sneezeUntilTime = elapsed + 1.25;
        } else {
          const rowCandidates =
            allAvatarsByRow.get(currentSneeze.row) || backgroundAvatars;
          if (rowCandidates.length > 0) {
            const picked =
              rowCandidates[
                (currentSneeze.bgIndex ?? 0) % rowCandidates.length
              ];
            picked.sneezeUntilTime = elapsed + 1.25;
          }
        }
      }

      // Camera Damping: Fast, responsive zoom when nominating/focusing an avatar
      const activeFocus = focusRef.current;
      const focusedAvatar = activeFocus ? avatarMeshMap.get(activeFocus) : null;

      if (focusedAvatar) {
        const targetX = focusedAvatar.baseX;
        const targetY = focusedAvatar.baseY;
        const targetZ = focusedAvatar.baseZ;

        const desiredCamPosX = targetX * 0.65;
        const desiredCamPosY = targetY + 1.55;
        const desiredCamPosZ = targetZ + 2.35;

        const desiredTargetX = targetX;
        const desiredTargetY = targetY + 1.38;
        const desiredTargetZ = targetZ - 0.05;

        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          desiredCamPosX,
          6.8,
          delta
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          desiredCamPosY,
          6.8,
          delta
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          desiredCamPosZ,
          6.8,
          delta
        );

        currentCamTarget.x = THREE.MathUtils.damp(
          currentCamTarget.x,
          desiredTargetX,
          7.5,
          delta
        );
        currentCamTarget.y = THREE.MathUtils.damp(
          currentCamTarget.y,
          desiredTargetY,
          7.5,
          delta
        );
        currentCamTarget.z = THREE.MathUtils.damp(
          currentCamTarget.z,
          desiredTargetZ,
          7.5,
          delta
        );
      } else {
        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          defaultCamPos.x,
          4.5,
          delta
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          defaultCamPos.y,
          4.5,
          delta
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          defaultCamPos.z,
          4.5,
          delta
        );

        currentCamTarget.x = THREE.MathUtils.damp(
          currentCamTarget.x,
          defaultCamTarget.x,
          5.0,
          delta
        );
        currentCamTarget.y = THREE.MathUtils.damp(
          currentCamTarget.y,
          defaultCamTarget.y,
          5.0,
          delta
        );
        currentCamTarget.z = THREE.MathUtils.damp(
          currentCamTarget.z,
          defaultCamTarget.z,
          5.0,
          delta
        );
      }

      camera.lookAt(currentCamTarget);

      const currentMood = audienceMoodRef.current;
      if (currentMood !== lastAppliedMood) {
        lastAppliedMood = currentMood;
        avatarMeshMap.forEach((m) => {
          m.nextAmbientSwitchTime = elapsed + Math.random() * 0.35;
        });
        backgroundAvatars.forEach((m) => {
          m.nextAmbientSwitchTime = elapsed + Math.random() * 0.45;
        });
      }

      // Animate interactive front-row members
      const currentAudience = audienceRef.current;
      let anyClapping = false;
      let anyNodding = false;
      let anyHesitating = false;

      currentAudience.forEach((member) => {
        const meshes = avatarMeshMap.get(member.id);
        if (!meshes) return;
        let act = member.currentAction || 'idle';
        if (act === 'idle' && currentMood === 'very_bored') {
          act = 'sleep';
        }
        if (act === 'clap') anyClapping = true;
        if (act === 'nod') anyNodding = true;
        if (act === 'hesitate_hand') anyHesitating = true;
        animateAvatarRecord(
          meshes,
          act,
          member.emotion || 'Interested',
          elapsed,
          delta
        );
      });

      // Animate background lecture-hall avatars at scattered random positions
      const bgTotal = backgroundAvatars.length;
      if (bgTotal > 0) {
        const handRatio = raisedHandRatioRef.current;
        const currentTopicKey = (handRaiseTopicKeyRef.current || '').trim();
        const isNegativeHand = Boolean(isNegativeHandRaiseRef.current);

        if (handRatio > 0) {
          if (!wasRaisingHands || currentTopicKey !== lastActiveTopicKey) {
            wasRaisingHands = true;
            lastActiveTopicKey = currentTopicKey;
            if (currentTopicKey) {
              const cachedRanks = topicBgRankCache.get(currentTopicKey);
              if (cachedRanks && cachedRanks.length === bgTotal) {
                activeBgHandRanks = cachedRanks;
              } else {
                const freshRanks = createShuffledIndices(bgTotal);
                topicBgRankCache.set(currentTopicKey, freshRanks);
                activeBgHandRanks = freshRanks;
              }
            } else {
              activeBgHandRanks = createShuffledIndices(bgTotal);
            }
          }
        } else {
          wasRaisingHands = false;
        }

        const sleepRatio =
          currentMood === 'very_bored'
            ? Math.max(0.85, sleepingRatioRef.current)
            : sleepingRatioRef.current;
        const numBgHandsToRaise = Math.round(handRatio * bgTotal);
        const numBgSleeping = Math.round(sleepRatio * bgTotal);

        backgroundAvatars.forEach((bgMeshes, idx) => {
          const myHandRank = activeBgHandRanks[idx] ?? idx;
          const mySleepRank = bgSleepRanks[idx] ?? idx;
          const shouldRaiseThisBgHand =
            numBgHandsToRaise > 0 &&
            (isNegativeHand && currentTopicKey
              ? myHandRank >= bgTotal - numBgHandsToRaise
              : myHandRank < numBgHandsToRaise);

          let bgAction = 'idle';
          if (anyHesitating) {
            bgAction = 'hesitate_hand';
          } else if (shouldRaiseThisBgHand) {
            bgAction = 'raised_hand';
          } else if (anyClapping) {
            bgAction = 'clap';
          } else if (mySleepRank < numBgSleeping && numBgSleeping > 0) {
            bgAction = 'sleep';
          } else if (anyNodding && myHandRank % 2 === 0) {
            bgAction = 'nod';
          }
          animateAvatarRecord(
            bgMeshes,
            bgAction,
            bgAction === 'sleep' ? 'Bored' : 'Interested',
            elapsed,
            delta
          );
        });
      }

      renderer.render(scene, camera);

      // Update projected 2D name badges every 3 frames (clean name & role only)
      if (frameCounter % 3 === 0 && container) {
        const cw = container.clientWidth || 800;
        const ch = container.clientHeight || 500;
        const nextLabels: ProjectedLabel[] = [];

        currentAudience.forEach((member) => {
          const meshes = avatarMeshMap.get(member.id);
          if (!meshes) return;

          if (activeFocus && activeFocus !== member.id) {
            return;
          }

          const anchorY =
            meshes.row === 0 && numRows >= 2
              ? meshes.baseY + 0.78
              : meshes.baseY + 1.86;
          const anchorZ =
            meshes.row === 0 && numRows >= 2
              ? meshes.baseZ + 0.65
              : meshes.baseZ - 0.05;

          projVec.set(meshes.baseX, anchorY, anchorZ);
          projVec.project(camera);

          const sx = (projVec.x * 0.5 + 0.5) * cw;
          const sy = (-(projVec.y * 0.5) + 0.5) * ch;
          const isVisible =
            projVec.z < 1.0 &&
            sx >= 20 &&
            sx <= cw - 20 &&
            sy >= 20 &&
            sy <= ch - 20;

          nextLabels.push({
            id: member.id,
            name: member.name,
            roleLabel: member.roleLabel,
            role: member.role,
            x: sx,
            y: sy,
            row: meshes.row,
            visible: isVisible,
          });
        });

        setProjectedLabels(nextLabels);
      }
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      scene.clear();
    };
  }, [effectiveTotalCount, appearanceSignature]);

  return (
    <div
      ref={mountRef}
      className={`relative w-full h-full overflow-hidden select-none ${className}`}
      style={{ touchAction: 'none' }}
    >
      {/* Crisp 2D Projected Name Badges (No status clutter) */}
      <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
        {projectedLabels.map((lbl) => {
          if (!lbl.visible) return null;

          const roleBadgeColor =
            lbl.role === 'professor'
              ? 'border-sky-500/70 bg-slate-950/90 text-sky-300'
              : lbl.role === 'peer'
              ? 'border-emerald-500/60 bg-slate-950/90 text-emerald-300'
              : 'border-indigo-500/60 bg-slate-950/90 text-indigo-300';

          return (
            <button
              key={lbl.id}
              type="button"
              onClick={() => onAvatarClickRef.current?.(lbl.id)}
              style={{
                left: `${lbl.x}px`,
                top: `${lbl.y}px`,
                transform: 'translate(-50%, -50%)',
              }}
              className={`pointer-events-auto absolute px-2.5 py-1 rounded-lg border shadow-lg transition-transform hover:scale-105 cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${roleBadgeColor}`}
            >
              <span className="text-xs font-bold text-white tracking-tight">
                {lbl.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
