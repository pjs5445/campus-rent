// Ported from the supplied Figma Make prototype; browser demo only.
import { availability, resources } from "./rental-data.js";
import { applyInspection, equipmentRestrictions, validCheckout, validReturnHistory, validEquipmentStates } from "./equipment-inspection.js";
export const ended = (item)=>item.stage === "returned" || item.stage === "rejected" || item.stage === "cancelled";
export function canStudentTransition(actor, record, item, to) {
    return actor?.role === "student" && actor.id === record.userId && (item.stage === "pending" && to === "cancelled" || item.kind === "장비" && item.stage === "collected" && to === "return_requested");
}
export const stageLabel = (item)=>item.kind === "장비" ? ({
        pending: "승인 대기",
        approved: "승인 · 수령 대기",
        collected: "수령 · 대여 중",
        return_requested: "반납 신청 · 확인 대기",
        return_held: "반납 보류 · 추가 반환 확인",
        returned: "반납 완료",
        rejected: "거절",
        cancelled: "신청 취소 완료"
    })[item.stage] : ({
        pending: "승인 대기",
        approved: "예약 승인",
        collected: "이용 중",
        return_requested: "상태 확인 필요",
        return_held: "상태 확인 필요",
        returned: "이용 완료",
        rejected: "거절",
        cancelled: "신청 취소 완료"
    })[item.stage];
export function processingHistory(item) {
    return [
        {
            label: "승인",
            at: item.approvedAt,
            actor: item.approvedBy
        },
        {
            label: item.kind === "장비" ? "수령" : "이용 시작",
            at: item.kind === "장비" ? item.collectedAt : item.startedAt ?? item.collectedAt,
            actor: item.kind === "장비" ? item.collectedBy : item.startedBy ?? item.collectedBy
        },
        {
            label: "반납 신청",
            at: item.returnRequestedAt,
            actor: undefined
        },
        {
            label: item.kind === "장비" ? "반납 완료" : "이용 종료",
            at: item.kind === "장비" ? item.returnedAt : item.endedAt ?? item.returnedAt,
            actor: item.kind === "장비" ? item.returnedBy : item.endedBy ?? item.returnedBy
        },
        {
            label: "거절",
            at: item.rejectedAt,
            actor: item.rejectedBy
        },
        {
            label: "신청 취소",
            at: item.cancelledAt,
            actor: item.cancelledBy
        }
    ].filter((entry)=>Boolean(entry.at));
}
export function reservationBlocks(records, exclude) {
    return records.flatMap((record)=>record.items.filter((item)=>[
                "approved",
                "collected",
                "return_requested",
                "return_held",
                "returned"
            ].includes(item.stage) && !(exclude?.number === record.number && exclude.itemId === item.id)).map((item)=>{
            const condition = item.condition ?? record.condition;
            return {
                resourceId: item.id,
                start: condition.start,
                end: condition.end
            };
        }));
}
export function addHours(start, hours) {
    const date = new Date(new Date(start).getTime() + hours * 3600000);
    if (!Number.isFinite(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function scheduleSummary(condition, kind) {
    const hours = (new Date(condition.end).getTime() - new Date(condition.start).getTime()) / 3600000;
    const period = hours % 24 === 0 ? `${hours / 24}일` : `${Number(hours.toFixed(2))}시간`;
    return kind === "장비" ? `수령 ${condition.start.replace("T", " ")} · 반납 ${condition.end.replace("T", " ")} · 총 대여기간 ${period}` : `이용 ${condition.start.replace("T", " ")} ~ ${condition.end.replace("T", " ")} · ${condition.people}명 · ${condition.use || "목적 미선택"}`;
}
export const STORAGE_KEY = "campusrent.demo.records.v1";
const validCondition = (value)=>{
    if (!value || typeof value !== "object") return false;
    const c = value;
    return typeof c.start === "string" && typeof c.end === "string" && Number.isFinite(new Date(c.start).getTime()) && Number.isFinite(new Date(c.end).getTime()) && typeof c.people === "number" && Number.isFinite(c.people) && typeof c.use === "string";
};
function readStoredRecords() {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) throw new Error("Invalid record storage");
    return raw.filter((record)=>record && typeof record.number === "string" && typeof record.userId === "string" && typeof record.createdAt === "string" && Number.isFinite(new Date(record.createdAt).getTime()) && validCondition(record.condition) && Array.isArray(record.items) && record.items.every((item)=>item && typeof item.id === "string" && typeof item.name === "string" && typeof item.code === "string" && (item.version === undefined || Number.isSafeInteger(item.version) && item.version >= 0) && [
                "장비",
                "시설"
            ].includes(item.kind) && [
                "pending",
                "approved",
                "collected",
                "return_requested",
                "return_held",
                "returned",
                "rejected",
                "cancelled"
            ].includes(item.stage) && (item.rejectionReason === undefined || typeof item.rejectionReason === "string") && (item.checkoutSnapshot === undefined || validCheckout(item.checkoutSnapshot)) && (item.returnInspections === undefined || validReturnHistory(item.returnInspections)) && (item.returnHoldReason === undefined || typeof item.returnHoldReason === "string") && [
                item.approvedAt,
                item.collectedAt,
                item.returnedAt,
                item.rejectedAt,
                item.updatedAt,
                item.returnRequestedAt,
                item.startedAt,
                item.endedAt,
                item.cancelledAt
            ].every((timestamp)=>timestamp === undefined || typeof timestamp === "string" && Number.isFinite(new Date(timestamp).getTime())) && [
                item.approvedBy,
                item.collectedBy,
                item.returnedBy,
                item.rejectedBy,
                item.startedBy,
                item.endedBy,
                item.cancelledBy
            ].every((actor)=>actor === undefined || actor && typeof actor.id === "string" && [
                    "admin",
                    "student"
                ].includes(actor.role)) && (item.condition === undefined || validCondition(item.condition))));
}
export const SIGNAL_KEY = `${STORAGE_KEY}.changed`;
export const CHANNEL_NAME = "campusrent.demo.records.changed";
export async function readRecordsIfAvailable() {
    return (await readRentalStateIfAvailable())?.records ?? null;
}
export async function readRentalStateIfAvailable() {
    const result = await transactRecords();
    return result.records ? {
        records: result.records,
        equipmentStates: result.equipmentStates ?? {}
    } : null;
}
export async function readRecords() {
    return await readRecordsIfAvailable() ?? [];
}
export function applyRecordChange(records, change, equipmentStates = {}) {
    const now = new Date().toISOString();
    const actor = change.actor;
    if (!actor || ![
        "student",
        "admin"
    ].includes(actor.role) || actor.role === "admin" && actor.id !== "demo-admin") return {
        status: "invalid",
        records,
        message: "현재 작업자의 권한을 확인해주세요."
    };
    if (change.type === "create") {
        if (actor.role !== "student" || actor.id !== change.record.userId) return {
            status: "invalid",
            records,
            message: "학생 본인의 신청만 생성할 수 있습니다."
        };
        if (records.some((record)=>record.number === change.record.number)) return {
            status: "conflict",
            records
        };
        if (!change.record.items.length || change.record.items.some((item)=>item.stage !== "pending")) return {
            status: "invalid",
            records
        };
        const errors = change.record.items.flatMap((item)=>{
            const resource = resources.find((entry)=>entry.id === item.id && entry.kind === item.kind);
            return resource ? availability(resource, item.condition ?? change.record.condition, reservationBlocks(records), equipmentRestrictions(records, equipmentStates)).map((reason)=>`${item.name}: ${reason}`) : [
                "현재 자원 정보를 찾을 수 없습니다."
            ];
        });
        if (errors.length) return {
            status: "invalid",
            records,
            message: errors.join(" ")
        };
        const record = {
            ...change.record,
            items: change.record.items.map((item)=>({
                    ...item,
                    version: 0,
                    updatedAt: now
                }))
        };
        return {
            status: "saved",
            records: [
                record,
                ...records
            ]
        };
    }
    const record = records.find((entry)=>entry.number === change.number && entry.userId === change.userId);
    const item = record?.items.find((entry)=>entry.id === change.itemId);
    if (!item || (item.version ?? 0) !== change.expectedVersion || item.stage !== change.from) return {
        status: "conflict",
        records,
        equipmentStates
    };
    if (change.type !== "transition") return applyInspection(records, equipmentStates, record, item, change);
    if (item.kind === "장비" && (change.from === "approved" && change.to === "collected" || [
        "return_requested",
        "return_held"
    ].includes(change.from) && change.to === "returned")) return {
        status: "invalid",
        records,
        equipmentStates,
        message: "장비 출고·반납 완료는 구성품 검수 전용 요청으로 처리해야 합니다."
    };
    const allowed = actor.role === "student" ? canStudentTransition(actor, record, item, change.to) : change.from === "pending" && [
        "approved",
        "rejected"
    ].includes(change.to) || change.from === "approved" && change.to === "collected" || change.to === "returned" && (item.kind === "장비" ? change.from === "return_requested" : change.from === "collected");
    if (!allowed || change.to === "rejected" && !change.reason?.trim()) return {
        status: "invalid",
        records,
        message: change.to === "rejected" && !change.reason?.trim() ? "관리자 거절 사유를 입력해주세요." : "현재 역할과 상태에서는 처리할 수 없습니다."
    };
    const resource = resources.find((resource)=>resource.id === item.id && resource.kind === item.kind);
    if (change.to === "approved") {
        const errors = resource ? availability(resource, item.condition ?? record.condition, reservationBlocks(records, {
            number: change.number,
            itemId: change.itemId
        }), equipmentRestrictions(records, equipmentStates)) : [
            "현재 자원 정보를 찾을 수 없습니다."
        ];
        if (errors.length) return {
            status: "invalid",
            records,
            message: errors.join(" ")
        };
    }
    if (change.to === "collected") {
        if (!resource?.rentable || resource.status !== "정상") return {
            status: "invalid",
            records,
            message: "현재 자원의 운영 상태로는 수령 또는 이용 시작을 확인할 수 없습니다."
        };
        const occupied = records.some((entry)=>entry.items.some((other)=>other.id === item.id && !(entry.number === record.number && other.id === item.id) && [
                    "collected",
                    "return_requested"
                ].includes(other.stage)));
        if (occupied) return {
            status: "invalid",
            records,
            message: item.kind === "장비" ? "이전 장비의 반납이 확인되지 않았습니다. 후속 수령을 처리할 수 없습니다." : "이전 시설의 이용 종료가 확인되지 않았습니다."
        };
    }
    const timestamp = {
        pending: "updatedAt",
        approved: "approvedAt",
        collected: "collectedAt",
        return_requested: "returnRequestedAt",
        return_held: "updatedAt",
        returned: "returnedAt",
        rejected: "rejectedAt",
        cancelled: "cancelledAt"
    }[change.to];
    const updated = {
        ...item,
        stage: change.to,
        version: (item.version ?? 0) + 1,
        updatedAt: now,
        [timestamp]: now,
        ...actor.role === "admin" ? {
            [({
                approved: "approvedBy",
                collected: "collectedBy",
                returned: "returnedBy",
                rejected: "rejectedBy",
                pending: "approvedBy",
                return_requested: "returnedBy",
                return_held: "returnedBy",
                cancelled: "cancelledBy"
            })[change.to]]: {
                ...actor
            }
        } : {},
        ...change.to === "cancelled" ? {
            cancelledBy: {
                ...actor
            }
        } : {},
        ...item.kind === "시설" && change.to === "collected" ? {
            startedAt: now,
            startedBy: {
                ...actor
            }
        } : {},
        ...item.kind === "시설" && change.to === "returned" ? {
            endedAt: now,
            endedBy: {
                ...actor
            }
        } : {},
        ...change.to === "rejected" ? {
            rejectionReason: change.reason.trim()
        } : {}
    };
    return {
        status: "saved",
        records: records.map((entry)=>entry === record ? {
                ...entry,
                items: entry.items.map((value)=>value === item ? updated : value)
            } : entry)
    };
}
const DATABASE_NAME = "campusrent.demo.records";
function transactRecords(change, canWrite = ()=>true, currentActor = ()=>null) {
    if (typeof indexedDB === "undefined") return Promise.resolve({
        status: "unsupported"
    });
    return new Promise((resolve)=>{
        let open;
        try {
            open = indexedDB.open(DATABASE_NAME, 1);
        } catch  {
            resolve({
                status: "failed"
            });
            return;
        }
        let finished = false;
        const finish = (result)=>{
            if (!finished) {
                finished = true;
                resolve(result);
            }
        };
        open.onupgradeneeded = ()=>{
            open.result.createObjectStore("records", {
                keyPath: "number"
            });
            open.result.createObjectStore("meta");
        };
        open.onerror = ()=>finish({
                status: "failed"
            });
        open.onblocked = ()=>finish({
                status: "failed"
            });
        open.onsuccess = ()=>{
            const db = open.result;
            if (finished) {
                db.close();
                return;
            }
            let tx;
            try {
                tx = db.transaction([
                    "records",
                    "meta"
                ], "readwrite");
            } catch  {
                db.close();
                finish({
                    status: "failed"
                });
                return;
            }
            const store = tx.objectStore("records");
            const meta = tx.objectStore("meta");
            let result = {
                status: "failed"
            };
            tx.oncomplete = ()=>{
                db.close();
                finish(result);
            };
            tx.onabort = tx.onerror = ()=>{
                db.close();
                finish({
                    status: "failed"
                });
            };
            const migrated = meta.get("legacyImported");
            migrated.onsuccess = ()=>{
                try {
                    if (!migrated.result) {
                        readStoredRecords().forEach((record)=>store.put(record));
                        meta.put(true, "legacyImported");
                    }
                    const request = store.getAll();
                    request.onsuccess = ()=>{
                        const records = request.result;
                        const stateRequest = meta.get("equipmentStates");
                        stateRequest.onsuccess = ()=>{
                            try {
                                const equipmentStates = stateRequest.result ?? {};
                                if (!validEquipmentStates(equipmentStates)) {
                                    tx.abort();
                                    return;
                                }
                                if (!change) {
                                    result = {
                                        status: "saved",
                                        records,
                                        equipmentStates
                                    };
                                    return;
                                }
                                if (!canWrite()) {
                                    result = {
                                        status: "cancelled",
                                        records,
                                        equipmentStates
                                    };
                                    return;
                                }
                                const active = currentActor();
                                if (!active || active.id !== change.actor?.id || active.role !== change.actor?.role) {
                                    result = {
                                        status: "cancelled",
                                        records,
                                        equipmentStates,
                                        message: "현재 로그인 계정이 변경되어 작업을 취소했습니다."
                                    };
                                    return;
                                }
                                result = applyRecordChange(records, change, equipmentStates);
                                if (result.status === "saved") {
                                    const number = change.type === "create" ? change.record.number : change.number;
                                    store.put(result.records.find((record)=>record.number === number));
                                    if (result.equipmentStates) meta.put(result.equipmentStates, "equipmentStates");
                                    result = {
                                        ...result,
                                        equipmentStates: result.equipmentStates ?? equipmentStates
                                    };
                                } else result = {
                                    ...result,
                                    equipmentStates: result.equipmentStates ?? equipmentStates
                                };
                            } catch  {
                                tx.abort();
                            }
                        };
                    };
                } catch  {
                    tx.abort();
                }
            };
        };
    });
}
export async function persistRecords(change, canWrite = ()=>true, currentActor = ()=>null) {
    const result = await transactRecords(change, canWrite, currentActor);
    if (result.status === "saved") {
        try {
            localStorage.setItem(SIGNAL_KEY, crypto.randomUUID());
        } catch  {}
        try {
            const channel = new BroadcastChannel(CHANNEL_NAME);
            channel.postMessage("changed");
            channel.close();
        } catch  {}
    }
    return result;
}
