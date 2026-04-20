# CLAUDE.md

이 문서는 이 저장소에서 작업하는 에이전트/개발자를 위한 **공식 작업 가이드**입니다.
(기존 영문 내용을 한국어로 정리하고, 인터랙션 룰을 명문화함)

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

### 데이터 흐름

전체 상태는 `src/lib/store.ts`의 단일 Zustand store에서 관리합니다.

```text
MediaSource → Frame[] → Annotation[]
                ↕             ↕
          activeFrameId  selectedAnnotationId
```

- **MediaSource**: 업로드 원본(한 번에 1개), object URL 보유
- **Frame**: 미디어에서 캡처된 정지 프레임(object URL)
- **Annotation**: 특정 frame 소속, class id 참조, shape 보유
- **Shape**: 0..1 정규화 좌표계(해상도 독립)

---

## 3) 도구 시스템 (`src/lib/tools/`)

`tools/types.ts`의 `AnnotationTool` 인터페이스를 모든 그리기 모드가 구현합니다.

```ts
begin(start: Point): ShapeDraft
// ShapeDraft.update(current) → 미리보기 Shape
// ShapeDraft.commit(end)     → Shape | null (null이면 버림)
```

새 도구 추가 절차:
1. `tools/` 하위에 `AnnotationTool` 구현
2. `types.ts`의 `Shape` 유니온 확장
3. `registry.ts` 등록
4. `AnnotationStage.tsx`의 `ShapeView` 렌더 분기 추가

---

## 4) 스테이지/렌더링 규칙 (`AnnotationStage.tsx`)

- `ResizeObserver` 기반 contain-fit 레이아웃 사용
- 이미지 위에 SVG 오버레이(`viewBox="0 0 1 1"`, `preserveAspectRatio="none"`)를 올려 정규화 좌표로 도형 렌더
- `vectorEffect="non-scaling-stroke"`를 사용해 줌 시에도 선 두께 일관성 유지
- 드래그 안정성을 위해 pointer capture를 사용

---

## 5) 인터랙션 룰 (명문화)

아래는 **현재 기준의 공식 우선순위/동작 규칙**입니다.

### 5.1 모드 정의

- `draw` 모드: 새 도형 생성 중심
- `edit` 모드: 기존 도형 선택/이동/리사이즈 중심

### 5.2 Hover 규칙

1. **프레임(스테이지) 위 hover 인터랙션**은 edit 전용 기능(핸들/이동 커서/리사이즈 시작점 등)만 동작한다.
2. **Annotation 목록 패널 hover**는 모드(draw/edit)와 무관하게 동작한다.
3. 목록 hover 시 해당 annotation은 패널/스테이지에서 강조 상태를 동기화한다.

### 5.3 키보드 규칙 우선순위 (중요)

LabelPanel의 capture-phase 핸들러 우선순위를 따른다:

1. 클래스 행 hover + `Q/W/E/R`  
   → 해당 클래스에 단축키 할당
2. annotation 행 hover + `Delete/Backspace`  
   → hover된 annotation 삭제
3. annotation 행 hover + `Q/W/E/R`  
   → hover된 annotation의 class 변경
4. 위에서 소비되지 않은 키는 전역 `useKeyboardShortcuts`로 전달

### 5.4 선택/핸들/드래그 규칙

- 리사이즈 핸들은 **선택된 annotation + edit 모드**일 때만 표시
- 클릭과 드래그를 구분하기 위해 드래그 활성 거리(deadzone)를 둔다
  - deadzone 이하 미세 포인터 이동은 move/resize로 간주하지 않음
- move/resize 시작 시 pointer capture 대상은 stage 컨테이너를 사용

### 5.5 줌 시 시각 규칙

- `zoom` 값을 기반으로 stroke/handle/glow를 보정하여 과도한 두께 변화 방지
- 최소 보정값(`visualZoom` floor)으로 극단 배율에서 가시성 유지

---

## 6) 스타일 규칙

- Tailwind v4 사용
- 디자인 토큰은 `app/globals.css`의 `@theme` CSS 변수로 관리
- 컴포넌트에서 `var(--color-*)` 사용

---

## 7) 비디오 타임라인/프레임 추출 파이프라인

`src/components/VideoFramePicker.tsx` 기준 M1/M2/M3 단계 기능:

- **M1 (인프라)**: worker 기반 키프레임 탐색 + sprite 생성
  - `src/lib/media.ts::buildVideoSprite`
  - `public/workers/sprite-worker.js` (MP4Box 파싱)
  - 실패 시 `evenlySpacedTimes(...)` 폴백
- **M2 (타임라인 UI)**: 즉시 hover 프리뷰 + 클릭 seek
- **M3 (캡처 UX)**: `requestVideoFrameCallback` 인지 캡처 + 단축키
  - `Space`: 재생/일시정지
  - `C`: 캡처
  - `←/→`: ±1초 (`Shift`와 함께 ±5초)

---

## 8) 유지보수 메모

- `MediaSource`는 `file?: File` 포함 (worker 전처리용)
- sprite/object URL은 cleanup에서 revoke해 메모리 누수 방지
- 무거운 작업은 worker/헬퍼 함수로 분리해 UI 인터랙션 블로킹 방지

---

## 9) 최근 구조 업데이트

- 비디오 정규화 파이프라인(`src/lib/video-normalize.ts`)
  - 서버 어댑터 우선 (`NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT`)
  - 실패 시 ffmpeg.wasm 폴백
- 중앙 워크스페이스는 `centerViewMode`로 전환
  - `video`: 재생/추출 UI
  - `frame`: 어노테이션 스테이지
- 프레임 추출 컨트롤은 `src/components/frame-extract/ExtractionPanel.tsx`로 컴포넌트화
