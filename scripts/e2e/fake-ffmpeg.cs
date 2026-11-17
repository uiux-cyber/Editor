// A stand-in for ffmpeg.exe used by scripts/e2e/media.mjs on machines without FFmpeg.
// It answers -version / -encoders like FFmpeg and, for a conversion, prints FFmpeg's
// "Duration:" banner on stderr and `-progress pipe:1` blocks on stdout, then writes a valid
// MP4: the e2e "ProRes" fixture is an H.264 MP4 whose sample-entry fourcc was changed from
// 'avc1' to 'apcn' (ProRes 422), so restoring the fourcc yields a decodable file.
// If the source name contains "slow", the conversion takes ~8 s (to test cancelling).
// Compiled at test time with the .NET Framework C# compiler (csc.exe).
using System;
using System.IO;
using System.Text;
using System.Threading;

class FakeFfmpeg
{
    static int IndexOf(byte[] data, byte[] pattern, int from)
    {
        for (int i = Math.Max(0, from); i <= data.Length - pattern.Length; i++)
        {
            int j = 0;
            while (j < pattern.Length && data[i + j] == pattern[j]) j++;
            if (j == pattern.Length) return i;
        }
        return -1;
    }

    static int Main(string[] args)
    {
        var stdout = Console.OpenStandardOutput();
        var stderr = Console.Error;
        if (Array.IndexOf(args, "-version") >= 0)
        {
            Console.WriteLine("ffmpeg version 7.1-kinora-test Copyright (c) 2000-2024 the FFmpeg developers");
            Console.WriteLine("built with fake-ffmpeg for automated tests");
            return 0;
        }
        if (Array.IndexOf(args, "-encoders") >= 0)
        {
            Console.WriteLine("Encoders:");
            Console.WriteLine(" V..... = Video");
            Console.WriteLine(" A..... = Audio");
            Console.WriteLine(" ------");
            Console.WriteLine(" V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)");
            Console.WriteLine(" V....D h264_mf              H264 via MediaFoundation (codec h264)");
            Console.WriteLine(" A....D aac                  AAC (Advanced Audio Coding)");
            return 0;
        }
        int inIdx = Array.IndexOf(args, "-i");
        if (inIdx < 0 || inIdx + 1 >= args.Length)
        {
            stderr.WriteLine("No input specified");
            return 1;
        }
        string src = args[inIdx + 1];
        string dst = args[args.Length - 1];
        if (!File.Exists(src))
        {
            stderr.WriteLine(src + ": No such file or directory");
            return 1;
        }
        bool slow = Path.GetFileName(src).ToLowerInvariant().Contains("slow");
        double duration = 4.0;
        stderr.WriteLine("Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '" + src + "':");
        stderr.WriteLine("  Duration: 00:00:04.00, start: 0.000000, bitrate: 12000 kb/s");
        stderr.WriteLine("  Stream #0:0[0x1](und): Video: prores (apcn / 0x6E637061), yuv422p10le, 1280x720, 30 fps");
        stderr.Flush();
        int steps = slow ? 40 : 8;
        for (int i = 1; i <= steps; i++)
        {
            Thread.Sleep(200);
            double t = duration * i / steps;
            long us = (long)(t * 1000000);
            var block = new StringBuilder();
            block.Append("frame=").Append((int)(t * 30)).Append('\n');
            block.Append("fps=60.0\n");
            block.Append("out_time_us=").Append(us).Append('\n');
            block.Append("out_time_ms=").Append(us).Append('\n');
            block.Append("out_time=00:00:").Append(t.ToString("00.000000", System.Globalization.CultureInfo.InvariantCulture)).Append('\n');
            block.Append("speed=").Append((slow ? 0.5 : 2.5).ToString(System.Globalization.CultureInfo.InvariantCulture)).Append("x\n");
            block.Append(i == steps ? "progress=end\n" : "progress=continue\n");
            var bytes = Encoding.ASCII.GetBytes(block.ToString());
            stdout.Write(bytes, 0, bytes.Length);
            stdout.Flush();
        }
        byte[] data = File.ReadAllBytes(src);
        int stsd = IndexOf(data, Encoding.ASCII.GetBytes("stsd"), 0);
        int pos = stsd < 0 ? -1 : IndexOf(data, Encoding.ASCII.GetBytes("apcn"), stsd);
        if (pos >= 0)
        {
            byte[] avc1 = Encoding.ASCII.GetBytes("avc1");
            Array.Copy(avc1, 0, data, pos, 4);
        }
        File.WriteAllBytes(dst, data);
        return 0;
    }
}
