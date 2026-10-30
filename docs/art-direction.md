# BANGCHUL · UI/UX 디자인 기준

## 2026-10-30 · v1.1

이번 사용자 지시서의 외부 디자이너 피드백을 우선합니다. Figma의 `MvvfxH9N2usC8NaAxvo5QF`, 첫 화면 `3:2`의 디자인 컨텍스트/스크린샷과 모션 데이터를 읽어 기존 명조 제목, 작은 워드마크, 밑줄 CTA와 여백을 확인했습니다. Figma 파일은 수정하지 않았습니다. 원안의 숨겨진 안개 도형은 다시 추가하지 않고 현재 앱의 연속 Canvas 연기를 재사용합니다.

- 메인 카피: '시간이 끝나면, 당신의 작품은 공개됩니다.' 짧은 대안 '정한 날, 세상 밖으로.'보다 규칙이 직접적으로 드러나 지시서의 1순위를 채택했습니다.
- 브랜드 슬로건은 보조 계층에 유지. 상단 '방출이 지향하는 약속'과 CTA 바로 아래 로컬 체험/자동 공개 미제공 안내로 미래 가치와 현 기능을 구분합니다.
- A는 차콜 블랙만 사용하고 이미지/연기를 렌더링하지 않습니다. B는 기존 1536×1024 WebP(59,864 bytes)를 수정 없이 사용합니다. 양쪽 카피와 흐름은 동일합니다.
- 모바일은 제목을 3줄로 나누고 텍스트 아래 어두운 베일을 강화합니다. 입력 중에는 배경을 낮게 유지합니다. 첫 화면 연기 강도는 0.85 → 0.55로 줄였습니다.
- 이름/작품/설명 뒤에는 작품명을 다시 보여주는 중앙 정렬 전환 장면을 넣습니다. 타이머·자동 이동·추가 필수 입력 없이 바로 다음/이전으로 이동합니다.
- 첫 등장 0.6초, 나머지 장면 0.5초. 기존 모션 축소, 직접 끄기, 탭 비활성화 정지와 모바일 입자 수/해상도 제한을 유지합니다. 모션 라이브러리는 추가하지 않았습니다.
- `BANGCHUL / 방출`을 유지하며 Expose를 이름·메타데이터에 반영하지 않습니다.

## 2026-10-18 · 이전 스타일보드 구현 이력

기준: 사용자가 2026-10-18에 선택한 [방출 온보딩 UI 스타일보드](https://chatgpt.com/s/m_6ad4ca9d4598819192381b20584de315). 원본을 직접 확인하고 아래 시각 요소를 적용했습니다. 이 선택으로 이전의 이미지 없는 첫 화면 디자인을 교체합니다.

- 검은 배경 `#0B0B0C`, 표면 `#141416`, 아이보리 `#EDEDE8`, 보조 `#8A8A8F`, 따뜻한 포인트 `#C8A477`
- 문틈에서 새어 나오는 빛, 바닥에 낮게 깔린 안개, 첫 화면과 동의 화면에서 강조되는 배경
- 가는 한글 제목과 여백, 작은 영문 워드마크, 상단의 `01 / 06` 번호
- 밑줄 이름/프로젝트 입력창, 얇은 테두리 설명창, 원형 다음 화살표
- 시작일과 종료일, 기간 표시, 마지막 화면의 큰 날짜와 `23:59`
- 500ms opacity/8px 이동. 문턱에서 바깥 바닥으로 이어지는 연속 연기, reduced-motion에서는 모션 제거

스타일보드 아래에는 Pretendard라는 라벨이 있지만, 이미지의 실제 한글 제목은 명조 계열로 보입니다. 시각적 결과에 맞춰 시스템 명조 계열을 사용하고, 본문/입력/버튼에는 시스템 산세리프를 사용했습니다.

실제 공개 서버가 없는 체험 범위는 유지합니다. 스타일보드의 '이 시간이 지나면 공개됩니다'라는 문구는 실제 기능과 맞지 않아 넣지 않았으며, 동의 전에 브라우저 로컬 저장/미공개 안내를 명시했습니다. 기존 `bangchul:mvp:v1` 데이터는 유지되고 시작일이 없는 이전 프로젝트도 복원됩니다.

## 문 밖으로 흐르는 연기

`DoorSmoke.tsx`의 Canvas 2D 효과를 원본 사진 위에 겹쳤습니다. 문턱에서 생성된 연기가 전경 방향으로 넓어지며 왼쪽 바닥으로 흘러가고, 서서히 사라지는 동안 다음 연기가 이어집니다. 사진의 1536×1024 비율과 데스크톱/모바일 배경 크롭을 계산해 시작점이 문에서 벗어나지 않게 했습니다.

- 입력/동의/대시보드에서는 강도를 낮춰 글자와 컨트롤의 가독성을 유지합니다.
- 하단의 '모션 켬/끔'으로 직접 끌 수 있고, 운영체제의 모션 축소 설정을 따릅니다.
- 숨겨진 탭에서는 프레임 요청을 중지합니다. 모바일은 40개, 데스크톱은 64개의 재사용 텍스처를 최대 30fps로 그립니다. 고해상도 캔버스 배율은 1.5로 제한합니다.
- 동영상, 추가 다운로드, 외부 애니메이션 라이브러리는 사용하지 않습니다. 데이터 저장 구조에는 변경이 없습니다.

## 배경 자산

- 생성 방식: 내장 ImageGen. 제공된 스타일보드는 스타일 참조이며 편집 대상/완성 UI 이미지가 아닙니다.
- 저장 자산: `public/art/threshold.webp` (1536×1024, 약 60KB)
- 원본 PNG는 Codex generated_images에 별도 보관합니다. WebP는 동일 구도의 웹용 압축본입니다.
- UI 텍스트, 입력창, 버튼은 모두 React/HTML이며 이미지에 포함되어 있지 않습니다.

생성에 사용한 프롬프트:

> Use case: photorealistic-natural. Asset type: full-bleed website background photograph, landscape 1536x1024. Image 1 is ONLY a style and composition reference, a BANGCHUL UI styleboard; do not reproduce its screens, text, frames or interface. Create a single new clean background scene inspired by the first and sixth phone backgrounds: a very dark, nearly black concrete interior, a tall slightly open architectural door at the RIGHT 75% of the composition with a narrow vertical slit of soft warm ivory light, subtly illuminating a small strip of the rough stone floor. Low soft smoky floor mist drifts along the BOTTOM 20%, dim taupe and charcoal, with film grain. Left 60% and upper area remain almost black with quiet negative space for separately coded text. Door top extends beyond top edge, realistic materials, understated high-end editorial photography, low-key exposure, warm neutral highlights #C8A477 and near-black #0B0B0C, restrained glow, no overly golden flare. Mood: quiet anticipation. NO text, NO lettering, NO logo, NO UI, NO buttons, NO cards, NO frame, NO people, NO objects other than door/wall/floor and mist. This image must work beneath real HTML controls, never render a UI mockup.
