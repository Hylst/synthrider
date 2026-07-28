import { useEffect, useRef, useState, useCallback } from "react";
import { synth } from "./audio";

/* =========================================================================
   SYNTH RIDER — course rythmique pseudo-3D synthwave 100 % vectorielle
   Créateur : Hylst — Geoff, avec l'aide d'une IA
   ========================================================================= */

type GameState = "ready" | "playing" | "paused" | "over" | "victory";
type Lane = 0 | 1 | 2 | 3 | 4;
type EntKind = "block" | "note" | "powerup";
type PowerKind = "shield" | "boost" | "slow";

interface Spawn { lane: Lane; type: EntKind; kind?: PowerKind; color?: string; }
interface Obstacle extends Spawn { z: number; spawnT: number; done: boolean; }
interface Scenery { side: -1 | 1; z: number; type: "palm" | "column" | "pyramid" | "beacon"; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
interface FloatText { x: number; y: number; vy: number; life: number; maxLife: number; text: string; color: string; size: number; }
interface Star { x: number; y: number; r: number; tw: number; }

const BPM = 120;
const BEAT_SEC = 60 / BPM;
const BOOST_DUR = 5;
const SLOW_DUR = 5;
const SURGE_DUR = 3.8;
const MAX_SHIELD = 3;
const FINISH_METERS = 2400;
const LANE_COUNT = 5;
const LANE_POS = [-0.8, -0.4, 0, 0.4, 0.8];

const COLORS = {
  cyan: "#22f2ff", fuchsia: "#ff2bd6", yellow: "#ffe43a",
  shield: "#3affd0", boost: "#ffe43a", slow: "#7ab8ff",
  pink: "#ff6bdb", purple: "#9b4dff", orange: "#ff8c3a",
};

const BASE_URL = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
const UI_IMAGES: Record<string, string> = {
  hero: `${BASE_URL}images/nebula.jpg`,
  pause: `${BASE_URL}images/mountains.png`,
  crash: `${BASE_URL}images/barrier.png`,
};

function mulberry32(a: number) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hexA(hex: string, a: number) { const h = hex.replace("#", ""); const r = parseInt(h.slice(0, 2), 16); const g = parseInt(h.slice(2, 4), 16); const b = parseInt(h.slice(4, 6), 16); return `rgba(${r},${g},${b},${a})`; }
function multiplier(combo: number) { if (combo >= 40) return 5; if (combo >= 20) return 4; if (combo >= 10) return 3; if (combo >= 5) return 2; return 1; }

// Projection pseudo-3D avec courbe
function project(z: number, w: number, h: number, curveOffset: number) {
  const cz = Math.max(0, Math.min(1, z));
  const horizonY = h * 0.42;
  const cxBase = w * 0.5;
  const twist = Math.pow(cz, 0.8);
  const cx = cxBase + curveOffset * twist;
  const k = 1 - cz;
  const curved = Math.pow(k, 1.65);
  const screenY = horizonY + (h - horizonY) * curved;
  const roadHalf = w * 0.5;
  const halfWidth = roadHalf * curved;
  return { screenY, cx, halfWidth, scale: curved, horizonY, curved };
}
function laneCenterX(lane: Lane, z: number, w: number, h: number, curveOffset: number) {
  const p = project(z, w, h, curveOffset);
  return p.cx + LANE_POS[lane] * p.halfWidth;
}

function genBeat(beatIndex: number, rng: () => number, difficulty: number): Spawn[] {
  const rngLane = (): Lane => Math.floor(rng() * LANE_COUNT) as Lane;
  const spawns: Spawn[] = [];
  const seg = beatIndex % 24;
  const warmup = beatIndex < 24; // ~12 secondes de tuto doux
  const mid = beatIndex < 72;   // 3 premières boucles : progression lente

  if (seg === 1 || seg === 2) {
    spawns.push({ lane: (seg - 1) as Lane, type: "note", color: seg === 1 ? COLORS.cyan : COLORS.yellow });
  } else if (seg === 5) {
    if (!warmup) spawns.push({ lane: rngLane(), type: "powerup", kind: "shield" });
  } else if (seg === 17) {
    if (!warmup && difficulty > 0.08) {
      const k: PowerKind = Math.floor(beatIndex / 24) % 2 ? "boost" : "slow";
      spawns.push({ lane: rngLane(), type: "powerup", kind: k });
    }
  } else {
    const blockChance = warmup ? 0.12 : mid ? 0.28 + difficulty * 0.16 : 0.42 + difficulty * 0.22;
    if (rng() < blockChance) {
      const lane = rngLane();
      spawns.push({ lane, type: "block" });
      if (!warmup && difficulty > 0.45 && rng() < 0.15) {
        let l2 = rngLane(); let tries = 0;
        while (l2 === lane && tries++ < 8) l2 = rngLane();
        spawns.push({ lane: l2, type: "block" });
      }
    }
    const gemChance = warmup ? 0.85 : mid ? 0.6 : 0.5;
    if (rng() < gemChance) {
      const blocked = new Set(spawns.filter((s) => s.type === "block").map((s) => s.lane));
      let lane = rngLane(); let tries = 0;
      while (blocked.has(lane) && tries++ < 8) lane = rngLane();
      spawns.push({ lane, type: "note", color: rng() < 0.5 ? COLORS.cyan : COLORS.yellow });
    }
  }
  return spawns;
}

export default function PisteSynthetique() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const uiImagesRef = useRef<Record<string, HTMLImageElement>>({});
  const rngRef = useRef<() => number>(mulberry32(98765));

  const [gameState, setGameState] = useState<GameState>("ready");
  const [muted, setMuted] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [onboardStep, setOnboardStep] = useState(0);
  const [finalScore, setFinalScore] = useState(0);
  const [finalCombo, setFinalCombo] = useState(0);
  const [finalMeters, setFinalMeters] = useState(0);
  const [bestScore, setBestScore] = useState(() => parseInt(localStorage.getItem('synthrider_best') || '0', 10));
  const [hud, setHud] = useState({ score: 0, combo: 0, mult: 1, meters: 0, level: 1, shield: 0, boost: 0, slow: 0, sync: 0, surge: 0 });

  const stateRef = useRef({
    state: "ready" as GameState,
    playerLane: 2 as Lane,
    visualX: 0, bank: 0,
    shield: 0, boost: 0, slow: 0, sync: 0, surge: 0,
    obstacles: [] as Obstacle[], scenery: [] as Scenery[],
    particles: [] as Particle[], texts: [] as FloatText[], stars: [] as Star[],
    score: 0, combo: 0, maxCombo: 0, distance: 0,
    elapsed: 0, beatIndex: 0, nextBeatAt: BEAT_SEC * 3,
    gridScroll: 0, curveOffset: 0, targetCurve: 0,
    lastTime: 0, width: 0, height: 0, dpr: 1,
    shake: 0, flash: 0, beatPulse: 0, shieldFlash: 0, invuln: 0,
  });

  // Chargement des images UI
  useEffect(() => { const imgs: Record<string, HTMLImageElement> = {}; Object.entries(UI_IMAGES).forEach(([k, src]) => { const im = new Image(); im.src = src; imgs[k] = im; }); uiImagesRef.current = imgs; }, []);

  const resize = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    const s = stateRef.current; s.width = w; s.height = h; s.dpr = dpr;
    const stars: Star[] = [];
    for (let i = 0; i < 100; i++) stars.push({ x: Math.random() * w, y: Math.random() * h * 0.38, r: Math.random() * 1.6 + 0.3, tw: Math.random() * Math.PI * 2 });
    s.stars = stars;
    s.visualX = laneCenterX(s.playerLane, 0, w, h, s.curveOffset);
  }, []);

  useEffect(() => { resize(); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, [resize]);

  const resetGame = useCallback(() => {
    const s = stateRef.current; const w = s.width, h = s.height;
    s.playerLane = 2;
    s.visualX = laneCenterX(2, 0, w, h, 0);
    s.bank = 0; s.shield = 0; s.boost = 0; s.slow = 0; s.sync = 0; s.surge = 0;
    s.obstacles = []; s.scenery = []; s.particles = []; s.texts = [];
    s.score = 0; s.combo = 0; s.maxCombo = 0; s.distance = 0;
    s.elapsed = 0; s.beatIndex = 0;
    s.nextBeatAt = BEAT_SEC * 4;
    s.gridScroll = 0; s.curveOffset = 0; s.targetCurve = 0;
    s.shake = 0; s.flash = 0; s.beatPulse = 0;
    s.shieldFlash = 0; s.invuln = 2.0; s.lastTime = 0;
    rngRef.current = mulberry32(98765);
  }, []);

  const startGame = useCallback(() => {
    synth.init(); resetGame();
    const s = stateRef.current;
    s.nextBeatAt = s.elapsed + BEAT_SEC * 5;
    s.state = "playing"; setGameState("playing");
    setOnboardStep(0);
  }, [resetGame]);

  const togglePause = useCallback(() => {
    const s = stateRef.current;
    if (s.state === "playing") { s.state = "paused"; setGameState("paused"); }
    else if (s.state === "paused") { s.state = "playing"; setGameState("playing"); }
  }, []);

  const moveLaneRelative = useCallback((dir: -1 | 1) => {
    const s = stateRef.current;
    if (s.state !== "playing") return;
    synth.init();
    const next = s.playerLane + dir;
    if (next >= 0 && next < LANE_COUNT) { s.playerLane = next as Lane; synth.blip(); }
  }, []);

  // Auto-répétition lors du maintien d'un bouton tactile
  const repeatRef = useRef<number | null>(null);
  const startRepeat = useCallback((dir: -1 | 1) => {
    moveLaneRelative(dir);
    if (repeatRef.current) window.clearInterval(repeatRef.current);
    repeatRef.current = window.setInterval(() => moveLaneRelative(dir), 110);
  }, [moveLaneRelative]);
  const stopRepeat = useCallback(() => {
    if (repeatRef.current) { window.clearInterval(repeatRef.current); repeatRef.current = null; }
  }, []);
  useEffect(() => () => { if (repeatRef.current) window.clearInterval(repeatRef.current); }, []);

  // Swipe tactile
  const swipeRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const onSwipeStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onSwipeEnd = (e: React.TouchEvent) => {
    const st = swipeRef.current; if (!st) return; swipeRef.current = null;
    const t = e.changedTouches[0];
    const dx = t.clientX - st.x; const dy = t.clientY - st.y;
    const dt = Date.now() - st.t;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 36 && dt < 600) {
      moveLaneRelative(dx > 0 ? 1 : -1);
    }
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      if (e.key === "m" || e.key === "M") { setMuted((m) => { const nm = !m; synth.setMuted(nm); return nm; }); return; }
      if (e.key === "p" || e.key === "P" || e.key === "Escape") { togglePause(); return; }
      if (s.state === "paused") {
        if (e.key === "h" || e.key === "H") { setHelpOpen((p) => !p); return; }
        if (e.key === " " || e.key === "Enter") { togglePause(); return; }
        return;
      }
      if (s.state !== "playing") {
        if (e.key === " " || e.key === "Enter") {
          if (s.state === "ready" || s.state === "over" || s.state === "victory") startGame();
        }
        return;
      }
      synth.init();
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "q" || e.key === "A") moveLaneRelative(-1);
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") moveLaneRelative(1);
      else if (e.key === " " && s.sync >= 100) {
        s.sync = 0; s.surge = SURGE_DUR; s.flash = 0.25; synth.surge();
      }
      else if (e.key === "h" || e.key === "H") { setHelpOpen((p) => !p); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [startGame, togglePause, moveLaneRelative]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = stateRef.current;
      setHud((prev) => {
        const mult = multiplier(s.combo);
        if (prev.score !== Math.floor(s.score) || prev.combo !== s.combo || prev.meters !== Math.floor(s.distance * 120) || prev.shield !== s.shield || prev.boost !== s.boost || prev.slow !== s.slow || prev.sync !== Math.floor(s.sync) || prev.surge !== s.surge)
          return { score: Math.floor(s.score), combo: s.combo, mult, meters: Math.floor(s.distance * 120), level: 1 + Math.floor(s.distance / 350), shield: s.shield, boost: s.boost, slow: s.slow, sync: Math.floor(s.sync), surge: s.surge };
        return prev;
      });
    }, 70);
    return () => window.clearInterval(id);
  }, []);

  // Onboarding timer
  useEffect(() => {
    if (gameState !== "playing") return;
    const s = stateRef.current;
    const id = window.setInterval(() => {
      const beat = s.beatIndex;
      if (beat >= 2 && beat < 8) setOnboardStep(1);
      else if (beat >= 8 && beat < 16) setOnboardStep(2);
      else if (beat >= 16 && beat < 24) setOnboardStep(3);
      else if (beat >= 24) setOnboardStep(4);
    }, 400);
    return () => window.clearInterval(id);
  }, [gameState]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;

    const burst = (x: number, y: number, color: string, count = 18, power = 4) => {
      const s = stateRef.current;
      for (let i = 0; i < count; i++) { const ang = (Math.PI * 2 * i) / count + Math.random() * 0.6; const sp = 1 + Math.random() * power; s.particles.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1, life: 30 + Math.random() * 25, maxLife: 55, color, size: 2 + Math.random() * 2 }); }
    };
    const pushText = (x: number, y: number, text: string, color: string, size = 22) => { stateRef.current.texts.push({ x, y, vy: -0.7, life: 60, maxLife: 60, text, color, size }); };

    // -------- Fonctions de dessin --------
    const drawMountains = (alpha: number, widthScale: number, heightScale: number, color: string, yOff: number, curveOff: number) => {
      const s = stateRef.current; const w = s.width, h = s.height;
      const horizonY = h * 0.42 + yOff;
      const baseW = w * widthScale, baseH = h * heightScale;
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(w * 0.5 - baseW / 2 + curveOff * 0.5, horizonY);
      const points = 12;
      for (let i = 0; i <= points; i++) {
        const x = w * 0.5 - baseW / 2 + (baseW / points) * i + curveOff * 0.3;
        const peak = i % 2 === 0;
        const y = horizonY - (peak ? baseH : baseH * 0.3) * (0.7 + 0.3 * Math.sin(i * 1.5));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w * 0.5 + baseW / 2 + curveOff * 0.5, horizonY);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = hexA("#ffffff", 0.25); ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    };

    const drawSun = (cx: number, cy: number, r: number) => {
      ctx.save();
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2);
      glow.addColorStop(0, "rgba(255,160,80,0.45)"); glow.addColorStop(0.45, "rgba(255,60,180,0.22)"); glow.addColorStop(1, "rgba(255,60,180,0)");
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2); ctx.fill();
      const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
      grad.addColorStop(0, "#fff2a8"); grad.addColorStop(0.4, "#ffb347"); grad.addColorStop(0.75, "#ff2bd6"); grad.addColorStop(1, "#a01890");
      ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = "rgba(10,0,30,0.5)"; const bands = 7;
      for (let i = 0; i < bands; i++) { const by = cy - r * 0.25 + i * (r * 0.95) / bands; ctx.fillRect(cx - r, by, r * 2, 2 + i * 0.7); }
      ctx.restore(); ctx.restore();
    };

    const drawPalm = (x: number, y: number, size: number, alpha: number) => {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = COLORS.fuchsia; ctx.fillStyle = "rgba(20,0,30,0.6)"; ctx.shadowColor = COLORS.fuchsia; ctx.shadowBlur = 12; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + size * 0.3, y - size * 0.4, x + size * 0.15, y - size * 0.75); ctx.stroke();
      const topX = x + size * 0.15, topY = y - size * 0.75;
      for (let a = -Math.PI / 2 - 0.8; a <= -Math.PI / 2 + 0.8; a += 0.35) {
        ctx.beginPath(); ctx.moveTo(topX, topY);
        ctx.quadraticCurveTo(topX + Math.cos(a) * size * 0.65, topY + Math.sin(a) * size * 0.65, topX + Math.cos(a + 0.2) * size * 0.35, topY + Math.sin(a + 0.2) * size * 0.35);
        ctx.stroke();
      }
      ctx.restore();
    };

    const drawColumn = (x: number, y: number, size: number, alpha: number) => {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = COLORS.cyan; ctx.fillStyle = hexA(COLORS.cyan, 0.1); ctx.shadowColor = COLORS.cyan; ctx.shadowBlur = 10; ctx.lineWidth = 1.5;
      const cw = size * 0.25, ch = size;
      ctx.beginPath(); ctx.moveTo(x - cw, y); ctx.lineTo(x - cw, y - ch); ctx.lineTo(x + cw, y - ch); ctx.lineTo(x + cw, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      for (let i = 1; i < 5; i++) { const by = y - (ch / 5) * i; ctx.beginPath(); ctx.moveTo(x - cw, by); ctx.lineTo(x + cw, by); ctx.stroke(); }
      ctx.restore();
    };

    const drawPyramid = (x: number, y: number, size: number, alpha: number) => {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = COLORS.yellow; ctx.fillStyle = hexA(COLORS.yellow, 0.08); ctx.shadowColor = COLORS.yellow; ctx.shadowBlur = 10; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y - size); ctx.lineTo(x + size * 0.6, y); ctx.lineTo(x - size * 0.6, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - size); ctx.lineTo(x, y); ctx.stroke();
      ctx.restore();
    };

    const drawBeacon = (x: number, y: number, size: number, alpha: number, t: number, side: number) => {
      ctx.save(); ctx.globalAlpha = alpha;
      const poleH = size * 0.9; const poleW = Math.max(1, size * 0.04);
      const pulse = 0.6 + 0.4 * Math.sin(t * 6 + side);
      const col = side > 0 ? COLORS.cyan : COLORS.fuchsia;
      // mât
      ctx.strokeStyle = hexA(col, 0.7); ctx.lineWidth = poleW;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - poleH); ctx.stroke();
      // orbe lumineux pulsant
      const orbR = size * 0.12 * (0.8 + 0.4 * pulse);
      const og = ctx.createRadialGradient(x, y - poleH, 0, x, y - poleH, orbR * 3);
      og.addColorStop(0, hexA(col, pulse)); og.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = og; ctx.beginPath(); ctx.arc(x, y - poleH, orbR * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.shadowColor = col; ctx.shadowBlur = 14 * pulse;
      ctx.beginPath(); ctx.arc(x, y - poleH, orbR, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };

    const drawShip = (x: number, y: number, size: number, bank: number, boost: number, t: number) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(bank);
      const glowC = boost > 0 ? COLORS.boost : COLORS.cyan;
      const flameLen = size * (0.7 + 0.4 * Math.sin(t * 30)) * (boost > 0 ? 1.6 : 1);
      // Flammes d'échappement jumelles
      for (const sx of [-size * 0.38, size * 0.38]) {
        const fg = ctx.createLinearGradient(0, size * 0.4, 0, size * 0.4 + flameLen);
        fg.addColorStop(0, hexA("#ffffff", 0.9));
        fg.addColorStop(0.3, hexA(glowC, 0.85));
        fg.addColorStop(1, hexA(glowC, 0));
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.moveTo(sx - size * 0.14, size * 0.4);
        ctx.quadraticCurveTo(sx, size * 0.4 + flameLen * 1.1, sx + size * 0.14, size * 0.4);
        ctx.closePath(); ctx.fill();
      }
      // Lueur au sol
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.5);
      glow.addColorStop(0, hexA(glowC, 0.35)); glow.addColorStop(1, hexA(glowC, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.ellipse(0, size * 0.3, size * 1.8, size * 0.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = glowC; ctx.shadowBlur = 24;
      // Corps
      ctx.fillStyle = "#0a0a1a"; ctx.strokeStyle = glowC; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * 0.9, size * 0.5); ctx.lineTo(0, size * 0.2); ctx.lineTo(-size * 0.9, size * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      // Cockpit (pulse avec le rythme)
      ctx.fillStyle = "#ffffff"; ctx.shadowBlur = 12 + 6 * Math.sin(t * 8);
      ctx.beginPath(); ctx.moveTo(0, -size * 0.35); ctx.lineTo(size * 0.18, 0); ctx.lineTo(0, size * 0.2); ctx.lineTo(-size * 0.18, 0); ctx.closePath(); ctx.fill();
      // Ailes
      ctx.strokeStyle = glowC; ctx.lineWidth = 2; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(size * 0.5, 0); ctx.lineTo(size * 1.15, size * 0.55); ctx.lineTo(size * 0.9, size * 0.5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-size * 0.5, 0); ctx.lineTo(-size * 1.15, size * 0.55); ctx.lineTo(-size * 0.9, size * 0.5); ctx.stroke();
      ctx.restore();
    };

    const drawBarrier = (x: number, y: number, w: number, hBar: number, scale: number) => {
      ctx.save(); ctx.shadowColor = COLORS.fuchsia; ctx.shadowBlur = 18 + scale * 14;
      ctx.strokeStyle = "#ffd0f4"; ctx.lineWidth = 2;
      const hw = w / 2, hh = hBar / 2;
      ctx.beginPath(); ctx.moveTo(x - hw + hh, y - hh); ctx.lineTo(x + hw - hh, y - hh); ctx.lineTo(x + hw, y); ctx.lineTo(x + hw - hh, y + hh); ctx.lineTo(x - hw + hh, y + hh); ctx.lineTo(x - hw, y); ctx.closePath(); ctx.stroke();
      const grad = ctx.createLinearGradient(x - hw, 0, x + hw, 0);
      grad.addColorStop(0, hexA(COLORS.fuchsia, 0.15)); grad.addColorStop(0.5, hexA(COLORS.fuchsia, 0.8)); grad.addColorStop(1, hexA(COLORS.fuchsia, 0.15));
      ctx.fillStyle = grad; ctx.fill();
      ctx.strokeStyle = hexA("#ffffff", 0.5); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - hw * 0.5, y - hh); ctx.lineTo(x - hw * 0.5, y + hh); ctx.moveTo(x + hw * 0.5, y - hh); ctx.lineTo(x + hw * 0.5, y + hh); ctx.stroke();
      ctx.restore();
    };

    const drawGem = (x: number, y: number, r: number, color: string, t: number) => {
      ctx.save();
      const pulse = 1 + 0.12 * Math.sin(t * 6); const rp = r * pulse;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, rp * 2);
      glow.addColorStop(0, hexA(color, 0.6)); glow.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, rp * 2, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = color; ctx.shadowBlur = 16;
      ctx.fillStyle = color; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y - rp); ctx.lineTo(x + rp, y); ctx.lineTo(x, y + rp); ctx.lineTo(x - rp, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = hexA(color, 0.6); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, rp * 1.4, t * 2, t * 2 + Math.PI); ctx.stroke();
      ctx.restore();
    };

    const drawPowerup = (x: number, y: number, r: number, kind: PowerKind, t: number) => {
      const color = kind === "shield" ? COLORS.shield : kind === "boost" ? COLORS.boost : COLORS.slow;
      ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 20;
      const ring = 1 + 0.15 * Math.sin(t * 8);
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r * 1.1 * ring, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = hexA(color, 0.15); ctx.fill();
      ctx.fillStyle = color; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.4;
      if (kind === "shield") {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (Math.PI * 2 * i) / 6; const px = x + Math.cos(a) * r * 0.7; const py = y + Math.sin(a) * r * 0.7; if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (kind === "boost") {
        ctx.beginPath(); ctx.moveTo(x + r * 0.1, y - r * 0.85); ctx.lineTo(x - r * 0.45, y + r * 0.1); ctx.lineTo(x, y + r * 0.05); ctx.lineTo(x - r * 0.12, y + r * 0.85); ctx.lineTo(x + r * 0.55, y - r * 0.12); ctx.lineTo(x + r * 0.05, y - r * 0.05); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        for (let i = 0; i < 6; i++) { const a = (Math.PI * 2 * i) / 6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(x, y, r * 0.22, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    };

    // -------- UPDATE --------
    const update = (dt: number) => {
      const s = stateRef.current;
      s.elapsed += dt; s.beatPulse *= 0.9;
      if (s.state === "paused") return;
      if (s.state !== "playing") { s.gridScroll += dt * 0.12; if (s.gridScroll > 1) s.gridScroll -= 1; return; }

      const meters = s.distance * 120;
      const difficulty = Math.min(1, meters / FINISH_METERS);
      const baseSpeed = Math.min(0.74, 0.18 + difficulty * 0.4 + s.distance * 0.00004);
      const speedMul = (s.boost > 0 ? 1.28 : 1) * (s.slow > 0 ? 0.6 : 1) * (s.surge > 0 ? 1.18 : 1);
      const speed = baseSpeed * speedMul;

      s.distance += dt * baseSpeed;
      s.gridScroll += dt * speed * 0.9;
      if (s.gridScroll > 1) s.gridScroll -= 1;

      // Courbe de la route
      s.targetCurve = Math.sin(s.elapsed * 0.22) * 180 + Math.sin(s.elapsed * 0.13) * 80;
      s.curveOffset += (s.targetCurve - s.curveOffset) * Math.min(1, dt * 1.4);

      if (s.boost > 0) s.boost = Math.max(0, s.boost - dt);
      if (s.slow > 0) s.slow = Math.max(0, s.slow - dt);
      if (s.surge > 0) s.surge = Math.max(0, s.surge - dt);

      s.score += dt * (6 + difficulty * 10) * (s.boost > 0 ? 2 : 1) * (s.surge > 0 ? 3 : 1);

      if (s.distance * 120 >= FINISH_METERS) {
        const vs = Math.floor(s.score + s.combo * 25 + s.shield * 250);
        if (vs > parseInt(localStorage.getItem('synthrider_best') || '0', 10)) {
          localStorage.setItem('synthrider_best', String(vs));
          setBestScore(vs);
        }
        s.state = "victory"; setGameState("victory");
        setFinalScore(vs);
        setFinalCombo(s.maxCombo); setFinalMeters(FINISH_METERS);
        synth.milestone(); return;
      }

      if (s.elapsed >= s.nextBeatAt) {
        const spawns = genBeat(s.beatIndex, rngRef.current, difficulty);
        for (const sp of spawns) s.obstacles.push({ ...sp, z: 1.0, spawnT: 0, done: false });
        if (s.beatIndex % 2 === 0) {
          const side: -1 | 1 = Math.floor(s.beatIndex / 2) % 2 ? 1 : -1;
          const types: Scenery["type"][] = ["palm", "column", "pyramid", "beacon"];
          s.scenery.push({ side, z: 1.1, type: types[(s.beatIndex / 3 | 0) % 4] });
        }
        synth.step(s.beatIndex, Math.min(1, 0.55 + difficulty));
        s.beatPulse = 1; s.beatIndex += 1; s.nextBeatAt += BEAT_SEC;
      }

      const w = s.width, h = s.height;
      s.visualX = laneCenterX(s.playerLane, 0, w, h, s.curveOffset);
      s.bank = 0;

      for (const ob of s.obstacles) ob.z -= dt * speed;
      for (const ob of s.obstacles) ob.spawnT = Math.min(1, ob.spawnT + dt * 4);
      for (const sc of s.scenery) sc.z -= dt * speed;
      s.scenery = s.scenery.filter((o) => o.z > -0.25);

      const hitZone = 0.16, playerY = h * 0.85;
      for (const ob of s.obstacles) {
        if (ob.done) continue;
        if (ob.z <= hitZone) {
          ob.done = true;
          const px = laneCenterX(ob.lane, Math.min(ob.z, hitZone), w, h, s.curveOffset);
          if (ob.lane === s.playerLane) {
            if (ob.type === "note") {
              s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
              const gain = 120 * multiplier(s.combo); s.score += gain;
              s.sync = Math.min(100, s.sync + 16 + multiplier(s.combo));
              s.flash = 0.35;
              burst(px, playerY, ob.color || COLORS.cyan, 22, 5);
              pushText(px, playerY - 30, `+${gain}`, ob.color || COLORS.cyan, 20);
              synth.pickup(s.combo);
            } else if (ob.type === "powerup") {
              s.score += 200; s.sync = Math.min(100, s.sync + 10);
              if (ob.kind === "shield") { s.shield = Math.min(MAX_SHIELD, s.shield + 1); burst(px, playerY, COLORS.shield, 26, 5); pushText(px, playerY - 30, "BOUCLIER +1", COLORS.shield, 18); }
              else if (ob.kind === "boost") { s.boost = BOOST_DUR; burst(px, playerY, COLORS.boost, 30, 6); pushText(px, playerY - 30, "TURBO !", COLORS.boost, 22); }
              else { s.slow = SLOW_DUR; burst(px, playerY, COLORS.slow, 26, 5); pushText(px, playerY - 30, "RALENTI", COLORS.slow, 20); }
              synth.powerup();
            } else if (ob.type === "block") {
              if (s.surge > 0) {
                s.score += 180 * multiplier(s.combo); s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
                burst(px, playerY, COLORS.yellow, 30, 7); pushText(px, playerY - 30, "SURCHARGE", COLORS.yellow, 18); synth.dodge();
              } else if (s.invuln > 0) {
                burst(px, playerY, COLORS.fuchsia, 18, 4); pushText(px, playerY - 30, "INVINCIBLE", COLORS.cyan, 16);
              } else if (s.shield > 0) {
                s.shield -= 1; s.shieldFlash = 1; s.shake = 0.6;
                burst(px, playerY, COLORS.shield, 30, 6); pushText(px, playerY - 30, "BOUCLIER !", COLORS.shield, 20); synth.shieldHit();
              } else {
                const fs = Math.floor(s.score);
                if (fs > parseInt(localStorage.getItem('synthrider_best') || '0', 10)) {
                  localStorage.setItem('synthrider_best', String(fs));
                  setBestScore(fs);
                }
                s.shake = 1; burst(px, playerY, COLORS.fuchsia, 46, 8); synth.crash();
                s.state = "over"; setGameState("over");
                setFinalScore(fs); setFinalCombo(s.maxCombo); setFinalMeters(Math.floor(meters));
              }
            }
          } else {
            if (ob.type === "block") {
              const near = Math.abs(ob.lane - s.playerLane) <= 1;
              s.combo += 1; s.maxCombo = Math.max(s.maxCombo, s.combo);
              const gain = (near ? 90 : 30) * multiplier(s.combo); s.score += gain;
              s.sync = Math.min(100, s.sync + (near ? 14 : 6));
              if (near) { pushText(px, playerY - 30, "ESQUIVE !", COLORS.cyan, 18); synth.dodge(); }
            } else if (ob.type === "note") {
              s.combo = Math.max(0, s.combo - 2); pushText(px, playerY - 30, "RATÉ", COLORS.pink, 16);
            }
          }
        }
      }
      s.obstacles = s.obstacles.filter((o) => o.z > -0.4);

      // Trainée
      const shipY = h * 0.85;
      if (s.state === "playing") {
        const tc = s.boost > 0 ? COLORS.boost : COLORS.cyan;
        for (let i = 0; i < (s.boost > 0 ? 3 : 1); i++)
          s.particles.push({ x: s.visualX + (Math.random() - 0.5) * 8, y: shipY + 12 + Math.random() * 8, vx: (Math.random() - 0.5) * 0.6, vy: 1.5 + Math.random() * 2 + (s.boost > 0 ? 2 : 0), life: 18 + Math.random() * 12, maxLife: 30, color: tc, size: 2 + Math.random() * 2 });
      }
      for (const p of s.particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.vx *= 0.98; p.life -= 1; }
      if (s.particles.length > 380) s.particles.splice(0, s.particles.length - 380);
      s.particles = s.particles.filter((p) => p.life > 0);
      for (const t of s.texts) { t.y += t.vy; t.life -= 1; }
      s.texts = s.texts.filter((t) => t.life > 0);
      if (s.invuln > 0) s.invuln = Math.max(0, s.invuln - dt);
      s.shake *= 0.9; s.flash *= 0.86; s.shieldFlash *= 0.9;
    };

    // -------- RENDER --------
    const render = () => {
      const s = stateRef.current; const w = s.width, h = s.height, dpr = s.dpr;
      const horizonY = h * 0.42; const cxBase = w * 0.5;
      const curveOff = s.curveOffset;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const shx = (Math.random() - 0.5) * s.shake * 22, shy = (Math.random() - 0.5) * s.shake * 22;
      ctx.save(); ctx.translate(shx, shy);

      // Ciel
      const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
      sky.addColorStop(0, "#050015"); sky.addColorStop(0.45, "#1a0840"); sky.addColorStop(0.75, "#4a1278"); sky.addColorStop(1, "#ff4e8a");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, horizonY);

      // Lueur à l'horizon (coucher de soleil synthwave)
      const hg = ctx.createLinearGradient(0, horizonY * 0.55, 0, horizonY);
      hg.addColorStop(0, "rgba(255,90,170,0)");
      hg.addColorStop(1, "rgba(255,130,190,0.5)");
      ctx.fillStyle = hg; ctx.fillRect(0, horizonY * 0.55, w, horizonY * 0.45);

      for (const st of s.stars) { const tw = 0.45 + 0.55 * Math.sin(s.elapsed * 2 + st.tw); ctx.fillStyle = `rgba(255,255,255,${0.4 * tw + 0.1})`; ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill(); }

      const sunR = Math.min(w, h) * 0.17 * (1 + 0.04 * s.beatPulse + 0.015 * Math.sin(s.elapsed * 4));
      drawSun(cxBase, horizonY - sunR * 0.18, sunR);

      drawMountains(0.55, 1.55, 0.28, "#1a0a38", -h * 0.01, curveOff);
      drawMountains(0.95, 2.2, 0.4, "#2d0d5a", h * 0.015, curveOff * 1.3);

      // Sol + bas-côtés damier + route + rambodes + lignes + reflets
      const regionH = h + 6 - horizonY;
      const strips = 72;
      const SEG = 14;
      for (let i = 0; i < strips; i++) {
        const c0 = i / strips;
        const c1 = (i + 1) / strips;
        const z = 1 - Math.pow(1 - c0, 1 / 1.65);
        const sy = horizonY + regionH * c0;
        const sh = regionH * (c1 - c0) + 1;
        const twist = Math.pow(c0, 0.8);
        const cxR = cxBase + curveOff * twist;
        const roadHw = w * 0.5 * c0;
        const checker = Math.floor((1 - z) * SEG + s.gridScroll * SEG) % 2 === 0;

        // Bas-côtés (damier outrun)
        ctx.fillStyle = checker ? "#1b0238" : "#2c0a55";
        ctx.fillRect(0, sy, Math.max(0, cxR - roadHw), sh);
        ctx.fillRect(cxR + roadHw, sy, Math.max(0, w - (cxR + roadHw)), sh);

        // Surface de la route
        const rg = ctx.createLinearGradient(cxR - roadHw, 0, cxR + roadHw, 0);
        rg.addColorStop(0, "#0a0118"); rg.addColorStop(0.5, "#140328"); rg.addColorStop(1, "#0a0118");
        ctx.fillStyle = rg;
        ctx.fillRect(cxR - roadHw, sy, roadHw * 2, sh);

        // Reflet chaud du soleil au centre de la route
        ctx.fillStyle = hexA("#ffb347", 0.05 * c0);
        ctx.fillRect(cxR - roadHw * 0.45, sy, roadHw * 0.9, sh);

        // Rambodes néon (bords alternés magenta/cyan)
        const rum = Math.max(1.5, roadHw * 0.07);
        ctx.fillStyle = checker ? COLORS.fuchsia : COLORS.cyan;
        ctx.shadowColor = checker ? COLORS.fuchsia : COLORS.cyan;
        ctx.shadowBlur = 6 * c0;
        ctx.fillRect(cxR - roadHw, sy, rum, sh);
        ctx.fillRect(cxR + roadHw - rum, sy, rum, sh);
        ctx.shadowBlur = 0;

        // Pointillés centraux (au milieu de la voie centrale)
        if (checker) {
          const dw = Math.max(1.5, roadHw * 0.025);
          ctx.fillStyle = "rgba(255,255,255,0.45)";
          ctx.fillRect(cxR - dw / 2, sy, dw, sh);
        }
      }

      const fog = ctx.createLinearGradient(0, horizonY, 0, horizonY + regionH * 0.5);
      fog.addColorStop(0, hexA("#4a1278", 0.7)); fog.addColorStop(1, hexA("#4a1278", 0));
      ctx.fillStyle = fog; ctx.fillRect(0, horizonY, w, regionH * 0.5);

      // Grille néon courbée
      const p0Base = project(0, w, h, curveOff);
      const verts = [-0.87, -0.58, -0.29, 0, 0.29, 0.58, 0.87];
      ctx.save(); ctx.lineCap = "round";
      for (let i = 0; i < verts.length; i++) {
        const f = verts[i]; const outer = i === 0 || i === (LANE_COUNT + 1);
        ctx.strokeStyle = outer ? `rgba(34,242,255,${0.85 + 0.15 * s.beatPulse})` : "rgba(34,242,255,0.28)";
        ctx.shadowColor = COLORS.cyan; ctx.shadowBlur = outer ? 14 : 5; ctx.lineWidth = outer ? 2.4 : 1.0;
        const x0 = p0Base.cx + f * p0Base.halfWidth;
        const p1 = project(1, w, h, curveOff);
        ctx.beginPath(); ctx.moveTo(p1.cx + f * p1.halfWidth, p1.horizonY);
        ctx.lineTo(x0, p0Base.screenY + 6); ctx.stroke();
      }
      const hcount = 26;
      ctx.shadowColor = COLORS.fuchsia;
      for (let i = 0; i < hcount; i++) {
        const t = (i + s.gridScroll) / hcount; const z = 1 - t;
        const proj = project(z, w, h, curveOff);
        const alpha = Math.pow(t, 1.25) * (0.16 + 0.12 * s.beatPulse);
        ctx.strokeStyle = `rgba(255,43,214,${alpha})`; ctx.lineWidth = 0.6 + t * 0.9;
        ctx.beginPath(); ctx.moveTo(proj.cx - proj.halfWidth, proj.screenY); ctx.lineTo(proj.cx + proj.halfWidth, proj.screenY); ctx.stroke();
      }
      ctx.restore();

      // Aide visuelle voie dangereuse
      for (const ob of s.obstacles) {
        if (ob.type !== "block" || ob.z < 0.18 || ob.z > 0.94) continue;
        const za = Math.max(0, ob.z - 0.1), zb = Math.min(1, ob.z + 0.08);
        const pa = project(za, w, h, curveOff), pb = project(zb, w, h, curveOff);
        const ca = laneCenterX(ob.lane, za, w, h, curveOff), cb = laneCenterX(ob.lane, zb, w, h, curveOff);
        const wa = ((pa.halfWidth * 2) / LANE_COUNT) * 0.52, wb = ((pb.halfWidth * 2) / LANE_COUNT) * 0.52;
        const intensity = Math.max(0, Math.min(1, (0.94 - ob.z) / 0.7));
        ctx.save(); ctx.globalAlpha = 0.12 + intensity * 0.18;
        ctx.fillStyle = COLORS.fuchsia; ctx.shadowColor = COLORS.fuchsia; ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.moveTo(cb - wb, pb.screenY); ctx.lineTo(cb + wb, pb.screenY); ctx.lineTo(ca + wa, pa.screenY); ctx.lineTo(ca - wa, pa.screenY); ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      // Scenery
      const sortedSc = [...s.scenery].sort((a, b) => b.z - a.z);
      for (const sc of sortedSc) {
        if (sc.z < -0.1 || sc.z > 1.1) continue;
        const proj = project(Math.max(0, sc.z), w, h, curveOff);
        const edgeX = proj.cx + sc.side * proj.halfWidth * 1.35;
        const size = Math.max(6, Math.min(w, h) * 0.22 * proj.scale);
        const alpha = Math.min(1, proj.scale * 2.2);
        if (sc.type === "palm") drawPalm(edgeX, proj.screenY, size, alpha);
        else if (sc.type === "column") drawColumn(edgeX, proj.screenY, size, alpha);
        else if (sc.type === "beacon") drawBeacon(edgeX, proj.screenY, size, alpha, s.elapsed, sc.side);
        else drawPyramid(edgeX, proj.screenY, size, alpha);
      }

      // Obstacles
      const sortedOb = [...s.obstacles].sort((a, b) => b.z - a.z);
      for (const ob of sortedOb) {
        if (ob.z < -0.12 || ob.z > 1.1) continue;
        const zc = Math.max(0, ob.z);
        const proj = project(zc, w, h, curveOff);
        const laneW = (proj.halfWidth * 2) / LANE_COUNT;
        const ox = laneCenterX(ob.lane, zc, w, h, curveOff);
        const oy = proj.screenY + Math.sin(s.elapsed * 4 + ob.z * 10) * proj.scale * 4;
        const grow = Math.min(1, ob.spawnT);
        ctx.save(); ctx.globalAlpha = Math.min(1, Math.max(0.45, (1 - zc) * 3));
        if (ob.type === "block") { const bw = Math.max(8, laneW * 0.88 * grow); const bh = Math.max(6, laneW * 0.38 * grow); drawBarrier(ox, oy, bw, bh, proj.scale); }
        else if (ob.type === "note") drawGem(ox, oy, Math.max(6, laneW * 0.36 * grow), ob.color || COLORS.cyan, s.elapsed);
        else if (ob.kind) drawPowerup(ox, oy, Math.max(6, laneW * 0.36 * grow), ob.kind, s.elapsed);
        ctx.restore();
      }

      // Particules
      for (const p of s.particles) { const a = Math.max(0, p.life / p.maxLife); ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a + 0.5, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }

      // Vaisseau
      if (s.state !== "over") {
        const sy = h * 0.85; const sx = s.state === "ready" ? cxBase : s.visualX;
        const size = Math.min(w, h) * 0.07;

        if (s.surge > 0) {
          ctx.save(); const a = 0.35 + 0.2 * Math.sin(s.elapsed * 18); ctx.globalAlpha = a;
          ctx.strokeStyle = COLORS.yellow; ctx.shadowColor = COLORS.yellow; ctx.shadowBlur = 28; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(sx, sy, size * 2.2, size * 1.9, s.elapsed * 0.8, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        if (s.shield > 0) {
          ctx.save(); ctx.globalAlpha = 0.5 + 0.3 * Math.sin(s.elapsed * 8) + s.shieldFlash * 0.4;
          ctx.strokeStyle = COLORS.shield; ctx.shadowColor = COLORS.shield; ctx.shadowBlur = 18; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.ellipse(sx, sy, size * 1.7, size * 1.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        drawShip(sx, sy, size, s.bank, Math.max(s.boost, s.surge), s.elapsed);
      }

      // Lignes turbo
      if (s.boost > 0) { const intensity = s.boost / BOOST_DUR; ctx.save(); ctx.strokeStyle = hexA("#ffffff", 0.4 * intensity); ctx.shadowColor = COLORS.boost; ctx.shadowBlur = 8; ctx.lineWidth = 2; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cxBase + Math.cos(a) * h * 0.16, horizonY + Math.sin(a) * h * 0.16); ctx.lineTo(cxBase + Math.cos(a) * h * 0.6, horizonY + Math.sin(a) * h * 0.6); ctx.stroke(); } ctx.restore(); }
      if (s.slow > 0) { ctx.save(); ctx.globalAlpha = 0.14 * (s.slow / SLOW_DUR); ctx.fillStyle = "#3a7bff"; ctx.fillRect(0, 0, w, h); ctx.restore(); }

      // Textes flottants
      for (const t of s.texts) { const a = Math.min(1, t.life / 30); ctx.save(); ctx.globalAlpha = a; ctx.font = `bold ${t.size}px "Courier New", monospace`; ctx.textAlign = "center"; ctx.fillStyle = t.color; ctx.shadowColor = t.color; ctx.shadowBlur = 12; ctx.fillText(t.text, t.x, t.y); ctx.restore(); }

      if (s.flash > 0.01) { ctx.save(); ctx.globalAlpha = s.flash; ctx.fillStyle = "#fff"; ctx.fillRect(-40, -40, w + 80, h + 80); ctx.restore(); }

      ctx.restore();
    };

    let raf = 0;
    const loop = (t: number) => { const s = stateRef.current; if (!s.lastTime) s.lastTime = t; const dt = Math.min(0.05, (t - s.lastTime) / 1000); s.lastTime = t; update(dt); render(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const level = 1 + Math.floor(hud.meters / 350);
  const uiImages = uiImagesRef.current;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none">
      <canvas ref={canvasRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-0 z-10" style={{ background: "repeating-linear-gradient(to bottom, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 2px, transparent 3px)", mixBlendMode: "multiply", opacity: 0.5 }} />
      <div className="pointer-events-none absolute inset-0 z-10" style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />

      {/* Top buttons */}
      <button onClick={() => { setMuted((m) => { const nm = !m; synth.init(); synth.setMuted(nm); return nm; }); }} className="absolute top-3 right-3 z-30 w-10 h-10 rounded-full border border-cyan-400/50 bg-black/40 backdrop-blur text-cyan-200 text-lg flex items-center justify-center hover:bg-cyan-400/20" aria-label="Couper le son">{muted ? "🔇" : "🔊"}</button>
      <button onClick={() => setHelpOpen(true)} className="absolute top-3 right-16 z-30 w-10 h-10 rounded-full border border-fuchsia-400/50 bg-black/40 backdrop-blur text-fuchsia-100 text-lg font-bold flex items-center justify-center hover:bg-fuchsia-400/20" aria-label="Afficher les règles">?</button>

      {/* HUD */}
      {gameState === "playing" && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col font-mono">
          <div className="flex justify-between items-start p-3 sm:p-5">
            <div>
              <div className="text-[10px] sm:text-xs tracking-[0.3em] text-cyan-300/80">SCORE</div>
              <div className="text-2xl sm:text-4xl font-bold text-white tabular-nums" style={{ textShadow: "0 0 12px #22f2ff" }}>{hud.score.toString().padStart(6, "0")}</div>
              <div className="mt-1 text-[10px] sm:text-xs tracking-widest text-fuchsia-300/70">DISTANCE {hud.meters}/{FINISH_METERS} m · NIVEAU {level}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] sm:text-xs tracking-[0.3em] text-fuchsia-300/80">COMBO</div>
              <div className="flex items-baseline justify-end gap-2">
                <span className="text-2xl sm:text-4xl font-bold text-fuchsia-300 tabular-nums" style={{ textShadow: "0 0 12px #ff2bd6" }}>×{hud.combo}</span>
                <span className="text-lg sm:text-2xl font-black text-yellow-300" style={{ textShadow: "0 0 10px #ffe43a" }}>{hud.mult}x</span>
              </div>
              <div className="mt-1 flex justify-end gap-1">
                {Array.from({ length: MAX_SHIELD }).map((_, i) => (<span key={i} className="text-sm sm:text-base" style={{ opacity: i < hud.shield ? 1 : 0.25, filter: i < hud.shield ? "drop-shadow(0 0 6px #3affd0)" : "none" }}>🛡️</span>))}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <PowerBar label={hud.sync >= 100 ? "SURCHARGE PRÊTE [ESPACE]" : "SYNCHRO"} value={hud.sync / 100} color={hud.sync >= 100 ? COLORS.yellow : COLORS.cyan} />
            {hud.sync < 100 && hud.sync > 0 && <span className="text-[8px] tracking-wider text-white/30 -mt-0.5">gemmes &amp; esquives remplissent la jauge</span>}
            {hud.surge > 0 && <PowerBar label="SURCHARGE" value={hud.surge / SURGE_DUR} color={COLORS.yellow} />}
            {hud.boost > 0 && <PowerBar label="TURBO" value={hud.boost / BOOST_DUR} color={COLORS.boost} />}
            {hud.slow > 0 && <PowerBar label="RALENTI" value={hud.slow / SLOW_DUR} color={COLORS.slow} />}
          </div>

          <div className="flex-1" />

          {/* Contrôles tactiles : swipe + 2 boutons relatifs + surcharge */}
          <div className="flex items-center justify-between gap-3 px-3 sm:px-6 pb-4 sm:pb-6 pointer-events-auto">
            <HoldBtn label="◀" onDown={() => startRepeat(-1)} onUp={stopRepeat} tone="cyan" />
            <div className="text-[10px] tracking-widest text-white/40 text-center leading-tight">
              <div className="text-white/60">⟸ swipe ⟹</div>
              <div>pour bouger</div>
            </div>
            <button
              onClick={() => { const s = stateRef.current; if (s.state === "playing" && s.sync >= 100) { s.sync = 0; s.surge = SURGE_DUR; s.flash = 0.25; synth.surge(); } }}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border-2 border-yellow-400/70 bg-yellow-500/10 text-yellow-200 text-2xl active:bg-yellow-400/30 backdrop-blur flex items-center justify-center"
              aria-label="Surcharge"
            >
              ⚡
            </button>
            <HoldBtn label="▶" onDown={() => startRepeat(1)} onUp={stopRepeat} tone="cyan" />
          </div>
        </div>
      )}

      {/* Couche swipe plein écran (sous le HUD, capture les gestes) */}
      {gameState === "playing" && (
        <div
          className="absolute inset-0 z-[15] touch-none"
          onTouchStart={onSwipeStart}
          onTouchEnd={onSwipeEnd}
        />
      )}

      {/* Écran titre */}
      {gameState === "ready" && (
        <ScreenPanel>
          <HeroImage src={uiImages.hero?.src} />
          <div className="relative z-10">
            <div className="mb-2 text-[10px] sm:text-sm tracking-[0.5em] text-cyan-300/80">BIENVENUE SUR</div>
            <h1 className="text-5xl sm:text-7xl md:text-8xl font-black tracking-wider mb-4 leading-none" style={{ background: "linear-gradient(180deg, #fff 0%, #22f2ff 45%, #ff2bd6 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", filter: "drop-shadow(0 0 22px #ff2bd6)" }}>SYNTH<br />RIDER</h1>
            <p className="max-w-md text-xs sm:text-sm text-white/80 mb-5 leading-relaxed text-center">
              Course rythmique rétro-futuriste à <b className="text-fuchsia-300">120 BPM</b>.
              <br />
              <b>5 voies</b> sur une piste courbe à traverser jusqu'à <b className="text-yellow-300">{FINISH_METERS} m</b>.
            </p>
            {bestScore > 0 && (
              <div className="mb-4 text-[11px] sm:text-xs tracking-wider text-yellow-300/70">
                🏆 RECORD : <span className="font-bold text-yellow-200">{bestScore.toString().padStart(6, '0')}</span>
              </div>
            )}
            <div className="flex flex-col gap-1.5 items-center mb-6 text-[11px] sm:text-xs text-white/70">
              <div>⌨️ Flèches <span className="text-cyan-300">◀ ▶</span> · <span className="text-fuchsia-300">H</span> = règles · <span className="text-fuchsia-300">P</span> = pause · <span className="text-fuchsia-300">M</span> = son</div>
              <div>📱 Glisse <span className="text-cyan-300">(swipe ◀ ▶)</span> ou boutons en bas · <span className="text-fuchsia-300">Espace</span> = Surcharge</div>
            </div>
            <button onClick={startGame} className="px-10 py-3.5 text-base sm:text-xl font-bold tracking-widest border-2 border-cyan-300 text-cyan-100 bg-cyan-500/10 hover:bg-cyan-400/30 transition-all rounded-sm" style={{ boxShadow: "0 0 30px rgba(34,242,255,0.5), inset 0 0 20px rgba(34,242,255,0.15)" }}>▶ DÉMARRER</button>
            <button onClick={() => setHelpOpen(true)} className="mt-3 px-6 py-2 text-xs sm:text-sm font-bold tracking-widest border border-white/30 text-white/80 bg-white/5 hover:bg-white/15 transition-all rounded-sm">RÈGLES ET CONTRÔLES</button>
            <div className="mt-8 text-[10px] tracking-widest text-white/40">par Hylst — Geoff · avec l'aide d'une IA</div>
          </div>
        </ScreenPanel>
      )}

      {/* Pause */}
      {gameState === "paused" && (
        <ScreenPanel>
          <HeroImage src={uiImages.pause?.src} />
          <div className="relative z-10 max-w-lg w-full">
            <h2 className="text-4xl sm:text-6xl font-black mb-6 tracking-widest text-cyan-200" style={{ textShadow: "0 0 24px #22f2ff" }}>PAUSE</h2>
            <button onClick={togglePause} className="px-10 py-3.5 text-base sm:text-xl font-bold tracking-widest border-2 border-cyan-300 text-cyan-100 bg-cyan-500/10 hover:bg-cyan-400/30 transition-all rounded-sm mb-6" style={{ boxShadow: "0 0 30px rgba(34,242,255,0.5)" }}>▶ REPRENDRE</button>
            <div className="border border-fuchsia-400/30 bg-black/30 p-4 text-left text-xs sm:text-sm text-white/80">
              <h3 className="font-bold text-fuchsia-300 mb-2 tracking-widest">RÈGLES</h3>
              <ul className="list-disc pl-4 space-y-1.5">
                <li>Objectif : <b className="text-yellow-300">atteindre {FINISH_METERS} m</b> sans toucher de barrière.</li>
                <li><b className="text-fuchsia-300">Barrières magenta</b> : à éviter absolument (sauf si bouclier ou Surcharge).</li>
                <li><b className="text-cyan-300">Gemmes cyan</b> et <b className="text-yellow-300">jaunes</b> : à collecter → score, combo, Synchro.</li>
                <li><b className="text-emerald-300">Bouclier</b> 🛡️ : absorbe un choc.</li>
                <li><b className="text-yellow-300">Turbo</b> ⚡ : ×2 score, vitesse augmentée.</li>
                <li><b className="text-blue-300">Ralenti</b> ❄ : vitesse réduite.</li>
                <li>Jauge <b className="text-cyan-300">Synchro</b> : se remplit via gemmes et esquives. Pleine = <b className="text-yellow-300">Surcharge</b> (Espace) qui traverse les barrières !</li>
                <li>Les gemmes ratées font <b className="text-pink-400">perdre du combo</b>.</li>
              </ul>
              <h3 className="font-bold text-cyan-300 mt-4 mb-2 tracking-widest">CONTRÔLES</h3>
              <ul className="list-disc pl-4 space-y-1.5">
                <li>⌨️ Flèches ◀ ▶ ou A/D : changer de voie</li>
                <li>Espace : activer la Surcharge</li>
                <li>P/Échap : pause · M : son · H : règles</li>
                <li>📱 Glisse (swipe ◀ ▶) ou boutons ◀ ▶ en bas</li>
              </ul>
            </div>
          </div>
        </ScreenPanel>
      )}

      {/* Game Over */}
      {gameState === "over" && (
        <ScreenPanel>
          <HeroImage src={uiImages.crash?.src} />
          <div className="relative z-10">
            <h2 className="text-5xl sm:text-7xl font-black mb-6 tracking-widest" style={{ color: COLORS.fuchsia, textShadow: "0 0 30px #ff2bd6, 0 0 60px #ff2bd6" }}>CRASH</h2>
            <div className="mb-3 grid grid-cols-3 gap-4 sm:gap-8 text-center">
              <Stat label="SCORE" value={finalScore.toString()} color={COLORS.cyan} />
              <Stat label="COMBO MAX" value={`×${finalCombo}`} color={COLORS.fuchsia} />
              <Stat label="DISTANCE" value={`${finalMeters}m`} color={COLORS.yellow} />
            </div>
            {bestScore > 0 && (
              <div className="mb-5 text-[11px] sm:text-xs tracking-wider text-center">
                <span className="text-yellow-300/60">🏆 Record : </span>
                <span className="font-bold text-yellow-200">{bestScore.toString().padStart(6, '0')}</span>
                {finalScore >= bestScore && <span className="ml-2 text-emerald-400">NOUVEAU RECORD !</span>}
              </div>
            )}
            <button onClick={startGame} className="px-10 py-3.5 text-base sm:text-xl font-bold tracking-widest border-2 border-fuchsia-300 text-fuchsia-100 bg-fuchsia-500/10 hover:bg-fuchsia-400/30 transition-all rounded-sm" style={{ boxShadow: "0 0 30px rgba(255,43,214,0.5)" }}>↻ REJOUER</button>
            <div className="mt-8 text-[10px] tracking-widest text-white/40">par Hylst — Geoff · avec l'aide d'une IA</div>
          </div>
        </ScreenPanel>
      )}

      {/* Victory */}
      {gameState === "victory" && (
        <ScreenPanel>
          <HeroImage src={uiImages.hero?.src} />
          <div className="relative z-10">
            <h2 className="text-4xl sm:text-6xl font-black mb-6 tracking-widest text-yellow-200" style={{ textShadow: "0 0 30px #ffe43a, 0 0 60px #ff2bd6" }}>PARCOURS TERMINÉ</h2>
            <div className="mb-3 grid grid-cols-3 gap-4 sm:gap-8 text-center">
              <Stat label="SCORE" value={finalScore.toString()} color={COLORS.cyan} />
              <Stat label="COMBO MAX" value={`×${finalCombo}`} color={COLORS.fuchsia} />
              <Stat label="DISTANCE" value={`${finalMeters}m`} color={COLORS.yellow} />
            </div>
            {bestScore > 0 && (
              <div className="mb-5 text-[11px] sm:text-xs tracking-wider text-center">
                <span className="text-yellow-300/60">🏆 Record : </span>
                <span className="font-bold text-yellow-200">{bestScore.toString().padStart(6, '0')}</span>
              </div>
            )}
            {(!bestScore || finalScore >= bestScore) && (
              <div className="mb-5 text-[13px] font-bold text-yellow-300 animate-pulse">NOUVEAU RECORD !</div>
            )}
            <button onClick={startGame} className="px-10 py-3.5 text-base sm:text-xl font-bold tracking-widest border-2 border-yellow-300 text-yellow-100 bg-yellow-500/10 hover:bg-yellow-400/30 transition-all rounded-sm" style={{ boxShadow: "0 0 30px rgba(255,228,58,0.5)" }}>↻ RELANCER</button>
            <div className="mt-8 text-[10px] tracking-widest text-white/40">par Hylst — Geoff · avec l'aide d'une IA</div>
          </div>
        </ScreenPanel>
      )}

      {/* Modal infos */}
      {helpOpen && <InfoModal onClose={() => setHelpOpen(false)} />}

      {/* Onboarding */}
      {gameState === "playing" && onboardStep < 4 && (
        <div className="absolute inset-0 z-40 pointer-events-none flex items-end justify-center pb-44 sm:pb-52">
          <div className="bg-black/80 border border-cyan-400/60 px-4 py-2 sm:px-6 sm:py-3 text-white font-mono text-xs sm:text-sm text-center animate-pulse" style={{ boxShadow: "0 0 20px rgba(34,242,255,0.4)" }}>
            {onboardStep <= 0 && "Utilise ◀ ▶ pour te déplacer entre les 5 voies !"}
            {onboardStep === 1 && <><b className="text-cyan-300">Gemmes brillantes</b> : collecte-les pour le score et le combo !</>}
            {onboardStep === 2 && <><b className="text-fuchsia-300">Barrières magenta</b> : change de voie pour les éviter !</>}
            {onboardStep === 3 && "Remplis la jauge Synchro → Espace = Surcharge !"}
          </div>
        </div>
      )}
    </div>
  );
}

function ScreenPanel({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 text-center bg-black/45 backdrop-blur-sm">{children}</div>;
}
function HeroImage({ src }: { src?: string }) {
  return <div className="absolute inset-0 z-0 opacity-25" style={{ backgroundImage: src ? `url(${src})` : "linear-gradient(180deg,#1a0840,#ff4e8a)", backgroundSize: "cover", backgroundPosition: "center", filter: "saturate(1.2) contrast(1.1)" }} />;
}
function InfoModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-2xl border border-cyan-300/50 bg-[#080016]/95 p-5 sm:p-7 text-left font-mono text-white shadow-[0_0_40px_rgba(34,242,255,0.25)]" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-3 top-3 h-9 w-9 border border-white/20 text-white/80 hover:bg-white/10 text-lg">×</button>
        <h3 className="mb-3 pr-10 text-2xl sm:text-3xl font-black tracking-widest text-cyan-200" style={{ textShadow: "0 0 16px #22f2ff" }}>RÈGLES ET CONTRÔLES</h3>
        <p className="mb-4 text-sm text-white/70">Objectif : atteindre <b className="text-yellow-300">{FINISH_METERS} m</b> sans crash. <b>5 voies</b> sur une piste qui serpente.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="border border-cyan-400/25 bg-cyan-400/5 p-4">
            <h4 className="mb-2 font-bold tracking-widest text-cyan-200">CONTRÔLES</h4>
            <p className="text-sm text-white/75">Flèches ◀ ▶ ou A/D : changer de voie.</p>
            <p className="mt-2 text-sm text-white/75">Mobile : glisse (swipe ◀ ▶) ou boutons ◀ ▶ en bas.</p>
            <p className="mt-2 text-sm text-white/75">Espace : Surcharge (quand Synchro = 100%).</p>
            <p className="mt-2 text-sm text-white/75">P ou Échap : pause. H : règles. M : son.</p>
          </div>
          <div className="border border-fuchsia-400/25 bg-fuchsia-400/5 p-4">
            <h4 className="mb-2 font-bold tracking-widest text-fuchsia-200">ENTITÉS</h4>
            <p className="text-sm text-white/75"><span className="text-fuchsia-300">█ Barrière</span> : à éviter. Bouclier ou Surcharge la détruit.</p>
            <p className="mt-2 text-sm text-white/75"><span className="text-cyan-300">◆ Gemme</span> : score + combo + Synchro.</p>
            <p className="mt-2 text-sm text-white/75"><span className="text-emerald-300">⬡ Bouclier</span> : absorbe un choc.</p>
            <p className="mt-2 text-sm text-white/75"><span className="text-yellow-300">⚡ Turbo</span> : ×2 score. <span className="text-blue-300">❄ Ralenti</span> : vitesse -40%.</p>
            <p className="mt-2 text-sm text-white/75">Passes serrées = <span className="text-cyan-300">ESQUIVE !</span> (+score, +Synchro).</p>
            <p className="mt-2 text-sm text-pink-400">Gemme ratée = -2 combo.</p>
          </div>
        </div>
        <div className="mt-4 border border-yellow-300/25 bg-yellow-300/5 p-4 text-sm text-yellow-100/85">Astuce : débute lentement, accélère progressivement. Garde la Surcharge pour les passages difficiles.</div>
      </div>
    </div>
  );
}
function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return <div><div className="text-[9px] sm:text-xs tracking-[0.25em] text-white/50 mb-1">{label}</div><div className="text-xl sm:text-3xl font-bold tabular-nums" style={{ color, textShadow: `0 0 12px ${color}` }}>{value}</div></div>;
}
function PowerBar({ label, value, color }: { label: string; value: number; color: string }) {
  return <div className="flex items-center gap-2"><span className="text-[10px] tracking-widest font-bold" style={{ color, textShadow: `0 0 8px ${color}` }}>{label}</span><div className="w-28 sm:w-40 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color, boxShadow: `0 0 10px ${color}` }} /></div></div>;
}
function HoldBtn({ label, onDown, onUp, tone }: { label: string; onDown: () => void; onUp: () => void; tone: "cyan" | "fuchsia" }) {
  const color = tone === "cyan"
    ? "border-cyan-400/60 bg-cyan-500/10 text-cyan-300 active:bg-cyan-400/40"
    : "border-fuchsia-400/60 bg-fuchsia-500/10 text-fuchsia-300 active:bg-fuchsia-400/40";
  const press = (e: React.PointerEvent) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); onDown(); };
  const release = (e: React.PointerEvent) => { e.preventDefault(); onUp(); };
  return (
    <button
      onPointerDown={press}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
      className={`${color} w-16 h-16 sm:w-20 sm:h-20 rounded-2xl border-2 backdrop-blur flex items-center justify-center transition-colors text-2xl sm:text-3xl touch-none`}
      aria-label={`Voie ${label.trim()}`}
    >
      {label}
    </button>
  );
}
