# CampusRent 화면 구현

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
- `src/main/resources/static/js/app.js`: 페이지 표시, 라우팅, 폼·선택 목록·시연 처리 연결.
- `rental-data.js`: 원본의 자원·추천·기간·대체 조회 규칙을 JavaScript로 전환.
- `rental-records.js`, `equipment-inspection.js`: 원본의 가상 신청·구성품·상태 변경 및 IndexedDB 트랜잭션 로직을 전환.
- `auth-service.js`, `auth-validation.js`: 메모리 기반 시연 로그인·회원가입. 실제 서버 인증으로 교체할 대상입니다.
- `static/assets/`, `static/fonts/`: ZIP의 SVG 14개와 폰트 3개.
- `tools/PreviewServer.java`, `preview.cmd`: Java 표준 라이브러리로 정적 화면을 제공하는 로컬 전용 미리보기.
- `tools/check-ui.mjs`: 외부 패키지가 필요 없는 로직 회귀 검사.

React·TypeScript·Tailwind·Vite 런타임과 빌드 과정은 필요하지 않습니다. Spring Boot 표준 폴더를 사용하지만 Spring Boot 프로젝트 설정·컨트롤러·Thymeleaf 렌더링 엔진은 이번 화면 작업에 포함하지 않았습니다.

## 시연 상태

로그인 사용자와 신규 가입 계정은 메모리에만 유지되며 새로고침 시 초기화됩니다. 비밀번호와 인증 토큰은 브라우저 저장소에 기록하지 않습니다. 선택 목록은 sessionStorage, 가상 신청·검수·장비 상태는 IndexedDB에 보존합니다. 브라우저 저장소를 사용할 수 없으면 저장 실패를 표시합니다.

승인 대기는 자원 확보 상태가 아닙니다. 승인 시 기간 중복과 장비 제한을 재확인하고, 신청·장비의 버전을 비교해 오래된 검수 요청을 차단합니다. 출고 당시 구성품 기준과 누적 반환 내역을 보존합니다. 누락 구성품이 있으면 반납을 보류하며, 반납 완료와 장비 점검 완료를 구분합니다. 이들은 화면 흐름을 위한 로컬 시연이며 서버 권한 검사·실제 예약·다중 사용자 DB 처리를 대신하지 않습니다.

## 실행과 검증

루트에서 실행합니다. JDK 8 이상의 `java`·`javac`가 필요합니다.

```powershell
.\preview.cmd
# 포트를 바꾸려면: .\preview.cmd 8081
```

`http://127.0.0.1:8080`에서 확인합니다. 시연 계정은 루트 README와 로그인 창의 ‘시연 계정 안내’에 있습니다. 종료는 `Ctrl+C`입니다. JavaScript 로직 검사에는 선택적으로 Node.js 22 이상을 사용합니다.

```powershell
node tools/check-ui.mjs
```

확인한 내용:

- 로컬 JDK 8 컴파일·미리보기 서버 실행 및 HTTP 응답.
- JavaScript 모듈 6개의 구문과 가져오기.
- 7개 페이지 경로와 인원 포함 추천 경로의 HTML 생성. DOM 대체 객체를 사용한 검사이며 실제 화면 렌더링 검사가 아닙니다.
- 원본 자원 수, 활동 인식·인원, 일정·운영 제한, 대체 조회, 신청 소유권, 승인 경쟁, 구성품 출고·보류·추가 반환·점검, 시연 인증 등 로직 검사 23개.

**미검증:** 실제 브라우저 렌더링·클릭 흐름·모바일 배치·IndexedDB 통합. 브라우저 제어 도구가 Windows의 현재 URL을 확인하지 못해 자동 화면 검증이 중단됐습니다. Spring Boot·Oracle 통합 검증도 수행하지 않았습니다.

## 다음 단계

1. 로컬 미리보기에서 원본과 화면·모바일 배치·신청·관리자 흐름을 비교 검토합니다.
2. JDK·Spring Boot 버전 및 MyBatis/JDBC 방식을 팀 기준으로 확정합니다.
3. Spring MVC 경로·Thymeleaf 렌더링을 연결하고 시연 인증·저장을 서버 세션·서비스·DAO 호출로 교체합니다.
4. ERD를 검토해 Oracle 스키마·초기 데이터를 작성하고 승인·검수 처리를 DB 트랜잭션으로 구현합니다.
5. 원본에서 후속 범위로 분류한 장비 관리(F08), 대체 관계 관리(F17 관리 부분), 시설 운영 관리(F21) 화면은 별도 설계 후 구현합니다.
