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
- 앱 진입점은 `/` → `/projects` 리디렉션(`app/page.tsx`)입니다.
- 라우트 구성:
  - `/projects` — 프로젝트 목록/생성/삭제 (`ProjectsPage`)
  - `/projects/[id]` — Media Library (Resource Pool + Image Pool, `MediaLibraryPage`)
  - `/projects/[id]/extract/[resourceId]` — 비디오 → 프레임 추출 단독 페이지 (`FrameExtractionPage`)
  - `/projects/[id]/labelsets` — LabelSet 목록 (`LabelSetsPage`)
  - `/projects/[id]/labelsets/[lsid]` — 라벨링 워크스페이스 (`LabelingWorkspace`)
- 라벨링 워크스페이스는 마운트 시 LabelSet meta + annotations + 멤버 이미지를 가져와 store를 hydrate하고, classes 가 비어있으면 기본 class 1개로 seed합니다. 추출 페이지는 별도 store 슬라이스 없이 비디오 element + capture 서비스만 사용합니다.

### Feature 경계 (중요)

코드는 feature 단위로 분리되어 있고, 경계는 ESLint `no-restricted-imports`로 강제됩니다.
**경계 규칙 전체 스펙은 `/REFACTOR_RULES.md` 참고.** 작업 전 반드시 읽을 것.

```text
src/
  components/           # shell · 여러 feature 조합하는 유일한 자리
                        #   ProjectsPage / MediaLibraryPage / ResourcePool / ImagePool
                        #   UploadResourceModal / StartLabelingModal / TagInput
                        #   FrameExtractionPage / LabelSetsPage / LabelingWorkspace
                        #   useLabelSetSync
  features/
    media/              # 업로드·normalize·비디오 재생·프레임 추출(capture)·BottomTimeline
    frames/             # 프레임 목록·활성 프레임·exception (라벨링 워크스페이스용)
    annotations/        # class·shape·tool·drawing·keyboard
    export/             # LabelSet 직렬화 (`buildLabelSetExport`)
    resources/          # Resource(업로드 묶음) 서버 API 래퍼 + 타입
    images/             # Image(라벨링 단위) 서버 API 래퍼 + 타입
    labelsets/          # LabelSet + annotations 서버 API 래퍼 + 타입
    projects/           # Project 서버 API 래퍼 + 타입
  shared/               # 순수 유틸·범용 훅
  lib/
    store.ts            # 슬라이스 합성 루트 (useStore 공개 API)
    server/storage.ts   # 서버 전용 파일시스템 persistence helper
```

- 크로스 feature 로직은 **shell(components/) 또는 `lib/store.ts` composition root**에만.
- Feature의 public 표면은 `features/<A>/index.ts` 배럴 + `types.ts`.
- Service (`features/<A>/service/*`)는 외부 IO 전담, store 접근 금지.
- 자세한 import 허용/금지 매트릭스는 `REFACTOR_RULES.md` §2.

### 데이터 흐름

서버 도메인 모델(§11):

```text
Project ─┬─ Resource[]   (업로드 묶음: video / image_batch)
         ├─ Image[]      (라벨링 단위; resource 에서 파생, source = uploaded | video_frame)
         └─ LabelSet[]   (type=polygon|bbox|classify, classes[], imageIds[], annotations[])
```

`LabelSet.imageIds` 가 멤버십, `Image` 는 여러 LabelSet 에 동시에 속할 수 있습니다. 한 LabelSet 의 classes/annotations 는 자기 자신에게만 의미를 가집니다 (LS_A 의 "scratch" ≠ LS_B 의 "scratch").

라벨링 워크스페이스의 클라이언트 store(`useStore`):

```text
Image[] (Frame 으로 어댑트)  → Annotation[]
        ↕                            ↕
  activeFrameId            selectedAnnotationId
```

- **Frame**: 워크스페이스에서 사용하는 표시 단위. 서버 `Image` 를 `imageBytesUrl()` URL + width/height + (있으면) `videoFrameMeta.timestamp` 로 어댑트한 결과.
- **Annotation**: 특정 frame(=Image) 소속, class id 참조, kind 에 따라 shape 보유 (rect/polygon) 또는 shape 없음 (classify).
- **Shape**: 0..1 정규화 좌표계(해상도 독립).

### 주요 store 상태

| 상태 | 타입 | 설명 |
|------|------|------|
| `exceptedFrameIds` | `Record<string, boolean>` | 미라벨 필터에서 제외할 frame id 집합 |
| `interactionMode` | `"draw" \| "edit"` | 현재 인터랙션 모드 |
| `keepZoomOnFrameChange` | `boolean` | 프레임 전환 시 줌 유지 여부 |
| `hoveredAnnotationId` | `string \| null` | 패널·스테이지 hover 동기화용 |
| `frameRange` | `{start,end} \| null` | 타임라인 범위 트랙 + 범위 필터의 단일 source. 미디어 로드 시 `[0, duration]`로 자동 초기화 |
| `rangeFilterEnabled` | `boolean` | 범위 필터 토글. **기본값 true** — 범위 밖 프레임은 FrameStrip에서 숨김 |

### 프레임 timestamp 중복 차단

`addFrames` 는 composition root(`lib/store.ts`)에서 오버라이드되어 있다. 모든 캡처 경로(현재 캡쳐 / 균등캡쳐 / 향후 추가될 경로)가 단일 entry point 를 통과하므로 중복 차단도 한 곳에서 처리한다.

- 들어온 프레임 중 기존 store + 같은 배치 내 다른 프레임과 `|Δt| < 0.008s` 인 후보를 드롭.
- 드롭된 프레임의 blob URL 은 즉시 `URL.revokeObjectURL` 로 정리해 누수 방지.
- `timestamp` 가 없는 프레임(이미지 등)은 항상 통과.

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
4. annotation 행 hover + `H` → 서버 세그먼테이션으로 shape refine (`features/annotations/service/segment.ts`, `BACKEND_SEGMENT_REQUIREMENTS.md`). **`labelSetType === "polygon"` 일 때만 동작** — segmentation 결과는 polygon 이라 bbox/classify LabelSet 컨텍스트에서는 무시됨. 모델 select / shortcut 안내도 polygon LabelSet 에서만 표시.
5. 소비되지 않은 키 → `useKeyboardShortcuts`(버블 단계)

전역 단축키 (`useKeyboardShortcuts`):

| 키 | 동작 |
|----|------|
| `D` | 선택/hover된 annotation 삭제 |
| `Q/W/E/R` | 해당 단축키가 할당된 class로 전환 |
| `1` | 이전 프레임 |
| `2` | 다음 프레임 |
| `C` | draw ↔ edit 모드 토글 |
| `R` / `P` | rect / polygon tool — **`labelSetType === null` 일 때만 활성화**. LabelSet 컨텍스트에서는 type 이 도구를 고정하므로 핫키가 무시되고 `Toolbar` 도 비대화형 badge 로만 표시됨. classify LabelSet 은 `Toolbar` 자체가 숨겨짐 |
| `Escape` | 진행 중인 draft 취소 |

**포커스 버그 방지** (`src/shared/dom/`):

- `isEditableElement` — 단축키 핸들러용 broad predicate. 지금 타이핑 중인지 판단(텍스트 input, textarea, select, contenteditable 모두 true).
- `isTextInputElement` — focus 유지 가치 판단용 strict predicate. 진짜 텍스트 입력만 true(`<select>`/checkbox/radio/color/range 등은 false).
- `useReleaseNonTextFocus(rootRef)` — shell(`LabelingWorkspace`)에서 한 번 호출. root에 capture-phase로 `pointerup`/`change`/`keyup` 리스너를 달고, 인터랙션 종료 후 `requestAnimationFrame`에서 `document.activeElement`가 `isTextInputElement` 아니면 `blur()`. select 드롭다운은 정상 동작하고, 값 선택 후에만 포커스가 풀림. Tab 키 네비게이션은 트리거하지 않아 키보드 접근성 보존.
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

- **고정 폭**: `w-72` (288px) — 우측 LabelPanel 과 동일 폭으로 맞춰 워크스페이스 좌우 비대칭을 제거. 폭에 여유가 생긴 만큼 정렬/필터 칩이 한 줄에 들어가고, 썸네일 풋터에 `#index · filename · timestamp · count` 가 한 줄로 표시된다.
- **썸네일 라벨 오버레이**: 각 썸네일 위에 `viewBox="0 0 1 1" preserveAspectRatio="none"` SVG 를 올려 정규화 좌표로 rect/polygon 도형을 그림. fill = class color @ 18% opacity, stroke = class color, `vector-effect: non-scaling-stroke`. classify 어노테이션(쉐이프 없음)은 SVG 대신 `box-shadow: inset 0 0 0 2px <classColor>` 로 썸네일 가장자리에 클래스 색상 테두리. 어노테이션 → frame bucket 맵을 `useMemo` 로 캐싱해 N 개 strip rendering O(annotations) 가 아닌 O(visible).
- **정렬**: 추가순 / 시간순(timestamp 기준)
- **필터**: 미라벨(annotation 0개 + `exceptedFrameIds`에 없는 frame) / 범위(`frameRange` 안의 timestamp 만)
  - 범위 필터는 **기본 ON**. 미디어 로드 시 `frameRange = [0, duration]` 으로 초기화되므로 처음에는 보이는 결과가 동일하지만, 사용자가 BottomTimeline 의 핸들을 좁히면 즉시 strip 도 좁혀짐.
- **제외(except)**: annotation 0개인 frame에 표시. 미라벨 필터에서 제외됨. 썸네일 하단 풋터에서 hover 시 표시.
- **카운트 배지**: frame 하단 풋터에 총 annotation 수 표시.
- active frame 변경 시 `scrollIntoView({ block: "nearest" })`로 자동 스크롤
- 가상화: `DEFAULT_ITEM_HEIGHT = 180`(`w-72` 썸네일 + 풋터 높이의 초기 추정값), `OVERSCAN = 6`. 첫 렌더 row 의 `getBoundingClientRect().height + ITEM_GAP` 로 actual stride 측정 후 적용 — 이 측정 로직 덕에 폰트/패딩 미세 조정에는 상수 변경 없이 자동 적응한다.

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

비디오 → Image(`source = "video_frame"`) 추출은 라벨링 워크스페이스와 분리된 단독 페이지(`FrameExtractionPage`, `/projects/[id]/extract/[resourceId]`)에서 일어납니다. 비디오 element / sprite / fps / time / busy 등 비디오 상태는 이 shell 안에서 자체 관리되고, 하단 타임라인은 feature 컴포넌트 `BottomTimeline` 에 위임합니다.

### 9.1 `FrameExtractionPage` (`src/components/FrameExtractionPage.tsx`)

- Resource source 비디오를 `<video controls>` 로 마운트하고, 추출 결과는 `addImagesToResource(projectId, resourceId, [...])` 로 즉시 서버에 등록 → 같은 페이지 안에서 단일 행 frame strip 으로 다시 보여준다.
- 추출된 Image 의 id 는 클라이언트가 미리 할당하므로 (UUID), Media Library 로 돌아가도 동일 id 를 본다.
- 페이지를 떠나면 비디오/sprite 상태는 폐기됨. 라벨링 워크스페이스는 비디오를 보지 않고 Image 만 본다.
- 페이지는 `BottomTimeline` (§9.2) 을 사용하지 않고 **자체 inline timeline** 을 가진다: sprite preview 트랙 + range 트랙 + 액션 줄 + 좌상단 HUD + 추출 프레임 strip.

**좌상단 HUD** (비디오 영역 `absolute left-2 top-2`):
- `frame: <current> / <total>` — `Math.floor(currentTime * fps)` / `Math.floor(duration * fps)` (비디오의 실제 프레임)
- `range: <count>프레임` — 현재 `frameRange` 안의 비디오 프레임 수 = `Math.floor(span * fps)` (range 가 있을 때만)
- `fps: <fps>` — `estimateVideoFps(video)` 결과 (측정 전엔 "측정 중…")
- `min: <1/fps>s` — fps 기반 최소 step (30fps → 0.033s)

**범위 핸들 드래그 시킹 미리보기**:
- 좌/우 핸들을 잡고 끌면 그 위치로 `seek()` 동기화 → 어디가 끝점인지 보면서 잡을 수 있게.
- 드래그 시작 시점의 `video.currentTime` 을 `dragOriginRef.restoreTime` 에 저장, pointerup 시 그 값으로 복귀.
- `mode === "translate"` (본문 평행이동) 은 시킹하지 않음.

**추출된 프레임 strip** (내부 `FrameStripRow`):
- `framesInRange` 만 단일 행으로 노출 (범위 밖 프레임은 숨김). 빈 범위에도 placeholder 로 한 줄 자리 유지 (`min-h-28`).
- **가로 스크롤**: `overflow-x: scroll` (auto 가 아니라 scroll) — 스크롤바 자리를 항상 reserve 해서 콘텐츠 폭이 바뀔 때 strip 높이가 점프하지 않게. 컨테이너에 native `wheel` 리스너(`{passive: false}`)를 부착해 `deltaY`/`deltaX` 중 절대값 큰 쪽을 `scrollLeft` 에 더하고 `preventDefault`. React 의 `onWheel` 은 passive 라 직접 등록이 필요.
- **Hover = 시킹**: 카드 `onMouseEnter` 에서 그 timestamp 로 시킹. 줄 `onMouseEnter` 시 `getCurrentTime()` 을 `hoverRestoreRef` 에 한 번만 저장, 줄 `onMouseLeave` 시 그 값으로 복귀. range 핸들 드래그와 같은 save/restore 패턴.
- **선택**: 클릭=토글, Shift+클릭=`lastClickedFrameIdRef` ↔ 현재 사이 범위 추가, 드래그 marquee=박스 안 batch toggle. ImagePool 과 동일한 패턴 — 컨테이너에 pointer-capture 안 잡고 document listener 사용 (§12.2). 좌표는 scroll-content 기준 (§12.3). 카드 `<img>` 는 `draggable={false}` (§12.4).
- **marquee 드래그 중 hover 시킹 무시**: `draggingRef.current` 를 onMove 의 임계값 통과 시점에 true, onUp 에서 false. 카드 hover 핸들러가 이 ref 검사 후 skip.
- **헤더 버튼**: strip 헤더에 `[전체 선택] [선택 해제] [선택 제거]` 3개. 전체 선택은 `framesInRange` 전부, 선택 제거 는 `deleteSelectedFrames` 트리거 (= Delete 단축키와 동일). 액션 줄에는 더 이상 삭제 버튼이 없음.
- **삭제**: 헤더 "선택 제거" 버튼 + Delete/Backspace 단축키. native `confirm` 후 `deleteImage` cascade. 범위 변경 / 삭제로 사라진 id 는 `useEffect` 가 selection 에서 자동 제거.

**sprite 프레임 마커 색**:
- 우선순위 selected > inRange/outRange. **selected** = `bg-sky-400` + h-3 (다른 마커보다 살짝 김), **in-range** = `bg-amber-300` h-2, **out-of-range** = `bg-zinc-500` h-2. cursor 라인은 `bg-[var(--color-accent)]`.

**액션 줄 레이아웃**: 좌측 = 재생/캡쳐 도구 (`▶/⏸ · 현재시간/전체시간 · ↺ 처음으로 · 현재 캡쳐 · step`), 우측 = 범위 도구 (`범위 라벨 · 범위 초기화 · N초 입력 · 균등캡쳐`). 범위 라벨이 `ml-auto` 로 분리 — 범위 라벨이 없을 때(데이터 미로드)는 `범위 초기화` 가 그 역할을 대신. 좌·우 묶음은 `flex flex-wrap` 안에 있어 좁은 폭에서는 두 줄로 wrap 됨.

**액션 줄 범위 레이블**: `범위 0:00~0:10 (10.00s · N프레임)` — N = `framesInRange.length`.

**중복 timestamp 차단**:
- 상수 `TIMESTAMP_DEDUPE_EPS = 0.008` (라벨링 store §11.x 의 dedup 과 동일).
- 헬퍼 `hasFrameAt(frames, t)` — 기존 frames 중 `|Δt| < eps` 가 하나라도 있으면 true.
- **현재 캡쳐**: `video.currentTime` 이 기존 프레임과 충돌하면 setError 후 abort.
- **균등캡쳐**: 후보 `times[]` 를 (기존 frames) + (같은 배치 내 누적 accepted) 둘 다에 대해 미리 필터링. 모두 중복이면 알림 + abort. 일부 드롭 시 알림 후 나머지만 추출.

**썸네일**: 그리드/리스트라 `imageThumbUrl` 사용 (§11.12 정책).

### 9.2 `BottomTimeline` (`src/features/media/ui/BottomTimeline.tsx`)

추출 페이지 하단에 표시되는 통합 영역. 세 줄로 구성:

1. **Sprite preview / scrubber 트랙** — `pointerdown/move/up` 으로 클릭 + 드래그 모두 seek. 별도 hover 팝업은 두지 않음. cursor 라인은 video 모드면 `video.currentTime`, frame 모드면 active frame 의 timestamp.
   - 프레임 마커 3색: 현재 선택 frame = accent / 필터 통과 = amber / 필터 제외 = zinc dim.
2. **Range 트랙** — handle 항상 표시. handle 드래그 = resize, 본문/빈영역 드래그 = width 유지 평행이동(0~duration 클램프). `frameRange` 는 범위 필터와 균등 캡쳐 모두의 단일 source.
3. **단일 액션 줄** — 모든 버튼이 같은 베이스 클래스(`BTN_BASE`)와 변형(`BTN_DEFAULT`/`BTN_PRIMARY`/`BTN_DANGER`)을 공유. 좌→우: ▶/⏸ 토글 · `현재시간/전체시간` · 범위 라벨 · `초기화` · `현재 캡쳐`(video 모드만) · `N초 [입력] (min~max · n개)` · `균등캡쳐` · `범위 N개 삭제`.
   - **N초 입력**: 로컬 draft 상태로 받고 **blur 또는 Enter 에서만 commit**. ESC 로 되돌림. min/max 는 fps 기반 (`minInterval = 1/fps`, `maxInterval = span`) 으로 자동 클램프 — 그 외 값은 입력 자체가 차단됨. 결과 개수도 commit 후에만 갱신.
   - **균등캡쳐 위치 산출**: `times = [start + (i+0.5)*interval for i in 0..floor(span/interval))]` — 중앙 정렬, 양 끝점 제외.

### 9.3 추출 파이프라인 (`src/features/media/service/capture.ts`)

- **sprite 빌드**: worker 기반 키프레임 탐색(`public/workers/sprite-worker.js`, MP4Box) → 실패 시 `evenlySpacedTimes(...)` 폴백.
- **fps 추정**: `requestVideoFrameCallback` 12 샘플의 중앙값. 잘 알려진 fps 후보(23.976/24/25/...)에 ±2% 안이면 그 값으로 스냅.
- **`extractFrames`**: 옵션 `times[]` 를 순회하며 seek + canvas draw + `toBlob` 으로 인코딩. **두 가지 스트리밍 hook 지원**:
  - `onFrame: (frame) => void` — 인코딩 끝나는 즉시 emit. BottomTimeline 의 균등캡쳐가 이걸 `addFrames([f])` 로 흘려 넣어서 진행 중 strip / 마커가 실시간 갱신됨.
  - `signal: AbortSignal` — abort 되면 in-flight seek/encode 마무리 후 break. 이미 emit 된 프레임은 그대로 store 에 남음. UI 의 "중지" 버튼이 이걸 트리거.

### 9.4 단축키 (video 모드)

- `Space`: 재생/일시정지
- `C`: 현재 프레임 캡쳐
- `←/→`: ±stepSec (`Shift` 와 함께 ±stepSec × 5)

---

## 10) 유지보수 메모

- `MediaSource`는 `file?: File` 포함 (worker 전처리용)
- sprite/object URL은 cleanup에서 revoke해 메모리 누수 방지
- 무거운 작업은 worker/헬퍼 함수로 분리해 UI 인터랙션 블로킹 방지
- 비디오 정규화 파이프라인(`src/features/media/service/normalize.ts`): 서버 어댑터(`NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT`) 우선, 실패 시 ffmpeg.wasm 폴백
- 비디오 추출은 `FrameExtractionPage` 에 격리됨. 라벨링 워크스페이스 (`LabelingWorkspace`) 는 Image 만 다루며 비디오 element 를 마운트하지 않는다.
- 비디오 타임라인 + 추출 컨트롤은 `src/features/media/ui/BottomTimeline.tsx` 단일 컴포넌트가 담당.

---

## 11) Resource / Image / LabelSet 모델 (서버 persistence)

라벨링 워크스페이스 위에 Media Library 가 있고, 그 위에 프로젝트가 있습니다. 모든 데이터는 로컬 파일시스템(`./storage/`, gitignored)에 저장되며, 모든 API는 `src/lib/server/storage.ts`를 거치므로 향후 DB 교체 시 이 단일 파일만 바꾸면 됩니다.

### 11.1 도메인 엔티티

- **Resource** (`features/resources/types.ts`) — 한 번의 업로드 묶음. `type = "video" | "image_batch"`, name, tags[], (video 만) sourceExt/duration/width/height/previewCount.
- **Image** (`features/images/types.ts`) — 라벨링 단위. `source = "uploaded" | "video_frame"`, fileName/ext/width/height/tags[], video_frame 이면 `videoFrameMeta.{timestamp,frameIndex}`. 같은 Image 가 여러 LabelSet 에 멤버로 들어갈 수 있다.
- **LabelSet** (`features/labelsets/types.ts`) — 라벨링 작업 단위. `type = "polygon" | "bbox" | "classify"` 가 생성 시 고정. classes[] 와 imageIds[] 를 보유. 어노테이션은 별도 파일.

### 11.2 디스크 레이아웃 (`STORAGE_ROOT = ./storage`)

```text
storage/
  projects.json                                 # { projects: string[] }
  {projectId}/
    project.json                                # { id, name, createdAt, members }
    resources.json                              # string[] (resource ids)
    images.json                                 # string[] (image ids)
    labelsets.json                              # string[] (labelset ids)
    resources/{resourceId}/
      meta.json                                 # Resource
      source.<ext>                              # video resource 만
      previews/preview-{i}.jpg                  # video resource hover-reel
    images/{imageId}/
      meta.json                                 # Image
      bytes.<ext>                               # 이미지 바이트
      thumb-384.jpg                             # lazy 생성 썸네일 (§11.12)
    labelsets/{labelSetId}/
      meta.json                                 # LabelSet (id/name/type/classes/imageIds)
      annotations.json                          # { annotations: LabelSetAnnotation[] }
```

### 11.3 API 라우트 (`app/api/projects/...`)

| Method | Path | 용도 |
|---|---|---|
| GET/POST | `/api/projects` | 목록·생성 |
| GET/DELETE | `/api/projects/[id]` | detail·삭제 |
| GET/POST | `/api/projects/[id]/resources` | Resource 목록·생성(multipart, video 파일 포함) |
| GET/PATCH/DELETE | `/api/projects/[id]/resources/[rid]` | meta 조회·이름/태그 수정·삭제(자식 Image 까지 cascade) |
| GET | `/api/projects/[id]/resources/[rid]/source` | 원본 비디오 스트림. **HTTP Range 요청 지원**(206 Partial Content + `accept-ranges: bytes`). 브라우저는 Range 응답이 없으면 `<video>` 시킹을 silently 무시하므로 필수. `fs.createReadStream(start, end)` 으로 streaming. |
| POST/GET | `/api/projects/[id]/resources/[rid]/previews(/[idx])` | hover-reel 썸네일 |
| POST | `/api/projects/[id]/resources/[rid]/images` | Resource 에 Image 일괄 추가 (frame 추출 결과 포함) |
| GET | `/api/projects/[id]/images?resourceId=&source=&tag=` | Image 목록 (필터) |
| GET/PATCH/DELETE | `/api/projects/[id]/images/[iid]` | meta 조회·태그 수정·삭제(LabelSet 멤버십 + annotations 까지 cascade) |
| GET | `/api/projects/[id]/images/[iid]/bytes` | 원본 이미지 바이트 |
| GET | `/api/projects/[id]/images/[iid]/thumb` | 다운스케일 JPEG 썸네일 (lazy 생성, §11.12) |
| POST | `/api/projects/[id]/images/tags` | Image 태그 일괄 변경 (`{imageIds, tags, mode: "add"\|"remove"\|"replace"}`) |
| GET/POST | `/api/projects/[id]/labelsets` | LabelSet 목록·생성 |
| GET/PATCH/DELETE | `/api/projects/[id]/labelsets/[lsid]` | meta 조회·이름/classes/imageIds 수정·삭제 |
| GET/PUT | `/api/projects/[id]/labelsets/[lsid]/annotations` | annotations.json 조회·저장 |
| GET | `/api/projects/[id]/labelsets/[lsid]/export` | LabelSet JSON 다운로드 (`buildLabelSetExport`) |

클라이언트 측 fetch 래퍼는 각 feature 의 `service/api.ts` 에 있습니다 (`@/features/{resources,images,labelsets,projects}/service/api`). 각 feature 의 `index.ts` 는 **타입만** 재export 하고 서비스는 deep import (service → store 접근 금지 규칙 준수).

### 11.4 Media Library (`MediaLibraryPage`)

`/projects/[id]` 가 `MediaLibraryPage` 를 렌더하고, 그 안에서 `ResourcePool` + `ImagePool` 두 패널이 합성됩니다.

- **ResourcePool**: 업로드 묶음 단위 관리. 검색 / type 필터(video/image_batch). 비디오 resource 는 hover-reel(`previews/preview-{i}.jpg` 순환), 메타 행에 `duration · WxH` 표기. 이름 인라인 편집(`updateResource`). "Frame Extraction →" 링크로 `/projects/[id]/extract/[resourceId]` 이동. **Resource 자체에는 사용자 노출 태그 UI 가 없다** — 분류 의도는 Image 태그로 통일. 데이터 모델의 `Resource.tags` 필드는 잔존하지만 (호환성) 어떤 UI 도 표시·편집하지 않는다.
- **ImagePool**: 라벨링 단위 그리드. 4가지 view mode:
  - **All** — 평면 grid
  - **By Resource** — Resource 별 그룹 + "이 그룹 전체 선택"
  - **By Tag** — image tag 별 그룹 (멀티 태그 이미지는 여러 그룹에 중복 노출, 무태그 이미지는 "(no tag)" 그룹 하단)
  - **Resource × Tag matrix** — 행=tag, 열=resource, 셀=해당 (tag, resource) 의 image 수. 셀 클릭 = 셀에 속한 이미지 일괄 선택/해제
- **선택 모델**: `ImageSelection.ids: Set<string>` 가 단일 source. "현재 페이지 전체 선택" / "현재 결과 전체 선택" / "선택 해제" / 셀·그룹 일괄 선택 모두 같은 set 을 갱신.
- **선택 인터랙션**:
  - **클릭** = 단일 토글 (선택된 카드를 다시 클릭하면 해제)
  - **드래그(marquee)** = 박스 안의 카드들을 batch-toggle. 박스 안에 미선택이 하나라도 있으면 박스 전체를 추가 선택, 박스 전체가 이미 선택돼 있으면 박스 전체를 해제. 임계값 `MARQUEE_THRESHOLD = 4px` 미만의 움직임은 클릭으로 처리되어 카드 onClick 이 정상 발화. 임계값을 넘긴 드래그는 pointerup 직후의 click 을 `onClickCapture` 에서 swallow 해서 카드 토글이 두 번 일어나지 않게 한다 (`clickGuardRef`).
  - 카드는 `data-image-id` 를 달고 있어 marquee hit-test 가 `querySelectorAll("[data-image-id]")` + `getBoundingClientRect()` 로 일관되게 동작.
- **3행 스크롤 캡**: 모든 view mode 에서 `ImageGrid`(또는 `MatrixView`)의 스크롤 컨테이너에 `max-h-[336px]` 를 걸어 ~3행 이상이면 내부 세로 스크롤. By Resource / By Tag 그룹은 그룹별로 각자 캡이 걸리므로 그룹간 비교 시 페이지가 끝없이 길어지지 않는다.
- **그룹 들여쓰기**: `By Resource` / `By Tag` 그룹은 헤더 다음 그리드 본문에 `ml-2 pl-3 border-l border-[var(--color-line)]` 좌측 가이드라인을 그려 시각적 위계 강조. 헤더 자체는 들여쓰기 안 됨.
- **Pagination**: `PAGE_SIZE = 100` + "더 보기" 버튼으로 점진 확장. 필터/검색/view 변경 시 자동 리셋. 썸네일은 `loading="lazy"` + `decoding="async"`.
- **Filter 자동 초기화**: `selectedResourceId` 가 새 값으로 바뀌면 `search` / `sourceFilter` / `tagFilter` 를 즉시 리셋한다. 다른 Resource 로 점프했는데 직전 필터(예: `tag=cat`)가 남아 0장이 되는 혼란을 막기 위해.
- **Bulk tag**: 선택이 1장 이상일 때 "태그 일괄…" 버튼 → 인라인 `BulkTagBar`. 입력한 태그를 `add`/`remove`/`replace` 모드로 일괄 적용 (`POST /images/tags`). 성공 시 `onImagesMutated()` 로 부모가 재로드.
- **Selection bar 노출 규칙**: 선택 0 일 때는 액션 바 자체를 숨기고, 헤더에 작은 `[전체 선택 (N)]` 링크 하나만 노출 (entry point 보존). 선택 1+ 가 되는 즉시 accent-soft 배경의 액션 바(`{N}장 선택됨` · `현재 페이지 전체 선택` · `현재 결과 전체 선택` · `선택 해제` · `태그 일괄…` · `Start Labeling →`)가 펼쳐짐. 빈 선택 상태에서 화면을 차지하지 않게 하면서, 선택 인터랙션은 카드 클릭/marquee 로 시작.
- **Start Labeling**: 선택 1장 이상에서 활성화. `StartLabelingModal` 로 새 LabelSet 생성 또는 기존에 추가 (existing 의 경우 imageIds union → PATCH).

### 11.5 Frame Extraction (`FrameExtractionPage`)

`/projects/[id]/extract/[resourceId]` — 비디오 resource → Image(`source = "video_frame"`) 추출 단독 페이지. video element + sprite + 자체 inline timeline(sprite preview 트랙 / range 트랙 / 액션 줄 / 좌상단 HUD / 추출 프레임 strip) 을 마운트. 추출된 프레임은 `addImagesToResource(projectId, resourceId, [...])` 로 서버에 즉시 등록되며, 클라이언트가 ID 를 미리 할당하므로 추출 직후 Media Library 로 돌아가도 동일한 Image id 를 본다. **인터랙션 사양 (HUD / 핸들 시킹 / strip 가로 스크롤 + hover 시킹 + 선택 + 삭제 / 마커 색 / 중복 차단) 은 §9.1 참고.**

**비디오 컨트롤**: `<video controls>` 로 네이티브 HTML5 컨트롤(▶/일시정지/시킹바/볼륨/속도)을 그대로 노출. 사용자는 비디오 위에서 직접 재생·시킹하고, 하단 sprite preview 트랙은 큰 그림 한눈에 보기 + 마커, range 트랙은 균등캡쳐/필터 범위 선택 전용으로 역할이 분리된다. 액션 줄의 `↺ 처음으로` 버튼은 `currentTime = 0` 만 호출.

### 11.6 LabelSet 워크스페이스 하이드레이션 (`LabelingWorkspace`)

`/projects/[id]/labelsets/[lsid]` — 마운트 시:

1. `reset()` 으로 store 초기화
2. `getLabelSet()` + `getLabelSetAnnotations()` + `listImages()` 병렬 fetch
3. LabelSet 의 `imageIds` 순서로 멤버 이미지를 정렬 → `Image` 를 `Frame` 으로 어댑트(`imageBytesUrl(...)` URL, width/height, optional timestamp)
4. annotations 는 `annotationFromApi()` 로 store 의 `Annotation` 형태(`frameId` 가 곧 imageId)로 변환
5. `useStore.setState({ frames, classes, annotations, activeToolId, labelSetType, ... })` — `activeToolId` 는 LabelSet type 에 따라 `rect` / `polygon` / `classify`. 워크스페이스에서는 `frameRange` / `unlabeledOnly` / `exceptedFrameIds` 를 끔(영상 시간 개념이 무의미).

**LabelSet 전환 안전장치**: `useLabelSetSync` 가 `[projectId, labelSetId]` 의존성마다 `generationRef` 를 +1 하고, 디바운스 setTimeout 콜백이 자기 generation 이 아니면 즉시 bail. 이전 LabelSet 컨텍스트의 in-flight 저장이 새 LabelSet 데이터를 덮어쓰지 못하게 막는다 (이전 컨텍스트의 정상적인 마지막 저장은 그대로 디스크에 반영됨 — 작업 손실 없음).

### 11.7 useLabelSetSync (`src/components/useLabelSetSync.ts`)

라벨링 워크스페이스 안에서 store ↔ 서버 업로드를 전담하는 hook (다운로드는 위 §11.6 의 hydration 가 담당):

1. **annotations 디바운스 저장** — `annotations` 변경 시 500ms 디바운스 후 `saveLabelSetAnnotations()` (annotations.json 전체 PUT).
2. **classes 디바운스 저장** — `classes` 변경 시 500ms 디바운스 후 `updateLabelSet({classes})` (LabelSet meta PATCH).
3. annotation 의 `frameId` ↔ API 의 `imageId` 변환은 `annotationFromApi`/`annotationToApi` 가 처리. classify 타입은 shape 없이 `{kind:"classify", classId, imageId}` 만 직렬화.

### 11.8 업로드 플로우 (`UploadResourceModal`)

비디오는 `createResource({type:"video", file, width, height, duration})` 로 등록 후, `extractFrames(evenlySpacedTimes(duration, PREVIEW_COUNT=10))` → `uploadResourcePreviews()` 로 hover-reel 썸네일 best-effort 업로드. image_batch 는 `createResource({type:"image_batch"})` → `addImagesToResource()` 로 파일 묶음 등록. 업로드 함수들은 `setProgress(label)` + `setProgressPct(0..100|null)` 두 가지를 모두 받아 `ProgressDisplay` 가 phase 라벨 + 결정/비결정 진행 바를 렌더한다.

`MediaLibraryPage` 의 진입점은 단일 `[+ 업로드]` 버튼 하나뿐이며 모달이 `initialMode="video"` 로 열린다. 사용자는 (a) 모달 상단의 `Video / Image Batch` 세그먼트로 직접 모드를 바꾸거나, (b) 파일을 드롭해 자동 분류시킨다 (drag&drop 규칙 아래 참고). 모달은 Resource 태그 입력 UI 를 두지 않으며 `tags` 는 항상 빈 배열로 등록된다 (§11.4 의 Resource 태그 정책).

**Drag & drop**: 모달 박스 자체가 드롭 타겟. 드롭한 파일들의 종류에 따라 `mode` 가 자동 전환됨:
- 비디오 1개만 → `mode = "video"` 로 스위치 + 그 파일 선택
- 이미지만 → `mode = "image_batch"` 로 스위치 + 모든 이미지 선택
- 혼합 / 알 수 없는 종류 → 현재 `mode` 의 inferMediaKind 필터로 fallback
- `name` 필드가 비어 있으면 첫 파일명에서 확장자를 떼서 자동 prefill
- 드래그 중 모달 외곽이 accent ring 으로 강조

**디코딩 진행률 시각화**: `normalize()` 가 `progress: 0..1` 을 보고하면 그 값을 그대로 % 로 표시. 보고 가능한 진행률이 없는 phase (server backend 가 % 를 안 주는 경우, ffmpeg.wasm `local` phase) 에는 `setInterval(400ms)` 로 95% 까지 점근하는 pseudo progress 를 굴려 사용자가 "멈춤" 으로 오해하지 않게 한다 — 다음 phase 진입 시점에 `clearInterval` + `setProgressPct(null)` 로 리셋되고, 결정 % 가 들어오면 즉시 점근 progress 를 끈다. 미리보기 추출 phase 에서는 `extractFrames({onProgress: (done, total) => setProgressPct((done/total)*100)})` 로 실제 진행률 사용.

### 11.9 Export (`features/export`)

`buildLabelSetExport({labelSet, images, resources, annotations})` 가 LabelSet 단위 export JSON(`version: 2`) 을 생성한다. 포함되는 것:

- LabelSet meta (id/name/type/classes/createdAt)
- 멤버 Image 의 메타 (id/fileName/width/height/source/tags/videoFrameMeta + 소속 Resource 요약)
- 모든 annotations (kind 별 shape 포함)

이미지 바이트는 인라인하지 않고 `/api/projects/{id}/images/{imageId}/bytes` 로 계속 addressable. 다운로드는 `GET /api/projects/[id]/labelsets/[lsid]/export` 가 `Content-Disposition: attachment` 헤더로 반환하며, LabelSet 목록 페이지·라벨링 워크스페이스 헤더 양쪽에 "Export JSON" 링크가 있다.

### 11.10 설정

- `storage/`는 `.gitignore` 대상.
- `next.config.mjs`에서 `experimental.serverActions.bodySizeLimit = "2gb"`로 대용량 비디오 업로드 허용.

### 11.11 동시성 모델 (storage.ts)

여러 요청이 같은 인덱스 JSON 에 동시에 read-modify-write 를 하면 baseline 충돌로 항목이 silently 누락되던 버그를 막기 위해, 모든 RMW 경로가 두 가지 가드를 거친다:

1. **per-path in-process mutex (`withFileLock`)**: `Map<filePath, Promise>` 기반 직렬화 큐. 같은 파일 경로에 대한 mutator 가 절대 겹치지 않게 한다. 락 entry 는 tail 이 settle 되면 자동 정리되고, 한 mutator 의 throw 가 큐를 막지 않는다. 적용 대상:
   - `projects.json` — `createProject`/`deleteProject`
   - `resources.json` / `images.json` / `labelsets.json` — `appendToIndex`/`removeFromIndex`
   - 각 entity 의 `meta.json` — `updateResource`/`updateImage`/`updateLabelSet`/`bulkTagImages`/`writePreviews`
   - `annotations.json` — `mutateLabelSetAnnotations`
2. **atomic write**: `writeJson()`은 `.tmp` 파일에 쓰고 `rename(tmp, target)`으로 교체. reader 는 항상 이전 또는 새 내용만 보고 partial JSON 은 절대 노출되지 않는다. mid-write 크래시도 `target` 자체는 손상되지 않음.

권장 진입점: `mutateLabelSet(projectId, lsid, mutator)`, `mutateLabelSetAnnotations(projectId, lsid, mutator)`. mutator 가 정확히 `false` 를 리턴하면 write 를 스킵한다 (no-op 케이스). `bulkTagImages` 는 imageIds 별로 각 meta.json 락을 순차로 잡으므로 같은 이미지에 대한 single-image PATCH 와 안전하게 겹친다.

향후 DB 로 옮기면 `storage.ts` 한 파일만 교체하면 되고 락도 함께 사라진다.

### 11.12 이미지 썸네일 파이프라인 (Media Library 성능)

Media Library 의 `ImagePool` 그리드는 카드당 96px 정도만 표시하지만, 원본 이미지를 그대로 받으면 페이지 한 번에 수백 MB 다운로드가 발생한다. 이를 막기 위해 별도 thumb 엔드포인트를 둔다.

- **저장**: `storage/{projectId}/images/{imageId}/thumb-384.jpg` (단일 사이즈, 384px longest-edge, JPEG q=75 mozjpeg).
- **생성 시점**: **lazy** — 업로드 시점에는 만들지 않고, `/thumb` 첫 요청에서 만든 뒤 디스크에 캐시. 기존 이미지 backfill 마이그레이션 불필요.
- **동시성**: thumb 파일 경로에 `withFileLock` 을 잡고, lock 안에서 다시 한 번 read 시도(double-checked) 후 없을 때만 sharp 호출. 같은 이미지에 동시에 N 개 요청이 와도 인코딩은 1번만 발생.
- **sharp 파이프라인**: `.rotate()` (EXIF auto-orient) → `.resize(384, 384, {fit: "inside", withoutEnlargement: true})` → `.jpeg({quality: 75, mozjpeg: true})`.
- **import 방식**: storage.ts 상단에서 import 하지 않고 함수 안에서 `await import("sharp")` 로 동적 로드. sharp 가 native binding 이라 콜드 시작 비용을 lazy 로 미루기 위함.
- **클라이언트 헬퍼**: `imageThumbUrl(projectId, imageId)` (`@/features/images/service/api`). `ImagePool` 의 카드 그리드만 이걸 쓰고, **`AnnotationStage` / `BulkApplyModal` / `LabelingWorkspace` 등 정확한 픽셀이 필요한 곳은 절대 thumb 을 쓰지 말고 `imageBytesUrl` 유지**. 벡터 도구가 잘못된 좌표를 생성한다.
- **캐시 정책**: thumb 라우트 + bytes 라우트 + previews 라우트 모두 `cache-control: private, max-age=31536000, immutable`. 이미지 id 와 preview index 가 안정적이라 안전. 페이지 재방문 비용 즉시 0.

이 thumb 엔드포인트가 Media Library 페이지 성능의 가장 큰 레버다 (원본 2~5MB × 100 → ~30KB × 100). 새로운 그리드/리스트 뷰를 만들 때도 기본은 thumb, 정확도가 필요한 곳만 bytes 로 골라 쓸 것.

### 11.13 Resource hover-reel mount 정책

`ResourcePool` 의 `PreviewReel` (`src/components/ResourcePool.tsx`) 은 **frame 0 만 항상 mount**, 나머지 frame 1..N-1 은 사용자가 처음 hover 한 시점에 mount 한다 (`mountedAll` state, 한 번 켜지면 unmount 안 함 → 재-hover 시 flash 없음). 비디오 resource 가 10개 × 12 frame 이면 idle = 10 fetch, 모두 hover 후 = 120 fetch. 카드를 한 번도 가리키지 않으면 추가 110 fetch 가 영구 절약된다. 새 hover-reel 류 위젯을 만들 때도 같은 패턴 사용.

---

## 12) 흔한 함정 (재발 방지 가이드)

이 프로젝트에서 한 번 이상 며칠을 태운 함정들. 비슷한 코드를 만질 때 반드시 먼저 체크할 것.

### 12.1 비디오 시킹은 서버 Range 지원에 절대 의존한다

**증상**: `<video>` 의 native scrubber, 스크립트로 `currentTime = X` 쓰기, 키보드 ←/→, 사용자가 만든 sprite/range 트랙 클릭, 프레임 썸네일 클릭 — **시킹 관련 모든 상호작용**이 동작하지 않음. 에러도 안 남. 비디오는 처음부터 재생되긴 함.

**원인**: 비디오를 서빙하는 라우트가 HTTP Range 요청을 처리하지 않음. 응답에 `accept-ranges: bytes` 가 없거나, `Range:` 헤더 무시하고 항상 전체 파일 200 으로 반환. Chrome/Firefox/Safari 모두 Range 응답 없으면 시킹을 silently 무시함.

**해결**: `app/api/projects/[id]/resources/[rid]/source/route.ts` 가 정답 템플릿. `statResourceSource()` 로 path/size 만 읽고, `Range:` 헤더 파싱(`bytes=A-B` / `bytes=A-` / `bytes=-N` 모두 지원), `fs.createReadStream(path, {start, end})` 로 streaming, `206 Partial Content` + `content-range: bytes A-B/total` + `accept-ranges: bytes` 반환. Range 없으면 200 + `accept-ranges: bytes` 광고.

**검증**: dev server 띄우고 curl 로 직접 찔러서 206/range 헤더가 나오는지 확인:
```bash
curl -i -H "Range: bytes=0-99" http://localhost:3000/api/projects/X/resources/Y/source
# expect: HTTP/1.1 206 Partial Content + content-range: bytes 0-99/<total>
```

비디오 시킹이 동작하지 않는다는 보고가 들어오면 **클라이언트 코드를 만지기 전에 먼저 이 라우트의 Range 응답을 검증**할 것. 5분이면 됨.

### 12.2 Pointer-capture on a parent breaks child `onClick`

**증상**: 컨테이너에 marquee/drag selection 을 붙였더니 자식 카드의 단일 클릭 토글이 동작하지 않음. 드래그는 됨.

**원인**: 컨테이너 `onPointerDown` 에서 `e.currentTarget.setPointerCapture(e.pointerId)` 호출. 캡처는 후속 pointerup 을 컨테이너로 redirect 시키고, click 이벤트는 그 redirected pointerup 위치에서 합성되므로 **자식 button 의 onClick 이 절대 발화 안 함**. 임계값 미만 움직임이라 `dragged=false` 라도 캡처가 걸려있으면 클릭이 죽는다.

**해결**: 컨테이너에 캡처를 걸지 말고, `onPointerDown` 안에서 `document.addEventListener("pointermove"/"pointerup")` 을 등록하는 패턴 사용. pointer 가 컨테이너를 벗어나도 추적되며 child click 은 native 경로로 정상 발화. drag 가 임계값을 넘은 경우만 `clickGuardRef = true` + `onClickCapture` 로 다음 click 한 번만 swallow. `src/components/ImagePool.tsx::ImageGrid` 참고.

캡처가 정말로 필요한 경우(예: 단일 핸들 드래그처럼 child onClick 을 살릴 필요가 없는 인터랙션)는 그대로 써도 된다 — `BottomTimeline` 의 sprite/range 트랙이 그 예시. 컨테이너의 단일 click 만 발화하면 되는 곳.

### 12.3 absolute child 좌표는 스크롤 컨텐츠 기준

**증상**: marquee 박스가 스크롤 안 한 상태에서는 정상인데, 스크롤 내려서 드래그하면 박스가 안 보임.

**원인**: `position: absolute` 자식은 가장 가까운 `position: relative` 조상(=스크롤 컨테이너) 의 **스크롤 컨텐츠 박스** 기준으로 배치된다. 보이는 viewport 가 아님. 따라서 `top: 50` 은 "스크롤 컨텐츠 맨 위에서 50px" 이고, 컨테이너가 `scrollTop=200` 이면 보이는 영역에서는 위로 150px 빠져 있음.

**해결**: 좌표를 **scroll-content space** 로 통일. pointer 좌표는 `clientY - rect.top + el.scrollTop`, hit-test 도 같은 좌표계로 계산. `ImageGrid` 의 marquee 가 정답 템플릿.

### 12.4 `<img>` 는 기본 draggable — pointerdown 가로챈다

**증상**: pointer 기반 selection/marquee 를 만들었는데 이미지 위에서 드래그 시작하면 브라우저가 이미지 고스트를 따라 움직이고 우리 marquee 가 안 만들어짐. 클릭 토글도 죽음.

**원인**: `<img>` 는 HTML 기본 `draggable=true`. pointerdown 에서 충분히 움직이면 브라우저가 native `dragstart` 를 발화하고, 그 시점에서 우리의 pointer 시퀀스가 abort 됨.

**해결**: 이미지 카드의 `<img>` 에 `draggable={false}` + `onDragStart={e => e.preventDefault()}` (보험) + `pointer-events-none` (pointerdown 이 부모 button 에 바로 떨어지게) + `select-none`. `ImagePool::ImageCard` 참고. 이미지 외에도 `<a>`, selected 상태의 `<input>` 등이 비슷한 native drag 동작을 가질 수 있으니 새 위젯 만들 때 한 번씩 의심할 것.

### 12.5 비디오 핸들러는 React state 가 아니라 element 에서 직접 읽기

**증상**: 비디오 로드 직후 첫 시킹/캡쳐가 동작 안 하거나 0 으로 클램프됨.

**원인**: 핸들러가 React state 의 `duration`/`currentTime` 을 읽는데, 이 값은 video element 의 `loadedmetadata`/`timeupdate` 이벤트로 setState 한 뒤 다음 렌더에서야 반영됨. 클로저는 렌더 시점의 값을 캡처하므로 stale 가능.

**해결**: 핸들러 안에서 `videoRef.current.duration` / `videoRef.current.currentTime` 를 직접 읽기. React state 는 UI 표시용으로만 쓰고, 실제 시킹/클램프 계산에는 element 값을 사용. `FrameExtractionPage::seek` 참고.

### 12.6 키보드 step 기본값은 시각적으로 인지 가능해야

비디오 ±step 키바인딩의 기본 step 이 너무 작으면(예: 0.1s) 사용자는 "동작 안 함" 으로 인지함. 기본 1s, Shift+키 = 5s 정도가 합리적. 정밀 제어가 필요하면 fps 기반 1프레임(`1/fps`) 을 별도 단축키로 노출하는 식으로 분리.
