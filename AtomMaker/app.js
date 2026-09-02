// 원소 데이터 매핑 (1번~20번)
// const ELEMENTS = [
//     null,
//     { symbol: 'H', name: '수소', neutrons: [0] },
//     { symbol: 'He', name: '헬륨', neutrons: [2] },
//     { symbol: 'Li', name: '리튬', neutrons: [4] },
//     { symbol: 'Be', name: '베릴륨', neutrons: [5] },
//     { symbol: 'B', name: '붕소', neutrons: [6] },
//     { symbol: 'C', name: '탄소', neutrons: [6] },
//     { symbol: 'N', name: '질소', neutrons: [7] },
//     { symbol: 'O', name: '산소', neutrons: [8] },
//     { symbol: 'F', name: '플로린', neutrons: [10] },
//     { symbol: 'Ne', name: '네온', neutrons: [10] },
//     { symbol: 'Na', name: '나트륨', neutrons: [12] },
//     { symbol: 'Mg', name: '마그네슘', neutrons: [12] },
//     { symbol: 'Al', name: '알루미늄', neutrons: [14] },
//     { symbol: 'Si', name: '규소', neutrons: [14] },
//     { symbol: 'P', name: '인', neutrons: [16] },
//     { symbol: 'S', name: '황', neutrons: [16] },
//     { symbol: 'Cl', name: '염소', neutrons: [18] },
//     { symbol: 'Ar', name: '아르곤', neutrons: [22] },
//     { symbol: 'K', name: '칼륨', neutrons: [20] },
//     { symbol: 'Ca', name: '칼슘', neutrons: [20] }
// ];

const ELEMENTS = [
    null,
    { symbol: 'H', name: '수소', neutrons: 0 },
    { symbol: 'He', name: '헬륨', neutrons: 2 },
    { symbol: 'Li', name: '리튬', neutrons: 3 },
    { symbol: 'Be', name: '베릴륨', neutrons: 4 },
    { symbol: 'B', name: '붕소', neutrons: 5 },
    { symbol: 'C', name: '탄소', neutrons: 6 },
    { symbol: 'N', name: '질소', neutrons: 7 },
    { symbol: 'O', name: '산소', neutrons: 8 },
    { symbol: 'F', name: '플로린', neutrons: 9 },
    { symbol: 'Ne', name: '네온', neutrons: 10 },
    { symbol: 'Na', name: '나트륨', neutrons: 11 },
    { symbol: 'Mg', name: '마그네슘', neutrons: 12 },
    { symbol: 'Al', name: '알루미늄', neutrons: 13 },
    { symbol: 'Si', name: '규소', neutrons: 14 },
    { symbol: 'P', name: '인', neutrons: 15 },
    { symbol: 'S', name: '황', neutrons: 16 },
    { symbol: 'Cl', name: '염소', neutrons: 17 },
    { symbol: 'Ar', name: '아르곤', neutrons: 18 },
    { symbol: 'K', name: '칼륨', neutrons: 19 },
    { symbol: 'Ca', name: '칼슘', neutrons: 20 }
];

let scene, camera, renderer;
let particles = []; 
let nucleusGroup;
let atomBoundaryMesh;
let stabilityTimer = null;

const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
let draggedType = null;

init();
animate();

function init() {
    const container = document.getElementById('canvas-container');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcccccc); // 배경색을 하얀색으로 지정

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 15);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 15);
    scene.add(directionalLight);

    nucleusGroup = new THREE.Group();
    scene.add(nucleusGroup);

    const boundaryGeo = new THREE.SphereGeometry(3, 32, 32);
    const boundaryMat = new THREE.MeshStandardMaterial({
        color: 0x4da6ff,
        transparent: true,
        opacity: 0.1,
        wireframe: false
    });
    atomBoundaryMesh = new THREE.Mesh(boundaryGeo, boundaryMat);
    atomBoundaryMesh.visible = false;
    scene.add(atomBoundaryMesh);

    setupDragAndDrop();
    window.addEventListener('resize', onWindowResize);
}

function setupDragAndDrop() {
    const btns = document.querySelectorAll('.particle-btn');
    
    btns.forEach(btn => {
        btn.addEventListener('dragstart', (e) => {
            draggedType = e.target.closest('.particle-btn').dataset.type;
            if (stabilityTimer) {
                clearTimeout(stabilityTimer);
                stabilityTimer = null;
            }
        });
    });

    window.addEventListener('dragover', (e) => e.preventDefault());
    
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggedType) return;

        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);
        const vector = new THREE.Vector3(0, 0, 0);
        raycaster.ray.at(10, vector);

        spawnParticle(draggedType, vector);
        draggedType = null;
        updateAtomState();

        if (stabilityTimer) clearTimeout(stabilityTimer);
        stabilityTimer = setTimeout(() => {
            checkAndEjectExcess();
        }, 2000);
    });
}

function spawnParticle(type, pos) {
    let geometry, material;
    
    if (type === 'proton') {
        geometry = new THREE.SphereGeometry(0.4, 32, 32);
        material = new THREE.MeshStandardMaterial({ color: 0xff4d4d });
    } else if (type === 'neutron') {
        geometry = new THREE.SphereGeometry(0.4, 32, 32);
        material = new THREE.MeshStandardMaterial({ color: 0xdddddd });
    } else if (type === 'electron') {
        geometry = new THREE.SphereGeometry(0.2, 32, 32);
        material = new THREE.MeshStandardMaterial({ color: 0x4da6ff });
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(pos);
    scene.add(mesh);

    // 전자를 놓았을 때 강제로 좌표를 바꾸지 않고, 그 자리에 두어 물리 법칙(인력/척력)을 적용받도록 함
    const particleObj = { 
        mesh, 
        type, 
        velocity: new THREE.Vector3(0,0,0), 
        angle: Math.random() * Math.PI * 2,
        isOrbiting: false // 처음엔 궤도 공전 상태가 아님
    };
    particles.push(particleObj);

    // 전자가 핵 내부에 너무 가까이 놓였다면 척력으로 바깥쪽으로 밀어냄
    if (type === 'electron') {
        const nucleusPos = getNucleusCenter();
        if (mesh.position.distanceTo(nucleusPos) < 1.0) {
            particleObj.velocity.set((Math.random()-0.5)*0.3, (Math.random()-0.5)*0.3, 0);
        }
    }
}

function getNucleusCenter() {
    let center = new THREE.Vector3(0,0,0);
    let count = 0;
    particles.forEach(p => {
        if (p.type === 'proton' || p.type === 'neutron') {
            center.add(p.mesh.position);
            count++;
        }
    });
    if (count > 0) center.divideScalar(count);
    return center;
}

function checkAndEjectExcess() {
    const protons = particles.filter(p => p.type === 'proton' && p.velocity.lengthSq() === 0);
    const neutrons = particles.filter(p => p.type === 'neutron' && p.velocity.lengthSq() === 0);

    if (protons.length === 0) return;

    const validProtons = Math.min(protons.length, 20);
    const element = ELEMENTS[validProtons];

    // 중성자 부족 시 양성자 이탈
    if (element && neutrons.length < element.neutrons) {
        const targetProton = protons[protons.length - 1];
        if (targetProton) {
            targetProton.velocity.set(
                (Math.random() - 0.5) * 0.4,
                0.3 + Math.random() * 0.3,
                (Math.random() - 0.5) * 0.4
            );
            updateAtomState()
        }
    }
}

function updateAtomState() {
    const protons = particles.filter(p => p.type === 'proton' && p.velocity.lengthSq() === 0).length;
    const neutrons = particles.filter(p => p.type === 'neutron' && p.velocity.lengthSq() === 0).length;
    const electrons = particles.filter(p => p.type === 'electron' && p.velocity.lengthSq() === 0).length;

    const elementDisplay = document.getElementById('element-display');
    const subDisplay = document.getElementById('sub-display');

    if (protons === 0) {
        elementDisplay.innerText = "원자를 만들어보세요";
        subDisplay.innerText = "사이드바에서 양성자를 먼저 놓아보세요.";
        atomBoundaryMesh.visible = false;
        return;
    }

    const validProtons = Math.min(protons, 20);
    const element = ELEMENTS[validProtons];

    if (element) {
        const charge = validProtons - electrons;
        let chargeStr = "";
        if (charge > 0) chargeStr = `${charge > 1 ? charge : ''}+`;
        else if (charge < 0) chargeStr = `${Math.abs(charge) > 1 ? Math.abs(charge) : ''}-`;

        elementDisplay.innerHTML = `${element.name} (${element.symbol}${chargeStr ? '<sup>' + chargeStr + '</sup>' : ''})`;
        subDisplay.innerText = `양성자: ${validProtons}개 | 중성자: ${neutrons}개 | 전자: ${electrons}개`;
        
        atomBoundaryMesh.position.copy(getNucleusCenter());
        atomBoundaryMesh.visible = true;
    }
}

function animate() {
    requestAnimationFrame(animate);

    const nucleusPos = getNucleusCenter();
    const protons = particles.filter(p => p.type === 'proton' && p.velocity.lengthSq() === 0).length;
    const electrons = particles.filter(p => p.type === 'electron' && p.velocity.lengthSq() === 0);

    particles.forEach((p, index) => {
        // 이미 튕겨 나가고 있는 입자 처리
        if (p.velocity.lengthSq() > 0) {
            p.mesh.position.add(p.velocity);
            if (p.mesh.position.length() > 25) {
                scene.remove(p.mesh);
                particles.splice(index, 1);
                updateAtomState();
            }
            return;
        }

        // 전자의 동적 거동 로직
        if (p.type === 'electron') {
            if (protons === 0) {
                // 양성자가 없으면 전자는 그냥 바깥으로 밀려남
                p.velocity.set((Math.random()-0.5)*0.3, 0.2, 0);
                return;
            }

            const dist = p.mesh.position.distanceTo(nucleusPos);

            // 조건 6: 전자가 너무 많아 과포화된 경우 (예: 수소에 전자가 2개 초과로 너무 많거나 안정 상태를참 초과할 때)
            // 여기서는 간단히 수소나 헬륨 등에서 전자가 과도하게 많으면(예: 3개 이상) 하나씩 밖으로 튕겨 나가게 제어
            if (electrons.length > (protons + 1) && Math.random() < 0.02) {
                p.velocity.set((Math.random() - 0.5) * 0.4, 0.2 + Math.random() * 0.3, 0);
                return;
            }

            if (!p.isOrbiting) {
                // 사용자가 놓은 위치에서 원자핵과의 거리에 따라 인력/척력 적용
                if (dist > 3.5) {
                    // 너무 멀면 인력에 의해 원자핵 쪽으로 끌려감
                    const dir = new THREE.Vector3().subVectors(nucleusPos, p.mesh.position).normalize();
                    p.mesh.position.add(dir.multiplyScalar(0.08));
                } else {
                    // 적당한 거리(궤도 진입 반경)에 도달하면 공전 시작
                    p.isOrbiting = true;
                    // 현재 위치를 기반으로 초기 각도 설정
                    p.angle = Math.atan2(p.mesh.position.y - nucleusPos.y, p.mesh.position.x - nucleusPos.x);
                }
            } else {
                // 궤도 공전 운동
                p.angle += 0.03;
                const radius = 2.5; 
                p.mesh.position.x = nucleusPos.x + Math.cos(p.angle) * radius;
                p.mesh.position.y = nucleusPos.y + Math.sin(p.angle) * radius;
            }
        }
    });

    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}