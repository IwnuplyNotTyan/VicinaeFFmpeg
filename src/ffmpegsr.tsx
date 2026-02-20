import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  showToast,
  Toast,
  getPreferenceValues,
} from "@raycast/api";
import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { useState, useEffect } from "react";

const PID_FILE = path.join(os.tmpdir(), "raycast-ffmpeg.pid");
const LOG_FILE = path.join(os.tmpdir(), "ffmpeg-recording.log");

interface Preferences {
  outputDir: string;
  audioDevice: string;
  fps: string;
}

function getOutputDir(prefs: Preferences): string {
  const dir = prefs.outputDir?.trim() || path.join(os.homedir(), "Videos");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function checkIsRecording(): { active: boolean; pid?: string } {
  if (!fs.existsSync(PID_FILE)) return { active: false };
  const pid = fs.readFileSync(PID_FILE, "utf8").trim();
  try {
    execSync(`kill -0 ${pid}`, { stdio: "ignore" });
    return { active: true, pid };
  } catch {
    fs.unlinkSync(PID_FILE);
    return { active: false };
  }
}

function stopRecording(): void {
  if (!fs.existsSync(PID_FILE)) return;
  const pid = fs.readFileSync(PID_FILE, "utf8").trim();
  try {
    execSync(`kill -INT ${pid}`);
    execSync(`sleep 1`);
  } catch { /* already dead */ }
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
}

function detectDisplay(): string {
  return process.env.DISPLAY || ":0";
}

function detectResolution(display: string): string {
  try {
    const out = execSync(`DISPLAY=${display} xdpyinfo 2>/dev/null | grep dimensions | awk '{print $2}'`)
      .toString().trim();
    return out || "1920x1080";
  } catch {
    return "1920x1080";
  }
}

function startRecording(prefs: Preferences): void {
  const outputDir = getOutputDir(prefs);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputFile = path.join(outputDir, `recording-${timestamp}.mp4`);

  const display = detectDisplay();
  const resolution = detectResolution(display);
  const audioDevice = prefs.audioDevice?.trim() || "default";
  const fps = prefs.fps?.trim() || "60";

  const args = [
    "-y",
    "-f", "x11grab",
    "-framerate", fps,
    "-s", resolution,
    "-i", `${display}.0+0,0`,
    "-f", "pulse",
    "-i", audioDevice,
    "-vcodec", "libx264",
    "-preset", "ultrafast",
    "-pix_fmt", "yuv420p",
    "-acodec", "aac",
    "-b:a", "128k",
    outputFile,
  ];

  fs.writeFileSync(LOG_FILE, `CMD: ffmpeg ${args.join(" ")}\nDISPLAY: ${display}\nOUTPUT: ${outputFile}\n\n--- FFMPEG OUTPUT ---\n`);

  const logFd = fs.openSync(LOG_FILE, "a");
  const child = spawn("ffmpeg", args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, DISPLAY: display },
  });

  child.on("error", (err) => {
    fs.appendFileSync(LOG_FILE, `\nSPAWN ERROR: ${err}\n`);
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
}

function readLogTail(): string {
  try {
    if (!fs.existsSync(LOG_FILE)) return "_No log yet. Start a recording to see ffmpeg output here._";
    const content = fs.readFileSync(LOG_FILE, "utf8").trim();
    if (!content) return "_Log is empty_";
    const lines = content.split("\n");
    // показываем последние 25 строк
    return lines.slice(-25).join("\n");
  } catch {
    return "_Could not read log_";
  }
}

export default function FFmpegScreenRecorder() {
  const prefs = getPreferenceValues<Preferences>();
  const [status, setStatus] = useState(() => checkIsRecording());
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState<string>("00:00");
  const [logLines, setLogLines] = useState<string>(readLogTail());

  // статус + лог каждые 2 секунды
  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(checkIsRecording());
      setLogLines(readLogTail());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // таймер
  useEffect(() => {
    if (!status.active || !startedAt) {
      setElapsed("00:00");
      return;
    }
    const interval = setInterval(() => {
      const secs = Math.floor((Date.now() - startedAt.getTime()) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, "0");
      const s = String(secs % 60).padStart(2, "0");
      setElapsed(`${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [status.active, startedAt]);

  const handleStart = async () => {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Starting recording..." });
    try {
      startRecording(prefs);
      await new Promise((r) => setTimeout(r, 800));
      const s = checkIsRecording();
      setStatus(s);
      setLogLines(readLogTail());
      if (s.active) {
        setStartedAt(new Date());
        toast.style = Toast.Style.Success;
        toast.title = "🔴 Recording started";
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "Failed to start";
        toast.message = "See log below";
      }
    } catch (e) {
      toast.style = Toast.Style.Failure;
      toast.title = "Error";
      toast.message = String(e);
    }
  };

  const handleStop = async () => {
    const toast = await showToast({ style: Toast.Style.Animated, title: "Stopping recording..." });
    stopRecording();
    setStatus({ active: false });
    setStartedAt(null);
    setLogLines(readLogTail());
    toast.style = Toast.Style.Success;
    toast.title = "⏹ Recording stopped";
    toast.message = `Saved to ${getOutputDir(prefs)}`;
  };

  const outputDir = getOutputDir(prefs);
  const display = detectDisplay();

  const markdown = status.active
    ? `# 🔴 Recording\n\n\`\`\`log\n${logLines}\n\`\`\``
    : `# ⚫ Ready to Record\n\n\`\`\`log\n${logLines}\n\`\`\``;

  return (
    <Detail
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Status">
            <Detail.Metadata.TagList.Item
              text={status.active ? `● REC ${elapsed}` : "○ Idle"}
              color={status.active ? Color.Red : Color.SecondaryText}
            />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Output" text={outputDir} />
          <Detail.Metadata.Label title="FPS" text={prefs.fps || "60"} />
          <Detail.Metadata.Label title="Display" text={display} />
          <Detail.Metadata.Label title="Audio" text={prefs.audioDevice || "default"} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Log" text={LOG_FILE} />
          <Detail.Metadata.Label title="PID" text={status.pid ?? "—"} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          {status.active ? (
            <Action
              title="Stop Recording"
              icon={Icon.Stop}
              style={Action.Style.Destructive}
              onAction={handleStop}
            />
          ) : (
            <Action
              title="Start Recording"
              icon={Icon.Circle}
              onAction={handleStart}
            />
          )}
          <Action.Open
            title="Open Output Folder"
            target={outputDir}
            icon={Icon.Finder}
            shortcut={{ modifiers: ["cmd"], key: "o" }}
          />
        </ActionPanel>
      }
    />
  );
}
