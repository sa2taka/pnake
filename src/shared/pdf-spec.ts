/**
 * Operator explanation dictionary.
 *
 * Provides plain-language summaries (Human) and concise technical
 * descriptions (Technical) for content-stream operators. Section
 * references point at ISO 32000-2 so the UI's "Spec ref" hint is
 * accurate.
 */

import type { PdfOperation, PdfValue } from "./ir-types";

export interface OperatorExplanation {
  human: string;
  technical: string;
  specSection?: string;
}

interface OperatorInfo {
  /** Plain-language template. The placeholder `{operands}` is interpolated. */
  human: (operands: PdfValue[]) => string;
  /** Concise technical description. */
  technical: string;
  specSection?: string;
}

const TABLE: Record<string, OperatorInfo> = {
  // graphics-state
  q: {
    human: () => "現在のグラフィックス状態をスタックに退避します。",
    technical: "Save graphics state — push current state onto the stack.",
    specSection: "ISO 32000-2 §8.4.4",
  },
  Q: {
    human: () => "退避したグラフィックス状態を取り出して元に戻します。",
    technical: "Restore graphics state — pop the top of the stack.",
    specSection: "ISO 32000-2 §8.4.4",
  },
  cm: {
    human: (o) =>
      `CTM(現在の変換行列)を ${formatMatrix(o)} で更新します。回転・拡大・移動などをここで指定します。`,
    technical: "Modify current transformation matrix (left-multiply).",
    specSection: "ISO 32000-2 §8.4.4",
  },
  w: {
    human: (o) => `線の太さを ${formatNumber(o[0])} に設定します。`,
    technical: "Set line width.",
    specSection: "ISO 32000-2 §8.4.3.2",
  },
  J: {
    human: (o) => `線端の形状を ${formatNumber(o[0])} に設定します(0=butt/1=round/2=square)。`,
    technical: "Set line cap style.",
    specSection: "ISO 32000-2 §8.4.3.3",
  },
  j: {
    human: (o) => `線の結合形状を ${formatNumber(o[0])} に設定します。`,
    technical: "Set line join style.",
    specSection: "ISO 32000-2 §8.4.3.4",
  },

  // path
  m: { human: (o) => `(${formatNumber(o[0])}, ${formatNumber(o[1])}) へパスを移動します。`, technical: "moveto", specSection: "§8.5.2" },
  l: { human: (o) => `直線で (${formatNumber(o[0])}, ${formatNumber(o[1])}) まで描画します。`, technical: "lineto", specSection: "§8.5.2" },
  re: {
    human: (o) =>
      `矩形パス x=${formatNumber(o[0])} y=${formatNumber(o[1])} w=${formatNumber(o[2])} h=${formatNumber(o[3])} を構築します。`,
    technical: "Append rectangle to path.",
    specSection: "§8.5.2",
  },
  h: { human: () => "現在のサブパスを閉じます。", technical: "Close subpath.", specSection: "§8.5.2" },

  // path-paint
  S: { human: () => "現在のパスをストローク(輪郭)で描画します。", technical: "Stroke path.", specSection: "§8.5.3" },
  s: { human: () => "サブパスを閉じてからストロークします。", technical: "Close & stroke path." },
  f: { human: () => "現在のパスを塗りつぶします(非ゼロ規則)。", technical: "Fill path (non-zero)." },
  F: { human: () => "現在のパスを塗りつぶします(非ゼロ規則)。", technical: "Fill path (deprecated alias)." },
  "f*": { human: () => "現在のパスを塗りつぶします(偶奇規則)。", technical: "Fill path (even-odd)." },
  B: { human: () => "現在のパスを塗りつぶしてからストロークします。", technical: "Fill and stroke." },
  "B*": { human: () => "偶奇塗りつぶし→ストロークの順で描画します。", technical: "Fill (even-odd) and stroke." },
  n: { human: () => "現在のパスを破棄します(描画はしません)。", technical: "End path without filling or stroking." },

  // clipping
  W: { human: () => "現在のパスを次のパス操作の後にクリッピング領域とします。", technical: "Set clipping path (non-zero)." },
  "W*": { human: () => "偶奇規則でクリッピング領域を設定します。", technical: "Set clipping path (even-odd)." },

  // text
  BT: { human: () => "テキストブロックを開始します。テキスト行列が単位行列にリセットされます。", technical: "Begin text object." },
  ET: { human: () => "テキストブロックを終了します。", technical: "End text object." },
  Tf: {
    human: (o) =>
      `フォントを ${formatName(o[0])}、サイズを ${formatNumber(o[1])} に設定します。`,
    technical: "Set font and size.",
    specSection: "§9.3",
  },
  Tj: {
    human: (o) => `文字列 ${describeString(o[0])} を現在位置に描画します。`,
    technical: "Show text string.",
    specSection: "§9.4.3",
  },
  TJ: {
    human: () => "文字列の配列を描画します(間隔調整つき)。",
    technical: "Show text with positioning array.",
    specSection: "§9.4.3",
  },
  "'": { human: () => "次の行に進んで文字列を描画します。", technical: "Move to next line and show text." },
  '"': { human: () => "Tw / Tc を更新してから次行で文字列を描画します。", technical: "Move to next line; show with word/char spacing." },
  Tc: { human: (o) => `字間を ${formatNumber(o[0])} に設定します。`, technical: "Set character spacing." },
  Tw: { human: (o) => `単語間隔を ${formatNumber(o[0])} に設定します。`, technical: "Set word spacing." },
  Tz: { human: (o) => `水平スケールを ${formatNumber(o[0])}% に設定します。`, technical: "Set horizontal scaling." },
  TL: { human: (o) => `行送りを ${formatNumber(o[0])} に設定します。`, technical: "Set leading." },
  Tr: { human: (o) => `テキスト描画モードを ${formatNumber(o[0])} に設定します。`, technical: "Set text rendering mode." },
  Ts: { human: (o) => `テキストの上下オフセット(rise)を ${formatNumber(o[0])} に設定します。`, technical: "Set text rise." },
  Td: { human: (o) => `テキスト位置を (${formatNumber(o[0])}, ${formatNumber(o[1])}) ずらします。`, technical: "Move text position." },
  TD: { human: () => `テキスト位置をずらし、行送り(leading)も更新します。`, technical: "Move text position; set leading." },
  Tm: { human: (o) => `テキスト行列を ${formatMatrix(o)} に設定します。`, technical: "Set text matrix and line matrix." },
  "T*": { human: () => "次の行へ移動します。", technical: "Move to start of next line." },

  // color
  G: { human: (o) => `ストローク色をグレースケール ${formatNumber(o[0])} に設定します。`, technical: "Set stroking gray." },
  g: { human: (o) => `塗り色をグレースケール ${formatNumber(o[0])} に設定します。`, technical: "Set non-stroking gray." },
  RG: {
    human: (o) =>
      `ストローク色を RGB (${formatNumber(o[0])}, ${formatNumber(o[1])}, ${formatNumber(o[2])}) に設定します。`,
    technical: "Set stroking RGB color.",
  },
  rg: {
    human: (o) =>
      `塗り色を RGB (${formatNumber(o[0])}, ${formatNumber(o[1])}, ${formatNumber(o[2])}) に設定します。`,
    technical: "Set non-stroking RGB color.",
  },
  K: { human: () => "ストローク色を CMYK で設定します。", technical: "Set stroking CMYK color." },
  k: { human: () => "塗り色を CMYK で設定します。", technical: "Set non-stroking CMYK color." },
  CS: { human: (o) => `ストローク色空間を ${formatName(o[0])} に設定します。`, technical: "Set stroking color space." },
  cs: { human: (o) => `塗り色空間を ${formatName(o[0])} に設定します。`, technical: "Set non-stroking color space." },
  SCN: { human: () => "拡張ストローク色を設定します。", technical: "Set stroking color (extended)." },
  scn: { human: () => "拡張塗り色を設定します。", technical: "Set non-stroking color (extended)." },

  // xobject
  Do: {
    human: (o) =>
      `XObject ${formatName(o[0])} を現在の CTM に従って描画します。画像やフォームを差し込みます。`,
    technical: "Draw external object (image or form).",
    specSection: "§8.8",
  },

  // shadings
  sh: { human: (o) => `シェーディング ${formatName(o[0])} を描画します。`, technical: "Paint shading." },

  // marked content
  BMC: { human: (o) => `マーク済みコンテンツ ${formatName(o[0])} を開始します。`, technical: "Begin marked content." },
  BDC: { human: (o) => `属性つきマーク済みコンテンツ ${formatName(o[0])} を開始します。`, technical: "Begin marked content with property list." },
  EMC: { human: () => "マーク済みコンテンツを終了します。", technical: "End marked content." },
  MP: { human: (o) => `マーキングポイント ${formatName(o[0])} を記録します。`, technical: "Marked point." },
  DP: { human: (o) => `属性つきマーキングポイント ${formatName(o[0])} を記録します。`, technical: "Marked point with property list." },

  // inline image
  "BI/EI": {
    human: () => "インライン画像を描画します(BI…ID…EI のひとかたまり)。",
    technical: "Inline image (combined BI/ID/EI).",
  },
};

export function explainOperator(op: PdfOperation): OperatorExplanation {
  const info = TABLE[op.operator];
  if (info) {
    return {
      human: info.human(op.operands),
      technical: info.technical,
      specSection: info.specSection,
    };
  }
  return {
    human: `演算子 "${op.operator}" の説明はまだ用意されていません。`,
    technical: `Operator ${op.operator} is not yet documented.`,
  };
}

function formatNumber(value: PdfValue | undefined): string {
  if (!value) return "?";
  if (value.kind === "int" || value.kind === "real") return String(value.value);
  return "?";
}

function formatName(value: PdfValue | undefined): string {
  if (!value || value.kind !== "name") return "?";
  return `/${value.value}`;
}

function formatMatrix(operands: PdfValue[]): string {
  if (operands.length < 6) return "[?]";
  return `[${operands
    .slice(0, 6)
    .map(formatNumber)
    .join(" ")}]`;
}

function describeString(value: PdfValue | undefined): string {
  if (!value || value.kind !== "string") return "(?)";
  // ASCII printable summary; non-printable bytes get '·'.
  let text = "";
  for (let i = 0; i < Math.min(value.raw.length, 64); i++) {
    const b = value.raw[i] ?? 0;
    text += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "·";
  }
  return `(${text}${value.raw.length > 64 ? "…" : ""})`;
}
