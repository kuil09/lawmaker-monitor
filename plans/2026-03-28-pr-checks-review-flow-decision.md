# 2026-03-28 PR Checks Review Flow Decision

## 배경

- draft PR `#8`을 열었지만 GitHub branch checks가 하나도 보고되지 않았다.
- 현재 repository workflow는 `main` push와 data/deploy automation에는 반응하지만, `pull_request` 기준의 기본 검증 경로가 없다.
- 이 상태는 UI나 라우팅 변경이 review 전에 자동 근거 없이 머무는 구조라서 review flow evidence 결함으로 본다.

## 결정

- `main` 대상 pull request마다 동작하는 `pr-checks` workflow를 추가한다.
- scope는 최소 검증으로 제한한다:
  - shared workspace build (`schemas`, `ingest`)
  - web build
  - `npm test`
  - `npm run typecheck`
- 기존 deploy/data workflow는 건드리지 않고 별도 workflow 파일로 추가한다.

## 이유

- 이미 있는 reusable setup action을 그대로 재사용할 수 있다.
- product-surface PR에 최소한의 자동 근거를 붙여 review ergonomics를 개선한다.
- 배포 workflow와 분리하면 운영 side effect 없이 review-only evidence를 보강할 수 있다.

## 검증

- representative clean worktree에서 아래 명령을 통과시켰다.
  - `npm ci`
  - `npm run build --workspace @lawmaker-monitor/schemas`
  - `npm run build --workspace @lawmaker-monitor/ingest`
  - `npm run build --workspace @lawmaker-monitor/web`
  - `npm test`
  - `npm run typecheck`

## 후속

- Paperclip live context가 복구되면, review flow defect 성격으로 이 변경을 owning issue에 연결한다.
- PR checks가 붙기 시작하면 이후 product PR에서는 local-only evidence 의존도를 낮춘다.
