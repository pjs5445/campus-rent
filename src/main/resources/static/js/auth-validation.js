// Ported from the supplied Figma Make prototype; browser demo only.
export const passwordPolicy = "8자 이상, 영문과 숫자를 포함해주세요.";
export function validateAuth(fields, signup) {
    const errors = {};
    if (signup && !fields.name.trim()) errors.name = "이름을 입력해주세요.";
    if (!fields.email.trim()) errors.email = "이메일을 입력해주세요.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) errors.email = "올바른 이메일 형식으로 입력해주세요.";
    if (!fields.password) errors.password = "비밀번호를 입력해주세요.";
    else if (signup && (fields.password.length < 8 || !/[a-z]/i.test(fields.password) || !/\d/.test(fields.password))) errors.password = passwordPolicy;
    return errors;
}
