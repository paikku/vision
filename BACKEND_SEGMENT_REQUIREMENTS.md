# 백엔드 업데이트 요구서 — 이미지 세그먼테이션 엔드포인트

클라이언트는 라벨(어노테이션)에 마우스를 올리고 **`H`** 단축키를 눌러
해당 영역의 오브젝트 경계를 서버 세그먼테이션 모델로 다시 맞춘다.
프런트는 **폴리곤(rings)** 을 1차 표현으로 받아 그대로 렌더한다.
본 문서는 이 기능을 지원하기 위한 서버 요구사항을 정리한다.

관련 소스:
- `src/features/annotations/service/segment.ts` — `segmentRegion()` / `toShape()`
- `src/features/annotations/shape-utils.ts` — 폴리곤 AABB·hit·translate
- `src/features/annotations/types.ts` — `PolygonShape` 정의
- `src/features/annotations/ui/LabelPanel.tsx` — hover + `H` 단축키 핸들러

---

## 1) 엔드포인트 위치

- **정규화 엔드포인트와 동일 서버, 다른 경로**. 호스트·포트·스킴을 공유.
- 기본 규약: `NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT` URL의 **마지막 경로
  세그먼트를 `segment` 로 치환**.
  - 예: `https://media.example.com/api/normalize` → `https://media.example.com/api/segment`
  - 예: `https://media.example.com/normalize` → `https://media.example.com/segment`
- 명시적 오버라이드: `NEXT_PUBLIC_IMAGE_SEGMENT_ENDPOINT` 가 설정돼 있으면
  그 값을 그대로 사용. 운영 환경에서 경로 규약이 다르면 이 변수로 고정.

---

## 2) 요청 계약

| 항목 | 값 |
|---|---|
| Method | `POST` |
| Content-Type | `multipart/form-data` |
| `file` | 대상 프레임 JPEG/PNG 바이트 (단일 이미지) |
| `region` | JSON 문자열, `{ "x": number, "y": number, "w": number, "h": number }` — **정규화 좌표** `[0..1]`. 현재 라벨 shape 의 AABB(직사각형이면 그대로, 폴리곤이면 꼭짓점 AABB) 가 전달됨 |
| `classHint` *(optional)* | 현재 라벨 클래스 이름 (string). class-conditional 모델용 힌트 |

### 2.1 CORS / 크기 / 타임아웃

- 브라우저 직업로드 대상이므로 정규화 엔드포인트와 동일한 CORS 설정 필요.
- 프레임 1장이므로 페이로드는 보통 수백 KB. `client_max_body_size 16M`
  수준이면 충분.
- 모델 추론 시간 고려해 `proxy_read_timeout 60s` 권장.

---

## 3) 응답 계약

성공 응답: `200 OK`, `Content-Type: application/json`

```json
{
  "polygon": [
    [[x0, y0], [x1, y1], [x2, y2], ...],
    [[hx0, hy0], [hx1, hy1], ...]
  ],
  "rect":  { "x": 0.41, "y": 0.22, "w": 0.11, "h": 0.18 },
  "score": 0.93
}
```

### 3.1 필드 정의

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `polygon` | `Array<Array<[number, number] \| {x:number,y:number}>>` | **권장 (primary)** | 정규화 좌표의 ring 배열. **Ring 0 은 외곽 boundary**, **ring 1..n 은 holes**. even-odd fill 규약. 각 ring 최소 3개 점, 암묵적으로 닫힘 (마지막 점이 첫 점과 동일할 필요 없음). 점 형식은 `[x, y]` 튜플 또는 `{x, y}` 객체 모두 허용, 혼용 가능 |
| `rect` | `{x,y,w,h}` | 권장 | polygon 의 AABB. 정규화 좌표, `w>0`, `h>0`, `x+w ≤ 1`, `y+h ≤ 1`. polygon 이 있으면 클라이언트가 직접 AABB 를 계산할 수 있지만 서버가 같이 주면 계산 생략 가능 |
| `bbox` | `{x,y,w,h}` | 선택 | `rect` 의 동의어. 둘 다 오면 `rect` 우선 |
| `score` | number | 선택 | `[0..1]` 모델 신뢰도. 향후 UI 표기에 쓸 예정 |

### 3.2 클라이언트 선호도

`toShape(result)` 는 다음 순서로 `Shape` 를 만든다:

1. `polygon` 이 있고 유효(ring ≥ 1개, ring 당 점 ≥ 3개)하면 **폴리곤으로 적용**
2. 아니면 `rect` / `bbox` 로 rect 을 적용
3. 둘 다 없으면 요청은 no-op 로 취급 (기존 라벨 유지)

따라서 **서버는 가능한 한 polygon 을 포함**시킬 것. rect 만 반환하면
폴리곤 그리드 UX 를 활용할 수 없다.

### 3.3 좌표계 규약

- **정규화 `[0..1]`** (이미지 width/height 로 나눈 값). 프론트의 `Shape`,
  `Frame` 썸네일 렌더링이 모두 이 좌표계를 쓴다 (`CLAUDE.md §4`).
- 원점은 이미지 **좌상단**, x 우측 양수, y 하단 양수.
- 서버가 픽셀 좌표로 작업한다면 응답 직전에 이미지 해상도로 나눠 정규화.

### 3.4 폴리곤 품질 가이드

- **단순화**: 모델 마스크 → 폴리곤 변환 시 Douglas-Peucker 등으로 단순화.
  epsilon 권장값 `0.002`(정규화 좌표 기준, ≈ 이미지 한 변의 0.2%) 전후.
  과도하게 많은 점(>1000) 은 SVG 렌더 비용이 커지고 사용자가 이동시키기
  어렵다.
- **자기교차 금지**: 외곽 ring 은 self-intersecting 하지 않게. 프론트는
  even-odd 로 fill 하므로 꼬이면 구멍처럼 보인다.
- **Winding 순서 무관**: 렌더는 even-odd 규칙이라 CW/CCW 둘 다 안전.
  단 holes 는 외곽 ring 과 **반드시 별개 ring 으로 분리** (외곽에 꼭짓점
  이어붙이기 금지).
- **Clamp**: 모든 점은 `[0, 1]` 범위 안. 클라이언트도 클램프하지만 서버
  쪽에서 먼저 막으면 라운드트립 오차가 줄어든다.

### 3.5 다중 오브젝트는 한 번에 하나만

- 한 번의 요청 = 한 라벨의 재-맞춤. 응답은 **단일 오브젝트 결과**.
- 모델이 여러 후보를 뽑았다면 `region` 중심에 가장 가까운/IoU 가장 높은
  하나를 골라 반환.
- 미래에 "프레임 전체 자동 탐지" 가 필요해지면 별도 엔드포인트
  (`/detect`) 로 분리 권장.

---

## 4) 오류 처리 규약

| 시나리오 | 응답 | 클라이언트 동작 |
|---|---|---|
| `file` 누락 / 이미지 디코딩 실패 | `400 Bad Request` | 조용히 실패 → 라벨 유지 |
| `region` 파싱 실패, 범위 초과 | `400 Bad Request` + `{error}` | 동일 |
| 지원하지 않는 이미지 포맷 | `415 Unsupported Media Type` | 동일 |
| 모델이 아무것도 찾지 못함 | `200 OK` + `{}` 또는 `404` | 라벨 유지 (no-op) |
| 일시적 리소스 부족 | `503` + `Retry-After` | 라벨 유지 (현재 재시도 없음) |
| 내부 오류 | `500` | 라벨 유지 |

> **원칙**: 어떤 실패가 와도 **기존 라벨은 그대로 둔다**. 잘못된 결과로
> 덮어쓰는 것보다 no-op 이 UX 에 낫다. `segmentRegion()` 은 실패 시 `null`
> 을 돌려주고 UI 는 스피너만 내린다.

---

## 5) 취소 / 동시성

- 같은 annotation 에 **새 `H` 요청이 들어오면 이전 `AbortController`
  를 취소**하고 새로 시작한다. 서버는 클라이언트 연결 해제를 받으면
  가능한 한 추론을 조기 종료할 것.
- 서로 다른 annotation 의 요청은 동시에 진행된다. 서버는 GPU 큐 길이를
  고려해 동시 추론 수 제한(예: N=4).
- `LabelPanel` 언마운트 시 모든 in-flight controller 가 `abort()` 된다.

---

## 6) 보안 / 운영 요구

- 업로드 크기 제한 서버 측 강제 (이미지 1장, 기본 16MB 이내).
- CORS origin 화이트리스트 / API 키 헤더는 정규화 엔드포인트와 동일 정책.
- 결과물 영속화 불필요 — 추론 후 즉시 폐기.
- 동시 추론 큐 제한 (GPU 메모리·시간 비용이 큼).
- 로깅에 원본 이미지 바이트는 남기지 말 것.

---

## 7) 샘플

### curl

```bash
curl -X POST "$SEGMENT_URL" \
  -F "file=@frame.jpg" \
  -F 'region={"x":0.4,"y":0.2,"w":0.2,"h":0.3}' \
  -F "classHint=person"
```

### 예상 응답

```json
{
  "polygon": [
    [
      [0.412, 0.223], [0.485, 0.221], [0.551, 0.255],
      [0.548, 0.391], [0.512, 0.491], [0.409, 0.488],
      [0.405, 0.340]
    ]
  ],
  "rect": { "x": 0.405, "y": 0.221, "w": 0.146, "h": 0.270 },
  "score": 0.92
}
```

### hole 이 있는 경우 (도넛 형태)

```json
{
  "polygon": [
    [[0.2,0.2],[0.8,0.2],[0.8,0.8],[0.2,0.8]],
    [[0.4,0.4],[0.6,0.4],[0.6,0.6],[0.4,0.6]]
  ],
  "rect": { "x": 0.2, "y": 0.2, "w": 0.6, "h": 0.6 }
}
```

---

## 8) 향후 확장 (지금은 도입하지 않음)

- **래스터 마스크** (RLE / PNG): `mask: { "format":"rle", "counts":"..." }`
  필드를 추가. 현재 스키마는 polygon 만 primary. 마스크는 같은 응답 객체에
  추가 필드로 얹으면 된다. 클라이언트는 mask → polygon 변환을 거쳐 `Shape`
  union 에 넣거나 향후 `MaskShape` variant 를 추가.
- **여러 오브젝트 탐지**: 별도 엔드포인트 (`/detect`) 로 분리.
- **배치 요청** (여러 region 을 한 번에): `regions: [...]` + 응답 `results: [...]`
  로 확장. 현재 `segmentRegion()` 은 1 region 전제로 설계됨.
- **Winding 기반 fill**: 지금은 even-odd 를 강제한다. nonzero winding 로
  전환하려면 클라이언트 `ShapeView` 의 `fillRule` 을 바꾸고 서버는 ring
  방향을 지켜서 보내야 한다 (outer=CCW, holes=CW).

---

## 9) 프런트엔드 체크리스트 (참고용)

- [x] `features/annotations/types.ts` — `PolygonShape` variant 추가
- [x] `features/annotations/shape-utils.ts` — AABB·hit·translate 공유 유틸
- [x] `features/annotations/service/segment.ts` — `toShape()` 가 polygon 을
      1순위로 선택, `toPolygonShape()` / `toRectShape()` / `segmentAabb()` 공개
- [x] `features/annotations/ui/AnnotationStage.tsx` — `<path fillRule=evenodd>`
      로 polygon 렌더, 이동·hover·라벨 위치 모두 AABB/폴리곤 유틸 경유
- [x] `features/annotations/ui/LabelPanel.tsx` — rect-only 가드 해제,
      폴리곤 annotation 도 `H` 로 재-세그먼트 가능
- [x] `src/components/ProjectDetailPage.tsx` — 프레임 프리뷰에 polygon 렌더
- [x] `src/lib/server/storage.ts` — `StoredPolygonShape` 로 data.json 왕복
- [ ] (follow-up) 폴리곤 **drawing tool**: 현재는 drawing tool 이 rect 하나뿐.
      polygon tool 을 추가하려면 `CLAUDE.md §3 새 도구 추가 절차` 를 따른다
      (tool 구현 → registry 등록 → ShapeView 는 이미 분기 있음).
- [ ] (follow-up) 폴리곤 vertex **edit handles**: 지금은 이동만 지원.
      꼭짓점 드래그·삽입·삭제 UI 는 별도 패스로.
