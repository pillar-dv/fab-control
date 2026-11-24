import {Box3,BufferGeometry,Group,Material,Mesh,Object3D,Texture,Vector3,Matrix4} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {equipmentCatalogById} from './equipment-catalog';

const urls=import.meta.glob<string>('../assets/equipment/*/*/models/*.glb',{eager:true,query:'?url',import:'default'});

type Size=readonly [number,number,number];
type Origin='floor'|'centre';
type LoadedModel={root:Object3D;overview?:Object3D;bounds:Box3};

function release(...roots:Object3D[]){
  const geometries=new Set<BufferGeometry>(),materials=new Set<Material>(),textures=new Set<Texture>();
  for(const root of roots)root.traverse(node=>{
    if(!(node instanceof Mesh))return;
    geometries.add(node.geometry);
    for(const material of [node.material].flat())materials.add(material);
  });
  for(const material of materials){
    for(const property of Object.values(material))if(property instanceof Texture)textures.add(property);
  }
  textures.forEach(texture=>texture.dispose());
  materials.forEach(material=>material.dispose());
  geometries.forEach(geometry=>geometry.dispose());
}

function batchModel(root:Object3D,animatedPart?:string){
  root.updateMatrixWorld(true);
  const local=new Matrix4().copy(root.matrixWorld).invert();
  const groups=new Map<string,Mesh[]>();
  root.traverse(node=>{
    if(!(node instanceof Mesh)||node.children.length||Array.isArray(node.material)||node.material.transparent||node.geometry.groups.length>1)return;
    if(animatedPart)for(let parent:Object3D|null=node;parent;parent=parent.parent)if(parent.name===animatedPart)return;
    const geometry=node.geometry as BufferGeometry;
    const shape=Object.keys(geometry.attributes).sort().map(key=>{
      const attribute=geometry.attributes[key];
      return [key,attribute.itemSize,attribute.normalized].join(':');
    }).join(',');
    const key=[node.material.uuid,!!geometry.index,shape].join('/');
    const group=groups.get(key)??[];
    group.push(node);groups.set(key,group);
  });
  const removed=new Set<BufferGeometry>();
  for(const meshes of groups.values()){
    if(meshes.length<2)continue;
    const copies=meshes.map(mesh=>mesh.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(local,mesh.matrixWorld)));
    const merged=mergeGeometries(copies);
    for(const copy of copies)copy.dispose();
    if(!merged)continue;
    root.add(new Mesh(merged,meshes[0].material));
    for(const mesh of meshes){removed.add(mesh.geometry);mesh.removeFromParent();}
  }
  root.traverse(node=>{if(node instanceof Mesh)removed.delete(node.geometry);});
  removed.forEach(geometry=>geometry.dispose());
}

function overviewModel(root:Object3D,bounds:Box3){
  const overview=root.clone(true);
  overview.updateMatrixWorld(true);
  const size=bounds.getSize(new Vector3());
  const largestFace=Math.max(size.x*size.y,size.x*size.z,size.y*size.z);
  const discard:Mesh[]=[];
  const span=new Box3(),extent=new Vector3();
  overview.traverse(node=>{
    if(!(node instanceof Mesh)||node.children.length)return;
    span.setFromObject(node).getSize(extent);
    const face=Math.max(extent.x*extent.y,extent.x*extent.z,extent.y*extent.z);
    if(face<largestFace*.024)discard.push(node);
    else node.geometry=node.geometry.clone();
  });
  for(const mesh of discard)mesh.removeFromParent();
  if(span.setFromObject(overview).isEmpty())return;
  batchModel(overview);
  return overview;
}

export function createEquipmentModels(batchStatic=false){
  const loader=new GLTFLoader();
  const models=new Map<string,Promise<LoadedModel>>();
  const roots=new Set<Object3D>();
  let disposed=false;
  return {
    async fit(id:string,limit:Size,origin:Origin='floor'){
      const item=equipmentCatalogById.get(id);
      const url=item&&urls['../assets/equipment/'+item.model];
      if(disposed||!url)return;
      let pending=models.get(url);
      if(!pending){
        pending=loader.loadAsync(url).then(({scene})=>{
          const bounds=new Box3().setFromObject(scene);
          if(disposed){release(scene);return {root:scene,bounds};}
          const overview=batchStatic&&id!=='oht'&&id!=='foup'?overviewModel(scene,bounds):undefined;
          if(batchStatic)batchModel(scene,id==='oht'?'gripper':undefined);
          roots.add(scene);if(overview)roots.add(overview);
          return {root:scene,overview,bounds};
        });
        models.set(url,pending);
      }
      try{
        const {root,bounds,overview}=await pending;
        if(disposed)return;
        const size=bounds.getSize(new Vector3()),centre=bounds.getCenter(new Vector3());
        if(bounds.isEmpty()||size.x<=0||size.y<=0||size.z<=0)return;
        const scale=Math.min(limit[0]/size.x,limit[1]/size.y,limit[2]/size.z);
        const model=root.clone(true);
        const fitted=new Group();
        fitted.scale.setScalar(scale);
        fitted.add(model);
        model.position.set(-centre.x,origin==='floor'?-bounds.min.y:-centre.y,-centre.z);
        if(overview){
          model.name='equipment-detail';
          const far=overview.clone(true);far.name='equipment-overview';far.position.copy(model.position);far.visible=false;fitted.add(far);
        }
        fitted.userData.equipmentModel=id;
        return fitted;
      }catch{
        // The scene keeps its fallback geometry if the asset could not be decoded.
      }
    },
    dispose(){
      disposed=true;
      release(...roots);
      roots.clear();models.clear();
    },
  };
}
