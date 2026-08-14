const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const bwipjs = require("bwip-js");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const NIP_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function generateMemberCode() {
  return String(crypto.randomInt(0, 10000000)).padStart(7, "0");
}

function generateNip() {
  let nip = "";
  for (let i = 0; i < 9; i++) {
    nip += NIP_CHARS[crypto.randomInt(0, NIP_CHARS.length)];
  }
  return nip;
}

async function makeBarcodePng(text) {
  return bwipjs.toBuffer({
    bcid: "code128",
    text,
    scale: 3,
    height: 12,
    includetext: false,
    backgroundcolor: "FFFFFF",
  });
}

async function makeLogoPng() {
  const svgPath = path.join(__dirname, "..", "public", "logo.svg");
  const svg = fs.readFileSync(svgPath);
  return sharp(svg).resize(120, 120).png().toBuffer();
}

async function buildMemberCardPdf({ firstName, lastName, username, birthdate, memberCode, nip }) {
  const pdfDoc = await PDFDocument.create();
  const width = 85.6 * 2.83465;  // format carte de crédit, en points
  const height = 54 * 2.83465;
  const page = pdfDoc.addPage([width, height]);

  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.07, 0.075, 0.11) });
  page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: rgb(0.878, 0.663, 0.29) });

  // Code-barres en haut (encode le code membre)
  const barcodePng = await makeBarcodePng(memberCode);
  const barcodeImg = await pdfDoc.embedPng(barcodePng);
  const bcDims = barcodeImg.scale(0.35);
  page.drawImage(barcodeImg, {
    x: width - bcDims.width - 10,
    y: height - bcDims.height - 14,
    width: bcDims.width,
    height: bcDims.height,
  });

  // Logo
  const logoPng = await makeLogoPng();
  const logoImg = await pdfDoc.embedPng(logoPng);
  page.drawImage(logoImg, { x: 10, y: height - 32, width: 22, height: 22 });
  page.drawText("CLAURC", { x: 36, y: height - 24, size: 11, font, color: rgb(1, 1, 1) });
  page.drawText("CARTE DE MEMBRE", { x: 36, y: height - 34, size: 6, font: fontRegular, color: rgb(0.6, 0.62, 0.7) });

  // Infos utilisateur
  let y = height - 55;
  const line = (label, value, size = 8) => {
    page.drawText(label, { x: 10, y, size: 6, font: fontRegular, color: rgb(0.6, 0.62, 0.7) });
    page.drawText(value, { x: 10, y: y - 9, size, font, color: rgb(1, 1, 1) });
    y -= 22;
  };
  line("NOM COMPLET", `${firstName} ${lastName}`.toUpperCase());
  line("NOM D'UTILISATEUR", `@${username}`);
  line("DATE DE NAISSANCE", birthdate);

  // Code principal, bien visible, en bas
  page.drawText("CODE MEMBRE", { x: 10, y: 16, size: 6, font: fontRegular, color: rgb(0.6, 0.62, 0.7) });
  page.drawText(memberCode.match(/.{1}/g).join(" "), { x: 10, y: 6, size: 11, font, color: rgb(0.878, 0.663, 0.29) });

  // NIP discret, en petit, à côté
  page.drawText(`NIP: ${nip}`, { x: width - 72, y: 6, size: 5, font: fontRegular, color: rgb(0.35, 0.36, 0.42) });

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generateMemberCode, generateNip, buildMemberCardPdf };
