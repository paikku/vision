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
- 앱 진입점은 `/` → `/projects` 리디렉션(`app/page.tsx`)입니다. 라벨링 워크스페이스는 특정 비디오 URL(`/projects/[id]/videos/[vid]`) 하위에 위치합니다.
- 라우트 구성:
  - `/projects` — 프로젝트 목록/생성/삭제 (`ProjectsPage`)
  - `/projects/[id]` — 비디오 테이블·프레임 그리드·다운로드 (`ProjectDetailPage`)
  - `/projects/[id]/videos/[vid]` — 어노테이션 워크스페이스 (`ProjectWorkspace`)
- 라벨링 워크스페이스는 페이지 마운트 시 `getVideoData()`로 서버 데이터를 가져와 store를 hydrate한 뒤 `media`가 채워지면 렌더됩니다.

### Feature 경계 (중요)

코드는 feature 단위로 분리되어 있고, 경계는 ESLint `no-restricted-imports`로 강제됩니다.
**경계 규칙 전체 스펙은 `/REFACTOR_RULES.md` 참고.** 작업 전 반드시 읽을 것.

```text
src/
  components/           # shell · 여러 feature 조합하는 유일한 자리 (ProjectsPage, ProjectDetailPage, ProjectWorkspace, ProjectTopBar, UploadVideoModal, MainMediaPanel, useProjectSync)
  features/
    media/              # 업로드·normalize·비디오 재생·프레임 추출
    frames/             # 프레임 목록·활성 프레임·exception
    annotations/        # class·shape·tool·drawing·keyboard
    export/             # 직렬화/다운로드
    projects/           # 프로젝트·비디오·프레임 서버 API 래퍼 (fetch 기반, store 비의존)
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
- `useReleaseNonTextFocus(rootRef)` — shell(`Workspace`, `ProjectWorkspace`)에서 한 번 호출. root에 capture-phase로 `pointerup`/`change`/`keyup` 리스너를 달고, 인터랙션 종료 후 `requestAnimationFrame`에서 `document.activeElement`가 `isTextInputElement` 아니면 `blur()`. select 드롭다운은 정상 동작하고, 값 선택 후에만 포커스가 풀림. Tab 키 네비게이션은 트리거하지 않아 키보드 접근성 보존.
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

워크스페이스 중앙 패널은 shell 인 `MainMediaPanel` 이 통합 오너 한다. 비디오 element / sprite / fps / time / busy 등 비디오 상태는 모두 여기에 있고, 하단 타임라인은 feature 컴포넌트 `BottomTimeline` 에 위임한다.

### 9.1 `MainMediaPanel` (`src/components/MainMediaPanel.tsx`)

- 비디오 element 는 **항상 마운트** (video 모드 = 보임 / frame 모드 = `display:none`). fps 추정·sprite·seek·`captureCurrent` 가 모드 전환 시 끊기지 않게 하기 위함.
- `centerViewMode === "video"`: 비디오 + 스텝 입력 패널.
- `centerViewMode === "frame"`: `<AnnotationStage />` + 우하단에 "비디오 재생으로 전환" 텍스트 버튼만 (mini PIP 비디오는 없음).
- video 모드일 때 `<Toolbar />` 는 `ProjectWorkspace`/`Workspace` 에서 숨김.
- 키보드: video 모드는 `Space/C/←/→`, frame 모드는 `↑/↓` 만 처리.
- `seek(t)` 는 video 모드면 그냥 `currentTime` 갱신, frame 모드에서 호출되면 `centerViewMode = "video"` 로 전환 + `pause()` + `currentTime` 설정 → BottomTimeline 트랙 클릭 한 번으로 정지된 비디오 화면으로 자연스럽게 넘어옴.

### 9.2 `BottomTimeline` (`src/features/media/ui/BottomTimeline.tsx`)

video 모드와 frame 모드에 동일하게 표시되는 통합 하단 영역. 세 줄로 구성:

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
- 중앙 워크스페이스 `centerViewMode`: `video`(재생/추출) / `frame`(어노테이션 스테이지). video 모드일 땐 `Toolbar` 도 숨김.
- 비디오 타임라인 + 추출 컨트롤은 `src/features/media/ui/BottomTimeline.tsx` 단일 컴포넌트가 담당. 양 모드 모두 하단에 동일하게 노출됨.

---

## 11) 프로젝트/비디오 관리 (서버 persistence)

라벨링 워크스페이스 위에 프로젝트·비디오 관리 레이어가 얹혀 있습니다. 비디오·프레임·어노테이션은 로컬 파일시스템(`./storage/`, gitignored)에 저장되며, 모든 API는 `src/lib/server/storage.ts`를 거치므로 향후 DB 교체 시 이 단일 파일만 바꾸면 됩니다.

### 11.1 디스크 레이아웃 (`STORAGE_ROOT = ./storage`)

```text
storage/
  projects.json                              # ProjectSummary[]
  {projectId}/
    project.json                             # { id, name, createdAt, members }
    videos.json                              # VideoSummary[]
    {videoId}/
      meta.json                              # VideoMeta (+ previewCount)
      source.<ext>                           # normalize된 원본 비디오/이미지
      data.json                              # { classes, frames[], annotations[] }
      frames/{frameId}.jpg                   # 추출/캡처된 프레임 바이트
      preview-{0..previewCount-1}.jpg        # 비디오 hover-reel 썸네일
```

### 11.2 API 라우트 (`app/api/projects/...`)

| Method | Path | 용도 |
|---|---|---|
| GET/POST | `/api/projects` | 목록·생성 |
| GET/DELETE | `/api/projects/[id]` | detail(프로젝트 + videos)·삭제 |
| GET/POST | `/api/projects/[id]/videos` | 비디오 목록·업로드(multipart) |
| GET/DELETE | `/api/projects/[id]/videos/[vid]` | meta 조회·삭제(프레임 포함 재귀 정리) |
| GET | `/api/projects/[id]/videos/[vid]/source` | 원본 비디오 스트림 |
| GET/PUT | `/api/projects/[id]/videos/[vid]/data` | `data.json` 조회·저장 (**PUT은 classes+annotations만 덮어씀**, frames는 별도 엔드포인트로 관리) |
| POST | `/api/projects/[id]/videos/[vid]/frames` | 프레임 일괄 업로드(multipart, meta JSON + files) |
| GET/DELETE | `/api/projects/[id]/videos/[vid]/frames/[fid]` | 프레임 이미지·삭제 |
| POST | `/api/projects/[id]/videos/[vid]/previews` | hover-reel 썸네일 일괄 업로드 |
| GET | `/api/projects/[id]/videos/[vid]/previews/[idx]` | 개별 preview |
| GET | `/api/projects/[id]/export?videos=&frames=` | 선택된 videos/frames의 JSON export (frames 우선) |

클라이언트 측 fetch 래퍼는 모두 `src/features/projects/service/api.ts`에 있습니다. `features/projects/index.ts`는 **타입만** 재export하고 서비스는 경로로 직접 import (service → store 접근 금지 규칙 준수).

### 11.3 ProjectDetailPage (`src/components/ProjectDetailPage.tsx`)

- **비디오 테이블**: `table-fixed` + `<colgroup>` 고정폭(체크박스 40 / 이름 260 / 해상도 96 / duration·frames·labels 72 / actions 160, "라벨 종류"가 잔여 폭 흡수). 긴 이름은 `truncate` + `title=`.
- **비디오 hover-reel**: 이름 좌측에 `preview-0.jpg` 인라인, hover 시 `PREVIEW_REEL_INTERVAL_MS = 220ms`로 전체 preview 순환. 모든 이미지를 미리 마운트해 깜빡임 방지.
- **프리뷰 tooltip**: 프레임 썸네일/미리보기 버튼 hover 시 `createPortal`로 document.body에 렌더 → table row 마크업 밖으로 escape. 프레임 tooltip은 class 색상 rect + HTML 라벨 오버레이 포함.
- **프레임 그리드 가상화**: `FRAMES_PAGE_SIZE = 50` 단위로 `IntersectionObserver` sentinel이 뷰포트 진입 시 50개씩 창 확장. 수천 개 프레임에도 초기 렌더 비용을 일정하게 유지.
- **선택 모델**: 비디오 체크박스는 해당 비디오의 모든 프레임을 토글(+per-frame override 초기화), 프레임 체크박스는 개별 토글. 최종 선택은 둘의 합집합. Download는 `frames=`(있으면 우선) 또는 `videos=`로 export URL 생성.
- **Class breakdown**: `VideoBundle.classCounts`로 비디오 행 "라벨 종류" 컬럼에 색상 pill + 카운트. 셀별 `max-w-full` + 내부 truncate로 긴 class 이름도 가로 overflow 없음.

### 11.4 업로드 플로우 (`UploadVideoModal`)

- `MediaDropzone`을 `onComplete` 콜백 모드로 재사용 (store에 commit하지 않고 정규화 결과만 콜백에 전달).
- 업로드 완료 후 비디오라면 `extractFrames(evenlySpacedTimes(duration, PREVIEW_COUNT=10))`으로 10장 추출 → `uploadPreviews()`로 POST. preview 업로드 실패는 비차단(best-effort).

### 11.5 useProjectSync (`src/components/useProjectSync.ts`)

`ProjectWorkspace` 안에서 store ↔ 서버 동기화를 전담하는 hook. 책임은 세 가지:

1. **프레임 업로드**: `blob:` URL로 새로 추가된 frame을 `uploadFrames()`로 보내고, 성공 시 `useStore.setState`로 URL을 서버 URL(`frameImageUrl(...)`)로 교체 + 기존 blob URL revoke. 중복 업로드 방지용 `knownFrameIdsRef` / `uploadingRef` 관리.
2. **프레임 삭제**: store에서 빠진 frame id를 감지하면 `apiDeleteFrame()` 호출.
3. **data.json 디바운스 저장**: classes/annotations 변경 시 500ms 디바운스 후 `saveVideoData()`. 프레임 배열은 여기서 보내지 않음 — `frames: []`로 명시해 별도 엔드포인트(POST/DELETE frames)와의 경쟁을 차단.

### 11.6 ProjectWorkspace 하이드레이션

`ProjectWorkspace`는 마운트 시 `reset()` → `getVideoData()` → 비디오 파일을 blob으로 fetch해 `File` 생성 → `MediaSource` 조립 → `useStore.setState({ media, frames, annotations, classes, activeFrameId, activeClassId, centerViewMode })`. 서버에 classes가 없으면 기본 class 하나로 seed. 프레임 URL은 서버 URL이므로 cleanup의 revoke는 no-op, video blob URL만 실제로 revoke됨.

### 11.7 설정

- `storage/`는 `.gitignore` 대상.
- `next.config.mjs`에서 `experimental.serverActions.bodySizeLimit = "2gb"`로 대용량 비디오 업로드 허용.
