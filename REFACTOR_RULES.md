# Refactor Rules (feature 경계 유지 가이드)

> 이 문서는 리팩토링 이후의 **경계 규칙**을 에이전트/개발자가 한 페이지로 확인할 수 있도록 정리한 것이다.
> 세부 동작 스펙은 `CLAUDE.md`, 구현은 각 feature 폴더 참고.

---

## 1) 레이어 모델

```text
app/                        # Next.js 라우팅 (얇게 유지)
  page.tsx                  ← /projects 리디렉션
  projects/                 ← /projects, /projects/[id], /projects/[id]/videos/[vid]
  api/projects/...          ← fs persistence REST (storage.ts 경유)

src/
  components/               # shell · 여러 feature를 조합하는 유일한 자리
    ProjectsPage.tsx        # 프로젝트 목록 shell
    ProjectDetailPage.tsx   # 비디오 테이블 + 프레임 그리드 shell
    ProjectWorkspace.tsx    # 라벨링 워크스페이스 shell (store hydrate)
    ProjectTopBar.tsx       # 공통 상단 바
    UploadVideoModal.tsx    # MediaDropzone + uploadVideo 합성
    MainMediaPanel.tsx      # media ↔ frames ↔ annotations 조립
    useProjectSync.ts       # store ↔ 서버 동기화 (shell 전용 hook)

  features/
    media/                  # 업로드·원본·normalize·비디오 재생·프레임 추출
    frames/                 # 프레임 목록·활성 프레임·exception 필터
    annotations/            # class·shape·tool·drawing·keyboard
    export/                 # 직렬화/다운로드
    projects/               # 프로젝트·비디오·프레임 서버 API 래퍼 (slice 없음, 타입+service만)

  shared/                   # 순수 유틸·범용 훅만
    types.ts                # Point 등 도메인 무관 타입
    hooks/                  # useStageTransform 등 렌더 범용 훅

  lib/
    store.ts                # 슬라이스 합성 루트 (공개 API 단일 지점)
    server/storage.ts       # 서버 전용 파일시스템 persistence helper (DB 교체 seam)
```

각 feature 내부 구조는 동일 패턴:

```text
features/<name>/
  types.ts            # 도메인 타입 (외부 공유 허용)
  slice.ts            # zustand slice 팩토리 (projects는 stateless라 없음)
  service/            # 비동기/외부 IO · worker · 파일 핸들링 · 서버 fetch
  tools/              # (annotations 전용) 플러그형 도구
  hooks/              # feature 내부 전용 훅
  ui/                 # 이 feature 소유 컴포넌트 (projects는 ui 없음 — shell 전담)
  index.ts            # 공개 배럴 (타입·UI 루트만 re-export)
```

> **projects feature 예외**: 슬라이스/UI 없이 `types.ts` + `service/api.ts`만 존재.
> 프로젝트 단위 화면은 모두 shell(`components/`)이 소유하고, 서버 호출은 `@/features/projects/service/api`를 deep import한다 (barrel은 타입 전용).

---

## 2) import 경계 규칙 (lint로 강제)

### 허용

- `components/*` (shell) → `features/*`, `shared/*`, `lib/store`
- `features/<A>/*` → 같은 feature 내부, `shared/*`, `lib/store`
- `features/<A>/*` → `features/<B>/types` **만** (도메인 타입 공유 허용)
- `features/<A>/*` → `features/<B>` (barrel) — 필요 시 허용
- 모든 레이어 → `shared/*`, `@/lib/store`

### 금지 (ESLint `no-restricted-imports`로 차단)

- `features/<A>/*` → `features/<B>/ui/*`
- `features/<A>/*` → `features/<B>/service/*`
- `features/<A>/*` → `features/<B>/slice`
- `features/<A>/*` → `features/<B>/tools/*`
- `features/<A>/*` → `features/<B>/hooks/*`

> 즉 타입과 barrel만 공유, 구현은 공유 금지.
> 두 feature 간 "로직"이 엮여야 하면 shell(`components/`)로 올리거나 `lib/store` 크로스 액션으로 처리.

---

## 3) Store 규칙

- 모든 feature의 상태는 `lib/store.ts`의 `useStore`에 슬라이스 합성으로 머지됨.
- 공개 API(액션 이름·시그니처)는 **보존**. 캘러는 `useStore((s) => s.xxx)` 그대로.
- 슬라이스는 자기 도메인 내부의 상태만 수정. **크로스 슬라이스 teardown은 `lib/store.ts` 루트에만**.
  - 예: `setMedia` → frames + annotations 리셋, object URL revoke
  - 예: `removeFrame` → 해당 프레임 annotations 제거
  - 예: `removeClass` → 해당 class annotations 제거
- 새 액션을 넣을 때는:
  1. 슬라이스에 내부 로직만 추가
  2. 크로스 영향이 있으면 composition root에서 래핑
  3. 외부 공개 이름은 `useStore`에 직접 노출

---

## 4) Service 레이어 규칙 (`features/<A>/service/`)

- 외부 IO (File API, worker, ffmpeg.wasm, 서버 fetch)는 여기로.
- UI에서 직접 `new Worker(...)`, `ffmpeg()` 호출 금지. 반드시 service 경유.
- Service는 순수 함수 (`async (input) => output`) 시그니처 유지. Store 쓰지 않는다.
  - 호출자(UI/slice/shell)가 결과를 받아 store에 반영한다.
- 서버 persistence는 **`features/projects/service/api.ts` (REST 클라이언트) ↔ `app/api/projects/...` (라우트) ↔ `lib/server/storage.ts` (fs)** 의 3단 구조. DB로 교체 시 `storage.ts` 단일 파일만 갈아끼우면 된다.
- 다른 feature는 자체 service에서 `projects/service`를 직접 호출하지 말 것 — store에 반영해야 할 동기화 로직은 shell의 `useProjectSync` 같은 훅으로 응집시킨다.

---

## 5) Tools 레이어 (`features/annotations/tools/`)

새 도구 추가 절차는 기존 CLAUDE.md §3 그대로:

1. `tools/<new>.ts`에 `AnnotationTool` 구현
2. `features/annotations/types.ts`의 `Shape` union 확장
3. `tools/registry.ts` 등록
4. `features/annotations/ui/AnnotationStage.tsx`의 `ShapeView` 렌더 분기 추가

---

## 6) Barrel 규칙 (`features/<A>/index.ts`)

- **타입**: 공개용 타입은 모두 re-export (`export type { ... } from "./types"`)
- **UI 루트**: shell에서 필요한 주요 컴포넌트만 re-export
- **Service/Slice/Tools/Hooks는 barrel에 포함 금지** — 의도적으로 deep path만 허용 (같은 feature 내부 또는 store 합성 루트).

---

## 7) 확장 seam (미래 작업을 위해 의도적으로 남겨둔 자리)

| 미래 요구 | 오늘 준비된 자리 | 변경 규모 |
|---|---|---|
| ~~멀티프로젝트~~ | ✅ 구현됨 — `features/projects` + `app/projects/*` 라우트 | — |
| ~~서버 persistence~~ | ✅ 구현됨 — `lib/server/storage.ts` + `app/api/projects/*` | DB 교체 시 `storage.ts`만 |
| 멀티 유저/권한 | `Project.members` 필드만 placeholder, UI는 follow-up | members CRUD 라우트 + 인증 미들웨어 |
| 이벤트 버스 | cross-slice cleanup이 composition root에 집중 | 해당 블록만 emitter로 치환 |
| 새 도구 (polygon) | `annotations/tools/` + `Shape` union | registry 등록 + 렌더 분기 |
| `entities/` 승격 | `features/*/types.ts` | 파일 이동만 |
| `workflows/` 도입 | `components/` shell (`ProjectWorkspace` 등) | shell 분해·이동 |

---

## 8) 의도적으로 **하지 않는** 것 (지금 도입 금지)

- feature API를 `Promise<T>`로 래핑 (현재 store 액션은 동기, 비동기는 service에 격리)
- `entities/`, `workflows/`, `repository.ts` 디렉토리
- 이벤트 버스 실구현 (자리만 남김)
- export schemaVersion, 다중 포맷
- 클라이언트가 `lib/server/storage.ts`를 직접 import (서버 전용 — 반드시 API 라우트 경유)

---

## 9) 작업 체크리스트 (feature 단위 PR 기준)

- [ ] lint 그린 (`npm run lint`) — 특히 경계 규칙 위반 없는지
- [ ] `npm run typecheck` 그린
- [ ] `npm run build` 그린
- [ ] `useStore` 공개 API 시그니처 변경 없음 (또는 명시적으로 migrate 커밋)
- [ ] 크로스 feature 영향이 있으면 shell 또는 composition root에서 처리됨
- [ ] 새 service는 store 직접 접근 안 함
- [ ] 새 UI는 `features/<A>/ui/` 외부에서 imports 되지 않음 (barrel만 노출)
- [ ] 서버 persistence를 건드렸다면 `lib/server/storage.ts`만 통과 (라우트가 fs/path를 직접 부르지 않음)
- [ ] 새 API 라우트는 `app/api/projects/...` 패턴 + `features/projects/service/api.ts`에 클라이언트 래퍼 추가
