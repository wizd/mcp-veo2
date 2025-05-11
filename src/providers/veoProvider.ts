import { veoClient } from "../services/veoClient.js";
import {
  ProviderVideoOutput,
  MediaGenerationProvider,
  ProviderImageOutput,
} from "./types.js";
import { log } from "../utils/logger.js";

class VeoProvider implements MediaGenerationProvider {
  async generateVideoFromText(args: {
    prompt: string;
    aspectRatio?: "16:9" | "9:16";
    personGeneration?: "dont_allow" | "allow_adult";
    numberOfVideos?: 1 | 2; // VeoClient seems to handle one video per call in current setup
    durationSeconds?: number;
    enhancePrompt?: boolean;
    negativePrompt?: string;
  }): Promise<ProviderVideoOutput[]> {
    log.info("VeoProvider: Generating video from text", {
      prompt: args.prompt,
    });
    try {
      const config = {
        aspectRatio: args.aspectRatio || "16:9",
        personGeneration: args.personGeneration || "dont_allow",
        numberOfVideos: args.numberOfVideos || 1, // Pass through, though Veo client might manage this differently
        durationSeconds: args.durationSeconds || 5,
        enhancePrompt: args.enhancePrompt ?? false,
        negativePrompt: args.negativePrompt || "",
      };

      // veoClient.generateFromText options included `autoDownload` and `includeFullData`.
      // The provider should aim to get the most complete data it can.
      // The orchestrator (generateVideo.ts) will decide what to include in the final CallToolResult.
      // Let's assume provider tries to get full data if possible and handles its own saving if that's its model.
      // Original veoClient returns filepath and videoData, indicating it handles saving/downloading.
      const result = await veoClient.generateFromText(args.prompt, config, {
        autoDownload: true, // Ensuring provider gets the file path if possible
        includeFullData: true, // Ensuring provider gets base64 data if possible
      });

      return [
        {
          id: result.id,
          filepath: result.filepath,
          videoUrl: result.videoUrl,
          videoData: result.videoData,
          mimeType: result.mimeType,
          prompt: args.prompt, // Or result.prompt if Veo returns the used prompt
          // metadata: result // Could pass through all metadata if needed
        },
      ];
    } catch (error) {
      log.error("VeoProvider: Error generating video from text", error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async generateVideoFromImage(args: {
    imageData: string; // base64
    imageMimeType: string;
    prompt?: string;
    aspectRatio?: "16:9" | "9:16";
    numberOfVideos?: 1 | 2;
    durationSeconds?: number;
    enhancePrompt?: boolean;
    negativePrompt?: string;
  }): Promise<ProviderVideoOutput[]> {
    log.info("VeoProvider: Generating video from image", {
      prompt: args.prompt,
    });
    try {
      const config = {
        aspectRatio: args.aspectRatio || "16:9",
        numberOfVideos: args.numberOfVideos || 1,
        durationSeconds: args.durationSeconds || 5,
        enhancePrompt: args.enhancePrompt ?? false,
        negativePrompt: args.negativePrompt || "",
      };

      const result = await veoClient.generateFromImage(
        args.imageData,
        args.prompt,
        config,
        {
          autoDownload: true, // Ensuring provider gets the file path
          includeFullData: true, // Ensuring provider gets base64 data
        },
        args.imageMimeType
      );

      return [
        {
          id: result.id,
          filepath: result.filepath,
          videoUrl: result.videoUrl,
          videoData: result.videoData,
          mimeType: result.mimeType,
          prompt: args.prompt, // Or result.prompt
        },
      ];
    } catch (error) {
      log.error("VeoProvider: Error generating video from image", error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async generateImage(args: {
    prompt: string;
    numberOfImages?: number;
  }): Promise<ProviderImageOutput[]> {
    log.warn(
      "VeoProvider: generateImage is not implemented. Use GoogleProvider for Imagen."
    );
    throw new Error(
      "VeoProvider: generateImage is not implemented. Use GoogleProvider for Imagen."
    );
  }
}

export const veoProvider = new VeoProvider();
