# Oracle 11g XE 연결

## 기술 스택과 호환성

2026-11-16 확인 당시 저장소는 HTML/CSS/JavaScript 화면, 브라우저 IndexedDB 시연 저장소,
Java 표준 라이브러리 미리보기 서버로 구성되어 있었습니다. Maven/Gradle과 Spring Boot 설정은
없었으며 로컬 Java는 `1.8.0_151`입니다. `package.json`은 선택적인 UI 검사 명령만 정의합니다.

이번 연결 기반은 다음 버전을 사용합니다.

| 항목 | 버전 / 구성 |
| --- | --- |
| Java | 기존 JDK 8 유지, 소스/타깃 1.8 |
| Spring Boot | 2.7.18 |
| JDBC 드라이버 | `com.oracle.database.jdbc:ojdbc8:12.2.0.1` |
| 데이터 접근 | Spring JDBC, HikariCP (최대 3개 연결) |
| 화면 제공 | Spring MVC, Thymeleaf, 기존 정적 리소스 |
| DB | 제공된 Oracle Database 11g XE, SID 접속 |

[Spring Boot 2.7.18 요구사항](https://docs.spring.io/spring-boot/docs/2.7.18/reference/html/getting-started.html)은
Java 8을 지원합니다. Oracle의 [JDBC 12.2 안내](https://docs.oracle.com/en/database/oracle/oracle-database/12.2/jjdbc/JDBC-getting-started.html)는
`ojdbc8.jar`의 JDK 8 지원과 11.x 서버와의 호환성을 설명합니다. Boot의 기본 JDBC 버전에
의존하지 않고 12.2.0.1을 명시적으로 고정했습니다. 실제 서버 패치 버전과 동작은 연결 테스트로 별도 확인합니다.

이 선택은 기존 수업 환경과의 호환성을 위한 것입니다.
[Spring Boot 2.7.18은 2.x의 마지막 오픈소스 지원 릴리스](https://spring.io/blog/2023/11/23/spring-boot-2-7-18-available-now)입니다.
현재 Java 8u151과 함께 최신 운영 환경을 위한 버전 선정으로 간주하면 안 됩니다.
향후 Java·Spring·DB 업그레이드는 함께 검토해야 합니다.

## 비밀정보와 접속 설정

저장소 루트에서 실행합니다. 실제 값은 `config/application-local.properties`에만 저장합니다.
이 파일은 `.gitignore`로 제외되며 JAR 리소스에도 들어가지 않습니다.
공유용 `config/application-local.properties.example`에는 자리표시자만 있습니다.

새 개발 환경에서는 다음과 같이 복사한 뒤 본인에게 제공된 값을 넣습니다.

```powershell
Copy-Item config/application-local.properties.example config/application-local.properties
```

| 키 | 의미 |
| --- | --- |
| `ORACLE_HOST` | 제공된 DB 서버 IP |
| `ORACLE_PORT` | 제공된 리스너 포트 (이번 서버는 80) |
| `ORACLE_SID` | 제공된 SID (이번 서버는 xe) |
| `ORACLE_USERNAME` | DB 계정 |
| `ORACLE_PASSWORD` | DB 비밀번호 |

같은 이름의 환경변수를 사용해도 됩니다. 환경변수가 로컬 파일보다 우선합니다.
계정과 비밀번호를 명령행 인수, README, Java 코드, 공용 application.properties에 넣지 마세요.
`.env`는 Git에서 제외하지만 Spring Boot가 자동으로 읽지는 않습니다.

JDBC URL은 `jdbc:oracle:thin:@HOST:PORT:SID` 형식입니다.
`@//HOST:PORT/SERVICE_NAME` 형식으로 바꾸거나 포트를 1521로 가정하지 않습니다.
`spring.config.import`가 루트의 로컬 파일을 읽고 공용 설정의 환경변수 자리표시자를 채웁니다.

```powershell
git check-ignore -v config/application-local.properties
git ls-files config/application-local.properties
```

첫 명령은 제외 규칙을, 두 번째 명령은 빈 결과를 보여야 합니다.
`.gitignore`는 이미 추적 중인 파일이나 과거 커밋을 지우지 않으므로 커밋 전에 별도로 확인합니다.
`git add -f`로 비밀 파일을 강제로 추가하지 마세요.

## 빌드 및 연결 검사

JDK 8을 사용합니다. 공식 Maven Wrapper를 포함했으므로 Maven을 별도 설치하지 않아도 됩니다.
첫 실행에는 Maven 3.9.9와 의존성 다운로드를 위한 인터넷 연결이 필요합니다.
이미 Maven 3.6.3 이상이 있다면 `mvn`으로 대체할 수 있습니다.

```powershell
.\mvnw.cmd test
.\mvnw.cmd -Poracle-it verify
.\mvnw.cmd spring-boot:run
```

- 기본 테스트는 실제 DB 없이 MVC/Thymeleaf의 화면 경로를 검사합니다.
- `OracleConnectionIT`는 읽기 전용으로 연결·서버 버전·객체 목록을 확인합니다.
- `OracleWorkflowIT`는 실제 Oracle에 회원·선택 목록·신청·검수 데이터를 쓰고 테스트 종료 시 롤백합니다.
- `OracleConcurrencyIT`는 별도 테스트 시설·사용자·신청을 생성해 두 트랜잭션의 동시 승인을 검사하고 자기 데이터만 정리합니다.
- 테스트로 시퀀스 값이 증가하므로 번호에 공백이 생길 수 있습니다. 테스트 결과는 Git 제외 대상인 `target/failsafe-reports/`에 기록됩니다.
- 웹 서버는 기본 `127.0.0.1:8080`입니다. 브라우저 캐시가 남으면 강력 새로고침하세요.
- 기존 `preview.cmd`는 정적 파일 확인 전용입니다. DB 기능은 Spring Boot 서버에서 사용해야 합니다.

## ERD와 스키마

2026-11-16 다시 업로드된 PDF를 정상적으로 추출·렌더링했습니다.
물리 ERD의 **26개 테이블·185개 컬럼**과 PK/FK를 사용한 SQL은
[스키마 생성 SQL](../../src/main/resources/db/schema-oracle.sql)에 있습니다.

ERD의 `APP_USER`, `EQUIPMENT`, `RENT_REQUEST`, `REQUEST_ITEM` 등 원래 테이블 이름을 유지했습니다.
`TBL_` 접두사는 원본에 없으므로 임의로 붙이지 않았습니다. 이름을 변경하려면 사용자 확인이 필요합니다.
ERD에는 시퀀스 이름이 없어서 독립적인 단일 숫자 PK를 갖는 17개 테이블에 `SEQ_<테이블명>`을 추가했습니다.
복합 PK와 공유 PK에는 별도 시퀀스를 만들지 않았습니다. Oracle 11g의 식별자 길이 제한 안에서 작성했습니다.

PK/FK 외에 이메일·자산 관리번호·접수번호 등의 UNIQUE, 자원 유형 XOR,
이용 기간·상태·수량 CHECK를 명시했습니다. 장비 출고와 시설 이용은 항목 유형까지 FK로 검증합니다.
기존 테이블을 DROP하거나 이름을 바꾸는 SQL은 없습니다.

## 최초 설치 (빈 DB 전용)

현재 서버에는 이미 적용했으므로 다시 실행할 필요가 없습니다.
새 빈 DB에 설치할 때만 로컬 설정에 `CAMPUS_ADMIN_EMAIL`과 16자 이상의
`CAMPUS_ADMIN_PASSWORD`를 설정한 뒤 실행합니다.

```powershell
.\mvnw.cmd package
java -jar target/campus-rent-0.1.0-SNAPSHOT.jar --spring.profiles.active=db-setup --spring.main.web-application-type=none --debug=false
```

`db-setup` 프로필만 DDL과 초기 데이터를 실행합니다. 일반 서버 기동에서는
`spring.sql.init.mode=never`를 유지합니다. 이미 객체가 있으면 설치를 중단합니다.
DDL 중 연결이 끊겨 일부 객체만 생긴 경우에만 `--campus.setup.resume=true`를 사용합니다.
이 모드는 알려진 테이블·컬럼이 일치하고 기존 테이블 데이터가 비어 있어야 진행합니다.
기존 데이터가 있으면 중단하므로 운영 데이터에 재실행하지 마세요.

초기 데이터는 가상 장비 7개·시설 5개와 구성품, 사양, 운영 시간, 허용 목적, 대체 관계입니다.
실제 학교 자산으로 표시하지 않습니다. 예전 브라우저의 가상 예약·회원은 가져오지 않았습니다.

## 계정과 화면 기능

- 학생: 화면의 회원가입에서 생성합니다. 학생 역할은 서버가 지정합니다.
- 관리자: 이번 설치에서 생성한 이메일·임의 비밀번호는 Git 제외 파일 `config/admin-login.txt`에서 확인합니다.
- 회원 비밀번호는 사용자별 무작위 솔트를 사용하는 PBKDF2-HMAC-SHA256 해시로 저장합니다.
- 로그인은 HttpOnly 세션 쿠키로 유지하고 상태 변경 요청은 세션 CSRF 토큰을 검사합니다.
- 회원·신청·상태 이력·출고 구성품·반납 회차·시설 실제 이용·점검 이력을 ERD의 개별 테이블에 저장합니다.
- 학생은 본인 신청만, 관리자는 전체 신청을 조회합니다. 클라이언트의 역할·소유자·번호를 신뢰하지 않습니다.
- 로그인 선택 목록은 `SELECTION_ITEM`에 저장합니다. 비로그인 목록은 현재 탭 sessionStorage를 사용합니다.
- 다중 탭 선택 목록은 마지막 저장 내용이 적용됩니다. 신청 승인에는 별도의 잠금과 버전 검사가 적용됩니다.
- 자원 행 잠금과 트랜잭션으로 같은 자원에 대한 승인·출고·반납을 직렬화하고 오래된 버전은 409로 거절합니다.
- 화면 추천·검색·대체 일정 계산은 DB에서 받은 자원·예약 조건을 사용합니다. 활동 문장 분석은 기존 프런트엔드 규칙입니다.
- 관리자 자원 등록·수정 화면과 과거 출고 자료의 사후 등록 화면은 이번 범위에 포함하지 않았습니다.

## 검증 기록

- Oracle XE 11.2.0.2.0 / JDBC 12.2.0.1.0 접속 및 조회 성공.
- 26개 테이블·185개 컬럼의 자료형/NULL 허용 여부·17개 시퀀스를 실제 Oracle 메타데이터와 대조해 일치 확인. 모든 제약조건 ENABLED/VALIDATED 확인.
- 초기 자원 12개 등록 완료. 업무 데이터는 검증용 생성분만 정리하고 초기 데이터는 유지.
- MVC 화면 경로 7개와 JavaScript 회귀 검사 23개 통과.
- 실제 Oracle 업무 테스트 3개: 회원·세션·소유권·CSRF·선택 목록, 장비 출고·부분 반납·추가 반환·점검, 시설 승인·거절·이용 완료 통과.
- 독립 트랜잭션 2개로 동시에 승인했을 때 성공 1개 / 충돌 1개 확인. 테스트 전용 시설·회원·신청은 정리했습니다.
- 실제 HTTP 쿠키로 회원가입 → 신청 저장 → 로그아웃 → 새 세션 로그인 → 동일 신청 재조회 통과. 테스트 데이터는 정리했습니다.
- 브라우저 제어는 Windows의 현재 URL을 판별하지 못해 중단됐습니다. 실제 클릭·반응형 화면 검증 완료로 표시하지 않습니다.
- DDL 실행 및 메타데이터 검사 중 네트워크 연결이 각각 한 번 끊겼습니다. 기존 객체를 보존해 복구했고 재검사에 통과했습니다. 연결 장애 시 업무 쓰기를 자동 재시도하지 않으며 조회로 처리 결과를 먼저 확인해야 합니다.
- DB 및 관리자 비밀정보는 Git 제외 로컬 파일에만 저장합니다. Commit/Push는 사용자 승인 후 진행합니다.
