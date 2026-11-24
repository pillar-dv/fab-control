export interface EquipmentInfo {
  id: string;
  name: string;
  category: string;
  model: string;
  description: string;
  galleryId?: string;
}

export const processTools = {
  clean: {width:4.6, code:'CLN', family:'wet', label:'WET CLEAN', name:'웨이퍼 세정기', model:'SCREEN SU-3400 참조', galleryId:'screen-su-3400', description:'회전 스테이지에서 웨이퍼 표면을 세정하고 건조합니다.'},
  ald: {width:4.7, code:'ALD', family:'vacuum', label:'ATOMIC LAYER', name:'원자층 증착기', model:'ASM Pulsar XP 참조', galleryId:'asm-pulsar-xp', description:'순차적으로 공급한 전구체의 표면 반응으로 얇은 유전체를 형성합니다.'},
  deep_etch: {width:5.4, code:'HARC', family:'vacuum', label:'DEEP CHANNEL', name:'고종횡비 식각기', model:'Lam Research 패턴 식각 구조 참조', galleryId:'lam-kiyo', description:'3D NAND 적층막을 관통하는 높은 종횡비의 채널 홀을 대표합니다. 도감 기종은 구조 참조입니다.'},
  resist_strip: {width:4.4, code:'ASH', family:'vacuum', label:'RESIST STRIP', name:'감광막 제거기', model:'PSK SUPRA 계열 참조', galleryId:'psk-supra', description:'웨이퍼 표면에 남은 감광막을 제거하는 별도 모듈입니다.'},
  implant: {width:5.5, code:'IMP', family:'beam', label:'ION IMPLANT', name:'이온 주입기', model:'Axcelis Purion H 참조', galleryId:'axcelis-purion-h', description:'이온 빔으로 소자 영역의 도핑 농도를 조절합니다.'},
  anneal: {width:4.5, code:'RTP', family:'thermal', label:'RAPID THERMAL', name:'급속 열처리기', model:'Applied Materials Vantage Radiance Plus 참조', galleryId:'applied-materials-vantage-radiance-plus', description:'이온 주입 후 도펀트를 활성화하는 열처리를 표현합니다.'},
  pvd: {width:5.4, code:'PVD', family:'vacuum', label:'SPUTTER / PVD', name:'금속 스퍼터 증착기', model:'Applied Materials Endura PVD 참조', galleryId:'applied-materials-endura-pvd', description:'전극 금속이나 구리 배선용 장벽·시드막을 형성합니다.'},
  plate: {width:4.8, code:'ECD', family:'wet', label:'COPPER FILL', name:'구리 전기도금기', model:'Lam Research SABRE 참조', galleryId:'lam-sabre', description:'시드막 위에 구리를 전기도금해 패턴 내부를 채웁니다.'},
  cmp: {width:5, code:'CMP', family:'polish', label:'CMP / CLEAN', name:'화학기계적 평탄화 장비', model:'Ebara F-REX300XA 참조', galleryId:'ebara-frex300xa', description:'패드와 슬러리로 표면의 돌출부를 연마하고 잔류물을 세정합니다.'},
  inspect: {width:4.2, code:'INS', family:'optics', label:'OPTICAL INSPECT', name:'광학 검사기', model:'KLA 39xx 계열 참조', galleryId:'kla-39xx', description:'표면 결함을 광학적으로 검사하는 공정과 센서 광학 검사 구역을 표현합니다.'},
  probe: {width:4.2, code:'PRB', family:'optics', label:'WAFER PROBE', name:'웨이퍼 프로버', model:'ACCRETECH FP3000W 참조', galleryId:'accretech-fp3000w', description:'프로브를 웨이퍼 전극에 접촉해 다이의 전기적 특성을 측정합니다.'},
  bond: {width:4.9, code:'BND', family:'optics', label:'ALIGN / BOND', name:'웨이퍼 정렬·접합기', model:'EV Group GEMINI FB 참조', galleryId:'evg-gemini-fb', description:'미리 준비된 두 웨이퍼를 정렬하고 접합합니다.'},
  thin: {width:4.4, code:'GRD', family:'polish', label:'BACK GRIND', name:'후면 박형화 장비', model:'웨이퍼 후면 연삭 구조 참조', description:'접합한 웨이퍼의 후면을 얇게 가공합니다.'},
} as const;

export type ProcessToolKind = keyof typeof processTools;
export const processToolKinds = Object.keys(processTools) as ProcessToolKind[];
export function processTool(kind: string) {
  return Object.hasOwn(processTools,kind) ? processTools[kind as ProcessToolKind] : undefined;
}

export const equipment: Record<string, EquipmentInfo> = {
  stocker: {
    id: 'stocker', name: '캐리어 스토커', category: '물류 · 보관', model: 'Muratec Carrier Stocker',
    description: '운반 용기를 랙에 보관하고, 목적 포트가 비면 출고 스테이션으로 꺼냅니다.',
  },
  deposition: {
    id: 'deposition', name: '절연막 증착기', category: '공정 · 박막', model: 'Applied Materials Producer-SE',
    description: '전면 로봇이 웨이퍼를 로드록에 넘기면 진공 로봇이 챔버로 옮깁니다. 웨이퍼 표면에 얇은 절연막을 형성합니다.',
  },
  track: {
    id: 'track', name: '포토 트랙', category: '공정 · 도포 / 현상', model: 'Tokyo Electron LITHIUS',
    description: '감광막을 도포한 웨이퍼를 노광기에 보냅니다. 돌아온 웨이퍼를 현상해 아래 막을 드러냅니다.',
  },
  scanner: {
    id: 'scanner', name: '노광 스캐너', category: '공정 · 노광', model: 'ASML TWINSCAN NXT:1950i',
    description: '웨이퍼 스테이지 위 감광막에 패턴을 투영합니다. 노광 직후에는 막의 두께가 유지됩니다.',
  },
  etch_strip: {
    id: 'etch_strip', name: '식각·제거 클러스터', category: '공정 · 식각 / 제거', model: 'Lam Research FLEX45 / STRIP45',
    description: '세 식각실 중 한 곳에서 드러난 막을 깎고, 제거실에서 남은 감광막을 벗겨냅니다.',
  },
  oht: {
    id: 'oht', name: '천장 운송차', category: '물류 · 반송', model: 'Muratec OHT',
    description: '레일 위에서 정차해 FOUP의 상부 플랜지를 잡고 들어 올립니다. 장비 사이에서는 닫힌 용기를 운반합니다.',
  },
  future_metrology: {
    id: 'future_metrology', name: '계측 예약 공간', category: '시설 · 예약 구역', model: '미설치',
    description: '향후 계측 장비를 설치할 자리입니다. 현재 생산 경로에는 연결되어 있지 않습니다.',
  },
};

for(const id of processToolKinds){
  const tool=processTools[id];
  equipment[id]={...tool,id,category:'공정 · '+tool.name};
}

