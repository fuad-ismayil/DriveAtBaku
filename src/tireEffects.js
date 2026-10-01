import * as THREE from 'three';

const MARK_LIMIT = 2048, SMOKE_LIMIT = 72, MARK_LIFE = 55;
const clamp = THREE.MathUtils.clamp;

export function createTireEffects(scene) {
  let time = 0, cursor = 0, count = 0, smokeCursor = 0, lastState;
  const previous = Array.from({ length: 4 }, () => ({ point: new THREE.Vector3(), side: new THREE.Vector3(), normal: new THREE.Vector3(), valid: false, heat: 0, credit: 0 }));
  const marksGeometry = new THREE.BufferGeometry();
  const positions = new THREE.Float32BufferAttribute(new Float32Array(MARK_LIMIT * 18), 3).setUsage(THREE.DynamicDrawUsage);
  const markData = new THREE.Float32BufferAttribute(new Float32Array(MARK_LIMIT * 6 * 4), 4).setUsage(THREE.DynamicDrawUsage);
  marksGeometry.setAttribute('position', positions); marksGeometry.setAttribute('markData', markData); marksGeometry.setDrawRange(0, 0);
  const marksMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, forceSinglePass: true,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: `attribute vec4 markData; varying vec4 vMark;
      void main(){vMark=markData;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float time; varying vec4 vMark;
      void main(){float age=time-vMark.z;float edge=smoothstep(0.,.16,vMark.x)*smoothstep(0.,.16,1.-vMark.x);
      float grooves=mix(.65,1.,smoothstep(.08,.24,abs(sin(vMark.x*25.))));
      float alpha=vMark.w*edge*grooves*(1.-smoothstep(25.,${MARK_LIFE.toFixed(1)},age));
      if(alpha<.003)discard;gl_FragColor=vec4(.022,.024,.026,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const marks = new THREE.Mesh(marksGeometry, marksMaterial);
  marks.name = 'tire marks'; marks.frustumCulled = false; marks.renderOrder = 1; scene.add(marks);

  const plane = new THREE.PlaneGeometry(1, 1), smokeGeometry = new THREE.InstancedBufferGeometry();
  smokeGeometry.index = plane.index; smokeGeometry.attributes = plane.attributes; smokeGeometry.instanceCount = SMOKE_LIMIT;
  const centers = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_LIMIT * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const drift = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_LIMIT * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const particles = new THREE.InstancedBufferAttribute(new Float32Array(SMOKE_LIMIT * 4), 4).setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < SMOKE_LIMIT; i++) particles.setXYZW(i, -100, 1, 0, i / SMOKE_LIMIT);
  smokeGeometry.setAttribute('center', centers); smokeGeometry.setAttribute('drift', drift); smokeGeometry.setAttribute('particle', particles);
  const smokeMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } }, transparent: true, depthWrite: false,
    vertexShader: `uniform float time; attribute vec3 center,drift; attribute vec4 particle; varying vec2 vUv; varying vec2 vSmoke;
      void main(){float age=max(0.,time-particle.x),life=age/particle.y;vUv=uv;vSmoke=vec2(life,particle.z);
      vec3 p=center+drift*age+vec3(.025*sin(age*3.+particle.w*12.),0.,.12*age*age);
      vec4 viewCenter=viewMatrix*vec4(p,1.);float radius=mix(.14,.66,clamp(life,0.,1.));
      gl_Position=projectionMatrix*(viewCenter+vec4(position.xy*radius,0.,0.));}`,
    fragmentShader: `varying vec2 vUv;varying vec2 vSmoke;
      void main(){vec2 p=vUv*2.-1.;float soft=exp(-dot(p,p)*4.5)*(1.-smoothstep(.65,1.,length(p)));
      float fade=smoothstep(0.,.14,vSmoke.x)*(1.-smoothstep(.3,1.,vSmoke.x));float alpha=soft*fade*vSmoke.y;
      if(alpha<.002)discard;gl_FragColor=vec4(.58,.60,.62,alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const smoke = new THREE.Mesh(smokeGeometry, smokeMaterial);
  smoke.name = 'subtle tire smoke'; smoke.frustumCulled = false; smoke.renderOrder = 2;
  smoke.userData.excludeFromReflection = true; scene.add(smoke);
  const side = new THREE.Vector3(), forward = new THREE.Vector3(), point = new THREE.Vector3();
  const corners = Array.from({ length: 4 }, () => new THREE.Vector3());
  const stats = { marks: 0, emittedSmoke: 0, activeSmoke: 0, markLimit: MARK_LIMIT, smokeLimit: SMOKE_LIMIT };

  function reset() {
    for (const track of previous) { track.valid = false; track.heat = track.credit = 0; }
    for (let i = 0; i < SMOKE_LIMIT; i++) particles.setZ(i, 0);
    particles.needsUpdate = true; stats.activeSmoke = 0;
  }
  function addMark(track, current, currentSide, normal, width, strength) {
    corners[0].copy(track.point).addScaledVector(track.side, -width / 2).addScaledVector(track.normal, .012);
    corners[1].copy(track.point).addScaledVector(track.side, width / 2).addScaledVector(track.normal, .012);
    corners[2].copy(current).addScaledVector(currentSide, -width / 2).addScaledVector(normal, .012);
    corners[3].copy(current).addScaledVector(currentSide, width / 2).addScaledVector(normal, .012);
    const order = [0, 1, 2, 1, 3, 2], start = cursor * 6;
    for (let i = 0; i < 6; i++) {
      const c = order[i], p = corners[c]; positions.setXYZ(start + i, p.x, p.y, p.z);
      markData.setXYZW(start + i, c % 2, c < 2 ? 0 : 1, time, strength);
    }
    cursor = (cursor + 1) % MARK_LIMIT; count = Math.min(MARK_LIMIT, count + 1); stats.marks++;
    marksGeometry.setDrawRange(0, count * 6); positions.needsUpdate = markData.needsUpdate = true;
  }
  function emit(wheel, state, strength) {
    const i = smokeCursor++ % SMOKE_LIMIT, seed = ((stats.emittedSmoke * 0.618034) % 1);
    centers.setXYZ(i, wheel.contact.x, wheel.contact.y, wheel.contact.z + .09);
    drift.setXYZ(i, clamp(state.velocity.x * .035, -.6, .6) + .06, clamp(state.velocity.y * .035, -.6, .6), .16 + seed * .08);
    particles.setXYZW(i, time, .8 + seed * .35, .11 * strength, seed);
    centers.needsUpdate = drift.needsUpdate = particles.needsUpdate = true; stats.emittedSmoke++;
  }
  function update(dt, state, vehicle, weather, driving, outside = true) {
    time += dt; marksMaterial.uniforms.time.value = smokeMaterial.uniforms.time.value = time;
    if (state !== lastState) { reset(); lastState = state; }
    marks.visible = outside && count > 0;
    const dry = 1 - clamp((weather?.wet ?? 0) / .7 + (weather?.snow ?? 0), 0, 1);
    for (let i = 0; i < previous.length; i++) {
      const track = previous[i], wheel = state?.wheels[i];
      if (!driving || !wheel?.grounded || wheel.load < 150 || wheel.normal.z < .45 || wheel.surfaceMu < .9 || wheel.slideSpeed < 2.5) {
        track.valid = false; track.heat = track.credit = 0; continue;
      }
      point.copy(wheel.contact);
      forward.set(-Math.sin(wheel.steer), Math.cos(wheel.steer), 0).applyQuaternion(state.quaternion);
      side.crossVectors(forward, wheel.normal).normalize();
      const distance = track.point.distanceTo(point), speed = state.velocity.length();
      const continuous = track.valid && distance < Math.max(2, speed * dt * 2 + .5) && wheel.normal.dot(track.normal) > .85;
      if (continuous && distance >= .075) addMark(track, point, side, wheel.normal, vehicle.wheelWidth * .85, clamp((wheel.slideSpeed - 2.5) / 11, 0, 1) * .38 * (.4 + .6 * dry));
      if (!continuous || distance >= .075) { track.point.copy(point); track.side.copy(side); track.normal.copy(wheel.normal); }
      track.valid = true;
      track.heat = Math.min(1, track.heat + dt);
      const smokeStrength = clamp((wheel.slideSpeed - 4.5) / 12, 0, 1) * dry;
      if (track.heat > .18 && smokeStrength > 0) {
        track.credit += smokeStrength * 5 * dt;
        if (track.credit >= 1) { track.credit %= 1; emit(wheel, state, smokeStrength); }
      }
    }
    stats.activeSmoke = 0;
    for (let i = 0; i < SMOKE_LIMIT; i++) if (particles.getZ(i) > 0 && time - particles.getX(i) < particles.getY(i)) stats.activeSmoke++;
    smoke.visible = outside && stats.activeSmoke > 0;
  }
  return { update, reset, stats, dispose() { marks.removeFromParent(); smoke.removeFromParent(); marksGeometry.dispose(); marksMaterial.dispose(); smokeGeometry.dispose(); smokeMaterial.dispose(); } };
}
