# vision-labeler

Next.js 기반 비전 데이터 라벨링 워크벤치. 한 프로젝트 안에서 **동영상 업로드 → 프레임 추출 → 이미지 풀 → 라벨셋(bbox / polygon / classify)** 파이프라인을 한 곳에서 돌린다.

## 빠른 시작

```bash
npm install
npm run dev          # http://localhost:3000 → /projects 로 리디렉션
```

| 명령어 | 용도 |
|---|---|
| `npm run dev` | 개발 서버 (Turbopack) |
| `npm run build` | 프로덕션 빌드 + 타입 체크 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `next lint` (ESLint) |

별도 테스트 러너는 구성되어 있지 않다.

## 데이터 모델

```text
Project
 ├─ Resource[]          업로드 단위 ─ kind: "video" | "image_batch"
 ├─ Image[]             프로젝트 전체 이미지 풀 (uploaded · video_frame)
 └─ LabelSet[]          이미지 풀에서 멤버 골라 만든 라벨링 단위
                        taskType: "bbox" | "polygon" | "classify"
                        data.json: { classes, annotations, classifications }
```

- **Resource**: 업로드된 동영상 또는 이미지 묶음. 비디오는 원본 바이트 + hover-reel 썸네일을 같이 들고 있고, image_batch 는 자식 이미지의 컨테이너 역할만.
- **Image (Pool)**: 프로젝트 전역. 직접 업로드한 이미지와 비디오에서 추출된 프레임이 같은 풀에 함께 들어온다.
- **LabelSet**: 풀에서 N장을 골라 task type 하나로 라벨링하는 단위. 이미지가 여러 라벨셋에 N:M 으로 들어가도 각 라벨셋의 annotation/classification 은 독립적이다.

## 화면 구성

| 경로 | 화면 | 비고 |
|---|---|---|
| `/projects` | 프로젝트 목록·생성·삭제 | `ProjectsPage` |
| `/projects/[id]` | 3-탭 detail (Resource / Image Pool / Label Sets) | `ProjectDetailPage` |
| `/projects/[id]/resources/[rid]/extract` | 비디오에서 프레임 추출 → 이미지 풀로 흘려넣기 | `FrameExtractionPage` |
| `/projects/[id]/labelsets/[lsid]` | 라벨링 워크스페이스 (taskType 별 분기) | `LabelingWorkspace` |

### 일반적인 작업 순서

1. `/projects` 에서 새 프로젝트 생성.
2. `+ 동영상` 으로 비디오를 올리거나 `+ 이미지 묶음` 으로 다중 이미지 업로드.
3. 비디오라면 `Frame Extraction` 에 들어가 sprite 스크럽으로 구간을 잡고 `현재 캡쳐` / `균등캡쳐` 로 프레임을 풀에 추가.
4. `+ 라벨셋` 모달에서 풀에 모인 이미지 중 원하는 것을 고르고 task type (`bbox` / `polygon` / `classify`) 선택.
5. 라벨셋 카드를 열면 라벨링 워크스페이스가 뜬다 — bbox/polygon 은 stage 위에 도형을 그리고, classify 는 LabelPanel 에서 이미지별 클래스 체크리스트를 토글.
6. 변경은 500ms 디바운스로 자동 저장된다 (`useLabelSetSync` → `PUT .../data`).
7. 라벨셋 카드의 `JSON` 또는 detail 페이지의 `전체 다운로드` 로 export.

## 단축키 (라벨링 워크스페이스)

| 키 | 동작 |
|---|---|
| `R` / `P` | rect / polygon 도구 전환 (bbox/polygon 라벨셋만) |
| `Q` `W` `E` `R` | 해당 단축키가 할당된 클래스로 전환 / hover된 annotation 의 클래스 변경 / classify 라벨셋에서는 active image 에 토글 |
| `D` | 선택/hover 한 annotation 삭제 |
| `H` | hover 한 annotation 영역을 서버 세그먼테이션으로 refine |
| `1` / `2` | 이전 / 다음 프레임 |
| `C` | draw ↔ edit 모드 토글 |
| `Esc` | 진행 중인 draft 취소 |

프레임 추출 화면은 `Space` (재생/정지), `C` (현재 캡쳐), `←/→` (±stepSec, `Shift` 와 함께 ×5).

## 저장소 / 영속성

기본 설정은 로컬 파일시스템에 저장한다 — `./storage/` (gitignored). 모든 API 라우트가 `src/lib/server/storage.ts` 단일 파일을 거치므로 DB 로 옮길 때는 이 파일만 교체하면 된다.

```text
storage/
  projects.json
  {projectId}/
    project.json
    resources.json,        resources/{rid}/{ meta.json, source.<ext>, preview-N.jpg }
    images.json,           images/{iid}.<ext>
    labelsets.json,        labelsets/{lsid}/{ meta.json, data.json }
```

동시 요청에 대비해 인덱스 JSON 들은 per-path in-process mutex (`withFileLock`) + atomic write (`tmp + rename`) 로 직렬화된다. 자세한 락 키 목록은 `CLAUDE.md` §11.8 참고.

> **주의**: 이전 Project ▸ Video ▸ Frame 모델로 만들어진 `storage/` 는 새 모델과 호환되지 않는다. 기존 데이터를 살리고 싶으면 export → 새 프로젝트로 재import 하는 방식으로 옮겨야 한다 (자동 마이그레이션 코드 없음).

## 환경 변수

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT` | 비디오 정규화 서버 어댑터. 미설정 시 ffmpeg.wasm 폴백 (`src/features/media/service/normalize.ts`) |
| `NEXT_PUBLIC_SEGMENT_ENDPOINT` | hover-segmentation 백엔드 (`H` 단축키 / `BACKEND_SEGMENT_REQUIREMENTS.md` 참고) |

## 기여 가이드

- 작업 전 `CLAUDE.md` 와 `REFACTOR_RULES.md` 를 먼저 읽을 것. 특히 feature 경계 규칙은 ESLint `no-restricted-imports` 로 강제된다.
- PR 체크리스트:
  - [ ] `npm run lint`
  - [ ] `npm run typecheck`
  - [ ] `npm run build`
  - [ ] cross-feature 변경은 shell 또는 `lib/store.ts` composition root 에 모았는가
  - [ ] 새 service 가 store 를 직접 import 하지 않는가
  - [ ] 새 API 라우트는 `app/api/projects/...` + `features/projects/service/api.ts` 양쪽에 클라이언트 래퍼를 추가했는가

## 라이선스

private — 내부 작업용 저장소.
