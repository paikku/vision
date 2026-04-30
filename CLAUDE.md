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

- **정렬**: 추가순 / 시간순(timestamp 기준)
- **필터**: 미라벨(annotation 0개 + `exceptedFrameIds`에 없는 frame) / 범위(`frameRange` 안의 timestamp 만)
  - 범위 필터는 **기본 ON**. 미디어 로드 시 `frameRange = [0, duration]` 으로 초기화되므로 처음에는 보이는 결과가 동일하지만, 사용자가 BottomTimeline 의 핸들을 좁히면 즉시 strip 도 좁혀짐.
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

비디오 → Image(`source = "video_frame"`) 추출은 라벨링 워크스페이스와 분리된 단독 페이지(`FrameExtractionPage`, `/projects/[id]/extract/[resourceId]`)에서 일어납니다. 비디오 element / sprite / fps / time / busy 등 비디오 상태는 이 shell 안에서 자체 관리되고, 하단 타임라인은 feature 컴포넌트 `BottomTimeline` 에 위임합니다.

### 9.1 `FrameExtractionPage` (`src/components/FrameExtractionPage.tsx`)

- Resource source 비디오를 `<video>` 로 마운트하고, 추출 결과는 `addImagesToResource(projectId, resourceId, [...])` 로 즉시 서버에 등록 → 같은 페이지 안에서 썸네일 그리드로 다시 보여준다.
- 추출된 Image 의 id 는 클라이언트가 미리 할당하므로 (UUID), Media Library 로 돌아가도 동일 id 를 본다.
- 페이지를 떠나면 비디오/sprite 상태는 폐기됨. 라벨링 워크스페이스는 비디오를 보지 않고 Image 만 본다.

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
| GET | `/api/projects/[id]/resources/[rid]/source` | 원본 비디오 스트림 |
| POST/GET | `/api/projects/[id]/resources/[rid]/previews(/[idx])` | hover-reel 썸네일 |
| POST | `/api/projects/[id]/resources/[rid]/images` | Resource 에 Image 일괄 추가 (frame 추출 결과 포함) |
| GET | `/api/projects/[id]/images?resourceId=&source=&tag=` | Image 목록 (필터) |
| GET/PATCH/DELETE | `/api/projects/[id]/images/[iid]` | meta 조회·태그 수정·삭제(LabelSet 멤버십 + annotations 까지 cascade) |
| GET | `/api/projects/[id]/images/[iid]/bytes` | 원본 이미지 바이트 |
| POST | `/api/projects/[id]/images/tags` | Image 태그 일괄 변경 (`{imageIds, tags, mode: "add"\|"remove"\|"replace"}`) |
| GET/POST | `/api/projects/[id]/labelsets` | LabelSet 목록·생성 |
| GET/PATCH/DELETE | `/api/projects/[id]/labelsets/[lsid]` | meta 조회·이름/classes/imageIds 수정·삭제 |
| GET/PUT | `/api/projects/[id]/labelsets/[lsid]/annotations` | annotations.json 조회·저장 |
| GET | `/api/projects/[id]/labelsets/[lsid]/export` | LabelSet JSON 다운로드 (`buildLabelSetExport`) |

클라이언트 측 fetch 래퍼는 각 feature 의 `service/api.ts` 에 있습니다 (`@/features/{resources,images,labelsets,projects}/service/api`). 각 feature 의 `index.ts` 는 **타입만** 재export 하고 서비스는 deep import (service → store 접근 금지 규칙 준수).

### 11.4 Media Library (`MediaLibraryPage`)

`/projects/[id]` 가 `MediaLibraryPage` 를 렌더하고, 그 안에서 `ResourcePool` + `ImagePool` 두 패널이 합성됩니다.

- **ResourcePool**: 업로드 묶음 단위 관리. 검색 / type 필터(video/image_batch) / Resource 태그 필터. 비디오 resource 는 hover-reel(`previews/preview-{i}.jpg` 순환). 이름·태그 인라인 편집(`updateResource`). "Frame Extraction →" 링크로 `/projects/[id]/extract/[resourceId]` 이동.
- **ImagePool**: 라벨링 단위 그리드. 4가지 view mode:
  - **All** — 평면 grid
  - **By Resource** — Resource 별 그룹 + "이 그룹 전체 선택"
  - **By Tag** — image tag 별 그룹 (멀티 태그 이미지는 여러 그룹에 중복 노출, 무태그 이미지는 "(no tag)" 그룹 하단)
  - **Resource × Tag matrix** — 행=tag, 열=resource, 셀=해당 (tag, resource) 의 image 수. 셀 클릭 = 셀에 속한 이미지 일괄 선택/해제
- **선택 모델**: `ImageSelection.ids: Set<string>` 가 단일 source. "현재 페이지 전체 선택" / "현재 결과 전체 선택" / "선택 해제" / 셀·그룹 일괄 선택 모두 같은 set 을 갱신.
- **Pagination**: `PAGE_SIZE = 100` + "더 보기" 버튼으로 점진 확장. 필터/검색/view 변경 시 자동 리셋. 썸네일은 `loading="lazy"` + `decoding="async"`.
- **Bulk tag**: 선택이 1장 이상일 때 "태그 일괄…" 버튼 → 인라인 `BulkTagBar`. 입력한 태그를 `add`/`remove`/`replace` 모드로 일괄 적용 (`POST /images/tags`). 성공 시 `onImagesMutated()` 로 부모가 재로드.
- **Start Labeling**: 선택 1장 이상에서 활성화. `StartLabelingModal` 로 새 LabelSet 생성 또는 기존에 추가 (existing 의 경우 imageIds union → PATCH).

### 11.5 Frame Extraction (`FrameExtractionPage`)

`/projects/[id]/extract/[resourceId]` — 비디오 resource → Image(`source = "video_frame"`) 추출 단독 페이지. video element + sprite + `BottomTimeline`(범위 트랙·균등캡쳐·현재 캡쳐) 을 자체 마운트. 추출된 프레임은 `addImagesToResource(projectId, resourceId, [...])` 로 서버에 즉시 등록되며, 클라이언트가 ID 를 미리 할당하므로 추출 직후 Media Library 로 돌아가도 동일한 Image id 를 본다.

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

`MediaDropzone` 을 `onComplete` 콜백 모드로 재사용. 비디오는 `createResource({type:"video", file, width, height, duration})` 로 등록 후, `extractFrames(evenlySpacedTimes(duration, PREVIEW_COUNT=10))` → `uploadResourcePreviews()` 로 hover-reel 썸네일 best-effort 업로드. image_batch 는 `createResource({type:"image_batch"})` → `addImagesToResource()` 로 파일 묶음 등록.

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
