# Refactor Plan — Resource / Image / LabelSet 모델 전환

> 이 문서는 임시 작업 계획서다. **Step 5 까지 완료되면 삭제한다.**
> 진행 중에 결정이 바뀌면 이 문서를 갱신해 단일 source of truth 를 유지한다.

---

## 0. 동기

기존 모델은 "프로젝트 → 비디오 → 프레임/어노테이션/클래스" 로 비디오가 1차 컨테이너였다.
바뀌는 요구는 다음과 같다.

1. video → frame **추출 페이지** 와 **라벨링 페이지** 분리.
2. 라벨링은 `polygon` / `bbox` / `classify` 세 가지 타입을 지원한다 (한 LabelSet 안에서 타입은 1개로 고정).
3. 라벨링은 더 이상 비디오에 매여있지 않고 **임의의 이미지 집합(LabelSet)** 단위로 수행한다.
   한 이미지가 여러 LabelSet 에 포함될 수 있다.
4. Media Library 화면이 신설된다 (Resource Pool + Image Pool, 4가지 view mode, tag 시스템).

핵심적 모델 변경:
- 1차 시민이 "비디오" → "이미지" 로 이동.
- 클래스/어노테이션의 소유자가 비디오 → **LabelSet**.
- 업로드 묶음을 표현하는 **Resource** 와 그 안의 **Image** 를 명시적 엔티티로 분리.

---

## 1. 합의된 결정 사항

| 항목 | 결정 |
|---|---|
| 기존 데이터 마이그레이션 | **하지 않음** — `storage/` 는 비우고 시작 |
| classification 라벨 | 이미지당 **단일** 클래스 |
| LabelSet 안에 라벨 타입 혼합 | **불가** — LabelSet 마다 타입 1개 고정 (`polygon` / `bbox` / `classify`) |
| LabelSet 간 클래스 정의 | **완전 독립** — LS_A 의 "scratch" 와 LS_B 의 "scratch" 는 별개 |
| video frame 의 image tag | 모델은 허용 (B안), UI 기본 비활성. **우회 여지 열어둠** |
| 라우트 골격 | 아래 §3 참조 |
| 진행 단위 | Step 1 → Step 5 순차 PR/커밋 |

---

## 2. 새 데이터 모델

### 2.1 디스크 레이아웃

```text
storage/
  projects.json                        ProjectIndex
  {projectId}/
    project.json                       Project
    resources.json                     Resource[]
    images.json                        Image[]
    labelsets.json                     LabelSet[] (요약)
    resources/
      {resourceId}/
        source.<ext>                   video resource 만: 원본 비디오
        previews/preview-{i}.jpg       video resource hover-reel
    images/
      {imageId}.<ext>                  실제 이미지 바이트 (uploaded + 추출된 frame)
    labelsets/
      {labelsetId}/
        meta.json                      LabelSet (전체 정의)
        annotations.json               LabelSetAnnotations
```

### 2.2 타입 (요약)

```ts
// src/features/resources/types.ts
type ResourceType = "video" | "image_batch";
type Resource = {
  id: string;
  type: ResourceType;
  name: string;
  tags: string[];
  createdAt: number;
  // video 전용
  sourceExt?: string;
  duration?: number;
  width?: number;
  height?: number;
  ingestVia?: "original" | "ffmpeg-wasm" | "server";
  previewCount?: number;
};

// src/features/images/types.ts
type ImageSource = "uploaded" | "video_frame";
type Image = {
  id: string;
  resourceId: string;
  source: ImageSource;
  fileName: string;
  ext: string;
  width: number;
  height: number;
  tags: string[];               // B안: video_frame 도 가질 수 있음 (UI 기본 비활성)
  videoFrameMeta?: {
    timestamp: number;
    frameIndex?: number;
  };
  createdAt: number;
};

// src/features/labelsets/types.ts
type LabelSetType = "polygon" | "bbox" | "classify";
type LabelClass = { id: string; name: string; color: string; shortcutKey?: "q"|"w"|"e"|"r" };
type LabelSet = {
  id: string;
  name: string;
  type: LabelSetType;
  classes: LabelClass[];
  imageIds: string[];            // 멤버십. 중복 가능 (다른 LabelSet 과)
  createdAt: number;
};

// 도형: bbox 는 rect, polygon 은 polygon, classify 는 shape 없음
type ShapeRect = { kind: "rect"; x: number; y: number; w: number; h: number };
type ShapePolygon = { kind: "polygon"; rings: { x: number; y: number }[][] };

type Annotation =
  | { id: string; imageId: string; classId: string; kind: "rect"; shape: ShapeRect; createdAt: number }
  | { id: string; imageId: string; classId: string; kind: "polygon"; shape: ShapePolygon; createdAt: number }
  | { id: string; imageId: string; classId: string; kind: "classify"; createdAt: number };

type LabelSetAnnotations = { annotations: Annotation[] };
```

---

## 3. 새 라우트

```
/projects                                ProjectsPage              (기존 유지)
/projects/[id]                           MediaLibraryPage          (신규: Resource + Image Pool)
/projects/[id]/extract/[resourceId]      FrameExtractionPage       (신규: 비디오 → 프레임)
/projects/[id]/labelsets                 LabelSetsPage             (신규: 목록/생성)
/projects/[id]/labelsets/[lsid]          LabelingWorkspace         (신규: polygon/bbox/classify)
```

`/projects/[id]/videos/[vid]` 는 제거.

---

## 4. 단계별 진행

### Step 1 — 데이터 모델 + storage + 라우트 골격

**들어가는 것**:
- 새 feature 디렉터리 + 타입: `src/features/{resources,images,labelsets,tags}` (+ `annotations` 는 LabelSet 컨텍스트로 이전 준비)
- `src/lib/server/storage.ts` 새 스키마로 재작성
- `app/api/projects/[id]/{resources,images,labelsets}` 라우트 골격
- 새 라우트 페이지 placeholder
- 기존 `videos.json`/`data.json`/구 라우트 / `/projects/[id]/videos/[vid]` 페이지 제거
- `typecheck` / `lint` 통과

**안 들어가는 것**:
- 실제 Media Library UI (Step 2)
- Frame Extraction 동작 (Step 3)
- Classification tool 구현 (Step 4)
- Tag matrix view, bulk tag (Step 5)

### Step 2 — Media Library UI
- Resource Pool: 목록/검색/필터/태그 편집/이름·삭제
- Image Pool: All Images / By Resource view (Grid)
- 업로드 모달 (video + image batch, resource name + initial tags)
- 이미지 선택 모델 + "Start Labeling → LabelSet 생성/추가" hand-off

### Step 3 — Frame Extraction 페이지
- 비디오 resource → 프레임 추출 단독 페이지로 분리
- 기존 `MainMediaPanel` (video 모드) + `BottomTimeline` 재배치
- 추출된 프레임은 `Image (source=video_frame)` 로 등록

### Step 4 — Labeling 워크스페이스 (LabelSet 컨텍스트)
- LabelSet 의 `type` 에 따라 도구 라우팅 (`rect` / `polygon` / `classify`)
- `classify` tool 신규: 이미지당 단일 클래스, shape 없음, 키 단축으로 빠른 라벨링 UI
- store 슬라이스 재편: 비디오 종속 → LabelSet 종속
- `useProjectSync` 를 `useLabelSetSync` 로 재작성

### Step 5 — Image Pool 확장 + 마무리
- By Tag view, Resource × Tag matrix view
- bulk tag (선택 이미지 일괄 적용)
- pagination / load more / lazy thumbnails
- export 엔드포인트를 LabelSet 기준으로 변환
- **이 문서(REFACTOR_PLAN.md) 삭제**

---

## 5. 진행 체크리스트

- [ ] Step 1
- [ ] Step 2
- [ ] Step 3
- [ ] Step 4
- [ ] Step 5 (+ REFACTOR_PLAN.md 삭제)
