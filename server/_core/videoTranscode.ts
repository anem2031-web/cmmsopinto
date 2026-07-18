import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * تحويل أي فيديو مرفوع (بغض النظر عن صيغته/ترميزه الأصلي، سواء WebM أو MP4
 * غير قياسي من MediaRecorder في المتصفح) إلى MP4/H.264 + AAC قياسي 100%
 * متوافق مع كل الأجهزة والمتصفحات، بما فيها Safari/آيفون التي تكون
 * صارمة جداً في قبول ملفات الفيديو (بعكس Chrome المتساهل أكثر).
 *
 * هذا بالضبط نفس مبدأ إعادة الترميز التي تطبّقها واتساب على الفيديوهات المُرسلة.
 */
export async function transcodeVideoToCompatibleMp4(inputBuffer: Buffer): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `in-${randomUUID()}`);
  const outputPath = path.join(tmpDir, `out-${randomUUID()}.mp4`);

  await fs.writeFile(inputPath, inputBuffer);

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .videoCodec("libx264")
        .audioCodec("aac")
        .outputOptions([
          "-profile:v baseline", // أوسع توافق ممكن (يشمل حتى الأجهزة القديمة)
          "-level 3.0",
          "-pix_fmt yuv420p", // مطلوب لضمان تشغيله على Safari/آيفون
          "-movflags +faststart", // يضع بيانات التشغيل بأول الملف (تشغيل فوري بدون انتظار التحميل الكامل)
          "-preset veryfast",
          "-crf 26", // جودة جيدة بحجم صغير نسبياً (قريب من فلسفة ضغط واتساب)
        ])
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .save(outputPath);
    });

    return await fs.readFile(outputPath);
  } finally {
    // تنظيف الملفات المؤقتة دائماً حتى لو فشل التحويل
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}
