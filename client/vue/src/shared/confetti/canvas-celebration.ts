import canvasConfetti, { type Shape } from 'canvas-confetti';
import type { CelebrationKind } from '@workspace/core/contracts';

const maximumContinuousDurationMs = 2_400;
const zIndex = 9_999;

let customShapes: readonly Shape[] | undefined;

export function launchCanvasCelebration(kind: CelebrationKind, durationMs: number): void {
  if (kind === 'confetti') {
    launchRealisticBurst();
    return;
  }
  if (kind === 'stars') {
    launchStars();
    return;
  }
  if (kind === 'shapes') {
    launchShapes();
    return;
  }
  launchSchoolPride(Math.min(durationMs, maximumContinuousDurationMs));
}

function launchRealisticBurst(): void {
  const count = 140;
  const defaults = {
    disableForReducedMotion: true,
    origin: { y: 0.7 },
    zIndex,
  };
  const fire = (particleRatio: number, options: Record<string, number>): void => {
    canvasConfetti({
      ...defaults,
      ...options,
      particleCount: Math.floor(count * particleRatio),
    });
  };

  fire(0.25, { spread: 26, startVelocity: 55 });
  fire(0.2, { spread: 60 });
  fire(0.35, { decay: 0.91, scalar: 0.8, spread: 100 });
  fire(0.1, { decay: 0.92, scalar: 1.2, spread: 120, startVelocity: 25 });
  fire(0.1, { spread: 120, startVelocity: 45 });
}

function launchStars(): void {
  const defaults = {
    colors: ['#ffe400', '#ffbd00', '#e89400', '#ffca6c', '#fdffb8'],
    decay: 0.94,
    disableForReducedMotion: true,
    gravity: 0,
    spread: 360,
    startVelocity: 30,
    ticks: 50,
    zIndex,
  };
  const shoot = (): void => {
    canvasConfetti({ ...defaults, particleCount: 40, scalar: 1.2, shapes: ['star'] });
    canvasConfetti({ ...defaults, particleCount: 10, scalar: 0.75, shapes: ['circle'] });
  };

  globalThis.setTimeout(shoot, 0);
  globalThis.setTimeout(shoot, 100);
  globalThis.setTimeout(shoot, 200);
}

function launchShapes(): void {
  const [pumpkin, tree, heart] = getCustomShapes();
  const defaults = {
    disableForReducedMotion: true,
    origin: { y: -0.1 },
    particleCount: 30,
    scalar: 2,
    spread: 180,
    startVelocity: -35,
    zIndex,
  };

  canvasConfetti({ ...defaults, colors: ['#ff9a00', '#ff7400', '#ff4d00'], shapes: [pumpkin] });
  canvasConfetti({ ...defaults, colors: ['#8d960f', '#be0f10', '#445404'], shapes: [tree] });
  canvasConfetti({ ...defaults, colors: ['#f93963', '#a10864', '#ee0b93'], shapes: [heart] });
}

function launchSchoolPride(durationMs: number): void {
  const colors = ['#2457c5', '#ffffff'];
  const shoot = (): void => {
    canvasConfetti({
      angle: 60,
      colors,
      disableForReducedMotion: true,
      origin: { x: 0 },
      particleCount: 3,
      spread: 55,
      zIndex,
    });
    canvasConfetti({
      angle: 120,
      colors,
      disableForReducedMotion: true,
      origin: { x: 1 },
      particleCount: 3,
      spread: 55,
      zIndex,
    });
  };

  shoot();
  const interval = globalThis.setInterval(shoot, 65);
  globalThis.setTimeout(() => globalThis.clearInterval(interval), durationMs);
}

function getCustomShapes(): readonly [Shape, Shape, Shape] {
  if (!customShapes) {
    customShapes = [
      canvasConfetti.shapeFromPath({
        path: 'M449.4 142c-5 0-10 .3-15 1a183 183 0 0 0-66.9-19.1V87.5a17.5 17.5 0 1 0-35 0v36.4a183 183 0 0 0-67 19c-4.9-.6-9.9-1-14.8-1C170.3 142 105 219.6 105 315s65.3 173 145.7 173c5 0 10-.3 14.8-1a184.7 184.7 0 0 0 169 0c4.9.7 9.9 1 14.9 1 80.3 0 145.6-77.6 145.6-173s-65.3-173-145.7-173zm-220 138 27.4-40.4a11.6 11.6 0 0 1 16.4-2.7l54.7 40.3a11.3 11.3 0 0 1-7 20.3H239a11.3 11.3 0 0 1-9.6-17.5zM444 383.8l-43.7 17.5a17.7 17.7 0 0 1-13 0l-37.3-15-37.2 15a17.8 17.8 0 0 1-13 0L256 383.8a17.5 17.5 0 0 1 13-32.6l37.3 15 37.2-15c4.2-1.6 8.8-1.6 13 0l37.3 15 37.2-15a17.5 17.5 0 0 1 13 32.6zm17-86.3h-82a11.3 11.3 0 0 1-6.9-20.4l54.7-40.3a11.6 11.6 0 0 1 16.4 2.8l27.4 40.4a11.3 11.3 0 0 1-9.6 17.5z',
      }),
      canvasConfetti.shapeFromPath({
        path: 'M120 240c-41,14 -91,18 -120,1 29,-10 57,-22 81,-40 -18,2 -37,3 -55,-3 25,-14 48,-30 66,-51 -11,5 -26,8 -45,7 20,-14 40,-30 57,-49 -13,1 -26,2 -38,-1 18,-11 35,-25 51,-43 -13,3 -24,5 -35,6 21,-19 40,-41 53,-67 14,26 32,48 54,67 -11,-1 -23,-3 -35,-6 15,18 32,32 51,43 -13,3 -26,2 -38,1 17,19 36,35 56,49 -19,1 -33,-2 -45,-7 19,21 42,37 67,51 -19,6 -37,5 -56,3 25,18 53,30 82,40 -30,17 -79,13 -120,-1l0 41 -31 0 0 -41z',
      }),
      canvasConfetti.shapeFromPath({
        path: 'M167 72c19,-38 37,-56 75,-56 42,0 76,33 76,75 0,76 -76,151 -151,227 -76,-76 -151,-151 -151,-227 0,-42 33,-75 75,-75 38,0 57,18 76,56z',
      }),
    ];
  }
  return customShapes as readonly [Shape, Shape, Shape];
}
