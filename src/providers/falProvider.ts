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
    log.info(
      `FalProvider: Generating video from text using queue. Prompt: "${args.prompt}", AspectRatio: ${args.aspectRatio}, Videos: ${args.numberOfVideos}, Duration: ${args.durationSeconds}s`
    );
    try {
      const input: any = { prompt: args.prompt };
      // LTX Video specific parameters from docs
      // num_inference_steps: 30 (default), guidance_scale: 3 (default)
      // Example: if (args.durationSeconds) input.num_frames = args.durationSeconds * 25; // This is an example, actual param name might differ for ltx-video
      // The LTX video model does not seem to have explicit duration or aspect ratio params in the provided schema.
      // These might be inferred from the prompt or have fixed outputs.
      // We will pass the prompt and let Fal use its defaults for other video properties for now.

      log.info("FalProvider: Submitting video generation request to queue...", {
        input,
      });
      const { request_id } = await fal.queue.submit("fal-ai/ltx-video", {
        input: input,
        // webhookUrl: "YOUR_WEBHOOK_URL" // Optional: if you want to use webhooks
      });

      log.info(
        `FalProvider: Request submitted with ID: ${request_id}. Polling for completion...`
      );

      let result: any;
      const POLLING_INTERVAL_MS = 5000; // 5 seconds
      const MAX_POLLING_ATTEMPTS = 120; // 5s * 120 = 10 minutes timeout
      let attempts = 0;

      while (attempts < MAX_POLLING_ATTEMPTS) {
        attempts++;
        const statusResponse: any = await fal.queue.status("fal-ai/ltx-video", {
          requestId: request_id,
          logs: true, // To get logs if needed
        });

        log.debug(
          `FalProvider: Poll attempt ${attempts}, Status: ${statusResponse.status}`,
          { logs: statusResponse.logs }
        );

        if (statusResponse.status === "COMPLETED") {
          log.info(
            `FalProvider: Request ${request_id} completed. Fetching result...`
          );
          result = (await fal.queue.result("fal-ai/ltx-video", {
            requestId: request_id,
          })) as any; // Cast to any
          break;
        } else if (
          statusResponse.status === "IN_PROGRESS" ||
          statusResponse.status === "IN_QUEUE"
        ) {
          // Continue polling
          await new Promise((resolve) =>
            setTimeout(resolve, POLLING_INTERVAL_MS)
          );
        } else if (
          statusResponse.status === "FAILED" ||
          statusResponse.status === "CANCELLED" ||
          statusResponse.status === "ERROR"
        ) {
          log.error(
            `FalProvider: Video generation failed or was cancelled for request ${request_id}. Status: ${statusResponse.status}`,
            { statusResponse }
          );
          throw new Error(
            `FalProvider: Video generation failed with status ${
              statusResponse.status
            }. Error: ${statusResponse.error || "Unknown error"}`
          );
        } else {
          // Unknown status, treat as error for now
          log.error(
            `FalProvider: Unknown status for request ${request_id}: ${statusResponse.status}`,
            { statusResponse }
          );
          throw new Error(
            `FalProvider: Unknown status ${statusResponse.status} for video generation.`
          );
        }
      }

      if (!result) {
        log.error(
          `FalProvider: Video generation timed out after ${
            (attempts * POLLING_INTERVAL_MS) / 1000
          } seconds for request ${request_id}.`
        );
        throw new Error("FalProvider: Video generation timed out.");
      }

      log.info("FalProvider: Video result fetched.", { result });

      const videoOutputs: ProviderVideoOutput[] = [];
      let parsedVideos: any[] = [];

      // The result structure from fal.queue.result seems to be directly the output schema.
      // According to the docs:
      // Output:
      // {
      //   "video": {
      //     "url": "",
      //     "content_type": "image/png", // Docs say image/png, likely video/*
      //     "file_name": "z9RV14K95DvU.png",
      //     "file_size": 4404019
      //   },
      //   "seed": integer
      // }
      // So, result should be this object itself.
      if (result && result.video && result.video.url) {
        parsedVideos = [result.video]; // The 'video' key holds the file object
      } else {
        // Fallback for older structures or if the direct result is a list/single item (less likely for queue.result)
        if (result && result.data) {
          // Check if wrapped in data
          const dataPayload = result.data;
          if (dataPayload.videos && Array.isArray(dataPayload.videos)) {
            parsedVideos = dataPayload.videos;
          } else if (dataPayload.video && dataPayload.video.url) {
            parsedVideos = [dataPayload.video];
          } else if (dataPayload.url) {
            parsedVideos = [dataPayload];
          }
        } else if (result && result.url) {
          // Check if result itself is the video object
          parsedVideos = [result];
        }
      }

      if (parsedVideos.length === 0) {
        log.warn("FalProvider: Unexpected result structure from Fal queue", {
          result,
        });
        throw new Error(
          "FalProvider: Could not parse video output from Fal queue. Expected video URL(s)."
        );
      }

      for (const videoItem of parsedVideos) {
        if (videoItem.url) {
          videoOutputs.push({
            id: request_id, // Use request_id as the unique ID for the video
            videoUrl: videoItem.url,
            // Use provided content_type, fallback to video/mp4. Fal example showed image/png for a video.
            mimeType: videoItem.content_type || "video/mp4",
            prompt: args.prompt,
            // file_name: videoItem.file_name, // Can be added if needed
            // file_size: videoItem.file_size, // Can be added if needed
            // seed: result.seed // if seed is part of the top-level result object
          });
        }
      }

      if (videoOutputs.length === 0) {
        log.warn(
          "FalProvider: No valid video items with URLs found in Fal queue response",
          { result }
        );
        throw new Error("FalProvider: No video URLs returned from Fal queue.");
      }

      return videoOutputs.slice(0, args.numberOfVideos || 1);
    } catch (error) {
      log.error(
        "FalProvider: Error generating video from text via queue",
        error
      );
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
