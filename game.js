'use strict';
/* 《明日债 · Tomorrow's Debt》 v0.1.0
   核心玩法：向未来的自己借技能。每借一次，约 22 秒后生成一只「讨债影」，
   它会用你借过的那件技能来打你。最终 Boss 的技能组 = 你全程借过的技能集合。 */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener('resize', resize); resize();

/* ---------------- 工具 ---------------- */
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ---------------- 音效（合成，无外部文件） ---------------- */
let muted = false, audioCtx = null;
function beep(freq, dur, type, vol) {
  if (muted) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.value = vol || 0.04;
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* 无音频环境则静默 */ }
}

/* ---------------- 场景（三幕：题材各异，一条主线） ---------------- */
const SCENES = [
  {
    name: '第一幕 · 霓虹废城', theme: 'neon',
    top: '#131a3d', bottom: '#05060f', accent: '#39d5ff', enemy: '#ff5d7a',
    story: '时契行的送契人从不欠债——直到今夜。\n契主在废城撕走了《明日契》的一角，追兵已经围上来。\n你没有别的武器。契约最后一页写着：\n「可向未来的自己，预借力量。」',
    waves: [
      { chaser: 6, dart: 0, tank: 0, shooter: 0 },
      { chaser: 8, dart: 3, tank: 0, shooter: 0 },
      { chaser: 8, dart: 4, tank: 1, shooter: 0 }
    ]
  },
  {
    name: '第二幕 · 深海遗迹', theme: 'abyss',
    top: '#04263b', bottom: '#010a14', accent: '#4de3c2', enemy: '#7cc7ff',
    story: '契角沉进了海底遗迹。你潜下去时，石壁上刻着讨债人的名册。\n你凑近去看——名册第一行，是你的名字。\n原来债主从一开始，就是未来的你。',
    waves: [
      { chaser: 7, dart: 4, tank: 1, shooter: 1 },
      { chaser: 9, dart: 5, tank: 2, shooter: 2 },
      { chaser: 10, dart: 6, tank: 2, shooter: 3 }
    ]
  },
  {
    name: '第三幕 · 熔核天穹', theme: 'molten',
    top: '#33101e', bottom: '#0d0308', accent: '#ffb35d', enemy: '#ff8a5d',
    story: '天穹尽头，收契的人已经等了很久。\n他抬起头——是老了许多的你。\n「契，我收下。」他说，「现在，把借走的力量，一件一件还给我看。」',
    waves: [
      { chaser: 10, dart: 6, tank: 2, shooter: 3 },
      { chaser: 12, dart: 8, tank: 3, shooter: 4 },
      { boss: true }
    ]
  }
];

/* ---------------- 升级池 ---------------- */
const UPGRADES = [
  { name: '强攻契', desc: '子弹伤害 +25%', apply: p => { p.dmg *= 1.25; } },
  { name: '连射契', desc: '射速 +20%', apply: p => { p.fireRate *= 1.20; } },
  { name: '疾风契', desc: '移动速度 +13%', apply: p => { p.speed *= 1.13; } },
  { name: '扩命契', desc: '生命上限 +25，并回复 40', apply: p => { p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 40); } },
  { name: '穿透契', desc: '子弹可多穿透 1 个敌人', apply: p => { p.pierce += 1; } },
  { name: '暴烈契', desc: '暴击率 +12%（暴击 2 倍伤害）', apply: p => { p.crit += 0.12; } },
  { name: '磁石契', desc: '拾取范围 +70%', apply: p => { p.magnet *= 1.7; } },
  { name: '疾影契', desc: '冲刺冷却 -30%，冲刺后短暂加速', apply: p => { p.dashCdMax *= 0.7; p.dashBoost = true; } }
];

/* ---------------- 游戏状态 ---------------- */
const SKILL_CD = { nova: 7, blades: 12, chrono: 14 };
const SKILL_NAME = { nova: '星爆', blades: '环刃', chrono: '时缓' };
const DEBT_DELAY = 22; // 借债后多少秒讨债影到来

let state = 'menu'; // menu | chapter | playing | upgrade | paused | over | win
let endless = false;
let player, bullets, ebullets, enemies, shadows, parts, drops, debts;
let sceneIdx = 0, waveIdx = 0, spawnQueue = [], spawnTimer = 0, waveActive = false;
let score = 0, kills = 0, debtsTotal = 0, debtsRepaid = 0, runTime = 0;
let borrowedSet = new Set(), borrowedHistory = [];
let slowTimer = 0, shake = 0, bossRef = null;
let keys = {}, mouseDown = false;
let joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };

function newPlayer() {
  return {
    x: W / 2, y: H / 2, r: 14, hp: 100, maxHp: 100,
    speed: 235, dmg: 16, fireRate: 4.2, fireTimer: 0, range: 460,
    pierce: 0, crit: 0.05, magnet: 60,
    dashTimer: 0, dashCd: 0, dashCdMax: 2.6, dashBoost: false, boostTimer: 0, face: 1,
    skillCd: { nova: 0, blades: 0, chrono: 0 },
    bladesTimer: 0, bladeAngle: 0, invuln: 0
  };
}

function resetRun(isEndless) {
  endless = isEndless;
  player = newPlayer();
  bullets = []; ebullets = []; enemies = []; shadows = []; parts = []; drops = []; debts = [];
  sceneIdx = 0; waveIdx = 0; score = 0; kills = 0;
  debtsTotal = 0; debtsRepaid = 0; runTime = 0;
  borrowedSet = new Set(); borrowedHistory = [];
  slowTimer = 0; bossRef = null; spawnQueue = []; waveActive = false;
}

/* ---------------- DOM ---------------- */
const $ = id => document.getElementById(id);
const els = {
  hud: $('hud'), skills: $('skills'), menu: $('menu'), chapter: $('chapter'),
  upgrade: $('upgrade'), end: $('end'), pause: $('pause'),
  hpFill: $('hpfill'), hpText: $('hptext'), scene: $('scene-label'), wave: $('wave-label'),
  debtCount: $('debt-count'), scoreCount: $('score-count'), debtAlert: $('debt-alert'),
  chapterTitle: $('chapter-title'), chapterText: $('chapter-text'),
  endTitle: $('end-title'), endStats: $('end-stats'), best: $('best-line'),
  endlessBtn: $('btn-endless')
};

function show(el, on) { el.classList.toggle('hidden', !on); }
function refreshBest() {
  const best = JSON.parse(localStorage.getItem('td_best') || 'null');
  els.best.textContent = best ? ('最佳：时尘 ' + best.score + ' · 用时 ' + best.time + 's · 总借债 ' + best.debts) : '';
  show(els.endlessBtn, !!localStorage.getItem('td_won'));
}
refreshBest();

/* ---------------- 流程 ---------------- */
function startRun(isEndless) {
  resetRun(isEndless);
  show(els.menu, false); show(els.end, false);
  show(els.hud, true); show(els.skills, true);
  if (endless) { sceneIdx = 0; showChapter(); }
  else showChapter();
}

function showChapter() {
  state = 'chapter';
  const s = SCENES[sceneIdx % SCENES.length];
  els.chapterTitle.textContent = endless && sceneIdx >= SCENES.length ? ('无尽 · ' + s.name) : s.name;
  els.chapterText.textContent = endless && sceneIdx >= SCENES.length
    ? '契已送达，债未算清。未来的你说：那就一直打下去。' : s.story;
  show(els.chapter, true);
}

function beginWave() {
  show(els.chapter, false);
  state = 'playing';
  const s = SCENES[sceneIdx % SCENES.length];
  const w = s.waves[waveIdx];
  spawnQueue = [];
  if (w.boss) { spawnBoss(); waveActive = true; return; }
  ['chaser', 'dart', 'tank', 'shooter'].forEach(t => {
    for (let i = 0; i < (w[t] || 0); i++) spawnQueue.push(t);
  });
  // 洗牌，避免同种扎堆
  for (let i = spawnQueue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [spawnQueue[i], spawnQueue[j]] = [spawnQueue[j], spawnQueue[i]]; }
  spawnTimer = 0.5; waveActive = true;
}

function waveCleared() {
  waveActive = false;
  const s = SCENES[sceneIdx % SCENES.length];
  if (bossRef) return; // Boss 波由 Boss 死亡结算
  waveIdx++;
  if (waveIdx >= s.waves.length) {
    sceneIdx++; waveIdx = 0;
    if (!endless && sceneIdx >= SCENES.length) return victory();
    showChapter();
  } else {
    openUpgrade();
  }
}

function openUpgrade() {
  state = 'upgrade';
  const box = $('upgrade-cards'); box.innerHTML = '';
  const pool = [...UPGRADES].sort(() => Math.random() - 0.5).slice(0, 3);
  pool.forEach(u => {
    const b = document.createElement('button');
    b.className = 'up-card';
    b.innerHTML = '<div class="up-name">' + u.name + '</div><div class="up-desc">' + u.desc + '</div>';
    b.onclick = () => { u.apply(player); beep(660, 0.12, 'triangle', 0.05); show(els.upgrade, false); beginWave(); };
    box.appendChild(b);
  });
  show(els.upgrade, true);
}

function gameOver() {
  state = 'over';
  els.endTitle.textContent = '契未送达';
  els.endStats.textContent = statsText('未来的你收回了契约。');
  show(els.end, true); show(els.skills, false);
  saveBest(false);
}

function victory() {
  state = 'win';
  localStorage.setItem('td_won', '1');
  els.endTitle.textContent = '契已送达 · 债已清';
  els.endStats.textContent = statsText('你把《明日契》交给了未来的自己。无尽模式已解锁。');
  show(els.end, true); show(els.skills, false);
  saveBest(true);
  refreshBest();
}

function statsText(tip) {
  return tip + '\n时尘 ' + score + ' · 击破 ' + kills + ' · 用时 ' + Math.floor(runTime) + 's\n总借债 ' + debtsTotal + ' 笔 · 亲手销账 ' + debtsRepaid + ' 笔 · 未偿 ' + (debts.length + shadows.length) + ' 笔';
}

function saveBest(won) {
  const prev = JSON.parse(localStorage.getItem('td_best') || 'null');
  if (!prev || score > prev.score) {
    localStorage.setItem('td_best', JSON.stringify({ score, time: Math.floor(runTime), debts: debtsTotal, won }));
  }
}

/* ---------------- 敌人 ---------------- */
const ENEMY_DEF = {
  chaser:  { hp: 34,  speed: 92,  r: 15, dmg: 10, score: 10 },
  dart:    { hp: 16,  speed: 168, r: 11, dmg: 8,  score: 14 },
  tank:    { hp: 150, speed: 46,  r: 26, dmg: 18, score: 30 },
  shooter: { hp: 44,  speed: 66,  r: 15, dmg: 10, score: 24, range: 300, shootCd: 2.4 }
};

function spawnPos() {
  const side = Math.floor(rand(0, 4));
  if (side === 0) return { x: rand(0, W), y: -30 };
  if (side === 1) return { x: W + 30, y: rand(0, H) };
  if (side === 2) return { x: rand(0, W), y: H + 30 };
  return { x: -30, y: rand(0, H) };
}

function spawnEnemy(type) {
  const d = ENEMY_DEF[type], p = spawnPos();
  const scale = 1 + sceneIdx * 0.35 + waveIdx * 0.12 + (endless ? sceneIdx * 0.1 : 0);
  enemies.push({
    type, x: p.x, y: p.y, r: d.r, hp: d.hp * scale, maxHp: d.hp * scale,
    speed: d.speed * rand(0.9, 1.1), dmg: d.dmg, score: d.score,
    shootTimer: rand(1, 2.4), wob: rand(0, Math.PI * 2)
  });
}

/* 讨债影：按借款技能生成 */
function spawnShadow(skill) {
  const p = spawnPos();
  const scale = 1 + debtsTotal * 0.06;
  shadows.push({
    skill, x: p.x, y: p.y, r: 17, hp: 95 * scale, maxHp: 95 * scale,
    speed: skill === 'chrono' ? 205 : 118, dmg: 12, castTimer: 2.2, bladeAngle: 0, telegraph: 0
  });
  show(els.debtAlert, true);
  setTimeout(() => show(els.debtAlert, false), 1600);
  beep(140, 0.3, 'sawtooth', 0.06);
}

function spawnBoss() {
  const skills = borrowedSet.size ? [...borrowedSet] : ['nova'];
  bossRef = {
    boss: true, x: W / 2, y: -50, r: 40,
    hp: 1500 + skills.length * 260, maxHp: 1500 + skills.length * 260,
    speed: 84, dmg: 22, score: 500, skills, skillIdx: 0,
    castTimer: 3.5, bladeAngle: 0, phase: 'enter'
  };
  enemies.push(bossRef);
}

/* ---------------- 借债技能 ---------------- */
function borrow(skill, btn) {
  if (state !== 'playing' || !player) return;
  if (player.skillCd[skill] > 0) return;
  player.skillCd[skill] = SKILL_CD[skill];
  debts.push({ skill, due: DEBT_DELAY });
  debtsTotal++;
  borrowedSet.add(skill); borrowedHistory.push(skill);
  if (btn) { btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash'); }

  if (skill === 'nova') {
    ring(player.x, player.y, 190, '#ffd166');
    enemies.slice().forEach(e => { if (dist2(e, player) < 190 * 190) hurtEnemy(e, 95, player); });
    shadows.slice().forEach(s => { if (dist2(s, player) < 190 * 190) hurtShadow(s, 95); });
    shake = 9; beep(90, 0.35, 'sawtooth', 0.07);
  } else if (skill === 'blades') {
    player.bladesTimer = 8; beep(520, 0.15, 'triangle', 0.05);
  } else if (skill === 'chrono') {
    slowTimer = 5; beep(880, 0.25, 'sine', 0.05);
  }
  burst(player.x, player.y, 10, '#ffd166');
}

function hurtEnemy(e, dmg, from) {
  const crit = Math.random() < player.crit;
  e.hp -= crit ? dmg * 2 : dmg;
  e.x += (e.x - from.x) * 0.012; e.y += (e.y - from.y) * 0.012;
  burst(e.x, e.y, crit ? 6 : 3, crit ? '#ffd76e' : '#ffffff');
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  const i = enemies.indexOf(e); if (i < 0) return;
  enemies.splice(i, 1);
  kills++; score += e.score;
  burst(e.x, e.y, 14, SCENES[sceneIdx % SCENES.length].accent);
  beep(220, 0.08, 'square', 0.03);
  if (Math.random() < 0.55) drops.push({ x: e.x, y: e.y, kind: 'xp', v: 5 });
  if (Math.random() < 0.07) drops.push({ x: e.x + 8, y: e.y, kind: 'heart', v: 18 });
  if (e.boss) { bossRef = null; score += 400; onBossDown(); }
}

function hurtShadow(s, dmg) {
  s.hp -= dmg;
  burst(s.x, s.y, 3, '#ff8fa3');
  if (s.hp <= 0) {
    const i = shadows.indexOf(s); if (i < 0) return;
    shadows.splice(i, 1);
    kills++; debtsRepaid++; score += 60;
    burst(s.x, s.y, 22, '#ff8fa3');
    drops.push({ x: s.x, y: s.y, kind: 'heart', v: 12 });
    beep(330, 0.15, 'triangle', 0.05);
  }
}

function onBossDown() {
  if (endless) { sceneIdx++; waveIdx = 0; showChapter(); }
  else victory();
}

/* ---------------- 粒子与特效 ---------------- */
function burst(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(40, 220);
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.25, 0.6), t: 0, color, r: rand(1.5, 3.5) });
  }
}
let rings = [];
function ring(x, y, r, color) { rings.push({ x, y, r, color, t: 0 }); }

/* ---------------- 输入 ---------------- */
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyJ') borrow('nova', document.querySelector('[data-skill="nova"]'));
  if (e.code === 'KeyK') borrow('blades', document.querySelector('[data-skill="blades"]'));
  if (e.code === 'KeyL') borrow('chrono', document.querySelector('[data-skill="chrono"]'));
  if (e.code === 'Escape' && state === 'playing') pauseGame();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

document.querySelectorAll('.skill-btn[data-skill]').forEach(b => {
  b.addEventListener('pointerdown', e => { e.preventDefault(); borrow(b.dataset.skill, b); });
});
$('btn-dash').addEventListener('pointerdown', e => { e.preventDefault(); tryDash(); });

canvas.addEventListener('touchstart', handleTouch, { passive: false });
canvas.addEventListener('touchmove', handleTouch, { passive: false });
canvas.addEventListener('touchend', endTouch, { passive: false });
canvas.addEventListener('mousedown', e => { mouseDown = true; joy.ox = e.clientX; joy.oy = e.clientY; });
window.addEventListener('mouseup', () => { mouseDown = false; });

function handleTouch(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.clientX < W * 0.55) {
      if (!joy.active) { joy.active = true; joy.id = t.identifier; joy.ox = t.clientX; joy.oy = t.clientY; joy.dx = 0; joy.dy = 0; }
      else if (t.identifier === joy.id) {
        const dx = t.clientX - joy.ox, dy = t.clientY - joy.oy, m = Math.hypot(dx, dy) || 1, cap = Math.min(m, 60);
        joy.dx = dx / m * (cap / 60); joy.dy = dy / m * (cap / 60);
      }
    }
  }
}
function endTouch(e) {
  for (const t of e.changedTouches) if (t.identifier === joy.id) { joy.active = false; joy.dx = 0; joy.dy = 0; }
}

function tryDash() {
  if (state !== 'playing' || !player || player.dashCd > 0) return;
  player.dashTimer = 0.16; player.dashCd = player.dashCdMax; player.invuln = Math.max(player.invuln, 0.2);
  beep(440, 0.08, 'sine', 0.04);
}

/* ---------------- 按钮 ---------------- */
$('btn-start').onclick = () => startRun(false);
els.endlessBtn.onclick = () => startRun(true);
$('btn-chapter').onclick = () => beginWave();
$('btn-retry').onclick = () => startRun(endless);
$('btn-tomenu').onclick = () => location.reload();
$('btn-pause').onclick = () => pauseGame();
$('btn-resume').onclick = () => { show(els.pause, false); state = 'playing'; };
$('btn-quit').onclick = () => location.reload();
$('btn-mute').onclick = e => { muted = !muted; e.target.textContent = muted ? '×' : '♪'; };
function pauseGame() { if (state !== 'playing') return; state = 'paused'; show(els.pause, true); }

/* ---------------- 主循环 ---------------- */
let lastTs = 0;
function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min((ts - lastTs) / 1000 || 0, 0.05);
  lastTs = ts;
  if (state === 'playing') update(dt);
  render(dt);
}
requestAnimationFrame(loop);

function enemyTimeScale() { return slowTimer > 0 ? 0.38 : 1; }

function update(dt) {
  runTime += dt;
  const scene = SCENES[sceneIdx % SCENES.length];
  const ts = enemyTimeScale();
  if (slowTimer > 0) slowTimer -= dt;
  if (shake > 0) shake = Math.max(0, shake - dt * 26);

  /* 债务到期 */
  for (let i = debts.length - 1; i >= 0; i--) {
    debts[i].due -= dt;
    if (debts[i].due <= 0) { const d = debts.splice(i, 1)[0]; spawnShadow(d.skill); }
  }

  /* 玩家移动 */
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) my -= 1;
  if (keys.KeyS || keys.ArrowDown) my += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (joy.active || (mouseDown && state === 'playing' && false)) { mx += joy.dx; my += joy.dy; }
  const mm = Math.hypot(mx, my);
  if (mm > 1) { mx /= mm; my /= mm; }
  if (keys.Space) tryDash();
  let spd = player.speed * (slowTimer > 0 ? 1.18 : 1);
  if (player.boostTimer > 0) { player.boostTimer -= dt; spd *= 1.45; }
  if (player.dashTimer > 0) { player.dashTimer -= dt; spd *= 3.1; if (player.dashBoost && player.dashTimer <= 0) player.boostTimer = 0.5; }
  player.x = clamp(player.x + mx * spd * dt, player.r, W - player.r);
  player.y = clamp(player.y + my * spd * dt, player.r, H - player.r);
  if (mx !== 0) player.face = mx > 0 ? 1 : -1;
  if (player.dashCd > 0) player.dashCd -= dt;
  if (player.invuln > 0) player.invuln -= dt;
  for (const k in player.skillCd) if (player.skillCd[k] > 0) player.skillCd[k] -= dt;
  if (player.bladesTimer > 0) { player.bladesTimer -= dt; player.bladeAngle += dt * 4.4; }

  /* 自动瞄准最近敌人射击 */
  player.fireTimer -= dt;
  const target = nearestHostile();
  if (target && player.fireTimer <= 0) {
    player.fireTimer = 1 / (player.fireRate * (slowTimer > 0 ? 1.3 : 1));
    const a = Math.atan2(target.y - player.y, target.x - player.x);
    bullets.push({ x: player.x, y: player.y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560, dmg: player.dmg, pierce: player.pierce, life: 1.1 });
    beep(720 + rand(0, 80), 0.03, 'square', 0.012);
  }

  /* 环刃伤害 */
  if (player.bladesTimer > 0) {
    for (let i = 0; i < 3; i++) {
      const a = player.bladeAngle + i * (Math.PI * 2 / 3);
      const bx = player.x + Math.cos(a) * 52, by = player.y + Math.sin(a) * 52;
      enemies.slice().forEach(e => { if (dist2(e, { x: bx, y: by }) < (e.r + 13) * (e.r + 13) && !e._bladeTick) { e._bladeTick = 0.22; hurtEnemy(e, 26, player); } });
      shadows.slice().forEach(s => { if (dist2(s, { x: bx, y: by }) < (s.r + 13) * (s.r + 13) && !s._bladeTick) { s._bladeTick = 0.22; hurtShadow(s, 26); } });
    }
  }
  enemies.forEach(e => { if (e._bladeTick > 0) e._bladeTick -= dt; });
  shadows.forEach(s => { if (s._bladeTick > 0) s._bladeTick -= dt; });

  /* 生成队列 */
  if (spawnQueue.length) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnTimer = 0.55; spawnEnemy(spawnQueue.shift()); }
  }

  /* 敌人行为 */
  const edt = dt * ts;
  enemies.slice().forEach(e => updateEnemy(e, edt, dt));
  shadows.slice().forEach(s => updateShadow(s, edt, dt));

  /* 子弹 */
  bullets = bullets.filter(b => {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) return false;
    for (const e of enemies.slice()) {
      if (dist2(b, e) < (e.r + 4) * (e.r + 4)) { hurtEnemy(e, b.dmg, b); if (b.pierce > 0) { b.pierce--; } else return false; }
    }
    for (const s of shadows.slice()) {
      if (dist2(b, s) < (s.r + 4) * (s.r + 4)) { hurtShadow(s, b.dmg); return false; }
    }
    return true;
  });
  ebullets = ebullets.filter(b => {
    b.x += b.vx * edt; b.y += b.vy * edt; b.life -= dt;
    if (b.life <= 0) return false;
    if (player.invuln <= 0 && dist2(b, player) < (player.r + 5) * (player.r + 5)) { damagePlayer(b.dmg); return false; }
    return true;
  });

  /* 掉落拾取 */
  drops = drops.filter(d => {
    const dd = Math.sqrt(dist2(d, player));
    if (dd < player.magnet) { d.x += (player.x - d.x) * dt * 7; d.y += (player.y - d.y) * dt * 7; }
    if (dd < player.r + 10) {
      if (d.kind === 'xp') { score += d.v; beep(990, 0.04, 'sine', 0.02); }
      else { player.hp = Math.min(player.maxHp, player.hp + d.v); beep(520, 0.09, 'sine', 0.04); }
      return false;
    }
    return true;
  });

  /* 粒子 */
  parts = parts.filter(p => { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; return p.t < p.life; });
  rings = rings.filter(r => { r.t += dt * 2.4; return r.t < 1; });

  /* 波次结算 */
  if (waveActive && !spawnQueue.length && !enemies.length && !shadows.length) waveCleared();

  updateHud();
}

function nearestHostile() {
  let best = null, bd = player.range * player.range;
  enemies.concat(shadows).forEach(e => { const d = dist2(e, player); if (d < bd) { bd = d; best = e; } });
  return best;
}

function updateEnemy(e, edt, rawDt) {
  const scene = SCENES[sceneIdx % SCENES.length];
  if (e.boss) return updateBoss(e, edt, rawDt);
  const a = Math.atan2(player.y - e.y, player.x - e.x);
  e.wob += rawDt * 3;
  let sp = e.speed;
  if (e.type === 'shooter') {
    const d = Math.sqrt(dist2(e, player));
    if (d < 230) { e.x -= Math.cos(a) * sp * edt; e.y -= Math.sin(a) * sp * edt; }
    else if (d > 300) { e.x += Math.cos(a) * sp * edt; e.y += Math.sin(a) * sp * edt; }
    e.shootTimer -= edt;
    if (e.shootTimer <= 0 && d < 380) {
      e.shootTimer = ENEMY_DEF.shooter.shootCd;
      ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, dmg: 9, life: 3.4 });
    }
  } else if (e.type === 'dart') {
    e.x += Math.cos(a + Math.sin(e.wob) * 0.5) * sp * edt;
    e.y += Math.sin(a + Math.sin(e.wob) * 0.5) * sp * edt;
  } else {
    e.x += Math.cos(a) * sp * edt; e.y += Math.sin(a) * sp * edt;
  }
  if (player.invuln <= 0 && dist2(e, player) < (e.r + player.r) * (e.r + player.r)) {
    damagePlayer(e.dmg);
    e.x -= Math.cos(a) * 26; e.y -= Math.sin(a) * 26;
  }
  void scene;
}

function updateShadow(s, edt, rawDt) {
  const a = Math.atan2(player.y - s.y, player.x - s.x);
  const effDt = s.skill === 'chrono' ? rawDt : edt; // 借了时缓的影子不受时缓影响——它就是从未来来的
  s.x += Math.cos(a) * s.speed * effDt; s.y += Math.sin(a) * s.speed * effDt;
  s.castTimer -= effDt;
  if (s.skill === 'blades') {
    s.bladeAngle += effDt * 4.4;
    for (let i = 0; i < 3; i++) {
      const ba = s.bladeAngle + i * (Math.PI * 2 / 3);
      const bx = s.x + Math.cos(ba) * 46, by = s.y + Math.sin(ba) * 46;
      if (player.invuln <= 0 && dist2(player, { x: bx, y: by }) < (player.r + 12) * (player.r + 12)) { damagePlayer(14); }
    }
  }
  if (s.castTimer <= 0) {
    if (s.skill === 'nova') {
      s.castTimer = 3.4; s.telegraph = 0.7;
      setTimeout(() => {
        if (state !== 'playing' || !shadows.includes(s)) return;
        ring(s.x, s.y, 130, '#ff5d7a');
        if (player.invuln <= 0 && dist2(player, s) < 130 * 130) damagePlayer(20);
      }, 700);
    } else if (s.skill === 'chrono') {
      s.castTimer = 4; // 疾冲
      s.x += Math.cos(a) * 130; s.y += Math.sin(a) * 130;
      burst(s.x, s.y, 8, '#8cdcff');
    } else {
      s.castTimer = 2.6;
      for (let i = 0; i < 5; i++) {
        const ba = a + (i - 2) * 0.22;
        ebullets.push({ x: s.x, y: s.y, vx: Math.cos(ba) * 240, vy: Math.sin(ba) * 240, dmg: 10, life: 2.6 });
      }
    }
  }
  if (player.invuln <= 0 && dist2(s, player) < (s.r + player.r) * (s.r + player.r)) {
    damagePlayer(s.dmg);
    s.x -= Math.cos(a) * 30; s.y -= Math.sin(a) * 30;
  }
}

function updateBoss(e, edt, rawDt) {
  if (e.phase === 'enter') { e.y += 90 * rawDt; if (e.y >= 110) e.phase = 'fight'; return; }
  const a = Math.atan2(player.y - e.y, player.x - e.x);
  e.x += Math.cos(a) * e.speed * edt; e.y += Math.sin(a) * e.speed * edt;
  e.castTimer -= rawDt;
  if (e.castTimer <= 0) {
    const skill = e.skills[e.skillIdx % e.skills.length];
    e.skillIdx++; e.castTimer = 4.2;
    if (skill === 'nova') {
      ring(e.x, e.y, 170, '#ff5d7a');
      for (let i = 0; i < 14; i++) {
        const ba = (i / 14) * Math.PI * 2;
        ebullets.push({ x: e.x, y: e.y, vx: Math.cos(ba) * 190, vy: Math.sin(ba) * 190, dmg: 12, life: 3 });
      }
    } else if (skill === 'blades') {
      e.bladesUntil = runTime + 6;
    } else if (skill === 'chrono') {
      e.x += Math.cos(a) * 170; e.y += Math.sin(a) * 170;
      burst(e.x, e.y, 16, '#8cdcff');
    }
    beep(160, 0.25, 'sawtooth', 0.05);
  }
  if (e.bladesUntil && runTime < e.bladesUntil) {
    e.bladeAngle += rawDt * 4.6;
    for (let i = 0; i < 4; i++) {
      const ba = e.bladeAngle + i * (Math.PI / 2);
      const bx = e.x + Math.cos(ba) * 74, by = e.y + Math.sin(ba) * 74;
      if (player.invuln <= 0 && dist2(player, { x: bx, y: by }) < (player.r + 14) * (player.r + 14)) damagePlayer(16);
    }
  }
  if (player.invuln <= 0 && dist2(e, player) < (e.r + player.r) * (e.r + player.r)) {
    damagePlayer(e.dmg);
    player.x -= Math.cos(a) * 34; player.y -= Math.sin(a) * 34;
  }
}

function damagePlayer(dmg) {
  if (player.invuln > 0 || state !== 'playing') return;
  player.hp -= dmg; player.invuln = 0.55; shake = Math.max(shake, 5);
  burst(player.x, player.y, 8, '#ff5d7a');
  beep(120, 0.12, 'sawtooth', 0.05);
  if (player.hp <= 0) { player.hp = 0; gameOver(); }
}

/* ---------------- HUD ---------------- */
const skillBtns = {};
document.querySelectorAll('.skill-btn[data-skill]').forEach(b => { skillBtns[b.dataset.skill] = b; });
function updateHud() {
  const scene = SCENES[sceneIdx % SCENES.length];
  els.hpFill.style.width = (player.hp / player.maxHp * 100) + '%';
  els.hpText.textContent = Math.ceil(player.hp) + ' / ' + player.maxHp;
  els.scene.textContent = (endless && sceneIdx >= SCENES.length ? '无尽 · ' : '') + scene.name;
  const w = scene.waves[waveIdx];
  els.wave.textContent = w && w.boss ? '最终讨债' : ('第 ' + (waveIdx + 1) + ' / ' + scene.waves.length + ' 波 · 余敌 ' + (enemies.length + shadows.length + spawnQueue.length));
  els.debtCount.textContent = debts.length + shadows.length;
  els.scoreCount.textContent = score;
  for (const k in skillBtns) {
    const cd = skillBtns[k].querySelector('.sk-cd');
    const remain = Math.max(0, player.skillCd[k]);
    cd.style.width = (remain / SKILL_CD[k] * 100) + '%';
    skillBtns[k].style.opacity = remain > 0 ? 0.55 : 1;
  }
  const dashBtn = $('btn-dash');
  dashBtn.querySelector('.sk-cd').style.width = (Math.max(0, player.dashCd) / player.dashCdMax * 100) + '%';
  dashBtn.style.opacity = player.dashCd > 0 ? 0.55 : 1;
}

/* ---------------- 渲染 ---------------- */
let decor = [];
for (let i = 0; i < 70; i++) decor.push({ x: Math.random(), y: Math.random(), r: rand(0.6, 2.2), p: rand(0, 9) });

function render(dt) {
  const scene = SCENES[Math.min(sceneIdx, SCENES.length - 1) % SCENES.length];
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, scene.top); g.addColorStop(1, scene.bottom);
  ctx.fillStyle = g; ctx.fillRect(-12, -12, W + 24, H + 24);

  /* 场景装饰：题材各异 */
  const t = performance.now() / 1000;
  if (scene.theme === 'neon') {
    ctx.strokeStyle = 'rgba(57,213,255,0.13)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 56) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 56) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else if (scene.theme === 'abyss') {
    decor.forEach(d => {
      const y = ((d.y - t * 0.014 * d.r) % 1 + 1) % 1 * H;
      ctx.fillStyle = 'rgba(140,220,255,0.20)';
      ctx.beginPath(); ctx.arc(d.x * W, y, d.r * 2.1, 0, 7); ctx.fill();
    });
  } else {
    decor.forEach(d => {
      const y = ((d.y - t * 0.02 * d.r) % 1 + 1) % 1 * H;
      ctx.fillStyle = 'rgba(255,150,70,0.30)';
      ctx.beginPath(); ctx.arc(d.x * W + Math.sin(t + d.p) * 8, y, d.r * 1.5, 0, 7); ctx.fill();
    });
  }
  if (slowTimer > 0) { ctx.fillStyle = 'rgba(80,160,255,0.10)'; ctx.fillRect(-12, -12, W + 24, H + 24); }

  if (!player) { ctx.restore(); return; }

  /* 掉落 */
  drops.forEach(d => {
    ctx.fillStyle = d.kind === 'xp' ? '#ffd76e' : '#ff7d9c';
    ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.PI / 4);
    const s = d.kind === 'xp' ? 5 : 7;
    ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore();
  });

  /* 摇杆 */
  if (joy.active) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(joy.ox, joy.oy, 46, 0, 7); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(joy.ox + joy.dx * 34, joy.oy + joy.dy * 34, 18, 0, 7); ctx.fill();
  }

  /* 敌人 */
  enemies.forEach(e => drawEnemy(e, scene));
  shadows.forEach(s => drawShadow(s));
  ebullets.forEach(b => { ctx.fillStyle = '#ff6b81'; ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, 7); ctx.fill(); });
  bullets.forEach(b => { ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(b.x, b.y, 3.6, 0, 7); ctx.fill(); });

  /* 玩家环刃 */
  if (player.bladesTimer > 0) {
    for (let i = 0; i < 3; i++) {
      const a = player.bladeAngle + i * (Math.PI * 2 / 3);
      drawBlade(player.x + Math.cos(a) * 52, player.y + Math.sin(a) * 52, '#ffd166');
    }
  }

  /* 玩家 */
  const blink = player.invuln > 0 && Math.floor(t * 16) % 2 === 0;
  if (!blink) {
    ctx.fillStyle = '#f4f6ff';
    ctx.beginPath(); ctx.arc(player.x, player.y, player.r, 0, 7); ctx.fill();
    ctx.fillStyle = scene.accent;
    ctx.beginPath(); ctx.arc(player.x + player.face * 5, player.y - 2, 5.5, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(player.x, player.y, player.r + 5 + Math.sin(t * 4) * 1.5, 0, 7); ctx.stroke();
  }

  /* 粒子与冲击环 */
  parts.forEach(p => {
    ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  });
  rings.forEach(r => {
    ctx.globalAlpha = 1 - r.t; ctx.strokeStyle = r.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r * r.t, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  });
  ctx.restore();
}

function hpBar(x, y, w, frac, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - w / 2, y, w, 5);
  ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 5);
}

function drawEnemy(e, scene) {
  ctx.fillStyle = scene.enemy;
  if (e.boss) {
    ctx.save(); ctx.translate(e.x, e.y);
    ctx.fillStyle = '#2a0f18';
    ctx.beginPath(); ctx.arc(0, 0, e.r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#ff5d7a'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#ff8fa3';
    ctx.beginPath(); ctx.arc(-13, -6, 6, 0, 7); ctx.arc(13, -6, 6, 0, 7); ctx.fill();
    if (e.bladesUntil && runTime < e.bladesUntil) {
      for (let i = 0; i < 4; i++) {
        const a = e.bladeAngle + i * (Math.PI / 2);
        drawBlade(e.x + Math.cos(a) * 74, e.y + Math.sin(a) * 74, '#ff5d7a');
      }
    }
    ctx.restore();
    hpBar(e.x, e.y - e.r - 14, 110, e.hp / e.maxHp, '#ff5d7a');
    ctx.fillStyle = '#ffb3c1'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('大讨债影 · 未来的你', e.x, e.y - e.r - 20);
    return;
  }
  ctx.save(); ctx.translate(e.x, e.y);
  if (e.type === 'tank') {
    ctx.fillRect(-e.r, -e.r, e.r * 2, e.r * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-e.r + 6, -e.r + 6, e.r * 2 - 12, e.r * 2 - 12);
  } else if (e.type === 'dart') {
    ctx.rotate(Math.atan2(player.y - e.y, player.x - e.x));
    ctx.beginPath(); ctx.moveTo(e.r + 4, 0); ctx.lineTo(-e.r, -e.r * 0.7); ctx.lineTo(-e.r, e.r * 0.7); ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(0, 0, e.r, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.5, 0, 7); ctx.fill();
  }
  ctx.restore();
  if (e.hp < e.maxHp) hpBar(e.x, e.y - e.r - 9, 30, e.hp / e.maxHp, '#ff8fa3');
}

function drawShadow(s) {
  ctx.save(); ctx.translate(s.x, s.y);
  ctx.fillStyle = 'rgba(16,8,20,0.92)';
  ctx.beginPath(); ctx.arc(0, 0, s.r, 0, 7); ctx.fill();
  ctx.strokeStyle = '#ff5d7a'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(SKILL_NAME[s.skill], 0, 4);
  ctx.restore();
  if (s.skill === 'blades') {
    for (let i = 0; i < 3; i++) {
      const a = s.bladeAngle + i * (Math.PI * 2 / 3);
      drawBlade(s.x + Math.cos(a) * 46, s.y + Math.sin(a) * 46, '#ff5d7a');
    }
  }
  if (s.telegraph > 0) {
    s.telegraph -= 0.016;
    ctx.strokeStyle = 'rgba(255,93,122,0.8)';
    ctx.beginPath(); ctx.arc(s.x, s.y, 130, 0, 7); ctx.stroke();
  }
  hpBar(s.x, s.y - s.r - 10, 36, s.hp / s.maxHp, '#ff5d7a');
}

function drawBlade(x, y, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(performance.now() / 90);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(4, 6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
}
