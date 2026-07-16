import { access, readFile } from "node:fs/promises";
import process from "node:process";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const versions = JSON.parse(await readFile("versions.json", "utf8"));
const requestedTag = process.argv[2];
const errors = [];

if (manifest.id !== "ink-layer") {
  errors.push(`manifest id must remain ink-layer for update compatibility: ${manifest.id}`);
}
if (manifest.name !== "Inkplane") {
  errors.push(`manifest name must be Inkplane: ${manifest.name}`);
}
if (packageJson.name !== "inkplane" || packageLock.name !== "inkplane" || packageLock.packages?.[""]?.name !== "inkplane") {
  errors.push("package metadata must use the Inkplane brand");
}
if (packageJson.version !== manifest.version) {
  errors.push(`package.json is ${packageJson.version}, but manifest.json is ${manifest.version}`);
}
if (packageLock.version !== manifest.version || packageLock.packages?.[""]?.version !== manifest.version) {
  errors.push(`package-lock.json does not match ${manifest.version}`);
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  errors.push(
    `versions.json must map ${manifest.version} to minimum Obsidian ${manifest.minAppVersion}`
  );
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
  errors.push(`manifest version must use x.y.z format: ${manifest.version}`);
}
if (requestedTag && requestedTag !== manifest.version) {
  errors.push(`release tag ${requestedTag} does not match manifest version ${manifest.version}`);
}

for (const filename of ["main.js", "manifest.json", "styles.css"]) {
  try {
    await access(filename);
  } catch {
    errors.push(`missing release asset: ${filename}`);
  }
}

if (errors.length > 0) {
  throw new Error(`Release validation failed:\n- ${errors.join("\n- ")}`);
}

process.stdout.write(`Release ${manifest.version} is consistent and complete.\n`);
