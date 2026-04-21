# 백엔드 업데이트 요구서 — 비디오 정규화 엔드포인트

클라이언트는 `NEXT_PUBLIC_VIDEO_NORMALIZE_ENDPOINT` 에 지정된 백엔드로 비디오를
업로드하여 브라우저에서 바로 디코딩 가능한 MP4(H.264 / AAC, `+faststart`) 로
정규화 받는다. 본 문서는 현재 프론트엔드가 가정하는 계약과, 진행률 UX 를
완전히 구현하기 위해 백엔드에 요구되는 업데이트 사항을 정리한다.

관련 소스:
- `src/features/media/service/normalize.ts` — `ServerNormalizeAdapter`
- `src/features/media/ui/MediaDropzone.tsx` — 업로드 UI / 진행률 표시

---

## 1) 현재 계약 (이미 지원되고 있어야 함)

| 항목 | 값 |
|---|---|
| Method | `POST` |
| Content-Type | `multipart/form-data` |
| Field | `file` — 단일 파일, mp4/mov/webm/mkv 등 |
| 성공 응답 | `200 OK`, body = MP4 바이너리 |
| 응답 Content-Type | `video/mp4` (권장) |
| 실패 응답 | `4xx` / `5xx` — 프런트는 ffmpeg.wasm 폴백으로 전환 |

### 응답 헤더 요구
- **`Content-Length`** 를 반드시 세팅할 것.
  - 없으면 `xhr.onprogress.lengthComputable === false` 가 되어 "결과 수신 중"
    단계의 퍼센트 표시가 비활성화된다. (불확정 스피너만 표시됨)
- CORS: 브라우저 직업로드 대상이면 `Access-Control-Allow-Origin`,
  `Access-Control-Expose-Headers: Content-Length` 가 필요.

### 요청 크기 / 타임아웃
- 클라이언트는 파일 사이즈에 맞춰 자동 스트리밍 업로드(`XMLHttpRequest`)를 한다.
- 백엔드는 **Nginx/ingress 레벨의 `client_max_body_size` 와 proxy read timeout
  을 현실적인 비디오 길이에 맞게** 설정할 것.
  - 권장: `client_max_body_size 2G`, `proxy_read_timeout 600s`
  - 이 값이 낮으면 업로드 진행률이 100% 에 도달한 뒤 디코딩 단계에서 바로
    504 가 반환되어 UX 가 크게 망가진다.

---

## 2) 프런트엔드가 관측하는 단계

`NormalizeProgress.phase` 는 다음과 같이 전이한다:

1. `uploading` — XHR `upload.onprogress`. 정확한 퍼센트.
2. `decoding` — XHR `upload.onload` 이후 `xhr.onprogress` 도달 전.
   **현재 완전히 불확정 상태**. (아래 §3 참고)
3. `downloading` — 응답 본문 수신. `Content-Length` 가 있으면 퍼센트.

업로드가 끝난 뒤 서버가 디코딩하는 구간이 가장 길지만, HTTP 단일 요청/응답
모델 안에서는 이 구간의 진행률을 알릴 방법이 없다. 이 부분이 본 요구서에서
백엔드 업데이트의 핵심이다.

---

## 3) 신규 요구: 서버 디코딩 단계 진행률

### 3.1 옵션 A (권장) — Chunked/Streaming 응답 + 진행 이벤트

HTTP 응답을 단일 MP4 바이너리가 아닌 **이벤트 스트림 + 최종 바이너리** 로
나누지 않고, 아래 형태로 "진행 프레임 + 결과 프레임" 을 같은 응답에 섞어
보낼 수 있다면 프런트는 적은 변경으로 대응 가능하다.

하지만 다른 HTTP 클라이언트와의 호환성을 위해 **별도 엔드포인트로 분리하는
3.2 방식을 권장한다**.

### 3.2 옵션 B (권장) — 2단계 엔드포인트 (`POST` 업로드 + `GET` 진행/결과)

```
POST {endpoint}/jobs
  body: multipart/form-data, file=…
  resp: 202 Accepted
        { "jobId": "abc123", "statusUrl": "/jobs/abc123",
          "resultUrl": "/jobs/abc123/result" }

GET  {endpoint}/jobs/{jobId}
  resp: 200 OK
        { "state": "queued" | "decoding" | "ready" | "failed",
          "progress": 0.0 .. 1.0,      // decoding 중일 때만 의미있음
          "error": "…"                  // failed 일 때만
        }

GET  {endpoint}/jobs/{jobId}/result
  resp: 200 OK, body = MP4 바이너리, Content-Length 필수
        (state === "ready" 이후에만 200, 이전엔 409/425)
```

폴링 주기: 클라이언트는 1 초 간격으로 `GET /jobs/{jobId}` 를 호출.

**프런트엔드 변경 규모**: `ServerNormalizeAdapter.normalize()` 하나. 기존
`XMLHttpRequest` 경로는 `statusUrl` 이 응답에 포함되어 있을 때만 폴링
모드로 전환하도록 조건부 처리. (legacy 단일-응답 서버도 계속 지원)

### 3.3 옵션 C — Server-Sent Events

```
POST {endpoint}  (Accept: text/event-stream)
  resp: 200 OK, Content-Type: text/event-stream
        event: progress
        data: {"phase":"decoding","progress":0.42}

        event: progress
        data: {"phase":"decoding","progress":0.87}

        event: result
        data: {"size": 12345678}

        (그 뒤 바이너리 본문이 이어지기 어렵기 때문에 결과는 별도
         `resultUrl` 로 받는 편이 일반적)
```

SSE 는 프록시/로드밸런서 환경에 따라 타임아웃·버퍼링 이슈가 흔하므로
**프런트는 옵션 B 를 1순위로 지원하기를 제안**한다.

---

## 4) 오류 처리 규약

| 시나리오 | 응답 |
|---|---|
| 지원하지 않는 코덱/컨테이너 | `415 Unsupported Media Type` |
| 파일 크기 초과 | `413 Payload Too Large` |
| 디코딩 실패 (ffmpeg non-zero exit 등) | `422 Unprocessable Entity` + JSON `{error}` |
| 일시적 리소스 부족 | `503 Service Unavailable` + `Retry-After` |

프런트는 위 어떤 실패가 와도 조용히 `ffmpeg.wasm` 폴백을 시도한다. 단,
**429/413 과 같이 "다시 시도해도 의미없는" 에러** 의 경우 향후 토스트로
원인을 표시할 수 있도록 응답 바디에 사람-읽기용 메시지를 포함해 주면 좋다.

---

## 5) 보안 / 운영 요구

- 업로드 용량 제한을 서버 측에서 강제 (기본 2GB 이내 권장).
- 바이러스/악성 파일 스캔 후 디코딩 실행.
- `jobId` 는 추측 불가능한 랜덤(예: 128bit). URL 에만 의존하지 말고 세션
  쿠키/토큰으로 소유권 확인.
- 디코딩된 결과물 retention 은 짧게 (예: 1 시간) 유지 후 삭제.
- 동시 디코딩 수를 queue 로 제한(ffmpeg 프로세스 비용이 크므로).

---

## 6) 프런트엔드 side 변경 체크리스트 (옵션 B 채택 시)

- [ ] `ServerNormalizeAdapter.normalize()` 에 polling 모드 추가
  - 응답이 `202` + `statusUrl` 이면 jobs polling 경로로 전환
  - 그 외 기존 단일-응답 경로 유지
- [ ] `NormalizeProgress` 의 `decoding` phase 에 실제 `progress` 숫자를 채움
- [ ] `AbortSignal` 연결 — 사용자가 업로드 취소 시 `DELETE /jobs/{jobId}` 호출
- [ ] (선택) `Retry-After` 를 받아 일정 시간 후 재시도

`src/features/media/ui/MediaDropzone.tsx` 의 UI 쪽은 이미 모든 phase 를
처리하므로 변경 불필요.
