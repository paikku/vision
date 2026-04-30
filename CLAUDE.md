# CLAUDE.md

이 문서는 이 저장소에서 작업하는 에이전트/개발자를 위한 **공식 작업 가이드**입니다.

## 1) 실행 명령어

```bash
npm run dev        # 개발 서버 실행 (localhost:3000)
npm run build      # 프로덕션 빌드 + 타입 체크
npm run typecheck  # tsc --noEmit
npm run lint       # next lint 기반 ESLint
```

> 현재 별도 테스트 러너(jest/vitest 등)는 구성되어 있지 않습니다.

---

## 2) 아키텍처 개요

- **Stack**: Next.js 15 (App Router), React 19, Zustand 5, Tailwind v4, TypeScript(strict)
- 앱 진입점은 `/` → `/projects` 리디렉션(`app/page.tsx`).
- 데이터 모델은 **Project ▸ {Resource Pool, Image Pool, LabelSet[]}** — 한 이미지가 여러 라벨셋에 N:M 으로 속할 수 있고, 각 라벨셋은 task type(`bbox` / `polygon` / `classify`) 하나를 가진다.
- 라우트 구성:
  - `/projects` — 프로젝트 목록/생성/삭제 (`ProjectsPage`)
  - `/projects/[id]` — 프로젝트 detail 3-탭 shell (`ProjectDetailPage`)
    - **Resource Pool**: 동영상 / 이미지 묶음 업로드 단위
    - **Image Pool**: 프로젝트 전체 이미지(직접 업로드 + 비디오에서 추출) 풀
    - **Label Sets**: 이미지를 골라 만든 라벨링 단위
  - `/projects/[id]/resources/[rid]/extract` — 비디오 리소스에서 프레임을 추출해 image pool로 흘려넣는 페이지 (`FrameExtractionPage`)
  - `/projects/[id]/labelsets/[lsid]` — 라벨링 워크스페이스 (`LabelingWorkspace`). 라벨셋의 task type에 따라 stage / classify 패널이 갈라짐.

### Feature 경계 (중요)

코드는 feature 단위로 분리되어 있고, 경계는 ESLint `no-restricted-imports`로 강제됩니다.
**경계 규칙 전체 스펙은 `/REFACTOR_RULES.md` 참고.** 작업 전 반드시 읽을 것.

```text
src/
  components/           # shell · 여러 feature 조합하는 유일한 자리
                        # ProjectsPage, ProjectDetailPage,
                        # UploadResourceModal, CreateLabelSetModal,
                        # FrameExtractionPage, LabelingWorkspace,
                        # useLabelSetSync
  features/
    media/              # 업로드·normalize·비디오 재생·프레임 추출 파이프라인
    frames/             # 프레임/이미지 strip · 활성 프레임 · exception
    annotations/        # class·shape·tool·drawing·classify·keyboard
    export/             # 직렬화/다운로드
    projects/           # 프로젝트·리소스·이미지·라벨셋 서버 API 래퍼 (fetch 기반, store 비의존)
  shared/               # 순수 유틸·범용 훅
  lib/
    store.ts            # 슬라이스 합성 루트 (useStore 공개 API)
    server/storage.ts   # 서버 전용 파일시스템 persistence helper
```

- 크로스 feature 로직은 **shell(components/) 또는 `lib/store.ts` composition root**에만.
- Feature의 public 표면은 `features/<A>/index.ts` 배럴 + `types.ts`.
- Service (`features/<A>/service/*`)는 외부 IO 전담, store 접근 금지.
- 자세한 import 허용/금지 매트릭스는 `REFACTOR_RULES.md` §2.

### 도메인 모델 (서버 truth)

```text
Project
 ├─ Resource[]            (kind: "video" | "image_batch")
 │   └─ source bytes + preview-N.jpg (video only, hover-reel)
 ├─ Image[]               project-level pool — N:M 로 LabelSet 에 묶임
 │   └─ resourceId, source: "uploaded" | "video_frame", timestamp?
 └─ LabelSet[]            (taskType: "bbox" | "polygon" | "classify")
     ├─ imageIds[]        풀에서 골라온 멤버십 (정렬 의미 있음)
     └─ data.json         { classes, annotations, classifications }
```

- **Resource**: 업로드 단위. video 면 `source.<ext>` + 선택적 `preview-{0..N}.jpg`, image_batch 면 자식 image 들로만 표현(소스 바이트는 image 쪽).
- **Image**: 프로젝트 전역 풀. 업로드 원본(`source: "uploaded"`)이거나 비디오에서 추출된 프레임(`source: "video_frame"` + `timestamp`).
- **LabelSet**: `imageIds[]` 로 풀에서 멤버를 고르고 `taskType` 하나를 선언. `bbox`/`polygon` 은 shape annotation, `classify` 는 image-level classification 만 사용.
- **Annotation/Classification**: 각각 `imageId` 로 image 를 참조. 한 이미지가 여러 라벨셋에 들어가도 각 라벨셋의 annotation/classification 은 독립이다.

### 데이터 흐름 (워크스페이스 두 화면)

워크스페이스 store(`useStore`)는 **양 페이지가 공유**하지만 hydrate 내용이 다르다.

```text
FrameExtractionPage (/resources/[rid]/extract)
  media (video MediaSource) → frames[] (이 resource 가 만든 image_meta 들 + 인플라이트 blob)
  → addFrames() 가 store 에 들어가면 effect 가 blob 을 서버로 업로드하고 url 을 server url 로 교체

LabelingWorkspace (/labelsets/[lsid])
  frames[] (이 라벨셋의 imageIds 순서대로 ImageMeta → Frame 으로 변환)
  classes / annotations / classifications / taskType
  → useLabelSetSync 가 classes/annotations/classifications 변경을 500ms debounce 로 PUT
  → media / frameRange / rangeFilterEnabled 는 사용 안 함 (라벨링은 frame strip 만)
```

`Frame` 타입은 두 페이지 공통. `id` 는 `ImageMeta.id` 와 같다(서버 등록 후).
`Shape` / `Annotation` / `Classification` 모두 정규화 좌표(0..1) 기준 — 해상도 독립.

### 주요 store 상태

| 상태 | 타입 | 설명 |
|------|------|------|
| `taskType` | `"bbox" \| "polygon" \| "classify"` | 활성 라벨셋의 task type. 라벨링 화면에서만 의미 있음 |
| `classifications` | `Classification[]` | classify task 전용 image-level 라벨 |
| `exceptedFrameIds` | `Record<string, boolean>` | 미라벨 필터에서 제외할 frame id 집합 |
| `interactionMode` | `"draw" \| "edit"` | 현재 인터랙션 모드 |
| `keepZoomOnFrameChange` | `boolean` | 프레임 전환 시 줌 유지 여부 |
| `hoveredAnnotationId` | `string \| null` | 패널·스테이지 hover 동기화용 |
| `frameRange` | `{start,end} \| null` | 추출 페이지 타임라인 범위 트랙. 라벨링 화면에서는 `null` 로 둠 |
| `rangeFilterEnabled` | `boolean` | 범위 필터 토글. 추출 페이지에서는 기본 `true`, 라벨링 화면 hydrate 시 `false` 로 끔 |

### 프레임 timestamp 중복 차단

`addFrames` 는 composition root(`lib/store.ts`)에서 오버라이드되어 있다. 모든 캡처 경로(현재 캡쳐 / 균등캡쳐 / 향후 추가될 경로)가 단일 entry point 를 통과하므로 중복 차단도 한 곳에서 처리한다.

- 들어온 프레임 중 기존 store + 같은 배치 내 다른 프레임과 `|Δt| < 0.008s` 인 후보를 드롭.
- 드롭된 프레임의 blob URL 은 즉시 `URL.revokeObjectURL` 로 정리해 누수 방지.
- `timestamp` 가 없는 프레임(직접 업로드된 이미지 등)은 항상 통과.

---

## 3) 도구 시스템 (`src/features/annotations/tools/`)

`tools/types.ts`의 `AnnotationTool` 인터페이스를 모든 그리기 모드가 구현합니다.

```ts
begin(start: Point): ShapeDraft
// ShapeDraft.update(current)   → 미리보기 Shape (마우스 hover)
// ShapeDraft.addPoint(p)       → { done, shape }
//   done=true  → shape 로 확정(null 이면 폐기)
//   done=false → shape 로 미리보기 갱신하고 계속 드래프트
// ShapeDraft.tryClose?()       → 명시적 닫기 요청(Enter). 닫을 수 없으면 null
```

현재 도구:
- `rect` (단축키 R): 2-클릭, `MIN_SIZE = 0.0005`
- `polygon` (단축키 P): N-클릭 꼭짓점 누적, **`Enter` 또는 첫 vertex 클릭으로 닫힘**(3점 이상 필요). 첫 vertex 스냅 거리는 `CLOSE_ON_FIRST_DIST = 0.005`(≈ 첫 vertex dot 크기와 동일) — 일반적 클릭은 항상 새 vertex 추가, 의도적으로 첫 vertex 를 클릭해야 닫힘. 연속 중복점은 `MIN_STEP = 0.001`로 억제. Edit 모드에서는 모든 vertex 에 draggable 핸들.

새 도구 추가 절차:
1. `features/annotations/tools/` 하위에 `AnnotationTool` 구현
2. `features/annotations/types.ts`의 `Shape` 유니온 확장
3. `features/annotations/tools/registry.ts` 등록
4. `features/annotations/ui/AnnotationStage.tsx`의 `ShapeView` 렌더 분기 추가

---

## 4) 스테이지/렌더링 규칙 (`AnnotationStage.tsx`)

- `ResizeObserver` 기반 contain-fit 레이아웃 사용
- 이미지 위에 SVG 오버레이(`viewBox="0 0 1 1"`, `preserveAspectRatio="none"`)를 올려 정규화 좌표로 도형 렌더
- `vectorEffect="non-scaling-stroke"`를 사용해 줌 시에도 선 두께 일관성 유지
- 드래그 안정성을 위해 pointer capture를 사용 (stageRef 기준)

### 라벨 오버레이

- **Rect 라벨**: SVG 대신 HTML div로 렌더(`preserveAspectRatio="none"` 왜곡 방지)
  - 박스 우상단 꼭짓점에서 우측으로 표시, 배경 없이 클래스 색상 텍스트
  - `transform: scale(1/zoom)` + 고정 `11px` 폰트로 브라우저 최소 폰트 크기 제한을 우회, zoom 불변 크기 유지
- **커서 라벨**: draw 모드에서 마우스 옆에 active class 이름 표시
  - `position: fixed` + clientX/clientY로 stageRef transform 영향 없음
- 두 라벨 모두 우상단 컨트롤 패널의 체크박스("라벨" / "커서라벨")로 on/off 가능

---

## 5) 인터랙션 룰 (명문화)

### 5.1 모드 정의

- `draw` 모드: 새 도형 생성 중심. 커서는 **항상 crosshair**.
- `edit` 모드: 기존 도형 선택/이동/리사이즈 중심. 배경 커서는 `grab`(패닝 중 `grabbing`).

### 5.2 Click-to-click 그리기 (`useDrawingTool`)

- **1번째 클릭**: 앵커 고정, 미리보기 시작 (`phaseRef = "pending"`)
- **2번째 클릭**: shape 커밋
- **우클릭 또는 Escape**: 진행 중인 draft 취소
- tool 변경 / frame 변경 / **interactionMode 변경** 시 draft 자동 취소
- draw 모드에서 기존 rect 위에 있어도 커서/이벤트는 그리기 우선 (`onStartMove`, `onStartResize`, `onSelect` 모두 edit 모드에서만 전달)

### 5.3 Hover 규칙

1. **스테이지 SVG hover**: SVG 레벨 `onPointerMove`에서 마우스를 포함하는 모든 rect 중 **중심축 거리가 가장 가까운** annotation을 `hoveredAnnotationId`로 설정
2. **Annotation 목록 패널 hover**: 모드 무관하게 동작, 스테이지와 강조 상태 동기화
3. `onPointerLeave`(SVG) / `onMouseLeave`(패널) 시 hover 해제

### 5.4 키보드 규칙 우선순위 (중요)

LabelPanel의 **capture-phase** 핸들러가 버블 단계보다 먼저 처리:

1. 클래스 행 hover + `Q/W/E/R` → 단축키 할당 **+ active class 전환**
2. annotation 행 hover + `D` → hover된 annotation 삭제
3. annotation 행 hover + `Q/W/E/R` → hover된 annotation의 class 변경
4. annotation 행 hover + `H` → 서버 세그먼테이션으로 shape refine (`features/annotations/service/segment.ts`, `BACKEND_SEGMENT_REQUIREMENTS.md`)
5. 소비되지 않은 키 → `useKeyboardShortcuts`(버블 단계)

전역 단축키 (`useKeyboardShortcuts`):

| 키 | 동작 |
|----|------|
| `D` | 선택/hover된 annotation 삭제 |
| `Q/W/E/R` | 해당 단축키가 할당된 class로 전환 |
| `1` | 이전 프레임 |
| `2` | 다음 프레임 |
| `C` | draw ↔ edit 모드 토글 |
| `Escape` | 진행 중인 draft 취소 |

**포커스 버그 방지** (`src/shared/dom/`):

- `isEditableElement` — 단축키 핸들러용 broad predicate. 지금 타이핑 중인지 판단(텍스트 input, textarea, select, contenteditable 모두 true).
- `isTextInputElement` — focus 유지 가치 판단용 strict predicate. 진짜 텍스트 입력만 true(`<select>`/checkbox/radio/color/range 등은 false).
- `useReleaseNonTextFocus(rootRef)` — shell(`LabelingWorkspace`, `FrameExtractionPage`)에서 한 번 호출. root에 capture-phase로 `pointerup`/`change`/`keyup` 리스너를 달고, 인터랙션 종료 후 `requestAnimationFrame`에서 `document.activeElement`가 `isTextInputElement` 아니면 `blur()`. select 드롭다운은 정상 동작하고, 값 선택 후에만 포커스가 풀림. Tab 키 네비게이션은 트리거하지 않아 키보드 접근성 보존.
- Opt-out: `data-keep-focus` 속성을 가진 요소(또는 그 조상)는 자동 blur 대상에서 제외. 모달 focus trap 등 의도적으로 포커스를 잡고 싶은 위젯용.
- 새 인터랙티브 위젯(button/select/checkbox 등)을 추가할 때 별도 blur 처리를 할 필요 없음 — shell의 훅이 일괄 처리.

### 5.5 이동/리사이즈 규칙

- `clampMove`: 위치만 frame 경계 내로 클램프, **크기는 원본 보존**
- `clampResize`: `minSize = 0.0005` 적용, top-left 고정
- 리사이즈 hit area: `0.055/zoom` normalized (≈20px 상수 시각 크기), 도형의 45% 상한
- 리사이즈 핸들 **시각적 그래픽 없음** — cursor(nwse-resize)로만 인지

### 5.6 줌 시 시각 규칙

- `vectorEffect="non-scaling-stroke"`로 stroke 두께 일관성 유지
- `visualZoom = Math.max(0.25, zoom)` floor로 극단 배율 처리
- rect 라벨은 `transform: scale(1/zoom)` 방식으로 zoom 불변 크기

---

## 6) FrameStrip (`src/features/frames/ui/FrameStrip.tsx`)

추출 페이지의 "캡쳐된 프레임" 스트립이자, 라벨링 워크스페이스의 "이미지" 사이드 패널이다 — 같은 컴포넌트를 두 곳에서 재사용한다. 보이는 항목은 store 의 `selectVisibleFrames(...)` 셀렉터가 결정.

- **정렬**: 추가순 / 시간순(timestamp 기준)
- **필터**: 미라벨(annotation **+ classification** 0개 + `exceptedFrameIds`에 없는 frame) / 범위(`frameRange` 안의 timestamp 만)
  - 범위 필터는 추출 페이지에서만 의미 있음. 라벨링 워크스페이스는 hydrate 시 `rangeFilterEnabled: false` + `frameRange: null` 이라 범위 트랙 없이도 전체가 그대로 보임.
- **제외(except)**: annotation 0개인 frame에 표시. 미라벨 필터에서 제외됨. 썸네일 하단 좌측 배지 영역에 인라인 표시 (class 배지와 동일 위치)
- **Class 배지**: frame 하단에 class별 annotation 수를 색상 pill로 표시 (classify 라벨셋이라면 classification 1개당 1개 pill).
- active frame 변경 시 `scrollIntoView({ block: "nearest" })`로 자동 스크롤

---

## 7) LabelPanel (`src/features/annotations/ui/LabelPanel.tsx`)

라벨셋의 `taskType` (`bbox` / `polygon` / `classify`) 에 따라 패널이 두 갈래로 갈라진다.

### bbox / polygon (shape annotation)
- **Class 관리**: 색상 클릭(color picker), 이름 인라인 편집, Q/W/E/R 단축키 할당
- **Annotation 우클릭**: 컨텍스트 메뉴 → "일괄 적용…" → `BulkApplyModal`
- **일괄 적용 모달** (`src/features/annotations/ui/BulkApplyModal.tsx`):
  - 전체 frame 썸네일(기본 전체 선택), 정렬/필터 컨트롤
  - 썸네일 우클릭 → 기준 frame 직전·직후 일괄 선택/해제
  - 적용 시 annotation의 shape/class를 선택된 frame에 복사

### classify (image-level)
- 동일한 class 관리 행을 그대로 사용하지만, annotation 목록 자리는 active image 의 클래스 체크리스트로 바뀐다 (`toggleClassification`).
- 한 이미지가 여러 클래스를 가질 수 있다 (multi-label). 단 클래스당 최대 1개.
- Q/W/E/R 단축키는 active image 에 해당 클래스를 토글 (annotation 추가/삭제가 아니라 classification 토글).
- shape 도구 / Toolbar / shape 단축키 (`R`/`P` 등 도구 전환) 는 classify 라벨셋에서는 의미가 없어 비활성.

---

## 8) 스타일 규칙

- Tailwind v4 사용
- 디자인 토큰은 `app/globals.css`의 `@theme` CSS 변수로 관리
- 컴포넌트에서 `var(--color-*)` 사용

---

## 9) 비디오 타임라인/프레임 추출 파이프라인

비디오 재생/스크럽/프레임 추출은 **프레임 추출 페이지(`FrameExtractionPage`)** 한 곳에서만 일어난다 (`/projects/[id]/resources/[rid]/extract`). 라벨링 워크스페이스는 비디오 element 를 띄우지 않는다.

### 9.1 `FrameExtractionPage` (`src/components/FrameExtractionPage.tsx`)

- 비디오 element 는 페이지 라이프타임 동안 항상 마운트 — fps 추정·sprite·seek·`captureCurrent` 가 끊기지 않게.
- 상단: 비디오 + 스텝 입력 패널 (←/→ 단위 초, fps 추정값 + "1프레임" 자동 설정 버튼).
- 하단: `<BottomTimeline>` 단일 컴포넌트가 sprite scrubber + range 트랙 + 액션 줄을 모두 담당.
- 키보드: `Space/C/←/→` 만 처리 (`↑/↓` 등 라벨링용 키는 라벨링 워크스페이스에서만 활성).
- 진행 중인 추출이 있더라도 store 의 `frames` 변경 effect 가 즉시 서버 업로드를 흘려보내므로 (§11.5), strip / 마커가 실시간으로 갱신된다.

### 9.2 `BottomTimeline` (`src/features/media/ui/BottomTimeline.tsx`)

프레임 추출 페이지 하단 통합 영역. 세 줄로 구성:

1. **Sprite preview / scrubber 트랙** — `pointerdown/move/up` 으로 클릭 + 드래그 모두 seek. 별도 hover 팝업은 두지 않음. cursor 라인은 `video.currentTime`.
   - 프레임 마커 3색: 현재 선택 frame = accent / 필터 통과 = amber / 필터 제외 = zinc dim.
2. **Range 트랙** — handle 항상 표시. handle 드래그 = resize, 본문/빈영역 드래그 = width 유지 평행이동(0~duration 클램프). `frameRange` 는 범위 필터와 균등 캡쳐 모두의 단일 source.
3. **단일 액션 줄** — 모든 버튼이 같은 베이스 클래스(`BTN_BASE`)와 변형(`BTN_DEFAULT`/`BTN_PRIMARY`/`BTN_DANGER`)을 공유. 좌→우: ▶/⏸ 토글 · `현재시간/전체시간` · 범위 라벨 · `초기화` · `현재 캡쳐` · `N초 [입력] (min~max · n개)` · `균등캡쳐` · `범위 N개 삭제`.
   - **N초 입력**: 로컬 draft 상태로 받고 **blur 또는 Enter 에서만 commit**. ESC 로 되돌림. min/max 는 fps 기반 (`minInterval = 1/fps`, `maxInterval = span`) 으로 자동 클램프 — 그 외 값은 입력 자체가 차단됨. 결과 개수도 commit 후에만 갱신.
   - **균등캡쳐 위치 산출**: `times = [start + (i+0.5)*interval for i in 0..floor(span/interval))]` — 중앙 정렬, 양 끝점 제외.

### 9.3 추출 파이프라인 (`src/features/media/service/capture.ts`)

- **sprite 빌드**: worker 기반 키프레임 탐색(`public/workers/sprite-worker.js`, MP4Box) → 실패 시 `evenlySpacedTimes(...)` 폴백.
- **fps 추정**: `requestVideoFrameCallback` 12 샘플의 중앙값. 잘 알려진 fps 후보(23.976/24/25/...)에 ±2% 안이면 그 값으로 스냅.
- **`extractFrames`**: 옵션 `times[]` 를 순회하며 seek + canvas draw + `toBlob` 으로 인코딩. **두 가지 스트리밍 hook 지원**:
  - `onFrame: (frame) => void` — 인코딩 끝나는 즉시 emit. BottomTimeline 의 균등캡쳐가 이걸 `addFrames([f])` 로 흘려 넣어서 진행 중 strip / 마커가 실시간 갱신됨.
  - `signal: AbortSignal` — abort 되면 in-flight seek/encode 마무리 후 break. 이미 emit 된 프레임은 그대로 store 에 남음. UI 의 "중지" 버튼이 이걸 트리거.

### 9.4 단축키 (FrameExtractionPage)

- `Space`: 재생/일시정지
- `C`: 현재 프레임 캡쳐
- `←/→`: ±stepSec (`Shift` 와 함께 ±stepSec × 5)

---

## 10) 유지보수 메모

- `MediaSource` 는 `file?: File` 포함 (worker 전처리용). 추출 페이지에서는 서버 source 를 fetch → `File` 로 감싸 `MediaSource` 를 조립한다.
- sprite/object URL 은 cleanup 에서 revoke 해 메모리 누수 방지.
- 무거운 작업은 worker/헬퍼 함수로 분리해 UI 인터랙션 블로킹 방지.
- 비디오 정규화 파이프라인 (`src/features/media/service/normalize.ts`): 서버 어댑터 (`NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT`) 우선, 실패 시 ffmpeg.wasm 폴백. `UploadResourceModal` 의 video 모드만 이 경로를 탄다.
- 라벨링 워크스페이스 (`/labelsets/[lsid]`) 는 비디오 / BottomTimeline / `frameRange` 를 사용하지 않는다 — `media: null`, `rangeFilterEnabled: false` 로 hydrate.
- 비디오 타임라인 + 추출 컨트롤은 `src/features/media/ui/BottomTimeline.tsx` 단일 컴포넌트가 담당하며, 사용처는 `FrameExtractionPage` 한 군데뿐.

---

## 11) 서버 persistence (Resource / Image / LabelSet)

워크스페이스 위에 프로젝트·리소스·이미지·라벨셋 관리 레이어가 얹혀 있습니다. 모든 바이트와 메타는 로컬 파일시스템(`./storage/`, gitignored)에 저장되며, API 라우트는 `src/lib/server/storage.ts` 한 파일만 거칩니다 (DB 교체 시 단일 seam).

### 11.1 디스크 레이아웃 (`STORAGE_ROOT = ./storage`)

```text
storage/
  projects.json                                # { projects: string[] } — 프로젝트 id 인덱스
  {projectId}/
    project.json                               # { id, name, createdAt, members }
    resources.json                             # ResourceMeta[]
    resources/{resourceId}/
      meta.json                                # ResourceMeta (+ previewCount)
      source.<ext>                             # video resource 의 원본 바이트
      preview-{0..previewCount-1}.jpg          # video hover-reel 썸네일
    images.json                                # ImageMeta[]  (project-level pool)
    images/{imageId}.<ext>                     # 이미지 바이트 (uploaded · video_frame 공통)
    labelsets.json                             # LabelSetMeta[]
    labelsets/{labelsetId}/
      meta.json                                # LabelSetMeta { name, taskType, imageIds[] }
      data.json                                # LabelSetData { classes, annotations, classifications }
```

> **구버전(Project ▸ Video ▸ Frame) 마이그레이션 코드는 의도적으로 포함하지 않음.** 기존 `storage/` 디렉토리는 새 모델과 호환되지 않으니 비우고 시작.

### 11.2 API 라우트 (`app/api/projects/...`)

| Method | Path | 용도 |
|---|---|---|
| GET/POST | `/api/projects` | 프로젝트 목록·생성 |
| GET/DELETE | `/api/projects/[id]` | detail(`{ project, resources, images, labelsets }`)·삭제 |
| GET/POST | `/api/projects/[id]/resources` | 리소스 목록·업로드 (multipart, `kind=video` 또는 `kind=image_batch`) |
| GET/DELETE | `/api/projects/[id]/resources/[rid]` | 리소스 detail(`{ resource, images }`)·삭제 |
| GET | `/api/projects/[id]/resources/[rid]/source` | video 리소스의 원본 스트림 |
| POST | `/api/projects/[id]/resources/[rid]/frames` | 비디오 프레임 추출 결과 일괄 업로드 (multipart `meta` JSON + `files`) |
| POST | `/api/projects/[id]/resources/[rid]/previews` | hover-reel 썸네일 일괄 업로드 |
| GET | `/api/projects/[id]/resources/[rid]/previews/[idx]` | 개별 preview |
| GET | `/api/projects/[id]/images` | 프로젝트 이미지 풀 전체 |
| GET/DELETE | `/api/projects/[id]/images/[iid]` | 이미지 바이트 조회·삭제 (라벨셋 멤버십·annotation·classification 까지 cascade) |
| GET/POST | `/api/projects/[id]/labelsets` | 라벨셋 목록·생성 (`{ name, taskType, imageIds }`) |
| GET/PATCH/DELETE | `/api/projects/[id]/labelsets/[lsid]` | detail(`{ meta, data, images }`)·이름/`imageIds` 수정·삭제 |
| GET/PUT | `/api/projects/[id]/labelsets/[lsid]/data` | `data.json` 조회·전체 덮어쓰기 |
| GET | `/api/projects/[id]/export?labelsets=...` | 선택된 라벨셋(미지정시 전체)들의 JSON export |

클라이언트 측 fetch 래퍼는 모두 `src/features/projects/service/api.ts`에 있습니다. `features/projects/index.ts`는 **타입만** 재export 하고, 서비스는 deep import (service → store 접근 금지 규칙 준수).

### 11.3 ProjectDetailPage (`src/components/ProjectDetailPage.tsx`)

3-탭 shell. 상단 액션 바: `+ 동영상`, `+ 이미지 묶음`, `+ 라벨셋`(이미지 풀 비면 disabled), `전체 다운로드`(라벨셋 0개면 disabled).

- **Resource Pool**: `table-fixed` + `<colgroup>` (Resource 320 / Type 100 / 생성 / 길이 96 / 이미지 96 / 작업 200). video 행은 `preview-0.jpg` 를 인라인 썸네일로 띄우고, hover 시 `PREVIEW_REEL_INTERVAL_MS = 220ms` 로 전체 preview 를 순환. video 행에는 `Frame Extraction` 링크 + `삭제`, image_batch 행에는 `삭제` 만.
- **Image Pool**: 프로젝트 전체 이미지 풀을 가상화된 그리드로 표시. resource 필터 셀렉트, 파일명 검색, `IntersectionObserver` sentinel 로 50개씩 창 확장. 각 카드는 `imageUrl(...)` 썸네일 + 이름 + (`uploaded` 또는 `T.TT s`).
- **Label Set Pool**: 라벨셋 카드 그리드. taskType 배지, 멤버 이미지 수 / 클래스 수 / annotation·classification 수, JSON 다운로드, 삭제.
- 리소스 삭제는 자식 이미지 + 모든 라벨셋의 멤버십·annotation·classification 까지 cascade (서버 `deleteResource` → `deleteImage` 루프).

### 11.4 업로드 플로우 (`UploadResourceModal`)

상단 토글로 `video` ↔ `image_batch` 모드 전환:

- **video 모드**: 한 파일만 받음. `readMedia()` 로 정규화 → `uploadVideoResource()` POST → 성공하면 best-effort 로 `extractFrames(evenlySpacedTimes(duration, PREVIEW_COUNT=10))` 결과를 `uploadPreviews()` 로 POST. preview 실패는 무시하고 모달 닫음.
- **image_batch 모드**: 다중 파일. 각 파일을 `<img>` 로 디코딩해서 width/height 측정 → `uploadImageBatchResource(projectId, name, entries[])` 한 번의 multipart 요청으로 resource + images 동시 생성. 업로드한 이미지는 즉시 Image Pool 에 등록되어 라벨셋 생성에 사용 가능.

### 11.5 FrameExtractionPage (`/projects/[id]/resources/[rid]/extract`)

비디오 리소스에서만 접근 가능. 마운트 시 `getResource()` 로 meta + 기존 추출 이미지(`source === "video_frame"`)를 받아 store 에 hydrate, video bytes 는 `resourceSourceUrl()` 에서 blob 으로 받아 `MediaSource` 로 조립.

- 이 페이지의 store 는 video 모드 전용 — `media`, `frames`(인플라이트 + 기존), `frameRange` 만 사용. annotation/classification/classes 는 라벨링 워크스페이스 소관이라 건드리지 않음.
- **프레임 업로드/삭제 sync**: 컴포넌트 안의 `useEffect([frames])` 가 직접 처리한다 (별도 hook 으로 추출하지 않음).
  - `blob:` URL 인 frame 은 `uploadExtractedFrames()` 로 multipart POST → 성공 시 `useStore.setState` 로 URL 을 server URL 로 교체 + blob revoke.
  - store 에서 빠진 frame id 는 `apiDeleteImage()` 로 cascade 삭제.
  - 중복 업로드 방지: `knownIdsRef` / `uploadingRef`. resource 간 이동/재마운트 시 `generationRef++` 로 in-flight 응답이 새 컨텍스트의 store 를 건드리지 않게 한다.
- 하단은 `<BottomTimeline>` (sprite scrubber + range 트랙 + 액션 줄) 으로 §9 와 동일.

### 11.6 LabelingWorkspace (`/projects/[id]/labelsets/[lsid]`)

마운트 시 `reset()` → `getLabelSet()` → `useStore.setState` 로 `frames` (라벨셋의 `imageIds` 순서대로 ImageMeta → Frame), `classes`, `annotations`, `classifications`, `taskType`, `activeToolId` (taskType 에 맞춰 `polygon`/`rect`), `interactionMode = "draw"`, `rangeFilterEnabled = false`, `frameRange = null` 로 hydrate. 서버에 classes 가 없으면 기본 class 1개 seed.

- **media 는 사용하지 않음.** 라벨링 화면은 video element / sprite / BottomTimeline 없이 FrameStrip + AnnotationStage + LabelPanel 로만 구성.
- **taskType === "classify"** 면 `<Toolbar />` 미렌더 + LabelPanel 내부에서 image-level 체크리스트 UI 로 전환 (§7 참고).
- 서버 sync 는 `useLabelSetSync` 가 전담:
  - `classes` / `annotations` / `classifications` 변경을 500ms 디바운스 후 `saveLabelSetData()` PUT 으로 한 덩어리 저장 (`data.json` 전체 덮어쓰기).
  - 라벨셋 간 이동 시 `[projectId, labelsetId]` effect 가 `generationRef++` + 진행 중 timer 정리 → in-flight 저장이 새 라벨셋의 데이터를 덮어쓰지 못하게 차단.
  - 이미지 멤버십(`imageIds`) 변경은 이 hook 의 책임 밖 — 별도 `updateLabelSet` PATCH 로 처리해야 함.

### 11.7 설정

- `storage/` 는 `.gitignore` 대상.
- `next.config.mjs` 에서 `experimental.serverActions.bodySizeLimit = "2gb"` 로 대용량 비디오 업로드 허용.

### 11.8 동시성 모델 (storage.ts)

여러 요청이 같은 인덱스 JSON에 동시에 read-modify-write 를 하면 baseline 충돌로 항목이 silently 누락되던 버그가 있어, 모든 RMW 경로는 두 가지 가드를 거친다:

1. **per-path in-process mutex (`withFileLock`)**: `Map<filePath, Promise>` 기반 직렬화 큐. 같은 파일 경로에 대한 mutator 가 절대 겹치지 않게 한다. 락 entry 는 tail 이 settle 되면 자동 정리되고, 한 mutator 의 throw 가 큐를 막지 않는다 (다음 작업은 `prev.catch(() => undefined).then(...)` 로 잇는다). 적용 대상:
   - `projects.json` — `createProject` / `deleteProject`
   - `resources.json` — `createResource` / `deleteResource` / `writePreviews` 의 인덱스 미러
   - `images.json` — `createImages` / `deleteImage`
   - `labelsets.json` — `createLabelSet` / `deleteLabelSet` / `mutateLabelSetMeta` 의 인덱스 미러
   - resource `meta.json` — `writePreviews` (previewCount 갱신)
   - labelset `meta.json` — `mutateLabelSetMeta` (이름·imageIds 변경)
   - labelset `data.json` — `mutateLabelSetData` (annotation/classification cascade 등)
2. **atomic write**: `writeJson()` 은 `.tmp` 파일에 쓰고 `rename(tmp, target)` 으로 교체. reader 는 항상 이전 또는 새 내용만 보고 partial JSON 은 절대 노출되지 않는다.

`mutateLabelSetMeta(projectId, lsid, mutator)` / `mutateLabelSetData(projectId, lsid, mutator)` 가 권장 진입점. data mutator 는 `data` 를 in-place 수정하고 값을 리턴하며, 리턴값이 정확히 `false` 면 write 를 스킵한다 (no-op). meta mutator 는 변경된 meta 를 인덱스(`labelsets.json`) 에도 자동 미러한다. DB 로 옮기면 `storage.ts` 한 파일만 교체하면 되고 락도 같이 사라진다.
