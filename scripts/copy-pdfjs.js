import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define source and destination directories
const sourceBase = path.resolve(__dirname, "../node_modules/pdfjs-dist");
const destBase = path.resolve(__dirname, "../public/pdfjs");

// Create destination directories
function createDirectory(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

// Copy a file
function copyFile(source, dest) {
  try {
    fs.copyFileSync(source, dest);
    console.log(`Copied: ${source} -> ${dest}`);
  } catch (err) {
    console.error(`Error copying ${source}:`, err);
  }
}

// Main function to copy PDF.js files
function copyPDFJSFiles() {
  console.log("Starting to copy PDF.js files to public directory...");

  // Create main directories
  createDirectory(destBase);
  createDirectory(path.join(destBase, "cmaps"));
  createDirectory(path.join(destBase, "standard_fonts"));

  // Copy main PDF.js files
  copyFile(
    path.join(sourceBase, "legacy/build/pdf.worker.mjs"),
    path.join(destBase, "pdf.worker.js")
  );

  copyFile(
    path.join(sourceBase, "legacy/build/pdf.mjs"),
    path.join(destBase, "pdf.js")
  );

  // Copy common CMap files
  const cmapFiles = [
    "Adobe-GB1-UCS2.bcmap",
    "Adobe-CNS1-UCS2.bcmap",
    "Adobe-Japan1-UCS2.bcmap",
    "Adobe-Korea1-UCS2.bcmap",
  ];

  cmapFiles.forEach((file) => {
    copyFile(
      path.join(sourceBase, "cmaps", file),
      path.join(destBase, "cmaps", file)
    );
  });

  // Copy standard fonts
  const fontsDir = path.join(sourceBase, "standard_fonts");
  const fontFiles = fs.readdirSync(fontsDir).slice(0, 5); // Just copy a few common fonts

  fontFiles.forEach((file) => {
    copyFile(
      path.join(fontsDir, file),
      path.join(destBase, "standard_fonts", file)
    );
  });

  console.log("PDF.js files successfully copied to public directory.");
}

// Run the copy function
copyPDFJSFiles();
