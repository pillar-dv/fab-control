# 장비 에셋과 5단계 검수 기록

생산라인에 쓰는 모델을 장비별 GLB로 내보내고, 그 파일을 다시 열어 정면·우측면·후면·사시도를 렌더링했다. 길이 단위는 m이며 위쪽은 +Y다. 장비 정면은 +Z, 우측은 +X로 맞췄다. FOUP의 정면은 문 쪽이다. OHT의 정면 이미지는 긴 차체와 벨트가 보이는 측판 쪽이다. 각 장비의 네 이미지는 같은 직교 축척을 쓰며, 서로 다른 장비의 크기는 이미지 왼쪽 아래 축척 막대로 비교할 수 있다.

## 기본 생산라인 장비 목록

폴더는 `<공정>/<제조사-기종>/images`와 `models`로 구성한다. 기존 11종과 추가 장비를 모두 찾으려면 공정별 도감을 연다. GLB 외곽은 기준 자세에서 폭·깊이·높이 순으로 측정했다. [공정별 반도체 장비 도감](<../../docs/공정별 반도체 장비 도감.md>) · [장비 색인](catalog.json)

- **절연막 증착기** · 조작면과 로드포트 뒤 전면 이송 구역, 로드록, 진공 챔버를 확인한다. [사시도](deposition/applied-materials-producer-se/images/iso.png) · [모델](deposition/applied-materials-producer-se/models/deposition.glb)
- **포토 트랙** · 도포와 현상에 쓰는 모듈, 노광기로 이어지는 웨이퍼 인계를 확인한다. [사시도](coat-develop/tel-clean-track-lithius/images/iso.png) · [모델](coat-develop/tel-clean-track-lithius/models/track.glb)
- **노광 스캐너** · 스테이지와 트랙 쪽 연결부를 확인한다. 이 장비에 FOUP가 직접 도킹하는 포트는 없다. [사시도](lithography/asml-twinscan-nxt-1950i/images/iso.png) · [모델](lithography/asml-twinscan-nxt-1950i/models/scanner.glb)
- **식각·제거 클러스터** · 식각실 세 곳과 제거실 한 곳의 구성, 통로를 향한 전면을 확인한다. [사시도](etch/lam-flex45-strip45-aeo20/images/iso.png) · [모델](etch/lam-flex45-strip45-aeo20/models/etch_strip.glb)
- **캐리어 스토커** · 보관 랙 전면에서 OHT 인계대로 FOUP가 나온다. [사시도](handling/muratec-carrier-stocker/images/iso.png) · [모델](handling/muratec-carrier-stocker/models/stocker.glb)
- **천장 운송차** · 차체, 두 승강 벨트와 파지부를 확인한다. GLB에 정차 중 하강·인양 동작이 들어 있다. [사시도](handling/muratec-src350-oht/images/iso.png) · [모델](handling/muratec-src350-oht/models/oht.glb)
- **FOUP** · 25개 슬롯 열, 앞문과 상부 플랜지를 확인한다. GLB에서 앞문 개폐를 재생할 수 있다. [사시도](handling/entegris-a300/images/iso.png) · [모델](handling/entegris-a300/models/foup.glb)
- **로드포트** · FOUP 받침, 정렬 핀, 앞문이 통과하는 프레임을 확인한다. [사시도](handling/tdk-tas300-j1/images/iso.png) · [모델](handling/tdk-tas300-j1/models/load_port.glb)
- **전면 이송 로봇** · 대기압에서 열린 FOUP와 로드록 사이를 오가는 포크를 확인한다. [사시도](handling/brooks-marathon-2-efem/images/iso.png) · [모델](handling/brooks-marathon-2-efem/models/efem_robot.glb)
- **진공 이송 로봇** · 진공 측 베이스와 로드록·공정실 사이의 인계를 확인한다. [사시도](handling/brooks-marathon-2-vacuum/images/iso.png) · [모델](handling/brooks-marathon-2-vacuum/models/vacuum_robot.glb)
- **트랙 이송 로봇** · 이동식 베이스와 웨이퍼 포크를 확인한다. 세 로봇의 GLB에 기본 시나리오에서 추출한 인계 동작이 들어 있다. [사시도](handling/tel-lithius-track-robot/images/iso.png) · [모델](handling/tel-lithius-track-robot/models/track_robot.glb)

## 공개 자료 대조와 치수 가정

- FOUP 외곽은 **426 × 355 × 338 mm**, 25장형 슬롯 피치는 **10 mm**다. 로드포트 폭은 **472 mm**, 전체 높이는 **1,386 mm**, 장착면에서의 돌출 길이는 **493 mm**다. FOUP 받침 높이 **900 mm**와 문 후퇴·하강 거리는 프로젝트 설정이다. [프로젝트 치수 기준과 제조사 자료](../../fab-model-reference.json)
- 공정 장비는 조사 문서의 장비 유형, 웨이퍼 경로, 챔버 구성에 맞췄다. 외장 패널의 분할, 조작면 위치, 로봇 관절과 정비 여유는 개념 배치다. 모델 외곽, 장비 설치 예약 영역, 제조사 치수는 각각 측정 기준이 다르다. [프로젝트 장비 소개](<../../docs/300 mm 팹 장비 소개.md>)
- 건물 단면은 생산층 위에 급기 덕트와 팬필터를, 아래에는 증착·식각 챔버와 연결되는 진공 배관과 펌프를 배치했다. 레일 높이 4 m, 생산층 0~6 m, 서브팹 −4~0 m, 공조층 6~8 m는 프로젝트의 높이 기준이다. [건물 단면 자료 및 설계 좌표](../../fab-model-reference.json)

## 로컬 검수 결과

- **파일과 축척** · 기본 생산라인 장비 11종으로 진행한 5단계 검수에 이어, 도감 전체의 GLB 저장 전후 외곽을 0.1 mm 허용 오차로 대조했다. 각 모델의 네 이미지에 같은 직교 투영 높이를 적용했다.
- **공정별 도감** · 로컬 Chrome에서 공정 17개를 전환하며 28개 제조사의 GLB 45개와 PNG 180장을 열었다. 기존 11종의 라인 장비 ID와 가동 동작을 유지했다. 추가 34종은 공개 기능을 바탕으로 제작한 도감용 개념 모델이다. [공정별 반도체 장비 도감](<../../docs/공정별 반도체 장비 도감.md>) · [브라우저 검증](../../tests/browser.smoke.mjs)
- **FOUP 문과 인양** · 문이 장비 쪽으로 빠진 뒤 내려가는 경로에서 101개 자세를 검사했다. 문의 외곽과 로드포트 고정 부품 외곽이 겹치지 않았다. 스토커·증착기·트랙·식각기에서 안착 높이부터 인양 높이까지 FOUP가 차지하는 수직 공간도 확인했다. 의도된 접촉부인 정렬 핀은 인양 간섭 검사에서 제외했다.
- **로봇 인계** · 기본 시나리오의 두 FOUP를 0.25초 간격으로 추적했다. 다섯 장착 위치에서 219개 이송 자세를 뽑아 포크 중심이 목표 웨이퍼 아래 9 mm에 있는지 확인했다. 관절별 실제 도달 한계와 챔버 내부 전체의 충돌 여부는 설치 기구 검수 대상이다. [자동 검사 수치](catalog.json)
- **공정 단면** · 기본 시나리오를 끝까지 재생해 증착 후 절연막, 도포 후 감광막, 노광 후 노광 영역, 현상 후 개구부, 식각 후 드러난 절연막의 제거, 감광막 제거 후 절연막 패턴을 순서대로 확인했다. 기준 식각 후 개구부의 상대 잔량은 0, 짧은 식각 후에는 0.5이며 보호 영역은 양쪽 모두 1이다. [시뮬레이션 테스트](../../tests/simulation.test.ts) · [브라우저 검증](../../tests/browser.smoke.mjs)

## 현장 검수 대기

**2026-11-22 프로젝트 자료 대조** · 장비 소개, 모델링 기준과 기본 라인을 기준으로 5단계 단계 확인을 재실행했다. 북열의 스토커·증착기·트랙 포트는 남향, 남열의 식각·제거 포트는 북향이다. 각 인계점은 해당 레일 정차점의 수직 아래에 있다. 두 웨이퍼 모두 증착기에서 슬롯 → 대기 로봇 → 로드록 → 진공 로봇 순으로 인계됐다. 여섯 공정 직후의 감광막 상태와 개구부·보호 영역 잔량을 각각 대조했다. 101개 문 자세와 219개 포크 자세도 다시 검사했다. [기준 단면과 인계 순서 검증](../../tests/line-layout.test.ts)

공정·설비 검수자와의 대조는 아직 진행하지 않았다. 현장 도면이나 측정값이 확보되면 아래 항목에 대상 장비와 도면 판본, 측정값, 판정, 확인일을 기록한다.

- 포트 전면 방향, 장착 기준면, FOUP 플랜지 파지점과 문 수납 공간
- 전면 로봇 → 로드록 → 진공 로봇 인계 순서와 각 관절의 도달 범위
- 트랙·스캐너 브리지 형상 및 식각·제거 챔버 방향
- 여섯 공정의 기준 웨이퍼 단면과 실제 장비 외곽·정비 여유
