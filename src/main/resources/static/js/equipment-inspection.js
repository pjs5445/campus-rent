// Ported from the supplied Figma Make prototype; browser demo only.
import { resources } from "./rental-data.js";
export function returnTotals(item) {
    const latest = item.returnInspections?.at(-1);
    return (item.checkoutSnapshot?.components ?? []).map((component)=>{
        const prior = latest?.rows.find((row)=>row.componentId === component.componentId);
        return {
            componentId: component.componentId,
            name: component.name,
            addedQuantity: 0,
            cumulativeQuantity: prior?.cumulativeQuantity ?? 0,
            missingQuantity: component.deliveredQuantity - (prior?.cumulativeQuantity ?? 0),
            damaged: prior?.damaged ?? component.condition === "damaged",
            note: prior?.note ?? component.note
        };
    });
}
export function unresolvedEquipment(records, id) {
    return records.flatMap((record)=>record.items.filter((item)=>item.kind === "장비" && item.id === id && ([
                "collected",
                "return_requested",
                "return_held"
            ].includes(item.stage) || Boolean(item.returnInspections?.length) && returnTotals(item).some((row)=>row.missingQuantity > 0))));
}
export function equipmentRestrictions(records, states) {
    const restricted = {};
    Object.entries(states).forEach(([id, state])=>{
        if (state.status === "inspection") restricted[id] = "장비 점검 중입니다. 반환 확인과 점검 완료 전에는 이용할 수 없습니다.";
    });
    records.forEach((record)=>record.items.forEach((item)=>{
            if (item.kind === "장비" && (item.stage === "return_held" || item.returnInspections?.length && returnTotals(item).some((row)=>row.missingQuantity > 0))) restricted[item.id] = "구성품 반환 확인이 완료되지 않아 장비 이용이 제한됩니다.";
        }));
    return restricted;
}
const integer = (value)=>typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validRow = (row)=>integer(row.quantity) && row.confirmed === true && [
        "normal",
        "damaged"
    ].includes(row.condition) && (row.condition !== "damaged" || Boolean(row.note?.trim()));
export function applyInspection(records, states, record, item, change) {
    const invalid = (message)=>({
            status: "invalid",
            records,
            equipmentStates: states,
            message
        });
    if (![
        "checkout",
        "register_checkout",
        "inspect_return",
        "maintenance_required",
        "maintenance_complete"
    ].includes(change.type)) return invalid("지원하지 않는 장비 확인 요청입니다.");
    const state = states[item.id];
    if ((state?.version ?? 0) !== change.expectedEquipmentVersion) return {
        status: "conflict",
        records,
        equipmentStates: states,
        message: "다른 창에서 장비 상태를 변경했습니다. 최신 상태를 확인해주세요."
    };
    if (change.actor.role !== "admin" || change.actor.id !== "demo-admin" || item.kind !== "장비") return invalid("장비 검수와 점검은 관리자만 처리할 수 있습니다.");
    const resource = resources.find((entry)=>entry.id === item.id && entry.kind === "장비");
    const now = new Date().toISOString();
    const actor = {
        ...change.actor
    };
    let updated = {
        ...item,
        version: (item.version ?? 0) + 1,
        updatedAt: now
    };
    let nextStates = states;
    const setEquipment = (status, reason, action)=>{
        nextStates = {
            ...states,
            [item.id]: {
                status,
                reason,
                relatedRecord: record.number,
                version: (state?.version ?? 0) + 1,
                events: [
                    ...state?.events ?? [],
                    {
                        action,
                        note: reason,
                        actor,
                        at: now,
                        recordNumber: record.number
                    }
                ]
            }
        };
    };
    if (change.type === "maintenance_required" || change.type === "maintenance_complete") {
        if (change.confirmed !== true) return invalid("실제 장비 점검 확인이 필요합니다.");
        if (!change.memo?.trim()) return invalid("실제 점검 확인 내용과 메모를 입력해주세요.");
        if (change.type === "maintenance_complete") {
            if (state?.status !== "inspection") return invalid("현재 점검 중인 장비만 점검 완료를 확인할 수 있습니다.");
            if (unresolvedEquipment(records, item.id).length) return invalid("미반환 또는 보류 건이 있어 점검 완료만으로 장비 이용 제한을 해제할 수 없습니다.");
            if (!resource?.rentable || resource.status !== "정상") return invalid("등록된 기본 운영 상태의 제한이 남아 있습니다.");
            setEquipment("normal", change.memo.trim(), "completed");
        } else setEquipment("inspection", change.memo.trim(), "required");
    } else if (change.type === "checkout" || change.type === "register_checkout") {
        const retrospective = change.type === "register_checkout";
        if (item.checkoutSnapshot) return invalid("보존된 출고 기준은 수정하거나 다시 생성할 수 없습니다.");
        if (retrospective ? ![
            "collected",
            "return_requested",
            "return_held"
        ].includes(item.stage) : item.stage !== "approved") return invalid("현재 대여 상태에서는 출고 기준을 저장할 수 없습니다.");
        if (!retrospective) {
            if (!resource?.rentable || resource.status !== "정상" || equipmentRestrictions(records, states)[item.id]) return invalid("현재 장비 상태로는 출고할 수 없습니다. 점검·구성품 반환 확인이 필요합니다.");
            if (records.some((entry)=>entry.number !== record.number && unresolvedEquipment([
                    entry
                ], item.id).length)) return invalid("이전 대여의 실제 반환 확인이 완료되지 않았습니다. 후속 출고를 차단합니다.");
        }
        const definitions = retrospective ? change.baseline : resource?.components;
        const rows = retrospective ? change.baseline : change.rows;
        if (!definitions?.length || !rows || !definitions.some((component)=>component.body)) return invalid("본체를 포함한 실제 구성품 기준과 확인 내용을 등록해주세요.");
        if (new Set(definitions.map((component)=>component.componentId)).size !== definitions.length || definitions.some((component)=>!component.componentId?.trim() || !component.name?.trim() || !integer(component.requiredQuantity) || component.requiredQuantity < 1 || typeof component.required !== "boolean" || typeof component.body !== "boolean")) return invalid("구성품 ID·이름·필수 수량·본체 구분을 확인해주세요.");
        if (rows.length !== definitions.length || new Set(rows.map((row)=>row.componentId)).size !== rows.length || rows.some((row)=>!definitions.some((component)=>component.componentId === row.componentId))) return invalid("기준 밖 구성품·중복 행·미확인 품목이 있습니다.");
        const errors = definitions.flatMap((component)=>{
            const row = rows.find((entry)=>entry.componentId === component.componentId);
            if (!validRow(row)) return [
                `${component.name}: 정수 수량·전달 상태·확인을 입력하고 손상이 있으면 설명을 남겨주세요.`
            ];
            if (!retrospective && (row.quantity !== component.requiredQuantity || row.condition !== "normal")) return [
                `${component.name}: 고정 세트 수량 ${component.requiredQuantity}개를 정상 전달해야 합니다. 부족·초과·손상 시 출고할 수 없습니다.`
            ];
            return [];
        });
        if (errors.length) return invalid(errors.join(" "));
        if (!rows.some((row)=>row.quantity > 0)) return invalid("실제로 전달한 구성품 수량을 확인해주세요.");
        const snapshot = {
            recordNumber: record.number,
            itemId: item.id,
            itemIndex: record.items.indexOf(item) + 1,
            resourceId: item.id,
            resourceCode: retrospective ? item.code : resource.code,
            resourceName: retrospective ? item.name : resource.name,
            source: retrospective ? "admin-retrospective" : "registered-demo-checkout",
            registeredAt: now,
            registeredBy: actor,
            checkoutAt: retrospective ? item.collectedAt : now,
            components: definitions.map((component)=>{
                const row = rows.find((entry)=>entry.componentId === component.componentId);
                return {
                    componentId: component.componentId,
                    name: component.name,
                    requiredQuantity: component.requiredQuantity,
                    required: component.required,
                    body: component.body,
                    deliveredQuantity: row.quantity,
                    condition: row.condition,
                    note: row.note?.trim() ?? "",
                    confirmed: true
                };
            })
        };
        updated = {
            ...updated,
            checkoutSnapshot: snapshot,
            ...retrospective ? {} : {
                stage: "collected",
                collectedAt: now,
                collectedBy: actor
            }
        };
        if (snapshot.components.some((component)=>component.condition === "damaged")) setEquipment("inspection", "사후 확인 기준에 손상이 기록되어 점검이 필요합니다.", "required");
    } else if (change.type === "inspect_return") {
        if (![
            "return_requested",
            "return_held"
        ].includes(item.stage)) return invalid("반납 신청 또는 보류 건만 검수할 수 있습니다.");
        const snapshot = item.checkoutSnapshot;
        if (!snapshot) return invalid("출고 기준 미등록입니다. 실제 과거 전달 내용을 사후 확인하여 먼저 등록해주세요.");
        const totals = returnTotals(item);
        const rows = change.rows;
        if (!rows?.length || new Set(rows.map((row)=>row.componentId)).size !== rows.length || rows.some((row)=>!snapshot.components.some((component)=>component.componentId === row.componentId))) return invalid("기준 밖 구성품 ID·중복 행 또는 확인 입력 누락이 있습니다.");
        const first = !item.returnInspections?.length;
        const errors = snapshot.components.flatMap((component)=>{
            const row = rows.find((entry)=>entry.componentId === component.componentId);
            const prior = totals.find((entry)=>entry.componentId === component.componentId);
            if (!row) return first || prior.missingQuantity > 0 ? [
                `${component.name}: 반환 또는 부족·손상 여부를 확인해주세요.`
            ] : [];
            if (!validRow(row)) return [
                `${component.name}: 확인 여부·유효한 정수 수량·상태와 손상 설명을 입력해주세요.`
            ];
            if (prior.cumulativeQuantity + row.quantity > component.deliveredQuantity) return [
                `${component.name}: 누적 반환은 출고 ${component.deliveredQuantity}개를 초과할 수 없습니다.`
            ];
            return [];
        });
        if (errors.length) return invalid(errors.join(" "));
        const outcomes = snapshot.components.map((component)=>{
            const row = rows.find((entry)=>entry.componentId === component.componentId);
            const prior = totals.find((entry)=>entry.componentId === component.componentId);
            const cumulativeQuantity = prior.cumulativeQuantity + (row?.quantity ?? 0);
            return {
                componentId: component.componentId,
                name: component.name,
                addedQuantity: row?.quantity ?? 0,
                cumulativeQuantity,
                missingQuantity: component.deliveredQuantity - cumulativeQuantity,
                damaged: prior.damaged || row?.condition === "damaged",
                checkedThisRound: Boolean(row),
                note: [
                    prior.note,
                    row?.note?.trim()
                ].filter(Boolean).join(" / ")
            };
        });
        const missing = outcomes.filter((row)=>row.missingQuantity > 0);
        const damaged = outcomes.filter((row)=>row.damaged);
        const outcome = missing.length ? "return_held" : "returned";
        const reason = [
            ...missing.map((row)=>`${row.name} ${row.missingQuantity}개 부족`),
            ...damaged.map((row)=>`${row.name} 손상${row.note ? `: ${row.note}` : ""}`),
            change.memo?.trim()
        ].filter(Boolean).join(" · ");
        const inspection = {
            round: (item.returnInspections?.length ?? 0) + 1,
            at: now,
            actor,
            memo: change.memo?.trim() ?? "",
            outcome,
            reason,
            rows: outcomes
        };
        updated = {
            ...updated,
            stage: outcome,
            returnInspections: [
                ...item.returnInspections ?? [],
                inspection
            ],
            returnHoldReason: outcome === "return_held" ? reason : undefined,
            ...outcome === "returned" ? {
                returnedAt: now,
                returnedBy: actor
            } : {}
        };
        if (missing.length || damaged.length) setEquipment("inspection", reason, "return_inspection");
    }
    return {
        status: "saved",
        records: records.map((entry)=>entry === record ? {
                ...entry,
                items: entry.items.map((value)=>value === item ? updated : value)
            } : entry),
        equipmentStates: nextStates
    };
}
export function validCheckout(value) {
    const v = value;
    return Boolean(v && Array.isArray(v.components) && v.components.length && [
        "registered-demo-checkout",
        "admin-retrospective"
    ].includes(v.source) && typeof v.registeredAt === "string" && Number.isFinite(new Date(v.registeredAt).getTime()) && v.registeredBy?.role === "admin" && typeof v.registeredBy.id === "string" && new Set(v.components.map((component)=>component.componentId)).size === v.components.length && v.components.every((component)=>typeof component.componentId === "string" && typeof component.name === "string" && integer(component.requiredQuantity) && integer(component.deliveredQuantity) && typeof component.required === "boolean" && [
            "normal",
            "damaged"
        ].includes(component.condition)));
}
export function validReturnHistory(value) {
    return Array.isArray(value) && value.every((v)=>v && integer(v.round) && typeof v.at === "string" && Number.isFinite(new Date(v.at).getTime()) && v.actor?.role === "admin" && [
            "return_held",
            "returned"
        ].includes(v.outcome) && Array.isArray(v.rows) && v.rows.every((row)=>typeof row.componentId === "string" && integer(row.addedQuantity) && integer(row.cumulativeQuantity) && integer(row.missingQuantity) && typeof row.damaged === "boolean"));
}
export function validEquipmentStates(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.values(value).every((state)=>state && integer(state.version) && [
            "inspection",
            "normal"
        ].includes(state.status) && typeof state.reason === "string" && typeof state.relatedRecord === "string" && Array.isArray(state.events) && state.events.every((event)=>[
                "required",
                "return_inspection",
                "completed"
            ].includes(event.action) && typeof event.at === "string" && Number.isFinite(new Date(event.at).getTime()) && event.actor?.role === "admin" && typeof event.actor.id === "string" && typeof event.note === "string"));
}
