import { describe, expect, it } from "vitest";
import { passwordProblem } from "./password";

describe("passwordProblem", () => {
  it("rechaza contraseñas cortas", () => {
    expect(passwordProblem("abc123", "abc123")).toMatch(/8 caracteres/);
  });

  it("pide letras y números", () => {
    expect(passwordProblem("abcdefgh", "abcdefgh")).toMatch(/letras y números/);
    expect(passwordProblem("12345678", "12345678")).toMatch(/letras y números/);
  });

  it("pide que ambas coincidan", () => {
    expect(passwordProblem("clave1234", "clave1235")).toMatch(/no coinciden/);
  });

  it("acepta una contraseña válida", () => {
    expect(passwordProblem("clave1234", "clave1234")).toBeNull();
  });
});
