import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {preview} from 'vite';

const executablePath=process.env.FAB_BROWSER;
if(!executablePath)throw Error('FAB_BROWSER에 승인된 Chrome 또는 Edge 실행 파일을 지정하세요.');
const device=process.env.FAB_ACCEPTANCE_DEVICE?.trim();
const output=path.resolve('.qa',process.env.FAB_ACCEPTANCE_OUTPUT??'acceptance');
await mkdir(output,{recursive:true});
const server=await preview({preview:{host:'127.0.0.1',port:0,open:false},logLevel:'error'});
const origin='http://127.0.0.1:'+server.httpServer.address().port;
const software=process.env.FAB_SOFTWARE_GL==='1';
let context;
try{
  context=await chromium.launchPersistentContext(path.join(output,'profile-'+Date.now()),{
    executablePath,headless:true,viewport:{width:1920,height:1080},deviceScaleFactor:1,
    args:['--disable-background-networking','--disable-sync','--no-first-run',
      ...(software?['--use-angle=swiftshader','--enable-unsafe-swiftshader']:[])]
  });
  await context.route(/^https?:/,route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(()=>{
    window.fabFrames=[];
    addEventListener('fab:frame',event=>{
      const sample={...event.detail,at:performance.now()};
      window.fabFrame=sample;window.fabFrames.push(sample);
    });
  });
  const page=context.pages()[0];
  const errors=[];
  page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
  const act=id=>page.locator('[data-action="'+id+'"]'),ui=id=>page.locator('[data-ui="'+id+'"]');
  const view=id=>page.locator('[data-camera="'+id+'"]');
  const current=()=>page.evaluate(()=>window.fabFrame);
  const canvas=ui('viewport').locator('canvas');
  const snap=label=>page.screenshot({path:path.join(output,label+'.png')});
  const choose=async id=>{
    await view(id).click();await page.waitForFunction(id=>window.fabFrame?.view===id,id);
  };
  async function start(){
    await page.goto(origin+'/?diagnostics=1');await page.locator('[data-mode-choice="line"]').click();await canvas.waitFor();
    await page.waitForFunction(()=>window.fabFrame?.drawCalls>0);
  }
  async function advanceUntil(label){
    const ok=await act('advance').evaluate((button,label)=>{
      for(let i=0;i<200&&!button.disabled;i++){
        button.click();
        if(document.querySelector('[data-ui="events"] li')?.textContent.includes(label))return true;
      }
      return false;
    },label);
    assert.ok(ok,'이벤트 미도달: '+label);
  }
  async function complete(){
    const stages=await act('advance').evaluate(async button=>{
      const material=document.querySelector('[data-ui="material"]');
      const stages=new Set([material.dataset.stage]);
      for(let i=0;i<250&&!button.disabled;i++){
        button.click();
        if(!stages.has(material.dataset.stage)){
          stages.add(material.dataset.stage);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        }
      }
      return [...stages];
    });
    assert.equal(await ui('status').innerText(),'운전 완료');
    return stages;
  }
  async function orbit(fraction=1){
    const box=await canvas.boundingBox();
    const start=box.x+(box.width-box.height*fraction)/2,y=box.y+box.height*.56;
    await page.mouse.move(start,y);await page.mouse.down();
    try{
      for(let i=1;i<=18;i++)await page.mouse.move(start+box.height*fraction*i/18,y);
    }finally{await page.mouse.up();}
    await page.mouse.move(1,1);
  }
  function angleTravel(samples){
    let total=0;
    for(let i=1;i<samples.length;i++){
      const delta=samples[i].azimuth-samples[i-1].azimuth;
      total+=Math.atan2(Math.sin(delta),Math.cos(delta));
    }
    return Math.abs(total);
  }
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  await start();
  await choose('entry');
  await page.waitForFunction(()=>window.fabFrame?.product==='절연막 패터닝');
  await snap('01-entry-baseline');
  await page.locator('[data-product="cpu"]').click();
  await page.waitForFunction(()=>window.fabFrame?.view==='entry'&&window.fabFrame?.product==='CPU');
  await snap('02-entry-cpu');
  await choose('iso');
  await ui('steps').locator('[data-station="deposition"]').first().click();
  assert.match(await ui('equipment').innerText(),/Producer-SE/);
  await ui('galleryOpen').click();
  const gallery=page.getByRole('dialog',{name:'장비 도감'});
  await gallery.getByAltText('절연막 증착기 정면').waitFor();
  await gallery.getByRole('button',{name:'닫기'}).click();
  await act('edit').click();
  const editor=page.getByRole('dialog',{name:'라인 편집'});
  await editor.locator('[data-machine="probe"]').click();
  await editor.getByRole('button',{name:'복제',exact:true}).click();
  await editor.getByLabel('10단계 처리 장비').selectOption('probe-2');
  await editor.getByRole('button',{name:'라인 적용'}).click();
  assert.match(await ui('steps').innerText(),/PRB-02/);
  await act('follow').click();
  await advanceUntil('슬롯에서 웨이퍼 인출');
  await page.waitForFunction(()=>window.fabFrame?.owner==='atmosphere_robot');
  const startFrame=await current();
  await act('toggle').click();
  await orbit();
  await page.waitForTimeout(650);
  const stopFrame=await current();
  const moving=await page.evaluate(start=>window.fabFrames.filter(f=>f.at>=start),startFrame.at);
  const rotation=angleTravel(moving);
  assert.ok(rotation>=Math.PI*350/180,'회전량 '+rotation);
  assert.ok(stopFrame.time>startFrame.time);
  assert.ok(distance(startFrame.wafer,stopFrame.wafer)>.01);
  for(let i=1;i<moving.length;i++){
    const a=moving[i-1],b=moving[i];
    assert.equal(b.carrier,'FOUP-01');assert.ok(b.time>=a.time);
    assert.ok(distance(a.wafer,b.wafer)<=3.5*(b.time-a.time)+.015,'웨이퍼 이동이 이어져야 합니다.');
  }
  await snap('03-handoff-orbit');
  for(const [mode,direction] of [['top',1],['bottom',-1],['iso',0]]){
    const prior=await current();await choose(mode);
    await page.waitForFunction(t=>window.fabFrame?.time>t,prior.time);
    const after=await current();
    const [x,y,z]=after.target;
    assert.ok(after.cutaway&&distance({x,y,z},after.wafer)<.001);
    if(direction)assert.ok(after.elevation*direction>1.48);
    if(mode==='bottom'){
      assert.equal(after.floorVisible,false);
      assert.ok(after.clippedBelowY<after.wafer.y&&after.wafer.y-after.clippedBelowY<.05);
      await snap('04-wafer-underside');
    }
  }
  const afterViews=await current();
  assert.equal(afterViews.carrier,'FOUP-01');
  assert.ok(afterViews.time>stopFrame.time);
  await complete();
  assert.match(await ui('events').innerText(),/배선 연속성 검사 완료 · PRB-02/);
  assert.equal(await ui('stepCount').innerText(),'10 / 10');

  // A separate navigation starts with the production build's initial state.
  await start();
  await act('toggle').click();
  await act('reset').click();
  assert.equal(await ui('clock').innerText(),'00:00:00');
  assert.equal(await ui('counts').innerText(),'5대 / 4곳');
  await page.locator('[data-carrier="FOUP-02"]').click();
  await act('follow').click();
  const waferStages=await complete();
  assert.deepEqual(waferStages,['initial','deposit','coat','expose','develop','etch','strip']);
  assert.equal(await ui('stepCount').innerText(),'6 / 6');
  assert.match(await ui('equipment').innerText(),/FOUP-02.*슬롯 8/s);
  await act('lab').click();await ui('speed').selectOption('4');
  for(const [condition,opening] of [['standard','0'],['short','0.5']]){
    await page.locator('[data-run="'+condition+'"]').click();
    const result=page.locator('[data-result="'+condition+'"] dd');
    await result.first().waitFor();assert.deepEqual(await result.allTextContents(),[opening,'1']);
  }
  await snap('05-etch-results');
  await act('reset').click();
  assert.equal(await ui('clock').innerText(),'00:00:00');
  assert.equal(await ui('stepCount').innerText(),'0 / 6');
  assert.equal(await page.locator('.lab-result dd').count(),0);
  assert.equal(await page.locator('[data-carrier="FOUP-01"]').getAttribute('aria-pressed'),'true');
  console.log('PASS: 입구 품목 확인 → CPU 선택 → 장비 정보 → 편집 → 인계 회전과 상·하면 → 완주');
  console.log('PASS: 초기 빌드 → FOUP-02 추적 → 식각 비교 → 초기화');

  await choose('iso');await ui('speed').selectOption('1');
  const devtools=await context.newCDPSession(page);
  const browser=await devtools.send('Browser.getVersion');
  await devtools.detach();
  const runtime=await canvas.evaluate(c=>{
    const gl=c.getContext('webgl2');
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    return {userAgent:navigator.userAgent,viewport:[innerWidth,innerHeight],canvas:[c.width,c.height],devicePixelRatio,
      renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
  });
  await act('toggle').click();
  await page.waitForFunction(()=>window.fabFrame?.time>.25);
  const begin=await page.evaluate(()=>performance.now());
  for(let i=0;i<6;i++){
    await page.waitForFunction(end=>performance.now()>=end,begin+i*10_000+400);
    await act('cutaway').click();
    await orbit(.23);
  }
  await page.waitForFunction(end=>performance.now()>=end,begin+60_000,{timeout:65_000});
  const frames=await page.evaluate(begin=>window.fabFrames.filter(f=>f.at>=begin&&f.at<begin+60_000),begin);
  assert.ok(frames.length>1);
  const elapsed=(frames.at(-1).at-frames[0].at)/1000;
  const gaps=frames.slice(1).map((f,i)=>f.at-frames[i].at).sort((a,b)=>a-b);
  const bench={
    seconds:60,renderedFrames:frames.length,averageFps:frames.length/60,
    p95FrameMs:gaps[Math.floor((gaps.length-1)*.95)],maxFrameMs:gaps.at(-1),
    playbackSeconds:frames.at(-1).time-frames[0].time,
    renderedSpanSeconds:elapsed,cutawayChanges:frames.filter((f,i)=>i>0&&f.cutaway!==frames[i-1].cutaway).length,
    travelMeters:frames.slice(1).reduce((n,f,i)=>n+distance(f.vehicle,frames[i].vehicle),0),
    cameraRadians:angleTravel(frames),meets30Fps:frames.length>=1800,
    environment:{...runtime,browser:browser.product,softwareRequested:software,mode:'headless',os:os.platform()+' '+os.release(),cpu:os.cpus()[0]?.model,
      ...(device?{device}:{})}
  };
  assert.ok(bench.travelMeters>1&&bench.cameraRadians>1&&bench.playbackSeconds>58&&bench.cutawayChanges>=5);
  assert.deepEqual(errors,[]);
  const result={integration:{rotationDegrees:rotation*180/Math.PI,cpuSteps:10,fixture:'CPU / PRB-02'},cleanBuild:{carrier:'FOUP-02',waferStages,openings:[0,.5],protected:[1,1],reset:true},bench};
  await writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(!bench.meets30Fps)process.exitCode=1;
}finally{
  await context?.close();await server.close();
}
