/** Reglas de contraseña (las mismas que Supabase Auth: 8+ caracteres, letras y números). */
export const MIN_PASSWORD_LENGTH = 8;

/** Devuelve el motivo por el que no sirve, o null si está bien. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Usa al menos ${MIN_PASSWORD_LENGTH} caracteres`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Combina letras y números";
  if (password !== confirm) return "Las contraseñas no coinciden";
  return null;
}
