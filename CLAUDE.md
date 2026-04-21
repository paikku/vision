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
- 앱은 단일 페이지 라벨링 워크스페이스 구조이며, `app/page.tsx`에서 `<Workspace />`를 렌더링합니다.
- 스토어에 `media`가 있으면 어노테이션 워크스페이스를, 없으면 업로드 화면을 표시합니다.

### Feature 경계 (중요)

코드는 feature 단위로 분리되어 있고, 경계는 ESLint `no-restricted-imports`로 강제됩니다.
**경계 규칙 전체 스펙은 `/REFACTOR_RULES.md` 참고.** 작업 전 반드시 읽을 것.

```text
src/
  components/           # shell · 여러 feature 조합하는 유일한 자리
  features/
    media/              # 업로드·normalize·비디오 재생·프레임 추출
    frames/             # 프레임 목록·활성 프레임·exception
    annotations/        # class·shape·tool·drawing·keyboard
    export/             # 직렬화/다운로드
  shared/               # 순수 유틸·범용 훅
  lib/store.ts          # 슬라이스 합성 루트 (useStore 공개 API)
```

- 크로스 feature 로직은 **shell(components/) 또는 `lib/store.ts` composition root**에만.
- Feature의 public 표면은 `features/<A>/index.ts` 배럴 + `types.ts`.
- Service (`features/<A>/service/*`)는 외부 IO 전담, store 접근 금지.
- 자세한 import 허용/금지 매트릭스는 `REFACTOR_RULES.md` §2.

### 데이터 흐름

전체 상태는 `src/lib/store.ts`의 Zustand store에서 관리합니다. 내부적으로 feature별 slice로 분리되어 있지만 공개 API(`useStore`)는 단일 지점입니다.

```text
MediaSource → Frame[] → Annotation[]
                ↕             ↕
          activeFrameId  selectedAnnotationId
```

- **MediaSource**: 업로드 원본(한 번에 1개), object URL 보유
- **Frame**: 미디어에서 캡처된 정지 프레임(object URL)
- **Annotation**: 특정 frame 소속, class id 참조, shape 보유
- **Shape**: 0..1 정규화 좌표계(해상도 독립)

### 주요 store 상태

| 상태 | 타입 | 설명 |
|------|------|------|
| `exceptedFrameIds` | `Record<string, boolean>` | 미라벨 필터에서 제외할 frame id 집합 |
| `interactionMode` | `"draw" \| "edit"` | 현재 인터랙션 모드 |
| `keepZoomOnFrameChange` | `boolean` | 프레임 전환 시 줌 유지 여부 |
| `hoveredAnnotationId` | `string \| null` | 패널·스테이지 hover 동기화용 |

---

## 3) 도구 시스템 (`src/features/annotations/tools/`)

`tools/types.ts`의 `AnnotationTool` 인터페이스를 모든 그리기 모드가 구현합니다.

```ts
begin(start: Point): ShapeDraft
// ShapeDraft.update(current) → 미리보기 Shape
// ShapeDraft.commit(end)     → Shape | null (null이면 버림)
```

현재 도구: `rect` (단축키 R), `MIN_SIZE = 0.0005`(~0.05% of frame)

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
4. 소비되지 않은 키 → `useKeyboardShortcuts`(버블 단계)

전역 단축키 (`useKeyboardShortcuts`):

| 키 | 동작 |
|----|------|
| `D` | 선택/hover된 annotation 삭제 |
| `Q/W/E/R` | 해당 단축키가 할당된 class로 전환 |
| `1` | 이전 프레임 |
| `2` | 다음 프레임 |
| `C` | draw ↔ edit 모드 토글 |
| `Escape` | 진행 중인 draft 취소 |

**포커스 버그 방지**: `isEditable()` 함수는 checkbox/radio를 텍스트 입력으로 취급하지 않도록 구현. `Workspace`의 전역 click 핸들러가 버튼/체크박스 클릭 후 자동 blur하여 단축키가 항상 작동.

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

- **정렬**: 추가순 / 시간순(timestamp 기준)
- **필터**: 전체 / 미라벨(annotation 0개 + `exceptedFrameIds`에 없는 frame)
- **제외(except)**: annotation 0개인 frame에 표시. 미라벨 필터에서 제외됨. 썸네일 하단 좌측 배지 영역에 인라인 표시 (class 배지와 동일 위치)
- **Class 배지**: frame 하단에 class별 annotation 수를 색상 pill로 표시
- active frame 변경 시 `scrollIntoView({ block: "nearest" })`로 자동 스크롤

---

## 7) LabelPanel (`src/features/annotations/ui/LabelPanel.tsx`)

- **Class 관리**: 색상 클릭(color picker), 이름 인라인 편집, Q/W/E/R 단축키 할당
- **Annotation 우클릭**: 컨텍스트 메뉴 → "일괄 적용…" → `BulkApplyModal`
- **일괄 적용 모달** (`src/features/annotations/ui/BulkApplyModal.tsx`):
  - 전체 frame 썸네일(기본 전체 선택), 정렬/필터 컨트롤
  - 썸네일 우클릭 → 기준 frame 직전·직후 일괄 선택/해제
  - 적용 시 annotation의 shape/class를 선택된 frame에 복사

---

## 8) 스타일 규칙

- Tailwind v4 사용
- 디자인 토큰은 `app/globals.css`의 `@theme` CSS 변수로 관리
- 컴포넌트에서 `var(--color-*)` 사용

---

## 9) 비디오 타임라인/프레임 추출 파이프라인

`src/features/media/ui/VideoFramePicker.tsx` 기준:

- **M1 (인프라)**: worker 기반 키프레임 탐색 + sprite 생성
  - `src/features/media/service/capture.ts::buildVideoSprite`
  - `public/workers/sprite-worker.js` (MP4Box 파싱)
  - 실패 시 `evenlySpacedTimes(...)` 폴백
- **M2 (타임라인 UI)**: 즉시 hover 프리뷰 + 클릭 seek
- **M3 (캡처 UX)**: `requestVideoFrameCallback` 인지 캡처 + 단축키
  - `Space`: 재생/일시정지
  - `C`: 캡처
  - `←/→`: ±1초 (`Shift`와 함께 ±5초)

---

## 10) 유지보수 메모

- `MediaSource`는 `file?: File` 포함 (worker 전처리용)
- sprite/object URL은 cleanup에서 revoke해 메모리 누수 방지
- 무거운 작업은 worker/헬퍼 함수로 분리해 UI 인터랙션 블로킹 방지
- 비디오 정규화 파이프라인(`src/features/media/service/normalize.ts`): 서버 어댑터(`NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT` 설정 시) 우선, 실패 시 ffmpeg.wasm 폴백
- 서버 정규화 endpoint는 `multipart/form-data`의 `file` 필드를 입력으로 받고 `video/mp4`를 반환해야 함. 로컬 Route Handler는 `app/api/normalize/route.ts`에 제공되며 실제 트랜스코더 업스트림(`VIDEO_NORMALIZE_UPSTREAM_URL`)으로 프록시 가능
- ffmpeg 모듈은 npm 패키지(`@ffmpeg/ffmpeg`, `@ffmpeg/util`, `@ffmpeg/core`) 기반으로 로드. `postinstall` 스크립트가 코어 파일을 `public/vendor/ffmpeg/*`로 복사하며 필요 시 `NEXT_PUBLIC_FFMPEG_CORE_URL`, `NEXT_PUBLIC_FFMPEG_WASM_URL`로 경로 오버라이드 가능. 로컬 코어 로드 실패 시 CDN 코어 URL로 자동 폴백
- 중앙 워크스페이스 `centerViewMode`: `video`(재생/추출) / `frame`(어노테이션 스테이지)
- 프레임 추출 컨트롤: `src/features/media/ui/frame-extract/ExtractionPanel.tsx`
