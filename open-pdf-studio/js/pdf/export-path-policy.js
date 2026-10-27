// Paths that an automation client (MCP or an extension) may name for files the
// app writes from untrusted bytes, or reads into a document. Pure and
// platform-independent; the desktop writer checks the same rules again on
// the resolved path (src-tauri/src/export_policy.rs).

/** Document, image and data types. Anything else (programs, scripts, shortcuts, web pages) is refused. */
export const SAFE_EXTENSIONS = new Set([
  'pdf', 'fdf', 'xfdf', 'txt', 'csv', 'tsv', 'json', 'xml', 'md', 'rtf', 'log',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'odg',
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'heic',
  'dwg', 'dxf', 'dwf', 'ifc', 'ifczip', 'bcf', 'bcfzip', 'stp', 'step', 'igs', 'iges', 'stl', 'obj', 'skp', '3dm', 'rvt', 'nwd',
  'zip', '7z', 'eml', 'msg', 'mp3', 'wav', 'mp4', 'mov', 'avi',
]);

// Folders whose contents run at sign-in or boot.
const AUTOSTART = [
  ['programs', 'startup'],
  ['.config', 'autostart'],
  ['etc', 'xdg', 'autostart'],
  ['library', 'launchagents'],
  ['library', 'launchdaemons'],
  ['etc', 'init.d'],
  ['etc', 'systemd'],
  ['.config', 'systemd'],
];

function segments(path) {
  const out = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop(); else out.push(part.toLowerCase());
  }
  return out;
}

function contains(list, run) {
  for (let i = 0; i + run.length <= list.length; i++) if (run.every((s, j) => list[i + j] === s)) return true;
  return false;
}

function shapeProblem(path) {
  if (typeof path !== 'string' || !path.trim()) return 'OUTPUT_PATH_REQUIRED';
  if (/[\x00-\x1f]/.test(path)) return 'UNSAFE_PATH';
  // Device, UNC and network paths: no remote shares, no namespace tricks.
  if (/^[\\/]{2}/.test(path)) return 'UNSAFE_PATH';
  const windows = /^[a-zA-Z]:[\\/]/.test(path);
  if (!windows && !path.startsWith('/')) return 'ABSOLUTE_PATH_REQUIRED';
  // A colon after the drive names an alternate data stream.
  if (path.slice(windows ? 2 : 0).includes(':')) return 'UNSAFE_PATH';
  const name = path.split(/[\\/]/).pop();
  // Windows drops trailing dots and spaces: "a.exe." is written as "a.exe".
  if (!name || /[. ]$/.test(name)) return 'UNSAFE_PATH';
  return null;
}

function extensionProblem(path) {
  const name = path.split(/[\\/]/).pop();
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return SAFE_EXTENSIONS.has(ext) ? null : 'BLOCKED_EXTENSION';
}

/** Problem code for writing an exported component to `path`, or null when allowed. */
export function exportPathProblem(path) {
  const shape = shapeProblem(path);
  if (shape) return shape;
  const dirs = segments(path).slice(0, -1);
  if (AUTOSTART.some((run) => contains(dirs, run))) return 'AUTOSTART_LOCATION';
  return extensionProblem(path);
}

/** Problem code for reading `path` into a collection on behalf of an automation client, or null. */
export function inputPathProblem(path) {
  return shapeProblem(path) || extensionProblem(path);
}
