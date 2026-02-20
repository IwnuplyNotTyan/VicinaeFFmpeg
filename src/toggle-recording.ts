import { showHUD, getPreferenceValues } from "@raycast/api";
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PID_FILE = path.join(os.tmpdir(), "raycast-ffmpeg.pid");
const LOG_FILE = path.join(os.homedir(), "Desktop", "ffmpeg-recording.log");

interface Preferences {
  outputDir: string;
  inputDevice: string;
  audioDevice: string;
  fps: string;
  resolution: string;
}

function isRecording(): boolean {
  if (!fs.existsSync(PID_FILE)) return false;
  const pid = fs.readFileSync(PID_FILE, "utf8").trim();
  try {
    execSync(`kill -0 ${pid}`, { stdio: "ignore" });
    return true;
  } catch {
    fs.unlinkSync(PID_FILE);
    return false;
  }
}

function stopRecording(): void {
  const pid = fs.readFileSync(PID_FILE, "utf8").trim();
  try {
    // Send 'q' to ffmpeg to gracefully stop and finalize the file
    execSync(`kill -INT ${pid}`);
  } catch {
    // Process already dead
  }
  if (fs.existsSync(PID_FILE)) {
    fs.unlinkSync(PID_FILE);
  }
}

function startRecording(prefs: Preferences): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputDir = prefs.outputDir || path.join(os.homedir(), "Desktop");
  const outputFile = path.join(outputDir, `recording-${timestamp}.mp4`);

  // macOS screen capture with optional audio
  // Adjust these ffmpeg args for your setup
  const args = [
    "-f", "avfoundation",
    "-framerate", prefs.fps || "30",
    "-capture_cursor", "1",
    "-i", `${prefs.inputDevice || "1"}:${prefs.audioDevice || "0"}`,
    "-vcodec", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-acodec", "aac",
    outputFile,
  ];

  const child = spawn("ffmpeg", args, {
    detached: true,
    stdio: ["ignore", fs.openSync(LOG_FILE, "w"), fs.openSync(LOG_FILE, "a")],
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
}

export default async function main() {
  const prefs = getPreferenceValues<Preferences>();

  if (isRecording()) {
    stopRecording();
    await showHUD("⏹ Recording stopped — file saved to Desktop");
  } else {
    try {
      startRecording(prefs);
      await showHUD("🔴 Recording started");
    } catch (e) {
      await showHUD(`❌ Failed to start: ${e}`);
    }
  }
}
