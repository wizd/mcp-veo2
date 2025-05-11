import { fal } from "@fal-ai/client";
import {
  ProviderVideoOutput,
  MediaGenerationProvider,
  ProviderImageOutput,
} from "./types.js";
import { log } from "../utils/logger.js";
import { v4 as uuidv4 } from "uuid";

class FalProvider implements MediaGenerationProvider {
  async generateVideoFromText(args: {
    prompt: string;
    aspectRatio?: "16:9" | "9:16";
    numberOfVideos?: number;
    durationSeconds?: number;
    // Fal specific parameters might be different or inferred from prompt or model defaults
    // enhancePrompt, negativePrompt, personGeneration are not directly mapped but could be part of prompt engineering
  }): Promise<ProviderVideoOutput[]> {
    log.info("FalProvider: Generating video from text", {
      prompt: args.prompt,
    });
    try {
      const input: any = { prompt: args.prompt };

      // Example: Adjusting parameters based on common Fal patterns if known.
      // Fal models often have specific input fields, e.g., num_inference_steps, seed, etc.
      // These would need to be mapped from generic args if desired, or let Fal use defaults.
      // if (args.durationSeconds) input.num_frames = args.durationSeconds * 25; // This is an example, actual param name might differ
      // if (args.aspectRatio) input.aspect_ratio = args.aspectRatio;

      // Using fal.run for a simpler request-response.
      // The model ID 'fal-ai/ltx-video' is from your example.
      const result: any = await fal.run("fal-ai/ltx-video", {
        input: input,
      });

      const videoOutputs: ProviderVideoOutput[] = [];

      // Fal's output structure needs to be robustly parsed.
      // Based on your original fal.ts: `console.log(result.data);`
      // Assuming `result.data` contains the relevant output, potentially an object with a `videos` array or a direct video object.
      let videos: any[] = [];
      if (
        result &&
        result.data &&
        result.data.videos &&
        Array.isArray(result.data.videos)
      ) {
        videos = result.data.videos;
      } else if (result && result.data && result.data.url) {
        // If data itself is a single video object with URL
        videos = [result.data];
      } else if (result && result.videos && Array.isArray(result.videos)) {
        // If result directly has videos array
        videos = result.videos;
      } else if (result && result.url) {
        // If result itself is a single video object with URL
        videos = [result];
      } else {
        log.warn("FalProvider: Unexpected result structure from Fal", {
          result,
        });
        throw new Error(
          "FalProvider: Could not parse video output from Fal. Expected video URL(s)."
        );
      }

      for (const video of videos) {
        if (video.url) {
          videoOutputs.push({
            id: uuidv4(), // Fal might not provide a persistent ID, generate one
            videoUrl: video.url,
            mimeType: video.content_type || "video/mp4", // Fal might provide content_type
            prompt: args.prompt,
          });
        }
      }

      if (videoOutputs.length === 0) {
        log.warn("FalProvider: No video URLs found in Fal response", {
          result,
        });
        throw new Error("FalProvider: No video URLs returned from Fal.");
      }

      return videoOutputs.slice(0, args.numberOfVideos || 1);
    } catch (error) {
      log.error("FalProvider: Error generating video from text", error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async generateVideoFromImage(args: {
    imageData: string;
    imageMimeType: string;
    prompt?: string;
    aspectRatio?: "16:9" | "9:16";
    numberOfVideos?: number;
    durationSeconds?: number;
  }): Promise<ProviderVideoOutput[]> {
    log.warn("FalProvider: generateVideoFromImage is not implemented.");
    // Most Fal image-to-video models would take an image_url, not base64 directly.
    // If needed, this would involve uploading the imageData to a temporary URL first.
    throw new Error("FalProvider: generateVideoFromImage is not implemented.");
  }

  async generateImage(args: {
    prompt: string;
    numberOfImages?: number;
  }): Promise<ProviderImageOutput[]> {
    log.warn("FalProvider: generateImage is not implemented.");
    throw new Error("FalProvider: generateImage is not implemented.");
  }
}

export const falProvider = new FalProvider();
