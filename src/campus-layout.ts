export const campusSize={width:600,depth:400};
type ZoneLayout={name:string;position:[number,number];size:[number,number,number];color:number;external?:true};
export const campusZones={
  gate:{name:'정문·차량 등록',position:[-264,111],size:[24,18,6],color:0x486e94},
  yard:{name:'트럭 대기장',position:[-240,52],size:[76,45,1],color:0x738aa3},
  receiving:{name:'입고 도크·검수',position:[-159,68],size:[75,43,12],color:0xb46937},
  materials:{name:'자재 창고',position:[-143,8],size:[72,40,15],color:0x537a95},
  quarantine:{name:'격리 창고',position:[-228,-13],size:[50,32,9],color:0xa86066},
  fab:{name:'웨이퍼 팹 A동',position:[-108,-110],size:[141,96,24],color:0x286891},
  fabB:{name:'웨이퍼 팹 B동',position:[66,-110],size:[141,96,24],color:0x37769c},
  reserve:{name:'C동 증설 부지',position:[221,-110],size:[126,96,1],color:0x95abc3},
  sort:{name:'웨이퍼 소트·절단',position:[-43,9],size:[61,43,14],color:0x447da4},
  assembly:{name:'패키지 조립동',position:[61,8],size:[78,48,18],color:0x497798},
  utilities:{name:'중앙 유틸리티',position:[225,9],size:[95,50,15],color:0x56738b},
  test:{name:'공용 시험동',position:[61,105],size:[78,43,16],color:0x806da0},
  packing:{name:'포장·출하동',position:[158,105],size:[62,46,13],color:0x557f77},
  finished:{name:'완제품 창고',position:[243,106],size:[67,43,15],color:0x527e94},
  returns:{name:'반품·고장 분석',position:[-48,105],size:[72,37,11],color:0xa26068},
  supplier:{name:'외부 소재·HBM 공급사',position:[-420,-35],size:[90,52,16],color:0x6e8a9e,external:true},
  distribution:{name:'지역 유통센터',position:[424,-55],size:[104,64,17],color:0x537b90,external:true},
  board:{name:'보드 조립사',position:[424,52],size:[91,58,16],color:0x8b7756,external:true},
  customer:{name:'고객사',position:[424,150],size:[73,50,14],color:0x538082,external:true},
} satisfies Record<string,ZoneLayout>;
export type CampusZone=keyof typeof campusZones;
export type FabSite='fab'|'fabB';
export const fabs=['fab','fabB'] as const;
export const isFabSite=(zone:CampusZone):zone is FabSite=>zone==='fab'||zone==='fabB';
export const isExternal=(zone:CampusZone)=>'external' in campusZones[zone];

export const fabFloors={
  air:{name:'상부 공조층',equipment:'팬필터·급기 덕트'},
  process:{name:'클린룸 생산층',equipment:'공정 장비·로드포트·OHT'},
  subfab:{name:'서브팹',equipment:'진공 펌프·배기·분배 배관'},
  utility:{name:'유틸리티층',equipment:'초순수·냉각·전력 인입'},
} as const;
export type FabFloor=keyof typeof fabFloors;

export const fabBays={
  lithography:{name:'노광 베이',stations:['track','scanner']},
  film:{name:'증착·식각 베이',stations:['deposition','etch_strip','pvd','ald','deep_etch','resist_strip','implant','anneal']},
  surface:{name:'세정·평탄화 베이',stations:['plate','cmp','clean','thin']},
  inspection:{name:'계측·검사 베이',stations:['inspect','probe']},
} as const;
export type FabBay=keyof typeof fabBays;
export function bayFor(station:string):FabBay|undefined{
  const key=station.split('/')[0];
  return (Object.keys(fabBays) as FabBay[]).find(bay=>(fabBays[bay].stations as readonly string[]).includes(key));
}
