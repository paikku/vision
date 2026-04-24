# 백엔드 업데이트 요구서 — 이미지 세그먼테이션 엔드포인트

클라이언트는 라벨(어노테이션)에 마우스를 올리고 **`H`** 단축키를 눌러 해당
영역의 오브젝트 경계를 서버 세그먼테이션 모델로 다시 맞춘다. 본 문서는
이 기능을 지원하기 위한 서버 요구사항을 정리한다.

관련 소스:
- `src/features/annotations/service/segment.ts` — `segmentRegion()` 클라이언트
- `src/features/annotations/ui/LabelPanel.tsx` — hover + `H` 단축키 핸들러

---

## 1) 엔드포인트 위치

- **동일 서버, 다른 경로**. 정규화(`NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT`) 와
  호스트·포트·스킴을 공유하며 경로만 다르다.
- 기본 규약: 정규화 엔드포인트 URL의 **마지막 경로 세그먼트를 `segment`
  로 치환**한 URL.
  - 예: `https://media.example.com/api/normalize` → `https://media.example.com/api/segment`
  - 예: `https://media.example.com/normalize` → `https://media.example.com/segment`
- 명시적 오버라이드: 클라이언트는 `NEXT_PUBLIC_IMAGE_SEGMENT_ENDPOINT` 가
  설정되어 있으면 그 값을 그대로 사용한다. 운영 환경에서 경로 규약이
  다르면 이 변수로 고정할 것.

---

## 2) 요청 계약

| 항목 | 값 |
|---|---|
| Method | `POST` |
| Content-Type | `multipart/form-data` |
| `file` | 대상 프레임 JPEG/PNG 바이트 (단일 이미지) |
| `region` | JSON 문자열, `{ "x": number, "y": number, "w": number, "h": number }` — **정규화 좌표** `[0..1]` (0,0 = 좌상단, 1,1 = 우하단). 현재 라벨 rect 를 그대로 보냄 |
| `classHint` *(optional)* | 현재 라벨 클래스 이름 (string). 모델이 class-conditional 세그먼테이션을 지원할 때 참고 |

### 2.1 CORS / 크기 / 타임아웃

- 브라우저 직업로드 대상이면 정규화 엔드포인트와 동일하게 CORS 허용 필요.
- 프레임 1장이므로 페이로드는 보통 수백 KB. `client_max_body_size 16M`
  수준이면 충분.
- 모델 추론 시간 고려해 `proxy_read_timeout 60s` 권장.

---

## 3) 응답 계약

성공 응답: `200 OK`, `Content-Type: application/json`

응답 스키마는 **rect-only 현재 클라이언트와 polygon 확장 후 클라이언트를
둘 다 지원** 하도록 설계한다. 서버는 가능하면 **둘 다 함께 보낸다**.

```json
{
  "polygon": [
    [[x0, y0], [x1, y1], [x2, y2], ...]
  ],
  "rect": { "x": 0.41, "y": 0.22, "w": 0.11, "h": 0.18 },
  "score": 0.93
}
```

### 필드 정의

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `polygon` | `Array<Array<[number, number] \| {x:number,y:number}>>` | 선택 | **정규화 좌표** 기준. 최상위 배열은 ring 배열이며, 첫 ring 은 외곽, 이후 ring 은 holes. 각 ring 은 최소 3개 점이어야 하며 닫힐 필요 없음(암묵적으로 닫힘). 점 형식은 `[x,y]` 튜플 또는 `{x,y}` 객체 중 하나. 혼용 허용. |
| `rect` | `{x,y,w,h}` | 강력 권장 | polygon 의 AABB 와 정합. 정규화 좌표, `w>0`, `h>0`, `x+w ≤ 1`, `y+h ≤ 1`. |
| `bbox` | `{x,y,w,h}` | 선택 | `rect` 와 동의어. 둘 다 오면 `rect` 우선. |
| `score` | number | 선택 | `[0..1]` 모델 신뢰도. UI 표기용. |

### 왜 두 표현을 같이 보내는가

- **오늘의 클라이언트** 는 `Shape` union 이 rect 만 지원한다. polygon 이
  와도 AABB 로 환산하여 rect 에 덮어쓴다 (`toRectShape()` 참고).
- **내일의 클라이언트** 는 polygon/mask `Shape` variant 가 추가될 예정이다
  (`CLAUDE.md §3 새 도구 추가 절차`). 그 시점에 응답 스키마를 바꾸지
  않도록, 서버는 **지금부터 가능하면 polygon 을 포함** 시켜 둔다.
- 모델이 polygon 만 출력한다면 `rect` 는 polygon AABB 를 계산해서
  같이 넣어 준다 — 클라이언트도 fallback 으로 직접 계산하지만 서버에서
  올라오면 네트워크/파싱 라운드트립 1회가 줄어든다.

### 좌표계 규약

- **정규화 `[0..1]`** (width/height 로 나눈 값). 프론트의 `RectShape`,
  `Frame` 썸네일 렌더링이 모두 이 좌표계를 쓴다 (`CLAUDE.md §4`).
- 좌표 원점은 이미지 **좌상단**, x 는 우측 양수, y 는 하단 양수.
- 서버가 픽셀 좌표를 쓰는 경우 응답 직전에 이미지 해상도로 나눠서 정규화.

### 다중 오브젝트는 지원하지 않음 (지금은)

- 한 번의 요청은 **한 라벨의 영역을 다시 맞추는 것**이 목적이다.
- 따라서 응답은 **하나의 오브젝트 결과**만 돌려준다. 여러 오브젝트가
  검출되면 `region` 중심에 가장 가까운 것 하나를 선택해서 반환.
- 미래 요구로 "한 프레임의 모든 오브젝트 탐지" 가 들어오면 별도 엔드포인트
  (`/detect` 등) 로 분기하는 것을 권장한다.

---

## 4) 오류 처리 규약

| 시나리오 | 응답 | 클라이언트 동작 |
|---|---|---|
| `file` 누락 / 이미지 디코딩 실패 | `400 Bad Request` | 요청은 조용히 실패 → 라벨 유지 |
| `region` 파싱 실패, 범위 초과 | `400 Bad Request` + `{error}` | 동일 |
| 지원하지 않는 이미지 포맷 | `415 Unsupported Media Type` | 동일 |
| 모델이 아무것도 찾지 못함 | `200 OK` + `{}` 또는 `404` | 라벨 유지 (no-op) |
| 일시적 리소스 부족 | `503` + `Retry-After` | 라벨 유지 (현재는 재시도 안 함) |
| 내부 오류 | `500` | 라벨 유지 |

> **원칙**: 실패 시 서버가 어떤 상태코드를 주든 **기존 라벨은 그대로**
> 둔다. 잘못된 결과로 덮어쓰는 것보다 no-op 이 사용자에게 낫다.
> `segmentRegion()` 은 실패 시 `null` 을 돌려주고, UI 는 스피너만
> 내리고 조용히 끝낸다.

---

## 5) 취소 / 동시성

- 클라이언트는 같은 annotation 에 대해 **새 H 요청이 들어오면 이전
  `AbortController` 를 취소**하고 새로 시작한다. 서버는 클라이언트의
  연결 해제(RST / FIN) 를 받으면 가능한 한 추론을 조기 종료할 것.
- 서로 다른 annotation 의 요청은 동시에 진행된다. 서버는 GPU 큐 길이를
  고려해 동시 추론 수를 제한(예: N=4) 할 것.
- `LabelPanel` 언마운트 시(프레임 이동·워크스페이스 종료) 모든 in-flight
  AbortController 가 `abort()` 된다.

---

## 6) 보안 / 운영 요구

- 업로드 크기 제한을 서버 측에서 강제 (이미지 1장, 기본 16MB 이내).
- CORS origin 화이트리스트 / API 키 헤더는 정규화 엔드포인트와 동일한
  정책 사용.
- 결과물은 영속화 불필요 — 추론 후 즉시 폐기.
- 동시 추론 큐 제한 (GPU 메모리·시간 비용이 큼).
- 로깅에 원본 이미지 바이트는 남기지 말 것 (개인정보 우려).

---

## 7) 샘플 curl

```bash
curl -X POST "$SEGMENT_URL" \
  -F "file=@frame.jpg" \
  -F 'region={"x":0.4,"y":0.2,"w":0.2,"h":0.3}' \
  -F "classHint=person"
```

예상 응답:

```json
{
  "polygon": [
    [[0.412, 0.223], [0.548, 0.229], [0.551, 0.491], [0.409, 0.488]]
  ],
  "rect": { "x": 0.409, "y": 0.223, "w": 0.142, "h": 0.268 },
  "score": 0.92
}
```

---

## 8) 향후 확장 (지금은 도입하지 않음)

- **마스크 (RLE / PNG)** 응답: `mask: { "format":"rle", "counts":"..." }`
  필드를 추가. 현재 스키마는 polygon 만 커버. 마스크가 필요해지면 같은
  응답 객체에 추가 필드로 얹을 수 있다.
- **여러 오브젝트 탐지**: 별도 엔드포인트 (`/detect`) 로 분리.
- **배치 요청**: 지금은 1 요청 = 1 region 이다. 배치(여러 region 을 한
  번에) 가 필요해지면 `regions: [...]` 필드 + 응답 `results: [...]` 로
  확장. 클라이언트 호출점(`segmentRegion()`) 이 단일 region 을 전제로
  설계돼 있으므로 배치 도입 시 서비스 시그니처도 같이 확장해야 함.

---

## 9) 프런트엔드 side 체크리스트 (참고용)

- [x] `features/annotations/service/segment.ts` — endpoint 해석 + fetch + 파싱
- [x] `features/annotations/ui/LabelPanel.tsx` — hover + `H` capture-phase 핸들러
- [x] in-flight AbortController 관리 (per-annotation), 컴포넌트 언마운트 시 전부 취소
- [ ] polygon `Shape` variant 가 추가되면 `toShape()` 를 polygon 우선으로 변경
- [ ] (선택) `NEXT_PUBLIC_IMAGE_SEGMENT_ENDPOINT` 가 설정되지 않은 환경에서
      UI 상에 "세그먼테이션 비활성" 안내 표시
