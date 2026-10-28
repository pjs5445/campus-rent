// Ported from the supplied Figma Make prototype; browser demo only.
import { validateAuth } from "./auth-validation.js";
const accounts = new Map();
const hash = async (password)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)))).map((byte)=>byte.toString(16).padStart(2, "0")).join("");
const seed = async ()=>{
    const verifier = await hash("Campus123!");
    for (const [email, id, name] of [
        [
            "demo@campusrent.example",
            "demo-user",
            "시연 사용자"
        ],
        [
            "other@campusrent.example",
            "other-user",
            "다른 사용자"
        ]
    ]){
        if (!accounts.has(email)) accounts.set(email, {
            user: {
                id,
                name,
                email,
                role: "student"
            },
            verifier
        });
    }
    if (!accounts.has("admin@campusrent.example")) accounts.set("admin@campusrent.example", {
        user: {
            id: "demo-admin",
            name: "시연 관리자",
            email: "admin@campusrent.example",
            role: "admin"
        },
        verifier: await hash("CampusAdmin123!")
    });
};
export class AuthFailure extends Error {
    field;
    constructor(message, field = "form"){
        super(message), this.field = field;
    }
}
export async function authenticate(fields, signup) {
    const errors = validateAuth(fields, signup);
    const firstError = [
        "name",
        "email",
        "password"
    ].find((field)=>errors[field]);
    if (firstError) throw new AuthFailure(errors[firstError], firstError);
    await new Promise((resolve)=>setTimeout(resolve, 400));
    await seed();
    const email = fields.email.trim().toLowerCase();
    if (email === "fail@campusrent.example") throw new AuthFailure("시연 인증 처리가 실패했습니다. 잠시 후 다시 시도해주세요.");
    if (signup) {
        if (accounts.has(email)) throw new AuthFailure("이미 사용 중인 시연 이메일입니다. 로그인하거나 다른 이메일을 입력해주세요.", "email");
        const user = {
            id: crypto.randomUUID(),
            name: fields.name.trim(),
            email,
            role: "student"
        };
        accounts.set(email, {
            user,
            verifier: await hash(fields.password)
        });
        return {
            ...user
        };
    }
    const account = accounts.get(email);
    if (!account || account.verifier !== await hash(fields.password)) throw new AuthFailure("이메일 또는 비밀번호를 확인해주세요.", "password");
    return {
        ...account.user
    };
}
