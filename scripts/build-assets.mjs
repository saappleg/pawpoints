import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.join(projectRoot, 'assets');
const mode = process.argv[2] || 'all';

if (!['all', 'css', 'js'].includes(mode)) {
    throw new Error('Build mode must be one of: all, css, js.');
}

const targets = [path.join(projectRoot, 'index.html'), path.join(projectRoot, 'sw.js')];

async function run(binary, args) {
    const { stdout, stderr } = await execFileAsync(binary, args, { cwd: projectRoot });
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
}

async function fingerprint(tempName, prefix, extension) {
    const tempPath = path.join(assetsDir, tempName);
    const bytes = await readFile(tempPath);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const fileName = `${prefix}.${hash}.min.${extension}`;
    const outputPath = path.join(assetsDir, fileName);

    try {
        await rename(tempPath, outputPath);
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await unlink(tempPath);
    }

    const generatedPattern = new RegExp(`^${prefix}\\.(?:v\\d+|[a-f0-9]{12})\\.min\\.${extension}$`);
    for (const existing of await readdir(assetsDir)) {
        if (existing !== fileName && generatedPattern.test(existing)) {
            await unlink(path.join(assetsDir, existing));
        }
    }

    const referencePattern = new RegExp(`assets/${prefix}\\.(?:v\\d+|[a-f0-9]{12})\\.min\\.${extension}`, 'g');
    for (const target of targets) {
        const source = await readFile(target, 'utf8');
        const updated = source.replace(referencePattern, `assets/${fileName}`);
        if (updated !== source) await writeFile(target, updated);
    }

    return fileName;
}

const results = [];

if (mode === 'all' || mode === 'css') {
    const tempName = '.styles.build.css';
    await run(path.join(projectRoot, 'node_modules/.bin/tailwindcss'), [
        '-i', './input.css', '-o', `./assets/${tempName}`, '--minify'
    ]);
    results.push(await fingerprint(tempName, 'styles', 'css'));
}

if (mode === 'all' || mode === 'js') {
    const tempName = '.app.build.js';
    await run(path.join(projectRoot, 'node_modules/.bin/esbuild'), [
        './src/app.js', '--bundle', '--minify', '--target=es2020', `--outfile=./assets/${tempName}`
    ]);
    results.push(await fingerprint(tempName, 'app', 'js'));
}

console.log(`Built ${results.join(' and ')}`);
