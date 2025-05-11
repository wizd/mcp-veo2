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
    imageData: string; // base64 encoded image
    imageMimeType: string;
    prompt?: string;
    aspectRatio?: "16:9" | "9:16";
    numberOfVideos?: number; // fal-ai/framepack generates one video per request
    durationSeconds?: number;
    enhancePrompt?: boolean; // Not directly used by framepack, can be ignored or used in prompt engineering if desired
    negativePrompt?: string;
  }): Promise<ProviderVideoOutput[]> {
    log.info(
      `FalProvider: Generating video from image using framepack (queue). Prompt: "${args.prompt}", AspectRatio: ${args.aspectRatio}, Duration: ${args.durationSeconds}s`
    );
    try {
      // 1. Upload image data to get a URL
      // Convert base64 string to a Buffer, then to a File-like object for fal.storage.upload
      // fal.storage.upload expects a File object or a similar structure.
      // Let's construct a "Blob-like" object, as 'File' is a browser concept.
      // The fal client might handle raw Buffers or require specific structuring for Node.js.
      // The docs show: const file = new File(["Hello, World!"], "hello.txt", { type: "text/plain" });
      // In Node.js, we can use Buffer directly or a stream. Let's try with Buffer and see if client handles it.
      // If not, we may need to use a library or a more specific approach for Node.js File representation for fal.

      let imageUrl = "";
      try {
        const imageBuffer = Buffer.from(args.imageData, "base64");
        const fileName = `input-${uuidv4()}.${
          args.imageMimeType.split("/")[1] || "png"
        }`;

        // Construct a File-like object for fal.storage.upload
        // as `upload(file: FalFile)` expects properties like name and type to be part of the file object.
        const fileObjectForUpload = {
          data: imageBuffer, // The actual binary data
          name: fileName, // The desired file name
          type: args.imageMimeType, // The mime type
          // fal-ai client might expect an arrayBuffer method or property for processing
          arrayBuffer: async () => imageBuffer,
          size: imageBuffer.length,
        };

        log.info("FalProvider: Uploading image to Fal storage...");
        // Pass the constructed object that adheres to what fal.storage.upload might expect for a File/Data type
        imageUrl = await fal.storage.upload(fileObjectForUpload as any); // Cast to any to bypass strict FalFile type if our object isn't a perfect match
        log.info(`FalProvider: Image uploaded successfully. URL: ${imageUrl}`);
      } catch (uploadError) {
        log.error(
          "FalProvider: Error uploading image to Fal storage",
          uploadError
        );
        throw new Error(
          `FalProvider: Failed to upload image for video generation. ${
            uploadError instanceof Error
              ? uploadError.message
              : String(uploadError)
          }`
        );
      }

      const input: any = {
        prompt: args.prompt || "A beautiful video generated from an image.", // Default prompt if none provided
        image_url: imageUrl,
      };

      if (args.aspectRatio) {
        input.aspect_ratio = args.aspectRatio; // "16:9" or "9:16"
      }
      if (args.durationSeconds) {
        // framepack default num_frames is 180. Assuming 30 FPS for conversion.
        input.num_frames = args.durationSeconds * 30;
      }
      if (args.negativePrompt) {
        input.negative_prompt = args.negativePrompt;
      }
      // Other framepack specific params like 'resolution', 'cfg_scale', 'guidance_scale', 'seed' can be added if needed
      // Using defaults for now: resolution: "480p", cfg_scale: 1, guidance_scale: 10, num_frames: 180 (if not set by duration)

      log.info(
        "FalProvider: Submitting image-to-video request to framepack queue...",
        { input }
      );
      const { request_id } = await fal.queue.submit("fal-ai/framepack", {
        input: input,
      });

      log.info(
        `FalProvider: Framepack request submitted with ID: ${request_id}. Polling for completion...`
      );

      let result: any;
      const POLLING_INTERVAL_MS = 5000; // 5 seconds
      const MAX_POLLING_ATTEMPTS = 120; // 10 minutes timeout
      let attempts = 0;

      while (attempts < MAX_POLLING_ATTEMPTS) {
        attempts++;
        const statusResponse: any = await fal.queue.status("fal-ai/framepack", {
          requestId: request_id,
          logs: true,
        });

        log.debug(
          `FalProvider (framepack): Poll attempt ${attempts}, Status: ${statusResponse.status}`,
          { logs: statusResponse.logs }
        );

        if (statusResponse.status === "COMPLETED") {
          log.info(
            `FalProvider (framepack): Request ${request_id} completed. Fetching result...`
          );
          result = (await fal.queue.result("fal-ai/framepack", {
            requestId: request_id,
          })) as any;
          break;
        } else if (
          statusResponse.status === "IN_PROGRESS" ||
          statusResponse.status === "IN_QUEUE"
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, POLLING_INTERVAL_MS)
          );
        } else if (
          statusResponse.status === "FAILED" ||
          statusResponse.status === "CANCELLED" ||
          statusResponse.status === "ERROR"
        ) {
          log.error(
            `FalProvider (framepack): Video generation failed or was cancelled for request ${request_id}. Status: ${statusResponse.status}`,
            { statusResponse }
          );
          throw new Error(
            `FalProvider (framepack): Video generation failed with status ${
              statusResponse.status
            }. Error: ${statusResponse.error || "Unknown error"}`
          );
        } else {
          log.error(
            `FalProvider (framepack): Unknown status for request ${request_id}: ${statusResponse.status}`,
            { statusResponse }
          );
          throw new Error(
            `FalProvider (framepack): Unknown status ${statusResponse.status} for video generation.`
          );
        }
      }

      if (!result) {
        log.error(
          `FalProvider (framepack): Video generation timed out after ${
            (attempts * POLLING_INTERVAL_MS) / 1000
          } seconds for request ${request_id}.`
        );
        throw new Error("FalProvider (framepack): Video generation timed out.");
      }

      log.info("FalProvider (framepack): Video result fetched.", { result });

      // Framepack output schema: { video: { url: "...", ... }, seed: ... }
      if (result && result.video && result.video.url) {
        const videoItem = result.video;
        const output: ProviderVideoOutput = {
          id: request_id,
          videoUrl: videoItem.url,
          mimeType: videoItem.content_type || "video/mp4", // Default to video/mp4
          prompt: args.prompt,
          // seed: result.seed // if seed is available and needed
        };
        return [output]; // framepack seems to generate one video
      } else {
        log.warn(
          "FalProvider (framepack): Unexpected result structure from Fal queue",
          { result }
        );
        throw new Error(
          "FalProvider (framepack): Could not parse video output from Fal queue. Expected video URL."
        );
      }
    } catch (error) {
      log.error(
        "FalProvider (framepack): Error generating video from image",
        error
      );
      throw error instanceof Error ? error : new Error(String(error));
    }
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
