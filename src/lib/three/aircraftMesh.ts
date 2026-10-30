import * as THREE from 'three';

// Helper to create 2D text canvas sprite for crisp floating labels
export const createTextSprite = (text: string, color: string, bgColor: string = 'rgba(6, 15, 30, 0.85)') => {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 110;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Sprite();

  // Background pill
  ctx.fillStyle = bgColor;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(8, 8, 368, 94, 20);
  ctx.fill();
  ctx.stroke();

  // Text content
  ctx.fillStyle = color;
  ctx.font = 'bold 36px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 192, 55);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(6, 1.7, 1);
  return sprite;
};

// Build Procedural Aircraft 3D Model with High-Definition Geometry
export const createAircraftMesh = (colorHex: number, accentColorHex: number) => {
  const group = new THREE.Group();

  // Fuselage Body
  const fuselageGeo = new THREE.CylinderGeometry(0.24, 0.32, 3.2, 20);
  fuselageGeo.rotateX(Math.PI / 2);
  const fuselageMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.25,
    metalness: 0.55,
  });
  const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
  group.add(fuselage);

  // Cockpit Nose Cone & Windshield
  const noseGeo = new THREE.ConeGeometry(0.24, 0.9, 20);
  noseGeo.rotateX(-Math.PI / 2);
  const noseMat = new THREE.MeshStandardMaterial({
    color: 0x090d16,
    roughness: 0.15,
    metalness: 0.8,
  });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.z = 2.05;
  group.add(nose);

  // Swept Main Wings with Winglets
  const wingShape = new THREE.Shape();
  wingShape.moveTo(0, 0.6);
  wingShape.lineTo(3.2, -0.9);
  wingShape.lineTo(3.2, -1.25);
  wingShape.lineTo(0, -0.4);
  wingShape.closePath();

  const wingExtrudeSettings = { depth: 0.05, bevelEnabled: false };
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, wingExtrudeSettings);
  wingGeo.rotateX(Math.PI / 2);
  const wingMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.3,
    metalness: 0.45,
  });

  const rightWing = new THREE.Mesh(wingGeo, wingMat);
  rightWing.position.set(0, 0, 0.3);
  group.add(rightWing);

  const leftWing = rightWing.clone();
  leftWing.scale.set(-1, 1, 1);
  group.add(leftWing);

  // Winglets on wingtips (angled upward)
  const wingletGeo = new THREE.BoxGeometry(0.04, 0.4, 0.35);
  const wingletRight = new THREE.Mesh(wingletGeo, wingMat);
  wingletRight.position.set(3.2, 0.18, -0.75);
  group.add(wingletRight);

  const wingletLeft = wingletRight.clone();
  wingletLeft.position.set(-3.2, 0.18, -0.75);
  group.add(wingletLeft);

  // Vertical Stabilizer / Tail Fin
  const finShape = new THREE.Shape();
  finShape.moveTo(-1.2, 0.25);
  finShape.lineTo(-1.6, 1.2);
  finShape.lineTo(-1.85, 1.2);
  finShape.lineTo(-1.7, 0.25);
  finShape.closePath();
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.04, bevelEnabled: false });
  const finMat = new THREE.MeshStandardMaterial({
    color: accentColorHex,
    roughness: 0.25,
    metalness: 0.35,
  });
  const tailFin = new THREE.Mesh(finGeo, finMat);
  tailFin.position.set(-0.02, 0, 0);
  group.add(tailFin);

  // Horizontal Stabilizers
  const hStabShape = new THREE.Shape();
  hStabShape.moveTo(0, 0);
  hStabShape.lineTo(1.2, -0.45);
  hStabShape.lineTo(1.2, -0.65);
  hStabShape.lineTo(0, -0.3);
  hStabShape.closePath();
  const hStabGeo = new THREE.ExtrudeGeometry(hStabShape, { depth: 0.04, bevelEnabled: false });
  hStabGeo.rotateX(Math.PI / 2);
  const hStabRight = new THREE.Mesh(hStabGeo, wingMat);
  hStabRight.position.set(0, 0.25, -1.2);
  group.add(hStabRight);

  const hStabLeft = hStabRight.clone();
  hStabLeft.scale.set(-1, 1, 1);
  group.add(hStabLeft);

  // Twin High-Bypass Jet Engines
  const engineGeo = new THREE.CylinderGeometry(0.18, 0.16, 1.1, 16);
  engineGeo.rotateX(Math.PI / 2);
  const engineMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.3,
    metalness: 0.7,
  });
  const rightEngine = new THREE.Mesh(engineGeo, engineMat);
  rightEngine.position.set(1.2, -0.25, 0.1);
  group.add(rightEngine);

  const leftEngine = rightEngine.clone();
  leftEngine.position.set(-1.2, -0.25, 0.1);
  group.add(leftEngine);

  // Glowing Jet Exhaust Cones
  const exhaustGeo = new THREE.ConeGeometry(0.14, 0.6, 12);
  exhaustGeo.rotateX(Math.PI / 2);
  const exhaustMat = new THREE.MeshBasicMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.65,
  });
  const rightExhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
  rightExhaust.position.set(1.2, -0.25, -0.75);
  group.add(rightExhaust);

  const leftExhaust = rightExhaust.clone();
  leftExhaust.position.set(-1.2, -0.25, -0.75);
  group.add(leftExhaust);

  // Navigation Lights
  // Starboard Green
  const greenLightGeo = new THREE.SphereGeometry(0.08, 12, 12);
  const greenLightMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  const greenLight = new THREE.Mesh(greenLightGeo, greenLightMat);
  greenLight.position.set(3.2, 0, -0.75);
  group.add(greenLight);

  // Port Red
  const redLightGeo = new THREE.SphereGeometry(0.08, 12, 12);
  const redLightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const redLight = new THREE.Mesh(redLightGeo, redLightMat);
  redLight.position.set(-3.2, 0, -0.75);
  group.add(redLight);

  // Beacon Top
  const beaconGeo = new THREE.SphereGeometry(0.06, 10, 10);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff1e1e });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.set(0, 0.42, 0.2);
  group.add(beacon);

  return {
    group,
    rightExhaust,
    leftExhaust,
  };
};
