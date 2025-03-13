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

  // Copy main PDF.js files - using legacy build for better compatibility
  copyFile(
    path.join(sourceBase, "legacy/build/pdf.worker.js"),
    path.join(destBase, "pdf.worker.js")
  );

  copyFile(
    path.join(sourceBase, "legacy/build/pdf.js"),
    path.join(destBase, "pdf.js")
  );

  // Also copy the minified versions which might be more efficient
  copyFile(
    path.join(sourceBase, "legacy/build/pdf.worker.min.js"),
    path.join(destBase, "pdf.worker.min.js")
  );

  copyFile(
    path.join(sourceBase, "legacy/build/pdf.min.js"),
    path.join(destBase, "pdf.min.js")
  );

  // Copy ALL common CMap files to ensure proper text rendering
  const cmapsDir = path.join(sourceBase, "cmaps");
  const cmapFiles = fs.readdirSync(cmapsDir);

  cmapFiles.forEach((file) => {
    copyFile(path.join(cmapsDir, file), path.join(destBase, "cmaps", file));
  });

  // Copy ALL standard fonts
  const fontsDir = path.join(sourceBase, "standard_fonts");
  const fontFiles = fs.readdirSync(fontsDir);

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
