import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCarModel } from '../src/carModel.js';
import { loadElantraModel } from '../src/elantraModel.js';
import { loadImportedVehicle } from '../src/importedVehicleModel.js';
import { VEHICLES } from '../src/vehicleCatalog.js';
import { updateLicensePlates } from '../src/licensePlates.js';
const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('preview'),antialias:true});
renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene=new THREE.Scene();scene.background=new THREE.Color('#68747a');
const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(room).texture;room.dispose();pmrem.dispose();
const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.015,50);camera.up.set(0,0,1);
const sun=new THREE.DirectionalLight(0xfff5e8,3);scene.add(sun,sun.target);
const hemi=new THREE.HemisphereLight(0xb9d3e6,0x74716a,1);hemi.position.z=5;scene.add(hemi);
const lamp=new THREE.SpotLight(0xf3f7ff,0,30,.5,.35,2);scene.add(lamp,lamp.target);
const loader=new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
const cache=new Map();let car,busy=false,pending=false;
const ui=Object.fromEntries(['car','side','view','format','light','identity','enabled','report'].map(id=>[id,document.getElementById(id)]));
async function refresh(){if(busy){pending=true;return}busy=true;ui.report.dataset.ready='false';try{
 const selected=Object.fromEntries(['car','side','view','format','light','identity'].map(key=>[key,ui[key].value]));selected.enabled=ui.enabled.checked;
 const id=selected.car;if(car)scene.remove(car);
 car=cache.get(id)??(id==='ferrari'?createCarModel(await loader.loadAsync(VEHICLES[id].asset)):id==='elantra'?await loadElantraModel():await loadImportedVehicle(VEHICLES[id],url=>loader.loadAsync(url)));
 cache.set(id,car);scene.add(car);updateLicensePlates(car,{enabled:selected.enabled,format:selected.format,identity:selected.identity});car.updateMatrixWorld(true);
 const front=selected.side==='front',sign=front?1:-1;
 const rig=car.userData.licensePlates.rigs[front?0:1],center=rig.getWorldPosition(new THREE.Vector3());
 if(selected.view==='whole'){camera.position.set(-3.6,sign*6.9,2.2);camera.lookAt(0,0,.75)}else{camera.position.copy(center).add(new THREE.Vector3(selected.view==='edge'?.75:-.18,sign*(selected.view==='edge'?.4:1.15),.11));camera.lookAt(center)}
 sun.position.set(-3,front?5:-5,selected.light==='grazing'?.6:6);sun.intensity=selected.light==='night'?0:3;hemi.intensity=selected.light==='night'?.025:1;scene.environmentIntensity=selected.light==='night'?.08:.8;
 lamp.position.copy(camera.position);lamp.target.position.copy(center);lamp.intensity=selected.light==='night'?20:0;
 ui.report.textContent=JSON.stringify({car:id,side:selected.side,plate:rig.position.toArray(),fit:rig.userData.fitment,plateDimensions:rig.children.find(o=>o.userData.dimensions)?.userData.dimensions},null,2);
 await new Promise(requestAnimationFrame);renderer.render(scene,camera);
 // Report readiness only after the canvas has reached the compositor. A render
 // submission alone can leave an immediate screenshot showing the prior view.
 await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
 ui.report.dataset.vehicle=id;ui.report.dataset.side=selected.side;ui.report.dataset.format=selected.format;ui.report.dataset.view=selected.view;ui.report.dataset.light=selected.light;ui.report.dataset.identity=selected.identity;ui.report.dataset.enabled=String(selected.enabled);ui.report.dataset.ready='true';
 }catch(e){ui.report.textContent=e.stack;console.error(e)}finally{busy=false;if(pending){pending=false;refresh()}}}
Object.values(ui).forEach(el=>el.addEventListener('change',refresh));
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
renderer.setAnimationLoop(()=>renderer.render(scene,camera));refresh();
