// canvas.js — 캔버스 렌더링, 좌표 변환, 오버레이, 돋보기
// 좌표 변환은 이 파일의 toAnalysis() 하나만 쓴다(§5.2). 다른 곳에서 중복 작성 금지.

const LOUPE_SIZE = 180;
const LOUPE_ZOOM = 3.5;

export class Stage {
  constructor({ wrap, canvas, loupe, confirmBtn, badge, msg }) {
    this.wrap = wrap;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.loupe = loupe;
    this.lctx = loupe.getContext('2d');
    this.confirmBtn = confirmBtn;
    this.badge = badge;
    this.msg = msg;

    this.W = 0; this.H = 0;
    this.src = document.createElement('canvas');   // 오버레이 없는 원본 프레임
    this.sctx = this.src.getContext('2d');

    this.overlay = null;
    this.interaction = null;   // { onDown(pt,ev), onMove(pt,ev), onUp(pt,ev) }
    this.aim = null;           // { point, onConfirm }
    this.hoverPoint = null;

    canvas.addEventListener('pointerdown', this._down = (e) => this._onDown(e));
    canvas.addEventListener('pointermove', this._move = (e) => this._onMove(e));
    canvas.addEventListener('pointerup', this._up = (e) => this._onUp(e));
    canvas.addEventListener('pointercancel', this._up);
    canvas.addEventListener('pointerleave', () => { this.hoverPoint = null; this.redraw(); });
    confirmBtn.addEventListener('click', () => this._confirmAim());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.aim && this.aim.point) { e.preventDefault(); this._confirmAim(); }
    });
    window.addEventListener('resize', () => this.redraw());
  }

  setSize(w, h) {
    this.W = w; this.H = h;
    this.canvas.width = w; this.canvas.height = h;
    this.src.width = w; this.src.height = h;
    this.redraw();
  }

  /** 분석 좌표계로의 유일한 변환 지점 */
  toAnalysis(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (this.W / rect.width),
      y: (clientY - rect.top) * (this.H / rect.height)
    };
  }

  /** 분석 좌표 → 화면(wrap 기준) 좌표. 돋보기 배치 등에만 쓴다. */
  toDisplay(ax, ay) {
    const rect = this.canvas.getBoundingClientRect();
    const wrapRect = this.wrap.getBoundingClientRect();
    return {
      x: rect.left - wrapRect.left + ax * (rect.width / this.W),
      y: rect.top - wrapRect.top + ay * (rect.height / this.H)
    };
  }

  setBitmap(bmp) {
    this.bitmap = bmp || null;
    this.sctx.clearRect(0, 0, this.W, this.H);
    if (bmp) this.sctx.drawImage(bmp, 0, 0, this.W, this.H);
    this.redraw();
  }

  setOverlay(fn) { this.overlay = fn; this.redraw(); }

  setBadge(on) { this.badge.classList.toggle('hidden', !on); }

  setMessage(text) {
    if (!text) { this.msg.classList.add('hidden'); return; }
    this.msg.textContent = text;
    this.msg.classList.remove('hidden');
  }

  redraw() {
    const { ctx, W, H } = this;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.src, 0, 0);
    if (this.overlay) this.overlay(ctx, this);
    if (this.aim && this.aim.point) drawCrosshair(ctx, this.aim.point, W);
    this._drawLoupe();
  }

  /* ---------------- 조준 모드 (§15.2 끌어서 조준 → 확정) ---------------- */
  startAim(initial, onConfirm, label) {
    this.aim = { point: initial ? { ...initial } : null, onConfirm };
    this.confirmBtn.textContent = label || '여기로 확인';
    this.confirmBtn.classList.toggle('hidden', !this.aim.point);
    this.redraw();
  }

  stopAim() {
    this.aim = null;
    this.confirmBtn.classList.add('hidden');
    this.loupe.classList.add('hidden');
    this.redraw();
  }

  _confirmAim() {
    if (!this.aim || !this.aim.point) return;
    const p = this.aim.point;
    const cb = this.aim.onConfirm;
    this.stopAim();
    cb?.(p);
  }

  _onDown(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this.toAnalysis(e.clientX, e.clientY);
    if (this.interaction?.onDown?.(p, e)) return;
    if (this.aim) {
      this.aim.point = p;
      this.confirmBtn.classList.remove('hidden');
      this.redraw();
    }
  }

  _onMove(e) {
    const p = this.toAnalysis(e.clientX, e.clientY);
    this.hoverPoint = p;
    if (this.interaction?.onMove?.(p, e)) { this.redraw(); return; }
    if (this.aim && (e.buttons & 1)) {
      this.aim.point = p;
    }
    this.redraw();
  }

  _onUp(e) {
    const p = this.toAnalysis(e.clientX, e.clientY);
    this.canvas.releasePointerCapture?.(e.pointerId);
    if (this.interaction?.onUp?.(p, e)) return;
  }

  /* ---------------- 돋보기 ---------------- */
  _drawLoupe() {
    const p = (this.aim && this.aim.point) || null;
    if (!p) { this.loupe.classList.add('hidden'); return; }

    const l = this.lctx, S = LOUPE_SIZE, Z = LOUPE_ZOOM;
    this.loupe.width = S; this.loupe.height = S;
    l.clearRect(0, 0, S, S);
    l.imageSmoothingEnabled = false;
    const half = S / (2 * Z);
    l.drawImage(this.src, p.x - half, p.y - half, half * 2, half * 2, 0, 0, S, S);

    l.strokeStyle = 'rgba(255,255,255,.95)'; l.lineWidth = 1;
    l.beginPath(); l.moveTo(S / 2, 0); l.lineTo(S / 2, S);
    l.moveTo(0, S / 2); l.lineTo(S, S / 2); l.stroke();
    l.strokeStyle = 'rgba(255,60,80,.95)'; l.lineWidth = 2;
    l.beginPath(); l.arc(S / 2, S / 2, 5, 0, Math.PI * 2); l.stroke();

    // 손가락 반대편(위쪽)에 배치한다
    const d = this.toDisplay(p.x, p.y);
    const wrapRect = this.wrap.getBoundingClientRect();
    let left = d.x - S / 2;
    let top = d.y - S - 28;
    if (top < 4) top = d.y + 28;                       // 위 공간이 없으면 아래로
    left = Math.max(4, Math.min(left, wrapRect.width - S - 4));
    this.loupe.style.left = left + 'px';
    this.loupe.style.top = top + 'px';
    this.loupe.classList.remove('hidden');
  }
}

/* ---------------- 오버레이 그리기 도우미 ---------------- */

function drawCrosshair(ctx, p, W) {
  const r = Math.max(10, W * 0.012);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = Math.max(1.5, W / 800);
  ctx.beginPath();
  ctx.moveTo(p.x - r * 1.8, p.y); ctx.lineTo(p.x - r * 0.4, p.y);
  ctx.moveTo(p.x + r * 0.4, p.y); ctx.lineTo(p.x + r * 1.8, p.y);
  ctx.moveTo(p.x, p.y - r * 1.8); ctx.lineTo(p.x, p.y - r * 0.4);
  ctx.moveTo(p.x, p.y + r * 0.4); ctx.lineTo(p.x, p.y + r * 1.8);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,80,90,.95)';
  ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.35, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

export function drawRuler(ctx, p1, p2, W) {
  if (!p1) return;
  ctx.save();
  ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = Math.max(2, W / 500);
  if (p2) { ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); }
  for (const p of [p1, p2]) {
    if (!p) continue;
    ctx.fillStyle = '#4da3ff';
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(5, W / 180), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.restore();
}

export function drawBox(ctx, cx, cy, w, h, W) {
  ctx.save();
  ctx.strokeStyle = '#41c98e'; ctx.lineWidth = Math.max(2, W / 600);
  ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  const hs = Math.max(6, W / 160);
  ctx.fillStyle = '#41c98e';
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    ctx.fillRect(cx + sx * w / 2 - hs / 2, cy + sy * h / 2 - hs / 2, hs, hs);
  }
  ctx.restore();
}

export function drawTrackPoints(ctx, points, W, opts = {}) {
  const { current = -1, highlight = -1 } = opts;
  const r = Math.max(2.5, W / 320);
  ctx.save();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    ctx.beginPath();
    ctx.arc(p.px, p.py, i === highlight ? r * 2.2 : r, 0, Math.PI * 2);
    if (i === highlight) { ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 3; ctx.stroke(); }
    else if (i === current) { ctx.fillStyle = '#ff4d5e'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    else { ctx.fillStyle = 'rgba(255,77,94,.45)'; ctx.fill(); }
  }
  ctx.restore();
}

export function drawTheoryCurve(ctx, pts, W) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = Math.max(2, W / 550);
  ctx.beginPath(); ctx.moveTo(pts[0].px, pts[0].py);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].px, pts[i].py);
  ctx.stroke(); ctx.restore();
}

export function drawBaseline(ctx, y, W) {
  if (y == null || !isFinite(y)) return;
  ctx.save();
  ctx.strokeStyle = '#cfd8e6'; ctx.lineWidth = Math.max(1.5, W / 800);
  ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ctx.canvas.width, y); ctx.stroke();
  ctx.restore();
}
