import { resources, purposes, initialConditions, analyzeInput, recommendations, recommendationItems,
  availability, conditionErrors, alternateResources, alternateSlots, localDate, purposeSubmissionPeople } from './rental-data.js';
import { readRentalStateIfAvailable, persistRecords, reservationBlocks, stageLabel, ended,
  scheduleSummary, addHours, processingHistory, SIGNAL_KEY, CHANNEL_NAME } from './rental-records.js';
import { equipmentRestrictions, returnTotals } from './equipment-inspection.js';
import { authenticate } from './auth-service.js';

// The view is plain JavaScript. Replace the demo services with server calls when
// Spring MVC, server sessions and Oracle are introduced. Never trust this UI for authorization.
const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base = $('meta[name="app-base"]').content.replace(/\/$/, '');
const href = path => `${base}${path}`;
const icon = (name, cls = '') => `<img class="${cls}" src="${href('/assets/' + name)}" alt="">`;
const link = (path, label, cls = '') => `<a class="${cls}" href="${href(path)}" data-route>${label}</a>`;
const button = (action, text, attrs = '', cls = '') => `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs}>${text}</button>`;
const notice = '<p class="notice">시연용 가상 시설·장비입니다. 실제 학교 재고와 운영 정책은 확인이 필요하며, 관리자 승인 전에는 이용이 확정되지 않습니다.</p>';
const drafts = {equipment:{...initialConditions}, facility:{...initialConditions}};
const state = { user:null, records:[], equipmentStates:{}, selected:{}, conditions:{equipment:null,facility:null},
  activity:'', purpose:'', peopleSource:{activity:'',manuallyEdited:false}, category:'전체', query:'', adminFilter:'all', busy:false };
const sessionKey = 'campusrent.ui.selection.v1';
try {
  const saved = JSON.parse(sessionStorage.getItem(sessionKey) || '{}');
  for (const [id, condition] of Object.entries(saved)) {
    if (resources.some(r => r.id === id) && condition && typeof condition.start === 'string' && typeof condition.end === 'string'
      && Number.isInteger(condition.people) && typeof condition.use === 'string') state.selected[id] = condition;
  }
} catch { /* A corrupt or unavailable session starts with an empty list. */ }
let modalContext = null, toastTimer, lastFocus, authContinuation;
const modal = $('#modal');
const kindKey = r => r.kind === '장비' ? 'equipment' : 'facility';
const resource = id => resources.find(r => r.id === id);
const currentCondition = r => state.conditions[kindKey(r)];
const restrictions = () => equipmentRestrictions(state.records, state.equipmentStates);
const blocks = () => reservationBlocks(state.records);
const check = (r, c = currentCondition(r)) => availability(r, c, blocks(), restrictions());
function path() { return location.pathname.slice(base.length) || '/'; }
function toast(message, error = false) {
  clearTimeout(toastTimer); const el = $('#toast'); el.textContent = message; el.hidden = false;
  el.classList.toggle('error', error); toastTimer = setTimeout(() => { el.hidden = true; }, 5500);
}
function saveSelection() {
  try { sessionStorage.setItem(sessionKey, JSON.stringify(state.selected)); }
  catch { toast('브라우저 저장소를 사용할 수 없어 선택 목록은 현재 화면에서만 유지됩니다.', true); }
}
function go(url, replace = false) {
  const target = new URL(url, location.origin);
  if (target.origin !== location.origin) return;
  if (modal.open) modal.close();
  history[replace ? 'replaceState' : 'pushState']({}, '', target.pathname + target.search + target.hash);
  syncRoute(); render(); window.scrollTo(0,0); $('#main').focus({preventScroll:true});
}
function syncRoute() {
  const params = new URLSearchParams(location.search);
  state.query = params.get('q') || ''; state.category = params.get('category') || '전체';
  if (path() === '/purpose' || path() === '/') {
    const activity = params.get('activity') || '';
    if (activity !== state.activity) { state.activity = activity; state.purpose = ''; }
    const analysis = analyzeInput(activity);
    const people = purposeSubmissionPeople(activity, analysis, drafts.facility.people, state.peopleSource);
    if (state.peopleSource.activity !== activity) state.peopleSource = {activity, suggested:analysis.people, manuallyEdited:false};
    drafts.facility.people = people;
    if (!state.purpose && analysis.candidates.length === 1) state.purpose = analysis.candidates[0];
    if (state.purpose) drafts.facility.use = state.purpose;
  }
}
function header() {
  const user = state.user;
  $('#header').innerHTML = `${link('/', `<span class="brand-icon">${icon('9dd8c.svg')}</span><span class="brand-word">Campus<span>Rent</span></span>`, 'brand')}
    <nav class="main-nav" aria-label="주요 메뉴">${[['/equipment','장비 대여'],['/facilities','시설 대여'],['/purpose','목적별 대여']].map(([p,t]) => link(p,t,path()===p?'active':'')).join('')}</nav>
    <div class="account">${user ? `${link(user.role==='admin'?'/admin':'/records',user.role==='admin'?'신청 관리':'내 신청','btn small')}<span class="user-name">${esc(user.name)}</span>${button('logout','로그아웃','','small')}` : button('login','로그인','','primary')}</div>`;
  document.querySelectorAll('.footer-brand').forEach(a=>a.href=href('/'));
}
function home() {
  const activityCards = [
    ['인터뷰 촬영','인터뷰 촬영 시작하기','카메라 세트 + 마이크 세트','영상과 음성을 함께 기록할 때 필요한 구성입니다.','ff97a.svg','054e2.svg',''],
    ['발표 연습','발표 연습 준비하기','회의실 + 필요 시 빔프로젝터','발표 공간을 확인하고, 비치 설비에 따라 필요한 장비를 선택하세요.','b46a5.svg','1eae3.svg','purple'],
    ['팀 회의','팀 회의 시작하기','스터디룸·회의실','참여 인원과 이용 목적에 맞는 공간을 찾으세요.','b46a5.svg',null,'green']
  ];
  return `<div class="home"><section class="hero">
    <span class="hero-label">교내 시설·장비 이용을 한곳에서</span>
    <h1>하고 싶은 활동에 맞춰,<br>공간과 장비를 찾아보세요.</h1>
    <p class="hero-description">필요한 것이 정해져 있다면 직접 찾고, 처음이라면 목적에 맞는 추천으로 시작하세요.</p>
    <form class="purpose-search" data-form="home-purpose"><label for="home-activity">어떤 활동을 준비하고 계신가요?</label>
      <div class="search-input">${icon('8adc4.svg')}<input id="home-activity" name="activity" value="${esc(state.activity)}" placeholder="예: 팀 과제 인터뷰 영상을 촬영하고 싶어요" autocomplete="off"><button class="btn primary">목적에 맞게 추천받기</button></div>
      <div class="keyword-row"><span>추천 키워드</span>${[...purposes,'기타'].map(p=>`<button type="button" class="chip" data-action="keyword" data-value="${p}" aria-pressed="${state.activity===p}">${p}</button>`).join('')}</div>
    </form></section>
    <section class="home-section container"><h2>필요한 것이 정해져 있나요?</h2><div class="quick-grid">
      ${link('/equipment',`<span class="icon-tile">${icon('ff97a.svg')}</span><div><h3>장비 대여</h3><p>카메라 · 빔프로젝터 · 무선 마이크 등</p></div><span class="arrow">→</span>`,'quick-card')}
      ${link('/facilities',`<span class="icon-tile">${icon('b46a5.svg')}</span><div><h3>시설 대여</h3><p>스터디룸·회의실</p></div><span class="arrow">→</span>`,'quick-card')}</div>
      <p class="home-hint">무엇을 준비할지 모르겠다면 활동을 설명하고 추천받으세요.</p></section>
    <section class="activity-section"><div class="container"><div class="section-title"><h2>이런 활동을 준비하고 있나요?</h2><p>활동 목적에 맞는 장비와 공간을 살펴보고, 필요한 항목을 각각 신청하세요.</p></div>
      <div class="activity-grid">${activityCards.map(([p,title,sub,desc,a,b,color])=>`<article class="activity-card"><div class="activity-art ${color}">${icon(a)}${b?`<span class="muted">+</span>${icon(b)}`:''}</div><div class="activity-body"><h3>${title}</h3><p class="subtitle">${sub}</p><p class="desc">${desc}</p><p class="activity-note">추천 구성은 예시입니다. 실제 재고와 이용 가능 여부를 확인한 뒤 신청하세요.</p>${link('/purpose?activity='+encodeURIComponent(p),'구성 살펴보기 <span>→</span>','btn')}</div></article>`).join('')}</div></div></section>
    <section class="steps-section container"><div class="section-title"><h2>간단한 3단계 예약 절차</h2><p>신청부터 최종 예약 확정까지의 과정입니다.</p></div><div class="steps">
      ${[['시설 및 장비 탐색','목적별 추천 또는 개별 탐색을 통해 필요한 공간과 장비를 찾습니다.'],['조건 확인 및 개별 신청','이용 규칙, 구비 품목을 확인하고 날짜와 시간에 맞춰 개별 신청을 작성합니다.'],['관리자 승인 후 이용','내 신청 현황에서 승인 결과를 확인한 뒤, 안내된 절차에 따라 이용합니다.']].map(([t,d],i)=>`<div><span class="step-number">${i+1}</span><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>
      <div class="home-notice">${icon('cb39c.svg')}<span>시설과 장비는 각각 신청합니다. 신청 시에는 승인 대기이며, 관리자 승인 후 예약이 확정됩니다.</span></div></section></div>`;
}
function fields(kind, c, prefix = kind) {
  const facility = kind === 'facility';
  return `<div class="form-grid"><label class="field" for="${prefix}-start">${facility?'이용 시작':'수령 예정'}<input id="${prefix}-start" name="start" type="datetime-local" required value="${esc(c.start)}"></label>
    <label class="field" for="${prefix}-end">${facility?'이용 종료':'반납 예정'}<input id="${prefix}-end" name="end" type="datetime-local" required value="${esc(c.end)}"></label>
    ${facility?`<label class="field" for="${prefix}-people">이용 인원<input id="${prefix}-people" name="people" type="number" min="1" step="1" required value="${c.people}"></label>
      <label class="field" for="${prefix}-use">이용 목적<select id="${prefix}-use" name="use" required><option value="">목적 선택</option>${purposes.map(p=>`<option ${p===c.use?'selected':''}>${p}</option>`).join('')}</select></label>`:
      `<div class="wide row"><span class="small muted">간편 대여기간</span>${[2,4,24,48].map(h=>button('duration',h>=24?`${h/24}일`:`${h}시간`,`data-hours="${h}"`,'small')).join('')}</div>`}</div>`;
}
function conditionPanel(kind) {
  const c = state.conditions[kind];
  return `<form class="panel" data-form="condition" data-kind="${kind}"><h2>${kind==='equipment'?'장비 대여기간':'시설 이용 조건'}</h2>${fields(kind,drafts[kind])}
    <div class="dialog-actions"><button class="btn primary">조건 적용하고 조회</button></div><p class="form-error" role="alert" hidden></p>
    <p class="small muted draft-warning" hidden>작성 중인 조건이 조회 기준과 다릅니다. 조건을 적용하고 다시 조회해주세요.</p></form>
    ${c?`<p class="condition-summary">${esc(scheduleSummary(c,kind==='equipment'?'장비':'시설'))}</p>`:''}`;
}
function empty(title, description, action = '') { return `<div class="empty"><div class="empty-symbol" aria-hidden="true">⌕</div><h3>${title}</h3><p>${description}</p>${action}</div>`; }
function card(r, role = '', c = currentCondition(r), allowToggle = true) {
  const errors = check(r,c), selected = Boolean(state.selected[r.id]);
  const incomplete = !c || conditionErrors(c,r.kind==='시설').length || (r.kind==='시설' && !c.use);
  return `<article class="resource-card ${selected?'selected':''}" data-resource="${r.id}"><div class="card-top"><span class="icon-tile">${icon(r.icon)}</span>
    ${allowToggle?`<label class="check-label"><input type="checkbox" data-action="select" data-id="${r.id}" aria-label="${esc(r.name)} 선택" ${selected?'checked':''} ${errors.length&&!selected?'disabled':''}>선택</label>`:''}</div>
    <span class="eyebrow">${r.kind} · ${r.category}</span><h3>${esc(r.name)}</h3>${role?`<div class="role-note">${esc(role)}</div>`:''}
    <p class="meta">${esc(r.code)} · ${esc(r.model)}</p>
    ${r.kind==='시설'?`<p class="capacity">수용 ${r.capacity}명</p><p>${esc(r.location)}</p><p class="muted">운영 ${r.operatingHours.join('–')} · 공간 전체 예약<br>허용: ${r.allowedUses.join(' · ')}</p>`:`<p class="spec">${r.specs.join(' · ')}</p>`}
    <p class="muted">${r.kind==='시설'?'비치 설비':'구성품'}: ${r.contents.join(' · ')}</p>
    <div class="card-status"><span class="badge ${!errors.length?'good':incomplete?'':'bad'}">${!errors.length?'이용 가능':incomplete?'조건 확인 필요':'이용 불가'}</span>
    ${errors.map(e=>`<p>${esc(e)}</p>`).join('')}</div><div class="actions row">${button('detail','상세보기',`data-id="${r.id}"`,'small')}
    ${errors.length&&c&&!incomplete?button('alternatives',`대체 ${r.kind}`,`data-id="${r.id}"`,'small')+button('slots','다른 일정',`data-id="${r.id}"`,'small'):''}</div></article>`;
}
function selection() {
  const items = Object.entries(state.selected);
  return `<aside class="selection" id="selection" aria-label="선택 목록"><h2>선택 목록 <span class="selection-count">${items.length}</span></h2><p class="small muted">필요한 항목과 이용 조건을 확인하세요.</p>
    ${items.length?items.map(([id,c])=>{const r=resource(id);return `<div class="selection-item"><span class="badge">${r.kind}</span><h3>${r.name}</h3><p>${esc(scheduleSummary(c,r.kind))}</p><div class="row">${button('edit-selection','조건 수정',`data-id="${id}"`,'small')}${button('remove','제거',`data-id="${id}"`,'small')}${button('request','신청하기',`data-id="${id}"`,'primary small')}</div></div>`;}).join(''):`<div class="selection-empty">아직 선택한 항목이 없습니다.<br>목록에서 필요한 자원을 선택하세요.</div>`}
    <div class="selection-foot"><p>항목별로 개별 신청합니다.<br>로그인만으로 신청이 제출되지 않습니다.</p>${link('/records','내 신청 현황 확인','btn full')}</div></aside>`;
}
function heading(title,description) { return `<div class="page-heading"><p class="breadcrumb">${link('/','홈')} / ${title}</p><h1>${title}</h1><p>${description}</p></div>`; }
function browse(kind) {
  const title = kind === 'equipment'?'장비 대여':'시설 대여';
  const pool = resources.filter(r=>kindKey(r)===kind);
  const filtered = pool.filter(r=>(state.category==='전체'||r.category===state.category) && [r.name,r.model,r.code,r.location,r.category,...r.specs,...r.contents].join(' ').toLowerCase().includes(state.query.toLowerCase()));
  return `${heading(title,kind==='equipment'?'필요한 장비와 구성품을 확인하고, 원하는 기간에 대여를 신청하세요.':'인원과 활동 목적에 맞는 공간을 찾고, 이용 시간을 선택하세요.')}${conditionPanel(kind)}
    <form class="search-bar" data-form="search"><input name="q" aria-label="${title} 검색" value="${esc(state.query)}" placeholder="${kind==='equipment'?'장비명, 모델, 관리번호 검색':'시설명, 위치, 비치 설비 검색'}"><button class="btn primary">검색</button>${button('reset-search','초기화')}</form>
    <div class="filter-row" aria-label="분류">${['전체',...new Set(pool.map(r=>r.category))].map(c=>`<button class="chip" data-action="category" data-value="${c}" aria-pressed="${state.category===c}">${c}</button>`).join('')}</div>
    <div class="result-summary"><span>전체 <strong>${filtered.length}</strong>개</span><span class="small">개별 자원 기준</span></div>
    ${filtered.length?`<div class="resource-grid">${filtered.map(r=>card(r)).join('')}</div>`:empty('검색 결과가 없습니다.','검색어 또는 분류를 바꿔 다시 찾아보세요.',button('reset-search','검색어·분류 초기화'))}`;
}
function purposeView() {
  const analysis=analyzeInput(state.activity), chosen=state.purpose;
  let result='';
  if (!state.activity.trim()) result=empty('어떤 활동을 준비하고 계신가요?','활동을 입력하거나 아래 추천 키워드를 선택해주세요.');
  else if (!chosen) {
    const choices=analysis.intent==='multiple'?analysis.candidates:analysis.intent==='video'?['인터뷰 촬영','과제 영상 촬영']:[];
    result=`<div class="recommendation-intro"><h2>${choices.length?'활동을 조금 더 알려주세요.':'직접 검색으로 찾아보세요.'}</h2><p>${choices.length?'원하는 활동을 선택하면 해당 목적에 맞는 구성을 안내합니다.':'활동 목적을 더 자세히 입력하거나 시설·장비 이름으로 직접 검색할 수 있습니다.'}</p><div class="row" style="margin-top:16px">${choices.map(p=>button('choose-purpose',p,`data-value="${p}"`)).join('')}${link('/equipment?q='+encodeURIComponent(analysis.equipmentQuery||''),'장비 직접 찾기','btn')}${link('/facilities?q='+encodeURIComponent(analysis.facilityQuery||''),'시설 직접 찾기','btn')}</div></div>`;
  } else {
    const fc=state.conditions.facility?{...state.conditions.facility,use:chosen}:null;
    const items=recommendationItems(chosen,analysis,fc,state.conditions.equipment,blocks(),restrictions(),drafts.facility.people);
    result=`<div class="recommendation-intro"><span class="badge blue">목적별 추천</span><h2 style="margin-top:8px">${esc(chosen)}에 맞는 구성</h2><p>${recommendations[chosen].reason}</p></div>
      ${analysis.peopleStatus==='ambiguous'||analysis.peopleStatus==='invalid'?'<p class="notice warn">참여 인원이 불명확합니다. 시설 이용 인원을 직접 확인해주세요.</p>':''}
      <details class="panel" ${state.conditions.facility||state.conditions.equipment?'open':''}><summary>이용 일정과 조건 설정</summary><div class="stack">${conditionPanel('facility')}${conditionPanel('equipment')}</div></details>
      <div class="result-summary"><span>추천 자원 <strong>${items.length}</strong>개</span><span class="small">필요한 항목만 선택하세요.</span></div>
      ${!fc||!state.conditions.equipment?'<p class="notice">일정 미입력 상태의 준비 구성입니다. 실제 이용 가능 여부는 해당 자원의 조건을 적용한 뒤 확인할 수 있습니다.</p>':''}
      ${items.length?`<div class="resource-grid">${items.map(i=>card(i.resource,i.role,i.resource.kind==='시설'?fc:state.conditions.equipment)).join('')}</div>`:empty('조건에 맞는 추천 자원이 없습니다.','인원과 목적을 확인하거나 다른 시설·장비를 직접 검색해주세요.')}`;
  }
  return `${heading('목적별 대여','활동 내용과 참여 인원을 알려주시면 필요한 공간과 장비를 함께 안내합니다.')}
    <form class="panel" data-form="purpose"><label class="field" for="activity">준비하는 활동<input id="activity" name="activity" value="${esc(state.activity)}" placeholder="예: 학생회 회의 6명" required></label>
    <div class="keyword-row">${purposes.map(p=>`<button type="button" class="chip" data-action="purpose-keyword" data-value="${p}" aria-pressed="${chosen===p}">${p}</button>`).join('')}</div><div class="dialog-actions"><button class="btn primary">목적에 맞게 추천받기</button></div></form>${result}`;
}
function historyDetails(item) {
  const history=processingHistory(item);
  return `<details><summary>처리·검수 이력 보기</summary>${history.map(h=>`<p>${h.label} · ${esc(new Date(h.at).toLocaleString('ko-KR'))}${h.actor?' · '+esc(h.actor.id):''}</p>`).join('') || '<p>처리 이력이 없습니다.</p>'}
    ${item.checkoutSnapshot?`<p>출고 기준: ${item.checkoutSnapshot.components.map(c=>`${esc(c.name)} ${c.deliveredQuantity}개`).join(' · ')}</p>`:''}
    ${(item.returnInspections||[]).map(i=>`<p>${i.round}차 반환 확인 · ${esc(i.reason||'전량 확인')}<br>${i.rows.map(r=>`${esc(r.name)}: 이번 ${r.addedQuantity} / 누적 ${r.cumulativeQuantity} / 부족 ${r.missingQuantity}`).join('<br>')}</p>`).join('')}
    ${(state.equipmentStates[item.id]?.events||[]).map(e=>`<p>장비 점검 · ${esc(e.note)} · ${esc(new Date(e.at).toLocaleString('ko-KR'))}</p>`).join('')}</details>`;
}
function recordItem(record,item,index,admin) {
  const attrs=`data-number="${esc(record.number)}" data-id="${item.id}"`;
  let actions='';
  if (admin) {
    if(item.stage==='pending') actions+=button('transition','승인',`${attrs} data-to="approved"`,'primary small')+button('reject','거절',attrs,'danger small');
    if(item.stage==='approved') actions+=item.kind==='장비'?button('inspection','출고 검수',`${attrs} data-type="checkout"`,'primary small'):button('transition','이용 시작',`${attrs} data-to="collected"`,'primary small');
    if(item.kind==='시설'&&item.stage==='collected') actions+=button('transition','이용 종료',`${attrs} data-to="returned"`,'primary small');
    if(item.kind==='장비'&&['return_requested','return_held'].includes(item.stage)) actions+=button('inspection',item.stage==='return_held'?'추가 반환 확인':'반납 검수',`${attrs} data-type="inspect_return"`,'primary small');
    if(item.kind==='장비'&&item.stage!=='pending'&&item.stage!=='cancelled'&&item.stage!=='rejected') actions+=button('inspection',state.equipmentStates[item.id]?.status==='inspection'?'점검 완료 확인':'점검 필요 등록',`${attrs} data-type="${state.equipmentStates[item.id]?.status==='inspection'?'maintenance_complete':'maintenance_required'}"`,'small');
  } else {
    if(item.stage==='pending') actions+=button('transition','신청 취소',`${attrs} data-to="cancelled"`,'small');
    if(item.kind==='장비'&&item.stage==='collected') actions+=button('transition','반납 신청',`${attrs} data-to="return_requested"`,'primary small');
  }
  return `<div class="record-item"><div class="row between"><h3>${index+1}. ${esc(item.name)}</h3><span class="badge ${ended(item)?'':'blue'}">${stageLabel(item)}</span></div>
    <p class="muted">${esc(scheduleSummary(item.condition||record.condition,item.kind))}</p>
    ${item.stage==='pending'?'<p class="small muted">관리자 승인 전이며 자원이 확보되지 않았습니다.</p>':''}
    ${item.rejectionReason?`<p class="notice warn">거절 사유: ${esc(item.rejectionReason)}</p>`:''}${item.returnHoldReason?`<p class="notice warn">반납 보류: ${esc(item.returnHoldReason)}</p>`:''}
    ${historyDetails(item)}<div class="row">${actions}</div></div>`;
}
function recordsView(admin=false, history=false) {
  const title=admin?'신청 관리':history?'과거 신청 내역':'내 신청 현황';
  if (!state.user || (admin && state.user.role!=='admin') || (!admin && state.user.role!=='student')) return `<div class="container records-page">${heading(title,'로그인한 계정의 권한에 맞는 신청 내역을 확인합니다.')}${empty(admin?'관리자 로그인이 필요합니다.':'학생 로그인이 필요합니다.','준비된 시연 계정으로 화면 흐름을 확인할 수 있습니다.',button('login','로그인','','primary'))}</div>`;
  const records=state.records.filter(r=>admin||r.userId===state.user.id).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const all=records.flatMap(r=>r.items);
  const filter=item=>admin?(state.adminFilter==='all'||item.stage===state.adminFilter):ended(item)===history;
  return `<div class="container records-page">${notice}${heading(title,admin?'신청 조건을 확인하고 항목별 승인·이용·반납을 처리합니다.':'신청 상태와 처리 사유를 확인하세요.')}
    ${admin?`<div class="stat-grid">${[['승인 대기','pending'],['이용·대여 중','collected'],['반납 확인 대기','return_requested'],['반납 보류','return_held']].map(([t,s])=>`<div class="stat"><strong>${all.filter(i=>i.stage===s).length}</strong><span>${t}</span></div>`).join('')}</div><div class="tabs">${[['전체','all'],['승인 대기','pending'],['승인 완료','approved'],['이용·대여 중','collected'],['반납 확인','return_requested'],['보류','return_held'],['완료','returned']].map(([t,s])=>`<button class="chip" data-action="admin-filter" data-value="${s}" aria-pressed="${state.adminFilter===s}">${t}</button>`).join('')}</div>`:
      `<div class="tabs">${link('/records','진행 중 신청','btn '+(!history?'primary':''))}${link('/history','과거 내역','btn '+(history?'primary':''))}</div>`}
    ${records.some(r=>r.items.some(filter))?records.filter(r=>r.items.some(filter)).map(r=>`<article class="panel record"><div class="row between record-heading"><h3>신청 ${esc(r.number)}</h3><span class="small muted">${esc(new Date(r.createdAt).toLocaleString('ko-KR'))}${admin?' · '+esc(r.userId):''}</span></div>${r.items.map((i,index)=>filter(i)?recordItem(r,i,index,admin):'').join('')}</article>`).join(''):empty('표시할 신청 내역이 없습니다.',admin?'학생 시연 계정으로 신청하면 이곳에서 처리할 수 있습니다.':'필요한 자원을 찾아 이용 신청을 시작해보세요.',link('/equipment','장비 찾아보기','btn'))}</div>`;
}
function render() {
  header(); const p=path();
  $('#main').innerHTML = p==='/'?home():['/equipment','/facilities','/purpose'].includes(p)?`<div class="container workspace"><div class="workspace-content">${notice}${p==='/purpose'?purposeView():browse(p==='/equipment'?'equipment':'facility')}</div>${selection()}</div>`:p==='/records'||p==='/history'?recordsView(false,p==='/history'):p==='/admin'?recordsView(true):`<div class="container records-page">${empty('페이지를 찾을 수 없습니다.','메인으로 돌아가 다시 탐색해주세요.',link('/','메인으로','btn primary'))}</div>`;
  const names={'/':'홈','/equipment':'장비 대여','/facilities':'시설 대여','/purpose':'목적별 대여','/records':'내 신청','/history':'과거 내역','/admin':'신청 관리'};
  document.title=`${names[p]||'페이지 없음'} | CampusRent`;
}
function openModal(title,body,context=null) {
  if(!modal.open) lastFocus=document.activeElement;
  modalContext=context;
  modal.innerHTML=`<div class="modal-header"><h2 id="modal-title">${esc(title)}</h2><button class="close" type="button" data-action="close" aria-label="닫기">×</button></div><div class="modal-body">${body}</div>`;
  if(!modal.open) modal.showModal();
}
function errorIn(form,message) { const el=$('.form-error',form); if(el){el.textContent=message;el.hidden=false;}else toast(message,true); }
function readCondition(form,kind) {
  const f=new FormData(form); return {start:f.get('start'),end:f.get('end'),people:kind==='facility'?Number(f.get('people')):drafts.facility.people,use:kind==='facility'?String(f.get('use')||''):''};
}
function validateCondition(c,kind) {
  const errors=conditionErrors(c,kind==='facility');
  if(kind==='facility'&&!c.use) errors.push('이용 목적을 선택해주세요.');
  return errors;
}
function showDetail(id) {
  const r=resource(id); if(!r) return;
  openModal('상세 정보',`<div class="detail-hero"><span class="icon-tile">${icon(r.icon)}</span><div><span class="eyebrow">${r.kind} · ${r.category}</span><h3>${r.name}</h3></div></div><dl class="detail-grid"><dt>관리번호</dt><dd>${r.code}</dd><dt>모델</dt><dd>${r.model}</dd><dt>위치</dt><dd>${r.location}</dd><dt>사양</dt><dd>${r.specs.join('<br>')}</dd><dt>${r.kind==='시설'?'비치 설비':'구성품'}</dt><dd>${r.contents.join('<br>')}</dd>${r.kind==='시설'?`<dt>이용 조건</dt><dd>${r.operatingHours.join('–')}<br>${r.allowedUses.join(' · ')}</dd>`:''}</dl><p class="notice">${check(r).map(esc).join('<br>')||'선택한 조건으로 이용 신청이 가능합니다. 관리자 승인 후 확정됩니다.'}</p><div class="dialog-actions">${button('close','닫기')}${button('select',state.selected[id]?'선택 해제':'선택 목록에 담기',`data-id="${id}" ${check(r).length&&!state.selected[id]?'disabled':''}`,'primary')}</div>`);
}
function toggleSelection(id) {
  const r=resource(id); if(!r) return;
  if(state.selected[id]) delete state.selected[id];
  else { const errors=check(r); if(errors.length) return toast(errors.join(' '),true); state.selected[id]={...currentCondition(r)}; }
  saveSelection(); render(); if(modal.open) modal.close();
}
function editSelection(id) {
  const r=resource(id),c=state.selected[id]; if(!r||!c)return;
  openModal('선택 항목 조건 수정',`<h3>${r.name}</h3><form data-form="edit-selection" data-id="${id}" data-kind="${kindKey(r)}">${fields(kindKey(r),c,'edit')}<p class="form-error" role="alert" hidden></p><div class="dialog-actions">${button('close','취소')}<button class="btn primary">조건 저장</button></div></form>`);
}
function showAlternatives(id) {
  const r=resource(id), c=currentCondition(r); if(!c)return toast('이용 조건을 먼저 적용해주세요.',true);
  const items=alternateResources(r,c,blocks(),restrictions());
  openModal(`대체 ${r.kind} 찾기`,`<p class="muted">${esc(r.name)} 대신 같은 일정으로 이용할 수 있는 후보입니다.</p><p class="condition-summary">${esc(scheduleSummary(c,r.kind))}</p>${items.length?items.map(a=>`<div class="panel" style="margin:12px 0"><h3>${a.name}</h3><p>${a.specs.join(' · ')}</p><p class="small muted">${a.contents.join(' · ')}</p>${button('select-alternative','이 조건으로 선택',`data-id="${a.id}"`,'primary')}</div>`).join(''):empty('이용 가능한 대체 자원이 없습니다.','다른 일정을 확인해주세요.')}`,{condition:{...c}});
}
function showSlots(id) {
  const r=resource(id),c=currentCondition(r); if(!c)return;
  const end=new Date(c.start);end.setDate(end.getDate()+7);
  openModal('다른 이용 일정 찾기',`<h3>${r.name}</h3><p class="muted">현재 이용 길이를 유지하며 가능한 시간을 찾습니다.</p><form data-form="slots" data-id="${id}"><div class="form-grid"><label class="field">조회 시작일<input type="date" name="from" value="${c.start.slice(0,10)}" required></label><label class="field">조회 종료일<input type="date" name="until" value="${localDate(end)}" required></label></div><button class="btn primary">가능한 일정 조회</button><p class="form-error" hidden role="alert"></p></form><div id="slot-results" style="margin-top:20px"></div>`,{id,condition:{...c},slots:[]});
}
function showAuth(signup=false,continuation=null) {
  authContinuation=continuation || authContinuation;
  openModal(signup?'회원가입':'로그인',`<p class="muted">${signup?'학생 시연 계정을 만듭니다. 새 계정은 새로고침 시 초기화됩니다.':'로그인 후 신청 현황을 확인하고 대여를 신청하세요.'}</p>
    <form data-form="auth" data-signup="${signup}"><div class="stack">${signup?'<label class="field">이름<input name="name" autocomplete="name" required></label>':''}<label class="field">이메일<input name="email" type="email" autocomplete="username" required></label><label class="field">비밀번호<input name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" required></label></div>
      <p class="form-error" role="alert" hidden></p><button class="btn primary full" style="margin-top:20px">${signup?'가입하고 로그인':'로그인'}</button></form>
    <div class="row between" style="margin-top:16px"><span class="small muted">${signup?'이미 계정이 있나요?':'처음 이용하시나요?'}</span>${button(signup?'login':'signup',signup?'로그인':'회원가입','','small')}</div>
    <details class="auth-demo"><summary>시연 계정 안내</summary><p>학생: demo@campusrent.example / Campus123!</p><p>관리자: admin@campusrent.example / CampusAdmin123!</p><p>실제 학교 계정과 연결되지 않습니다. 로그인은 새로고침 시 초기화됩니다.</p></details>`);
}
function showRequest(id) {
  const r=resource(id),c=state.selected[id];if(!r||!c)return;
  if(!state.user)return showAuth(false,id);
  if(state.user.role!=='student')return toast('학생 계정으로 로그인한 후 신청해주세요.',true);
  const errors=check(r,c);
  openModal('신청 내용 최종 확인',`<span class="badge">${r.kind}</span><h3 style="margin-top:12px">${r.name}</h3><p>${esc(scheduleSummary(c,r.kind))}</p><p class="muted">신청자: ${esc(state.user.name)}</p>
    <p class="notice ${errors.length?'warn':''}">${errors.length?errors.map(esc).join('<br>'):'신청하면 승인 대기 상태로 접수됩니다. 관리자 승인 전에는 자원이 확보되지 않습니다.'}</p>
    <form data-form="request" data-id="${id}"><label class="check-label"><input type="checkbox" name="confirmed" required>이용 조건과 신청 내용을 확인했습니다.</label><p class="form-error" role="alert" hidden></p><div class="dialog-actions">${button('close','돌아가기')}<button class="btn primary" ${errors.length?'disabled':''}>최종 신청 제출</button></div></form>`);
}
function recordContext(number,id) {
  const record=state.records.find(r=>r.number===number), item=record?.items.find(i=>i.id===id);
  return record&&item?{record,item}:null;
}
function makeChange(ctx,type,extra={}) {return {type,number:ctx.record.number,userId:ctx.record.userId,itemId:ctx.item.id,expectedVersion:ctx.item.version||0,from:ctx.item.stage,actor:state.user?{id:state.user.id,role:state.user.role}:null,expectedEquipmentVersion:state.equipmentStates[ctx.item.id]?.version||0,...extra};}
async function commitChange(change) {
  const result=await persistRecords(change,()=>Boolean(state.user),()=>state.user);
  if(result.records)state.records=result.records;
  if(result.equipmentStates)state.equipmentStates=result.equipmentStates;
  if(result.status!=='saved')throw new Error(result.message || (result.status==='conflict'?'다른 창에서 상태가 변경되었습니다. 창을 닫고 최신 상태에서 다시 확인해주세요.':'저장하지 못했습니다. 브라우저 저장소 사용 여부를 확인해주세요.'));
  return result;
}
function showTransition(number,id,to) {
  const ctx=recordContext(number,id);if(!ctx)return;
  const label={approved:'승인',collected:'시설 이용 시작',returned:'시설 이용 종료',cancelled:'신청 취소',return_requested:'반납 신청'}[to];
  openModal(label,`<h3>${ctx.item.name}</h3><p>${esc(scheduleSummary(ctx.item.condition||ctx.record.condition,ctx.item.kind))}</p><p class="notice">${to==='approved'?'최신 이용 조건과 예약 중복 여부를 다시 확인합니다.':to==='cancelled'?'승인 대기 중인 본인 신청을 취소합니다.':'실제 이용·반납 상황에 맞게 처리해주세요.'}</p><form data-form="transition"><p class="form-error" role="alert" hidden></p><div class="dialog-actions">${button('close','돌아가기')}<button class="btn primary">${label} 확인</button></div></form>`,makeChange(ctx,'transition',{to}));
}
function showReject(number,id) {
  const ctx=recordContext(number,id);if(!ctx)return;
  openModal('신청 거절',`<h3>${ctx.item.name}</h3><form data-form="reject"><label class="field">거절 사유<textarea name="reason" rows="3" required placeholder="학생에게 안내할 사유를 작성해주세요."></textarea></label><p class="form-error" role="alert" hidden></p><div class="dialog-actions">${button('close','취소')}<button class="btn danger">거절 처리</button></div></form>`,makeChange(ctx,'transition',{to:'rejected'}));
}
function showInspection(number,id,type) {
  const ctx=recordContext(number,id);if(!ctx)return;
  const {item}=ctx, maintenance=type.startsWith('maintenance'), returning=type==='inspect_return';
  const title={checkout:'출고 구성품 검수',inspect_return:item.stage==='return_held'?'추가 반환 확인':'반납 구성품 검수',maintenance_required:'장비 점검 필요 등록',maintenance_complete:'장비 점검 완료 확인'}[type];
  const components=returning?(item.checkoutSnapshot?.components||[]):(resource(id).components||[]),totals=returnTotals(item);
  openModal(title,`<h3>${item.name}</h3><p class="notice">${maintenance?'점검 상태와 대여 건의 반납 상태는 별개입니다. 미반환 구성품이 있으면 점검 완료만으로 제한을 해제할 수 없습니다.':returning?'이번에 받은 수량만 입력하세요. 이전 반환 수량에 누적되며 출고 수량을 초과할 수 없습니다.':'본체와 모든 구성품의 수량·상태를 확인하세요. 정상적인 고정 세트만 출고할 수 있습니다.'}</p>
    <form data-form="inspection">${!maintenance?components.map(c=>{const prior=totals.find(t=>t.componentId===c.componentId);const quantity=returning?prior?.missingQuantity||0:c.requiredQuantity;return `<div class="inspection-row" data-component="${c.componentId}"><h3>${c.name}${c.body?' · 본체':''}</h3><p class="small muted">${returning?`출고 ${c.deliveredQuantity}개 · 이전 반환 ${prior?.cumulativeQuantity||0}개`:`필수 ${c.requiredQuantity}개`}</p><div class="form-grid"><label class="field">${returning?'이번 반환':'전달'} 수량<input name="quantity" type="number" min="0" max="${quantity}" step="1" value="${quantity}" required></label><label class="field">상태<select name="condition"><option value="normal">정상</option><option value="damaged">손상</option></select></label><label class="field wide">확인 메모<input name="note" placeholder="손상 시 구체적인 설명 필수"></label></div><label class="check-label"><input type="checkbox" name="confirmed" required>수량과 상태를 확인했습니다.</label></div>`;}).join(''):''}
    <label class="field">${maintenance?'점검 확인 내용':'검수 메모'}<textarea name="memo" rows="2" ${maintenance?'required':''}></textarea></label>${maintenance?'<label class="check-label" style="margin-top:14px"><input type="checkbox" name="confirmed" required>실제 장비 점검 결과를 확인했습니다.</label>':''}
    <p class="form-error" role="alert" hidden></p><div class="dialog-actions">${button('close','취소')}<button class="btn primary">확인 결과 저장</button></div></form>`,makeChange(ctx,type));
}

document.addEventListener('click', async event => {
  const anchor=event.target.closest('a[data-route]');
  if(anchor && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button===0){event.preventDefault();go(anchor.href);return;}
  const el=event.target.closest('[data-action]'); if(!el||el.disabled)return;
  const {action,id,value,number,type,to}=el.dataset;
  try {
    if(action==='close')modal.close();
    else if(action==='keyword'){const input=$('#home-activity');input.value=value;state.activity=value;state.purpose='';history.replaceState({},'',href('/?activity='+encodeURIComponent(value)));document.querySelectorAll('[data-action="keyword"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===value)));input.focus();}
    else if(action==='purpose-keyword')go(href('/purpose?activity='+encodeURIComponent(value)));
    else if(action==='choose-purpose'){state.purpose=value;drafts.facility.use=value;if(state.conditions.facility)state.conditions.facility={...state.conditions.facility,use:value};render();}
    else if(action==='category'){const params=new URLSearchParams(location.search);params.set('category',value);go(href(path()+'?'+params),true);}
    else if(action==='reset-search')go(href(path()),true);
    else if(action==='duration'){const form=el.closest('form');const input=$('[name=start]',form),end=$('[name=end]',form);end.value=addHours(input.value,Number(el.dataset.hours));end.dispatchEvent(new Event('input',{bubbles:true}));}
    else if(action==='select')toggleSelection(id);
    else if(action==='remove'){delete state.selected[id];saveSelection();render();}
    else if(action==='edit-selection')editSelection(id);
    else if(action==='detail')showDetail(id);
    else if(action==='alternatives')showAlternatives(id);
    else if(action==='slots')showSlots(id);
    else if(action==='select-alternative'){const r=resource(id),c=modalContext.condition,errors=check(r,c);if(errors.length)throw new Error(errors.join(' '));state.selected[id]={...c};saveSelection();modal.close();render();toast('대체 자원을 선택 목록에 담았습니다.');}
    else if(action==='select-slot'){const c=modalContext.slots[Number(el.dataset.index)],r=resource(modalContext.id);const errors=check(r,c);if(errors.length)throw new Error(errors.join(' '));state.selected[r.id]={...c};saveSelection();modal.close();render();toast('새 일정을 선택 목록에 담았습니다.');}
    else if(action==='login')showAuth();
    else if(action==='signup')showAuth(true);
    else if(action==='logout'){state.user=null;authContinuation=null;render();toast('로그아웃했습니다.');}
    else if(action==='request')showRequest(id);
    else if(action==='admin-filter'){state.adminFilter=value;render();}
    else if(action==='transition')showTransition(number,id,to);
    else if(action==='reject')showReject(number,id);
    else if(action==='inspection')showInspection(number,id,type);
  } catch(error){toast(error.message||'처리하지 못했습니다.',true);}
});
document.addEventListener('input',event=>{
  const form=event.target.closest('form');if(!form)return;
  if(form.dataset.form==='condition'){
    const kind=form.dataset.kind;Object.assign(drafts[kind],readCondition(form,kind));
    $('.draft-warning',form).hidden=false;
    if(event.target.name==='people')state.peopleSource.manuallyEdited=true;
  }
  if(form.dataset.form==='home-purpose'){
    state.activity=event.target.value;state.purpose='';history.replaceState({},'',href('/?activity='+encodeURIComponent(state.activity)));
    document.querySelectorAll('[data-action="keyword"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===state.activity)));
  }
});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();
  if(state.busy)return;
  const f=new FormData(form),mode=form.dataset.form,submitter=event.submitter;
  try {
    if(mode==='home-purpose'||mode==='purpose'){
      const activity=String(f.get('activity')||'').trim(),analysis=analyzeInput(activity);
      if(analysis.intent==='direct')go(href((analysis.equipmentQuery?'/equipment?q=':'/facilities?q=')+encodeURIComponent(analysis.equipmentQuery||analysis.facilityQuery)));
      else { if(activity!==state.activity)state.purpose='';go(href('/purpose?activity='+encodeURIComponent(activity))); }
    } else if(mode==='search'){
      const params=new URLSearchParams(location.search);params.set('q',String(f.get('q')||'').trim());go(href(path()+'?'+params),true);
    } else if(mode==='condition'||mode==='edit-selection'){
      const kind=form.dataset.kind,c=readCondition(form,kind),errors=validateCondition(c,kind);
      if(mode==='edit-selection')errors.push(...check(resource(form.dataset.id),c));
      if(errors.length)return errorIn(form,[...new Set(errors)].join(' '));
      if(mode==='condition'){
        state.conditions[kind]=c;Object.assign(drafts[kind],c);
        if(path()==='/purpose'&&kind==='facility'){state.purpose=c.use;state.peopleSource.manuallyEdited=true;}
      } else {state.selected[form.dataset.id]=c;saveSelection();modal.close();}
      render();toast(mode==='condition'?'조회 조건을 적용했습니다. 기존 선택 항목의 일정은 유지됩니다.':'선택 항목의 조건을 저장했습니다.');
    } else if(mode==='slots'){
      const from=String(f.get('from')),until=String(f.get('until'));
      if(from>until)return errorIn(form,'조회 종료일은 시작일 이후로 선택해주세요.');
      if((new Date(until)-new Date(from))/86400000>30)return errorIn(form,'조회 범위는 최대 31일입니다.');
      modalContext.slots=alternateSlots(resource(form.dataset.id),modalContext.condition,from,until,blocks(),restrictions());
      $('#slot-results').innerHTML=modalContext.slots.length?modalContext.slots.map((c,i)=>`<div class="panel" style="margin-bottom:10px"><p>${esc(scheduleSummary(c,resource(form.dataset.id).kind))}</p>${button('select-slot','이 일정으로 선택',`data-index="${i}"`,'primary small')}</div>`).join(''):empty('가능한 일정이 없습니다.','조회 날짜 또는 이용 조건을 변경해주세요.');
    } else {
      state.busy=true;if(submitter)submitter.disabled=true;
      if(mode==='auth'){
        const user=await authenticate({name:String(f.get('name')||''),email:String(f.get('email')),password:String(f.get('password'))},form.dataset.signup==='true');
        state.user=user;const pending=authContinuation;authContinuation=null;modal.close();render();toast(`${user.name}님, 로그인했습니다.`);
        if(pending)showRequest(pending);
      } else if(mode==='request'){
        const id=form.dataset.id,r=resource(id),c=state.selected[id];if(!c||!state.user)throw new Error('선택 항목과 로그인 상태를 다시 확인해주세요.');
        const record={number:'CR-'+crypto.randomUUID().slice(0,8).toUpperCase(),userId:state.user.id,createdAt:new Date().toISOString(),condition:{...c},items:[{...r,condition:{...c},stage:'pending'}]};
        await commitChange({type:'create',record,actor:{id:state.user.id,role:state.user.role}});
        delete state.selected[id];saveSelection();modal.close();render();toast('신청이 접수되었습니다. 내 신청 현황에서 승인 결과를 확인하세요.');
      } else if(['transition','reject','inspection'].includes(mode)){
        const change={...modalContext};
        if(mode==='reject')change.reason=String(f.get('reason')||'');
        if(mode==='inspection'){
          change.memo=String(f.get('memo')||'');change.confirmed=Boolean(f.get('confirmed'));
          change.rows=[...form.querySelectorAll('[data-component]')].map(row=>({componentId:row.dataset.component,quantity:Number($('[name=quantity]',row).value),condition:$('[name=condition]',row).value,note:$('[name=note]',row).value,confirmed:$('[name=confirmed]',row).checked}));
        }
        await commitChange(change);modal.close();render();toast('처리 결과를 저장했습니다.');
      }
    }
  } catch(error){errorIn(form,error.message||'처리하지 못했습니다. 다시 시도해주세요.');}
  finally {state.busy=false;if(submitter?.isConnected)submitter.disabled=false;}
});
modal.addEventListener('close',()=>{
  // A successful login may immediately open a new confirmation dialog. The old
  // dialog's queued close event must not clear that new dialog's context.
  if(modal.open)return;
  modalContext=null;authContinuation=null;
  if(['/admin','/records','/history'].includes(path()))render();
  if(lastFocus?.isConnected)lastFocus.focus();else $('#main').focus({preventScroll:true});
});
window.addEventListener('popstate',()=>{if(modal.open)modal.close();syncRoute();render();});
async function refresh() {
  const snapshot=await readRentalStateIfAvailable();
  if(snapshot){state.records=snapshot.records;state.equipmentStates=snapshot.equipmentStates;}
  if(['/admin','/records','/history'].includes(path())&&!state.busy&&!modal.open)render();
}
window.addEventListener('storage',event=>{if(event.key===SIGNAL_KEY)refresh();});
window.addEventListener('focus',()=>refresh());
try {const channel=new BroadcastChannel(CHANNEL_NAME);channel.onmessage=()=>refresh();}catch{/* Focus and storage events are fallback transports. */}
await refresh();syncRoute();render();
