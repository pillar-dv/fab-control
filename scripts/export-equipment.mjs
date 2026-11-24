import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { build } from 'vite';

const executablePath=process.env.FAB_BROWSER;
if(!executablePath)throw new Error('FAB_BROWSER에 승인된 Chrome 또는 Edge 경로를 지정하세요.');
const assets=path.resolve('assets/equipment'),bundle=path.resolve('.qa/studio-build');
await build({configFile:false,publicDir:false,logLevel:'error',build:{outDir:bundle,emptyOutDir:false,
  lib:{entry:'scripts/equipment-studio.ts',name:'EquipmentStudio',formats:['iife'],fileName:()=>'studio.js'}}});
const script=await readFile(path.join(bundle,'studio.js'));
const server=createServer((req,res)=>{
  if(req.url==='/studio.js'){res.setHeader('Content-Type','text/javascript');res.end(script);}
  else if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><div id="fab" style="width:32px;height:32px"></div><script src="/studio.js"></script>');}
  else{res.statusCode=404;res.end();}
});
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
let context;
try {
  context=await chromium.launchPersistentContext(path.resolve('.qa/studio-profile'),{executablePath,headless:true,
    args:['--disable-background-networking','--disable-sync','--no-first-run','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  await context.route(/^https?:/,r=>new URL(r.request().url()).origin===url?r.continue():r.abort());
  const page=context.pages()[0];
  page.on('pageerror',e=>console.error(e.message));
  await page.goto(url);
  const ids=await page.evaluate(()=>EquipmentStudio.equipmentIds);
  const interfaceChecks=await page.evaluate(()=>EquipmentStudio.verifyInterfaces());
  if(process.argv.includes('--verify')){
    console.log(JSON.stringify(interfaceChecks));
  }else{
    const categories=await page.evaluate(()=>EquipmentStudio.catalogCategories);
    const catalog={units:'m',dimensionOrder:['width','depth','height'],axes:'Y up; front camera +Z, right +X, rear -Z',categories,interfaceChecks,equipment:[]};
    const results=[];
    for(const id of ids){
      const result=await page.evaluate(id=>EquipmentStudio.generate(id),id);
      results.push(result);
      catalog.equipment.push(result.metadata);
      console.log(id+' · '+Object.keys(result.images).length+' PNG 및 GLB 검증');
    }
    const files=new Map();
    for(const {base64,images,webp,metadata} of results){
      files.set(metadata.model,base64);
      for(const [view,png] of Object.entries(images))files.set(metadata.images[view],png);
      for(const [view,image] of Object.entries(webp))files.set(metadata.images[view].replace(/\.png$/,'.webp'),image);
    }
    if(new Set(ids).size!==ids.length||files.size!==ids.length*9)throw Error('장비 경로가 중복됩니다.');
    for(const [file,data] of files){
      if(!/^[a-z0-9-]+\/[a-z0-9-]+\/(images|models)\/[a-z0-9_-]+\.(png|webp|glb)$/.test(file))throw Error('장비 경로가 올바르지 않습니다. '+file);
      const dest=path.join(assets,file);
      await mkdir(path.dirname(dest),{recursive:true});
      await writeFile(dest,Buffer.from(data,'base64'));
    }
    await writeFile(path.join(assets,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
    const guidePath=path.resolve('docs','공정별 반도체 장비 도감.md');
    await mkdir(path.dirname(guidePath),{recursive:true});
    await writeFile(guidePath,renderGuide(catalog));
  }
}finally{
  try{await context?.close();}finally{await new Promise(resolve=>server.close(resolve));}
}

function renderGuide(catalog){
  const count=catalog.equipment.length;
  const nameFor={front:'정면',side:'우측면',rear:'후면',iso:'사시도'};
  const assetLink=(label,file)=>`[${label}](../assets/equipment/${file})`;
  const sections=catalog.categories.map(category=>{
    const list=catalog.equipment.filter(e=>e.categoryId===category.id)
      .sort((a,b)=>a.manufacturer.localeCompare(b.manufacturer,'en')||a.modelName.localeCompare(b.modelName,'en'));
    const manufacturers=Map.groupBy(list,e=>e.manufacturer);
    return [
      '## '+category.name,
      category.description,
      ...Array.from(manufacturers,([name,assets])=>'### '+name+'\n\n'+assets.map(e=>{
        const files=Object.entries(e.images).map(([k,file])=>assetLink(nameFor[k],file)).concat(assetLink('GLB',e.model));
        const source=e.sources.map((s,i)=>`[공개 출처${e.sources.length>1?' '+(i+1):''}](<${s}>)`);
        const dimensions=e.dimensionsM.map(m=>String(Math.round(m*1000)).replace(/\B(?=(\d{3})+(?!\d))/g,',')).join(' × ');
        const status=e.mode==='simulation'?'생산라인 시뮬레이션에 사용':'도감 참조 모델';
        return `- **${e.modelName}** · ${e.name} · ${status}\n  ${e.description} 공개 기준은 ${e.published.replace(/[.。]$/,'')}이다. 모델 외곽은 ${dimensions} mm(폭 × 깊이 × 높이)다. ${e.dimensionBasis} ${[...files,...source].join(' · ')}`;
      }).join('\n'))
    ].join('\n\n');
  });
  return [
    '# 공정별 반도체 장비 도감',
    `장비 ${count}종을 웨이퍼의 이동과 가공 순서에 따라 배치하고, 같은 공정 안에서 제조사별로 묶었다. 장비별 정면·우측면·후면·사시도는 동일한 3D 모델에서 같은 직교 축척으로 렌더링했다. 설치 치수는 각 항목의 공개 기준과 모델 외곽을 함께 읽는다. [장비 에셋 검수 기록](../assets/equipment/README.md)`,
    '공정은 소자와 레이어에 따라 반복하거나 갈라진다. 도포 → 노광 → 현상은 연속 흐름이며, 세정·계측은 여러 단계에서 재사용된다. 후공정에서는 웨이퍼·다이·패키지의 운반 단위가 바뀐다. 장비의 **도감 참조 모델** 표시는 공정 배치·제어·로봇 호환성 검증이 별도로 필요한 3D 에셋을 뜻한다. [글로벌 팹 공개자료 조사](<글로벌 반도체 팹 공개자료 조사.md>)',
    '장비별 폴더는 `assets/equipment/<공정>/<제조사-기종>/`에 있다. `images/`에서 PNG를, `models/`에서 GLB를 연다. [장비 색인](../assets/equipment/catalog.json)',
    ...sections
  ].join('\n\n')+'\n';
}
