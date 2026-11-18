// Dependency-free regression checks for the converted Figma Make demo logic.
// Run with Node.js 22+: node tools/check-ui.mjs
import assert from 'node:assert/strict';
import { resources, analyzeInput, recommendationItems, availability, alternateResources,
  alternateSlots, conditionErrors, purposeSubmissionPeople } from '../src/main/resources/static/js/rental-data.js';
import { applyRecordChange, reservationBlocks, canStudentTransition, ended, stageLabel, refreshAfterSave } from '../src/main/resources/static/js/rental-records.js';
import { returnTotals, equipmentRestrictions } from '../src/main/resources/static/js/equipment-inspection.js';
import { authenticate } from '../src/main/resources/static/js/auth-service.js';
import { filterResources, conditionsMatch } from '../src/main/resources/static/js/browse-view.js';
import { studentRecords, studentGuidance, receiptRecord } from '../src/main/resources/static/js/student-records.js';

export async function runChecks() {
  const results = [];
  async function test(name, run) { await run(); results.push(name); }
  const student = {id:'demo-user',role:'student'}, other = {id:'other-user',role:'student'}, admin = {id:'demo-admin',role:'admin'};
  const condition = {start:'2099-10-15T14:00',end:'2099-10-15T16:00',people:6,use:'팀 회의'};
  const get = id => resources.find(r=>r.id===id);
  const create = (number='TEST-1',id='cam01',actor=student) => ({type:'create',actor,record:{number,userId:actor.id,createdAt:new Date().toISOString(),condition:{...condition},items:[{...get(id),stage:'pending',condition:{...condition}}]}});
  const transition = (number,from,to,version=0,actor=admin,extra={}) => ({type:'transition',actor,number,userId:student.id,itemId:'cam01',expectedVersion:version,from,to,...extra});
  const inspection = (type,from,version,extra={}) => ({type,actor:admin,number:'TEST-1',userId:student.id,itemId:'cam01',expectedVersion:version,expectedEquipmentVersion:0,from,...extra});
  const delivery = () => get('cam01').components.map(c=>({componentId:c.componentId,quantity:c.requiredQuantity,condition:'normal',confirmed:true}));

  await test('원본 장비 7개·시설 5개 및 구성품 보존',()=>{
    assert.equal(resources.filter(r=>r.kind==='장비').length,7);assert.equal(resources.filter(r=>r.kind==='시설').length,5);
    assert.equal(get('mic02').components[0].requiredQuantity,2);
  });
  await test('학생회 회의 인원 인식 및 수용 인원 필터',()=>{
    const analysis=analyzeInput('학생회 회의 6명');assert.deepEqual(analysis.candidates,['팀 회의']);assert.equal(analysis.people,6);
    const items=recommendationItems('팀 회의',analysis,null,null);
    assert(items.some(i=>i.resource.id==='room02'));assert(!items.some(i=>i.resource.id==='room01'));
  });
  await test('일반 영상·복수 활동·자원명 직접 검색 구분',()=>{
    assert.equal(analyzeInput('동아리 홍보 영상 촬영').intent,'video');
    assert.equal(analyzeInput('인터뷰 촬영과 팀 회의').intent,'multiple');
    assert.equal(analyzeInput('카메라').intent,'direct');assert.equal(analyzeInput('회의실').intent,'direct');
  });
  await test('잘못된 인원 및 범위 입력 처리',()=>{
    assert.equal(analyzeInput('회의 0명').peopleStatus,'invalid');assert.equal(analyzeInput('회의 4~6명').peopleStatus,'ambiguous');
  });
  await test('같은 활동 재조회 시 사용자가 수정한 인원 유지',()=>{
    assert.equal(purposeSubmissionPeople('회의 6명',analyzeInput('회의 6명'),8,{activity:'회의 6명',suggested:6,manuallyEdited:true}),8);
  });
  await test('미입력·역전·과거 일정은 신청 불가',()=>{
    assert(availability(get('cam01'),null).length);assert(conditionErrors({...condition,end:condition.start}).length);
    assert(conditionErrors({...condition,start:'2000-01-01T14:00',end:'2000-01-01T16:00'}).length);
  });
  const recordFixture=(number,stage,start,end,owner='demo-user',createdAt='2099-01-01T09:00:00')=>({number,userId:owner,createdAt,condition:{...condition,start,end},items:[{id:'cam01',kind:'장비',name:'카메라',stage}]});
  const recordFixtures=[
    recordFixture('FAR','approved','2099-10-20T10:00','2099-10-20T12:00'),
    recordFixture('RETURN','collected','2099-10-01T10:00','2099-10-17T12:00'),
    recordFixture('NEAR','pending','2099-10-16T10:00','2099-10-16T12:00','demo-user','2099-01-02T09:00:00'),
    recordFixture('OTHER','pending','2099-10-15T10:00','2099-10-15T12:00','other-user'),
    recordFixture('DONE','returned','2099-10-14T10:00','2099-10-14T12:00')
  ];
  await test('내 신청은 본인 항목만 표시하고 진행 중·과거 내역을 분리',()=>{
    assert.deepEqual(studentRecords(recordFixtures,'demo-user').map(r=>r.number),['NEAR','RETURN','FAR']);
    assert.deepEqual(studentRecords(recordFixtures,'demo-user',{history:true}).map(r=>r.number),['DONE']);
    assert.equal(recordFixtures.length,5);assert.equal(recordFixtures[0].number,'FAR');
  });
  await test('상태 필터·최근 신청순·빈 결과 및 항목별 조건 정렬',()=>{
    assert.deepEqual(studentRecords(recordFixtures,'demo-user',{status:'approved'}).map(r=>r.number),['FAR']);
    assert.equal(studentRecords(recordFixtures,'demo-user',{sort:'newest'})[0].number,'NEAR');
    assert.equal(studentRecords(recordFixtures,'demo-user',{status:'return_held'}).length,0);
    const mixed={...recordFixtures[0],number:'MIX',items:[{...recordFixtures[0].items[0],condition:{...condition,start:'2099-10-15T09:00'}},{...recordFixtures[0].items[0],stage:'returned'}]};
    const filtered=studentRecords([...recordFixtures,mixed],'demo-user');
    assert.equal(filtered[0].number,'MIX');assert.equal(filtered[0].items.length,1);assert.equal(mixed.items.length,2);
  });
  await test('장비 반납 지연·시설 종료·승인 후 취소 안내를 구분',()=>{
    const item={kind:'장비',stage:'collected'},now=new Date('2099-10-15T17:00').getTime();
    assert(studentGuidance(item,condition,now).warning);
    assert(!studentGuidance(item,condition,new Date('2099-10-15T15:00').getTime()).warning);
    assert(studentGuidance({...item,kind:'시설'},condition,now).description.includes('관리자가 처리'));
    assert(studentGuidance({...item,stage:'approved'},condition,now).description.includes('관리자에게 문의'));
    assert(!studentGuidance({...item,stage:'returned'},condition,now).warning);
  });
  await test('완료 화면은 서버가 지정한 본인 접수 번호만 사용',()=>{
    const saved={status:'saved',createdNumber:'NEAR',records:recordFixtures};
    assert.equal(receiptRecord(saved,'demo-user').number,'NEAR');
    assert.equal(receiptRecord({...saved,createdNumber:'OTHER'},'demo-user'),null);
    assert.equal(receiptRecord({...saved,status:'failed'},'demo-user'),null);
    assert.equal(receiptRecord({...saved,createdNumber:undefined},'demo-user'),null);
  });
  await test('저장 후 조회 실패는 접수 성공을 유지하고 실패한 저장은 후속 조회하지 않음',async()=>{
    const saved={status:'saved',createdNumber:'NEAR',records:recordFixtures};
    const result=await refreshAfterSave(saved,async()=>{throw new Error('조회 연결 끊김');});
    assert.equal(result.status,'saved');assert.equal(result.availabilityRefreshFailed,true);
    assert.equal(receiptRecord(result,'demo-user').number,'NEAR');
    let called=false;await refreshAfterSave({status:'conflict'},async()=>{called=true;});assert.equal(called,false);
  });
  await test('시설 인원·허용 용도·운영 시간 제한',()=>{
    assert(availability(get('room01'),condition).some(e=>e.includes('수용')));
    assert(availability(get('room02'),{...condition,use:'인터뷰 촬영'}).some(e=>e.includes('허용')));
    assert(availability(get('room02'),{...condition,end:'2099-10-15T21:00'}).some(e=>e.includes('운영')));
  });
  await test('점검 중 장비는 선택 불가',()=>assert(availability(get('mic03'),condition).some(e=>e.includes('점검'))));
  await test('검색어·분류·이용 가능 필터를 함께 적용하고 초기화',()=>{
    const pool=resources.filter(r=>r.kind==='장비');
    const isAvailable=r=>availability(r,condition).length===0;
    const matches=filterResources(pool,{query:'  '+get('cam01').model.toUpperCase()+'  ',category:get('cam01').category,availableOnly:true},isAvailable);
    assert(matches.some(r=>r.id==='cam01'));
    assert(!filterResources(pool,{availableOnly:true},isAvailable).some(r=>r.id==='mic03'));
    assert.equal(filterResources(pool,{query:'없는 장비'},isAvailable).length,0);
    assert.equal(filterResources(pool,{},isAvailable).length,pool.length);
    assert(!filterResources(pool,{category:'없는 분류'},isAvailable).length);
  });
  await test('조회 조건 미적용·변경·원복을 구분하고 장비에서는 시설 인원을 무시',()=>{
    assert(!conditionsMatch(condition,null,'facility'));
    assert(conditionsMatch({...condition},condition,'facility'));
    assert(!conditionsMatch({...condition,end:'2099-10-15T17:00'},condition,'equipment'));
    assert(!conditionsMatch({...condition,people:8},condition,'facility'));
    assert(!conditionsMatch({...condition,use:'발표 연습'},condition,'facility'));
    assert(conditionsMatch({...condition,people:8},condition,'equipment'));
  });
  await test('대체 장비와 다른 일정이 기존 조건을 보존',()=>{
    assert.deepEqual(alternateResources(get('cam01'),condition).map(r=>r.id),['cam02']);
    const slots=alternateSlots(get('cam01'),condition,'2099-10-16','2099-10-17');assert(slots.length);
    assert(slots.every(c=>new Date(c.end)-new Date(c.start)===7200000));
  });
  let snapshot=applyRecordChange([],create());
  await test('신청은 승인 대기이며 기간을 확보하지 않음',()=>{assert.equal(snapshot.status,'saved');assert.equal(reservationBlocks(snapshot.records).length,0);});
  await test('다른 학생은 신청 취소·생성 불가',()=>{
    const r=snapshot.records[0];assert(!canStudentTransition(other,r,r.items[0],'cancelled'));
    assert.equal(applyRecordChange([], {...create(),actor:other}).status,'invalid');
  });
  await test('거절 사유 필수 및 학생 승인 불가',()=>{
    assert.equal(applyRecordChange(snapshot.records,transition('TEST-1','pending','rejected')).status,'invalid');
    assert.equal(applyRecordChange(snapshot.records,transition('TEST-1','pending','approved',0,student)).status,'invalid');
  });
  let approved=applyRecordChange(snapshot.records,transition('TEST-1','pending','approved'));
  await test('승인 시 기간 확보 및 오래된 버전 차단',()=>{
    assert.equal(approved.status,'saved');assert.equal(reservationBlocks(approved.records).length,1);
    assert.equal(applyRecordChange(approved.records,transition('TEST-1','pending','approved')).status,'conflict');
  });
  await test('동일 자원 중복 승인 차단',()=>{
    let concurrent=applyRecordChange(snapshot.records,create('TEST-2'));
    concurrent=applyRecordChange(concurrent.records,transition('TEST-1','pending','approved'));
    assert.equal(applyRecordChange(concurrent.records,transition('TEST-2','pending','approved')).status,'invalid');
  });
  await test('구성품 검수 없는 장비 출고 차단',()=>assert.equal(applyRecordChange(approved.records,transition('TEST-1','approved','collected',1)).status,'invalid'));
  const dispatched=applyRecordChange(approved.records,inspection('checkout','approved',1,{rows:delivery()}));
  await test('정상 출고 및 구성품 기준 보존',()=>{
    assert.equal(dispatched.status,'saved');assert.equal(dispatched.records[0].items[0].stage,'collected');
    assert.equal(dispatched.records[0].items[0].checkoutSnapshot.components.length,4);
  });
  let returned=applyRecordChange(dispatched.records,transition('TEST-1','collected','return_requested',2,student));
  const partial=delivery();partial[1].quantity=0;
  const held=applyRecordChange(returned.records,inspection('inspect_return','return_requested',3,{rows:partial,memo:'렌즈 추가 반환 예정'}));
  await test('누락 구성품은 반납 보류 및 장비 제한',()=>{
    assert.equal(held.status,'saved');assert.equal(held.records[0].items[0].stage,'return_held');
    assert(equipmentRestrictions(held.records,held.equipmentStates).cam01);
  });
  await test('미반환 상태에서는 점검 완료 불가',()=>{
    assert.equal(applyRecordChange(held.records,inspection('maintenance_complete','return_held',4,{expectedEquipmentVersion:1,confirmed:true,memo:'점검 확인'}),held.equipmentStates).status,'invalid');
  });
  await test('누적 반환 초과 차단',()=>{
    assert.equal(applyRecordChange(held.records,inspection('inspect_return','return_held',4,{expectedEquipmentVersion:1,rows:delivery()}),held.equipmentStates).status,'invalid');
  });
  const additional=delivery();additional.forEach((row,index)=>{row.quantity=index===1?1:0;});
  const complete=applyRecordChange(held.records,inspection('inspect_return','return_held',4,{expectedEquipmentVersion:1,rows:additional}),held.equipmentStates);
  await test('추가 반환은 누적 수량에 반영하고 같은 신청 완료',()=>{
    assert.equal(complete.status,'saved');assert(ended(complete.records[0].items[0]));
    assert(returnTotals(complete.records[0].items[0]).every(r=>r.missingQuantity===0));
    assert.equal(stageLabel(complete.records[0].items[0]),'반납 완료');
  });
  await test('반납 완료 후 별도 점검 완료로 이용 제한 해제',()=>{
    const fixed=applyRecordChange(complete.records,inspection('maintenance_complete','returned',5,{expectedEquipmentVersion:complete.equipmentStates.cam01.version,confirmed:true,memo:'반환 수량 및 장비 정상 확인'}),complete.equipmentStates);
    assert.equal(fixed.status,'saved');assert.equal(equipmentRestrictions(fixed.records,fixed.equipmentStates).cam01,undefined);
  });
  await test('로그인은 서버 API와 CSRF 세션을 사용',async()=>{
    const original=globalThis.fetch,calls=[];
    try {
      globalThis.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>url.endsWith('/session')?{user:null,csrfToken:'test-csrf'}:{id:'42',name:'검증',role:'student'}};};
      const user=await authenticate({name:'',email:'student@example.invalid',password:'Testing123!'},false);
      assert.equal(user.id,'42');assert.equal(calls[0].url,'/api/session');
      assert.equal(calls[1].url,'/api/auth/login');assert.equal(calls[1].options.credentials,'same-origin');
      assert.equal(calls[1].options.headers['X-CSRF-Token'],'test-csrf');
    } finally {globalThis.fetch=original;}
  });
  await test('서버 인증 실패 전달 및 가입 입력 검증',async()=>{
    const original=globalThis.fetch;
    try {
      globalThis.fetch=async()=>({ok:false,status:401,json:async()=>({message:'인증 실패'})});
      await assert.rejects(()=>authenticate({name:'',email:'student@example.invalid',password:'wrong'},false),/인증 실패/);
      await assert.rejects(()=>authenticate({name:'',email:'bad',password:'short'},true));
    } finally {globalThis.fetch=original;}
  });
  return results;
}

const results = await runChecks();
for (const name of results) console.log(`PASS ${name}`);
console.log(`${results.length} checks passed. Browser rendering and Oracle integration are not covered.`);
