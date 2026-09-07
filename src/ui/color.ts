/** ANSI, small enough to read. Respects NO_COLOR and a non-tty stdout. */

const enabled = () => !process.env["NO_COLOR"] && process.stdout.isTTY !== false;

const wrap = (open: number, close: number) => (text: string) =>
  enabled() ? `[${open}m${text}[${close}m` : text;

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const blue = wrap(34, 39);
export const magenta = wrap(35, 39);
export const cyan = wrap(36, 39);
export const grey = wrap(90, 39);
export const invertRed = wrap(41, 49);
export const invertGreen = wrap(42, 49);
export const invertYellow = wrap(43, 49);

export function verdictColor(verdict: string): (text: string) => string {
  switch (verdict) {
    case "ORIGINAL":
      return green;
    case "CONTESTED":
      return yellow;
    case "TAINTED":
      return magenta;
    case "VAMP":
      return red;
    case "DEAD":
      return grey;
    case "FARM":
      return red;
    case "CLEAN":
      return green;
    case "SOLO":
      return cyan;
    default:
      return (t: string) => t;
  }
}

export function riskColor(level: string): (text: string) => string {
  switch (level) {
    case "GREEN":
      return green;
    case "AMBER":
      return yellow;
    case "RED":
      return red;
    default:
      return grey;
  }
}
