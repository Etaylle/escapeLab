// Frozen copy of src/rules.js at commit 49dc727: the oracle for the Classic rules.
// Pure simulation: no browser, drawing, audio, wall clock or storage dependencies.
export const WIDTH = 800,
  HEIGHT = 680,
  DEFENSE = 592;
export const DIFFICULTIES = Object.freeze({
  Easy: { march: 0.86, fire: 1.7, bullet: 160 },
  Normal: { march: 0.66, fire: 1.15, bullet: 200 },
  Hard: { march: 0.47, fire: 0.8, bullet: 240 },
});
export const BONUS = [
  100, 50, 50, 100, 150, 100, 100, 50, 300, 100, 100, 100, 50, 150, 100,
];
export const rowScore = (row) => (row === 0 ? 30 : row < 3 ? 20 : 10);
export const saucerBonus = (shots) =>
  BONUS[(((shots - 1) % BONUS.length) + BONUS.length) % BONUS.length];
export function shelters() {
  return [106, 276, 446, 616].map((x) => ({
    x,
    y: 492,
    w: 22,
    h: 14,
    cell: 3,
    pixels: Array.from({ length: 308 }, (_, i) => {
      const px = i % 22,
        py = Math.floor(i / 22);
      return (
        !(py < 3 && (px < 3 - py || px > 18 + py)) &&
        !(py > 7 && px > 6 && px < 15)
      );
    }),
  }));
}
export function formation(wave = 1) {
  return Array.from({ length: 55 }, (_, i) => ({
    id: i,
    col: i % 11,
    row: Math.floor(i / 11),
    x: 92 + (i % 11) * 54,
    y: 128 + Math.floor(i / 11) * 49 + Math.min(wave - 1, 6) * 12,
    alive: true,
  }));
}
export function player() {
  return {
    x: 400,
    lives: 3,
    score: 0,
    wave: 1,
    extra: false,
    dead: false,
    ducks: formation(),
    shelters: shelters(),
    direction: 1,
    march: 0,
    fire: 0,
    saucerTimer: 14,
    saucer: null,
    shots: [],
    shotCount: 0,
    attack: 0,
    invincible: 1.5,
    recoil: 0,
  };
}
export function createGame(difficulty = "Normal", count = 1) {
  if (!DIFFICULTIES[difficulty]) throw new Error("Unknown difficulty");
  return {
    difficulty,
    players: Array.from({ length: count === 2 ? 2 : 1 }, player),
    active: 0,
    state: "playing",
    previous: null,
    timer: 0,
    time: 0,
    events: [],
    effects: [],
    reason: "",
    random: Math.random,
  };
}
export const current = (g) => g.players[g.active];
export function emit(g, type, x = 0, y = 0, value = 0) {
  g.events.push({ type, x, y, value });
}
export function award(g, points) {
  const p = current(g);
  p.score += points;
  if (!p.extra && p.score >= 1500) {
    p.extra = true;
    p.lives++;
    emit(g, "extra", p.x, 615);
  }
}
export function pause(g) {
  if (["playing", "death", "wave-clear", "turn-change"].includes(g.state)) {
    g.previous = g.state;
    g.state = "paused";
  }
}
export function resume(g) {
  if (g.state === "paused") {
    g.state = g.previous;
    g.previous = null;
  }
}
export function marchInterval(g) {
  const p = current(g),
    alive = p.ducks.filter((d) => d.alive).length;
  return Math.max(
    0.045,
    (DIFFICULTIES[g.difficulty].march * (0.12 + (0.88 * alive) / 55)) /
      (1 + Math.min(p.wave - 1, 12) * 0.075),
  );
}
export function exposed(p) {
  const columns = new Map();
  for (const d of p.ducks)
    if (d.alive && (!columns.has(d.col) || columns.get(d.col).y < d.y))
      columns.set(d.col, d);
  return [...columns.values()];
}
export function enemyFire(g) {
  const p = current(g),
    eligible = exposed(p);
  if (!eligible.length || p.shots.filter((s) => s.owner === "duck").length >= 3)
    return;
  const kind = p.attack++ % 3;
  const d =
    kind === 0
      ? eligible.reduce((a, b) =>
          Math.abs(a.x - p.x) < Math.abs(b.x - p.x) ? a : b,
        )
      : eligible[(p.attack * 7) % eligible.length];
  p.shots.push({
    x: d.x,
    y: d.y + 16,
    owner: "duck",
    kind,
    vx: kind === 0 ? Math.max(-55, Math.min(55, (p.x - d.x) * 0.2)) : 0,
    vy: DIFFICULTIES[g.difficulty].bullet + Math.min(p.wave - 1, 10) * 8,
  });
}
export function shelterHit(p, x, y, erode = true) {
  for (const s of p.shelters) {
    const cx = Math.floor((x - s.x) / s.cell),
      cy = Math.floor((y - s.y) / s.cell);
    if (cx < 0 || cx >= s.w || cy < 0 || cy >= s.h || !s.pixels[cy * s.w + cx])
      continue;
    if (erode) {
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = cx + dx,
            yy = cy + dy;
          if (
            xx >= 0 &&
            xx < s.w &&
            yy >= 0 &&
            yy < s.h &&
            dx * dx + dy * dy <= 5
          )
            s.pixels[yy * s.w + xx] = false;
        }
    }
    return true;
  }
  return false;
}
export function hitPlayer(g, invasion = false) {
  if (g.state !== "playing") return;
  const p = current(g);
  if (!invasion && p.invincible > 0) return;
  p.lives = invasion ? 0 : p.lives - 1;
  p.dead = p.lives <= 0;
  p.shots = [];
  g.state = "death";
  g.timer = 1.25;
  g.reason = invasion
    ? "The flock crossed the defense line."
    : "The flock got through.";
  emit(g, "death", p.x, 615);
}
export function finishTurn(g) {
  const p = current(g);
  const next = g.players.findIndex((q, i) => i !== g.active && !q.dead);
  if (next >= 0) {
    g.active = next;
    g.state = "turn-change";
    g.timer = 0;
    current(g).shots = [];
    current(g).invincible = 2;
  } else if (p.dead) {
    g.state = "game-over";
  } else {
    p.x = 400;
    p.invincible = 2;
    g.state = "playing";
  }
}
export function nextWave(g) {
  const p = current(g);
  p.wave++;
  p.ducks = formation(p.wave);
  p.shelters = shelters();
  p.direction = 1;
  p.march = 0;
  p.fire = 0;
  p.saucer = null;
  p.saucerTimer = 14;
  p.invincible = 2;
  p.x = 400;
  g.state = "playing";
}
export function step(g, input, dt) {
  if (!["playing", "death", "wave-clear"].includes(g.state)) return;
  g.time += dt;
  const p = current(g);
  g.effects = g.effects.filter((e) => (e.life -= dt) > 0);
  if (g.state === "death" || g.state === "wave-clear") {
    g.timer -= dt;
    if (g.timer <= 0) {
      if (g.state === "death") finishTurn(g);
      else nextWave(g);
    }
    return;
  }
  p.invincible = Math.max(0, p.invincible - dt);
  p.recoil = Math.max(0, p.recoil - dt);
  p.x = Math.max(
    28,
    Math.min(
      WIDTH - 28,
      p.x + ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * 300 * dt,
    ),
  );
  if (input.fire && !p.shots.some((s) => s.owner === "ferret")) {
    p.shots.push({ x: p.x, y: 596, owner: "ferret", vx: 0, vy: -540 });
    p.shotCount++;
    p.recoil = 0.13;
    emit(g, "shoot", p.x, 598);
  }
  p.march += dt;
  if (p.march >= marchInterval(g)) {
    p.march = 0;
    const alive = p.ducks.filter((d) => d.alive);
    const edge = alive.some(
      (d) => d.x + p.direction * 12 < 28 || d.x + p.direction * 12 > WIDTH - 28,
    );
    for (const d of alive) {
      if (edge) d.y += 22;
      else d.x += p.direction * 12;
    }
    if (edge) p.direction *= -1;
    emit(g, "march");
  }
  for (const d of p.ducks.filter((d) => d.alive)) {
    if (d.y + 16 >= DEFENSE) {
      hitPlayer(g, true);
      return;
    }
    for (const s of p.shelters)
      if (d.y + 18 >= s.y && d.y - 18 <= s.y + s.h * s.cell)
        for (let i = 0; i < s.pixels.length; i++) {
          const x = s.x + (i % s.w) * s.cell,
            y = s.y + Math.floor(i / s.w) * s.cell;
          if (Math.abs(x - d.x) < 22 && Math.abs(y - d.y) < 18)
            s.pixels[i] = false;
        }
  }
  p.fire += dt;
  const fireDelay = Math.max(
    0.32,
    DIFFICULTIES[g.difficulty].fire / (1 + Math.min(p.wave - 1, 10) * 0.08),
  );
  if (p.fire >= fireDelay) {
    p.fire = 0;
    enemyFire(g);
  }
  p.saucerTimer -= dt;
  if (!p.saucer && p.saucerTimer <= 0) {
    const direction = g.random() < 0.5 ? 1 : -1;
    p.saucer = { x: direction === 1 ? -40 : WIDTH + 40, y: 72, direction };
    p.saucerTimer = 20;
    emit(g, "saucer");
  }
  if (p.saucer) {
    p.saucer.x += p.saucer.direction * 110 * dt;
    if (p.saucer.x < -60 || p.saucer.x > WIDTH + 60) p.saucer = null;
  }
  for (const s of p.shots) {
    if (s.dead) continue;
    const old = s.y;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    for (let y = old; s.vy > 0 ? y <= s.y : y >= s.y; y += s.vy > 0 ? 2 : -2) {
      if (shelterHit(p, s.x, y)) {
        s.dead = true;
        emit(g, "impact", s.x, y);
        break;
      }
    }
    if (s.dead) continue;
    if (s.owner === "ferret") {
      const d = p.ducks.find(
        (d) =>
          d.alive &&
          Math.abs(s.x - d.x) < 21 &&
          s.y >= d.y - 16 &&
          s.y <= d.y + 18,
      );
      if (d) {
        d.alive = false;
        s.dead = true;
        award(g, rowScore(d.row));
        emit(g, "explosion", d.x, d.y);
      } else if (
        p.saucer &&
        Math.abs(s.x - p.saucer.x) < 34 &&
        Math.abs(s.y - p.saucer.y) < 15
      ) {
        const bonus = saucerBonus(p.shotCount);
        award(g, bonus);
        emit(g, "bonus", p.saucer.x, p.saucer.y, bonus);
        p.saucer = null;
        s.dead = true;
      }
    } else if (Math.abs(s.x - p.x) < 24 && Math.abs(s.y - 617) < 18) {
      s.dead = true;
      hitPlayer(g);
      if (g.state !== "playing") return;
    }
    if (s.y < 0 || s.y > HEIGHT) s.dead = true;
  }
  for (const a of p.shots)
    for (const b of p.shots)
      if (
        !a.dead &&
        !b.dead &&
        a.owner !== b.owner &&
        Math.abs(a.x - b.x) < 7 &&
        Math.abs(a.y - b.y) < 12
      ) {
        a.dead = b.dead = true;
        emit(g, "impact", a.x, a.y);
      }
  p.shots = p.shots.filter((s) => !s.dead);
  if (p.ducks.every((d) => !d.alive)) {
    p.shots = [];
    g.state = "wave-clear";
    g.timer = 2;
    emit(g, "clear");
  }
}
