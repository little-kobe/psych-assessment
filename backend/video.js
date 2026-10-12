// backend/video.js
// 视频格式处理：手机拍的视频常是 H.265（HEVC）编码，很多电脑浏览器放不了（只有声音没画面）。
// 服务器装了 ffmpeg 时，上传的视频统一转成所有浏览器都能播的 H.264 + AAC 的 mp4。
// 没装 ffmpeg（比如本地 Windows 电脑）时不转换，只检查出 H.265 并提醒。
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

function run(cmd, args, timeoutMs = 15 * 60 * 1000) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr, err }),
    );
  });
}

// 有没有 ffmpeg / ffprobe（只检查一次）
let ffmpegReady = null;
async function hasFfmpeg() {
  if (ffmpegReady === null) {
    const a = await run("ffmpeg", ["-version"], 10000);
    const b = await run("ffprobe", ["-version"], 10000);
    ffmpegReady = a.ok && b.ok;
  }
  return ffmpegReady;
}

// 视频轨道的编码，如 "h264"、"hevc"；读不出来返回 null
async function videoCodec(file) {
  const r = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name",
      "-of",
      "csv=p=0",
      file,
    ],
    60000,
  );
  return r.ok ? r.stdout.trim().split(/\s+/)[0] || null : null;
}

// 不用 ffmpeg，直接看文件里的编码标记判断是不是 H.265（mp4/mov 的 moov 在开头或结尾）
function looksLikeHevc(file) {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, "r");
  try {
    const chunk = 4 * 1024 * 1024;
    const parts = [[0, Math.min(chunk, size)]];
    if (size > chunk) parts.push([Math.max(chunk, size - chunk), size]);
    for (const [start, end] of parts) {
      const buf = Buffer.alloc(end - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      if (buf.includes("hvc1") || buf.includes("hev1")) return true;
    }
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

// 转成网页通用的 mp4：H.264 只换个封装（很快）；其他编码重新编码（宽度最大 1280）
// 成功返回新文件路径（.mp4），失败返回 null
async function toWebMp4(inFile) {
  const dir = path.dirname(inFile);
  const base = path.basename(inFile, path.extname(inFile));
  const tmp = path.join(dir, `${base}.converting.mp4`);
  const out = path.join(dir, `${base}.mp4`);
  const codec = await videoCodec(inFile);
  if (!codec) return null;

  let ok = false;
  if (codec === "h264") {
    const r = await run("ffmpeg", [
      "-y",
      "-i",
      inFile,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      tmp,
    ]);
    ok = r.ok;
  }
  if (!ok) {
    const r = await run("ffmpeg", [
      "-y",
      "-i",
      inFile,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale='trunc(min(1280,iw)/2)*2':-2",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      tmp,
    ]);
    ok = r.ok;
  }
  if (!ok) {
    fs.rmSync(tmp, { force: true });
    return null;
  }
  if (path.resolve(inFile) !== path.resolve(out))
    fs.rmSync(inFile, { force: true });
  fs.renameSync(tmp, out);
  return out;
}

module.exports = { hasFfmpeg, videoCodec, looksLikeHevc, toWebMp4, run };
