import { ended } from './rental-records.js';

export const studentFilters = history => history
  ? [['all','전체'],['returned','이용·반납 완료'],['rejected','거절'],['cancelled','취소']]
  : [['all','전체'],['pending','승인 대기'],['approved','승인 완료'],['collected','이용·대여 중'],['return_requested','반납 확인 대기'],['return_held','반납 보류']];

export function studentRecords(records, userId, { history = false, status = 'all', sort = 'schedule' } = {}) {
  const visible = records.filter(record => record.userId === userId).map(record => ({
    ...record, items: record.items.filter(item => ended(item) === history && (status === 'all' || item.stage === status))
  })).filter(record => record.items.length);
  const nextTime = record => Math.min(...record.items.map(item => {
    const condition = item.condition || record.condition;
    const value = new Date(['collected','return_requested','return_held'].includes(item.stage) ? condition?.end : condition?.start).getTime();
    return Number.isFinite(value) ? value : Infinity;
  }));
  return visible.sort((a,b) => {
    if (!history && sort === 'schedule' && nextTime(a) !== nextTime(b)) return nextTime(a) < nextTime(b) ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt) || a.number.localeCompare(b.number);
  });
}

export function studentGuidance(item, condition, now = Date.now()) {
  const equipment = item.kind === '장비';
  const end = new Date(condition?.end).getTime();
  const overdue = item.stage === 'collected' && Number.isFinite(end) && end < now;
  const messages = {
    pending: ['승인 결과를 기다려주세요', '아직 예약이 확정되지 않았습니다. 승인 전에는 신청을 취소할 수 있습니다.'],
    approved: [equipment?'이용 일정에 맞춰 수령해주세요':'예약 시간에 맞춰 이용해주세요', '승인이 완료되었습니다. 일정 변경이나 취소가 필요하면 관리자에게 문의해주세요.'],
    collected: equipment
      ? [overdue?'반납 예정 시간이 지났습니다':'반납 일정을 확인해주세요', '장비와 구성품을 확인하고 반납 신청을 진행해주세요. 관리자 검수 후 반납이 완료됩니다.']
      : [overdue?'이용 종료 확인이 필요합니다':'예약 시간 내에 이용해주세요', '이용을 마친 뒤 관리자에게 종료 확인을 요청해주세요. 시설 이용 종료는 관리자가 처리합니다.'],
    return_requested: ['관리자의 반납 확인을 기다려주세요', '반납 신청이 접수되었습니다. 장비·구성품 검수가 끝나면 반납 완료로 변경됩니다.'],
    return_held: ['반납 보류 사유를 확인해주세요', '누락된 구성품 등 안내된 사항을 확인하고 관리자에게 추가 반환 확인을 요청해주세요.'],
    returned: [equipment?'반납이 완료되었습니다':'시설 이용이 완료되었습니다', '아래에서 처리·검수 이력을 확인할 수 있습니다.'],
    rejected: ['거절 사유를 확인해주세요', '사유를 확인하고 이용 조건을 변경해 다시 신청할 수 있습니다.'],
    cancelled: ['신청이 취소되었습니다', '필요한 자원을 다시 찾아 새로 신청할 수 있습니다.']
  };
  const [title, description] = messages[item.stage] || ['신청 상태를 확인해주세요','상태가 표시되지 않으면 최신 상태를 조회해주세요.'];
  return {title, description, warning: overdue || item.stage === 'return_held' || item.stage === 'rejected'};
}

export function receiptRecord(result, userId) {
  if (result.status !== 'saved' || !result.createdNumber) return null;
  return result.records?.find(record => record.number === result.createdNumber && record.userId === userId) || null;
}
