import { caracasDate, parseBcvHtml, parseRate } from "./bcv";

// Extracto real de https://www.bcv.org.ve/ (19-oct-2026).
const BCV_HTML = `
<div id="euro" class="col-sm-12 col-xs-12 ">
  <div class="field-content"><div class="row recuadrotsmc">
    <div class="col-sm-6 col-xs-6"><span> EUR </span></div>
    <div class="col-sm-6 col-xs-6 centrado textp"><strong class="strong-tb"> 991,16445734</strong> </div>
  </div></div></div>
<div id="dolar" class="col-sm-12 col-xs-12 ">
  <div class="field-content"><div class="row recuadrotsmc">
    <div class="col-sm-6 col-xs-6"><span> USD</span></div>
    <div class="col-sm-6 col-xs-6 centrado textp"> <strong class="strong-tb">881,06640000</strong>  </div>
  </div></div></div>
<div class="pull-right dinpro center">Fecha Valor: <span class="date-display-single" property="dc:date" datatype="xsd:dateTime" content="2026-10-19T00:00:00-04:00">Lunes, 19 Octubre  2026</span></div>`;

describe("parseRate", () => {
  it("lee el formato del BCV y el de DolarAPI", () => {
    expect(parseRate("881,06640000")).toBe(881.0664);
    expect(parseRate("881.0664")).toBe(881.0664);
    expect(parseRate("1.234,5")).toBe(1234.5);
  });

  it("rechaza basura, cero y negativos", () => {
    expect(() => parseRate("abc")).toThrow();
    expect(() => parseRate("0")).toThrow();
    expect(() => parseRate("-5")).toThrow();
  });
});

describe("parseBcvHtml", () => {
  it("saca dólar, euro y la fecha valor", () => {
    expect(parseBcvHtml(BCV_HTML)).toEqual([
      { source: "bcv", base: "USD", rate: 881.0664, effectiveDate: "2026-10-19", raw: { usd: 881.0664, date: "2026-10-19" } },
      { source: "bcv", base: "EUR", rate: 991.164457, effectiveDate: "2026-10-19", raw: { eur: 991.164457, date: "2026-10-19" } },
    ]);
  });

  it("falla si cambió la página", () => {
    expect(() => parseBcvHtml("<html>mantenimiento</html>")).toThrow("fecha valor");
  });
});

describe("caracasDate", () => {
  it("usa la hora de Caracas", () => {
    expect(caracasDate("2026-10-19T00:00:00-04:00")).toBe("2026-10-19");
    expect(caracasDate("2026-10-20T02:00:00Z")).toBe("2026-10-19");
  });
});
