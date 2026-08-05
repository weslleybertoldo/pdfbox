import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import type { CompressMode } from "./convert/compress";

interface VideoCompressorPlugin {
  /** inputSize == 0 significa "desconhecido" (o nativo não conseguiu ler o tamanho do arquivo de origem). */
  pickAndCompress(options: { mode: CompressMode }): Promise<{
    path: string;
    inputSize: number;
    outputSize: number;
  }>;
  addListener(
    event: "compressProgress",
    fn: (d: { percent: number }) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}
const VideoCompressor = registerPlugin<VideoCompressorPlugin>("VideoCompressor");

export const isNativeAndroid = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

/**
 * Abre o picker nativo de vídeo e comprime offline (media3 Transformer).
 * O vídeo nunca trafega pelo JS — pick, transcodificação e saída ficam no nativo.
 */
export async function pickAndCompressVideo(
  mode: CompressMode,
  onProgress: (p: number) => void,
): Promise<{ path: string; inputSize: number; outputSize: number }> {
  if (!isNativeAndroid()) {
    throw new Error("Compressão de vídeo só está disponível no app Android.");
  }
  const listener = await VideoCompressor.addListener("compressProgress", (d) =>
    onProgress(d.percent),
  );
  try {
    return await VideoCompressor.pickAndCompress({ mode });
  } finally {
    await listener.remove();
  }
}

/** Compartilha o mp4 comprimido direto do cache nativo. */
export async function shareCompressedVideo(path: string): Promise<void> {
  const { uri } = await Filesystem.getUri({
    path: path.split("/").pop()!,
    directory: Directory.Cache,
  });
  await Share.share({ files: [uri] });
}
