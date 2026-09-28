const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

/**
 * Turn electron-builder's `--dir` output into ONE self-extracting exe — IN PLACE.
 *
 * Same technique as hsc-cop-viewer's scripts/make-portable.js (see that file for
 * the fuller write-up); adapted here because it solves the same problem this
 * project has: `electron-builder`'s NSIS installer target needs a one-time
 * network download of the NSIS toolchain (not an npm dependency), so a client
 * machine with no internet cannot run `yarn package` to completion. Building
 * the plain unpacked directory (`--dir`) never touches NSIS at all — Electron
 * itself was already fetched during `yarn install` — so nothing here needs the
 * network, by construction.
 *
 * Before (electron-builder --dir output):     After (what this script leaves):
 *   release\win-unpacked\                       release\GIS DD-MM-YYYY HH.MM\
 *     GIS.exe (~200 MB) *.dll *.pak resources\     GIS.exe   <- the ONLY file
 *
 * The runtime clutter is zipped INTO the exe and then DELETED from the folder,
 * so the folder holds exactly one file. Double-click:
 *   1. a thin dark splash appears (wording configurable in SPLASH_TEXT below);
 *   2. FIRST launch of a build only: the embedded app is extracted to
 *      %LOCALAPPDATA%\GIS\app-<build stamp>\ with a live file count (this app
 *      unpacks ~30k files, so it takes a few minutes), then a ".ready" marker
 *      is written;
 *   3. every later launch finds the marker and starts the app immediately;
 *   4. the splash closes as soon as the app window appears, previous builds'
 *      folders are removed, and the launcher exits — the app runs on its own.
 *
 * This app reads its tiles from the fixed `Documents\tiles` folder (not from
 * beside the exe — see Desktop Setup.html), so unlike hsc-cop-viewer's launcher
 * this one does not need to tell the child process where it was launched from.
 *
 * Toolchain, both already local, nothing downloaded:
 *   - the launcher itself: plain C# compiled with csc.exe, the .NET Framework
 *     compiler that ships on every Windows install;
 *   - compression: 7za.exe from the 7zip-bin package (electron-builder already
 *     depends on it), deflate level 9, embedded as a .NET resource and read
 *     back at runtime with .NET's built-in ZipArchive.
 *
 * Usage:  node scripts/make-portable.cjs ["path\to\win-unpacked"]
 * Defaults to release/win-unpacked (electron-builder's --dir output).
 */

const REPO_ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
);
/** Single source of truth: electron-builder names the exe after this already. */
const APP_NAME = pkg.build.productName;
const APP_EXE = `${APP_NAME}.exe`;
const APP_TEMP_DIR_PREFIX = APP_NAME.replace(/\s+/g, "");
const RESOURCE_NAME = "app.zip";

// ---- Splash-screen wording. Edit here if the client wants different text. ----
// `progress` is shown during the one-time first-launch extraction; {done} and
// {total} are replaced with the live file counts.
const SPLASH_TEXT = {
  title: APP_NAME.toUpperCase().split("").join("  "),
  firstRun: "Setting up for first use. This happens only once and can take a few minutes.",
  progress: "First-time setup: {done} of {total} files",
  starting: "Starting...",
};

/** JS string -> C# string literal (quotes, backslashes and non-ASCII escaped). */
function csStr(s) {
  return JSON.stringify(String(s)).replace(/[-￿]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}
const progressFormat = SPLASH_TEXT.progress.replace("{done}", "{0}").replace("{total}", "{1}");

function findCsc() {
  const win = process.env.WINDIR || "C:\\Windows";
  const candidates = [
    path.join(win, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.join(win, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function find7za() {
  const candidates = [
    path.join(REPO_ROOT, "node_modules", "7zip-bin", "win", "x64", "7za.exe"),
    path.join(REPO_ROOT, "node_modules", "7zip-bin", "win", "ia32", "7za.exe"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function istStamp() {
  // IST (UTC+5:30) regardless of the build machine's own timezone, so build
  // folder names are consistent no matter who runs the build.
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${pad(now.getUTCDate())}-${pad(now.getUTCMonth() + 1)}-${now.getUTCFullYear()} ` +
    `${pad(now.getUTCHours())}.${pad(now.getUTCMinutes())}`
  );
}
// One stamp per build: names the output folder AND identifies this build's
// extracted copy on the client machine (see BuildId in the launcher).
const BUILD_STAMP = istStamp();

// The launcher. Extraction + launch run on a worker thread so the splash's
// message loop keeps painting. The splash is closed the moment the child's main
// window exists (so there is no gap and no white frame); the launcher then
// removes previous builds' folders and exits, leaving the app running.
const launcherSource = `
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

class Splash : Form {
    // Wording comes from SPLASH_TEXT at the top of scripts/make-portable.cjs.
    const string ProgressText = ${csStr(progressFormat)};
    readonly ProgressBar bar;
    readonly Label sub;

    public Splash() {
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(420, 150);
        BackColor = Color.FromArgb(10, 13, 19);
        TopMost = true;
        ShowInTaskbar = false;

        Label title = new Label();
        title.Text = ${csStr(SPLASH_TEXT.title)};
        title.ForeColor = Color.FromArgb(234, 243, 240);
        title.Font = new Font("Segoe UI", 13f, FontStyle.Bold);
        title.TextAlign = ContentAlignment.MiddleCenter;
        title.Dock = DockStyle.Top;
        title.Height = 62;
        title.Padding = new Padding(0, 22, 0, 0);

        bar = new ProgressBar();
        bar.Style = ProgressBarStyle.Marquee;
        bar.MarqueeAnimationSpeed = 25;
        bar.Height = 5;
        bar.Width = 240;
        bar.Left = (Width - bar.Width) / 2;
        bar.Top = 84;

        sub = new Label();
        sub.ForeColor = Color.FromArgb(90, 167, 160);
        sub.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
        sub.TextAlign = ContentAlignment.MiddleCenter;
        sub.Dock = DockStyle.Bottom;
        sub.Height = 48;
        sub.Padding = new Padding(12, 0, 12, 6);

        Controls.Add(title);
        Controls.Add(bar);
        Controls.Add(sub);
    }

    // Both are safe to call from the worker thread.
    public void SetStatus(string text) {
        Post(delegate() { sub.Text = text; });
    }
    public void SetProgress(int done, int total) {
        Post(delegate() {
            if (bar.Style != ProgressBarStyle.Continuous) {
                bar.Style = ProgressBarStyle.Continuous;
                bar.Minimum = 0;
                bar.Maximum = total;
            }
            int v = Math.Min(done, total);
            // Vista+ animates the bar one step behind; stepping back makes it exact.
            if (v < total) bar.Value = v + 1;
            bar.Value = v;
            sub.Text = string.Format(ProgressText, done.ToString("N0"), total.ToString("N0"));
        });
    }
    void Post(Action a) {
        try {
            if (IsDisposed) return;
            if (InvokeRequired) BeginInvoke(a); else a();
        } catch { }
    }
    // 1px hairline border so the dark card reads against dark desktops.
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e);
        using (Pen p = new Pen(Color.FromArgb(40, 90, 200, 255)))
            e.Graphics.DrawRectangle(p, 0, 0, Width - 1, Height - 1);
    }
}

class Launcher {
    const string AppExe = "${APP_EXE}";
    // Stamped at build time: each build extracts into its own folder, so an
    // updated exe never runs against a previous build's files.
    const string BuildId = "${BUILD_STAMP}";
    const string FirstRunText = ${csStr(SPLASH_TEXT.firstRun)};
    const string StartingText = ${csStr(SPLASH_TEXT.starting)};

    // electron-builder's asarUnpack config for this app spills the whole
    // node_modules tree onto disk (including some deeply nested Android/Gradle
    // build-artifact paths well over 150 characters on their own), so a naive
    // extraction under a %TEMP% guid folder can exceed Windows' classic
    // 260-char MAX_PATH. The fix is the standard Win32 "\\\\?\\" long-path
    // escape prefix — but it only works through RAW Win32 calls. Classic .NET
    // Framework's own managed System.IO (Directory.CreateDirectory, the
    // FileStream(string, ...) constructor, Directory.Delete) pre-validates
    // path length and REJECTS the "\\\\?\\" prefix outright as "illegal
    // characters" before the OS ever sees it — confirmed by direct testing,
    // not assumed. So every filesystem call below goes through P/Invoke
    // (CreateDirectoryW / CreateFileW) or an external "cmd /c rd" for cleanup,
    // neither of which is subject to that managed pre-validation.

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateDirectoryW(string lpPathName, IntPtr lpSecurityAttributes);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern SafeFileHandle CreateFileW(
        string lpFileName, uint dwDesiredAccess, uint dwShareMode,
        IntPtr lpSecurityAttributes, uint dwCreationDisposition,
        uint dwFlagsAndAttributes, IntPtr hTemplateFile);

    const uint GENERIC_WRITE = 0x40000000;
    const uint CREATE_ALWAYS = 2;
    const uint FILE_ATTRIBUTE_NORMAL = 0x80;
    const uint ERROR_ALREADY_EXISTS = 183;

    static string LongPath(string path) {
        return path.StartsWith(@"\\\\?\\") ? path : @"\\\\?\\" + path;
    }

    static void RemoveDir(string dir) {
        // Used for a half-extracted folder and for previous builds' folders.
        // "cmd /c rd" is a real Win32 process making its own OS calls, so —
        // unlike Directory.Delete — it isn't subject to .NET Framework's
        // managed path-length pre-validation, and correctly handles the long
        // paths this app's asarUnpack layout produces.
        string args = "/c rd /s /q \\\"" + LongPath(dir) + "\\\"";
        try {
            ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            // No timeout: deleting this many files can legitimately take a
            // while, and a second concurrent rd would only fight the first.
            using (Process p = Process.Start(psi)) p.WaitForExit();
        } catch { }
    }

    // Every directory this run has already created (or confirmed exists), so
    // repeated files under the same folder don't re-issue CreateDirectoryW.
    static readonly HashSet<string> knownDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

    // CreateDirectoryW does not create intermediate directories, so walk the
    // relative path segment by segment, always passing the FULL long-prefixed
    // path built so far.
    static void EnsureDir(string longFullDirPath) {
        string start = longFullDirPath.TrimEnd(Path.DirectorySeparatorChar);
        if (knownDirs.Contains(start)) return;
        List<string> toCreate = new List<string>();
        string cur = start;
        while (!knownDirs.Contains(cur)) {
            // Never try to create the drive root itself (CreateDirectoryW on
            // it fails with ERROR_ACCESS_DENIED rather than ALREADY_EXISTS).
            int slash = cur.LastIndexOf(Path.DirectorySeparatorChar);
            if (slash < 0 || cur.EndsWith(":")) break;
            toCreate.Add(cur);
            cur = cur.Substring(0, slash);
        }
        toCreate.Reverse();
        foreach (string dir in toCreate) {
            if (!CreateDirectoryW(dir, IntPtr.Zero)) {
                int err = Marshal.GetLastWin32Error();
                if (err != (int)ERROR_ALREADY_EXISTS) {
                    throw new IOException("CreateDirectoryW failed for " + dir + " (error " + err + ")");
                }
            }
            knownDirs.Add(dir);
        }
    }

    // Manual entry-by-entry extraction (instead of ZipArchive.ExtractToDirectory,
    // which writes through managed — MAX_PATH-limited — File APIs) so every
    // destination path goes through the P/Invoke calls above, which correctly
    // support the long paths this app's asarUnpack layout produces.
    static void ExtractLong(ZipArchive zip, string destRoot, Action<int, int> progress) {
        int total = zip.Entries.Count;
        int done = 0;
        foreach (ZipArchiveEntry entry in zip.Entries) {
            done++;
            if (progress != null && (done % 200 == 0 || done == total)) progress(done, total);
            string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
            string destPath = LongPath(Path.Combine(destRoot, relative));
            bool isDir = entry.FullName.EndsWith("/") || string.IsNullOrEmpty(entry.Name);
            if (isDir) {
                EnsureDir(destPath);
                continue;
            }
            // Path.GetDirectoryName is a managed path API subject to the
            // same MAX_PATH validation we are working around, so split by hand.
            int lastSep = destPath.LastIndexOf(Path.DirectorySeparatorChar);
            if (lastSep > 0) EnsureDir(destPath.Substring(0, lastSep));

            SafeFileHandle handle = CreateFileW(destPath, GENERIC_WRITE, 0, IntPtr.Zero,
                CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
            if (handle.IsInvalid) {
                throw new IOException("CreateFileW failed for " + destPath + " (error " + Marshal.GetLastWin32Error() + ")");
            }
            using (handle)
            using (Stream entryStream = entry.Open())
            using (FileStream fileStream = new FileStream(handle, FileAccess.Write))
                entryStream.CopyTo(fileStream);
        }
    }

    static string ReadyMarker(string appDir) { return Path.Combine(appDir, ".ready"); }

    // One-time extraction of the embedded app into appDir. The marker is written
    // last, so an interrupted first launch is redone from scratch next time.
    static void ExtractApp(string appDir, Action<int, int> progress) {
        if (Directory.Exists(appDir)) RemoveDir(appDir);
        Directory.CreateDirectory(appDir);
        knownDirs.Add(LongPath(appDir)); // the floor for EnsureDir's parent walk
        using (Stream s = Assembly.GetExecutingAssembly()
                .GetManifestResourceStream("${RESOURCE_NAME}"))
        using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
            ExtractLong(zip, appDir, progress);
        File.WriteAllText(ReadyMarker(appDir), BuildId);
    }

    // Previous builds' folders are dead weight once a newer one is in use.
    static void RemoveOldBuilds(string cacheRoot, string keep) {
        try {
            foreach (string dir in Directory.GetDirectories(cacheRoot, "app-*")) {
                if (!string.Equals(dir, keep, StringComparison.OrdinalIgnoreCase)) RemoveDir(dir);
            }
        } catch { }
    }

    [STAThread]
    static void Main() {
        // Per-user, per-build extraction folder under %LOCALAPPDATA%.
        string cacheRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "${APP_TEMP_DIR_PREFIX}");
        string appDir = Path.Combine(cacheRoot, "app-" + BuildId);
        bool firstRun = !File.Exists(ReadyMarker(appDir));

        Application.EnableVisualStyles();
        Splash splash = new Splash();
        splash.SetStatus(firstRun ? FirstRunText : StartingText);
        IntPtr created = splash.Handle; // so the worker can post UI updates right away
        Process child = null;
        Exception error = null;

        Thread worker = new Thread(delegate() {
            try {
                if (firstRun) {
                    ExtractApp(appDir, splash.SetProgress);
                    splash.SetStatus(StartingText);
                }

                ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(appDir, AppExe));
                psi.WorkingDirectory = appDir;
                psi.UseShellExecute = false;
                child = Process.Start(psi);

                // Hold the splash until the app's window is actually up (max ~30s).
                for (int i = 0; i < 300 && !child.HasExited; i++) {
                    child.Refresh();
                    if (child.MainWindowHandle != IntPtr.Zero) break;
                    Thread.Sleep(100);
                }
            } catch (Exception ex) {
                error = ex;
            }
            try { splash.Invoke((Action)delegate() { splash.Close(); }); } catch { }
        });
        worker.IsBackground = true;
        worker.Start();

        Application.Run(splash); // returns when the worker closes the splash

        if (error != null) {
            MessageBox.Show("Could not start ${APP_NAME}.\\n\\n" + error.Message,
                "${APP_NAME}", MessageBoxButtons.OK, MessageBoxIcon.Error);
            // Never leave a half-extracted folder that a later launch could trust.
            if (!File.Exists(ReadyMarker(appDir))) RemoveDir(appDir);
            return;
        }

        // The app runs on its own from here; the launcher only tidies up and exits.
        RemoveOldBuilds(cacheRoot, appDir);
    }
}
`;

function build(pkgDir) {
  if (!fs.existsSync(path.join(pkgDir, APP_EXE))) {
    console.error(`[portable] packaged app not found: ${path.join(pkgDir, APP_EXE)}`);
    console.error(
      `[portable] run "electron-builder --dir" first (this is what "yarn package" does).`,
    );
    process.exit(1);
  }
  const csc = findCsc();
  if (!csc) {
    console.error("[portable] csc.exe (.NET Framework) not found — cannot build the launcher.");
    process.exit(1);
  }
  const sevenZip = find7za();
  if (!sevenZip) {
    console.error("[portable] 7za.exe not found (node_modules/7zip-bin) — cannot compress.");
    process.exit(1);
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gis-portable-"));
  const zipPath = path.join(work, RESOURCE_NAME);
  const csPath = path.join(work, "launcher.cs");
  const tmpExe = path.join(work, APP_EXE); // compiled here, moved into pkgDir last
  try {
    // 1) Compress the whole app folder (contents at zip root) — deflate level 9.
    console.log("[portable] compressing app folder...");
    execFileSync(
      sevenZip,
      ["a", "-tzip", "-mx=9", "-mmt=on", "-r", zipPath, path.join(pkgDir, "*")],
      { stdio: "pipe" },
    );
    const zipMb = (fs.statSync(zipPath).size / 1048576).toFixed(1);
    console.log(`[portable] app.zip = ${zipMb} MB`);

    // 2) Compile the self-extracting launcher with the zip embedded as a resource.
    fs.writeFileSync(csPath, launcherSource, "utf8");
    const args = [
      "/nologo",
      "/target:winexe",
      "/optimize+",
      "/out:" + tmpExe,
      "/reference:System.Windows.Forms.dll",
      "/reference:System.Drawing.dll",
      "/reference:System.IO.Compression.dll",
      "/reference:System.IO.Compression.FileSystem.dll",
      `/resource:${zipPath},${RESOURCE_NAME}`,
    ];
    const iconPath = path.join(REPO_ROOT, "build", "icon.ico");
    if (fs.existsSync(iconPath)) args.push("/win32icon:" + iconPath);
    args.push(csPath);
    console.log("[portable] compiling launcher (embedding app.zip)...");
    execFileSync(csc, args, { stdio: "pipe" });

    // 3) The clutter now lives inside the exe — wipe it from the folder, then
    //    drop the single launcher in. The folder ends up holding ONE file.
    console.log("[portable] removing the raw runtime files from the folder...");
    for (const entry of fs.readdirSync(pkgDir)) {
      fs.rmSync(path.join(pkgDir, entry), { recursive: true, force: true });
    }
    const finalExe = path.join(pkgDir, APP_EXE);
    fs.copyFileSync(tmpExe, finalExe);

    const exeMb = (fs.statSync(finalExe).size / 1048576).toFixed(1);
    const left = fs.readdirSync(pkgDir);
    console.log(`[portable] wrote ${APP_EXE} (${exeMb} MB)`);
    console.log(`[portable] folder now contains ${left.length} item(s): ${left.join(", ")}`);

    // 4) Rename the folder to a dated build: "<APP_NAME> DD-MM-YYYY HH.MM".
    const datedDir = path.join(path.dirname(pkgDir), `${APP_NAME} ${BUILD_STAMP}`);
    if (fs.existsSync(datedDir)) fs.rmSync(datedDir, { recursive: true, force: true });
    fs.renameSync(pkgDir, datedDir);
    console.log(`[portable] build folder: ${datedDir}`);

    // 5) electron-builder drops its own debug/config dumps next to the output;
    //    they are not part of the deliverable.
    for (const stray of ["builder-debug.yml", "builder-effective-config.yaml"]) {
      fs.rmSync(path.join(path.dirname(pkgDir), stray), { force: true });
    }
  } catch (e) {
    const detail = e.stdout ? e.stdout.toString() : "";
    const detailErr = e.stderr ? e.stderr.toString() : "";
    console.error("[portable] build failed:", e.message, detail, detailErr);
    process.exit(1);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (require.main === module) {
  build(process.argv[2] || path.join(REPO_ROOT, "release", "win-unpacked"));
}

module.exports = { launcherSource, APP_EXE, RESOURCE_NAME, BUILD_STAMP };
