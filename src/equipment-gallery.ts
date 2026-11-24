import catalog from '../assets/equipment/catalog.json';
import {equipmentCatalogById as assetsById} from './equipment-catalog';

const files=import.meta.glob<string>('../assets/equipment/*/*/{images/*.webp,models/*.glb}',{eager:true,query:'?url',import:'default'});
const labels={front:'정면',side:'우측면',rear:'후면',iso:'사시도'};
const assetUrl=(name:string)=>files['../assets/equipment/'+name];
type Asset=typeof catalog.equipment[number];
export function createEquipmentGallery(host:HTMLElement){
  const dialog=document.createElement('dialog');
  dialog.className='equipment-gallery';dialog.setAttribute('aria-labelledby','gallery-heading');
  dialog.innerHTML=`<header><h2 id="gallery-heading">장비 도감</h2><button type="button" data-close>닫기</button></header>
    <div class="gallery-selection"><label>공정 <select data-categories aria-label="공정"></select></label><label>장비 선택 <select data-equipment aria-label="장비 선택"></select></label><a download>3D 모델 받기 · GLB</a></div>
    <p class="gallery-reference"></p><p class="gallery-description"></p><div class="gallery-views"></div>
    <button type="button" data-gallery-angles aria-expanded="false">모든 각도 보기</button>
    <p class="gallery-size"></p><p class="gallery-basis"></p>`;
  host.append(dialog);
  const categorySelect=dialog.querySelector<HTMLSelectElement>('[data-categories]')!;
  const select=dialog.querySelector<HTMLSelectElement>('[data-equipment]')!;
  const download=dialog.querySelector('a')!;
  const views=dialog.querySelector('.gallery-views')!;
  const angles=dialog.querySelector<HTMLButtonElement>('[data-gallery-angles]')!;
  let selectedAsset:Asset,allAngles=false;
  for(const category of catalog.categories)categorySelect.add(new Option(category.name,category.id));
  function show(asset:Asset){
    selectedAsset=asset;
    select.value=asset.id;
    dialog.querySelector('.gallery-reference')!.textContent=asset.referenceModel+' · '+(asset.mode==='simulation'?'시뮬레이션 장비':'참조 모델');
    dialog.querySelector('.gallery-description')!.textContent=asset.description;
    dialog.querySelector('.gallery-size')!.textContent='모델 외곽 (폭 × 깊이 × 높이)　'+asset.dimensionsM.map(m=>Math.round(m*1000).toLocaleString('ko-KR')).join(' × ')+' mm';
    dialog.querySelector('.gallery-basis')!.textContent='공개 기준 · '+asset.published+'\n'+asset.dimensionBasis;
    download.href=assetUrl(asset.model);download.download=asset.model.split('/').at(-1)!;
    renderAngles();
  }
  function renderAngles(){
    views.replaceChildren();
    angles.setAttribute('aria-expanded',String(allAngles));
    angles.textContent=allAngles?'대표 각도 보기':'모든 각도 보기';
    const visible:(keyof typeof labels)[]=allAngles?['iso','front','side','rear']:['iso'];
    for(const view of visible){
      const image=new Image();image.alt=selectedAsset.name+' '+labels[view];
      image.src=assetUrl(selectedAsset.images[view].replace(/\.png$/,'.webp'));
      image.width=720;image.height=520;views.append(image);
    }
  }
  function chooseCategory(id:string,selected?:Asset){
    categorySelect.value=id;
    const items=catalog.equipment.filter(asset=>asset.categoryId===id);
    items.sort((a,b)=>a.manufacturer.localeCompare(b.manufacturer,'en')||a.modelName.localeCompare(b.modelName,'en'));
    select.replaceChildren(...items.map(asset=>new Option(asset.referenceModel,asset.id)));
    show(selected??items[0]);
  }
  categorySelect.addEventListener('change',()=>chooseCategory(categorySelect.value));
  select.addEventListener('change',()=>show(assetsById.get(select.value)!));
  angles.addEventListener('click',()=>{allAngles=!allAngles;renderAngles();});
  dialog.querySelector('[data-close]')!.addEventListener('click',()=>dialog.close());
  return (id:string)=>{
    allAngles=false;
    const asset=assetsById.get(id)??catalog.equipment[0];
    chooseCategory(asset.categoryId,asset);dialog.showModal();
  };
}
