import catalog from '../assets/equipment/catalog.json';
import {processTool} from './equipment';

export const equipmentCatalogById=new Map(catalog.equipment.map(item=>[item.id,item]));
export const equipmentModelName=(id:string)=>equipmentCatalogById.get(id)?.referenceModel;

export function fabEquipmentModel(station:string){
  const base=station.split('/')[0];
  if(base.startsWith('buffer-'))return 'daifuku-clean-stocker';
  const kind=base.replace(/-\d+$/,'');
  if(kind==='home'||kind==='stocker')return 'stocker';
  const model=processTool(kind);
  if(model&&'galleryId' in model)return model.galleryId;
  if(['track','scanner','deposition','etch_strip'].includes(kind))return kind;
}
