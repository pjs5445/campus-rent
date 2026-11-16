# CampusRent 화면 구현

2026-11-16: 아래 화면을 Spring Boot / Oracle 업무 API에 연결했습니다.
실행·계정·스키마와 검증 결과는 [Oracle 연동 안내](../development/oracle-setup.md)를 참고하세요.

## 기준 자료

- 개발 스펙: 루트 [README](../../README.md)
- 기능·업무 규칙: [프로젝트 계획서](../../New-Era_PROJECT.md)
- 원본: 이 폴더의 `Implement CampusRent Home Screen (복사).zip` (기존 `*.zip` 규칙에 따라 Git 제외)
- ERD: `docs/erd/`, 유스케이스: `docs/usecase/`

제공된 ZIP의 React·TypeScript 코드를 참고해 HTML·CSS·JavaScript로 전환했습니다. 원본 ZIP은 그대로 두었으며, 참고용 압축 해제본은 Git에서 제외된 `.work/figma-source/`에 있습니다. 이후 Figma Make 수정 사항은 자동 동기화되지 않습니다.

## 작성한 화면

| 경로 | 화면·시연 동작 |
| --- | --- |
| `/` | 원본 문구·색상·아이콘을 사용한 홈, 활동 입력, 키워드, 직접 검색 진입, 활동별 구성, 예약 절차 |
| `/equipment` | 장비 7개, 검색·분류, 대여기간, 상세 정보, 대체 장비·다른 일정 |
| `/facilities` | 시설 5개, 시간·인원·목적 입력, 수용 인원·운영 시간·용도 검사, 상세·대체 조회 |
| `/purpose` | 활동 분석, 모호한 입력 확인, 자원명 직접 검색 연결, 추천 이유, 시설·장비 조건 분리 |
| 공통 선택 목록 | 항목별 조건 보존·수정·제거, 로그인, 별도의 최종 제출 |
| `/records`, `/history` | 학생 본인 신청 상태·과거 내역, 승인 전 취소, 장비 반납 신청 |
| `/admin` | 승인·사유 입력 거절, 시설 이용 시작·종료, 장비 출고·반납 검수·추가 반환·점검 |

네이티브 `<dialog>`, 입력 레이블, 키보드 포커스, 상태 메시지를 사용했습니다. CSS에 모바일 대응 규칙을 작성했으며 실제 브라우저의 반응형 화면 검토는 아직 필요합니다.

## 코드 구조와 역할

- `src/main/resources/templates/index.html`: 공통 HTML. 정적 자원에 `th:href`·`th:src`, 컨텍스트 경로에 `th:content`를 준비했습니다.
- `src/main/resources/static/css/app.css`: 원본 색상·간격·카드·다이얼로그·반응형 스타일.
- `src/main/resources/static/js/app.js`: 페이지 표시, 라우팅, 폼·선택 목록·서버 API 처리 연결.
- `rental-data.js`: 원본의 자원·추천·기간·대체 조회 규칙을 JavaScript로 전환.
- `rental-records.js`, `equipment-inspection.js`: 서버 신청 조회·저장 어댑터와 구성품·상태 표시 계산. 순수 시연 상태 전이 함수는 회귀 테스트 참고용으로만 남아 있습니다.
- `auth-service.js`, `auth-validation.js`: 서버 세션 로그인·회원가입 API와 입력 검사.
- `static/assets/`, `static/fonts/`: ZIP의 SVG 14개와 폰트 3개.
- `tools/PreviewServer.java`, `preview.cmd`: Java 표준 라이브러리로 정적 화면을 제공하는 로컬 전용 미리보기.
- `tools/check-ui.mjs`: 외부 패키지가 필요 없는 로직 회귀 검사.

React·TypeScript·Tailwind·Vite 런타임과 빌드 과정은 필요하지 않습니다. Spring Boot·Thymeleaf가 화면을 제공하며 Java 서비스가 Oracle을 조회·갱신합니다.

## 현재 저장 방식

회원은 Oracle에 해시된 비밀번호로 저장하고 서버 세션으로 로그인합니다. 신청·검수·점검·시설 이용 이력도 Oracle에 보존합니다.
로그인 선택 목록은 DB, 비로그인 선택 목록은 sessionStorage를 사용합니다. 기존 IndexedDB 기록은 가져오지 않습니다.
자원 12개는 가상 자료 표시를 유지합니다. 활동 문장 분석과 추천 화면 계산은 기존 JavaScript 규칙을 사용하며,
실제 신청 가능 여부·권한·상태 전이·승인 중복은 서버가 다시 검사합니다.

## 실행과 검사

```powershell
.\mvnw.cmd spring-boot:run
.\mvnw.cmd test
.\mvnw.cmd -Poracle-it verify
node tools/check-ui.mjs
```

기본 주소는 http://127.0.0.1:8080 입니다. 학생은 화면에서 회원가입하고,
관리자는 Git 제외 파일 `config/admin-login.txt`의 계정으로 로그인합니다.
서버 재기동 후 회원과 신청 데이터는 보존되지만 로그인 세션은 다시 만들어야 합니다.
`preview.cmd`는 정적 파일 확인 전용이며 새 API 기반 화면 기능은 지원하지 않습니다.

JavaScript 회귀 검사 23개와 MVC 경로 7개를 검사했습니다.
Oracle 통합 검사는 학생 소유권·역할 위조·CSRF·선택 목록·중복 승인·출고·부분 반납·추가 반환·점검·시설 이용을 확인합니다.
실제 브라우저 클릭·반응형 검사는 Windows의 현재 브라우저 URL을 확인할 수 없어 완료하지 못했습니다.
