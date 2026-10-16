import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createCarModel } from '../../src/carModel.js';
import { loadElantraModel } from '../../src/elantraModel.js';
import { loadImportedVehicle } from '../../src/importedVehicleModel.js';
import { VEHICLES } from '../../src/vehicleCatalog.js';
import { updateLicensePlates, createAzerbaijaniPlate, createPlateGlyph, PLATE_LIGHTING } from '../../src/licensePlates.js';
import { PLATE_LETTERS } from '../../src/licensePlateSettings.js';

export default async function capture(){
  const draco=new DRACOLoader().setDecoderPath('/draco/');const loader=new GLTFLoader().setDRACOLoader(draco);
  const metadata={};
  const plateLibrary=new THREE.Group();
  for(const format of ['long','compact'])for(const identity of ['older','new']){
    const plate=createAzerbaijaniPlate({format,identity});plate.name=`plate_${format}_${identity}`;
    for(const mesh of [...plate.children])if(/Raised black registration|Stamped character shoulders/.test(mesh.name))plate.remove(mesh);
    plateLibrary.add(plate);
  }
  const sizes=[[.045,.077],[.029,.050],[.036,.050],[.015,.010]];
  for(const c of `0123456789${PLATE_LETTERS}-`){
    const glyphs=new THREE.Group(), name=c==='-'?'dash':c;
    for(const [size,[w,h]]of sizes.entries()){
      const glyph=createPlateGlyph(c,w,h);glyph.name=`glyph_${size}_${name}`;glyphs.add(glyph);
    }
    const bytes=await new GLTFExporter().parseAsync(glyphs,{binary:true});
    await fetch(`/__native_export/plate_glyph_${name}.glb`,{method:'POST',body:bytes});
  }
  const library=await new GLTFExporter().parseAsync(plateLibrary,{binary:true});
  await fetch('/__native_export/plate_library.glb',{method:'POST',body:library});
  for(const [id,settings]of Object.entries(VEHICLES)){
    console.log(`Preparing native ${id}…`);
    const car=id==='elantra'?await loadElantraModel():settings.wheelAsset?await loadImportedVehicle(settings,url=>loader.loadAsync(url)):createCarModel(await loader.loadAsync(settings.asset));
    const wheels=car.userData.wheels??[];
    metadata[id]={wheels:wheels.map((w,i)=>{w.steerPivot.name=`steer_${i}`;w.spinPivot.name=`spin_${i}`;return {index:w.physicsIndex,base_y:w.baseY,spin_direction:w.spinDirection??1};})};
    metadata[id].plate_mounts={};
    metadata[id].plate_lights=[];
    const mounts=new THREE.Group();mounts.name='native_plate_mounts';
    for(const format of ['long','compact']){
      updateLicensePlates(car,{format,identity:'older'});
      metadata[id].plate_mounts[format]=[];
      for(const [i,rig]of car.userData.licensePlates.rigs.entries()){
        const mount=rig.clone(true);mount.name=`native_mount_${format}_${i}`;
        rig.traverse(light=>{if(light.isSpotLight)metadata[id].plate_lights.push({mount:mount.name,position:light.position.toArray(),target:light.target.position.toArray(),color:light.color.toArray(),energy:PLATE_LIGHTING.intensity,range:light.distance,angle:light.angle,penumbra:light.penumbra,decay:light.decay});});
        // GLTF cannot preserve Three's separate spotlight target or its live
        // on/off controller. Rebuild these actual lights from explicit metadata.
        const exportedLights=[];mount.traverse(o=>{if(o.isLight)exportedLights.push(o);});
        for(const light of exportedLights)light.removeFromParent();
        for(const child of [...mount.children])if(child.userData?.settings&&child.userData?.dimensions)mount.remove(child);
        metadata[id].plate_mounts[format].push(mount.name);mounts.add(mount);
      }
    }
    for(const rig of car.userData.licensePlates.rigs)rig.removeFromParent();
    car.add(mounts);
    const groups=[['paint',car.userData.paintMaterials??[]],['headlight',car.userData.headlightMaterials??[]],['brake',Array.isArray(car.userData.brakeLights)?car.userData.brakeLights:car.userData.brakeLights?[car.userData.brakeLights]:[]],['reverse',car.userData.reverseLightMaterials??[]]];
    const traits=new Map();
    for(const [role,mats]of groups)for(const [i,m]of mats.entries()){
      if(!traits.has(m)){traits.set(m,{roles:[]});m.name=`native_${role}_${i}`;}
      traits.get(m).roles.push(role);
    }
    car.updateMatrixWorld(true);
    const inverse=car.matrixWorld.clone().invert();
    metadata[id].indicators=(car.userData.indicators?.records??[]).map((record,i)=>{
      const role=record.material.name, name=`native_indicator_${i}`;
      record.material.name=name;
      return {name,role,mask:record.mask,rest_mask:id==='ferrari'&&record.mesh.name==='headlight_covers'?'0.0':id==='ferrari'&&record.mesh.name==='leds'?'(step(0.9, abs(signalPosition.x)) * step(abs(signalPosition.x), 1.0))':record.mask,to_vehicle:inverse.clone().multiply(record.mesh.matrixWorld).toArray()};
    });
    // A material may be both brake and reverse. Names are identities, not roles.
    // Keep callbacks' authored local-coordinate masks as explicit export data.
    metadata[id].lights=[];
    for(const [material,trait]of traits)if(trait.roles.some(role=>role!=='paint')){
      metadata[id].lights.push({name:material.name,...trait,color:material.emissive.toArray(),
        scale:material.userData.headlightScale??1,high_only:Boolean(material.userData.highBeamOnly),
        emission_mask:material.userData.lampEmissionMask??'1.0',
        reverse_mask:material.userData.reverseEmissionMask??'1.0',
        reverse_overlay:Boolean(material.userData.reverseLightLevel)});
    }
    const water=new Map(), paints=new Set(car.userData.paintMaterials??[]);
    car.traverse(mesh=>{
      if(!mesh.isMesh)return;
      for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
        const glass=m.userData.vehicleWaterGlass??(m.transparent&&m.opacity>=.1&&m.roughness<.35);
        if(m.userData.vehicleWaterExcluded||(!paints.has(m)&&!glass&&!m.userData.vehicleWaterExterior)||m.name.startsWith('native_indicator_')||traits.get(m)?.roles.some(role=>role!=='paint'))continue;
        if(!m.name)m.name=`native_water_${water.size}`;
        water.set(m.name,{name:m.name,glass:Boolean(glass)});
      }
    });
    metadata[id].water=[...water.values()];
    car.traverse(o=>{
      o.userData={};
      if(o.isMesh){
        // Godot 4.6's importer needs float vertex attributes. The Elantra uses
        // normalized Int16 normals in the web loader; expand them before export.
        for(const [name,a]of Object.entries(o.geometry.attributes))if(!(a.array instanceof Float32Array)){
          const floats=new Float32Array(a.count*a.itemSize);
          for(let i=0;i<a.count;i++)for(let j=0;j<a.itemSize;j++)floats[i*a.itemSize+j]=a.getComponent(i,j);
          o.geometry.setAttribute(name,new THREE.BufferAttribute(floats,a.itemSize));
        }
        for(const m of Array.isArray(o.material)?o.material:[o.material])m.userData={};
      }
    });
    car.position.set(0,0,0);car.quaternion.identity();const root=new THREE.Group();root.rotation.x=-Math.PI/2;root.add(car);root.updateMatrixWorld(true);
    const bytes=await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:true,maxTextureSize:1024});
    const response=await fetch(`/__native_export/${id}.glb`,{method:'POST',body:bytes});if(!response.ok)throw new Error(`Could not save ${id}`);
  }
  await fetch('/__native_export/metadata.json',{method:'POST',body:JSON.stringify(metadata)});draco.dispose();window.__nativeCaptureDone=true;
}
