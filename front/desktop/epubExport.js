const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Directories to skip
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', '.env', 'env', '.cache', '.turbo',
  'coverage', '.nyc_output', '.parcel-cache', '.webpack', 'vendor',
  'bower_components', '.idea', '.vscode', '.DS_Store', 'tmp', '.tmp',
]);

function shouldSkipDir(name) {
  return name.startsWith('.') || IGNORED_DIRS.has(name);
}

// Collect all .md files in directory recursively
function collectMdFiles(dirPath, relativeTo = dirPath) {
  const files = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (entry.isDirectory() && shouldSkipDir(entry.name)) continue;
    if (!entry.isDirectory() && entry.name.startsWith('.')) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectMdFiles(fullPath, relativeTo));
    } else if (entry.name.endsWith('.md')) {
      files.push({
        path: fullPath,
        relativePath: path.relative(relativeTo, fullPath),
        name: entry.name.replace('.md', ''),
        depth: path.relative(relativeTo, fullPath).split(path.sep).length - 1,
      });
    }
  }

  return files;
}

// Generate CSS optimized for e-ink
function generateEinkCSS() {
  return `
/* E-ink optimized styles for e-readers */
body {
  font-family: Georgia, serif;
  font-size: 1em;
  line-height: 1.6;
  text-align: justify;
  margin: 0;
  padding: 0;
}

h1, h2, h3, h4, h5, h6 {
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-weight: bold;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  page-break-after: avoid;
}

h1 {
  font-size: 1.8em;
  border-bottom: 2px solid #000;
  padding-bottom: 0.3em;
  margin-top: 2em;
}

h2 {
  font-size: 1.4em;
  border-bottom: 1px solid #666;
  padding-bottom: 0.2em;
}

h3 {
  font-size: 1.2em;
}

h4, h5, h6 {
  font-size: 1em;
}

p {
  margin: 0.8em 0;
  text-indent: 0;
}

/* Code blocks - high contrast for e-ink */
pre, code {
  font-family: "Courier New", Courier, monospace;
  font-size: 0.85em;
}

pre {
  background-color: #f0f0f0;
  border: 1px solid #333;
  padding: 0.8em;
  margin: 1em 0;
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
  page-break-inside: avoid;
}

code {
  background-color: #e8e8e8;
  padding: 0.1em 0.3em;
  border-radius: 2px;
}

pre code {
  background: none;
  padding: 0;
}

/* Lists */
ul, ol {
  margin: 0.8em 0;
  padding-left: 1.5em;
}

li {
  margin: 0.3em 0;
}

/* Blockquotes */
blockquote {
  margin: 1em 0;
  padding: 0.5em 1em;
  border-left: 4px solid #333;
  font-style: italic;
  background-color: #f5f5f5;
}

/* Tables */
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  font-size: 0.9em;
}

th, td {
  border: 1px solid #333;
  padding: 0.5em;
  text-align: left;
}

th {
  background-color: #e0e0e0;
  font-weight: bold;
}

tr:nth-child(even) {
  background-color: #f5f5f5;
}

/* Links - no color, just underline for e-ink */
a {
  color: inherit;
  text-decoration: underline;
}

/* Images */
img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 1em auto;
}

/* Horizontal rule */
hr {
  border: none;
  border-top: 1px solid #666;
  margin: 2em 0;
}

/* Chapter/section breaks */
.chapter-title {
  font-size: 2em;
  text-align: center;
  margin: 2em 0 1em 0;
  page-break-before: always;
}

.file-separator {
  margin: 3em 0;
  text-align: center;
}

.file-separator::before {
  content: "• • •";
  font-size: 1.2em;
  letter-spacing: 0.5em;
}

/* Strong emphasis for e-ink */
strong, b {
  font-weight: bold;
}

em, i {
  font-style: italic;
}

/* Definition lists */
dt {
  font-weight: bold;
  margin-top: 1em;
}

dd {
  margin-left: 1.5em;
  margin-bottom: 0.5em;
}
`;
}

// Combine all MD files into a single document
function combineMarkdownFiles(mdFiles, folderName) {
  let combined = `---
title: "${folderName}"
author: "Lector Export"
language: fr
---

`;

  for (const file of mdFiles) {
    // Add section header based on file structure
    const sectionTitle = file.relativePath.replace('.md', '').replace(/\//g, ' > ');

    // Read file content
    let content = fs.readFileSync(file.path, 'utf-8');

    // Remove any existing YAML frontmatter
    content = content.replace(/^---[\s\S]*?---\n*/m, '');

    // Check if file starts with a heading
    const startsWithHeading = /^#\s/.test(content.trim());

    if (!startsWithHeading) {
      // Add file name as heading if no heading exists
      combined += `\n\n# ${file.name}\n\n`;
    }

    combined += content;
    combined += '\n\n---\n\n'; // Separator between files
  }

  return combined;
}

// Export folder to EPUB using Pandoc
async function exportFolderToEpub(folderPath, outputPath) {
  return new Promise((resolve, reject) => {
    const folderName = path.basename(folderPath);

    // Collect all markdown files
    const mdFiles = collectMdFiles(folderPath);

    if (mdFiles.length === 0) {
      return reject(new Error('Aucun fichier .md trouvé dans ce dossier'));
    }

    // Create temp directory for processing
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-epub-'));
    const combinedMdPath = path.join(tmpDir, 'combined.md');
    const cssPath = path.join(tmpDir, 'eink.css');

    try {
      // Write combined markdown
      const combinedContent = combineMarkdownFiles(mdFiles, folderName);
      fs.writeFileSync(combinedMdPath, combinedContent, 'utf-8');

      // Write CSS
      fs.writeFileSync(cssPath, generateEinkCSS(), 'utf-8');

      // Find pandoc
      const pandocPaths = [
        '/opt/homebrew/bin/pandoc',
        '/usr/local/bin/pandoc',
        '/usr/bin/pandoc',
        'pandoc',
      ];

      let pandocBin = 'pandoc';
      for (const p of pandocPaths) {
        if (p === 'pandoc' || fs.existsSync(p)) {
          pandocBin = p;
          break;
        }
      }

      // Run pandoc
      const args = [
        combinedMdPath,
        '-o', outputPath,
        '--css', cssPath,
        '--epub-embed-font=false',
        '--toc',
        '--toc-depth=3',
        '--metadata', `title=${folderName}`,
        '--metadata', 'lang=fr',
        '-f', 'markdown+smart',
        '--wrap=auto',
      ];

      execFile(pandocBin, args, { timeout: 60000 }, (error, stdout, stderr) => {
        // Cleanup temp files
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {}

        if (error) {
          reject(new Error(`Pandoc error: ${stderr || error.message}`));
        } else {
          resolve({
            success: true,
            outputPath,
            fileCount: mdFiles.length,
            folderName,
          });
        }
      });
    } catch (err) {
      // Cleanup on error
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (e) {}
      reject(err);
    }
  });
}

// Export a single MD file to EPUB
async function exportFileToEpub(filePath, outputPath) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath, '.md');

    if (!fs.existsSync(filePath)) {
      return reject(new Error('Fichier introuvable'));
    }

    // Create temp directory for processing
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-epub-'));
    const cssPath = path.join(tmpDir, 'eink.css');
    const epubPath = path.join(tmpDir, `${fileName}.epub`);

    // Determine output format based on extension
    const outputExt = path.extname(outputPath).toLowerCase();
    const wantsMobi = outputExt === '.mobi' || outputExt === '.azw3';

    try {
      // Write CSS
      fs.writeFileSync(cssPath, generateEinkCSS(), 'utf-8');

      // Find pandoc
      const pandocPaths = [
        '/opt/homebrew/bin/pandoc',
        '/usr/local/bin/pandoc',
        '/usr/bin/pandoc',
        'pandoc',
      ];

      let pandocBin = 'pandoc';
      for (const p of pandocPaths) {
        if (p === 'pandoc' || fs.existsSync(p)) {
          pandocBin = p;
          break;
        }
      }

      // First create EPUB with pandoc
      const pandocOutput = wantsMobi ? epubPath : outputPath;
      const args = [
        filePath,
        '-o', pandocOutput,
        '--css', cssPath,
        '--epub-embed-font=false',
        '--toc',
        '--toc-depth=3',
        '--metadata', `title=${fileName}`,
        '--metadata', 'lang=fr',
        '-f', 'markdown+smart',
        '--wrap=auto',
      ];

      execFile(pandocBin, args, { timeout: 60000 }, (error, stdout, stderr) => {
        if (error) {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
          return reject(new Error(`Pandoc error: ${stderr || error.message}`));
        }

        // If MOBI requested, convert with ebook-convert
        if (wantsMobi) {
          const ebookConvertPaths = [
            '/opt/homebrew/bin/ebook-convert',
            '/usr/local/bin/ebook-convert',
            '/Applications/calibre.app/Contents/MacOS/ebook-convert',
          ];

          let convertBin = 'ebook-convert';
          for (const p of ebookConvertPaths) {
            if (fs.existsSync(p)) {
              convertBin = p;
              break;
            }
          }

          execFile(convertBin, [epubPath, outputPath], { timeout: 120000 }, (convError, convStdout, convStderr) => {
            // Cleanup
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}

            if (convError) {
              reject(new Error(`Conversion MOBI error: ${convStderr || convError.message}`));
            } else {
              resolve({ success: true, outputPath, fileName });
            }
          });
        } else {
          // EPUB output - cleanup and resolve
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
          resolve({ success: true, outputPath, fileName });
        }
      });
    } catch (err) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
      reject(err);
    }
  });
}

module.exports = {
  exportFolderToEpub,
  exportFileToEpub,
  collectMdFiles,
};
