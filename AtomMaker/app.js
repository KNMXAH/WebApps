/*
* ELEMENT TABLE SPECIFICATION (Z = 1 to 20)
*/
const ELEMENT_TABLE = {
    1:  { symbol: 'H',  ionCharge: 1,  stableNeutrons: 1, electronThreshold: 1 },
    2:  { symbol: 'He', ionCharge: 0,  stableNeutrons: 2, electronThreshold: 2 },
    3:  { symbol: 'Li', ionCharge: 1,  stableNeutrons: 3, electronThreshold: 3 },
    4:  { symbol: 'Be', ionCharge: 2,  stableNeutrons: 4, electronThreshold: 4 },
    5:  { symbol: 'B',  ionCharge: 3,  stableNeutrons: 5, electronThreshold: 5 },
    6:  { symbol: 'C',  ionCharge: 0,  stableNeutrons: 6, electronThreshold: 6 },
    7:  { symbol: 'N',  ionCharge: -3, stableNeutrons: 7, electronThreshold: 10 },
    8:  { symbol: 'O',  ionCharge: -2, stableNeutrons: 8, electronThreshold: 10 },
    9:  { symbol: 'F',  ionCharge: -1, stableNeutrons: 9, electronThreshold: 10 },
    10: { symbol: 'Ne', ionCharge: 0,  stableNeutrons: 10, electronThreshold: 10 },
    11: { symbol: 'Na', ionCharge: 1,  stableNeutrons: 11, electronThreshold: 11 },
    12: { symbol: 'Mg', ionCharge: 2,  stableNeutrons: 12, electronThreshold: 12 },
    13: { symbol: 'Al', ionCharge: 3,  stableNeutrons: 13, electronThreshold: 13 },
    14: { symbol: 'Si', ionCharge: 0,  stableNeutrons: 14, electronThreshold: 14 },
    15: { symbol: 'P',  ionCharge: -3, stableNeutrons: 15, electronThreshold: 18 },
    16: { symbol: 'S',  ionCharge: -2, stableNeutrons: 16, electronThreshold: 18 },
    17: { symbol: 'Cl', ionCharge: -1, stableNeutrons: 17, electronThreshold: 18 },
    18: { symbol: 'Ar', ionCharge: 0,  stableNeutrons: 18, electronThreshold: 18 },
    19: { symbol: 'K',  ionCharge: 1,  stableNeutrons: 19, electronThreshold: 19 },
    20: { symbol: 'Ca', ionCharge: 2,  stableNeutrons: 20, electronThreshold: 20 }
};

// Nuclear stability calculation rules:
// N = Z -> PERMANENT
// N = Z - 1 or N = Z + 1 -> TEMPORARY (5 sec timer)
// Otherwise -> UNSTABLE (Bounce off)
function getNuclearStabilityStatus(Z, N) {
    if (Z <= 0) return 'UNSTABLE';
    if (N === Z) return 'PERMANENT';             // N = Z (영구 안정)
    if (N === Z - 1 || N === Z + 1) return 'TEMPORARY'; // N = Z-1 또는 N = Z+1 (5초 시한부 안정)
    return 'UNSTABLE';                           // 그 외 (즉시 튕김/불안정)
}

// Helper function for electron threshold
function getElectronThreshold(Z) {
    if (!ELEMENT_TABLE[Z]) return Z;
    return ELEMENT_TABLE[Z].electronThreshold;
}

// Runtime Atom State
let atomState = {
    exists: false,
    protonCount: 0,
    neutronCount: 0,
    electrons: [],       // Array of bound orbiting electrons
    nucleusPosition: { x: 0, y: 0 },
    isEvaluating: false, // True during 3s stability evaluation
    freeNeutrons: [],    // Floating neutrons before atom creation
    freeElectrons: []    // Floating electrons before atom creation
};

// Particle visual physics & animation collections
let nucleusParticles = [];
let animatedParticles = [];
let dragParticle = null;

// Canvas & UI DOM Elements
const canvas = document.getElementById('atom-canvas');
const ctx = canvas.getContext('2d');
const elementDisplay = document.getElementById('element-display');
const symbolMain = document.getElementById('symbol-main');
const symbolCharge = document.getElementById('symbol-charge');
const stabilityIndicator = document.getElementById('stability-indicator');
const stabilityText = document.getElementById('stability-text');
const resetBtn = document.getElementById('reset-btn');

// Particle Visual Radii (Canvas Pixels)
const PROTON_RADIUS = 16;
const NEUTRON_RADIUS = 16;
const ELECTRON_RADIUS = 9;
const NUCLEUS_CONTAINER_RADIUS = 65;
const ATOM_SHELL_RADIUS = 150;

// Pending state timer tracking
let nuclearTimer = null;
let decayTimer = null;
let pendingProtonIncrement = false;

function clearDecayTimer() {
    if (decayTimer) {
        clearTimeout(decayTimer);
        decayTimer = null;
    }
}

function start5SecDecayTimer(ejectType) {
    clearDecayTimer();
    
    // Show 5-second decay warning indicator
    stabilityIndicator.className = "mt-2 text-xs font-semibold px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1.5";
    stabilityText.textContent = "불안정 동위원소 (5초 후 붕괴)";
    stabilityIndicator.style.opacity = '1';

    decayTimer = setTimeout(() => {
        decayTimer = null;
        stabilityIndicator.style.opacity = '0';
        
        if (ejectType === 'neutron' && atomState.neutronCount > 0) {
            atomState.neutronCount--;
            const nIdx = nucleusParticles.findIndex(p => p.type === 'neutron' && !p.isPending);
            if (nIdx !== -1) {
                const removed = nucleusParticles.splice(nIdx, 1)[0];
                bounceParticleOff('neutron', removed.x, removed.y);
            }
        } else if (ejectType === 'proton' && atomState.protonCount > 0) {
            atomState.protonCount--;
            const pIdx = nucleusParticles.findIndex(p => p.type === 'proton' && !p.isPending);
            if (pIdx !== -1) {
                const removed = nucleusParticles.splice(pIdx, 1)[0];
                bounceParticleOff('proton', removed.x, removed.y);
            }
            if (atomState.protonCount === 0) {
                atomState.exists = false;
                while (atomState.electrons.length > 0) {
                    const el = atomState.electrons.pop();
                    bounceParticleOff('electron', el.x || atomState.nucleusPosition.x, el.y || atomState.nucleusPosition.y);
                }
            }
        }
        arrangeNucleusParticles();
        updateElementDisplay();
    }, 5000);
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);

    if (!atomState.exists) {
        atomState.nucleusPosition = {
            x: canvas.clientWidth / 2,
            y: canvas.clientHeight / 2
        };
    }
}

window.addEventListener('resize', resizeCanvas);

function updateElementDisplay() {
    if (!atomState.exists || atomState.protonCount <= 0) {
        elementDisplay.style.opacity = '0';
        elementDisplay.classList.add('scale-95');
        return;
    }

    const displayZ = pendingProtonIncrement ? (atomState.protonCount + 1) : atomState.protonCount;
    const element = ELEMENT_TABLE[displayZ] || { symbol: '?', ionCharge: 0 };
    
    symbolMain.textContent = element.symbol;

    const netCharge = displayZ - atomState.electrons.length;
    if (netCharge === 0) {
        symbolCharge.textContent = '';
    } else if (netCharge === 1) {
        symbolCharge.textContent = '⁺';
    } else if (netCharge > 1) {
        symbolCharge.textContent = `${netCharge}⁺`;
    } else if (netCharge === -1) {
        symbolCharge.textContent = '⁻';
    } else {
        symbolCharge.textContent = `${Math.abs(netCharge)}⁻`;
    }

    elementDisplay.style.opacity = '1';
    elementDisplay.classList.remove('scale-95');
}

function resetApp() {
    if (nuclearTimer) clearTimeout(nuclearTimer);
    nuclearTimer = null;
    clearDecayTimer();
    pendingProtonIncrement = false;

    atomState = {
        exists: false,
        protonCount: 0,
        neutronCount: 0,
        electrons: [],
        nucleusPosition: {
            x: canvas.clientWidth / 2,
            y: canvas.clientHeight / 2
        },
        isEvaluating: false,
        freeNeutrons: [],
        freeElectrons: []
    };

    nucleusParticles = [];
    animatedParticles = [];
    dragParticle = null;

    updateElementDisplay();
    stabilityIndicator.style.opacity = '0';
}

resetBtn.addEventListener('click', resetApp);

function bounceParticleOff(type, startX, startY) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 7 + Math.random() * 5;
    animatedParticles.push({
        type: type,
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2, // slight upward bounce arc
        gravity: 0.25,
        alpha: 1.0,
        isBouncing: true
    });
}

function arrangeNucleusParticles() {
    const total = nucleusParticles.length;
    if (total === 0) return;

    const centerX = atomState.nucleusPosition.x;
    const centerY = atomState.nucleusPosition.y;

    if (total === 1) {
        nucleusParticles[0].targetX = centerX;
        nucleusParticles[0].targetY = centerY;
        return;
    }

    // Arrange particles in overlapping spiral/concentric nucleus cluster
    const goldenAngle = 137.5 * (Math.PI / 180);
    const spread = 16;

    nucleusParticles.forEach((p, idx) => {
        const r = spread * Math.sqrt(idx + 1);
        const theta = idx * goldenAngle;
        p.targetX = centerX + r * Math.cos(theta);
        p.targetY = centerY + r * Math.sin(theta);
    });
}

function ejectExcessElectron() {
    if (atomState.electrons.length === 0) return;
    const popped = atomState.electrons.pop();
    bounceParticleOff('electron', popped.x || atomState.nucleusPosition.x, popped.y || atomState.nucleusPosition.y);
    updateElementDisplay();
}

function processProtonDrop(dropX, dropY) {
    // Case A: First Proton Drop -> Atom Created!
    if (!atomState.exists) {
        atomState.exists = true;
        atomState.nucleusPosition = { x: dropX, y: dropY };
        atomState.protonCount = 1;

        nucleusParticles.push({
            type: 'proton',
            x: dropX,
            y: dropY,
            targetX: dropX,
            targetY: dropY,
            vx: 0,
            vy: 0
        });

        arrangeNucleusParticles();
        updateElementDisplay();

        // Process queued free neutrons
        if (atomState.freeNeutrons.length > 0) {
            const queuedNeutrons = [...atomState.freeNeutrons];
            atomState.freeNeutrons = [];

            queuedNeutrons.forEach((fn, idx) => {
                setTimeout(() => {
                    bounceParticleOff('neutron', fn.x, fn.y);
                }, idx * 250);
            });
        }
        
        // For Z=1, N=0 -> N = Z - 1 (Temporary 5-second stability)
        start5SecDecayTimer('proton');
        return;
    }

    // Case B: Additional Proton Drop onto existing Atom
    const newZ = atomState.protonCount + 1;

    if (newZ > 20 || atomState.isEvaluating) {
        bounceParticleOff('proton', dropX, dropY);
        return;
    }

    // Temporarily update symbol display & set evaluating status
    atomState.isEvaluating = true;
    pendingProtonIncrement = true;
    updateElementDisplay();

    stabilityIndicator.className = "mt-2 text-xs font-semibold px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1.5";
    stabilityText.textContent = "핵 안정화 판정 중...";
    stabilityIndicator.style.opacity = '1';

    const tempProton = {
        type: 'proton',
        x: dropX,
        y: dropY,
        targetX: dropX,
        targetY: dropY,
        vx: 0,
        vy: 0,
        isPending: true
    };
    nucleusParticles.push(tempProton);
    arrangeNucleusParticles();

    nuclearTimer = setTimeout(() => {
        const status = getNuclearStabilityStatus(newZ, atomState.neutronCount);

        atomState.isEvaluating = false;
        pendingProtonIncrement = false;

        if (status === 'PERMANENT') {
            clearDecayTimer();
            stabilityIndicator.style.opacity = '0';
            atomState.protonCount = newZ;
            tempProton.isPending = false;
            arrangeNucleusParticles();

            const threshold = getElectronThreshold(newZ);
            while (atomState.electrons.length > threshold) {
                ejectExcessElectron();
            }
        } else if (status === 'TEMPORARY') {
            atomState.protonCount = newZ;
            tempProton.isPending = false;
            arrangeNucleusParticles();

            const threshold = getElectronThreshold(newZ);
            while (atomState.electrons.length > threshold) {
                ejectExcessElectron();
            }
            start5SecDecayTimer('proton');
        } else {
            stabilityIndicator.style.opacity = '0';
            const idx = nucleusParticles.indexOf(tempProton);
            if (idx !== -1) nucleusParticles.splice(idx, 1);
            arrangeNucleusParticles();

            bounceParticleOff('proton', tempProton.x, tempProton.y);
        }

        updateElementDisplay();
        nuclearTimer = null;
    }, 3000);
}

function processNeutronDrop(dropX, dropY) {
    if (!atomState.exists) {
        atomState.freeNeutrons.push({
            id: Date.now() + Math.random(),
            x: dropX,
            y: dropY
        });
        return;
    }

    if (atomState.isEvaluating) {
        bounceParticleOff('neutron', dropX, dropY);
        return;
    }

    atomState.isEvaluating = true;
    stabilityIndicator.className = "mt-2 text-xs font-semibold px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1.5";
    stabilityText.textContent = "핵 안정화 판정 중...";
    stabilityIndicator.style.opacity = '1';

    const tempNeutron = {
        type: 'neutron',
        x: dropX,
        y: dropY,
        targetX: dropX,
        targetY: dropY,
        vx: 0,
        vy: 0,
        isPending: true
    };
    nucleusParticles.push(tempNeutron);
    arrangeNucleusParticles();

    nuclearTimer = setTimeout(() => {
        const currentZ = atomState.protonCount;
        const targetN = atomState.neutronCount + 1;
        const status = getNuclearStabilityStatus(currentZ, targetN);

        atomState.isEvaluating = false;

        if (status === 'PERMANENT') {
            clearDecayTimer();
            stabilityIndicator.style.opacity = '0';
            atomState.neutronCount = targetN;
            tempNeutron.isPending = false;
            arrangeNucleusParticles();
        } else if (status === 'TEMPORARY') {
            atomState.neutronCount = targetN;
            tempNeutron.isPending = false;
            arrangeNucleusParticles();
            start5SecDecayTimer('neutron');
        } else {
            stabilityIndicator.style.opacity = '0';
            const idx = nucleusParticles.indexOf(tempNeutron);
            if (idx !== -1) nucleusParticles.splice(idx, 1);
            arrangeNucleusParticles();

            bounceParticleOff('neutron', tempNeutron.x, tempNeutron.y);
        }

        updateElementDisplay();
        nuclearTimer = null;
    }, 3000);
}

function processElectronDrop(dropX, dropY) {
    if (!atomState.exists) {
        if (atomState.freeElectrons.length === 0) {
            atomState.freeElectrons.push({ x: dropX, y: dropY });
        } else {
            atomState.freeElectrons.push({ x: dropX, y: dropY });
            atomState.freeElectrons.forEach(fe => {
                bounceParticleOff('electron', fe.x, fe.y);
            });
            atomState.freeElectrons = [];
        }
        return;
    }

    const threshold = getElectronThreshold(atomState.protonCount);
    const currentElectrons = atomState.electrons.length;

    const shellRadius = ATOM_SHELL_RADIUS + (Math.floor(currentElectrons / 8) * 35);
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.02 + Math.random() * 0.015;

    const newElectron = {
        id: Date.now() + Math.random(),
        angle: angle,
        speed: speed,
        radius: shellRadius,
        x: dropX,
        y: dropY
    };

    atomState.electrons.push(newElectron);
    updateElementDisplay();

    if (currentElectrons + 1 > threshold) {
        setTimeout(() => {
            ejectExcessElectron();
        }, 400);
    }
}

const particleButtons = document.querySelectorAll('.particle-btn');

particleButtons.forEach(btn => {
    btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const type = btn.getAttribute('data-type');
        const rect = canvas.getBoundingClientRect();
        
        dragParticle = {
            type: type,
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            pointerId: e.pointerId
        };

        btn.setPointerCapture(e.pointerId);
    });

    btn.addEventListener('pointermove', (e) => {
        if (dragParticle && dragParticle.pointerId === e.pointerId) {
            const rect = canvas.getBoundingClientRect();
            dragParticle.x = e.clientX - rect.left;
            dragParticle.y = e.clientY - rect.top;
        }
    });

    const handlePointerEnd = (e) => {
        if (dragParticle && dragParticle.pointerId === e.pointerId) {
            const dropX = dragParticle.x;
            const dropY = dragParticle.y;
            const type = dragParticle.type;
            dragParticle = null;

            if (type === 'proton') {
                processProtonDrop(dropX, dropY);
            } else if (type === 'neutron') {
                processNeutronDrop(dropX, dropY);
            } else if (type === 'electron') {
                processElectronDrop(dropX, dropY);
            }
        }
    };

    btn.addEventListener('pointerup', handlePointerEnd);
    btn.addEventListener('pointercancel', handlePointerEnd);
});

function render() {
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

    const centerX = atomState.nucleusPosition.x;
    const centerY = atomState.nucleusPosition.y;

    // Render Atom Orbital Shells if atom exists
    if (atomState.exists) {
        // Outer electron orbit shell ring
        ctx.beginPath();
        ctx.arc(centerX, centerY, ATOM_SHELL_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.25)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Nucleus boundary aura
        ctx.beginPath();
        ctx.arc(centerX, centerY, NUCLEUS_CONTAINER_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    // Render Nucleus Particles (Protons and Neutrons)
    nucleusParticles.forEach(p => {
        p.x += (p.targetX - p.x) * 0.2;
        p.y += (p.targetY - p.y) * 0.2;

        ctx.beginPath();
        ctx.arc(p.x, p.y, PROTON_RADIUS, 0, Math.PI * 2);

        if (p.type === 'proton') {
            const grad = ctx.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, PROTON_RADIUS);
            grad.addColorStop(0, '#f87171');
            grad.addColorStop(1, '#dc2626');
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Proton "+" symbol
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 16px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+', p.x, p.y + 1);
        } else { // Neutron
            const grad = ctx.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, NEUTRON_RADIUS);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(1, '#cbd5e1');
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });

    // Render Bound Electrons in Orbit
    atomState.electrons.forEach(el => {
        el.angle += el.speed;
        const targetX = centerX + el.radius * Math.cos(el.angle);
        const targetY = centerY + el.radius * Math.sin(el.angle);

        el.x += (targetX - el.x) * 0.15;
        el.y += (targetY - el.y) * 0.15;

        ctx.beginPath();
        ctx.arc(el.x, el.y, ELECTRON_RADIUS, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(el.x - 2, el.y - 2, 1, el.x, el.y, ELECTRON_RADIUS);
        grad.addColorStop(0, '#60a5fa');
        grad.addColorStop(1, '#2563eb');
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Electron "−" symbol
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('−', el.x, el.y);
    });

    // Render Free Waiting Particles before Atom Creation
    atomState.freeNeutrons.forEach(fn => {
        ctx.beginPath();
        ctx.arc(fn.x, fn.y, NEUTRON_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#e2e8f0';
        ctx.fill();
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 2;
        ctx.stroke();
    });

    atomState.freeElectrons.forEach(fe => {
        ctx.beginPath();
        ctx.arc(fe.x, fe.y, ELECTRON_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = '#3b82f6';
        ctx.fill();
        ctx.strokeStyle = '#93c5fd';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('−', fe.x, fe.y);
    });

    // Render Animated Particles (Bounce Off FX)
    for (let i = animatedParticles.length - 1; i >= 0; i--) {
        const p = animatedParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.alpha -= 0.012;

        if (p.alpha <= 0) {
            animatedParticles.splice(i, 1);
            continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.type === 'electron' ? ELECTRON_RADIUS : PROTON_RADIUS, 0, Math.PI * 2);

        if (p.type === 'proton') {
            ctx.fillStyle = '#ef4444';
        } else if (p.type === 'neutron') {
            ctx.fillStyle = '#e2e8f0';
        } else {
            ctx.fillStyle = '#3b82f6';
        }
        ctx.fill();
        ctx.restore();
    }

    // Render Active Drag Cursor Ghost
    if (dragParticle) {
        ctx.beginPath();
        const radius = dragParticle.type === 'electron' ? ELECTRON_RADIUS : PROTON_RADIUS;
        ctx.arc(dragParticle.x, dragParticle.y, radius + 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    requestAnimationFrame(render);
}

// Initialize application on window load
window.onload = () => {
    resizeCanvas();
    render();
};